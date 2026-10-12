"""Capture offline fixtures for the super-app UI variant.

Runs the real HomeBridge backend in-process (FastAPI TestClient, offline engine, fixed demo date) and saves
the JSON the UI needs to src/fixtures/. The UI uses these only when the live API on :8000 is unreachable.

    C:/Users/rosha/Desktop/Projects/FinTechathon/homebridge/backend/.venv/Scripts/python.exe scripts/capture_fixtures.py

Set HB_BACKEND to point at a different backend folder (default: <repo>/backend).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # ui-variants/superapp/scripts -> repo root
BACKEND = Path(os.getenv("HB_BACKEND", ROOT / "backend"))
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
    # Extra prompts behind home-screen tiles, so the offline demo covers them too.
    "Show my recent transactions",
    "How is my budget this month?",
    "When is my tuition due?",
    "Is now a good time to convert MYR to CAD?",
    "Pay my card",
    "Cover the tuition shortfall from my MYR wallet",
    "Ask my dad for CAD 300 for textbooks",
]


def get(client, path, headers):
    r = client.get(path, headers=headers)
    r.raise_for_status()
    return r.json()


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {name}.json")


def main():
    client = TestClient(create_app(fresh()))
    save("overview", get(client, "/overview", S))
    save("forecast", get(client, "/forecast", S))

    chats = []
    for i, msg in enumerate(MESSAGES):
        r = client.post("/chat", json={"message": msg, "session_id": f"fixture-{i}"}, headers=S)
        r.raise_for_status()
        body = r.json()
        body.pop("trace", None)
        chats.append({"message": msg, "response": body})
    save("chat", chats)

    # Confirm every drafted action so the sponsor queue has something in it, and keep the confirm
    # responses so the offline UI can show the post-confirm state.
    actions = get(client, "/actions", S)["actions"]
    confirmed = {}
    for a in actions:
        if a["status"] == "awaiting_user" and a.get("confirm_token"):
            r = client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S)
            if r.status_code == 200:
                confirmed[a["action_id"]] = r.json()
    save("confirmed", confirmed)
    save("sponsor_overview", get(client, "/sponsor/overview", P))
    save("sponsor_queue", get(client, "/sponsor/queue", P))


if __name__ == "__main__":
    main()
