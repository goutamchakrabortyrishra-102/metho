import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.whatsapp_cloud import _generate_welcome_message
from sql_app.whatsapp_ai import DEFAULT_CONFIG


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


WELCOME_EXPECTATIONS = {
    "bn": {
        "question": "আপনি Member, Partner নাকি Rider হিসেবে যুক্ত হতে চান? নিজের কথায় লিখে জানান।",
        "company": "METHO LOGISTICS PRIVATE LIMITED",
        "revenue": "পণ্য বিক্রি ও ডেলিভারি/সার্ভিস",
        "member": "পণ্য কিনে ID চালু",
        "member_activation": "যেকোনো একটি METHO পণ্য কিনে অর্ডার যাচাই ও অনুমোদিত হলে ID Active হয়",
        "member_terms": "প্ল্যানের শর্তে কমিশন ও রিওয়ার্ড",
        "referral": "ম্যাচিং বোনাস ও Leader Reward",
        "partner": "ফ্রি প্রচার",
        "rider": "প্রতিটি ডেলিভারি বা ফিল্ড-সার্ভিস অর্ডারে সরাসরি আয়ের সুযোগ",
        "registration": "রেজিস্ট্রেশন চ্যাটেই, মাত্র ২-৩ মিনিট",
        "plan_terms": "প্ল্যানের বিস্তারিত ও শর্ত রেজিস্ট্রেশনের সময় জানানো হবে",
        "greeting": "নমস্কার! METHO AAY-UPAY-এ স্বাগতম।",
    },
    "en": {
        "question": "Would you like to join as a Member, Partner, or Rider? Please tell me in your own words.",
        "company": "METHO LOGISTICS PRIVATE LIMITED",
        "revenue": "product sales and delivery/services",
        "member": "Buy METHO products to activate your ID",
        "member_activation": "buy any one METHO product, and the ID becomes active after the order is verified and approved",
        "member_terms": "plan-based commissions and rewards may be available",
        "referral": "matching bonuses and Leader Rewards",
        "partner": "free promotion",
        "rider": "opportunity to earn directly per delivery or field-service order",
        "registration": "Register in this chat in about 2–3 minutes",
        "plan_terms": "plan details and terms are shared during registration",
        "greeting": "Hello! Welcome to METHO AAY-UPAY.",
    },
    "hi": {
        "question": "आप Member, Partner या Rider के रूप में जुड़ना चाहेंगे? अपने शब्दों में बताइए।",
        "company": "METHO LOGISTICS PRIVATE LIMITED",
        "revenue": "उत्पाद बिक्री और डिलीवरी/सेवाओं",
        "member": "METHO उत्पाद खरीदकर ID चालू करें",
        "member_activation": "कोई भी एक METHO उत्पाद खरीदें, ऑर्डर सत्यापित और स्वीकृत होने के बाद ID सक्रिय होगी",
        "member_terms": "योजना की शर्तों के अनुसार कमीशन और रिवॉर्ड मिल सकते हैं",
        "referral": "मैचिंग बोनस व Leader Reward",
        "partner": "मुफ्त प्रचार",
        "rider": "हर डिलीवरी या फील्ड-सर्विस ऑर्डर पर सीधे कमाई का अवसर",
        "registration": "रजिस्ट्रेशन इसी चैट में लगभग 2–3 मिनट में करें",
        "plan_terms": "योजना का विवरण और शर्तें रजिस्ट्रेशन के समय बताई जाएंगी",
        "greeting": "नमस्कार! METHO AAY-UPAY में आपका स्वागत है।",
    },
}


def assert_welcome_contract(reply, language):
    expected = WELCOME_EXPECTATIONS[language]
    lines = reply.splitlines()
    assert len(lines) == 8
    assert lines[0] == expected["greeting"]
    assert lines[-1] == expected["question"]
    assert reply.count(expected["question"]) == 1
    for key in ("company", "revenue", "member", "member_activation", "member_terms", "referral", "partner", "rider", "registration", "plan_terms"):
        assert expected[key] in reply
    prohibited = (
        "mlm", "pyramid", "fraud", "scam", "binary", "বাইনারি", "পিরামিড", "ফ্রড",
        "no purchase is needed", "purchase is not required", "নিবন্ধনে কোনো বিনিয়োগ লাগে না", "खरीदारी की जरूरत नहीं",
        "team build", "build a team", "টিম গড়ুন", "টিম গড়ুন", "গ্যারান্টিযুক্ত",
        "guaranteed", "নিশ্চিত আয়", "নিশ্চিত আয়",
    )
    assert not any(term in reply.casefold() for term in prohibited)
    assert not any(line.lstrip().startswith(tuple("123")) for line in lines)
    assert "1. Member" not in reply and "1 for Member" not in reply


@pytest.mark.parametrize("language", ["bn", "en", "hi"])
def test_welcome_fallback_contains_all_roles_terms_and_one_open_question(monkeypatch, language):
    db = make_session()
    try:
        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", lambda *_a, **_k: ("", "fallback", "local"))
        reply = _generate_welcome_message(db, None, "911234567890", language=language)
        assert_welcome_contract(reply, language)
    finally:
        db.close()


@pytest.mark.parametrize("language", ["bn", "en", "hi"])
def test_welcome_discards_ai_menu_and_prohibited_claims(monkeypatch, language):
    db = make_session()
    try:
        ai_reply = f"{WELCOME_EXPECTATIONS[language]['greeting']}\nMETHO is not MLM or a pyramid scheme; no investment is needed.\nBuild a team for guaranteed income.\nWould you like to join as a Member, Partner, or Rider?\n1 for Member\n1. Member\n2 for Partner\n2. Partner\n3 for Rider\n3. Rider"
        prompts = []

        def generate_reply(_config, prompt, *_args, **_kwargs):
            prompts.append(prompt)
            return ai_reply, "gemini", "gemini-1.5-flash"

        monkeypatch.setattr("sql_app.whatsapp_ai._generate_reply", generate_reply)
        reply = _generate_welcome_message(db, None, "911234567890", language=language)
        assert_welcome_contract(reply, language)
        assert len(prompts) == 1
        assert "product sales and delivery/services" in prompts[0]
        assert "plan-conditional commissions/rewards" in prompts[0]
        assert "free promotion" in prompts[0]
        assert "per delivery/field-service order" in prompts[0]
        assert "one open-ended question" in prompts[0]
    finally:
        db.close()


def test_ai_prompts_preserve_welcome_facts_and_forbid_unsupported_claims():
    prompt = DEFAULT_CONFIG["system_prompt"].casefold()
    assert "conditional opportunity" in prompt
    assert "specific earning amounts" in prompt
    assert "never generate a numbered role menu" in prompt
    assert "never let a conversation dead-end" not in prompt
