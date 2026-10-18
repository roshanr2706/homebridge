"""HTTP endpoints for the smart inbox (inbox.py) and the demo operator's stage controls, registered by main.create_app.

Student: GET /inbox, POST /inbox/{id}/read, /dismiss and /draft ("draft this payment": a normal draft she still
confirms). The sponsor has no inbox endpoint: he sees only the safety alert a high-confidence scam raises.

Operator (demo mode plus the X-Operator token, like /demo/reset): POST /demo/inbox injects a sample or custom
message, POST /demo/time_skip moves the sandbox's date (demo_clock.py). The model has no way to call either.
"""
from __future__ import annotations

import hmac
from typing import Any, Callable, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import demo_clock, inbox
from .seed import STUDENT


class InjectIn(BaseModel):
    sample: str = Field("", max_length=40, pattern=r"^[a-z0-9_]*$")
    text: str = Field("", max_length=inbox.MAX_TEXT)
    sender: str = Field("", max_length=120)
    channel: str = Field("sms", pattern="^(sms|email|whatsapp)$")


class SkipIn(BaseModel):
    days: Optional[int] = Field(None, ge=1, le=demo_clock.MAX_SKIP_DAYS)
    to: str = Field("", pattern="^(|tuition_week)$")


def require_operator(st: Any, who: Tuple[str, str], x_operator: str, what: str) -> None:
    """Demo mode and the operator token (HB_OPERATOR_TOKEN in X-Operator), or 403."""
    if not st.settings.demo_mode:
        raise HTTPException(403, f"{what} is only available in demo mode")
    if not x_operator or not hmac.compare_digest(x_operator.encode(), st.settings.operator_token.encode()):
        st.audit.record("operator_denied", who[0], endpoint=what, reason="missing or wrong operator token")
        raise HTTPException(403, f"{what} needs the operator token")


def register(app: FastAPI, st: Any, auth: Callable, student: Callable) -> None:
    def feed(owner: str):
        ms = inbox.messages(st.bank, owner)
        return {"messages": [inbox.view(m) for m in ms], "counts": inbox.summary_counts(ms),
                "today": st.agent.today.isoformat()}

    @app.get("/inbox")
    def inbox_list(user_id: str = Depends(student)):
        """Her incoming messages, newest first, each with the verdict HomeBridge reached when it arrived."""
        return feed(user_id)

    def _mark(message_id: str, user_id: str, status: str):
        try:
            return {"message": inbox.view(inbox.mark(st.bank, user_id, message_id, status))}
        except inbox.InboxError as e:
            raise HTTPException(404, str(e))

    @app.post("/inbox/{message_id}/read")
    def inbox_read(message_id: str, user_id: str = Depends(student)):
        return _mark(message_id, user_id, "read")

    @app.post("/inbox/{message_id}/dismiss")
    def inbox_dismiss(message_id: str, user_id: str = Depends(student)):
        return _mark(message_id, user_id, "dismissed")

    @app.post("/inbox/{message_id}/draft")
    def inbox_draft(message_id: str, user_id: str = Depends(student)):
        """Her tap on "Draft this payment": a normal draft to the saved payee, which she still confirms."""
        try:
            a = inbox.draft_payment(st, user_id, message_id)
        except inbox.InboxError as e:
            raise HTTPException(400, str(e))
        return {"action": st.policy.present(a, include_token=True),
                "message": inbox.view(inbox.get(st.bank, user_id, message_id))}

    # ------------------------------------------------------------------ operator (stage)
    @app.post("/demo/inbox")
    def demo_inbox(body: InjectIn, who=Depends(auth), x_operator: str = Header(default="")):
        """Delivers a message to Aisha's inbox: a sample from the library or custom text. It is triaged on arrival."""
        require_operator(st, who, x_operator, "Inbox injection")
        try:
            if body.sample:
                msg = inbox.render_sample(body.sample, st.bank, STUDENT, st.agent.today)
            elif body.text.strip():
                msg = {"channel": body.channel, "sender": body.sender or "Unknown sender", "text": body.text}
            else:
                raise inbox.InboxError("Give a sample or some text.")
            m = inbox.receive(st, STUDENT, msg["sender"], msg["channel"], msg["text"], sample=body.sample,
                              actor="operator")
        except inbox.InboxError as e:
            raise HTTPException(400, str(e))
        return {"message": inbox.view(m)}

    @app.get("/demo/inbox/samples")
    def demo_inbox_samples(who=Depends(auth)):
        """The sample library, for the stage's "New message" menu (labels only; no operator token needed)."""
        return {"samples": [{"key": k, "label": v["label"], "channel": v["channel"]} for k, v in inbox.SAMPLES.items()]}

    @app.post("/demo/time_skip")
    def demo_time_skip(body: SkipIn, who=Depends(auth), x_operator: str = Header(default="")):
        """Moves the sandbox's date forward (days, or to='tuition_week'), then runs the autopilot once."""
        require_operator(st, who, x_operator, "Time skip")
        try:
            days = demo_clock.tuition_week_days(st, STUDENT) if body.to == "tuition_week" else body.days
            if not days:
                raise demo_clock.ClockError("Give days or to='tuition_week'.")
            return demo_clock.skip(st, days, who[0])
        except demo_clock.ClockError as e:
            raise HTTPException(400, str(e))
