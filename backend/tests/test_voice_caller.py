import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, CRMLead, CRMVoiceCallAttempt, User
from sql_app.voice_caller import CALL_PURPOSES, conversation_start_prompt, create_voice_campaign, language_for, qualification_questions_for, queue_campaign_call, registration_link_for, registration_type_for, resolve_call_target, queue_voice_call, receive_voice_call_result


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def make_lead(db):
    lead = CRMLead(business_name="Voice Lead", contact_person="Ayesha", phone="919999999999", source="facebook")
    db.add(lead)
    db.commit()
    return lead


def test_voice_call_queue_is_idempotent():
    db = make_session()
    try:
        lead = make_lead(db)
        first, created = queue_voice_call(db, lead)
        second, second_created = queue_voice_call(db, lead)
        assert created is True
        assert second_created is False
        assert second.id == first.id
        assert db.query(CRMVoiceCallAttempt).count() == 1
    finally:
        db.close()


def test_registration_type_and_link_selection():
    assert registration_type_for("member") == "MEMBER"
    assert registration_type_for("PARTNER") == "PARTNER"
    assert registration_type_for("rider") == "RIDER"
    assert registration_type_for("unknown") == "OTHER"
    assert registration_link_for("MEMBER") == "/register"
    assert registration_link_for("PARTNER") == "/partner-register"
    assert registration_link_for("RIDER") == "/rider-register"
    assert registration_link_for("OTHER") is None


def test_bengali_language_selection_and_qualification_questions():
    assert language_for("বাংলা") == "bn"
    assert "বাংলা" in conversation_start_prompt()
    assert len(qualification_questions_for("bn")) == 2


def test_hindi_language_selection_and_qualification_questions():
    assert language_for("हिंदी") == "hi"
    assert "हिंदी" in conversation_start_prompt()
    assert len(qualification_questions_for("hi")) == 2


def test_voice_call_callback_records_qualification_and_sanitizes_sensitive_values():
    db = make_session()
    try:
        lead = make_lead(db)
        call, _ = queue_voice_call(db, lead)
        result = receive_voice_call_result(db, call.provider_call_id, {"status": "QUALIFIED", "language": "bn", "registration_type": "PARTNER", "qualification_result": {"interested": True, "pan_no": "do-not-store"}, "duration_seconds": 45})
        assert result.status == "QUALIFIED"
        assert result.registration_type == "PARTNER"
        assert result.language == "bn"
        assert "pan_no" not in result.qualification_result_json
        assert result.duration_seconds == 45
        assert db.query(CRMLead).filter(CRMLead.id == lead.id).one().status == "QUALIFIED"
    finally:
        db.close()


def test_language_switch_preserves_qualification_context_and_classification():
    db = make_session()
    try:
        lead = make_lead(db)
        call, _ = queue_voice_call(db, lead)
        result = receive_voice_call_result(db, call.provider_call_id, {"status": "CONFIRMED", "language": "hi", "language_switches": ["বাংলা", "हिंदी"], "registration_type": "RIDER", "qualification_result": {"interested": True}})
        assert result.language == "hi"
        assert result.registration_type == "RIDER"
        assert '"language_switches": ["bn", "hi"]' in result.qualification_result_json
        assert registration_link_for(result.registration_type) == "/rider-register"
    finally:
        db.close()


def test_failed_and_no_answer_calls_can_be_retried():
    db = make_session()
    try:
        lead = make_lead(db)
        failed, _ = queue_voice_call(db, lead)
        receive_voice_call_result(db, failed.provider_call_id, {"status": "FAILED", "error_code": "network", "error_message": "request failed"})
        retry, created = queue_voice_call(db, lead, retry=True)
        assert created is True
        receive_voice_call_result(db, retry.provider_call_id, {"status": "NO_ANSWER", "outcome": "No answer"})
        final_retry, final_created = queue_voice_call(db, lead, retry=True)
        assert final_created is True
        assert final_retry.id != retry.id
    finally:
        db.close()


def test_campaign_resolves_lead_member_partner_and_rider_targets():
    db = make_session()
    try:
        lead = make_lead(db)
        member = User(name="Member", email="member@example.com", phone="919999999991", password="x", role="member")
        rider = User(name="Rider", email="rider@example.com", phone="919999999992", password="x", role="rider")
        partner = AssociatePartner(partner_code="MTH-PARTNER-999", business_name="Partner", phone="919999999993", email="partner@example.com")
        db.add_all([member, rider, partner])
        db.commit()
        assert resolve_call_target(db, "LEAD", lead.id).target_type == "LEAD"
        assert resolve_call_target(db, "MEMBER", member.id).target_type == "MEMBER"
        assert resolve_call_target(db, "PARTNER", partner.id).target_type == "PARTNER"
        assert resolve_call_target(db, "RIDER", rider.id).target_type == "RIDER"
    finally:
        db.close()


def test_enabled_campaign_enforces_purpose_attempts_and_language_support():
    db = make_session()
    try:
        lead = make_lead(db)
        campaign = create_voice_campaign(db, {"name": "Lead qualification", "enabled": True, "target_type": "LEAD", "call_purpose": "NEW_LEAD_QUALIFICATION", "max_attempts": 2, "supported_languages": ["বাংলা", "हिंदी"]})
        assert campaign.call_purpose in CALL_PURPOSES
        first, created = queue_campaign_call(db, campaign, resolve_call_target(db, "LEAD", lead.id))
        assert created is True
        duplicate, duplicate_created = queue_campaign_call(db, campaign, resolve_call_target(db, "LEAD", lead.id))
        assert duplicate_created is False
        assert duplicate.id == first.id
        receive_voice_call_result(db, first.provider_call_id, {"status": "NO_ANSWER", "language": "bn"})
        second, second_created = queue_campaign_call(db, campaign, resolve_call_target(db, "LEAD", lead.id))
        assert second_created is True
        assert second.call_purpose == "NEW_LEAD_QUALIFICATION"
        receive_voice_call_result(db, second.provider_call_id, {"status": "NO_ANSWER", "language": "hi"})
        final, final_created = queue_campaign_call(db, campaign, resolve_call_target(db, "LEAD", lead.id))
        assert final_created is False
        assert final.id == second.id
    finally:
        db.close()


def test_disabled_campaign_does_not_queue_calls():
    db = make_session()
    try:
        lead = make_lead(db)
        campaign = create_voice_campaign(db, {"name": "Disabled campaign", "enabled": False, "target_type": "LEAD", "call_purpose": "FOLLOW_UP"})
        try:
            queue_campaign_call(db, campaign, resolve_call_target(db, "LEAD", lead.id))
            assert False, "disabled campaign should be rejected"
        except ValueError as exc:
            assert "disabled" in str(exc)
    finally:
        db.close()


def test_campaign_accepts_each_supported_call_purpose():
    db = make_session()
    try:
        for index, purpose in enumerate(CALL_PURPOSES):
            campaign = create_voice_campaign(db, {"name": f"Campaign {index}", "target_type": "LEAD", "call_purpose": purpose})
            assert campaign.call_purpose == purpose
    finally:
        db.close()