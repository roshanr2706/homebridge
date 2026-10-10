"""Cash-flow forecast: the projection maths, suggestions, routing, card and endpoint."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.bank import to_minor
from app.cards import FORECAST_POINTS, forecast_card
from app.harness import TODAY, fresh
from app.main import create_app
from app.seed import STUDENT, add_months
from app.tools import ToolContext, forecast_cashflow, run_tool

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}


def ctx_for(st):
    return ToolContext(STUDENT, "student", "t", st.bank, st.fx, st.policy, st.audit, TODAY)


def forecast(st=None, **args):
    st = st or fresh()
    return forecast_cashflow(ctx_for(st), args)


def add_cad(st, account, amount):
    st.bank._x("UPDATE accounts SET balance=balance+? WHERE id=?", (to_minor(amount), account))


def test_default_horizon_runs_to_next_tuition_and_series_is_daily():
    r = forecast()
    due = date.fromisoformat(fresh().bank.tuition(STUDENT)[0]["due"])
    assert r["end_date"] == due.isoformat() and r["horizon"] == "next tuition due date"
    assert len(r["series"]) == r["horizon_days"] + 1 == (due - TODAY).days + 1
    assert r["series"][0] == r["starting_balance"] == 2340.55


def test_projection_matches_hand_calculation():
    """Ending balance = start + pay - bills - average day-to-day spending, using the seeded schedule."""
    r = forecast()
    st = fresh()
    end = date.fromisoformat(r["end_date"])
    cad_events = sum(e["amount"] for e in r["events"] if e["account"] == "CAD Everyday")
    daily = r["weekly_spending_cad"] / 7   # rounded to cents, hence the small tolerance
    assert r["ending_balance"] == pytest.approx(2340.55 + cad_events - daily * (end - TODAY).days, abs=0.1)
    # Groceries and dining are day-to-day; rent, bills, transit and subscriptions are recurring, not double counted.
    assert set(r["weekly_by_category_cad"]) == {"groceries", "dining"}
    pays = [e for e in r["events"] if e["label"] == "Campus Cafe payroll"]
    assert len(pays) == len(range(2, (end - TODAY).days + 1, 14))
    assert all(e["currency"] == "MYR" and e["account"] == "MYR Wallet" for e in r["events"] if e["kind"] == "allowance")
    wallet = next(a for a in st.bank.accounts(STUDENT) if a["label"] == "MYR Wallet")
    assert r["myr_wallet_at_end"] == wallet["balance"] + 3000 * 3   # three monthly allowances


def test_is_deterministic_and_read_only():
    st = fresh()
    before = ([a["balance"] for a in st.bank.accounts(STUDENT)], len(st.policy.actions))
    a, b = forecast(st), forecast(st)
    assert a == b
    assert ([x["balance"] for x in st.bank.accounts(STUDENT)], len(st.policy.actions)) == before


def test_shortfall_and_tuition_gap_with_seed_data():
    r = forecast()
    assert r["verdict"] == "both"
    first = date.fromisoformat(r["first_shortfall_date"])
    i = (first - TODAY).days
    assert r["series"][i] < 0 <= min(r["series"][:i])
    assert r["lowest"]["balance"] == min(r["series"]) < 0
    gap = r["tuition"][0]
    assert gap["gap"] == 1250.0 and gap["balance_before"] == 6000.0
    tip = r["suggestions"][0]
    assert tip["kind"] == "convert" and tip["destination"] == "tuition"
    assert tip["provider"] == "HomeBridge wallet conversion" and tip["receive_cad"] == 1250.0
    assert st_quote_receives(tip["amount"]) >= 1250.0 > st_quote_receives(tip["amount"] - 1)
    assert date.fromisoformat(tip["by_date"]) < date.fromisoformat(gap["due"])
    assert tip["saving_vs_bank_cad"] > 0
    # A small spending cut is offered for the short December dip.
    cut = next(s for s in r["suggestions"] if s["kind"] == "cut_spending")
    assert cut["category"] == "dining" and 0 < cut["weekly_cut_cad"] <= r["weekly_by_category_cad"]["dining"]


def st_quote_receives(myr):
    st = fresh()
    return st.fx.quote("MYR", "CAD", myr, st.fx.provider("inapp"))["you_receive"]


def test_suggested_cut_actually_closes_the_dip():
    r = forecast()
    cut = next(s for s in r["suggestions"] if s["kind"] == "cut_spending")["weekly_cut_cad"] / 7
    assert all(v + cut * k >= -0.01 for k, v in enumerate(r["series"]))


def test_no_shortfall_when_funded():
    st = fresh()
    add_cad(st, "acc_cad", 1000)
    add_cad(st, "acc_tui", 1250)
    r = forecast(st)
    assert r["verdict"] == "on_track" and r["first_shortfall_date"] is None and r["shortfall_days"] == 0
    assert r["tuition"][0]["gap"] == 0
    assert [s["kind"] for s in r["suggestions"]] == ["on_track"]
    assert not any(s["kind"] == "convert" for s in r["suggestions"])


def test_shortfall_today_offers_conversion_not_a_cut():
    st = fresh()
    st.bank._x("UPDATE accounts SET balance=? WHERE id='acc_cad'", (to_minor(500),))
    r = forecast(st)
    assert r["first_shortfall_date"] == (TODAY + timedelta(days=3)).isoformat()   # rent on day 3
    kinds = [s["kind"] for s in r["suggestions"]]
    assert "convert" in kinds and "cut_spending" not in kinds   # a cut cannot cover a CAD 1,000+ hole in 3 days
    spend_tip = [s for s in r["suggestions"] if s["kind"] == "convert" and s["destination"] == "everyday"][0]
    assert spend_tip["by_date"] == (TODAY + timedelta(days=2)).isoformat()
    assert "sponsor approves it too" in spend_tip["text"]   # over the single limit of sponsor money


def test_pending_transfer_is_counted_today():
    st = fresh()
    base = forecast(st)
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 200.0)
    r = forecast(st)
    assert r["series"][0] == pytest.approx(base["series"][0] - 200)
    assert r["ending_balance"] == pytest.approx(base["ending_balance"] - 200)
    assert r["pending_included"] == [a.summary]
    assert any(e["kind"] == "pending" and e["date"] == TODAY.isoformat() for e in r["events"])


def test_pending_conversion_into_tuition_fund_closes_the_gap():
    st = fresh()
    a = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 3900, destination="tuition")
    r = forecast(st)
    assert r["tuition"][0]["balance_before"] == pytest.approx(6000 + a.params["expected_receive"])
    assert r["tuition"][0]["gap"] == 0
    assert r["myr_wallet_now"] == 18200 - 3900
    assert not any(s.get("destination") == "tuition" for s in r["suggestions"])


def test_pending_tuition_payment_is_not_taken_twice():
    st = fresh()
    add_cad(st, "acc_tui", 1250)
    st.policy.draft_transfer(STUDENT, "s", "py_ubc", 7250.0)
    r = forecast(st, until="end_of_term")
    assert [t["term"] for t in r["tuition"]] == ["Winter Term 2, installment 2"]


def test_pending_topup_is_listed_but_not_counted():
    st = fresh()
    base = forecast(st)
    st.policy.draft_topup_request(STUDENT, "s", 500, "CAD", "books")
    r = forecast(st)
    assert r["series"] == base["series"] and r["not_counted"] and not r["pending_included"]


@pytest.mark.parametrize("until,expected", [
    ("january", date(2027, 1, 31)),
    ("Dec", date(2026, 12, 31)),
    ("end_of_term", date.fromisoformat(fresh().bank.tuition(STUDENT)[-1]["due"])),
    ("2026-11-15", date(2026, 11, 15)),
    ("2030-01-01", TODAY + timedelta(days=180)),   # capped
    ("2026-10-09", TODAY + timedelta(days=7)),     # at least a week
])
def test_horizon(until, expected):
    assert forecast(until=until)["end_date"] == expected.isoformat()


def test_days_argument_and_bad_input():
    assert forecast(days=30)["horizon_days"] == 30
    st = fresh()
    out = run_tool(ctx_for(st), "forecast_cashflow", {"until": "someday"})
    assert "error" in out


def test_add_months_clamps_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 30), 2) == date(2027, 1, 30)


def test_card_buckets_long_horizons_and_keeps_dips():
    r = forecast(until="end_of_term")
    card = forecast_card({}, r)
    assert card["type"] == "forecast" and len(card["series"]) <= FORECAST_POINTS
    assert min(card["series"]) == r["lowest"]["balance"]
    assert card["series"][card["lowest"]["index"]] == r["lowest"]["balance"]
    assert all(0 <= t["index"] < len(card["series"]) for t in card["tuition"])
    assert card["suggestions"] and isinstance(card["suggestions"][0], str)


@pytest.mark.parametrize("msg,until", [
    ("will I run out of money before tuition?", None),
    ("forecast my cash flow", None),
    ("can I survive until January", "january"),
    ("duit cukup tak sampai hujung sem?", "end_of_term"),
    ("我的钱够用到学期末吗", "end_of_term"),
    ("how long will my money last?", None),
])
def test_offline_routing(msg, until):
    st = fresh()
    r = st.agent.run(STUDENT, "student", "s", msg)
    assert [t["tool"] for t in r.trace] == ["forecast_cashflow"]
    assert (r.trace[0]["args"] or {}).get("until") == until
    assert not r.actions and not st.policy.actions
    assert [c["type"] for c in r.cards] == ["forecast"]


def test_forecast_endpoint_is_student_only():
    client = TestClient(create_app(fresh()))
    assert client.get("/forecast").status_code == 401
    assert client.get("/forecast", headers=P).status_code == 403
    r = client.get("/forecast", headers=S)
    assert r.status_code == 200 and r.json()["type"] == "forecast"
    assert client.get("/forecast?until=never", headers=S).status_code == 400
