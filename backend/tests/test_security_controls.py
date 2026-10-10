"""Server-side controls around the API: the sponsor PIN, the operator-gated demo reset, role-scoped audit and
sponsor views (data minimisation), the CORS allow-list and the pinned demo date."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.authn import MAX_PIN_FAILURES, PIN_LOCK_SECONDS
from app.config import Settings
from app.harness import TODAY, fresh
from app.main import build_state, create_app
from app.seed import SPONSOR, STUDENT

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
OP = {"X-Operator": "demo-operator"}
PIN = "246810"


@pytest.fixture()
def api():
    st = fresh()
    return TestClient(create_app(st)), st


def _waiting(client, st, amount=2000):
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", amount)
    st.policy.confirm(a.id, STUDENT, a._token)
    return a.id


def _events(st, name):
    return [e for e in st.audit.entries() if e["event"] == name]


# ------------------------------------------------------------------ sponsor PIN
def test_pin_is_stored_as_a_salted_hash(api):
    _, st = api
    rec = st.bank.pin_record(SPONSOR)
    assert PIN not in str(rec) and len(rec["salt"]) == 32 and len(rec["hash"]) == 64 and rec["iterations"] >= 600000
    assert st.bank.pin_record(STUDENT) is None


def test_approve_needs_the_right_pin(api):
    client, st = api
    aid = _waiting(client, st)
    assert client.post(f"/sponsor/actions/{aid}/approve", json={"note": "ok"}, headers=P).status_code == 403
    r = client.post(f"/sponsor/actions/{aid}/approve", json={"pin": "135790"}, headers=P)
    assert r.status_code == 403 and "4 tries left" in r.json()["detail"]
    assert st.policy.get(aid).status == "awaiting_sponsor"
    r = client.post(f"/sponsor/actions/{aid}/approve", json={"pin": PIN, "note": "ok"}, headers=P)
    assert r.status_code == 200 and r.json()["status"] == "executed"
    assert st.bank.pin_record(SPONSOR)["failures"] == 0      # the right PIN resets the counter
    assert [e["data"]["reason"] for e in _events(st, "sponsor_pin_failed")] == ["missing", "wrong PIN"]


def test_reject_needs_no_pin(api):
    client, st = api
    aid = _waiting(client, st)
    assert client.post(f"/sponsor/actions/{aid}/reject", json={"note": "no"}, headers=P).json()["status"] == "rejected"


def test_pin_lockout_after_five_wrong_tries(api):
    client, st = api
    aid = _waiting(client, st)
    for i in range(MAX_PIN_FAILURES):
        assert client.post(f"/sponsor/actions/{aid}/approve", json={"pin": f"00000{i}"}, headers=P).status_code == 403
    r = client.post(f"/sponsor/actions/{aid}/approve", json={"pin": PIN}, headers=P)
    assert r.status_code == 403 and "locked" in r.json()["detail"]
    [lock] = _events(st, "sponsor_pin_locked")
    assert lock["data"]["seconds"] == PIN_LOCK_SECONDS
    assert client.get("/sponsor/overview", headers=P).json()["pin"]["locked"] is True
    # After the lockout ends, the right PIN works again.
    st.bank.set_pin_state(SPONSOR, 0, 0)
    assert client.post(f"/sponsor/actions/{aid}/approve", json={"pin": PIN}, headers=P).json()["status"] == "executed"


def test_unlock_and_limits_need_the_pin(api):
    client, st = api
    client.post("/sponsor/freeze", json={"scope": "all"}, headers=P)       # locking needs no PIN
    assert client.post("/sponsor/unfreeze", headers=P).status_code == 403
    assert client.post("/sponsor/unfreeze", json={"pin": "111111"}, headers=P).status_code == 403
    assert st.policy.safety.state(STUDENT)["frozen"]
    assert client.post("/sponsor/unfreeze", json={"pin": PIN}, headers=P).json()["freeze"]["frozen"] is False
    assert client.post("/sponsor/limits", json={"single_cad": 100, "daily_cad": 500}, headers=P).status_code == 403
    assert st.settings.limits.single_cad == 1500
    assert client.post("/sponsor/limits", json={"single_cad": 100, "daily_cad": 500, "pin": PIN},
                       headers=P).status_code == 200


# ------------------------------------------------------------------ demo reset
def test_reset_needs_demo_mode_and_the_operator_token(api):
    client, st = api
    marker = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 20).id
    assert client.post("/demo/reset", headers=S).status_code == 403
    assert client.post("/demo/reset", headers={**S, "X-Operator": "nope"}).status_code == 403
    assert _events(st, "reset_denied")
    st.settings.demo_mode = False
    assert client.post("/demo/reset", headers={**S, **OP}).status_code == 403
    assert marker in st.policy.actions
    st.settings.demo_mode = True
    assert client.post("/demo/reset", headers={**S, **OP}).status_code == 200
    assert marker not in st.policy.actions


def test_reset_restores_kyc_and_pin(api):
    client, st = api
    st.bank.set_kyc(STUDENT, "unverified", "", "")
    st.bank.set_pin_state(SPONSOR, 3, 0)
    client.post("/demo/reset", headers={**P, **OP})
    assert st.policy.compliance.kyc(STUDENT)["level"] == "verified_basic"
    assert st.bank.pin_record(SPONSOR)["failures"] == 0


# ------------------------------------------------------------------ data minimisation
def test_sponsor_overview_shows_only_sponsor_funded_money(api):
    client, st = api
    own = client.post("/chat", json={"message": "pay hydro 45"}, headers=S).json()["actions"][0]
    big = client.post("/chat", json={"message": "pay hydro 2000"}, headers=S).json()["actions"][0]
    conv = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 300)
    o = client.get("/sponsor/overview", headers=P).json()
    assert [a["id"] for a in o["accounts"]] == ["acc_myr", "acc_tui"]
    assert o["total_cad"] < 13000      # the MYR account and the tuition fund, not CAD Everyday
    ids = [a["action_id"] for a in o["recent"]]
    assert own["action_id"] not in ids and big["action_id"] in ids and conv.id in ids
    assert set(o["student"]) == {"id", "name"} and o["sharing"]["scope"] == "sponsor_funded"
    s = client.get("/overview", headers=S).json()
    assert [a["id"] for a in s["accounts"]] == ["acc_cad", "acc_myr", "acc_tui"] and s["kyc"]["level"] == "verified_basic"


def test_audit_is_scoped_by_role(api):
    client, st = api
    own = client.post("/chat", json={"message": "pay hydro 45"}, headers=S).json()["actions"][0]
    aid = _waiting(client, st)
    client.post(f"/sponsor/actions/{aid}/approve", json={"pin": "000000"}, headers=P)
    client.post(f"/sponsor/actions/{aid}/approve", json={"pin": PIN}, headers=P)
    client.post("/sponsor/freeze", json={"scope": "sponsor_funded"}, headers=P)
    student = client.get("/audit", headers=S).json()
    sponsor = client.get("/audit", headers=P).json()
    s_events = {e["event"] for e in student["entries"]}
    p_events = {e["event"] for e in sponsor["entries"]}
    assert {"user_message", "tool_call", "assistant_reply", "sponsor_approved"} <= s_events
    assert "sponsor_pin_failed" not in s_events
    assert not p_events & {"user_message", "tool_call", "assistant_reply"}
    assert {"sponsor_pin_failed", "sponsor_approved", "action_executed", "payments_frozen", "compliance_check"} <= p_events
    assert not [e for e in sponsor["entries"] if e["data"].get("action_id") == own["action_id"]]
    assert sponsor["visible"] < sponsor["total"] == student["total"] == len(st.audit.entries())
    # The chain is verified over the full log, for either role.
    assert client.get("/audit/verify", headers=P).json()["ok"] is True
    seen = sponsor["entries"][0]["seq"]
    assert client.get(f"/audit/verify?tamper_seq={seen}", headers=P).json()["broken_at"] == seen
    hidden = next(e["seq"] for e in st.audit.entries() if e["event"] == "user_message")
    assert client.get(f"/audit/verify?tamper_seq={hidden}", headers=P).status_code == 403


# ------------------------------------------------------------------ CORS and demo date
def test_cors_allow_list(api):
    client, _ = api
    ok = client.get("/health", headers={"Origin": "http://localhost:8081"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:8081"
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers
    pre = client.options("/sponsor/limits", headers={"Origin": "https://evil.example",
                                                     "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 400


def test_cors_origins_from_env(monkeypatch):
    monkeypatch.setenv("HB_CORS_ORIGINS", "https://homebridge.example, http://localhost:8081")
    assert Settings().cors_origins == ["https://homebridge.example", "http://localhost:8081"]


def test_demo_mode_pins_today(monkeypatch):
    st = build_state(Settings(demo_mode=True), audit_path=None)
    assert st.agent.today == date(2026, 10, 8) == TODAY
    assert TestClient(create_app(st)).get("/health").json()["today"] == "2026-10-08"
    monkeypatch.setenv("HB_DEMO_TODAY", "2026-11-02")
    assert build_state(Settings(demo_mode=True), audit_path=None).agent.today == date(2026, 11, 2)
    assert build_state(Settings(demo_mode=False), audit_path=None).agent.today == date.today()
    # Tests and the evidence runner still pass their own date.
    assert build_state(Settings(demo_mode=True), today=date(2026, 9, 1), audit_path=None).agent.today == date(2026, 9, 1)


def test_older_file_database_gets_kyc_and_pin(tmp_path):
    settings = Settings(db_path=str(tmp_path / "hb.db"), audit_path=str(tmp_path / "audit.jsonl"))
    st = build_state(settings, today=TODAY, audit_path="default")
    st.bank._x("DELETE FROM kyc")
    st.bank._x("DELETE FROM user_pins")
    st.bank.db.close()
    st2 = build_state(Settings(db_path=str(tmp_path / "hb.db"), audit_path=str(tmp_path / "audit.jsonl")),
                      today=TODAY, audit_path="default")
    assert st2.policy.compliance.kyc(STUDENT)["level"] == "verified_basic" and st2.bank.pin_record(SPONSOR)
    st2.bank.db.close()
