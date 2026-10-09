"""HTTP API.

Roles come from the bearer token, never from the request body or chat text.
Demo tokens can be overridden with HB_STUDENT_TOKEN / HB_SPONSOR_TOKEN.
"""
from __future__ import annotations

import copy
import os
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from datetime import date
from typing import Dict, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .agent import Agent
from .audit import AuditLog
from .bank import Bank
from .config import Limits, Settings, load_settings
from .fx import FxMarket
from .policy import PolicyEngine, PolicyError
from .seed import SPONSOR, STUDENT
from .tools import ToolContext, budget_summary, get_tuition_schedule

WEB_DIR = Path(os.getenv("HB_WEB_DIR", Path(__file__).resolve().parents[2] / "app" / "dist"))
CHATS_PER_MINUTE = int(os.getenv("HB_CHATS_PER_MINUTE", "30"))


class ChatIn(BaseModel):
    message: str = Field(..., max_length=4000)
    session_id: str = Field("default", max_length=64)


class ConfirmIn(BaseModel):
    token: str


class DecisionIn(BaseModel):
    note: str = Field("", max_length=200)


class LimitsIn(BaseModel):
    single_cad: float = Field(..., gt=0, le=20000)
    daily_cad: float = Field(..., gt=0, le=50000)


@dataclass
class AppState:
    settings: Settings
    bank: Bank
    fx: FxMarket
    audit: AuditLog
    policy: PolicyEngine
    agent: Agent

    def reset(self) -> None:
        defaults = Limits()
        self.settings.limits.single_cad, self.settings.limits.daily_cad = defaults.single_cad, defaults.daily_cad
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
    # A file database (HB_DB) from an earlier run keeps its balances and pending drafts; only a new
    # or empty one is seeded.
    if not bank.is_seeded():
        bank.reset(agent.today)
        policy.reset()
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

    chat_times: Dict[str, deque] = {}

    def _chat_rate_limit(user_id: str) -> None:
        q = chat_times.setdefault(user_id, deque())
        now = time.time()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= CHATS_PER_MINUTE:
            st.audit.record("rate_limited", user_id, endpoint="/chat")
            raise HTTPException(429, "Too many messages. Please wait a minute.")
        q.append(now)

    @app.get("/health")
    def health():
        return {"ok": True, "provider": getattr(st.agent.provider, "name", "?"), "demo_mode": st.settings.demo_mode}

    @app.get("/me")
    def me(who=Depends(auth)):
        u = st.bank.user(who[0])
        return {"id": who[0], "role": who[1], "name": u["name"] if u else who[0]}

    @app.post("/chat")
    def chat(body: ChatIn, user_id: str = Depends(student)):
        _chat_rate_limit(user_id)
        return st.agent.run(user_id, "student", f"{user_id}:{body.session_id}", body.message).to_dict()

    @app.get("/accounts")
    def accounts(user_id: str = Depends(student)):
        return {"accounts": st.bank.accounts(user_id), "payees": st.bank.payees(user_id),
                "tuition": st.bank.tuition(user_id)}

    @app.get("/overview")
    def overview_student(user_id: str = Depends(student)):
        """Wallet screen: the same read-only data the agent's tools see."""
        ctx = ToolContext(user_id=user_id, role="student", session_id="overview", bank=st.bank, fx=st.fx,
                          policy=st.policy, audit=st.audit, today=st.agent.today)
        accs = st.bank.accounts(user_id)
        total = sum(a["balance"] * st.fx.mid(a["currency"], "CAD") for a in accs)
        pending = [st.policy.present(a) for a in st.policy.list_for(user_id, ["awaiting_user", "awaiting_sponsor"])]
        return {"accounts": accs, "total_cad": round(total, 2), "tuition": get_tuition_schedule(ctx, {}),
                "budget": budget_summary(ctx, {}), "reminders": st.bank.reminders(user_id),
                "payees": st.bank.payees(user_id), "pending": pending,
                "limits": {"single_cad": st.settings.limits.single_cad, "daily_cad": st.settings.limits.daily_cad},
                "rates": {"MYR/CAD": st.fx.mid("MYR", "CAD"), "CAD/MYR": round(st.fx.mid("CAD", "MYR"), 4)}}

    @app.get("/actions")
    def actions(user_id: str = Depends(student)):
        return {"actions": [st.policy.present(a, include_token=True) for a in st.policy.list_for(user_id)]}

    @app.post("/actions/{action_id}/confirm")
    def confirm(action_id: str, body: ConfirmIn, user_id: str = Depends(student)):
        try:
            return st.policy.present(st.policy.confirm(action_id, user_id, body.token))
        except PolicyError as e:
            _err(e)

    @app.post("/actions/{action_id}/cancel")
    def cancel(action_id: str, user_id: str = Depends(student)):
        try:
            return st.policy.present(st.policy.cancel(action_id, user_id))
        except PolicyError as e:
            _err(e)

    @app.get("/sponsor/queue")
    def queue(sponsor_id: str = Depends(sponsor)):
        return {"actions": [st.policy.present(a) for a in st.policy.sponsor_queue(sponsor_id)]}

    @app.get("/sponsor/overview")
    def overview(sponsor_id: str = Depends(sponsor)):
        accs = st.bank.accounts(STUDENT)
        return {"student": st.bank.user(STUDENT), "accounts": accs,
                "total_cad": round(sum(a["balance"] * st.fx.mid(a["currency"], "CAD") for a in accs), 2),
                "limits": st.settings.limits.__dict__,
                "recent": [st.policy.present(a) for a in st.policy.list_for(STUDENT)][-10:]}

    @app.post("/sponsor/limits")
    def set_limits(body: LimitsIn, sponsor_id: str = Depends(sponsor)):
        """T4 for the agent: limits change only here, with the sponsor's own credentials."""
        if body.single_cad > body.daily_cad:
            raise HTTPException(400, "The single-payment limit cannot be higher than the 24-hour limit.")
        lim = st.settings.limits
        before = {"single_cad": lim.single_cad, "daily_cad": lim.daily_cad}
        lim.single_cad, lim.daily_cad = round(body.single_cad, 2), round(body.daily_cad, 2)
        st.audit.record("limits_changed", sponsor_id, before=before,
                        after={"single_cad": lim.single_cad, "daily_cad": lim.daily_cad})
        return {"limits": lim.__dict__}

    @app.post("/sponsor/actions/{action_id}/approve")
    def approve(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        try:
            return st.policy.present(st.policy.sponsor_decide(action_id, sponsor_id, True, body.note))
        except PolicyError as e:
            _err(e)

    @app.post("/sponsor/actions/{action_id}/reject")
    def reject(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        try:
            return st.policy.present(st.policy.sponsor_decide(action_id, sponsor_id, False, body.note))
        except PolicyError as e:
            _err(e)

    @app.get("/audit")
    def audit(since: int = 0, who=Depends(auth)):
        return {"entries": st.audit.entries(since)[-200:]}

    @app.get("/audit/verify")
    def audit_verify(tamper_seq: Optional[int] = None, who=Depends(auth)):
        """With tamper_seq, verifies a copy of the log with that entry edited, to show detection live."""
        if tamper_seq is None:
            return st.audit.verify()
        entries = copy.deepcopy(st.audit.entries())
        if not 0 <= tamper_seq < len(entries):
            raise HTTPException(400, "No such entry")
        entries[tamper_seq]["data"]["_tampered"] = True
        res = AuditLog.verify_entries(entries)
        res["simulated_tamper_seq"] = tamper_seq
        return res

    @app.post("/demo/reset")
    def demo_reset(who=Depends(auth)):
        if not st.settings.demo_mode:
            raise HTTPException(403, "Reset is only available in demo mode")
        st.reset()
        chat_times.clear()
        return {"ok": True}

    # Serve the exported web app from the same origin when it has been built (npm run build:web).
    # Registered last so API routes always win.
    if (WEB_DIR / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

    return app


app = create_app() if os.getenv("HB_NO_AUTOAPP") != "1" else None
