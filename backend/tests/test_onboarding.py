"""Onboarding, preferences and consents: GET /me, POST /me/onboarding, POST /me/prefs, the per-user offline-engine
override, the audit trail and the demo reset."""
import pytest
from fastapi.testclient import TestClient

from app.harness import fresh
from app.main import create_app
from app.seed import SPONSOR, STUDENT

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}
OP = {"X-Operator": "demo-operator"}

STUDENT_OK = {"display_name": "  Aisha  R. ", "language": "zh", "skin": "superapp",
              "consents": {"sponsor_sharing": True, "ai_processing": True}}
SPONSOR_OK = {"display_name": "Dad", "language": "en", "skin": "superapp", "consents": {"sponsor_terms": True}}


class CloudProvider:
    """Stands in for a cloud model (DeepSeek): records every call and never touches the network."""
    name = "deepseek"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, tools):
        self.calls += 1
        return {"role": "assistant", "content": "cloud reply"}


@pytest.fixture()
def api():
    st = fresh()
    return TestClient(create_app(st)), st


@pytest.fixture()
def cloud():
    provider = CloudProvider()
    st = fresh(provider=provider)
    return TestClient(create_app(st)), st, provider


def events(st, name):
    return [e for e in st.audit.entries() if e["event"] == name]


def test_me_before_onboarding_has_defaults(api):
    client, _ = api
    me = client.get("/me", headers=S).json()
    assert me["role"] == "student" and me["prefs"]["onboarded_at"] is None
    assert me["prefs"]["skin"] == "neo" and me["prefs"]["language"] == "en" and me["prefs"]["consents"] == {}
    assert me["model_route"] == {"provider": "offline", "label": "HomeBridge's built-in offline engine",
                                 "region": "server", "leaves_server": False}
    assert client.get("/me", headers=P).json()["prefs"]["skin"] == "superapp"
    assert client.get("/me").status_code == 401


def test_student_onboarding_stores_prefs_and_consents(api):
    client, st = api
    r = client.post("/me/onboarding", json=STUDENT_OK, headers=S)
    assert r.status_code == 200, r.text
    p = r.json()["prefs"]
    assert p["display_name"] == "Aisha R." and p["language"] == "zh" and p["skin"] == "superapp"
    assert p["onboarded_at"] and p["consents"]["sponsor_sharing"]["agreed"] is True
    assert p["consents"]["ai_processing"]["provider"] == "offline"
    assert p["consents"]["offline_only"]["value"] is False
    # Persisted in the sandbox database, not just echoed.
    assert st.bank.load_prefs(STUDENT)["skin"] == "superapp"
    assert client.get("/me", headers=S).json()["prefs"] == p
    # The sponsor's own prefs are untouched.
    assert client.get("/me", headers=P).json()["prefs"]["onboarded_at"] is None


def test_onboarding_validation(api):
    client, _ = api
    bad = [
        {**STUDENT_OK, "skin": "material"},
        {**STUDENT_OK, "language": "fr"},
        {**STUDENT_OK, "display_name": "x" * 81},
        {**STUDENT_OK, "consents": {**STUDENT_OK["consents"], "share_everything": True}},
        {k: v for k, v in STUDENT_OK.items() if k != "skin"},
    ]
    for body in bad:
        assert client.post("/me/onboarding", json=body, headers=S).status_code == 422, body
    # The sponsor-sharing consent is required for the student.
    r = client.post("/me/onboarding", json={**STUDENT_OK, "consents": {"ai_processing": True}}, headers=S)
    assert r.status_code == 400 and "sponsor" in r.json()["detail"]
    # The sponsor must acknowledge the PIN and his view.
    r = client.post("/me/onboarding", json={**SPONSOR_OK, "consents": {}}, headers=P)
    assert r.status_code == 400
    assert client.get("/me", headers=S).json()["prefs"]["onboarded_at"] is None


def test_display_name_is_cleaned_and_capped(api):
    client, _ = api
    r = client.post("/me/onboarding", json={**STUDENT_OK, "display_name": "‮Ai\x00sha\n\n  Rahman " + "z" * 60},
                    headers=S)
    name = r.json()["prefs"]["display_name"]
    assert name.startswith("Aisha Rahman") and len(name) <= 40 and "\x00" not in name and "‮" not in name
    r = client.post("/me/prefs", json={"display_name": "   "}, headers=S)
    assert r.json()["prefs"]["display_name"] == name  # blank keeps the current name


def test_onboarding_applies_to_the_callers_own_token_only(api):
    client, st = api
    # No way to name another user: the body has no user id and extra fields are refused.
    assert client.post("/me/onboarding", json={**SPONSOR_OK, "user_id": STUDENT}, headers=P).status_code == 422
    assert client.post("/me/onboarding", json=STUDENT_OK).status_code == 401
    assert client.post("/me/onboarding", json=STUDENT_OK, headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.post("/me/onboarding", json=SPONSOR_OK, headers=P)
    assert r.status_code == 200 and r.json()["id"] == SPONSOR
    assert st.bank.load_prefs(STUDENT) is None
    # The sponsor has no chat-model setting.
    assert client.post("/me/prefs", json={"offline_only": True}, headers=P).status_code == 400


def test_consents_and_prefs_are_audited_without_free_text(api):
    client, st = api
    client.post("/me/onboarding", json=STUDENT_OK, headers=S)
    consents = events(st, "consent_recorded")
    assert {e["data"]["consent"] for e in consents} == {"sponsor_sharing", "ai_processing", "offline_only"}
    assert all(e["actor"] == STUDENT and e["data"]["owner"] == STUDENT for e in consents)
    ai = next(e for e in consents if e["data"]["consent"] == "ai_processing")
    assert ai["data"]["provider"] == "offline" and ai["data"]["leaves_server"] is False
    upd = events(st, "prefs_updated")
    assert len(upd) == 1 and upd[0]["data"]["skin"] == "superapp"
    assert "Aisha" not in str(consents + upd)  # the name itself never goes into the log
    assert st.audit.verify()["ok"]
    # The student sees her own consent entries; the sponsor does not see them.
    mine = {e["event"] for e in client.get("/audit", headers=S).json()["entries"]}
    assert {"consent_recorded", "prefs_updated"} <= mine
    his = {e["event"] for e in client.get("/audit", headers=P).json()["entries"]}
    assert not {"consent_recorded", "prefs_updated"} & his


def test_prefs_update_changes_only_what_is_sent(api):
    client, st = api
    client.post("/me/onboarding", json=STUDENT_OK, headers=S)
    before = len(events(st, "prefs_updated"))
    r = client.post("/me/prefs", json={"skin": "neo"}, headers=S)
    p = r.json()["prefs"]
    assert p["skin"] == "neo" and p["language"] == "zh" and p["onboarded_at"]
    assert p["consents"]["sponsor_sharing"]["agreed"] is True
    assert len(events(st, "prefs_updated")) == before + 1
    client.post("/me/prefs", json={"skin": "neo"}, headers=S)  # no change, no entry
    assert len(events(st, "prefs_updated")) == before + 1
    assert client.post("/me/prefs", json={"skin": "playful"}, headers=S).status_code == 422


def test_demo_reset_clears_onboarding(api):
    client, st = api
    client.post("/me/onboarding", json=STUDENT_OK, headers=S)
    client.post("/me/onboarding", json=SPONSOR_OK, headers=P)
    assert client.post("/demo/reset", headers=S).status_code == 403  # still needs the operator header
    assert client.get("/me", headers=S).json()["prefs"]["onboarded_at"]
    assert client.post("/demo/reset", headers={**S, **OP}).status_code == 200
    assert client.get("/me", headers=S).json()["prefs"]["onboarded_at"] is None
    assert client.get("/me", headers=P).json()["prefs"]["onboarded_at"] is None


def test_cloud_provider_needs_consent_or_offline_choice(cloud):
    client, _, _ = cloud
    me = client.get("/me", headers=S).json()
    assert me["model_route"]["provider"] == "deepseek" and me["model_route"]["region"] == "cn"
    assert me["model_route"]["leaves_server"] is True
    r = client.post("/me/onboarding", json={**STUDENT_OK, "consents": {"sponsor_sharing": True}}, headers=S)
    assert r.status_code == 400 and "offline" in r.json()["detail"]


def test_offline_only_keeps_chat_off_the_cloud_model(cloud):
    client, st, provider = cloud
    client.post("/chat", json={"message": "how much money do I have"}, headers=S)
    assert provider.calls == 1  # not onboarded yet: the configured model
    body = {**STUDENT_OK, "consents": {"sponsor_sharing": True, "offline_only": True}}
    me = client.post("/me/onboarding", json=body, headers=S).json()
    assert me["chat_engine"] == "offline" and me["prefs"]["consents"]["offline_only"]["value"] is True
    r = client.post("/chat", json={"message": "how much money do I have"}, headers=S).json()
    assert provider.calls == 1 and r["provider"] == "offline" and not r["fallback"]
    assert any(c["type"] == "balances" for c in r["cards"])
    # The privacy answer reports the engine actually used for this person.
    r = client.post("/chat", json={"message": "is my data sent to China?"}, headers=S).json()
    assert provider.calls == 1 and r["provider"] == "offline"
    # Turning it off in Settings (which shows the provider and region) records the consent and uses the model.
    me = client.post("/me/prefs", json={"offline_only": False}, headers=S).json()
    assert me["chat_engine"] == "deepseek" and me["prefs"]["consents"]["ai_processing"]["agreed"] is True
    assert me["prefs"]["consents"]["ai_processing"]["region"] == "cn"
    r = client.post("/chat", json={"message": "how much money do I have"}, headers=S).json()
    assert provider.calls == 2 and r["provider"] == "deepseek"
    assert [e["data"]["consent"] for e in events(st, "consent_recorded")][-2:] == ["offline_only", "ai_processing"]


def test_consented_cloud_user_keeps_the_cloud_model(cloud):
    client, _, provider = cloud
    client.post("/me/onboarding", json=STUDENT_OK, headers=S)
    r = client.post("/chat", json={"message": "hello"}, headers=S).json()
    assert provider.calls == 1 and r["provider"] == "deepseek"
    me = client.post("/me/prefs", json={"offline_only": True}, headers=S).json()
    assert me["chat_engine"] == "offline"
    client.post("/chat", json={"message": "hello"}, headers=S)
    assert provider.calls == 1
