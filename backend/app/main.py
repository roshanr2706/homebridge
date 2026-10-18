"""HTTP API.

Roles come from the bearer token, never from the request body or chat text.
Demo tokens can be overridden with HB_STUDENT_TOKEN / HB_SPONSOR_TOKEN.

The sponsor's money decisions (Approve, Unlock, limit changes) also need the sponsor's 6-digit PIN in the
request body, checked on the server (authn.py; demo PIN 246810). Data is scoped by role: the sponsor sees
the accounts they fund, the requests sent to them, alerts and a digest, never the student's own account,
wages or chat. /demo/reset needs demo mode plus the operator token in an X-Operator header.
"""
from __future__ import annotations

import copy
import hmac
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import prefs as user_prefs
from .agent import Agent
from .audit import AuditLog
from .authn import PinChecker, PinError
from .bank import Bank
from .config import Limits, Settings, load_settings
from .fx import FxMarket
from .policy import PendingAction, PolicyEngine, PolicyError
from .privacy import SHARING as PRIVACY_SHARING
from .reviewer import Reviewer
from .safety import SafetyError
from .seed import SPONSOR, STUDENT, seed_security, seed_sponsor_account
from .tools import ToolContext, budget_summary, get_credit_profile, get_tuition_schedule
from .tools import forecast_cashflow
from .cards import forecast_card

WEB_DIR = Path(os.getenv("HB_WEB_DIR", Path(__file__).resolve().parents[2] / "app" / "dist"))
CHATS_PER_MINUTE = int(os.getenv("HB_CHATS_PER_MINUTE", "30"))


class ChatIn(BaseModel):
    message: str = Field(..., max_length=4000)
    # The app makes a fresh id for each "New chat". Rate limits are keyed by the account owner, not this id.
    session_id: str = Field("default", max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")


class ConfirmIn(BaseModel):
    token: str


class DecisionIn(BaseModel):
    note: str = Field("", max_length=200)
    pin: str = Field("", max_length=12)   # required to approve, not to reject
    # For a money request: the transfer service the sponsor picked (remit.py); empty means the cheapest.
    provider: str = Field("", max_length=20, pattern=r"^[a-z_]*$")


class PinIn(BaseModel):
    pin: str = Field("", max_length=12)


class FreezeIn(BaseModel):
    scope: str = Field("sponsor_funded", pattern="^(sponsor_funded|all)$")


class LimitsIn(BaseModel):
    single_cad: float = Field(..., gt=0, le=20000)
    daily_cad: float = Field(..., gt=0, le=50000)
    pin: str = Field("", max_length=12)


class ConsentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sponsor_sharing: bool = False   # student: what the sponsor will see (privacy.SHARING)
    ai_processing: bool = False     # student: chat processed by the configured model provider
    offline_only: bool = False      # student: keep chat on the built-in offline engine
    sponsor_terms: bool = False     # sponsor: the approval PIN and what he can see


class OnboardingIn(BaseModel):
    # No user id: onboarding always applies to the caller's own token.
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field("", max_length=80)
    language: str = Field(..., pattern="^(en|zh)$")
    skin: str = Field(..., pattern="^(neo|superapp)$")
    consents: ConsentsIn = Field(default_factory=ConsentsIn)


class PrefsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: Optional[str] = Field(None, max_length=80)
    language: Optional[str] = Field(None, pattern="^(en|zh)$")
    skin: Optional[str] = Field(None, pattern="^(neo|superapp)$")
    offline_only: Optional[bool] = None


# Audit events the sponsor never sees (the student's chat and tool use), and ones the student never sees
# (the sponsor's own PIN attempts, and which watchlist entry a payee matched: no tipping off).
CHAT_EVENTS = {"user_message", "assistant_reply", "tool_call", "tool_denied", "rate_limited", "llm_error",
               "tool_call_rejected", "llm_nudge", "llm_false_claim", "llm_loop_guard", "output_redacted"}
# review_generated: the sponsor's second opinion (verdict and source only) is his, like the PIN events.
SPONSOR_PRIVATE_EVENTS = {"sponsor_pin_failed", "sponsor_pin_locked", "sanctions_hit", "sanctions_review",
                          "review_generated"}
SAFETY_EVENTS = {"payments_frozen", "payments_unfrozen", "unfreeze_denied", "alert_raised"}

# What the student agreed to share at onboarding (shown on both phones). privacy.py is the one source; the agent
# answers "can my dad see my spending?" from the same data.
SHARING = PRIVACY_SHARING


def sponsor_sees(bank: Bank, a: PendingAction) -> bool:
    """Data minimisation: the sponsor sees what was sent to them and what touches money they fund."""
    if a.kind in ("topup", "add_payee") or a.needs_sponsor:
        return True
    if a.kind == "conversion" and a.params.get("uses_sponsor_money"):
        return True
    acc = bank.account(a.params.get("from_account_id", ""))
    return bool(acc and acc["sponsor_funded"])


@dataclass
class AppState:
    settings: Settings
    bank: Bank
    fx: FxMarket
    audit: AuditLog
    policy: PolicyEngine
    agent: Agent

    @property
    def pins(self) -> PinChecker:
        return PinChecker(self.bank, self.audit)

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
    today = today or settings.pinned_today()
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
    else:
        if not bank.has_security_seed():  # a file database from before KYC and the sponsor PIN existed
            seed_security(bank, agent.today)
        seed_sponsor_account(bank)        # ... or from before remittances (a no-op once it exists)
    return AppState(settings, bank, fx, audit, policy, agent)


def create_app(state: Optional[AppState] = None) -> FastAPI:
    st = state or build_state()
    tokens: Dict[str, Tuple[str, str]] = {
        os.getenv("HB_STUDENT_TOKEN", "demo-student"): (STUDENT, "student"),
        os.getenv("HB_SPONSOR_TOKEN", "demo-sponsor"): (SPONSOR, "sponsor"),
    }
    app = FastAPI(title="HomeBridge API", version="0.1.0")
    app.state.hb = st
    # The sponsor's AI second opinion (advisory only; it has no way to approve or change anything).
    reviewer = Reviewer(st)
    app.state.reviewer = reviewer
    # An allow-list, not "*": only these browser origins may call the API (HB_CORS_ORIGINS). The exported web
    # app is served from the API's own origin and native apps do not use CORS, so neither needs an entry.
    app.add_middleware(CORSMiddleware, allow_origins=st.settings.cors_origins, allow_methods=["GET", "POST"],
                       allow_headers=["Authorization", "Content-Type", "X-Operator"])

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

    def _my_student(sponsor_id: str) -> str:
        u = st.bank.user(STUDENT)
        if not u or u.get("sponsor_id") != sponsor_id:
            raise HTTPException(403, "You are not the sponsor for this account.")
        return STUDENT

    def _pin(sponsor_id: str, pin: str, purpose: str) -> None:
        try:
            st.pins.verify(sponsor_id, pin, purpose)
        except PinError as e:
            raise HTTPException(403, str(e))

    def _visible_actions(who: Tuple[str, str]) -> List[PendingAction]:
        if who[1] == "student":
            return st.policy.list_for(who[0])
        return [a for a in st.policy.list_for(_my_student(who[0])) if sponsor_sees(st.bank, a)]

    def _audit_visible(who: Tuple[str, str], action_ids: set) -> Any:
        uid, role = who

        def ok(e: Dict[str, Any]) -> bool:
            d = e.get("data") or {}
            aid, event = d.get("action_id"), e["event"]
            if role == "student":
                if event in SPONSOR_PRIVATE_EVENTS:
                    return False
                if aid:
                    return aid in action_ids
                return d.get("owner") in (None, uid)
            if e["actor"] == uid:
                return True
            if event in CHAT_EVENTS:
                return False
            if aid:
                return aid in action_ids
            if event in SAFETY_EVENTS:
                return d.get("owner") == STUDENT
            return event in ("limits_changed", "demo_reset")
        return ok

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
        return {"ok": True, "provider": getattr(st.agent.provider, "name", "?"), "demo_mode": st.settings.demo_mode,
                "today": st.agent.today.isoformat()}

    def _provider() -> str:
        return getattr(st.agent.provider, "name", "offline")

    def _me(who: Tuple[str, str]) -> Dict[str, Any]:
        u = st.bank.user(who[0])
        out = {"id": who[0], "role": who[1], "name": u["name"] if u else who[0],
               "prefs": user_prefs.get(st.bank, who[0], who[1]),
               # Where this person's chat text would go, for the onboarding consent screen.
               "model_route": user_prefs.route(_provider())}
        if who[1] == "student":
            out["sharing"] = SHARING
            out["chat_engine"] = "offline" if user_prefs.offline_only(st.bank, who[0]) else _provider()
        return out

    @app.get("/me")
    def me(who=Depends(auth)):
        return _me(who)

    @app.post("/me/onboarding")
    def me_onboarding(body: OnboardingIn, who=Depends(auth)):
        """First-run setup for the caller (their own token only): name, language, look and consents."""
        try:
            user_prefs.onboard(st.bank, st.audit, who[0], who[1], _provider(), display_name=body.display_name,
                               language=body.language, skin=body.skin, consents=body.consents.model_dump())
        except user_prefs.PrefsError as e:
            raise HTTPException(400, str(e))
        return _me(who)

    @app.post("/me/prefs")
    def me_prefs(body: PrefsIn, who=Depends(auth)):
        """Later changes from Settings: look, language, display name, and (student) offline engine only."""
        try:
            user_prefs.update(st.bank, st.audit, who[0], who[1], _provider(), display_name=body.display_name,
                              language=body.language, skin=body.skin, offline=body.offline_only)
        except user_prefs.PrefsError as e:
            raise HTTPException(400, str(e))
        return _me(who)

    @app.post("/chat")
    def chat(body: ChatIn, user_id: str = Depends(student)):
        _chat_rate_limit(user_id)
        r = st.agent.run(user_id, "student", f"{user_id}:{body.session_id}", body.message)
        # Prepare the sponsor's second opinion for anything that just went to him, so his card has it ready.
        waiting = [st.policy.actions[a["action_id"]] for a in r.actions
                   if a.get("status") == "awaiting_sponsor" and a["action_id"] in st.policy.actions]
        sponsor_id = (st.bank.user(user_id) or {}).get("sponsor_id")
        if waiting and sponsor_id and reviewer.uses_model(user_id):
            threading.Thread(target=reviewer.warm, args=(waiting, sponsor_id), daemon=True).start()
        return r.to_dict()

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
        pending = [st.policy.present(a) for a in st.policy.list_for(user_id, ["awaiting_user", "awaiting_sponsor",
                                                                                 "in_transit"])]
        return {"accounts": accs, "total_cad": round(total, 2), "tuition": get_tuition_schedule(ctx, {}),
                "budget": budget_summary(ctx, {}), "reminders": st.bank.reminders(user_id),
                "payees": st.bank.payees(user_id), "pending": pending,
                "credit": get_credit_profile(ctx, {}),
                "freeze": st.policy.safety.state(user_id),
                "limits": {"single_cad": st.settings.limits.single_cad, "daily_cad": st.settings.limits.daily_cad},
                "kyc": st.policy.compliance.kyc(user_id),
                "sharing": SHARING,
                "rates": {"MYR/CAD": st.fx.mid("MYR", "CAD"), "CAD/MYR": round(st.fx.mid("CAD", "MYR"), 4)}}

    @app.get("/forecast")
    def forecast(until: str = "next_tuition", user_id: str = Depends(student)):
        """Wallet runway: the agent's read-only forecast tool, returned as the same card the chat shows."""
        ctx = ToolContext(user_id=user_id, role="student", session_id="forecast", bank=st.bank, fx=st.fx,
                          policy=st.policy, audit=st.audit, today=st.agent.today)
        try:
            r = forecast_cashflow(ctx, {"until": until[:20]})
        except ValueError:
            raise HTTPException(400, "until must be next_tuition, end_of_term, a month name or a date")
        if "error" in r:
            raise HTTPException(404, r["error"])
        return forecast_card({}, r)

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

    # Emergency freeze. There is deliberately no agent tool to unlock: only these endpoints, with each
    # person's own login. The student's unlock lifts only a lock she set on her own money.
    @app.post("/freeze")
    def student_freeze(user_id: str = Depends(student)):
        return {"freeze": st.policy.safety.freeze(user_id, "student", "all", actor=user_id)}

    @app.post("/unfreeze")
    def student_unfreeze(user_id: str = Depends(student)):
        try:
            state = st.policy.safety.unfreeze(user_id, "student", actor=user_id)
        except SafetyError as e:
            raise HTTPException(403, str(e))
        note = ("Money your sponsor funds stays locked until your sponsor unlocks it."
                if state["sponsor_funded"] else "")
        return {"freeze": state, "note": note}

    @app.post("/sponsor/freeze")
    def sponsor_freeze(body: FreezeIn, sponsor_id: str = Depends(sponsor)):
        return {"freeze": st.policy.safety.freeze(_my_student(sponsor_id), "sponsor", body.scope, actor=sponsor_id)}

    @app.post("/sponsor/unfreeze")
    def sponsor_unfreeze(body: Optional[PinIn] = None, sponsor_id: str = Depends(sponsor)):
        student_id = _my_student(sponsor_id)
        _pin(sponsor_id, body.pin if body else "", "unfreeze")
        return {"freeze": st.policy.safety.unfreeze(student_id, "sponsor", actor=sponsor_id)}

    @app.get("/sponsor/queue")
    def queue(sponsor_id: str = Depends(sponsor)):
        # Each item carries the second opinion: {verdict, label, text, source: "model" | "rules"}. Advisory only.
        return {"actions": [{**st.policy.present(a, viewer="sponsor"), "review": reviewer.review(a, sponsor_id)}
                            for a in st.policy.sponsor_queue(sponsor_id)]}

    @app.get("/sponsor/overview")
    def overview(sponsor_id: str = Depends(sponsor)):
        """Data minimisation: only the accounts the sponsor funds, the items sent to them, alerts and the digest.
        The student's own CAD Everyday account, wages and spending stay private (see `sharing`)."""
        student_id = _my_student(sponsor_id)
        accs = [a for a in st.bank.accounts(student_id) if a["sponsor_funded"]]
        actions = st.policy.list_for(student_id)
        visible = [a for a in actions if sponsor_sees(st.bank, a)]
        u = st.bank.user(student_id) or {}
        return {"student": {"id": student_id, "name": u.get("name")}, "accounts": accs,
                "total_cad": round(sum(a["balance"] * st.fx.mid(a["currency"], "CAD") for a in accs), 2),
                "limits": st.settings.limits.__dict__,
                # His own account in Kuala Lumpur, which remittances are sent from. Never in the student's views.
                "source_accounts": st.bank.accounts(sponsor_id),
                "recent": [st.policy.present(a, viewer="sponsor") for a in visible][-10:],
                "freeze": st.policy.safety.state(student_id),
                "alerts": list(reversed(st.policy.safety.alerts(student_id)))[:10],
                # Counts cover all drafts (no details); money out covers only the accounts the sponsor funds.
                "digest": st.policy.safety.digest(student_id, actions, [a["id"] for a in accs]),
                "kyc": {"student": st.policy.compliance.kyc(student_id),
                        "sponsor": st.policy.compliance.kyc(sponsor_id),
                        "limit_ceiling": st.policy.compliance.limit_ceiling(student_id)},
                "pin": st.pins.status(sponsor_id),
                "sharing": SHARING}

    @app.post("/sponsor/limits")
    def set_limits(body: LimitsIn, sponsor_id: str = Depends(sponsor)):
        """T4 for the agent: limits change only here, with the sponsor's own credentials."""
        if body.single_cad > body.daily_cad:
            raise HTTPException(400, "The single-payment limit cannot be higher than the 24-hour limit.")
        student_id = _my_student(sponsor_id)
        ceiling = st.policy.compliance.limit_ceiling(student_id)
        if body.single_cad > ceiling["single_cad"] or body.daily_cad > ceiling["daily_cad"]:
            label = st.policy.compliance.kyc(student_id)["label"].lower()
            raise HTTPException(400, f"Aisha's identity check ({label}) allows at most CAD {ceiling['single_cad']:,.0f} "
                                f"per payment and CAD {ceiling['daily_cad']:,.0f} per 24 hours.")
        _pin(sponsor_id, body.pin, "limits")
        lim = st.settings.limits
        before = {"single_cad": lim.single_cad, "daily_cad": lim.daily_cad}
        lim.single_cad, lim.daily_cad = round(body.single_cad, 2), round(body.daily_cad, 2)
        st.policy.limits_changed()
        st.audit.record("limits_changed", sponsor_id, before=before,
                        after={"single_cad": lim.single_cad, "daily_cad": lim.daily_cad})
        return {"limits": lim.__dict__}

    @app.post("/sponsor/actions/{action_id}/approve")
    def approve(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        _pin(sponsor_id, body.pin, "approve " + action_id[:20])
        try:
            return st.policy.present(st.policy.sponsor_decide(action_id, sponsor_id, True, body.note, body.provider),
                                     viewer="sponsor")
        except PolicyError as e:
            _err(e)

    @app.post("/sponsor/actions/{action_id}/reject")
    def reject(action_id: str, body: DecisionIn, sponsor_id: str = Depends(sponsor)):
        try:
            return st.policy.present(st.policy.sponsor_decide(action_id, sponsor_id, False, body.note),
                                     viewer="sponsor")
        except PolicyError as e:
            _err(e)

    @app.get("/audit")
    def audit(since: int = 0, who=Depends(auth)):
        """Entries scoped by role. The student sees her own activity; the sponsor sees decisions and events about
        the money they fund, never the student's chat or tool calls. The chain itself is verified over the full
        log by /audit/verify, so a scoped view can still be checked."""
        ok = _audit_visible(who, {a.id for a in _visible_actions(who)})
        everything = st.audit.entries()
        mine = [e for e in everything[max(since, 0):] if ok(e)]
        return {"entries": mine[-200:], "scope": who[1], "visible": sum(1 for e in everything if ok(e)),
                "total": len(everything)}

    @app.get("/audit/verify")
    def audit_verify(tamper_seq: Optional[int] = None, who=Depends(auth)):
        """Verifies the whole chain on the server and returns only ok / broken_at, the count and the head hash.
        With tamper_seq (an entry this caller can see), verifies a copy with that entry edited, to show detection."""
        if tamper_seq is None:
            return st.audit.verify()
        entries = copy.deepcopy(st.audit.entries())
        if not 0 <= tamper_seq < len(entries):
            raise HTTPException(400, "No such entry")
        if not _audit_visible(who, {a.id for a in _visible_actions(who)})(entries[tamper_seq]):
            raise HTTPException(403, "That entry is not in your view of the log")
        entries[tamper_seq]["data"]["_tampered"] = True
        res = AuditLog.verify_entries(entries)
        res["simulated_tamper_seq"] = tamper_seq
        return res

    @app.get("/compliance/report")
    def compliance_report(who=Depends(auth)):
        """Evidence of the compliance checks run, scoped like everything else: the student sees her own drafts,
        the sponsor the drafts sent to them or touching the money they fund."""
        acts = _visible_actions(who)
        people = [who[0]] + ([STUDENT] if who[1] == "sponsor" else
                             [p for p in [(st.bank.user(who[0]) or {}).get("sponsor_id")] if p])
        return st.policy.compliance.report(acts, people, who[1])

    @app.post("/demo/reset")
    def demo_reset(who=Depends(auth), x_operator: str = Header(default="")):
        """Demo mode only, and only with the operator token (HB_OPERATOR_TOKEN) in X-Operator. The web app sends it
        when /health says demo mode is on; the agent has no way to call this."""
        if not st.settings.demo_mode:
            raise HTTPException(403, "Reset is only available in demo mode")
        if not x_operator or not hmac.compare_digest(x_operator.encode(), st.settings.operator_token.encode()):
            st.audit.record("reset_denied", who[0], reason="missing or wrong operator token")
            raise HTTPException(403, "Reset needs the operator token")
        st.reset()
        chat_times.clear()
        return {"ok": True}

    # Serve the exported web app from the same origin when it has been built (npm run build:web).
    # Registered last so API routes always win.
    if (WEB_DIR / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

    return app


app = create_app() if os.getenv("HB_NO_AUTOAPP") != "1" else None
