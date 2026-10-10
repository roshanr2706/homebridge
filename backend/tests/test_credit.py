"""Credit Builder: utilization maths, the secured card profile, and paying the card through the policy engine."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import credit
from app.harness import TODAY, fresh
from app.main import create_app
from app.policy import PolicyError
from app.seed import SPONSOR, STUDENT
from app.tools import ToolContext, run_tool

S = {"Authorization": "Bearer demo-student"}


def ctx_for(st, flags=None):
    return ToolContext(user_id=STUDENT, role="student", session_id="t", bank=st.bank, fx=st.fx, policy=st.policy,
                       audit=st.audit, today=st.agent.today, guard_flags=list(flags or []))


# ------------------------------------------------------------------ pure maths
def test_utilization_rounds_down_to_one_decimal():
    assert credit.utilization_pct(28085, 50000) == 56.1
    assert credit.utilization_pct(14985, 50000) == 29.9   # 29.97% must not display as 30.0%
    assert credit.utilization_pct(15000, 50000) == 30.0
    assert credit.utilization_pct(0, 50000) == 0.0
    assert credit.utilization_pct(-500, 50000) == 0.0     # a credit balance is not negative utilization
    assert credit.utilization_pct(100, 0) == 0.0


@pytest.mark.parametrize("balance,limit,ratio,expected", [
    (28085, 50000, 0.30, 13100),   # 280.85 -> pay 131, leaves 149.85 (29.9%)
    (15000, 50000, 0.30, 100),     # exactly at 30% is not under it
    (14999, 50000, 0.30, 0),       # already under
    (28085, 50000, 0.10, 23100),   # under 10%: leaves 49.85
    (50, 100, 0.30, 50),           # rounding up to a whole dollar never pays more than the balance
    (0, 50000, 0.30, 0),
])
def test_pay_to_get_under(balance, limit, ratio, expected):
    pay = credit.pay_to_get_under(balance, limit, ratio)
    assert pay == expected
    if pay:
        assert balance - pay < limit * ratio and pay % 100 == 0 or pay == balance


def test_statement_status_and_streak():
    today = date(2026, 10, 8)
    base = {"due": "2026-10-14", "min_due": 1000, "paid": 0, "paid_on": None}
    assert credit.statement_status(base, today) == "due"
    assert credit.statement_status(base, date(2026, 10, 15)) == "late"
    assert credit.statement_status({**base, "paid": 1000, "paid_on": "2026-10-14"}, today) == "on_time"
    assert credit.statement_status({**base, "paid": 1000, "paid_on": "2026-10-15"}, today) == "late"
    assert credit.on_time_streak(["due", "on_time", "on_time"]) == 2
    assert credit.on_time_streak(["on_time", "late", "on_time"]) == 1
    assert credit.on_time_streak(["late", "on_time"]) == 0
    assert credit.months_between(date(2026, 5, 6), date(2026, 10, 8)) == 5
    assert credit.months_between(date(2026, 5, 9), date(2026, 10, 8)) == 4


def test_health_band_is_labelled_simulated():
    assert credit.health_band(1, 5, 30)["key"] == "needs_attention"
    assert credit.health_band(0, 56.1, 5)["key"] == "needs_attention"
    assert credit.health_band(0, 36.9, 5)["key"] == "fair"
    assert credit.health_band(0, 19.2, 5)["key"] == "on_track"
    assert credit.health_band(0, 8.0, 14)["key"] == "strong"
    assert "Not a credit score" in credit.health_band(0, 8.0, 14)["basis"]


# ------------------------------------------------------------------ profile tool
def test_profile_from_seed():
    st = fresh()
    p = run_tool(ctx_for(st), "get_credit_profile", {})
    assert p["has_card"] and p["not_a_credit_score"]
    assert p["card"]["balance"] == 280.85 and p["card"]["credit_limit"] == 500.0
    assert p["card"]["number"].startswith("••••")
    assert p["utilization_pct"] == 56.1 and p["utilization_reported_pct"] == 36.9
    assert p["on_time_streak"] == 4 and p["late_payments"] == 0 and p["months_of_history"] == 5
    assert p["statement"]["status"] == "due" and p["statement"]["remaining"] == 184.6
    assert p["pay_to_report_under_30"] == 131.0
    assert p["recommended_payment"] == {"amount": 184.6, "balance_after": 96.25, "utilization_after_pct": 19.2}
    assert [f["approx_weight_pct"] for f in p["factors"]] == [35, 30, 15, 10, 10]
    keys = [a["key"] for a in p["next_actions"]]
    assert keys[:3] == ["minimum", "statement_balance", "under_30"] and "autopay" in keys and "keep_open" in keys
    assert "not a licensed adviser" in p["disclosure"] and "not a credit score" in p["disclosure"].lower()
    assert "score" not in {k for k in p}  # never a bureau score field


def test_card_is_kept_out_of_balances_and_budget():
    st = fresh()
    ctx = ctx_for(st)
    before = run_tool(ctx, "get_balances", {})
    assert all("Card" not in a["label"] for a in before["accounts"])
    act = run_tool(ctx, "prepare_card_payment", {"target": "full_balance"})["action"]
    spent_before = run_tool(ctx, "budget_summary", {})["total_spent_cad"]
    st.policy.confirm(act["action_id"], STUDENT, st.policy.actions[act["action_id"]]._token)
    # Paying the card down is not new spending.
    assert run_tool(ctx, "budget_summary", {})["total_spent_cad"] == spent_before


# ------------------------------------------------------------------ paying the card
def test_card_payment_executes_and_updates_utilization():
    st = fresh()
    ctx = ctx_for(st)
    cad_before = st.bank.account("acc_cad")["balance"]
    out = run_tool(ctx, "prepare_card_payment", {"target": "recommended"})
    act = out["action"]
    assert act["tier"] == "T2" and act["status"] == "awaiting_user"
    assert out["card_after"] == {"balance": 96.25, "utilization_pct": 19.2}
    a = st.policy.confirm(act["action_id"], STUDENT, st.policy.actions[act["action_id"]]._token)
    assert a.status == "executed"
    assert st.bank.account("acc_cad")["balance"] == cad_before - 18460
    p = run_tool(ctx, "get_credit_profile", {})
    assert p["card"]["balance"] == 96.25 and p["utilization_pct"] == 19.2
    assert p["statement"]["status"] == "on_time" and p["statement"]["remaining"] == 0
    assert p["on_time_streak"] == 5
    assert p["credit_health"]["key"] == "on_track"
    assert "minimum" not in [x["key"] for x in p["next_actions"]]


def test_minimum_payment_keeps_streak_without_clearing_statement():
    st = fresh()
    ctx = ctx_for(st)
    act = run_tool(ctx, "prepare_card_payment", {"target": "minimum"})["action"]
    st.policy.confirm(act["action_id"], STUDENT, st.policy.actions[act["action_id"]]._token)
    p = run_tool(ctx, "get_credit_profile", {})
    assert p["on_time_streak"] == 5 and p["statement"]["remaining"] == 174.6
    assert p["statement"]["status"] == "on_time"


def test_overpaying_the_card_is_refused():
    st = fresh()
    ctx = ctx_for(st)
    r = run_tool(ctx, "prepare_card_payment", {"amount": 900})
    assert r.get("refused_by_policy") and "more than the card balance" in r["error"]
    # The same rule holds when the card is paid as a saved payee.
    r = run_tool(ctx, "prepare_transfer", {"payee": "HomeBridge Secured Card", "amount": 281})
    assert r.get("refused_by_policy")
    with pytest.raises(PolicyError):
        st.policy.draft_transfer(STUDENT, "t", "py_card", 280.86)


def test_balance_change_after_drafting_fails_safely_at_execution():
    st = fresh()
    ctx = ctx_for(st)
    full = run_tool(ctx, "prepare_card_payment", {"target": "full_balance"})["action"]
    part = run_tool(ctx, "prepare_card_payment", {"amount": 100})["action"]
    st.policy.confirm(part["action_id"], STUDENT, st.policy.actions[part["action_id"]]._token)
    cad = st.bank.account("acc_cad")["balance"]
    a = st.policy.confirm(full["action_id"], STUDENT, st.policy.actions[full["action_id"]]._token)
    assert a.status == "failed" and "more than the card balance" in a.result["error"]
    assert st.bank.account("acc_cad")["balance"] == cad  # nothing debited


def test_card_payment_in_flagged_conversation_goes_to_sponsor():
    st = fresh()
    act = run_tool(ctx_for(st, ["scam"]), "prepare_card_payment", {"target": "full_balance"})["action"]
    assert act["tier"] == "T3" and act["needs_sponsor_approval"]


def test_card_payment_from_sponsor_funded_account_needs_sponsor():
    st = fresh()
    a = st.policy.draft_transfer(STUDENT, "t", "py_card", 50, from_account_id="acc_tui")
    assert a.tier == "T3"
    a = st.policy.confirm(a.id, STUDENT, a._token)
    assert a.status == "awaiting_sponsor"
    assert st.policy.sponsor_decide(a.id, SPONSOR, True).status == "executed"
    assert st.bank.credit_cards(STUDENT)[0]["balance"] == 28085 - 5000


def test_nothing_to_pay_when_already_under_target():
    st = fresh()
    st.bank._x("UPDATE credit_cards SET balance=4000")
    r = run_tool(ctx_for(st), "prepare_card_payment", {"target": "under_30"})
    assert r["nothing_to_pay"] and not st.policy.actions


# ------------------------------------------------------------------ API and cards
def test_chat_returns_credit_card_and_overview_tile():
    st = fresh()
    client = TestClient(create_app(st))
    r = client.post("/chat", json={"message": "How's my credit?"}, headers=S).json()
    card = next(c for c in r["cards"] if c["type"] == "credit")
    assert card["target_pct"] == 30 and card["utilization_pct"] == 56.1
    assert card["payment_history"] == ["on_time"] * 4 + ["due"]
    assert card["health"]["label"] and "not a credit score" in card["footnote"].lower()
    o = client.get("/overview", headers=S).json()
    assert o["credit"]["has_card"] and o["credit"]["utilization_pct"] == 56.1
    raw = st.bank.db.execute("SELECT number FROM credit_cards").fetchone()[0]
    assert raw not in str(r) and raw not in str(o)


def test_seed_dates_follow_today():
    st = fresh()
    card = st.bank.credit_cards(STUDENT)[0]
    assert card["next_close"] == "2026-10-23" and TODAY == date(2026, 10, 8)
