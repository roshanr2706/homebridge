"""Capture offline fixtures for the neobank UI variant.

Runs the real HomeBridge backend in-process (FastAPI TestClient, offline engine, fixed demo date) and
writes the JSON the UI reads into src/fixtures/. The UI uses these only when the live API on :8000 is
unreachable, and shows a "Demo data" chip when it does.

    ../../backend/.venv/Scripts/python.exe scripts/capture_fixtures.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "src" / "fixtures"
BACKEND = HERE.parents[2] / "backend"

os.environ.setdefault("HB_NO_AUTOAPP", "1")
os.environ.setdefault("LLM_PROVIDER", "offline")
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

from app.harness import fresh  # noqa: E402
from app.main import create_app  # noqa: E402

S = {"Authorization": "Bearer demo-student"}
P = {"Authorization": "Bearer demo-sponsor"}

MESSAGES = {
    "balance": "How much money do I have?",
    "fx": "Cheapest way to change 5,000 MYR to CAD?",
    "runway": "Will I run out of money before tuition is due?",
    "credit": "How's my credit?",
    "rent": "Pay rent to my landlord",
    "tuition": "Pay my spring tuition",
    "scam": (
        "Is this a scam? \"CRA NOTICE: You owe $1,980 in unpaid taxes. Pay today with Apple gift cards "
        "or a warrant will be issued for your arrest. Call 1-866-555-0199 now.\""
    ),
    "zh_runway": "我的钱够用到学期末吗？",
    "transactions": "Show my recent transactions",
    "cover": "Cover the tuition shortfall from my MYR wallet",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    client = TestClient(create_app(fresh()))

    def get(path: str, h=S):
        r = client.get(path, headers=h)
        r.raise_for_status()
        return r.json()

    def post(path: str, body=None, h=S):
        r = client.post(path, json=body, headers=h)
        r.raise_for_status()
        return r.json()

    data: dict = {
        "overview": get("/overview"),
        "forecast": get("/forecast"),
    }
    chats = []
    for key, msg in MESSAGES.items():
        res = post("/chat", {"message": msg, "session_id": f"fixture-{key}"})
        chats.append({"key": key, "message": msg, "response": res})
    data["chats"] = chats

    # Confirm rent (executes) and tuition (goes to the sponsor) so the sponsor side has a queue, a
    # digest and an executed payment. The chat fixtures above keep the drafts as first returned.
    for key in ("rent", "tuition"):
        for a in next(c for c in chats if c["key"] == key)["response"]["actions"]:
            if a.get("status") == "awaiting_user" and a.get("confirm_token"):
                post(f"/actions/{a['action_id']}/confirm", {"token": a["confirm_token"]})

    data["sponsor_overview"] = get("/sponsor/overview", P)
    data["sponsor_queue"] = get("/sponsor/queue", P)
    data["audit"] = get("/audit", P)
    data["audit_student"] = get("/audit")
    data["audit_verify"] = get("/audit/verify", P)

    for name, value in data.items():
        (OUT / f"{name}.json").write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
