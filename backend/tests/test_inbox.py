"""Smart inbox (inbox.py, inbox_api.py): every incoming message is triaged on arrival, the agent takes only safe
actions on its own, and nothing moves money without the existing confirm and mandate rules."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import inbox
from app.harness import TODAY, fresh
from app.main import create_app
from app.seed import SPONSOR, STUDENT

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
OP = {"X-Operator": "demo-operator"}


@pytest.fixture()
def st():
    return fresh()


@pytest.fixture()
def client(st):
    return TestClient(create_app(st))


def deliver(st, sample=None, sender="", channel="sms", text=""):
    if sample:
        msg = inbox.render_sample(sample, st.bank, STUDENT, st.agent.today)
        return inbox.receive(st, STUDENT, msg["sender"], msg["channel"], msg["text"], sample=sample)
    return inbox.receive(st, STUDENT, sender, channel, text)


def balances(st):
    return {r["id"]: r["balance"] for r in st.bank.db.execute("SELECT id, balance FROM accounts")}


def names(m):
    return [s["name"] for s in m["signals"]]


def i18n_signals(m, lang):
    from app import i18n
    return [i18n.signal(n, lang) for n in names(m)]


# ------------------------------------------------------------------ triage of every sample
@pytest.mark.parametrize("sample,verdict,sign", [
    ("scam_cra_giftcards", "scam", "Asks for gift cards"),
    ("scam_parcel_police_zh", "scam", "'Safe account' police scam"),
    ("scam_landlord_new_account", "scam", "Account number differs from your saved payee"),
    ("job_scam_fee", "scam", "Job that asks you to pay first"),
    ("bill_bchydro", "bill", None),
    ("bill_northline", "bill", None),
    ("tuition_reminder_ubc", "info", None),
    ("dad_whatsapp_ms", "personal", None),
])
def test_each_sample_is_triaged_on_arrival(st, sample, verdict, sign):
    m = deliver(st, sample)
    assert m["verdict"] == verdict
    if sign:
        assert sign in names(m) and m["confidence"] == "high"
        assert m["actions"] == ["lock", "dismiss"]
        assert m["headline"]["en"].startswith("Likely scam") and "不要付款" in m["headline"]["zh"]
        assert any("Don't pay" in a["en"] for a in m["advice"]) and any("验证码" in a["zh"] for a in m["advice"])
    else:
        assert not [s for s in m["signals"] if s["category"] in ("scam", "injection", "inbox")]
    assert not st.policy.actions          # nothing is ever drafted on arrival


def test_samples_follow_the_sandbox_calendar(st):
    assert "due Oct 30" in inbox.render_sample("bill_bchydro", st.bank, STUDENT, TODAY)["text"]
    tu = inbox.render_sample("tuition_reminder_ubc", st.bank, STUDENT, TODAY)["text"]
    assert "Winter Term 2, installment 1" in tu and "7,250.00" in tu and "Jan 6" in tu
    with pytest.raises(inbox.InboxError):
        inbox.render_sample("nope", st.bank, STUDENT, TODAY)


@pytest.mark.parametrize("sender,channel,text,verdict", [
    ("BC Hydro", "sms", "BC Hydro：您的电费账单 $62.15 将于10月30日到期。账户尾号 9988。请通过网上银行或 bchydro.com 缴费。", "bill"),
    ("爸爸", "whatsapp", "宝贝，吃饭了吗？这个月的生活费已经转给你了，记得查收。周末给妈妈打个电话。", "personal"),
    ("UBC", "email", "【UBC学生财务处】提醒：冬季第2学期第1期学费 CAD 7,250.00 将于1月6日到期，请在截止日前缴费。", "info"),
    ("+86 10 5555 0101", "sms", "我是大使馆工作人员，你涉嫌洗钱，必须把钱转到安全账户配合调查，不要告诉家人。", "scam"),
])
def test_chinese_messages(st, sender, channel, text, verdict):
    m = deliver(st, sender=sender, channel=channel, text=text)
    assert m["verdict"] == verdict
    if verdict == "bill":
        assert (m["bill"]["payee_id"], m["bill"]["amount"], m["bill"]["due"]) == ("py_hydro", 62.15, "2026-10-30")
        assert m["account_match"] is True
    if verdict == "info":
        assert m["topic"] == "tuition" and m["actions"] == ["tuition", "dismiss"]
    if verdict == "scam":
        assert "“安全账户”冒充警方诈骗" in [inbox.i18n.signal(n, "zh") for n in names(m)]


# ------------------------------------------------------------------ bills
def test_bill_extraction_matches_the_saved_payee(st):
    m = deliver(st, "bill_bchydro")
    b = m["bill"]
    assert (b["payee_id"], b["payee_name"], b["amount"], b["currency"], b["due"]) == \
        ("py_hydro", "BC Hydro", 62.15, "CAD", "2026-10-30")
    assert b["saved_last4"] == "9988" and m["account_match"] is True and b["source"] == "rules"
    assert b["usual"] == 41.20 and m["actions"] == ["draft", "dismiss"]
    assert "Bill from BC Hydro: CAD 62.15, due Oct 30." == m["headline"]["en"]
    assert any("41.20" in a["en"] for a in m["advice"])          # "you usually pay about CAD 41.20"
    n = deliver(st, "bill_northline")["bill"]
    assert (n["payee_id"], n["amount"], n["due"]) == ("py_phone", 55.0, "2026-10-28")


def test_a_bill_naming_another_account_is_a_scam(st):
    m = deliver(st, sender="BC Hydro", channel="email",
                text="BC Hydro: your bill of $62.15 is due Oct 30. Account ending 1234. Pay at bchydro.com.")
    assert m["verdict"] == "scam" and m["account_match"] is False
    assert "Account number differs from your saved payee" in names(m)
    assert m["claims_payee"]["saved_last4"] == "9988" and m["claims_payee"]["message_last4"] == "1234"


def test_draft_only_when_she_taps_and_always_to_the_saved_payee(st, client):
    m = deliver(st, "bill_bchydro")
    before = balances(st)
    assert not st.policy.actions
    r = client.post(f"/inbox/{m['id']}/draft", headers=S)
    assert r.status_code == 200
    a = r.json()["action"]
    assert (a["kind"], a["tier"], a["status"]) == ("transfer", "T2", "awaiting_user")
    assert a["params"]["payee_id"] == "py_hydro" and a["params"]["amount"] == 62.15
    assert a["provenance"] == {"amount": "inbox", "payee": "saved"} and a["confirm_token"]
    assert any("bill message in the inbox" in x for x in a["risk_reasons"])
    assert balances(st) == before                                 # still only a draft: she confirms it
    assert r.json()["message"]["draft_action_id"] == a["action_id"]
    again = client.post(f"/inbox/{m['id']}/draft", headers=S).json()["action"]
    assert again["action_id"] == a["action_id"] and len(st.policy.actions) == 1
    ok = client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S).json()
    assert ok["status"] == "executed"


def test_no_draft_from_a_scam_or_a_personal_message(st, client):
    for sample in ("scam_landlord_new_account", "dad_whatsapp_ms", "tuition_reminder_ubc"):
        m = deliver(st, sample)
        assert client.post(f"/inbox/{m['id']}/draft", headers=S).status_code == 400
    assert not st.policy.actions


def test_autopay_mandate_handles_the_bill_under_its_own_rules(st, client):
    ap = st.policy.autopilot
    mandate, _ = ap.propose(STUDENT, "bill_autopay", {"payee": "BC Hydro", "amount": 100})
    ap.activate(mandate["id"], "student", STUDENT)
    m = deliver(st, "bill_bchydro")
    assert m["actions"] == ["autopay", "dismiss"] and m["autopay"]["mandate_id"] == mandate["id"]
    assert "never an amount read from a message" in m["advice"][0]["en"]
    assert client.post(f"/inbox/{m['id']}/draft", headers=S).status_code == 400
    # The autopilot ran, but the saved schedule's bill is not due yet: it did nothing, and nothing for CAD 62.15.
    assert not [a for a in st.policy.actions.values() if a.params.get("amount") == 62.15]


# ------------------------------------------------------------------ near misses and misses from the final review
@pytest.mark.parametrize("sender,text", [
    ("BC Hydro", "Payment received $62.15, thank you"),
    ("BC Hydro <ebill@bchydro.com>", "BC Hydro: Payment received. Thank you! We received your payment of $62.15 on Oct 5."),
    ("Uber", "Your Uber receipt: $12.40 charged to card ending 4421. Thanks for riding."),
])
def test_a_payment_receipt_is_info_not_a_bill(st, sender, text):
    m = deliver(st, sender=sender, channel="email", text=text)
    assert (m["verdict"], m["topic"]) == ("info", "receipt") and "draft" not in m["actions"]
    assert m["headline"]["en"] == "Payment confirmation: nothing to pay." and "无需再付款" in m["headline"]["zh"]
    # A bill that is still due is a bill, even if it mentions an earlier payment.
    due = deliver(st, sender="BC Hydro", channel="email",
                  text="BC Hydro: thank you for your payment. Your next bill of $58.10 is due Nov 20.")
    assert due["verdict"] == "bill" and "draft" in due["actions"]


@pytest.mark.parametrize("text", [
    "INTERAC e-Transfer: Priya Sharma sent you $20.00 (CAD). Deposit it in your bank.",
    "INTERAC e-Transfer: Priya Sharma sent you $20.00 (CAD). To deposit, go to etransfer.interac.ca",
])
def test_an_interac_deposit_notice_is_info_not_a_scam(st, text):
    m = deliver(st, sender="Interac", channel="email", text=text)
    assert (m["verdict"], m["topic"]) == ("info", "incoming") and not m["alerted"]
    assert m["actions"] == ["dismiss"] and m["headline"]["en"].startswith("Money coming in")


def test_a_deposit_notice_with_a_lookalike_link_or_an_ask_is_still_a_scam(st):
    m = deliver(st, sender="Interac", text="INTERAC e-Transfer: You received $250.00. Deposit now at interac-etransfer-deposit.com")
    assert m["verdict"] == "scam" and "Link to a lookalike website" in names(m)
    m = deliver(st, sender="+1 236 555 0101", text="You received $250.00 by e-Transfer. Enter your card PIN to accept it.")
    assert m["topic"] != "incoming"                                   # it asks for something: not a plain deposit


@pytest.mark.parametrize("text", [
    "CRA: you have a refund of $482.19, claim at cra-refund-canada.com",
    "CRA: You have a tax refund of $487.20 pending. Accept via Interac at cra-refund-ca.com",
])
def test_cra_refund_smishing_with_a_lookalike_link_is_a_scam(st, text):
    m = deliver(st, sender="CRA", text=text)
    assert m["verdict"] == "scam" and m["confidence"] == "high"
    assert "Link to a lookalike website" in names(m) and "Refund offered through a link" in names(m)
    assert m["topic"] == "link" and "direct deposit" in m["advice"][1]["en"]
    assert "仿冒网站" in "".join(i18n_signals(m, "zh"))
    assert m["alerted"]                                               # it is after her bank details


def test_official_links_are_not_lookalikes(st):
    m = deliver(st, sender="CRA", text="Your notice of assessment is ready. Sign in to My Account at canada.ca to view it.")
    assert m["verdict"] != "scam"
    m = deliver(st, sender="UBC", text="Your Winter term fees statement is ready at ssc.students.ubc.ca")
    assert "Link to a lookalike website" not in names(m)


@pytest.mark.parametrize("text", ["UBC Library: book due Oct 20",
                                  "UBC Library: 2 library books are due Oct 20. Fines apply after the due date."])
def test_ubc_library_is_not_a_tuition_reminder(st, text):
    m = deliver(st, sender="UBC Library", channel="email", text=text)
    assert m["topic"] != "tuition" and "tuition" not in m["actions"] and not m.get("tuition")
    assert deliver(st, "tuition_reminder_ubc")["topic"] == "tuition"   # the real reminder still is


def test_a_small_parcel_fee_scam_stays_a_scam_but_does_not_page_the_sponsor(st):
    m = deliver(st, sender="Canada Post",
                text="Canada Post: your parcel is on hold. Pay $1.99 redelivery fee at cpost-redeliver.co within 24 hours")
    assert m["verdict"] == "scam" and m["actions"] == ["lock", "dismiss"] and not m["alerted"]
    assert m["topic"] == "lookalike" and "official" in m["advice"][1]["en"]
    big = deliver(st, sender="Canada Post",
                  text="Canada Post: your parcel is on hold. Pay $25.00 customs fee at cpost-redeliver.co within 24 hours")
    assert big["verdict"] == "scam" and big["alerted"]                # CAD 25 is not pocket change


def test_a_small_scam_asking_for_card_details_or_a_code_still_alerts(st):
    m = deliver(st, sender="Canada Post",
                text="Canada Post: parcel on hold. Pay $1.99 at cpost-redeliver.co with your card number and CVV.")
    assert m["verdict"] == "scam" and m["alerted"]


def test_tuition_reminder_links_to_the_forecast(st):
    m = deliver(st, "tuition_reminder_ubc")
    assert m["verdict"] == "info" and m["topic"] == "tuition" and m["actions"] == ["tuition", "dismiss"]
    assert m["tuition"]["term"] == "Winter Term 2, installment 1" and m["tuition"]["days_until_due"] == 90


# ------------------------------------------------------------------ the sponsor's alert
def test_high_confidence_money_scam_alerts_the_sponsor_without_the_text(st, client):
    m = deliver(st, "scam_cra_giftcards")
    assert m["alerted"] is True
    alerts = client.get("/sponsor/overview", headers=P).json()["alerts"]
    [al] = [a for a in alerts if a["kind"] == "scam_message"]
    assert "Asks for gift cards" in al["message"] and "诈骗" in al["message_zh"]
    assert "1,480" not in al["message"] and "warrant" not in al["message"]   # signs only, never the message
    assert al["weight"] == 15


def test_no_alert_for_bills_personal_or_a_weak_signal(st):
    for sample in ("bill_bchydro", "dad_whatsapp_ms", "tuition_reminder_ubc", "bill_northline"):
        assert deliver(st, sample)["alerted"] is False
    # Flagged for her (a deadline), but it asks for no money: Dad isn't bothered.
    weak = deliver(st, sender="+1 604 555 0100", channel="sms", text="Your package is waiting, it's urgent within 2 hours.")
    assert weak["verdict"] == "scam" and weak["targets_money"] is False and weak["alerted"] is False
    assert not [a for a in st.policy.safety.alerts(STUDENT) if a["kind"] == "scam_message"]


def test_sponsor_alerts_are_capped_per_hour(st):
    for _ in range(5):
        deliver(st, "scam_cra_giftcards")
    assert len([a for a in st.policy.safety.alerts(STUDENT) if a["kind"] == "scam_message"]) == inbox.ALERTS_PER_HOUR


# ------------------------------------------------------------------ API and roles
def test_operator_only_injection(st, client):
    assert client.post("/demo/inbox", json={"sample": "bill_bchydro"}, headers=S).status_code == 403
    assert client.post("/demo/inbox", json={"sample": "bill_bchydro"}, headers={**S, "X-Operator": "guess"}).status_code == 403
    assert client.post("/demo/inbox", json={"sample": "bill_bchydro"}, headers=OP).status_code == 401
    r = client.post("/demo/inbox", json={"sample": "bill_bchydro"}, headers={**S, **OP})
    assert r.status_code == 200 and r.json()["message"]["verdict"] == "bill"
    assert client.post("/demo/inbox", json={"sample": "nope"}, headers={**S, **OP}).status_code == 400
    r = client.post("/demo/inbox", json={"text": "hello from the stage", "sender": "Mak", "channel": "whatsapp"},
                    headers={**S, **OP})
    assert r.json()["message"]["verdict"] == "personal"
    st.settings.demo_mode = False
    assert client.post("/demo/inbox", json={"sample": "bill_bchydro"}, headers={**S, **OP}).status_code == 403
    assert [e for e in st.audit.entries() if e["event"] == "operator_denied"]


def test_inbox_endpoints_are_the_students(st, client):
    deliver(st, "scam_parcel_police_zh")
    assert client.get("/inbox", headers=P).status_code == 403
    feed = client.get("/inbox", headers=S).json()
    assert feed["counts"] == {"total": 1, "unread": 1, "scam": 1, "unread_scam": 1, "bills": 0}
    mid = feed["messages"][0]["id"]
    assert client.post(f"/inbox/{mid}/read", headers=P).status_code == 403
    assert client.post(f"/inbox/{mid}/read", headers=S).json()["message"]["status"] == "read"
    assert client.post(f"/inbox/{mid}/dismiss", headers=S).json()["message"]["status"] == "dismissed"
    assert client.post("/inbox/msg_nope/read", headers=S).status_code == 404
    samples = client.get("/demo/inbox/samples", headers=S).json()["samples"]
    assert {s["key"] for s in samples} == set(inbox.SAMPLES)


def test_reset_clears_the_inbox(st, client):
    deliver(st, "bill_bchydro")
    deliver(st, "scam_cra_giftcards")
    assert client.post("/demo/reset", headers={**S, **OP}).status_code == 200
    assert client.get("/inbox", headers=S).json()["messages"] == []


def test_audit_keeps_verdicts_not_text(st, client):
    m = deliver(st, "scam_landlord_new_account")
    entries = [e for e in st.audit.entries() if e["event"].startswith("inbox_")]
    rec = next(e for e in entries if e["event"] == "inbox_received")
    tri = next(e for e in entries if e["event"] == "inbox_triaged")
    assert rec["data"]["chars"] == len(m["text"]) and rec["data"]["channel"] == "email"
    assert tri["data"]["verdict"] == "scam" and "Bank details changed by message" in tri["data"]["signals"]
    blob = str(st.audit.entries())
    assert "audited" not in blob and "6620-1100-4471" not in blob and "maplecourt" not in blob
    # The student sees her inbox events; the sponsor sees only the alert.
    mine = {e["event"] for e in client.get("/audit", headers=S).json()["entries"]}
    his = {e["event"] for e in client.get("/audit", headers=P).json()["entries"]}
    assert {"inbox_received", "inbox_triaged"} <= mine
    assert not {"inbox_received", "inbox_triaged"} & his and "alert_raised" in his


def test_long_messages_are_cut_and_empty_ones_refused(st):
    m = deliver(st, sender="x", channel="email", text="hello " * 1000)
    assert len(m["text"]) == inbox.MAX_TEXT
    with pytest.raises(inbox.InboxError):
        deliver(st, sender="x", channel="sms", text="   ")
    with pytest.raises(inbox.InboxError):
        deliver(st, sender="x", channel="fax", text="hi")


# ------------------------------------------------------------------ the chat agent's list_inbox
@pytest.mark.parametrize("question,expect", [
    ("anything suspicious in my messages?", "look like scams"),
    ("收到的短信有没有诈骗？", "疑似诈骗"),
    ("ada mesej penipuan dalam peti masuk saya?", "nampak seperti penipuan"),
])
def test_list_inbox_answers_in_each_language(st, question, expect):
    deliver(st, "scam_parcel_police_zh")
    deliver(st, "bill_bchydro")
    r = st.agent.run(STUDENT, "student", "s", question)
    assert [t["tool"] for t in r.trace] == ["list_inbox"]
    assert expect in r.reply and "62.15" in r.reply and not r.actions


def test_list_inbox_withholds_scam_text_and_taints_the_rest(st):
    from app.tools import ToolContext, run_tool
    deliver(st, "scam_cra_giftcards")
    deliver(st, "bill_bchydro")
    ctx = ToolContext(user_id=STUDENT, role="student", session_id="t", bank=st.bank, fx=st.fx, policy=st.policy,
                      audit=st.audit, today=st.agent.today)
    out = run_tool(ctx, "list_inbox", {})
    scam = next(m for m in out["messages"] if m["verdict"] == "scam")
    assert "preview" not in scam and "warrant" not in str(out)
    assert any("62.15" in t for t in ctx.untrusted_texts)
    assert st.agent.run(STUDENT, "student", "e", "anything in my inbox?").reply.startswith("Yes")


def test_empty_inbox_reply(st):
    r = st.agent.run(STUDENT, "student", "s", "any new messages?")
    assert [t["tool"] for t in r.trace] == ["list_inbox"] and "empty" in r.reply


# ------------------------------------------------------------------ the optional model enhancer
def test_model_enhancer_values_are_validated(st):
    text = "BC Hydro statement: please pay 62.15 before the end of the month."
    payee = st.bank.payee("py_hydro")
    good = inbox._validated(lambda t, p: {"payee": "BC Hydro", "amount": 62.15, "due": "2026-10-30"}, text, payee, TODAY)
    assert good == {"amount": 62.15, "due": "2026-10-30"}
    invented = inbox._validated(lambda t, p: {"payee": "BC Hydro", "amount": 900, "due": "2031-01-01"}, text, payee, TODAY)
    assert invented is None                              # not in the message, and a date far away: both dropped
    other = inbox._validated(lambda t, p: {"payee": "Mystery Ltd", "amount": 62.15}, text, payee, TODAY)
    assert other is None

    def boom(t, p):
        raise RuntimeError("model down")
    assert inbox._validated(boom, text, payee, TODAY) is None
    m = inbox.triage(st.bank, STUDENT, TODAY, "BC Hydro", "email", text,
                     enhancer=lambda t, p: {"payee": "BC Hydro", "amount": 62.15, "due": "2026-10-30"})
    assert m["verdict"] == "bill" and m["bill"]["due"] == "2026-10-30" and m["bill"]["source"] == "model"
    assert inbox.model_enhancer(st.agent.provider) is None        # offline: no enhancer at all


# ------------------------------------------------------------------ time skip
def test_time_skip_is_operator_only_and_moves_today_everywhere(st, client):
    assert client.post("/demo/time_skip", json={"days": 10}, headers=S).status_code == 403
    r = client.post("/demo/time_skip", json={"to": "tuition_week"}, headers={**S, **OP})
    assert r.status_code == 200 and r.json()["skipped_days"] == 83
    assert client.get("/health").json()["today"] == "2026-12-30"
    ov = client.get("/overview", headers=S).json()
    assert ov["tuition"]["installments"][0]["days_until_due"] == 7
    fc = client.get("/forecast", headers=S)
    assert fc.status_code == 200 and fc.json()["type"] == "forecast"
    # A tuition reminder sample now says the same date, and the chat's context date is the new one.
    assert "Jan 6" in inbox.render_sample("tuition_reminder_ubc", st.bank, STUDENT, st.agent.today)["text"]
    assert client.post("/demo/time_skip", json={"to": "tuition_week"}, headers={**S, **OP}).status_code == 400
    assert client.post("/demo/time_skip", json={}, headers={**S, **OP}).status_code == 400
    client.post("/demo/reset", headers={**S, **OP})
    assert client.get("/health").json()["today"] == TODAY.isoformat() and st.bank.skew_days == 0


def test_time_skip_keeps_the_routine_and_limits_honest(st, client):
    spent_before = st.policy._daily_outflow_cad(STUDENT)
    budget_before = client.get("/overview", headers=S).json()["budget"]
    client.post("/demo/time_skip", json={"days": 30}, headers={**S, **OP})
    assert st.agent.today == date(2026, 11, 7) and st.bank.today == st.agent.today
    assert client.get("/overview", headers=S).json()["budget"] == budget_before    # the same 30 days of spending
    assert st.policy._daily_outflow_cad(STUDENT) == spent_before                   # nothing counts twice
    a = st.policy.draft_transfer(STUDENT, f"{STUDENT}:t", "py_hydro", 45)
    assert a.tier == "T2"
    rec = {r["id"]: r["next_due"] for r in st.bank.recurring(STUDENT)}
    assert rec["rc_hydro"] == "2026-12-23"                                          # Nov 23 + 30 days


def test_time_skip_lets_the_tuition_guard_act(st, client):
    ap = st.policy.autopilot
    m, _ = ap.propose(STUDENT, "tuition_guard", {"amount": 5000, "days_before": 14})
    ap.activate(m["id"], "sponsor", SPONSOR)
    assert ap.run() == []                                   # 90 days out: nothing to do yet
    r = client.post("/demo/time_skip", json={"to": "tuition_week"}, headers={**S, **OP}).json()
    assert any(d["kind"] == "tuition_guard" for d in r["decisions"])
