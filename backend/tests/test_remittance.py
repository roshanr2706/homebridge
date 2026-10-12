"""Remittances (remit.py): a money request the sponsor approves is sent from his own MYR account through the
service he picks. Quote locking, compliance at initiation, settlement timing with an injected clock, exactly-once
posting, freeze and PIN rules, what each role can see, and recovery after a restart."""
import json
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.bank import BankError
from app.config import Settings
from app.harness import TODAY, fresh
from app.main import build_state, create_app
from app.policy import PolicyError, _hash_params
from app.remit import add_business_days
from app.seed import SPONSOR, STUDENT
from app.tools import ToolContext, run_tool

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
PIN = "246810"


class Clock:
    def __init__(self, t=None):
        self.t = t if t is not None else time.time()

    def __call__(self):
        return self.t


@pytest.fixture()
def st():
    s = fresh()
    s.policy.remit.clock = Clock()
    return s


@pytest.fixture()
def api():
    s = fresh()
    s.policy.remit.clock = Clock()
    return TestClient(create_app(s)), s


def bal(st, acc):
    return st.bank.account(acc)["balance"]


def request(st, amount=800, currency="CAD", reason="textbooks", destination=""):
    return st.policy.draft_topup_request(STUDENT, "s", amount, currency, reason, destination)


def events(st, name):
    return [e for e in st.audit.entries() if e["event"] == name]


# ------------------------------------------------------------------ the request
def test_request_names_its_destination_and_moves_nothing(st):
    spn, cad = bal(st, "acc_spn"), bal(st, "acc_cad")
    a = request(st)
    assert a.status == "awaiting_sponsor" and a.tier == "T1"
    assert a.params["to_account_id"] == "acc_cad" and a.params["to_account"] == "CAD Everyday"
    assert request(st, 2000, reason="winter tuition").params["to_account_id"] == "acc_tui"
    assert request(st, 300, destination="tuition").params["to_account_id"] == "acc_tui"
    assert request(st, 500, "MYR", "books").params["to_account_id"] == "acc_myr"
    with pytest.raises(PolicyError, match="MYR Wallet"):
        request(st, 500, "MYR", "books", destination="tuition")
    assert (bal(st, "acc_spn"), bal(st, "acc_cad")) == (spn, cad)


def test_sponsor_sees_a_true_cost_comparison_cheapest_first(st):
    a = request(st)
    opts = st.policy.remit.options(a.params)
    assert [o["provider_key"] for o in opts] == ["lowcost", "express", "bank"]
    assert opts[0]["cheapest"] and not any(o["cheapest"] for o in opts[1:])
    assert all(o["receive_amount"] >= 800 and o["receive_currency"] == "CAD" for o in opts)
    assert opts[0]["send_amount"] < opts[1]["send_amount"] < opts[2]["send_amount"]
    assert {"fee", "spread_pct", "speed", "eta", "true_cost_pct"} <= set(opts[0])
    dom = st.policy.remit.options(request(st, 500, "MYR", "books").params)
    assert [o["provider_key"] for o in dom] == ["duitnow", "ibg"] and dom[0]["receive_amount"] == 500.0


# ------------------------------------------------------------------ quote locking
def test_approval_locks_the_quote_into_the_params_hash(st):
    spn, cad = bal(st, "acc_spn"), bal(st, "acc_cad")
    a = request(st)
    old_hash = a.params_hash
    a = st.policy.sponsor_decide(a.id, SPONSOR, True, "for your books", provider="bank")
    q = a.params["quote"]
    assert a.status == "in_transit" and a.sponsor_decision == "approved"
    assert q["provider_key"] == "bank" and q["receive_currency"] == "CAD" and q["receive_amount"] >= 800
    assert a.params_hash != old_hash and a.params_hash == _hash_params(a.params)
    assert a.params["from_sponsor_account"].startswith("Maybank Savings ••••")
    assert bal(st, "acc_spn") == spn - round(q["send_amount"] * 100)   # debited at initiation
    assert bal(st, "acc_cad") == cad                                     # not credited yet
    assert list(a.remittance["timeline"]) == ["initiated", "compliance_checked", "in_transit"]
    ev = events(st, "remittance_initiated")[-1]["data"]
    assert ev["provider"] == "bank" and ev["params_hash"] == a.params_hash


def test_no_provider_means_the_cheapest_and_an_unknown_one_is_refused(st):
    a = request(st)
    with pytest.raises(PolicyError, match="transfer service"):
        st.policy.sponsor_decide(a.id, SPONSOR, True, provider="kiosk")
    assert a.status == "awaiting_sponsor" and a.sponsor_decision is None and "quote" not in a.params
    assert st.policy.sponsor_decide(a.id, SPONSOR, True).params["quote"]["provider_key"] == "lowcost"


def test_tampered_quote_is_never_credited_and_the_money_goes_back(st):
    spn, cad = bal(st, "acc_spn"), bal(st, "acc_cad")
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    a.params["quote"]["receive_amount"] = 8000.0       # an edited row after approval
    st.policy.remit.clock.t += 3600
    a = st.policy.get(a.id)
    assert a.status == "failed" and a.remittance["status"] == "returned"
    assert "changed after approval" in a.result["error"]
    assert bal(st, "acc_cad") == cad and bal(st, "acc_spn") == spn
    assert events(st, "remittance_failed")


# ------------------------------------------------------------------ compliance
def test_compliance_runs_again_with_the_locked_quote(st):
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    c, q = a.compliance, a.params["quote"]
    rec = c["record"]
    assert rec["originator"]["name"] == "Rahman bin Ismail" and rec["originator"]["country"] == "MY"
    assert rec["originator"]["institution"] == "Maybank (Malaysia)" and rec["originator"]["account"].startswith("••••")
    assert "5142-7730-0619" not in json.dumps(c)
    assert rec["beneficiary"]["name"] == "Aisha Rahman" and rec["beneficiary"]["country"] == "CA"
    assert (rec["amount_sent"], rec["exchange_rate"], rec["intermediary"]) == (q["send_amount"], q["rate"], q["provider"])
    assert rec["amount_received"] == q["receive_amount"] and rec["reference"] == a.id
    assert c["purpose_code"]["code"] == "ED02" and rec["purpose_code"] == "ED02"
    sanc = next(x for x in c["checks"] if x["id"] == "sanctions")
    assert sanc["status"] == "pass" and "Beneficiary Aisha Rahman" in sanc["detail"] and "originator" in sanc["detail"]
    assert "FINTRAC EFT record" in next(x for x in c["checks"] if x["id"] == "record_keeping")["detail"]
    assert [e["data"].get("stage") for e in events(st, "compliance_check") if e["data"]["action_id"] == a.id] == \
        ["draft", "remittance"]
    tui = st.policy.sponsor_decide(request(st, 900, reason="spring fees", destination="tuition").id, SPONSOR, True)
    assert tui.compliance["purpose_code"]["code"] == "ED01"


def test_eftr_flag_at_ten_thousand_and_not_counted_against_itself(st):
    st.bank._x("UPDATE accounts SET balance=? WHERE id='acc_spn'", (20_000_000,))
    small = st.policy.sponsor_decide(request(st, 9000, reason="rent and books").id, SPONSOR, True)
    assert small.compliance["reports"] == []     # its own draft is not counted twice
    big = st.policy.sponsor_decide(request(st, 12000, reason="winter tuition").id, SPONSOR, True)
    assert big.compliance["reports"] == ["EFTR"] and big.status == "in_transit"


def test_sanctions_hit_on_a_party_blocks_before_any_money_moves(st):
    st.bank._x("UPDATE users SET name=? WHERE id=?", ("Obsidian Star Bank", STUDENT))
    spn = bal(st, "acc_spn")
    a = request(st)
    a.status = "awaiting_sponsor"   # the draft-time block is bypassed, as if the list changed after the request
    a = st.policy.sponsor_decide(a.id, SPONSOR, True)
    assert a.status == "blocked" and "beneficiary" in a.result["error"] and bal(st, "acc_spn") == spn
    assert events(st, "remittance_blocked")


def test_domestic_ringgit_request_is_recorded_as_domestic(st):
    w = bal(st, "acc_myr")
    a = st.policy.sponsor_decide(request(st, 500, "MYR", "books").id, SPONSOR, True, provider="ibg")
    assert not a.compliance["cross_border"] and a.compliance["purpose_code"] is None
    assert a.compliance["record"]["originator"]["institution"] == "Maybank (Malaysia)"
    st.policy.remit.clock.t += 60
    assert st.policy.get(a.id).status == "executed" and bal(st, "acc_myr") == w + 50000


# ------------------------------------------------------------------ settlement
def test_in_transit_until_the_provider_delivers_then_credited_exactly_once(st):
    cad = bal(st, "acc_cad")
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)   # lowcost: 20 s in demo mode
    clock = st.policy.remit.clock
    assert a.remittance["settle_after"] == pytest.approx(clock.t + 20, abs=0.01)
    clock.t += 19
    assert st.policy.get(a.id).status == "in_transit" and bal(st, "acc_cad") == cad
    clock.t += 2
    a = st.policy.get(a.id)
    receive = a.params["quote"]["receive_amount"]
    assert a.status == "executed" and a.remittance["status"] == "credited"
    assert bal(st, "acc_cad") == cad + round(receive * 100)
    assert list(a.remittance["timeline"]) == ["initiated", "compliance_checked", "in_transit", "credited"]
    assert a.result["credited"] == receive and a.result["account"] == "CAD Everyday"
    # Reading again, or forcing a second settlement, never pays twice.
    st.policy.get(a.id)
    a.status = "in_transit"
    st.policy.remit.tick(st.policy, a)
    assert a.status == "executed" and bal(st, "acc_cad") == cad + round(receive * 100)
    with pytest.raises(BankError, match="Already posted"):
        st.bank.post_once("rmc_" + a.id, "acc_cad", 100, "allowance", "x")
    assert len(events(st, "remittance_credited")) == 1


def test_business_day_settlement_outside_demo_mode(st):
    st.policy.limits.remit_settle = "business_days"
    friday = datetime(2026, 10, 9, 15, tzinfo=timezone.utc).timestamp()
    st.policy.remit.clock.t = friday
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True, provider="bank")   # 4 business days
    due = datetime.fromtimestamp(a.remittance["settle_after"], timezone.utc)
    assert due.date().isoformat() == "2026-10-15" and due.weekday() == 3
    assert add_business_days(friday, 1) == datetime(2026, 10, 12, 15, tzinfo=timezone.utc).timestamp()
    st.policy.remit.clock.t = add_business_days(friday, 3)
    assert st.policy.get(a.id).status == "in_transit"
    st.policy.remit.clock.t = a.remittance["settle_after"]
    assert st.policy.get(a.id).status == "executed"


def test_insufficient_sponsor_funds_fails_without_moving_money(st):
    st.bank._x("UPDATE accounts SET balance=1000 WHERE id='acc_spn'")
    cad = bal(st, "acc_cad")
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    assert a.status == "failed" and "Insufficient funds in Maybank Savings" in a.result["error"]
    assert bal(st, "acc_spn") == 1000 and bal(st, "acc_cad") == cad


# ------------------------------------------------------------------ freeze, PIN, roles
def test_freeze_blocks_approving_but_not_money_already_in_transit(st):
    cad = bal(st, "acc_cad")
    sent = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    st.policy.safety.freeze(STUDENT, "student", "all", STUDENT)      # she thinks she's being scammed
    waiting = request(st, 300, reason="groceries")
    with pytest.raises(PolicyError, match="Payments are locked"):
        st.policy.sponsor_decide(waiting.id, SPONSOR, True)
    assert waiting.status == "awaiting_sponsor" and "quote" not in waiting.params
    st.policy.remit.clock.t += 3600
    assert st.policy.get(sent.id).status == "executed" and bal(st, "acc_cad") > cad   # incoming still arrives
    assert st.policy.sponsor_decide(waiting.id, SPONSOR, False, "call me").status == "rejected"


def test_api_approval_needs_the_pin_and_takes_the_provider(api):
    c, st = api
    a = request(st)
    assert c.post(f"/sponsor/actions/{a.id}/approve", json={"provider": "express"}, headers=P).status_code == 403
    assert c.post(f"/sponsor/actions/{a.id}/approve", json={"provider": "express", "pin": "000000"},
                  headers=P).status_code == 403
    assert c.post(f"/sponsor/actions/{a.id}/approve", json={"provider": "Express; DROP", "pin": PIN},
                  headers=P).status_code == 422
    assert c.post(f"/sponsor/actions/{a.id}/approve", json={"provider": "express", "pin": PIN},
                  headers=S).status_code == 403   # the student can't approve her own request
    assert st.policy.get(a.id).status == "awaiting_sponsor"
    r = c.post(f"/sponsor/actions/{a.id}/approve", json={"provider": "express", "pin": PIN}, headers=P)
    assert r.status_code == 200 and r.json()["status"] == "in_transit"
    assert r.json()["params"]["quote"]["provider_key"] == "express"


def test_only_the_sponsor_sees_his_balance_and_the_options(api):
    c, st = api
    a = request(st)
    q = c.get("/sponsor/queue", headers=P).json()["actions"][0]
    assert q["sponsor_source"] == {"label": "Maybank Savings", "number": "••••0619", "currency": "MYR",
                                   "balance": 48500.0}
    assert [o["provider_key"] for o in q["remit_options"]] == ["lowcost", "express", "bank"]
    assert c.get("/sponsor/overview", headers=P).json()["source_accounts"][0]["balance"] == 48500.0
    c.post(f"/sponsor/actions/{a.id}/approve", json={"pin": PIN}, headers=P)
    student_views = json.dumps([c.get(p, headers=S).json() for p in ("/overview", "/actions", "/accounts")])
    spent = st.policy.actions[a.id].params["quote"]["send_amount"]
    left = f"{48500 - spent:.1f}"    # the sponsor's balance after the debit
    assert "48500.0" not in student_views and "48,500" not in student_views and left not in student_views
    assert "Maybank Savings ••••0619" in json.loads(student_views)[1]["actions"][0]["params"]["from_sponsor_account"]
    assert "sponsor_source" not in student_views and "remit_options" not in student_views
    assert "5142-7730-0619" not in student_views and "acc_spn" not in student_views
    ov = c.get("/overview", headers=S).json()
    assert [p["status"] for p in ov["pending"]] == ["in_transit"]
    ctx = ToolContext(user_id=STUDENT, role="student", session_id="t", bank=st.bank, fx=st.fx, policy=st.policy,
                      audit=st.audit, today=TODAY)
    out = run_tool(ctx, "get_remittance_status", {})
    assert out["latest"]["stage"] == "in_transit" and out["latest"]["provider"] == "Low-cost transfer service"
    assert "48500" not in json.dumps(out) and "5142" not in json.dumps(out)


def test_student_cannot_cancel_or_change_a_remittance_once_sent(st):
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    with pytest.raises(PolicyError, match="in_transit"):
        st.policy.cancel(a.id, STUDENT)
    with pytest.raises(PolicyError, match="not the sponsor"):
        st.policy.sponsor_decide(a.id, STUDENT, True, provider="bank")
    with pytest.raises(PolicyError, match="in_transit"):
        st.policy.sponsor_decide(a.id, SPONSOR, True, provider="bank")
    assert a.params["quote"]["provider_key"] == "lowcost"


# ------------------------------------------------------------------ restart
def test_remittance_survives_a_restart_and_resumes_after_a_crash(tmp_path):
    def boot():
        s = build_state(Settings(db_path=str(tmp_path / "hb.db"), audit_path=str(tmp_path / "a.jsonl")),
                        today=TODAY, audit_path="default")
        s.policy.remit.clock = Clock(time.time() + 10_000 * len(states))
        states.append(s)
        return s

    states = []
    st = boot()
    a = st.policy.sponsor_decide(request(st).id, SPONSOR, True)
    spn, cad = bal(st, "acc_spn"), bal(st, "acc_cad")
    st.policy._save(a, executing=True)   # as if the process died mid-settlement
    st.bank.db.close()
    st2 = boot()
    b = st2.policy.actions[a.id]
    assert b.status == "in_transit" and events(st2, "remittance_recovered")
    assert st2.policy.get(a.id).status == "executed"     # its clock is past settle_after
    assert bal(st2, "acc_cad") == cad + round(b.params["quote"]["receive_amount"] * 100)
    assert bal(st2, "acc_spn") == spn
    st2.bank.db.close()
