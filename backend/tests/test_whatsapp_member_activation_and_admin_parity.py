import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.models import AppSetting, CRMFollowUp, CRMLead, CRMLeadActivity, CRMTask, CRMWhatsAppAISuggestion, PartnerRequest, Product, ProductMeta, PublicOrder, User, UserReferral, WhatsAppMessageOutbox, WhatsAppRegistrationSession
from sql_app.routers.auth import register
from sql_app.routers.compat import _member_purchase_active, admin_approve_order, admin_partner_requests, admin_update_user
from sql_app.routers.partner_public import partner_register
from sql_app.routers.rider import admin_update_rider, rider_register
from sql_app.routers.whatsapp import update_whatsapp_settings
from sql_app.schemas import RegisterRequest, RiderRegisterRequest
from sql_app.whatsapp_cloud import DEFAULT_MEMBER_ACTIVATION_URL, ingest_whatsapp_message
from test_whatsapp_native_registration import PHONE, SENDER, Chat, env, make_session, payload  # noqa: F401

ADMIN = SimpleNamespace(role="super_admin", id="MAU00001")


def _member_with_lead(db, monkeypatch):
    result = register(RegisterRequest(name="Pending Member", email="", phone=PHONE, pan_no="ABCDE1234F", password="secret1"), None, db)
    member = db.query(User).filter(User.id == result["user"]["id"]).one()
    lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="Pending Member", phone=SENDER, whatsapp_no=SENDER, source="whatsapp", member_user_id=member.id)
    db.add(lead)
    db.flush()
    db.add(WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=lead.id, role="member", state="MEMBER_ACTIVATION_PENDING", data_json=json.dumps({"member_user_id": member.id, "member_code": member.id})))
    db.commit()
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda _db, recipient, text: sent.append(text) or True)
    return member, lead, sent


def _order(db, member, product_type, product_id="x"):
    order = PublicOrder(
        customer_user_id=member.id, payment_method="razorpay", payer_name="Member",
        items_json=json.dumps([{"product_id": product_id, "product_type": product_type, "quantity": 1, "subtotal": 105, "pre_tax": 100}]),
        total_amount=105, status="pending_approval",
    )
    db.add(order)
    db.commit()
    return order


def test_member_stays_activation_pending_until_a_metho_product_order_is_approved(env):
    db, monkeypatch = env
    member, lead, sent = _member_with_lead(db, monkeypatch)
    session = db.query(WhatsAppRegistrationSession).one()

    ingest_whatsapp_message(db, payload("Status"), None)
    assert session.state == "MEMBER_ACTIVATION_PENDING"
    assert "buy any one METHO product" in sent[-1] and DEFAULT_MEMBER_ACTIVATION_URL in sent[-1]
    assert _member_purchase_active(db, member.id) is False

    # An admin flag flip alone must not move the WhatsApp state without a qualifying purchase.
    member.is_active = True
    db.commit()
    ingest_whatsapp_message(db, payload("Status"), None)
    assert session.state == "MEMBER_ACTIVATION_PENDING"

    product = Product(name="Activation Product", category="General", price=100, stock=5)
    db.add(product)
    db.flush()
    db.add(ProductMeta(product_id=product.id, product_type="metho", gst_percent=5))
    order = _order(db, member, "metho", product.id)
    result = admin_approve_order(order.id, {}, db, ADMIN)
    assert result["member_purchase_activated"] is True
    assert _member_purchase_active(db, member.id) is True

    ingest_whatsapp_message(db, payload("Status"), None)
    assert session.state == "MEMBER_ONBOARDING"
    assert "buy any one METHO product" not in sent[-1]


def test_partner_product_order_does_not_activate_a_member(env):
    db, monkeypatch = env
    member, _, sent = _member_with_lead(db, monkeypatch)
    order = _order(db, member, "partner")
    try:
        result = admin_approve_order(order.id, {}, db, ADMIN)
    except Exception:
        db.rollback()
    else:
        assert result["member_purchase_activated"] is False
    assert _member_purchase_active(db, member.id) is False
    ingest_whatsapp_message(db, payload("Status"), None)
    assert db.query(WhatsAppRegistrationSession).one().state == "MEMBER_ACTIVATION_PENDING"


def test_native_registered_member_is_editable_by_admin_like_a_web_member(env):
    db, monkeypatch = env
    chat = Chat(db, monkeypatch, "member")
    chat.say("CHAT", "Rahul Das", "15-08-1990", "ABCDE1234F", "skip", "skip", "1")
    native = db.query(User).filter_by(role="member", name="Rahul Das").one()
    web = register(RegisterRequest(name="Web Member", email="", phone="9000000077", pan_no="BCDEF1234G", password="secret1", sponsor_code="MAU10001"), None, db)["user"]

    for user_id in (native.id, web["id"]):
        out = admin_update_user(user_id, {"sponsor_code": "MAU00001", "name": "Edited", "address": "New Address", "dob": "1991-01-01"}, db, ADMIN)
        assert out["sponsor_code"] == "MAU00001"
        assert db.query(UserReferral).filter_by(user_id=user_id).one().sponsor_user_id == "MAU00001"
        assert db.query(User).filter_by(id=user_id).one().name == "Edited"
    native_profile = json.loads(db.query(AppSetting).filter_by(key=f"user_profile:{native.id}").one().value_json)
    web_profile = json.loads(db.query(AppSetting).filter_by(key=f"user_profile:{web['id']}").one().value_json)
    assert set(native_profile) == set(web_profile)


def test_native_partner_request_has_the_same_shape_as_a_web_request_in_the_admin_list(env):
    db, monkeypatch = env
    web = partner_register({
        "login_id": "web.shop", "password": "secret1", "business_name": "Web Kirana Store", "business_type": "Shop", "shop_sector": "Grocery",
        "contact_person": "Owner", "phone": "9111111111", "whatsapp_no": "9111111111", "pan_no": "BCDEF1234G", "aadhaar_no": "123456789012",
        "address": "Road 1", "city": "Kolkata", "state": "West Bengal", "sponsor_code": "MAU10001",
    }, db)
    chat = Chat(db, monkeypatch, "partner")
    chat.say("CHAT", "1", "2", "skip", "Native Kirana Store", "skip", "Owner", "CDEFG1234H", "123456789012", "native.shop", "Road 2", "West Bengal", "skip", "Kolkata", "700001", "skip", "skip", "skip", "1")

    listed = {row["id"]: row for row in admin_partner_requests(None, db, ADMIN)}
    native_id = chat.lead.partner_request_id
    assert native_id in listed and web["request_id"] in listed
    assert set(listed[native_id]) == set(listed[web["request_id"]])
    keys = lambda request_id: set(json.loads(db.query(AppSetting).filter_by(key=f"partner_classification:request:{request_id}").one().value_json))
    assert keys(native_id) == keys(web["request_id"])
    assert db.query(PartnerRequest).filter_by(id=native_id).one().status == "pending"


def test_native_rider_is_editable_by_admin_like_a_web_rider(env):
    db, monkeypatch = env
    web = rider_register(RiderRegisterRequest(name="Web Rider", phone="9333333333", password="secret1", vehicle_type="ebike", whatsapp="9333333333", address="Road 1", pan_no="DEFGH1234J", aadhaar_no="123456789012", agreed_to_terms=True), db)["rider"]
    chat = Chat(db, monkeypatch, "rider")
    chat.say("CHAT", "Native Rider", "1", "skip", "skip", "Road 5", "Bihar", "skip", "Patna", "800001", "CDEFG1234H", "123456789012", "skip", "skip", "skip", "skip", "1")
    native = chat.lead.rider_user_id

    for rider_id in (native, web["id"]):
        out = admin_update_rider(rider_id, {"city": "Edited City", "vehicle_number": "WB-1"}, db, ADMIN)
        assert out["rider"]["city"] == "Edited City"
    keys = lambda rider_id: set(json.loads(db.query(AppSetting).filter_by(key=f"rider_profile:{rider_id}").one().value_json))
    assert keys(native) == keys(web["id"])


def test_handoff_sends_one_chat_only_message(env):
    db, monkeypatch = env
    update_whatsapp_settings({"phone_number_id": "123456", "access_token": "secret-token", "customer_call_number": "9339566110"}, db, SimpleNamespace(role="admin", id="ADMIN"))
    lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=SENDER, whatsapp_no=SENDER, source="whatsapp")
    db.add(lead)
    db.flush()
    db.add(WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=lead.id, role="member", state="ROLE_REGISTRATION_PENDING"))
    db.commit()

    for text in ("CHAT", "Rahul Das", "15-08-1990", "bad1", "bad2", "bad3"):
        ingest_whatsapp_message(db, payload(text), None, defer_outbound=True)

    last_inbound_outbox = db.query(WhatsAppMessageOutbox).filter(
        WhatsAppMessageOutbox.dedupe_key.like("whatsapp-inbound:%")
    ).order_by(WhatsAppMessageOutbox.created_at.desc()).limit(1).all()
    assert len(last_inbound_outbox) == 1
    assert "919339566110" in last_inbound_outbox[0].message and "কল করুন" in last_inbound_outbox[0].message
    assert "registration_role=" not in last_inbound_outbox[0].message
    assert "http" not in last_inbound_outbox[0].message


def test_handoff_pauses_automation_and_admin_can_resume_bot(env, monkeypatch):
    db, _ = env
    update_whatsapp_settings({
        "phone_number_id": "123456",
        "access_token": "secret-token",
        "executive_handoff_number": "9876543210",
        "executive_handoff_template_name": "executive_handoff",
        "executive_handoff_template_language": "en_US",
    }, db, ADMIN)
    lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=SENDER, whatsapp_no=SENDER, source="whatsapp")
    db.add(lead)
    db.flush()
    session = WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=lead.id, role="member", state="ROLE_REGISTRATION_PENDING")
    activity = CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [wamid.handoff]: I need help")
    followup = CRMFollowUp(lead_id=lead.id, status="Pending", notes="Automated follow-up")
    db.add_all([session, activity, followup])
    db.flush()
    suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=activity.id, suggested_reply="Automated reply")
    db.add(suggestion)
    db.add(WhatsAppMessageOutbox(dedupe_key="pending-auto-reply", recipient=SENDER, message="Automated reply", lead_id=lead.id, status="pending"))
    db.commit()
    monkeypatch.setattr("sql_app.whatsapp_cloud._send_member_registration_reply", lambda *_args, **_kwargs: True)

    from sql_app.routers.crm import list_whatsapp_conversations, resume_whatsapp_conversation_bot
    from sql_app.whatsapp_cloud import _request_whatsapp_human_handoff, get_whatsapp_handoff, is_whatsapp_handoff_active

    assert _request_whatsapp_human_handoff(db, lead, session, SENDER, reason="explicit_human_request", trigger_text="I need help")
    assert is_whatsapp_handoff_active(db, lead.id)
    assert get_whatsapp_handoff(db, lead.id)["reason"] == "explicit_human_request"
    assert followup.status == "Cancelled"
    assert lead.follow_up_status == "Completed"
    assert suggestion.status == "SUPERSEDED"
    assert db.query(WhatsAppMessageOutbox).filter_by(dedupe_key="pending-auto-reply").first() is None
    assert db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count() == 1
    assert db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == "WhatsApp human support requested").count() == 1

    from fastapi import HTTPException
    from sql_app.routers.whatsapp_ai import approve_suggestion
    active_activity = CRMLeadActivity(lead_id=lead.id, activity_type="whatsapp_message_received", message="WhatsApp message received [wamid.ai]: Hello")
    db.add(active_activity)
    db.flush()
    active_suggestion = CRMWhatsAppAISuggestion(lead_id=lead.id, activity_id=active_activity.id, suggested_reply="AI reply")
    db.add(active_suggestion)
    db.commit()
    with pytest.raises(HTTPException) as blocked_ai_approval:
        approve_suggestion(active_suggestion.id, {"reply": "AI reply"}, db, ADMIN)
    assert blocked_ai_approval.value.status_code == 409

    ingest_whatsapp_message(db, payload("Still there?"), None, defer_outbound=True)
    inbox = list_whatsapp_conversations("", db, ADMIN, needs_human_only=True)
    assert len(inbox["items"]) == 1 and inbox["items"][0]["needs_human"] is True
    assert db.query(WhatsAppMessageOutbox).filter(WhatsAppMessageOutbox.dedupe_key.like("whatsapp-inbound:%")).count() == 0
    assert db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count() == 1

    assert resume_whatsapp_conversation_bot(lead.id, db, ADMIN)["resumed"] is True
    assert not is_whatsapp_handoff_active(db, lead.id)
    assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="whatsapp_handoff_resumed").count() == 1
    assert _request_whatsapp_human_handoff(db, lead, session, SENDER, reason="explicit_human_request", trigger_text="I still need help")
    notifications = db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").all()
    assert len(notifications) == 2
    assert len({row.dedupe_key for row in notifications}) == 2
    assert db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == "WhatsApp human support requested").count() == 1


def test_active_handoff_answers_new_question_without_new_task_or_notification(env, monkeypatch):
    db, _ = env
    update_whatsapp_settings({
        "phone_number_id": "123456",
        "access_token": "secret-token",
        "executive_handoff_number": "9876543210",
        "executive_handoff_template_name": "executive_handoff",
        "executive_handoff_template_language": "en_US",
        "customer_call_number": "9339566110",
    }, db, ADMIN)
    lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=SENDER, whatsapp_no=SENDER, source="whatsapp")
    db.add(lead)
    db.flush()
    session = WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=lead.id, role="member", state="ROLE_REGISTRATION_PENDING")
    db.add(session)
    db.commit()
    sent = []
    from sql_app.whatsapp_cloud import INBOUND_WHATSAPP_OUTBOX_CONTEXT, _request_whatsapp_human_handoff, send_whatsapp_message
    def fake_send(_db, recipient, text):
        if _db.info.get(INBOUND_WHATSAPP_OUTBOX_CONTEXT):
            return send_whatsapp_message(_db, recipient, text=text)
        sent.append(text)
        return {"messages": [{"id": f"wamid.reply-{len(sent)}"}]}
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", fake_send)
    monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_args, **_kwargs: ("Verified answer", "gemini", "test-model"))

    assert _request_whatsapp_human_handoff(db, lead, session, SENDER, reason="explicit_human_request", trigger_text="human chai")
    notification_count = db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count()
    task_count = db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == "WhatsApp human support requested").count()
    assert notification_count == 1
    assert "919339566110" in sent[-1] and "কল করুন" in sent[-1]

    assert ingest_whatsapp_message(db, payload("What is a Member?"), None, defer_outbound=True) == "updated"
    bot_reply = db.query(WhatsAppMessageOutbox).filter_by(activity_type="whatsapp_handoff_bot_reply").one()
    assert bot_reply.message == "Verified answer" and bot_reply.status == "pending"
    assert db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count() == notification_count
    assert db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == "WhatsApp human support requested").count() == task_count == 1


def test_customer_call_and_task_work_without_executive_whatsapp_settings(env, monkeypatch):
    db, _ = env
    update_whatsapp_settings({
        "phone_number_id": "123456",
        "access_token": "secret-token",
        "customer_call_number": "9339566110",
    }, db, ADMIN)
    if not db.query(User).filter_by(id=ADMIN.id).first():
        db.add(User(id=ADMIN.id, name="Admin", email="admin@example.com", phone="9000000000", password="hashed", role="super_admin", is_active=True))
    lead = CRMLead(lead_id=f"WA-{SENDER}", business_name="WhatsApp", contact_person="WhatsApp Lead", phone=SENDER, whatsapp_no=SENDER, source="whatsapp")
    db.add(lead)
    db.flush()
    session = WhatsAppRegistrationSession(phone=SENDER, wa_id=SENDER, lead_id=lead.id, role="member", state="ROLE_REGISTRATION_PENDING")
    db.add(session)
    db.commit()
    sent = []
    monkeypatch.setattr("sql_app.whatsapp_cloud.send_whatsapp_message", lambda _db, recipient, text: sent.append(text) or {"messages": [{"id": "wamid.no-exec"}]})

    from sql_app.whatsapp_cloud import _request_whatsapp_human_handoff

    assert _request_whatsapp_human_handoff(db, lead, session, SENDER, reason="explicit_human_request", trigger_text="human chai")
    assert "919339566110" in sent[-1]
    assert db.query(CRMTask).filter(CRMTask.lead_id == lead.id, CRMTask.title == "WhatsApp human support requested").count() == 1
    assert db.query(WhatsAppMessageOutbox).filter_by(activity_type="executive_handoff_notification").count() == 0
    assert db.query(CRMLeadActivity).filter_by(lead_id=lead.id, activity_type="executive_handoff_notification_failed").count() == 1
