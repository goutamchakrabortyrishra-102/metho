import json
import re
import sys
from itertools import count
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, CRMLead, CRMLeadActivity, PartnerRequest, User, UserReferral, WhatsAppRegistrationSession
from sql_app.whatsapp_cloud import (
    NATIVE_REG_DEFAULT_SPONSOR_CODE,
    WHATSAPP_NATIVE_REG_CONFIRM,
    WHATSAPP_NATIVE_REG_CONSENT,
    WHATSAPP_NATIVE_REG_MEMBER,
    WHATSAPP_ROLE_REGISTRATION_PENDING,
    ingest_whatsapp_message,
)

SENDER = "919876543210"
PHONE = "9876543210"
DEFAULT_SPONSOR_ID = "21e906aa-1111-2222-3333-444444444444"
_ids = count(1)


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_user(db, user_id, role="member", phone="", active=True):
    user = User(id=user_id, name=f"User {user_id[:6]}", email=user_id, phone=phone or user_id[-10:], password="hashed", role=role, is_active=active)
    db.add(user)
    db.flush()
    return user


def payload(body, sender=SENDER, message_type="text"):
    message = {"from": sender, "id": f"wamid.native-{next(_ids)}", "timestamp": "1712345678", "type": message_type}
    if message_type == "text":
        message["text"] = {"body": body}
    else:
        message[message_type] = {}
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "business-account-1", "changes": [{"value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+1234567890", "phone_number_id": "123456"},
            "contacts": [{"profile": {"name": "Test Customer"}, "wa_id": sender}],
            "messages": [message],
        }}]}],
    }


class Chat:
    def __init__(self, db, monkeypatch, role, tags=None):
        self.db = db
        self.sent = []
        monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: self.sent.append(text) or True)
        self.lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=SENDER, whatsapp_no=SENDER, source="whatsapp", tags_json=json.dumps(tags or ["whatsapp_cloud"]))
        db.add(self.lead)
        db.flush()
        self.session = WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=self.lead.id, role=role, state=WHATSAPP_ROLE_REGISTRATION_PENDING)
        db.add(self.session)
        db.commit()

    def say(self, *texts, message_type="text"):
        for text in texts:
            ingest_whatsapp_message(self.db, payload(text, message_type=message_type), None)
        return self.sent[-1]

    @property
    def last(self):
        return self.sent[-1]


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr("sql_app.routers.auth.build_welcome_pdf", lambda user: "")
    monkeypatch.setattr("sql_app.routers.auth.send_welcome_email", lambda *args: False)
    db = make_session()
    add_user(db, "MAU00001", "super_admin")
    add_user(db, DEFAULT_SPONSOR_ID, "member")
    add_user(db, "MAU10001", "member")
    db.commit()
    yield db, monkeypatch
    db.close()


def assert_password_delivered_but_not_stored(db, chat):
    match = re.search(r"Your login password is: (\d{6}) — please save it", chat.last)
    assert match, chat.last
    password = match.group(1)
    assert all(password not in (activity.message or "") for activity in db.query(CRMLeadActivity).all())
    assert password not in (chat.session.data_json or "")
    return password


def test_default_sponsor_constant_resolves_like_the_web_form(env):
    from sql_app.routers.auth import _resolve_user_by_identifier, sponsor_info

    db, _ = env
    assert NATIVE_REG_DEFAULT_SPONSOR_CODE == "MTH-21E906"
    assert _resolve_user_by_identifier(db, NATIVE_REG_DEFAULT_SPONSOR_CODE).id == DEFAULT_SPONSOR_ID
    assert sponsor_info(NATIVE_REG_DEFAULT_SPONSOR_CODE, db)["member_code"] == "MTH-21E906"


@pytest.mark.parametrize("keyword", ["CHAT", "chat", "চ্যাট", "শুরু"])
def test_entry_keywords_start_the_in_chat_flow(env, keyword):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    reply = chat.say(keyword)
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONSENT
    assert "Terms & Conditions" in reply and "/member-terms" in reply


def test_full_member_flow_uses_default_sponsor_and_delivers_password(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES")
    assert chat.session.state == WHATSAPP_NATIVE_REG_MEMBER
    chat.say("Rahul Das", "15-08-1990", "abcde1234f", "skip", "skip")
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONFIRM
    assert "ABCDE1234F" not in chat.last and "MTH-21E906" in chat.last
    chat.say("1")

    user = db.query(User).filter(User.role == "member", User.name == "Rahul Das").one()
    assert user.phone == PHONE and user.is_active is False
    assert db.query(UserReferral).filter_by(user_id=user.id).one().sponsor_user_id == DEFAULT_SPONSOR_ID
    profile = json.loads(db.query(AppSetting).filter_by(key=f"user_profile:{user.id}").one().value_json)
    assert profile["dob"] == "1990-08-15" and profile["pan_no"] == "ABCDE1234F"
    assert chat.session.state == "MEMBER_ACTIVATION_PENDING"
    assert chat.lead.member_user_id == user.id
    assert f"Login ID: {user.id}" in chat.last
    assert_password_delivered_but_not_stored(db, chat)


@pytest.mark.parametrize("business_type,sector_choice,name,expected_label", [
    ("1", "2", "Sharma Kirana Store", "Shop"),
    ("2", "7", "City Care Studio", "Service"),
])
def test_full_partner_flow_for_shop_and_service(env, business_type, sector_choice, name, expected_label):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "partner")
    chat.say("CHAT", "YES", business_type, sector_choice, "Kirana Essentials", name, "Daily needs", "Ramesh Sharma", "BCDEF1234G", "1234 5678 9012", "ramesh.shop")
    chat.say("12 Park Street", "west bengal", "Kolkata District", "Kolkata", "700001", "ramesh@paytm", "12.5", "MAU10001")
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONFIRM
    assert "BCDEF1234G" not in chat.last and "123456789012" not in chat.last
    chat.say("yes")

    row = db.query(PartnerRequest).one()
    assert row.status == "pending" and row.phone == PHONE and row.gst_no == "BCDEF1234G" and row.email == "ramesh.shop"
    assert row.business_type.startswith(expected_label)
    assert row.commission_percent_ask == 12.5 and row.upi_id == "ramesh@paytm" and "West Bengal" in row.address
    classification = json.loads(db.query(AppSetting).filter(AppSetting.key.like("partner_classification:request:%")).one().value_json)
    assert classification["business_type"] == expected_label and classification["sponsor_user_id"] == "MAU10001"
    assert chat.session.state == "PARTNER_APPLICATION_PENDING" and chat.lead.partner_request_id == row.id
    assert "Login ID: ramesh.shop" in chat.last
    assert_password_delivered_but_not_stored(db, chat)


def test_full_rider_flow_with_optional_bundles(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "rider")
    chat.say("CHAT", "YES", "Suresh Kumar", "2", "WB-12-3456", "suresh@example.com", "Road 5", "bihar", "Patna City", "Patna", "800001", "CDEFG1234H", "123456789012")
    chat.say("yes", "Mina Kumar", "9811111111", "yes", "Suresh Kumar", "SBI", "123456789", "sbin0001234", "suresh@upi", "MAU10001")
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONFIRM
    chat.say("1")

    rider = db.query(User).filter_by(role="rider").one()
    profile = json.loads(db.query(AppSetting).filter_by(key=f"rider_profile:{rider.id}").one().value_json)
    assert rider.email == "suresh@example.com" and rider.phone == PHONE
    assert profile["vehicle_type"] == "e_rickshaw" and profile["state"] == "Bihar" and profile["district"] == "Patna City"
    assert profile["emergency_contact_name"] == "Mina Kumar" and profile["bank_ifsc"] == "SBIN0001234"
    assert profile["sponsor_user_id"] == "MAU10001" and profile["terms_accepted_at"]
    assert chat.session.state == "RIDER_APPLICATION_PENDING" and chat.lead.rider_user_id == rider.id
    assert_password_delivered_but_not_stored(db, chat)


def test_skipping_optional_fields_and_gates(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "rider")
    chat.say("CHAT", "YES", "Suresh Kumar", "1", "skip", "skip", "Road 5", "Bihar", "skip", "Patna", "800001", "CDEFG1234H", "123456789012", "skip", "skip", "skip", "skip")
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONFIRM
    assert "Emergency" not in chat.last and "IFSC" not in chat.last
    chat.say("1")

    rider = db.query(User).filter_by(role="rider").one()
    profile = json.loads(db.query(AppSetting).filter_by(key=f"rider_profile:{rider.id}").one().value_json)
    assert rider.email == f"rider.{PHONE}@metho.local"
    assert profile["emergency_contact_name"] == "" and profile["bank_account_number"] == "" and profile["vehicle_number"] == ""
    assert profile["sponsor_user_id"] == DEFAULT_SPONSOR_ID


def test_required_field_cannot_be_skipped(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "skip")
    assert "আবশ্যক" in chat.last and "চেষ্টা 1/3" in chat.last
    assert chat.session.state == WHATSAPP_NATIVE_REG_MEMBER


def test_invalid_pan_retries_then_hands_off_to_a_human(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das", "15-08-1990", "bad-pan")
    assert "চেষ্টা 1/3" in chat.last and "ABCDE1234F" in chat.last
    chat.say("still bad")
    assert "চেষ্টা 2/3" in chat.last
    chat.say("nope")
    assert "support team" in chat.last
    assert chat.session.state == "IDLE"
    assert db.query(CRMLeadActivity).filter_by(activity_type="whatsapp_human_handoff_requested").count() == 1
    assert db.query(User).filter_by(role="member", name="Rahul Das").count() == 0


def test_valid_answer_resets_the_retry_counter(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das", "bad", "bad", "15-08-1990", "bad", "bad")
    assert "চেষ্টা 2/3" in chat.last and chat.session.state == WHATSAPP_NATIVE_REG_MEMBER


def test_duplicate_phone_is_not_retried_and_offers_web_link(env):
    db, monkeypatch = env
    add_user(db, "MAU20002", "member", phone=PHONE)
    db.commit()
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES")
    assert "registration_role=member" in chat.last and "Executive" in chat.last
    assert chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING


def test_duplicate_partner_login_id_is_not_retried(env):
    db, monkeypatch = env
    add_user(db, "taken.shop", "partner", phone="9000000011")
    db.commit()
    chat = Chat(db, monkeypatch, "partner")
    chat.say("CHAT", "YES", "1", "1", "skip", "Shop", "skip", "Owner", "BCDEF1234G", "123456789012", "taken.shop")
    assert "Login ID" in chat.last and "registration_role=partner" in chat.last
    assert chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
    assert db.query(PartnerRequest).count() == 0


def test_duplicate_pan_found_at_submit_time_falls_back_to_web_link(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das", "15-08-1990", "ABCDE1234F", "skip", "skip")
    db.add(AppSetting(key="member_registration_identity:pan:ABCDE1234F", value_json="{}"))
    db.commit()
    chat.say("1")
    assert "registration_role=member" in chat.last
    assert chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
    assert db.query(User).filter_by(role="member", name="Rahul Das").count() == 0


@pytest.mark.parametrize("keyword", ["WEB", "link", "ওয়েব"])
def test_web_optout_at_any_step_sends_tracked_registration_link(env, keyword):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das", keyword)
    assert "registration_role=member" in chat.last and "source=whatsapp" in chat.last and f"crm_lead_id={chat.lead.id}" in chat.last
    assert chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
    assert "answers" not in json.loads(chat.session.data_json)


def test_consent_no_falls_back_to_web_link(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "partner")
    chat.say("CHAT", "NO")
    assert "registration_role=partner" in chat.last and chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING


def test_ref_link_sponsor_is_prefilled_and_not_asked(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member", tags=["whatsapp_cloud", "ref:MAU10001"])
    chat.say("CHAT", "YES", "Rahul Das", "15-08-1990", "ABCDE1234F")
    assert "Sponsor" not in chat.last.split("•")[0]
    chat.say("skip")
    assert chat.session.state == WHATSAPP_NATIVE_REG_CONFIRM
    assert "MAU10001" in chat.last and "default" not in chat.last
    chat.say("1")
    user = db.query(User).filter_by(role="member", name="Rahul Das").one()
    assert db.query(UserReferral).filter_by(user_id=user.id).one().sponsor_user_id == "MAU10001"


def test_unresolvable_ref_sponsor_is_asked_instead(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member", tags=["whatsapp_cloud", "ref:NOPE9999"])
    chat.say("CHAT", "YES", "Rahul Das", "15-08-1990", "ABCDE1234F", "skip")
    assert "Referral/Sponsor ID" in chat.last
    chat.say("NOPE0000")
    assert "পাওয়া যায়নি" in chat.last


def test_back_and_restart_commands(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Wrong Name", "BACK")
    assert "পূর্ণ নাম" in chat.last
    chat.say("Rahul Das", "15-08-1990", "back")
    assert "জন্ম তারিখ" in chat.last
    chat.say("RESTART")
    assert "পূর্ণ নাম" in chat.last and chat.session.state == WHATSAPP_NATIVE_REG_MEMBER
    assert json.loads(chat.session.data_json)["answers"] == {}
    chat.say("BACK")
    assert "প্রথম ধাপ" in chat.last


def test_confirm_step_back_reopens_the_last_question_and_cancel_clears(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das", "15-08-1990", "ABCDE1234F", "skip", "skip")
    chat.say("back")
    assert "Sponsor" in chat.last and chat.session.state == WHATSAPP_NATIVE_REG_MEMBER
    chat.say("cancel")
    assert chat.session.state == "IDLE"


def test_media_during_flow_is_not_treated_as_an_answer(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "YES", "Rahul Das")
    chat.say("", message_type="image")
    assert "টেক্সট" in chat.last and "জন্ম তারিখ" in chat.last
    assert "[image]" not in json.dumps(json.loads(chat.session.data_json)["answers"])
    assert json.loads(chat.session.data_json)["nr"]["retries"] == 0


def test_existing_link_flow_is_unchanged_without_the_keyword(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("ok")
    assert chat.session.state == WHATSAPP_ROLE_REGISTRATION_PENDING
    assert "registration_role=member" in chat.last
