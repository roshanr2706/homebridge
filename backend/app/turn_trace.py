"""Visible reasoning: the "How I handled this" trace under each assistant reply.

Built after the turn from what the agent already knows (the guard result, the tool calls it ran, the drafts the
policy engine made, the safety events of the turn and the provider's stats), so it explains what happened without
changing it. It is shown to the student, so it is safe by construction:

* tool arguments go through an allow-list (amounts, currencies, payee names, categories, dates); pasted text,
  free-text reasons, account numbers, action ids and anything unknown never appear;
* every string is scrubbed again at the end (full account numbers, long digit runs, token-like strings);
* it never carries the system prompt, the per-turn context message, the model's own reasoning text or raw
  tool results, and compliance detail is the student's wording (no sanctions specifics).

Each step has a `type` (understood, plan, tool, policy, safety, model), an English `label` and structured fields
the app uses to show the step in the reader's language.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

from .model_output import ACCOUNT_NUMBER, TOKEN_LIKE

VERSION = 1

LANG_NAMES = {"en": "English", "ms": "Malay", "zh": "Chinese"}

# What each tool does, in a few words (the app has its own Chinese names keyed by tool).
TOOL_LABELS = {
    "get_balances": "Checked balances",
    "list_transactions": "Looked up transactions",
    "list_payees": "Looked up saved payees",
    "get_fx_quotes": "Compared exchange quotes",
    "get_fx_history": "Checked the 30-day rate range",
    "get_tuition_schedule": "Checked the tuition schedule",
    "budget_summary": "Summarised spending",
    "credit_building_plan": "Built a credit plan",
    "get_credit_profile": "Read the credit profile",
    "prepare_card_payment": "Drafted a card payment",
    "check_message_for_scam": "Scanned the message for scam signs",
    "get_pending_actions": "Looked up waiting drafts",
    "get_limits": "Checked limits",
    "get_data_sharing": "Checked who can see what",
    "set_budget": "Set a budget",
    "create_reminder": "Created a reminder",
    "request_sponsor_topup": "Drafted a request to Dad",
    "get_remittance_status": "Tracked Dad's transfer",
    "prepare_transfer": "Drafted a payment",
    "prepare_conversion": "Drafted a conversion",
    "add_payee": "Requested a new payee",
    "cancel_pending_action": "Cancelled a draft",
    "forecast_cashflow": "Forecast the cash flow",
    "freeze_payments": "Locked payments",
    "list_mandates": "Checked autopilot",
    "propose_mandate": "Proposed an autopilot rule",
}

# The offline engine routes by intent; the tool it reached for first says which one matched.
# Draft tools win over reads ("pay rent" reads the last rent payment, then drafts).
INTENTS = [
    ("freeze_payments", "lock", "lock payments"),
    ("check_message_for_scam", "scam_check", "check a message for scams"),
    ("prepare_transfer", "pay", "pay a saved payee"),
    ("prepare_conversion", "convert", "convert or move money"),
    ("prepare_card_payment", "card_payment", "pay the secured card"),
    ("request_sponsor_topup", "ask_sponsor", "ask Dad for money"),
    ("add_payee", "new_payee", "add a new payee"),
    ("cancel_pending_action", "change_draft", "change a draft"),
    ("propose_mandate", "autopilot", "set up autopilot"),
    ("create_reminder", "reminder", "set a reminder"),
    ("set_budget", "budget", "set a budget"),
    ("forecast_cashflow", "forecast", "cash-flow forecast"),
    ("get_fx_quotes", "fx_compare", "compare ways to move money"),
    ("get_fx_history", "fx_history", "exchange-rate range"),
    ("get_remittance_status", "remittance", "track Dad's transfer"),
    ("get_credit_profile", "credit", "credit question"),
    ("credit_building_plan", "credit", "credit question"),
    ("get_tuition_schedule", "tuition", "tuition check"),
    ("budget_summary", "spending", "spending question"),
    ("list_transactions", "spending", "spending question"),
    ("get_data_sharing", "privacy", "privacy question"),
    ("get_limits", "limits", "limits question"),
    ("list_mandates", "autopilot", "autopilot status"),
    ("get_pending_actions", "drafts", "waiting drafts"),
    ("get_balances", "balances", "balances"),
    ("list_payees", "payees", "saved payees"),
]

SAFETY_LABELS = {
    "tool_output_scan": "Found instruction-like text in {tool} data: treated it as data, not orders, and flagged "
                        "this turn",
    "redaction": "Removed {what} from the reply before showing it",
    "nudge": "The model stopped without drafting a clear request: the server asked it once to draft or ask",
    "false_claim": "The reply claimed a draft that didn't exist: the server made the model correct it",
    "fallback": "The AI model failed ({reason}): the built-in engine answered instead",
    "circuit_open": "The AI model is resting after recent failures (circuit breaker): the built-in engine answered",
    "loop_guard": "Stopped a repeating tool loop rather than guess",
    "step_limit": "Stopped after the maximum number of steps",
    "untrusted": "Treated the pasted or quoted text as data: amounts taken from it are marked on the card",
    "clear": "Checked tool data for hidden instructions and the reply for account numbers and tokens: all clear",
}

NEXT_LABELS = {
    "user": "Waits for your tap on Confirm",
    "user_then_sponsor": "Waits for your tap on Confirm, then goes to Dad to approve",
    "sponsor": "Goes to Dad to approve in his app",
    "blocked": "Blocked: it can't be confirmed or approved",
    "in_transit": "Approved and on its way",
    "done": "Already done",
    "closed": "Closed",
}

# Tool arguments shown in the trace: an allow-list. Anything else (pasted text, reasons, account numbers, ids) is
# never shown.
_PLAIN_KEYS = ("category", "until", "target", "source", "destination", "kind", "due_date", "days",
               "total_currency", "scope")
_DIGITS = re.compile(r"\d[\d\s-]{6,}\d")       # digit runs with optional spaces or dashes
_PROVIDER_LABELS = {"deepseek": "DeepSeek", "deepseek-pro": "DeepSeek", "qwen": "Qwen", "qwen-cn": "Qwen",
                    "offline": "Offline engine", "custom": "Custom model"}


def _mask_digits(m: "re.Match[str]") -> str:
    """Nine or more digits (an account, card or phone number) keep only the last four; a date (eight) stays."""
    digits = re.sub(r"\D", "", m.group(0))
    return "••••" + digits[-4:] if len(digits) >= 9 else m.group(0)


def scrub(text: Any, limit: int = 160) -> str:
    """One string made safe to show: full account numbers masked, long digit runs and token-like strings removed,
    whitespace folded, length capped."""
    s = " ".join(str(text if text is not None else "").split())
    s = ACCOUNT_NUMBER.sub(r"••••\1", s)
    s = _DIGITS.sub(_mask_digits, s)
    s = TOKEN_LIKE.sub("[removed]", s)
    return s[:limit] + "…" if len(s) > limit else s


def provider_label(name: str) -> str:
    return _PROVIDER_LABELS.get(name, (name or "model").replace("-", " ").title())


def _money(amount: Any, currency: Any) -> Optional[str]:
    try:
        v = float(str(amount).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if v != v or abs(v) > 1e12:   # NaN or absurd: say nothing rather than echo it
        return None
    cur = str(currency or "").upper()[:3]
    return f"{cur} {v:,.2f}".strip() if re.fullmatch(r"[A-Z]{0,3}", cur) else f"{v:,.2f}"


def summarize_args(name: str, args: Any) -> str:
    """A safe one-line summary of a tool call's arguments: 'CAD 1,150.00 · → Maple Property · rent'."""
    if not isinstance(args, dict):
        return ""
    parts: List[str] = []
    cur = args.get("currency") or args.get("from_currency")
    for key in ("amount", "monthly_amount"):
        if key in args:
            m = _money(args[key], cur)
            if m:
                parts.append(m)
    if args.get("from_currency") and args.get("to_currency"):
        parts.append(f"{scrub(args['from_currency'], 4)} → {scrub(args['to_currency'], 4)}")
    elif args.get("currency") and not any(k in args for k in ("amount", "monthly_amount")):
        parts.append(scrub(args["currency"], 4))
    for key in ("payee", "name"):
        v = args.get(key)
        if isinstance(v, str) and v.strip():
            parts.append("→ " + scrub(v, 40))
    if "target_rate" in args:
        try:
            parts.append(f"rate {float(args['target_rate']):.4f}")
        except (TypeError, ValueError):
            pass
    for key in _PLAIN_KEYS:
        v = args.get(key)
        if isinstance(v, bool) or v is None or v == "":
            continue
        if isinstance(v, (int, float)) or (isinstance(v, str) and len(v) <= 30):
            parts.append(scrub(v, 30))
    if isinstance(args.get("own_wallet"), bool):
        parts.append("own wallet" if args["own_wallet"] else "sent by someone else")
    if isinstance(args.get("text"), str):
        parts.append(f"message, {len(args['text'])} chars")   # the size only, never the contents
    return " · ".join(dict.fromkeys(p for p in parts if p))


def _intent(tools: List[str], flagged: bool, reply: str) -> Dict[str, str]:
    for tool, code, label in INTENTS:
        if tool in tools:
            return {"intent": code, "intent_label": label}
    if flagged:
        return {"intent": "refuse", "intent_label": "manipulation attempt: refuse, no tools"}
    if reply.rstrip().endswith(("?", "？")):
        return {"intent": "ask", "intent_label": "needs one more detail: ask"}
    return {"intent": "answer", "intent_label": "answer directly"}


def _policy_step(a: Dict[str, Any]) -> Dict[str, Any]:
    status, tier = a.get("status", ""), a.get("tier", "")
    nxt = {"awaiting_user": "user", "awaiting_sponsor": "sponsor", "blocked": "blocked", "in_transit": "in_transit",
           "executed": "done"}.get(status, "closed")
    if nxt == "user" and a.get("needs_sponsor_approval"):
        nxt = "user_then_sponsor"
    reasons = a.get("sponsor_reasons") if a.get("needs_sponsor_approval") else a.get("risk_signals")
    comp = a.get("compliance") or {}
    noted = [c.get("label") or c.get("name") or c.get("id") for c in comp.get("checks", [])
             if c.get("status") in ("flag", "block", "report")]
    outcome = comp.get("outcome") or "clear"
    tier_words = {"T1": "a request", "T2": "you confirm", "T3": "Dad approves"}.get(tier, tier)
    return {
        "type": "policy",
        "label": f"Policy: {tier} ({tier_words}), risk {a.get('risk_score', 0)}/100. {NEXT_LABELS[nxt]}",
        "kind": a.get("kind", ""),
        # A money request's summary ends with the student's free-text reason; the trace stops before it.
        "summary": scrub(str(a.get("summary", "")).split(": ")[0], 120),
        "tier": tier,
        "risk_score": int(a.get("risk_score") or 0),
        "reasons": [scrub(r, 120) for r in (reasons or [])[:3]],
        "compliance": {"outcome": scrub(outcome, 20), "checks": len(comp.get("checks", [])),
                       "noted": [scrub(n, 40) for n in noted[:3] if n]},
        "next": nxt,
    }


def build(*, lang: str, guard: Dict[str, Any], carried: Iterable[str], untrusted: bool, live_plan: bool,
          calls: List[Dict[str, Any]], actions: List[Dict[str, Any]], events: List[Dict[str, Any]],
          engine: Dict[str, Any], reply: str, total_ms: int) -> Dict[str, Any]:
    """The trace for one turn. `calls` are the agent's trace entries (tool, args, ok, ms, tier, error_type),
    `actions` the drafts as presented to the student, `events` the turn's safety events."""
    steps: List[Dict[str, Any]] = []

    flags = [f for f in guard.get("flags", []) if f in ("scam", "injection", "extraction", "escalation")]
    signals = list(dict.fromkeys(s.get("name", "") for s in guard.get("signals", []) if s.get("name")))[:4]
    carried = [f for f in carried if f]
    model = guard.get("model") or {}
    verdict = "flagged" if flags else "clear"
    bits = [f"Read your message ({LANG_NAMES.get(lang, lang)})"]
    if flags:
        bits.append("safety check flagged " + ", ".join(flags) + (": " + "; ".join(signals) if signals else
                                                                   " (classifier)"))
    else:
        bits.append("no warning signs")
    if carried:
        bits.append("this chat was already flagged (" + ", ".join(carried) + ")")
    steps.append({"type": "understood", "label": "; ".join(bits), "lang": lang, "verdict": verdict,
                  "flags": flags, "signals": [scrub(s, 80) for s in signals], "carried": carried,
                  "classifier": ({"label": str(model.get("label")), "confidence": round(float(model.get("confidence")
                                                                                                or 0), 2)}
                                 if model.get("label") and model.get("label") != "benign" else None),
                  "untrusted": bool(untrusted)})

    tools = [str(c.get("tool") or "")[:40] for c in calls]
    if live_plan:
        label = ("Chose " + str(len(tools)) + " tool" + ("s" if len(tools) != 1 else "") + ": " + " → ".join(tools)
                 if tools else "Answered without tools")
        steps.append({"type": "plan", "label": label, "source": "model", "tools": tools,
                      "rounds": engine.get("model_calls", 0)})
    else:
        # The offline engine refuses on this turn's flags (carried flags only raise the risk of drafts).
        it = _intent(tools, bool(set(flags) - {"scam"}), reply)
        steps.append({"type": "plan", "label": "Matched intent: " + it["intent_label"], "source": "offline_engine",
                      "tools": tools, **it})

    for c in calls:
        name = str(c.get("tool") or "")[:40]
        step = {"type": "tool", "tool": name, "label": TOOL_LABELS.get(name, name.replace("_", " ")),
                "summary": summarize_args(name, c.get("args")), "ms": int(c.get("ms") or 0), "ok": bool(c.get("ok")),
                "tier": c.get("tier") or ""}
        if not step["ok"]:
            step["error"] = c.get("error_type") or "error"
        steps.append(step)

    for a in actions:
        steps.append(_policy_step(a))

    if untrusted:
        events = [{"kind": "untrusted"}] + list(events)
    for e in events or [{"kind": "clear"}]:
        kind = e.get("kind", "clear")
        fmt = {"tool": scrub(e.get("tool", "a tool's"), 40),
               "what": scrub(", ".join(e.get("what", [])).replace("_", " ") or "something", 60),
               "reason": scrub(e.get("reason", "error"), 30)}
        step = {"type": "safety", "kind": kind, "label": SAFETY_LABELS.get(kind, kind).format(**fmt)}
        step.update({k: fmt[k] for k in ("tool", "what", "reason") if k in e})
        steps.append(step)

    eng = {
        "provider": engine.get("provider", "offline"),
        "label": provider_label(engine.get("provider", "offline")),
        # The provider the server is set up with (differs from `provider` after a fallback or the offline choice).
        "configured": str(engine.get("configured") or engine.get("provider", "offline"))[:30],
        "model": scrub(engine.get("model") or "", 60),
        "live": bool(engine.get("live")),
        "fallback": bool(engine.get("fallback")),
        "fallback_reason": engine.get("fallback_reason"),
        "prompt_version": engine.get("prompt_version", ""),
        "model_ms": int(engine.get("model_ms") or 0),
        "model_calls": int(engine.get("model_calls") or 0),
        "retries": int(engine.get("retries") or 0),
    }
    where = (f"{eng['label']} · {eng['model']}" if eng["live"] and eng["model"] else eng["label"])
    steps.append({"type": "model", **eng, "name": eng["label"],
                  "label": f"{where} · {eng['model_calls']} call{'s' if eng['model_calls'] != 1 else ''} · "
                           f"{eng['model_ms']} ms" + (" · fell back to the built-in engine" if eng["fallback"] else "")})

    return {"version": VERSION, "engine": eng, "total_ms": int(total_ms), "step_count": len(steps), "steps": steps}
