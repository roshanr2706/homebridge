"""Capture offline fixtures for the Material UI variant from the real HomeBridge backend.

Runs the FastAPI app in-process (TestClient, offline engine, fresh sandbox) so no server is needed:

    <repo>/backend/.venv/Scripts/python.exe ui-variants/material/scripts/capture_fixtures.py

Writes JSON files into ui-variants/material/src/fixtures/.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # repo root (ui-variants/material/scripts -> repo)
BACKEND = ROOT / "backend"
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
    ("balances", "How much money do I have?"),
    ("fx", "Cheapest way to change 5,000 MYR to CAD?"),
    ("runway", "Will I run out of money before tuition is due?"),
    ("credit", "How's my credit?"),
    ("tuition_due", "When is my tuition due?"),
    ("budget", "How's my budget this month?"),
    ("transactions", "Show my recent transactions"),
    ("rent", "Pay rent to my landlord"),
    ("tuition", "Pay my spring tuition"),
    ("cover_gap", "Cover the tuition shortfall from my MYR wallet"),
    ("scam", "I got a text: \"This is the CRA. You owe $1,850 in back taxes. Pay today with Apple gift cards "
             "or police will arrest you.\" Is this real?"),
    ("zh_runway", "我的钱够用到学期末吗？"),
]


def ok(r):
    assert r.status_code == 200, f"{r.request.url}: {r.status_code} {r.text}"
    return r.json()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    client = TestClient(create_app(fresh()))

    def dump(name: str, data) -> None:
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print("wrote", name)

    dump("health", ok(client.get("/health")))
    dump("overview", ok(client.get("/overview", headers=S)))
    dump("forecast", ok(client.get("/forecast", headers=S)))

    chats = []
    for key, msg in MESSAGES:
        res = ok(client.post("/chat", json={"message": msg, "session_id": f"fixture-{key}"}, headers=S))
        chats.append({"key": key, "message": msg, "response": res})
    dump("chats", chats)

    # Confirm one T3 payment so the sponsor fixtures have something waiting for approval.
    actions = ok(client.get("/actions", headers=S))["actions"]
    for a in actions:
        if a["status"] == "awaiting_user" and a["needs_sponsor_approval"] and a.get("confirm_token"):
            ok(client.post(f"/actions/{a['action_id']}/confirm", json={"token": a["confirm_token"]}, headers=S))
            break
    dump("actions", ok(client.get("/actions", headers=S)))
    dump("sponsor_overview", ok(client.get("/sponsor/overview", headers=P)))
    dump("sponsor_queue", ok(client.get("/sponsor/queue", headers=P)))
    dump("audit", ok(client.get("/audit", headers=S)))  # the student's view (the sandbox scopes it per role)
    dump("audit_verify", ok(client.get("/audit/verify", headers=P)))


if __name__ == "__main__":
    main()
