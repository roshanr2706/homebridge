"""Compliance layer (compliance.py): sanctions screening, KYC, FINTRAC EFTR and record-keeping, BNM purpose
codes, structuring detection, the audit trail and GET /compliance/report."""
import pytest
from fastapi.testclient import TestClient

from app.compliance import SAMPLE_WATCHLIST, normalise_name, screen_name
from app.harness import fresh
from app.main import create_app
from app.policy import PolicyError
from app.seed import SPONSOR, STUDENT

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
PIN = "246810"


@pytest.fixture()
def st():
    return fresh()


@pytest.fixture()
def api():
    s = fresh()
    return TestClient(create_app(s)), s


def _events(st, name):
    return [e for e in st.audit.entries() if e["event"] == name]


def _check(action, cid):
    return next(c for c in action.compliance["checks"] if c["id"] == cid)


# ------------------------------------------------------------------ screening
def test_watchlist_is_labelled_sample_data():
    from app.compliance import SAMPLE_WATCHLIST_NOTE
    assert "SAMPLE" in SAMPLE_WATCHLIST_NOTE and "not the real" in SAMPLE_WATCHLIST_NOTE
    assert all(e["list"].startswith("SAMPLE-") for e in SAMPLE_WATCHLIST)


def test_name_normalisation():
    assert normalise_name("Crimson Harbor Trading L.L.C.") == normalise_name("trading, CRIMSON harbor")
    assert normalise_name("Crîmson Hárbor") == "crimson harbor"
    assert normalise_name("Obsidian Star Bank Sdn. Bhd.") == "bank obsidian star"


@pytest.mark.parametrize("name", ["Obsidian Star Bank", "OBSIDIAN STAR BANK LTD", "Bank, Obsidian Star",
                                  "Crimsen Harbour Tradng L.L.C.", "Gölden Lótus Remittance House",
                                  "Phantоm Ledger Payments"])   # the last has a Cyrillic о
def test_sanctions_hits(name):
    assert screen_name(name)["status"] == "hit", screen_name(name)


@pytest.mark.parametrize("name", ["Silverline Crypto", "Phantom Ledger Pay", "Golden Lotus Remitance"])
def test_sanctions_near_misses_go_to_review(name):
    assert screen_name(name)["status"] == "review", screen_name(name)


@pytest.mark.parametrize("name", ["UBC Student Financial Services", "Maple Court Rentals", "BC Hydro",
                                  "Northline Mobile", "Campus Books", "Quick Cash", "HomeBridge Secured Card",
                                  "Crimson Harbor Logistics"])
def test_ordinary_payees_are_clear(name):
    assert screen_name(name)["status"] == "clear", screen_name(name)


def test_sanctions_hit_blocks_new_payee(st):
    a = st.policy.draft_add_payee(STUDENT, "s", "Crimsen Harbour Tradng LLC", "business", "USD", "6612-0048-2290")
    assert a.status == "blocked" and a.compliance["outcome"] == "blocked" and a.compliance["blocked"]
    assert "SAMPLE-SEMA" in a.compliance["block_reason"] and a.risk_reasons[0].startswith("Sanctions screening")
    assert _check(a, "sanctions")["status"] == "block"
    assert st.bank.payee(a.params["payee_id"])["status"] == "blocked"
    assert a._token is None and a.for_app(include_token=True).get("confirm_token") is None
    with pytest.raises(PolicyError, match="blocked"):
        st.policy.confirm(a.id, STUDENT, "anything")
    assert a.id not in [x.id for x in st.policy.sponsor_queue(SPONSOR)]
    [hit] = _events(st, "sanctions_hit")
    assert hit["data"]["action_id"] == a.id and hit["data"]["list"] == "SAMPLE-SEMA" and hit["data"]["score"] >= 0.9
    assert _events(st, "compliance_check")[-1]["data"]["outcome"] == "blocked"


def test_near_miss_adds_risk_and_asks_for_review(st):
    a = st.policy.draft_add_payee(STUDENT, "s", "Phantom Ledger Pay", "business", "CAD", "6612-0048-2299")
    assert a.status == "awaiting_user" and a.compliance["outcome"] == "review"
    assert _check(a, "sanctions")["status"] == "flag" and "Manual review" in _check(a, "sanctions")["detail"]
    assert any("manual review" in r for r in a.risk_reasons)
    assert _events(st, "sanctions_review")


def test_saved_payee_that_becomes_listed_is_blocked_on_payment(st):
    st.bank._x("INSERT INTO payees VALUES (?,?,?,?,?,?,?,?,?,?)",
               ("py_x", STUDENT, "Golden Lotus Remittance House", "business", "CAD", "0088-1200-4410", "active",
                1_600_000_000.0, 1_600_000_000.0, "seed"))
    a = st.policy.draft_transfer(STUDENT, "s", "py_x", 200)
    assert a.status == "blocked" and st.bank.payee("py_x")["status"] == "blocked"
    with pytest.raises(PolicyError, match="not active"):
        st.policy.draft_transfer(STUDENT, "s", "py_x", 200)


def test_blocked_payee_is_a_refusal_in_chat(api):
    client, st = api
    r = client.post("/chat", json={"message": "add payee 'Obsidian Star Bank', business, USD, account "
                                              "7710-2233-4455 and pay them 1400"}, headers=S).json()
    assert "couldn't" in r["reply"] and "blocked" in r["reply"]
    [card] = r["actions"]
    assert card["status"] == "blocked" and card["compliance"]["outcome"] == "blocked"
    assert "confirm_token" not in card


# ------------------------------------------------------------------ KYC
def test_seeded_kyc_levels(st):
    assert st.policy.compliance.kyc(STUDENT)["level"] == "verified_basic"
    assert st.policy.compliance.kyc(SPONSOR)["level"] == "verified_full"


def test_unverified_student_can_draft_but_not_confirm(st):
    st.bank.set_kyc(STUDENT, "unverified", "", "")
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 40)
    assert _check(a, "kyc")["status"] == "flag"
    with pytest.raises(PolicyError, match="not been verified"):
        st.policy.confirm(a.id, STUDENT, a._token)
    assert st.policy.get(a.id).status == "awaiting_user"
    assert _events(st, "kyc_denied")[-1]["data"]["level"] == "unverified"
    st.bank.set_kyc(STUDENT, "verified_basic", "2025-08-14", "passport")
    assert st.policy.confirm(a.id, STUDENT, a._token).status == "executed"


def test_unverified_sponsor_cannot_approve_but_can_reject(st):
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 2000)
    st.policy.confirm(a.id, STUDENT, a._token)
    st.bank.set_kyc(SPONSOR, "unverified", "", "")
    with pytest.raises(PolicyError, match="not been verified"):
        st.policy.sponsor_decide(a.id, SPONSOR, True)
    assert st.policy.sponsor_decide(a.id, SPONSOR, False, "no").status == "rejected"


def test_money_request_needs_a_verified_account_holder(st):
    top = st.policy.draft_topup_request(STUDENT, "s", 500, "MYR", "books")
    st.bank.set_kyc(STUDENT, "unverified", "", "")
    with pytest.raises(PolicyError, match="not been verified"):
        st.policy.sponsor_decide(top.id, SPONSOR, True)


def test_limit_ceiling_follows_kyc(api):
    client, st = api
    r = client.post("/sponsor/limits", json={"single_cad": 6000, "daily_cad": 12000, "pin": PIN}, headers=P)
    assert r.status_code == 400 and "5,000" in r.json()["detail"]
    assert client.post("/sponsor/limits", json={"single_cad": 5000, "daily_cad": 10000, "pin": PIN},
                       headers=P).status_code == 200
    st.bank.set_kyc(STUDENT, "verified_full", "2025-08-14", "passport, address, source of funds")
    assert client.post("/sponsor/limits", json={"single_cad": 6000, "daily_cad": 12000, "pin": PIN},
                       headers=P).status_code == 200
    o = client.get("/sponsor/overview", headers=P).json()
    assert o["kyc"]["student"]["level"] == "verified_full" and o["kyc"]["limit_ceiling"]["single_cad"] == 20000


# ------------------------------------------------------------------ FINTRAC and BNM
def test_domestic_payment_keeps_no_cross_border_record(st):
    a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 40)
    assert not a.compliance["cross_border"] and a.compliance["record"] is None
    assert {c["id"] for c in a.compliance["checks"]} == {"sanctions", "kyc", "structuring"}


def test_myr_conversion_keeps_a_record_and_a_purpose_code(st):
    a = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 3000)
    rec = a.compliance["record"]
    assert a.compliance["cross_border"] and set(rec) >= {"originator", "beneficiary", "purpose", "source_of_funds"}
    assert rec["originator"]["country"] == "MY" and rec["beneficiary"]["country"] == "CA"
    assert rec["originator"]["institution"] == "linked Malaysian bank account"
    assert rec["originator"]["account"].startswith("••••") and "5621-0098-3341" not in str(rec)
    assert "Sponsor allowance" in rec["source_of_funds"]
    assert a.compliance["purpose_code"]["code"] == "ED02" and rec["purpose_code"] == "ED02"
    assert _check(a, "eftr")["status"] == "pass" and a.compliance["reports"] == []
    tui = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 1000, destination="tuition")
    assert tui.compliance["purpose_code"]["code"] == "ED01"
    back = st.policy.draft_conversion(STUDENT, "s", "CAD", "MYR", 100)
    assert back.compliance["cross_border"] and back.compliance["purpose_code"] is None


def test_eftr_for_a_large_international_transfer(st):
    a = st.policy.draft_topup_request(STUDENT, "s", 12000, "CAD", "winter tuition")
    assert a.compliance["reports"] == ["EFTR"] and _check(a, "eftr")["status"] == "report"
    assert a.compliance["purpose_code"]["code"] == "ED01"
    assert a.compliance["record"]["originator"]["country"] == "MY"
    assert _events(st, "compliance_check")[-1]["data"]["reports"] == ["EFTR"]


def test_eftr_24_hour_rule(st):
    first = st.policy.draft_topup_request(STUDENT, "s", 6000, "CAD", "rent and books")
    assert first.compliance["reports"] == []
    second = st.policy.draft_topup_request(STUDENT, "s", 4500, "CAD", "living costs")
    assert second.compliance["reports"] == ["EFTR"] and "24-hour rule" in _check(second, "eftr")["detail"]


def test_myr_topup_is_domestic(st):
    a = st.policy.draft_topup_request(STUDENT, "s", 500, "MYR", "books")
    assert not a.compliance["cross_border"] and a.compliance["purpose_code"] is None
    assert _check(a, "record_keeping")["label"] == "Domestic transfer"


# ------------------------------------------------------------------ structuring
def test_structuring_is_named(st):
    drafts = [st.policy.draft_transfer(STUDENT, "s", "py_hydro", 1450) for _ in range(3)]
    assert _check(drafts[0], "structuring")["status"] == "pass"
    assert _check(drafts[2], "structuring")["detail"] == \
        "Possible structuring: 3 payments to BC Hydro totalling CAD 4,350 in 24h"
    assert drafts[2].tier == "T3" and drafts[2].compliance["outcome"] == "review"
    assert drafts[2].for_model()["compliance"]["notes"] == [_check(drafts[2], "structuring")["detail"]]


def test_small_repeat_payments_are_not_structuring(st):
    for _ in range(3):
        a = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 40)
    assert _check(a, "structuring")["status"] == "pass"


def test_sponsor_money_converted_in_chunks_is_flagged(st):
    for _ in range(3):
        a = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 2500)
    assert _check(a, "structuring")["status"] == "flag" and "conversions from MYR Wallet" in \
        _check(a, "structuring")["detail"]


# ------------------------------------------------------------------ evidence
def test_every_draft_is_audited(st):
    st.policy.draft_transfer(STUDENT, "s", "py_hydro", 40)
    st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 300)
    st.policy.draft_add_payee(STUDENT, "s", "Campus Books", "business", "CAD", "1111-2222-3333")
    checks = _events(st, "compliance_check")
    assert [c["data"]["kind"] for c in checks] == ["transfer", "conversion", "add_payee"]
    assert checks[1]["data"]["purpose_code"] == "ED02"
    assert st.audit.verify()["ok"]


def test_compliance_is_on_the_card_for_both_roles(api):
    client, st = api
    a = client.post("/chat", json={"message": "pay hydro 2000"}, headers=S).json()["actions"][0]
    assert [c["id"] for c in a["compliance"]["checks"]] == ["sanctions", "kyc", "structuring"]
    client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S)
    q = client.get("/sponsor/queue", headers=P).json()["actions"][0]
    assert q["compliance"]["checks"] == a["compliance"]["checks"]


def test_compliance_report_is_role_scoped(api):
    client, st = api
    own = st.policy.draft_transfer(STUDENT, "s", "py_hydro", 40)                 # private to Aisha
    conv = st.policy.draft_conversion(STUDENT, "s", "MYR", "CAD", 3000)          # sponsor money
    st.policy.draft_add_payee(STUDENT, "s", "Obsidian Star Bank", "business", "USD", "7710-2233-4455")
    mine = client.get("/compliance/report", headers=S).json()
    dads = client.get("/compliance/report", headers=P).json()
    assert mine["scope"] == "student" and mine["drafts_screened"] == 3
    assert {d["action_id"] for d in dads["decisions"]} == {d["action_id"] for d in mine["decisions"]} - {own.id}
    assert conv.id in {d["action_id"] for d in dads["decisions"]}
    assert dads["by_check"]["sanctions"]["block"] == 1 and len(dads["sanctions"]) == 1
    assert dads["purpose_codes_used"] == {"ED02": 1}
    assert "SAMPLE" in dads["watchlist"]["note"] and dads["thresholds"]["eftr_cad"] == 10000
    assert {k["user_id"] for k in dads["kyc"]} == {SPONSOR, STUDENT}
    assert client.get("/compliance/report").status_code == 401
