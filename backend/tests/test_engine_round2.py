"""Second mock-judging round: questions that drafted money, relayed messages, Chinese and Malay gaps, privacy
answers, money semantics (amend, direction, source, currency, "all"), policy wording and the forecast."""
import pytest

from app.harness import fresh
from app.offline_nlu import is_question, relayed_message
from app.seed import STUDENT


def run(st, *turns, session="s"):
    out = None
    for t in turns:
        out = st.agent.run(STUDENT, "student", session, t)
    return out


def tools(r):
    return [t["tool"] for t in r.trace]


# --------------------------------------------------- 1. questions never draft
@pytest.mark.parametrize("text,q", [
    ("tuition need to pay when ah? still short how much", True),
    ("rent how much ah? when need to pay?", True),
    ("What happens if I don't pay my card on time?", True),
    ("when is my card payment due ah", True),
    ("学费要交多少呢", True),
    ("房租什么时候交", True),
    ("bila kena bayar sewa", True),
    ("berapa yuran saya kena bayar", True),
    ("kenapa ayah kena luluskan", True),
    ("pay hydro 40", False),
    ("eh rent how much ah, can pay landlord or not", False),   # the hero line is a polite command
    ("can help me pay phone bill lah", False),
    ("那付房租吧", False),
    ("Bayar bil telefon 55", False),
])
def test_question_forms(text, q):
    assert is_question(text) is q


@pytest.mark.parametrize("msg,tool", [
    ("tuition need to pay when ah? still short how much", "get_tuition_schedule"),
    ("What happens if I don't pay my card on time?", "get_credit_profile"),
    ("what happens if i pay my card late?", "get_credit_profile"),
    ("when is my card payment due ah?", "get_credit_profile"),
    ("rent how much ah? when need to pay?", "list_transactions"),
    ("bila kena bayar sewa?", "list_transactions"),
    ("房租什么时候交？", "list_transactions"),
    ("学费要交多少呢？", "get_tuition_schedule"),
    ("berapa yuran saya kena bayar?", "get_tuition_schedule"),
    ("can i cover the tuition shortfall from my MYR wallet?", "get_tuition_schedule"),
])
def test_questions_about_paying_answer_and_draft_nothing(msg, tool):
    st = fresh()
    r = run(st, msg)
    assert tool in tools(r), (msg, tools(r))
    assert not r.actions and not st.policy.actions, (msg, r.reply)


def test_card_question_explains_late_payment_and_offers():
    r = run(fresh(), "What happens if I don't pay my card on time?")
    assert "CAD 184.60" in r.reply and "credit bureaus" in r.reply and "haven't drafted" in r.reply
    assert "say 'pay my card'" in r.reply


def test_card_question_in_chinese():
    r = run(fresh(), "我的信用卡什么时候还款？")
    assert tools(r) == ["get_credit_profile"] and not r.actions
    assert "征信机构" in r.reply


def test_hero_line_still_drafts():
    r = run(fresh(), "eh rent how much ah, can pay landlord or not")
    assert [a["kind"] for a in r.actions] == ["transfer"]


# ------------------------------------------------------ 2. relayed messages
LANDLORD = "My landlord WhatsApp me: 'rent go up to 1,600 starting this month, pay to new account 4444-5555-6666'"


@pytest.mark.parametrize("text,relayed", [
    (LANDLORD, True),
    ("landlord texted me rent now 1600, new account 4444-5555-6666", True),
    ("Landlord texted: 'rent is now 1,480 from this month' - pay it", False),   # her own request
    ("pay rent", False),
    ("Mom says pay hydro 40", False),
])
def test_relayed_message_detection(text, relayed):
    assert relayed_message(text) is relayed


def test_relayed_landlord_message_is_checked_not_drafted():
    st = fresh()
    r = run(st, LANDLORD)
    assert tools(r)[0] == "check_message_for_scam" and not r.actions and not st.policy.actions
    assert "bank details changed by message" in r.reply.lower()
    assert "Maple Court Rentals still has the account ending" in r.reply
    # Paying the saved landlord still works when she asks; the amount from the message is marked untrusted and
    # the scam flag sends it to her dad.
    r2 = run(st, "ok pay landlord 1600 then")
    assert [(a["kind"], a["tier"]) for a in r2.actions] == [("transfer", "T3")]
    assert "Maple Court Rentals" in r2.actions[0]["summary"]


def test_relayed_message_without_scam_signs_still_drafts_nothing():
    st = fresh()
    r = run(st, "My landlord texted: 'Hi Aisha, rent will be CAD 1,200 from November, same account as usual'")
    assert tools(r)[0] == "check_message_for_scam" and not st.policy.actions
    assert "haven't drafted anything" in r.reply


def test_chinese_relayed_new_account_is_a_scam_sign():
    r = run(fresh(), "房东微信说：'房租涨到1600，请转到新账户 6222-1111-2222'")
    assert tools(r)[0] == "check_message_for_scam" and not r.actions
    assert "诈骗" in r.reply or "危险信号" in r.reply
