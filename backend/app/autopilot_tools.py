"""The agent's two autopilot tools (registered into tools.REGISTRY when tools.py loads).

* list_mandates (T0): the student's mandates, how much of each cap is used, and what the autopilot did.
* propose_mandate (T1): drafts a mandate proposal from what the student asked for. It never activates anything:
  sponsor-granted kinds wait for the sponsor's approval with his PIN, student-granted kinds for her own tap.

There is deliberately no tool to activate, resume, widen, pause or revoke a mandate (T4 for the model: app endpoints
only, see autopilot_api.py), and none of these tools can name an account number or add a payee.
"""
from __future__ import annotations

from typing import Any, Dict

from . import cards
from .autopilot import KINDS, MandateError
from .policy import PolicyError
from .tools import ToolContext, _amount_from_untrusted, _num, tool

FLAGGED = {"scam", "injection", "escalation"}


@tool("list_mandates",
      "The student's autopilot mandates (standing permissions the family set: tuition guard, rate watch, bill "
      "autopay, low-balance request), each with its caps, how much is used this period and its live status, plus "
      "what the autopilot did recently (acted, escalated to a person, or skipped, with the reason). Use it for "
      "'what did autopilot do?', 'my mandates' or 'is my rate watch on?'. Read-only.", {})
def list_mandates(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    ap = ctx.policy.autopilot
    ms = list(reversed(ap.mandates(ctx.user_id)))
    acts = ap.activity(ctx.user_id, limit=8)
    return {"mandates": [ap.for_model(m) for m in ms],
            "activity": [{"date": e.get("date"), "outcome": e["outcome"], "kind": e["kind"],
                          "text": e["text"]["en"], "text_zh": e["text"].get("zh", ""),
                          "action_id": e.get("action_id"), "amount": e.get("amount"), "currency": e.get("currency")}
                         for e in acts],
            "rate": {"pair": "MYR/CAD", "mid": round(ctx.fx.mid("MYR", "CAD"), 4)},
            "note": "The autopilot acts only inside active mandates, through the same policy checks as any draft. "
                    "Only the app can activate, widen, pause or revoke a mandate."}


@tool("propose_mandate",
      "Propose an autopilot mandate: a standing permission for HomeBridge to act on its own within caps. Kinds: "
      "'tuition_guard' (N days before tuition is due, top up the Tuition Fund from the MYR Wallet; amount = monthly "
      "MYR cap), 'rate_watch' (convert MYR to CAD Everyday when MYR/CAD reaches target_rate; amount = MYR per week; "
      "leave target_rate out for 'when the rate is good'), 'bill_autopay' (pay a SAVED bill payee such as BC Hydro, "
      "Northline Mobile or the secured card minimum when due; amount = CAD cap per bill), 'low_balance_topup' (ask the "
      "sponsor for money when CAD Everyday is forecast below floor_cad; a request only). This only PROPOSES: the "
      "sponsor approves tuition_guard and rate_watch in his app with his PIN; the student activates bill_autopay "
      "and low_balance_topup herself in the app. It can never send money to an account number or a new payee.",
      {"kind": {"type": "string", "enum": list(KINDS)},
       "amount": {"type": "number", "description": "Per-action cap (rate_watch: MYR per conversion and per week; "
                                                   "tuition_guard: MYR per month; bill_autopay: CAD per bill; "
                                                   "low_balance_topup: CAD per request)"},
       "period_cap": {"type": "number", "description": "Optional cap per period if different from amount"},
       "target_rate": {"type": "number", "description": "rate_watch: MYR/CAD mid rate to wait for, e.g. 0.3250"},
       "payee": {"type": "string", "description": "bill_autopay: saved payee name, e.g. 'BC Hydro'"},
       "days_before": {"type": "integer", "description": "tuition_guard / bill_autopay: days before the due date"},
       "floor_cad": {"type": "number", "description": "low_balance_topup: the CAD floor"},
       "days_ahead": {"type": "integer", "description": "low_balance_topup: how far ahead to look (7 to 60 days)"}},
      ["kind"], tier="T1")
def propose_mandate(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    if set(ctx.flags()) & FLAGGED:
        raise PolicyError("A mandate can't be proposed in a conversation the safety check flagged. Nothing was set up.")
    args: Dict[str, Any] = {}
    for key in ("amount", "period_cap", "target_rate", "floor_cad"):
        if a.get(key) not in (None, ""):
            args[key] = _num(a[key], key)
            if key != "target_rate" and _amount_from_untrusted(ctx, args[key]):
                raise PolicyError("That amount came from content you didn't type (a pasted message), so autopilot "
                                  "won't use it. Tell me the amount yourself.")
    for key in ("days_before", "days_ahead"):
        if a.get(key) not in (None, ""):
            args[key] = int(_num(a[key], key))
    if a.get("payee"):
        args["payee"] = str(a["payee"])[:80]
    ap = ctx.policy.autopilot
    try:
        m, new = ap.propose(ctx.user_id, str(a.get("kind") or ""), args, via="chat", actor=ctx.user_id)
    except MandateError as e:
        raise PolicyError(str(e))
    sponsor = (ctx.bank.user((ctx.bank.user(ctx.user_id) or {}).get("sponsor_id") or "") or {}).get("name", "the sponsor")
    if m["granted_by"] == "sponsor":
        step = (f"Sent to {sponsor} to approve in his app with his PIN. It does nothing until he approves, and he can "
                "pause or revoke it any time.")
    else:
        step = ("It does nothing until the student taps Activate on the Autopilot card (in the chat or the Wallet "
                "tab). She can pause or revoke it any time.")
    return {"mandate": ap.for_model(m), "new": new, "next_step": step,
            "cannot": "You cannot activate, widen or revoke a mandate; only the app can."}


def _card(args: Dict[str, Any], r: Dict[str, Any]):
    if "mandate" in r:
        return {"type": "autopilot", "mandate_ids": [r["mandate"]["mandate_id"]], "proposal": True}
    if "mandates" in r:
        return {"type": "autopilot", "mandate_ids": [m["mandate_id"] for m in r["mandates"]], "proposal": False}
    return None


cards.BUILDERS["list_mandates"] = _card
cards.BUILDERS["propose_mandate"] = _card
