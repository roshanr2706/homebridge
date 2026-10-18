"""Autopilot: bounded autonomy through mandates (autopilot.py, autopilot_api.py).

Each mandate kind is checked with its condition met and not met, cap exhaustion, the period reset, idempotency, the
freeze, revocation and escalation (over the caps, T3, a compliance flag, a new payee). The run takes an injected date
and the FX mid comes from the sandbox market, so every decision is deterministic.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.authn import DEMO_SPONSOR_PIN
from app.autopilot import MandateError, good_rate_target, period_key
from app.bank import to_minor
from app.harness import TODAY, fresh
from app.main import create_app
from app.policy import PolicyError
from app.seed import SPONSOR, STUDENT

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
OP = {"X-Operator": "demo-operator"}


@pytest.fixture()
def st():
    return fresh()


def bal(st, acc):
    return st.bank.account(acc)["balance"]


def active(st, kind, role=None, **args):
    ap = st.policy.autopilot
    m, _ = ap.propose(STUDENT, kind, args)
    grantor = m["granted_by"]
    ap.activate(m["id"], grantor, SPONSOR if grantor == "sponsor" else STUDENT)
    return m


def events(st, name):
    return [e for e in st.audit.entries() if e["event"] == name]


# ------------------------------------------------------------------ rate watch
def test_rate_watch_waits_until_the_target_then_converts_without_a_tap(st):
    m = active(st, "rate_watch", target_rate=0.3250, amount=2000)
    myr, cad = bal(st, "acc_myr"), bal(st, "acc_cad")
    assert st.policy.autopilot.run(TODAY) == []                     # 0.3236 < 0.3250: nothing
    assert bal(st, "acc_myr") == myr and not st.policy.actions
    st.fx.set_mid("MYR", "CAD", 0.3251)
    [d] = st.policy.autopilot.run(TODAY)
    assert d["outcome"] == "acted" and d["amount"] == 2000
    assert bal(st, "acc_myr") == myr - to_minor(2000) and bal(st, "acc_cad") > cad
    a = st.policy.actions[d["action_id"]]
    assert (a.status, a.origin, a.mandate_id, a.tier) == ("executed", "autopilot", m["id"], "T2")
    assert "Rate reached 0.3251 (target 0.3250)" in d["text"]["en"] and "HomeBridge wallet conversion" in d["text"]["en"]
    assert "MYR 2,000/week, 2,000 used" in d["text"]["en"] and "汇率监控" in d["text"]["zh"]
    [e] = events(st, "autopilot_executed")
    assert e["data"]["mandate_id"] == m["id"] and e["data"]["caps"]["used_after"] == 2000
    assert events(st, "action_preauthorised") and st.audit.verify()["ok"]


def test_rate_watch_is_idempotent_and_resets_next_week(st):
    m = active(st, "rate_watch", target_rate=0.3250, amount=1000, period_cap=1000)
    st.fx.set_mid("MYR", "CAD", 0.3260)
    assert len(st.policy.autopilot.run(TODAY)) == 1
    assert st.policy.autopilot.run(TODAY) == [] and st.policy.autopilot.run(TODAY) == []
    view = st.policy.autopilot.view(st.policy.autopilot.get(m["id"]), TODAY)
    assert view["used"] == 1000 and view["remaining"] == 0
    nxt = TODAY + timedelta(days=7)
    assert period_key("rate_watch", nxt) != period_key("rate_watch", TODAY)
    [d] = st.policy.autopilot.run(nxt)                               # a new week: the cap is fresh
    assert d["outcome"] == "acted"
    assert st.policy.autopilot.view(st.policy.autopilot.get(m["id"]), nxt)["used"] == 1000


def test_rate_watch_cap_exhausted_by_a_narrowed_cap_is_skipped_once(st):
    m = active(st, "rate_watch", target_rate=0.3250, amount=1000, period_cap=3000)
    st.fx.set_mid("MYR", "CAD", 0.3260)
    st.policy.autopilot.run(TODAY)
    st.policy.autopilot.set_caps(m["id"], "sponsor", SPONSOR, 1000, 1000)   # narrowed: this week's cap is used
    # The week's window is already decided, so a narrowed cap doesn't produce a second decision either.
    assert st.policy.autopilot.run(TODAY) == []


def test_good_rate_target_is_just_above_today():
    assert good_rate_target(0.3236) == 0.325


def test_rate_watch_with_an_empty_wallet_is_skipped(st):
    active(st, "rate_watch", target_rate=0.3250, amount=2000)
    st.bank._x("UPDATE accounts SET balance=1000 WHERE id='acc_myr'")
    st.fx.set_mid("MYR", "CAD", 0.3300)
    [d] = st.policy.autopilot.run(TODAY)
    assert (d["outcome"], d["code"]) == ("skipped", "low_funds") and not st.policy.actions


# ------------------------------------------------------------------ freeze, pause, revoke
def test_freeze_halts_the_autopilot_and_notes_it_once(st):
    active(st, "rate_watch", target_rate=0.3250)
    st.policy.safety.freeze(STUDENT, "sponsor", "sponsor_funded", SPONSOR)
    st.fx.set_mid("MYR", "CAD", 0.3300)
    myr = bal(st, "acc_myr")
    [d] = st.policy.autopilot.run(TODAY)
    assert (d["outcome"], d["code"]) == ("skipped", "frozen")
    assert st.policy.autopilot.run(TODAY) == []                      # not one note per tick
    assert bal(st, "acc_myr") == myr and not st.policy.actions
    st.policy.safety.unfreeze(STUDENT, "sponsor", SPONSOR)
    [d] = st.policy.autopilot.run(TODAY)                            # unlocked: it acts in the same window
    assert d["outcome"] == "acted"


def test_execute_mandated_refuses_while_frozen(st):
    m = active(st, "rate_watch", target_rate=0.3250)
    a = st.policy.draft_conversion(STUDENT, "x", "MYR", "CAD", 500, [], "everyday", "wallet")
    a.origin, a.mandate_id = "autopilot", m["id"]
    st.policy.safety.freeze(STUDENT, "sponsor", "all", SPONSOR)
    with pytest.raises(PolicyError, match="locked"):
        st.policy.execute_mandated(a.id, m["id"])
    assert st.policy.get(a.id).status == "awaiting_user"


def test_revoke_and_pause_stop_it_immediately(st):
    m = active(st, "rate_watch", target_rate=0.3250)
    ap = st.policy.autopilot
    ap.pause(m["id"], "sponsor", SPONSOR)
    st.fx.set_mid("MYR", "CAD", 0.3300)
    assert ap.run(TODAY) == []
    ap.resume(m["id"], "sponsor", SPONSOR)
    ap.revoke(m["id"], "sponsor", SPONSOR)
    assert ap.run(TODAY) == [] and not st.policy.actions
    with pytest.raises(MandateError):
        ap.resume(m["id"], "sponsor", SPONSOR)


def test_expired_mandate_does_nothing(st):
    m = active(st, "rate_watch", target_rate=0.3250)
    st.fx.set_mid("MYR", "CAD", 0.3300)
    later = date.fromisoformat(m["expires_on"]) + timedelta(days=1)
    assert st.policy.autopilot.run(later) == []
    assert st.policy.autopilot.view(st.policy.autopilot.get(m["id"]), later)["status"] == "expired"


# ------------------------------------------------------------------ tuition guard
def test_tuition_guard_only_inside_its_window(st):
    active(st, "tuition_guard", days_before=30, amount=4000)
    assert st.policy.autopilot.run(TODAY) == []                     # due in 90 days
    due = date.fromisoformat(st.bank.tuition(STUDENT)[0]["due"])
    fund = bal(st, "acc_tui")
    [d] = st.policy.autopilot.run(due - timedelta(days=10))
    assert d["outcome"] == "acted" and d["amount"] == 3887.0     # the same maths as the forecast's suggestion
    assert bal(st, "acc_tui") >= fund + to_minor(1250)              # the gap is covered
    assert st.policy.autopilot.run(due - timedelta(days=9)) == []  # same installment, same month


def test_tuition_guard_over_its_cap_escalates_to_a_normal_draft(st):
    active(st, "tuition_guard", days_before=95, amount=2000)
    fund = bal(st, "acc_tui")
    [d] = st.policy.autopilot.run(TODAY)
    assert d["outcome"] == "escalated" and "more than this mandate allows" in d["text"]["en"]
    a = st.policy.actions[d["action_id"]]
    assert a.status == "awaiting_user" and a.origin == "autopilot" and a._token
    assert a.expires_at - a.created_at > 3600                       # waits a day for her, not ten minutes
    assert bal(st, "acc_tui") == fund
    assert events(st, "autopilot_escalated") and not events(st, "autopilot_executed")


def test_tuition_guard_escalates_on_a_compliance_flag(st, monkeypatch):
    active(st, "tuition_guard", days_before=95, amount=4000)
    real = st.policy.compliance.assess

    def flagged(*a, **k):
        out = real(*a, **k)
        out["checks"].append({"id": "structuring", "label": "Structuring", "status": "flag", "detail": "test"})
        out["outcome"] = "review"
        return out
    monkeypatch.setattr(st.policy.compliance, "assess", flagged)
    [d] = st.policy.autopilot.run(TODAY)
    assert d["outcome"] == "escalated" and "compliance" in d["text"]["en"]
    assert st.policy.actions[d["action_id"]].status == "awaiting_user"


def test_tuition_guard_escalates_when_policy_says_t3(st):
    active(st, "tuition_guard", days_before=95, amount=10000)
    st.policy.limits.single_cad = 1000                              # the gap (CAD 1,250) is now over the sponsor cap
    [d] = st.policy.autopilot.run(TODAY)
    a = st.policy.actions[d["action_id"]]
    assert d["outcome"] == "escalated" and a.tier == "T3" and "T3" in d["text"]["en"]


# ------------------------------------------------------------------ bill autopay
def test_bill_autopay_pays_the_card_minimum_when_due(st):
    active(st, "bill_autopay", payee="secured card", days_before=3)
    st_due = date.fromisoformat(st.bank.card_statements("card_sec")[0]["due"])
    assert st.policy.autopilot.run(TODAY) == []                     # due in 6 days, window opens 3 days before
    cad = bal(st, "acc_cad")
    [d] = st.policy.autopilot.run(st_due - timedelta(days=2))
    assert d["outcome"] == "acted" and d["amount"] == 10.0
    assert bal(st, "acc_cad") == cad - 1000
    assert st.bank.card_statements("card_sec")[0]["paid"] >= 1000
    assert st.policy.autopilot.run(st_due - timedelta(days=1)) == []


def test_bill_autopay_hydro_moves_the_schedule_on(st):
    active(st, "bill_autopay", payee="BC Hydro")
    rec = next(r for r in st.bank.recurring(STUDENT) if r["id"] == "rc_hydro")
    due = date.fromisoformat(rec["next_due"])
    [d] = st.policy.autopilot.run(due - timedelta(days=1))
    assert d["outcome"] == "acted" and d["amount"] == 41.2
    rec2 = next(r for r in st.bank.recurring(STUDENT) if r["id"] == "rc_hydro")
    assert date.fromisoformat(rec2["next_due"]) > due


def test_bill_over_the_amount_cap_escalates(st):
    active(st, "bill_autopay", payee="hydro", amount=30)
    due = date.fromisoformat(next(r for r in st.bank.recurring(STUDENT) if r["id"] == "rc_hydro")["next_due"])
    [d] = st.policy.autopilot.run(due)
    assert d["outcome"] == "escalated"
    assert st.policy.actions[d["action_id"]].status == "awaiting_user"


def test_bill_autopay_never_for_a_new_or_unknown_payee(st):
    ap = st.policy.autopilot
    with pytest.raises(MandateError, match="saved bill payee"):
        ap.propose(STUDENT, "bill_autopay", {"payee": "4417-2201-9983"})
    with pytest.raises(MandateError, match="isn't a bill"):
        ap.propose(STUDENT, "bill_autopay", {"payee": "Maple Court Rentals"})
    a = st.policy.draft_add_payee(STUDENT, "s", "Fresh Telecom", "phone", "CAD", "1234-5678-0000")
    st.bank.activate_payee(a.params["payee_id"], 0)
    with pytest.raises(MandateError, match="30 days"):
        ap.propose(STUDENT, "bill_autopay", {"payee": "Fresh Telecom"})


def test_a_payee_that_turns_young_is_escalated_not_paid(st):
    active(st, "bill_autopay", payee="hydro")
    import time
    st.bank._x("UPDATE payees SET created_at=? WHERE id='py_hydro'", (time.time(),))
    due = date.fromisoformat(next(r for r in st.bank.recurring(STUDENT) if r["id"] == "rc_hydro")["next_due"])
    [d] = st.policy.autopilot.run(due)
    assert d["outcome"] == "escalated" and "30 days" in d["text"]["en"]


# ------------------------------------------------------------------ low-balance request
def test_low_balance_sends_a_request_never_money(st):
    active(st, "low_balance_topup", floor_cad=2000, days_ahead=30, amount=300)
    before = {a["id"]: a["balance"] for a in st.bank.accounts(STUDENT)}
    [d] = st.policy.autopilot.run(TODAY)
    a = st.policy.actions[d["action_id"]]
    assert d["outcome"] == "acted" and a.kind == "topup" and a.status == "awaiting_sponsor" and a.tier == "T1"
    assert {x["id"]: x["balance"] for x in st.bank.accounts(STUDENT)} == before
    assert st.policy.autopilot.run(TODAY) == []


def test_low_balance_not_below_floor_does_nothing(st):
    active(st, "low_balance_topup", floor_cad=50, days_ahead=7)
    assert st.policy.autopilot.run(TODAY) == []


# ------------------------------------------------------------------ who may do what
def test_proposals_never_activate_and_only_the_grantor_activates(st):
    ap = st.policy.autopilot
    m, new = ap.propose(STUDENT, "rate_watch", {"amount": 2000})
    assert new and m["status"] == "proposed" and m["granted_by"] == "sponsor"
    same, new2 = ap.propose(STUDENT, "rate_watch", {"amount": 2000})
    assert same["id"] == m["id"] and not new2                       # no duplicate proposals
    with pytest.raises(MandateError):
        ap.activate(m["id"], "student", STUDENT)                    # sponsor-granted: not hers to turn on
    b, _ = ap.propose(STUDENT, "bill_autopay", {"payee": "hydro"})
    with pytest.raises(MandateError):
        ap.activate(b["id"], "sponsor", SPONSOR)                    # her own money: not his
    ap.activate(b["id"], "student", STUDENT)
    with pytest.raises(MandateError):
        ap.revoke(b["id"], "sponsor", SPONSOR)
    st.fx.set_mid("MYR", "CAD", 0.3300)
    assert all(d["kind"] != "rate_watch" for d in ap.run(TODAY))   # the proposal never acts


def test_caps_have_hard_ceilings(st):
    ap = st.policy.autopilot
    with pytest.raises(MandateError, match="at most"):
        ap.propose(STUDENT, "rate_watch", {"amount": 5000, "period_cap": 50000})
    m = active(st, "rate_watch")
    with pytest.raises(MandateError, match="at most"):
        ap.set_caps(m["id"], "sponsor", SPONSOR, 9000, 9000)
    with pytest.raises(MandateError):
        ap.propose(STUDENT, "send_money", {"amount": 5000})


def test_execute_mandated_refuses_chat_drafts_and_t3(st):
    m = active(st, "rate_watch")
    chat = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 500)
    with pytest.raises(PolicyError, match="autopilot's own"):
        st.policy.execute_mandated(chat.id, m["id"])
    big = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 9000)
    big.origin, big.mandate_id = "autopilot", m["id"]
    with pytest.raises(PolicyError, match="needs a person"):
        st.policy.execute_mandated(big.id, m["id"])
    assert st.policy.get(big.id).status == "awaiting_user"


def test_demo_reset_clears_mandates_and_the_rate(st):
    active(st, "rate_watch")
    st.fx.set_mid("MYR", "CAD", 0.34)
    st.reset()
    assert st.policy.autopilot.mandates(STUDENT) == [] and st.fx.mid("MYR", "CAD") == 0.3236


# ------------------------------------------------------------------ API
@pytest.fixture()
def client(st):
    return TestClient(create_app(st))


def test_api_sponsor_approves_with_pin_and_the_rate_move_fires_it(st, client):
    m, _ = st.policy.autopilot.propose(STUDENT, "rate_watch", {"amount": 2000})
    url = f"/sponsor/autopilot/mandates/{m['id']}/approve"
    assert client.post(url, json={}, headers=P).status_code == 403
    assert client.post(url, json={"pin": "000000"}, headers=P).status_code == 403
    assert client.post(f"/autopilot/mandates/{m['id']}/activate", headers=S).status_code == 400
    r = client.post(url, json={"pin": DEMO_SPONSOR_PIN}, headers=P)
    assert r.status_code == 200 and r.json()["mandate"]["status"] == "active"
    assert client.post("/demo/fx_shift", json={"rate": 0.3251}, headers=S).status_code == 403   # no operator token
    r = client.post("/demo/fx_shift", json={"rate": 0.3251}, headers={**S, **OP})
    assert r.status_code == 200 and r.json()["decisions"][0]["outcome"] == "acted"
    feed = client.get("/sponsor/autopilot", headers=P).json()
    assert feed["activity"][0]["outcome"] == "acted" and feed["mandates"][0]["used"] == 2000
    assert client.get("/autopilot", headers=S).json()["activity"][0]["outcome"] == "acted"
    audit = client.get("/audit", headers=P).json()["entries"]
    assert any(e["event"] == "autopilot_executed" for e in audit)


def test_api_revoke_needs_no_pin_but_widening_and_resuming_do(st, client):
    m = active(st, "rate_watch", amount=1000, period_cap=1000)
    base = f"/sponsor/autopilot/mandates/{m['id']}"
    assert client.post(f"{base}/caps", json={"per_action": 2000, "per_period": 2000}, headers=P).status_code == 403
    r = client.post(f"{base}/caps", json={"per_action": 500, "per_period": 500}, headers=P)   # narrowing: no PIN
    assert r.status_code == 200 and r.json()["mandate"]["caps"]["per_period"] == 500
    r = client.post(f"{base}/caps", json={"per_action": 2000, "per_period": 2000, "pin": DEMO_SPONSOR_PIN}, headers=P)
    assert r.status_code == 200
    assert client.post(f"{base}/pause", headers=P).json()["mandate"]["status"] == "paused"
    assert client.post(f"{base}/resume", json={}, headers=P).status_code == 403
    assert client.post(f"{base}/resume", json={"pin": DEMO_SPONSOR_PIN}, headers=P).status_code == 200
    r = client.post(f"{base}/revoke", headers=P)
    assert r.status_code == 200 and r.json()["mandate"]["status"] == "revoked"
    assert client.post(f"/autopilot/mandates/{m['id']}/revoke", headers=S).status_code == 400   # not hers


def test_api_student_runs_her_own_and_the_sponsor_never_sees_them(st, client):
    b, _ = st.policy.autopilot.propose(STUDENT, "bill_autopay", {"payee": "hydro"})
    assert client.post(f"/sponsor/autopilot/mandates/{b['id']}/approve", json={"pin": DEMO_SPONSOR_PIN},
                       headers=P).status_code == 404
    r = client.post(f"/autopilot/mandates/{b['id']}/activate", headers=S)
    assert r.status_code == 200 and r.json()["mandate"]["status"] == "active"
    assert client.get("/sponsor/autopilot", headers=P).json()["mandates"] == []
    assert client.get("/autopilot", headers=P).status_code == 403
    assert client.post(f"/autopilot/mandates/{b['id']}/pause", headers=S).json()["mandate"]["status"] == "paused"
    assert client.post("/autopilot/mandates/md_nope/revoke", headers=S).status_code == 404


def test_api_operator_run_needs_demo_mode_and_the_token(st, client):
    assert client.post("/autopilot/run", headers=S).status_code == 403
    assert client.post("/autopilot/run", headers={**S, "X-Operator": "guess"}).status_code == 403
    assert client.post("/autopilot/run", headers={**S, **OP}).status_code == 200
    st.settings.demo_mode = False
    try:
        assert client.post("/autopilot/run", headers={**S, **OP}).status_code == 403
        assert client.post("/demo/fx_shift", json={"reset": True}, headers={**S, **OP}).status_code == 403
    finally:
        st.settings.demo_mode = True
