"""Capture offline fixtures for the playful UI from the real backend, in-process (no server needed).

Run with the backend's venv python:
    backend/.venv/Scripts/python.exe ui-variants/playful/scripts/capture_fixtures.py
Writes ui-variants/playful/src/fixtures/*.json.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BACKEND = REPO / "backend"
OUT = HERE.parent / "src" / "fixtures"

os.environ.setdefault("HB_NO_AUTOAPP", "1")
os.environ.setdefault("LLM_PROVIDER", "offline")
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402
from app.harness import fresh  # noqa: E402
from app.main import create_app  # noqa: E402

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}

MESSAGES = [
    "How much money do I have?",
    "Cheapest way to change 5,000 MYR to CAD?",
    "Will I run out of money before tuition is due?",
    "How's my credit?",
    "Pay rent to my landlord",
    "Pay my spring tuition",
    "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'",
    "我的钱够用到学期末吗？",
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    client = TestClient(create_app(fresh()))

    def get(path, h=S):
        r = client.get(path, headers=h)
        r.raise_for_status()
        return r.json()

    snap = {"overview": get("/overview"), "forecast": get("/forecast")}
    chats = []
    for i, m in enumerate(MESSAGES):
        r = client.post("/chat", json={"message": m, "session_id": f"fixture-{i}"}, headers=S)
        r.raise_for_status()
        chats.append({"message": m, "response": r.json()})
    tx = client.post("/chat", json={"message": "show my recent transactions", "session_id": "fixture-tx"}, headers=S)
    snap["transactions"] = next((c for c in tx.json()["cards"] if c["type"] == "transactions"), None)

    # Confirm drafts that need the sponsor so the sponsor queue has something to show.
    for c in chats:
        for a in c["response"].get("actions", []):
            if a.get("needs_sponsor_approval") and a.get("confirm_token"):
                client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S)
    snap["sponsor_overview"] = get("/sponsor/overview", P)
    snap["sponsor_queue"] = get("/sponsor/queue", P)
    snap["audit"] = get("/audit", P)
    snap["audit_verify"] = get("/audit/verify", P)

    for name, data in snap.items():
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "chats.json").write_text(json.dumps(chats, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", sorted(p.name for p in OUT.glob("*.json")))


if __name__ == "__main__":
    main()
