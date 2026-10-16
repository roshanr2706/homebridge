"""Cards, wallet overview, sponsor-only limits, audit tamper simulation, rate limits."""
import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.harness import fresh
from app.main import create_app

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}


@pytest.fixture()
def api():
    st = fresh()
    return TestClient(create_app(st)), st


def chat(client, msg):
    r = client.post("/chat", json={"message": msg}, headers=S)
    assert r.status_code == 200, r.text
    return r.json()


def test_fx_comparison_returns_quote_card(api):
    client, _ = api
    r = chat(client, "Cheapest way to change 5,000 MYR to CAD?")
    card = next(c for c in r["cards"] if c["type"] == "fx_quotes")
    assert card["from_currency"] == "MYR" and card["to_currency"] == "CAD"
    receives = [q["you_receive"] for q in card["quotes"]]
    assert receives == sorted(receives, reverse=True)


def test_balance_card_is_masked(api):
    client, st = api
    r = chat(client, "How much money do I have?")
    card = next(c for c in r["cards"] if c["type"] == "balances")
    raw = {row[0] for row in st.bank.db.execute("SELECT number FROM accounts")}
    assert all(a["number"].startswith("••••") for a in card["accounts"])
    assert not any(n in str(r) for n in raw)


def test_scam_card_and_no_memo_leak(api):
    client, _ = api
    r = chat(client, "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'")
    card = next(c for c in r["cards"] if c["type"] == "scam_check")
    assert card["verdict"] == "likely_scam"
    r = chat(client, "show my recent transactions")
    card = next(c for c in r["cards"] if c["type"] == "transactions")
    assert all("memo" not in row for row in card["rows"])


def test_drafting_a_payment_suppresses_lookup_cards(api):
    client, _ = api
    r = chat(client, "Pay rent to my landlord")
    assert r["actions"] and not any(c["type"] == "transactions" for c in r["cards"])


def test_overview(api):
    client, _ = api
    o = client.get("/overview", headers=S).json()
    assert o["total_cad"] > 0 and o["tuition"]["installments"] and o["budget"]["categories"]
    assert client.get("/overview", headers=P).status_code == 403


def test_only_sponsor_changes_limits_and_they_apply(api):
    client, st = api
    assert client.post("/sponsor/limits", json={"single_cad": 50000, "daily_cad": 50000}, headers=S).status_code == 403
    assert client.post("/sponsor/limits", json={"single_cad": 3000, "daily_cad": 2000}, headers=P).status_code == 400
    r = client.post("/sponsor/limits", json={"single_cad": 30, "daily_cad": 3000, "pin": "246810"}, headers=P)
    assert r.status_code == 200
    a = chat(client, "pay hydro 45")["actions"][0]
    assert a["tier"] == "T3"  # above the new single-payment limit
    assert any(e["event"] == "limits_changed" for e in st.audit.entries())
    client.post("/demo/reset", headers={**P, "X-Operator": "demo-operator"})
    assert st.settings.limits.single_cad == 1500


def test_simulated_tamper_is_detected_without_changing_log(api):
    client, st = api
    chat(client, "How much money do I have?")
    n = len(st.audit.entries())
    r = client.get("/audit/verify?tamper_seq=1", headers=S).json()
    assert r["ok"] is False and r["broken_at"] == 1
    assert client.get("/audit/verify", headers=S).json()["ok"] is True
    assert len(st.audit.entries()) == n


def test_chat_rate_limit(api, monkeypatch):
    monkeypatch.setattr(main_mod, "CHATS_PER_MINUTE", 3)
    client = TestClient(create_app(fresh()))
    codes = [client.post("/chat", json={"message": "hi"}, headers=S).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


@pytest.mark.parametrize("text", [
    "兑换五千令吉的手续费是多少？",          # what's the fee to convert 5,000 ringgit?
    "换五千令吉要交多少手续费？",            # how much fee do I pay to change 5,000 ringgit?
    "领事馆办护照要多久",                     # how long does the consulate take for a passport?
    "我的银行卡在加拿大能用吗",
    "Berapa yuran tukar wang ke dolar Kanada?",
])
def test_ordinary_chinese_and_malay_questions_are_not_flagged(text):
    from app.guard import check
    assert check(text).flags == [], check(text).to_dict()


def test_balance_warning_is_recomputed_when_shown(api):
    client, st = api
    a = chat(client, "Pay my spring tuition")["actions"][0]
    assert any("lower than this amount" in w for w in a["warnings"])
    client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S)
    st.bank._x("UPDATE accounts SET balance=balance+125000 WHERE id='acc_tui'")
    queued = client.get("/sponsor/queue", headers=P).json()["actions"][0]
    assert not any("lower than this amount" in w for w in queued["warnings"])


def test_dotenv_fills_gaps_but_never_overrides(tmp_path, monkeypatch):
    from app.config import load_dotenv
    env = tmp_path / ".env"
    env.write_text("# comment\nHB_TEST_DOTENV_A=from-file\nHB_TEST_DOTENV_B='quoted'\nLLM_PROVIDER=deepseek\n", encoding="utf-8")
    monkeypatch.delenv("HB_TEST_DOTENV_A", raising=False)
    monkeypatch.delenv("HB_TEST_DOTENV_B", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "offline")
    load_dotenv(env)
    import os
    assert os.environ["HB_TEST_DOTENV_A"] == "from-file"
    assert os.environ["HB_TEST_DOTENV_B"] == "quoted"
    assert os.environ["LLM_PROVIDER"] == "offline"   # already set: the file never overrides it
