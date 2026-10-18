"""HTTP endpoints for the autopilot (autopilot.py), registered by main.create_app.

Mandates are T4 for the language model: there is no tool that activates, resumes, widens or revokes one. Those are
only here, with each person's own login:

* the student activates, pauses, resumes and revokes the mandates she grants (bill autopay, low-balance requests),
  and can withdraw any proposal she made;
* the sponsor approves the kinds he grants (tuition guard, rate watch) with his PIN, resumes them and widens their
  caps with his PIN, and pauses, narrows or revokes them instantly without it.

/autopilot/run and /demo/fx_shift are operator tools for the stage, like /demo/reset: demo mode only, with the
operator token in an X-Operator header.
"""
from __future__ import annotations

import hmac
import os
from typing import Any, Callable, Dict, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .autopilot import MandateError, start_ticker


class MandatePinIn(BaseModel):
    pin: str = Field("", max_length=12)


class CapsIn(BaseModel):
    per_action: float = Field(..., gt=0, le=100000)
    per_period: float = Field(..., gt=0, le=100000)
    pin: str = Field("", max_length=12)


class FxShiftIn(BaseModel):
    # Either an absolute MYR/CAD mid rate, a relative move from the current one, or reset=true for the snapshot.
    rate: Optional[float] = Field(None, gt=0, lt=10)
    delta: Optional[float] = Field(None, gt=-1, lt=1)
    reset: bool = False


def register(app: FastAPI, st: Any, auth: Callable, student: Callable, sponsor: Callable,
             pin_check: Callable[[str, str, str], None], my_student: Callable[[str], str]) -> None:
    ap = st.policy.autopilot

    def _err(e: Exception):
        raise HTTPException(400, str(e))

    def operator(who: Tuple[str, str], x_operator: str, what: str) -> None:
        if not st.settings.demo_mode:
            raise HTTPException(403, f"{what} is only available in demo mode")
        if not x_operator or not hmac.compare_digest(x_operator.encode(), st.settings.operator_token.encode()):
            st.audit.record("operator_denied", who[0], endpoint=what, reason="missing or wrong operator token")
            raise HTTPException(403, f"{what} needs the operator token")

    def student_pending(owner: str):
        return [st.policy.present(a, include_token=True) for a in st.policy.list_for(owner, ["awaiting_user", "awaiting_sponsor"])
                if a.origin == "autopilot"]

    def rate() -> Dict[str, Any]:
        return {"pair": "MYR/CAD", "mid": round(st.fx.mid("MYR", "CAD"), 5),
                "snapshot": round(st.fx.base_mid("MYR", "CAD"), 5), "moved": "MYR/CAD" in st.fx.overrides}

    # ------------------------------------------------------------------ student
    @app.get("/autopilot")
    def autopilot_student(user_id: str = Depends(student)):
        """Her mandates (whoever grants them), everything the autopilot did on her accounts, and its drafts waiting
        for her."""
        ms = ap.mandates(user_id)
        return {"mandates": [ap.view(m) for m in reversed(ms)], "activity": ap.activity(user_id),
                "pending": student_pending(user_id), "rate": rate()}

    def _student_do(fn_name: str, mandate_id: str, user_id: str):
        try:
            m = ap.get(mandate_id)
        except MandateError:
            raise HTTPException(404, "Unknown mandate.")
        if m["owner"] != user_id:
            raise HTTPException(404, "Unknown mandate.")
        return {"mandate": ap.view(getattr(ap, fn_name)(mandate_id, "student", user_id))}

    def student_route(verb: str) -> None:
        # A factory, so the verb is fixed in the closure and never becomes a request parameter.
        def handler(mandate_id: str, user_id: str = Depends(student)):
            try:
                return _student_do(verb, mandate_id, user_id)
            except MandateError as e:
                _err(e)
        handler.__name__ = f"autopilot_student_{verb}"
        app.post(f"/autopilot/mandates/{{mandate_id}}/{verb}")(handler)

    for verb in ("activate", "pause", "resume", "revoke", "decline"):
        student_route(verb)

    @app.post("/autopilot/mandates/{mandate_id}/caps")
    def autopilot_student_caps(mandate_id: str, body: CapsIn, user_id: str = Depends(student)):
        try:
            if ap.get(mandate_id)["owner"] != user_id:
                raise HTTPException(404, "Unknown mandate.")
        except MandateError:
            raise HTTPException(404, "Unknown mandate.")
        try:
            return {"mandate": ap.view(ap.set_caps(mandate_id, "student", user_id, body.per_action, body.per_period))}
        except MandateError as e:
            _err(e)

    # ------------------------------------------------------------------ sponsor
    @app.get("/sponsor/autopilot")
    def autopilot_sponsor(sponsor_id: str = Depends(sponsor)):
        """Only the mandates he grants (over the money he funds) and what the autopilot did under them. Aisha's own
        bill autopay and its payments stay private, like the rest of her CAD Everyday account."""
        student_id = my_student(sponsor_id)
        ms = [m for m in ap.mandates(student_id) if m["granted_by"] == "sponsor"]
        ids = {m["id"] for m in ms}
        return {"student": student_id, "mandates": [ap.view(m) for m in reversed(ms)],
                "activity": ap.activity(student_id, ids), "rate": rate()}

    def _sponsor_mandate(mandate_id: str, sponsor_id: str) -> Dict[str, Any]:
        student_id = my_student(sponsor_id)
        try:
            m = ap.get(mandate_id)
        except MandateError:
            raise HTTPException(404, "Unknown mandate.")
        if m["owner"] != student_id or m["granted_by"] != "sponsor":
            raise HTTPException(404, "Unknown mandate.")
        return m

    @app.post("/sponsor/autopilot/mandates/{mandate_id}/approve")
    def autopilot_sponsor_approve(mandate_id: str, body: MandatePinIn, sponsor_id: str = Depends(sponsor)):
        """Turns a proposal on. Like approving a payment, it needs his PIN, checked on the server."""
        m = _sponsor_mandate(mandate_id, sponsor_id)
        if m["status"] != "proposed":
            raise HTTPException(400, f"This mandate is {m['status']}, not waiting for approval.")
        pin_check(sponsor_id, body.pin, "approve mandate " + mandate_id[:20])
        try:
            return {"mandate": ap.view(ap.activate(mandate_id, "sponsor", sponsor_id))}
        except MandateError as e:
            _err(e)

    @app.post("/sponsor/autopilot/mandates/{mandate_id}/resume")
    def autopilot_sponsor_resume(mandate_id: str, body: MandatePinIn, sponsor_id: str = Depends(sponsor)):
        m = _sponsor_mandate(mandate_id, sponsor_id)
        if m["status"] != "paused":
            raise HTTPException(400, f"This mandate is {m['status']}, not paused.")
        pin_check(sponsor_id, body.pin, "resume mandate " + mandate_id[:20])
        try:
            return {"mandate": ap.view(ap.resume(mandate_id, "sponsor", sponsor_id))}
        except MandateError as e:
            _err(e)

    def sponsor_route(verb: str) -> None:
        def s_handler(mandate_id: str, sponsor_id: str = Depends(sponsor)):
            """Taking autonomy away is instant and needs no PIN."""
            _sponsor_mandate(mandate_id, sponsor_id)
            try:
                return {"mandate": ap.view(getattr(ap, verb)(mandate_id, "sponsor", sponsor_id))}
            except MandateError as e:
                _err(e)
        s_handler.__name__ = f"autopilot_sponsor_{verb}"
        app.post(f"/sponsor/autopilot/mandates/{{mandate_id}}/{verb}")(s_handler)

    for verb in ("decline", "pause", "revoke"):
        sponsor_route(verb)

    @app.post("/sponsor/autopilot/mandates/{mandate_id}/caps")
    def autopilot_sponsor_caps(mandate_id: str, body: CapsIn, sponsor_id: str = Depends(sponsor)):
        """Narrowing is instant; widening needs his PIN."""
        _sponsor_mandate(mandate_id, sponsor_id)
        if ap.widens(mandate_id, body.per_action, body.per_period):
            pin_check(sponsor_id, body.pin, "widen mandate " + mandate_id[:20])
        try:
            return {"mandate": ap.view(ap.set_caps(mandate_id, "sponsor", sponsor_id, body.per_action, body.per_period))}
        except MandateError as e:
            _err(e)

    # ------------------------------------------------------------------ operator (stage)
    @app.post("/autopilot/run")
    def autopilot_run(who=Depends(auth), x_operator: str = Header(default="")):
        """Runs the autopilot now (the demo tick does this every HB_AUTOPILOT_TICK seconds)."""
        operator(who, x_operator, "Autopilot run")
        return {"decisions": ap.run(), "rate": rate()}

    @app.post("/demo/fx_shift")
    def demo_fx_shift(body: FxShiftIn, who=Depends(auth), x_operator: str = Header(default="")):
        """Moves the sandbox MYR/CAD mid rate so the rate-watch mandate can fire live on stage, then runs the
        autopilot once. Demo mode and the operator token only; the model has no way to call it."""
        operator(who, x_operator, "FX shift")
        before = st.fx.mid("MYR", "CAD")
        if body.reset:
            st.fx.set_mid("MYR", "CAD", None)
        elif body.rate is not None:
            st.fx.set_mid("MYR", "CAD", round(body.rate, 6))
        elif body.delta is not None:
            st.fx.set_mid("MYR", "CAD", round(before + body.delta, 6))
        else:
            raise HTTPException(400, "Give rate, delta or reset")
        st.audit.record("fx_shifted", who[0], pair="MYR/CAD", before=round(before, 5),
                        after=round(st.fx.mid("MYR", "CAD"), 5))
        return {"rate": rate(), "decisions": ap.run()}

    # Demo mode: a light background tick, so a rate move or a due date is acted on without anyone pressing a button.
    # HB_AUTOPILOT_TICK=0 turns it off (the tests do).
    tick = float(os.getenv("HB_AUTOPILOT_TICK", "30") or 0)
    if st.settings.demo_mode and tick > 0 and not getattr(st, "_autopilot_ticker", None):
        st._autopilot_ticker = start_ticker(lambda: st.policy.autopilot, tick)
