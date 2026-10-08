"""HTTP API.

Roles come from the bearer token, never from the request body or chat text.
Demo tokens can be overridden with HB_STUDENT_TOKEN / HB_SPONSOR_TOKEN.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from typing import Dict, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import Agent
from .audit import AuditLog
from .bank import Bank
from .config import Settings, load_settings
from .fx import FxMarket
from .policy import PolicyEngine, PolicyError
from .seed import SPONSOR, STUDENT


class ChatIn(BaseModel):
    message: str = Field(..., max_length=4000)
    session_id: str = Field("default", max_length=64)


class ConfirmIn(BaseModel):
    token: str


class DecisionIn(BaseModel):
    note: str = ""


@dataclass
class AppState:
    settings: Settings
    bank: Bank
    fx: FxMarket
    audit: AuditLog
    policy: PolicyEngine
    agent: Agent

    def reset(self) -> None:
        self.bank.reset(self.agent.today)
        self.policy.reset()
        self.agent.reset()
        self.audit.record("demo_reset", "system")


def build_state(settings: Optional[Settings] = None, today: Optional[date] = None, provider=None,
                audit_path: Optional[str] = "default") -> AppState:
    settings = settings or load_settings()
    bank = Bank(settings.db_path)
    fx = FxMarket()
    audit = AuditLog(settings.audit_path if audit_path == "default" else audit_path)
    policy = PolicyEngine(bank, fx, audit, settings.limits)
    agent = Agent(settings, bank, fx, policy, audit, provider=provider, today=today)
    bank.reset(agent.today)
    return AppState(settings, bank, fx, audit, policy, agent)


def create_app(state: Optional[AppState] = None) -> FastAPI:
    st = state or build_state()
    tokens: Dict[str, Tuple[str, str]] = {
        os.getenv("HB_STUDENT_TOKEN", "demo-student"): (STUDENT, "student"),
        os.getenv("HB_SPONSOR_TOKEN", "demo-sponsor"): (SPONSOR, "sponsor"),
    }
    app = FastAPI(title="HomeBridge API", version="0.1.0")
    app.state.hb = st
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    def auth(authorization: str = Header(default="")) -> Tuple[str, str]:
        token = authorization.replace("Bearer ", "").strip()
        if token not in tokens:
            raise HTTPException(401, "Invalid or missing token")
        return tokens[token]

    def student(who=Depends(auth)) -> str:
        if who[1] != "student":
            raise HTTPException(403, "Student only")
        return who[0]

    def sponsor(who=Depends(auth)) -> str:
        if who[1] != "sponsor":
            raise HTTPException(403, "Sponsor only")
        return who[0]

    def _err(e: PolicyError):
        raise HTTPException(400, str(e))

    @app.get("/health")
    def health():
        return {"ok": True, "provider": getattr(st.agent.provider, "name", "?"), "demo_mode": st.settings.demo_mode}

    @app.get("/me")
    def me(who=Depends(auth)):
        u = st.bank.user(who[0])
        return {"id": who[0], "role": who[1], "name": u["name"] if u else who[0]}

    @app.post("/chat")
    def chat(body: ChatIn, user_id: str = Depends(student)):
        return st.agent.run(user_id, "student", f"{user_id}:{body.session_id}", body.message).to_dict()

    @app.get("/accounts")
    def accounts(user_id: str = Depends(student)):
        return {"accounts": st.bank.accounts(user_id), "payees": st.bank.payees(user_id),
                "tuition": st.bank.tuition(user_id)}

    @app.get("/actions")
    def actions(user_id: str = Depends(student)):
        return {"actions": [a.for_app(include_token=True) for a in st.policy.list_for(user_id)]}

    @app.post("/actions/{action_id}/confirm")
    def confirm(action_id: str, body: ConfirmIn, user_id: str = Depends(student)):
        try:
            return st.policy.confirm(action_id, user_id, body.token).for_app()
        except PolicyError as e:
            _err(e)

    @app.post("/actions/{action_id}/cancel")
    def cancel(action_id: str, user_id: str = Depends(student)):
        try:
            return st.policy.cancel(action_id, user_id).for_app()
        except PolicyError as e:
            _err(e)

    @app.get("/sponsor/queue")
    def queue(sponsor_id: str = Depends(sponsor)):
        return {"actions": [a.for_app() for a in st.policy.sponsor_queue(sponsor_id)]}

    @app.get("/sponsor/overview")
    def overview(sponsor_id: str = Depends(sponsor)):
        return {"student": st.bank.user(STUDENT), "accounts": st.bank.accounts(STUDENT),
                "limits": st.settings.limits.__dict__,
                "recent": [a.for_app() for a in st.policy.list_for(STUDENT)][-10:]}

    @app.post("/sponsor/actions/{action_id}/approve")
    def approve(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        try:
            return st.policy.sponsor_decide(action_id, sponsor_id, True, body.note).for_app()
        except PolicyError as e:
            _err(e)

    @app.post("/sponsor/actions/{action_id}/reject")
    def reject(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        try:
            return st.policy.sponsor_decide(action_id, sponsor_id, False, body.note).for_app()
        except PolicyError as e:
            _err(e)

    @app.get("/audit")
    def audit(since: int = 0, who=Depends(auth)):
        return {"entries": st.audit.entries(since)[-200:]}

    @app.get("/audit/verify")
    def audit_verify(who=Depends(auth)):
        return st.audit.verify()

    @app.post("/demo/reset")
    def demo_reset(who=Depends(auth)):
        if not st.settings.demo_mode:
            raise HTTPException(403, "Reset is only available in demo mode")
        st.reset()
        return {"ok": True}

    return app


app = create_app() if os.getenv("HB_NO_AUTOAPP") != "1" else None
