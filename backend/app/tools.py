"""Tools the agent can call, with OpenAI-format schemas.

Every tool runs with a ToolContext built from the authenticated session, not
from anything the model says. Read tools only ever return masked account
numbers. Payment tools only create drafts in the policy engine.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank
from .fx import FxMarket, FxUnavailable
from .guard import check as guard_check
from .classifier import shared as shared_classifier
from .policy import PendingAction, PolicyEngine, PolicyError


@dataclass
class ToolContext:
    user_id: str
    role: str
    session_id: str
    bank: Bank
    fx: FxMarket
    policy: PolicyEngine
    audit: AuditLog
    today: date
    guard_flags: List[str] = field(default_factory=list)
    untrusted_texts: List[str] = field(default_factory=list)
    created_actions: List[PendingAction] = field(default_factory=list)


ToolFn = Callable[[ToolContext, Dict[str, Any]], Dict[str, Any]]
REGISTRY: Dict[str, Dict[str, Any]] = {}


def tool(name: str, description: str, params: Dict[str, Any], required: Optional[List[str]] = None, tier: str = "T0"):
    def deco(fn: ToolFn) -> ToolFn:
        REGISTRY[name] = {
            "fn": fn,
            "tier": tier,
            "spec": {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": {"type": "object", "properties": params, "required": required or []},
                },
            },
        }
        return fn
    return deco


ROLE_TOOLS = {"student": None}  # None means every registered tool; sponsors do not chat with the agent


def specs_for(role: str) -> List[Dict[str, Any]]:
    allowed = ROLE_TOOLS.get(role, set())
    return [t["spec"] for n, t in REGISTRY.items() if allowed is None or n in allowed]


def run_tool(ctx: ToolContext, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    allowed = ROLE_TOOLS.get(ctx.role, set())
    if name not in REGISTRY or (allowed is not None and name not in allowed):
        ctx.audit.record("tool_denied", ctx.user_id, tool=name)
        return {"error": f"Tool '{name}' is not available."}
    try:
        out = REGISTRY[name]["fn"](ctx, args or {})
    except PolicyError as e:
        out = {"error": str(e), "refused_by_policy": True}
    except (ValueError, TypeError, KeyError) as e:
        out = {"error": f"Invalid arguments: {e}"}
    ctx.audit.record("tool_call", ctx.user_id, tool=name, tier=REGISTRY[name]["tier"], args=_safe_args(args),
                     ok="error" not in out)
    return out


def _safe_args(args: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in (args or {}).items():
        if isinstance(v, str) and k in ("account_number", "number"):
            out[k] = "••••" + re.sub(r"\D", "", v)[-4:]
        elif isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "…"
        else:
            out[k] = v
    return out


def _num(v: Any, name: str = "amount") -> float:
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).lower().replace(",", "").replace("$", "").strip()
    s = re.sub(r"(cad|myr|rm|usd)", "", s).strip()
    mult = 1000 if s.endswith("k") else 1
    s = s.rstrip("k").strip()
    try:
        return float(s) * mult
    except ValueError:
        raise ValueError(f"{name} must be a number")


def _amount_from_untrusted(ctx: ToolContext, amount: float) -> bool:
    forms = {f"{amount:g}", f"{amount:,.0f}", f"{amount:,.2f}", f"{amount:.2f}"}
    return any(f in t for t in ctx.untrusted_texts for f in forms if len(f) >= 3)


# ------------------------------------------------------------------ T0 reads
@tool("get_balances", "Balances of all the user's accounts, with a total converted to one currency.",
      {"total_currency": {"type": "string", "enum": ["CAD", "MYR", "USD"], "description": "Currency for the total"}})
def get_balances(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    cur = (a.get("total_currency") or "CAD").upper()
    accs = ctx.bank.accounts(ctx.user_id)
    total = sum(x["balance"] * ctx.fx.mid(x["currency"], cur) for x in accs)
    return {"accounts": accs, "total": round(total, 2), "total_currency": cur,
            "note": "Totals use the mid-market snapshot rate. Sponsor-funded accounts are for tuition and essentials."}


@tool("list_transactions", "Recent transactions, newest first. Account numbers are never shown.",
      {"days": {"type": "integer", "description": "Look-back window in days, default 30"},
       "category": {"type": "string", "description": "Optional category such as dining, groceries, rent"},
       "limit": {"type": "integer", "description": "Max rows, default 15"}})
def list_transactions(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    days = max(1, min(int(a.get("days") or 30), 365))
    rows = ctx.bank.transactions(ctx.user_id, days, a.get("category") or "", ctx.today)
    limit = max(1, min(int(a.get("limit") or 15), 50))
    for r in rows:  # memos and counterparties are free text from outside: track them as untrusted
        if r.get("memo"):
            ctx.untrusted_texts.append(r["memo"])
    return {"transactions": rows[:limit], "count": len(rows)}


@tool("list_payees", "Saved payees (masked).", {})
def list_payees(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    return {"payees": ctx.bank.payees(ctx.user_id)}


@tool("get_fx_quotes",
      "Compare providers for converting or sending money between currencies. Ranks by what the recipient gets "
      "and shows the true cost (fees plus exchange-rate margin) against the mid-market rate.",
      {"from_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]},
       "to_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]},
       "amount": {"type": "number", "description": "Amount in from_currency"},
       "own_wallet": {"type": "boolean", "description": "True if converting between the user's own wallets "
                      "(includes in-app conversion). False for money sent from someone else, e.g. a parent's bank."}},
      ["from_currency", "to_currency", "amount"])
def get_fx_quotes(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    src, dst, amt = a["from_currency"].upper(), a["to_currency"].upper(), _num(a["amount"])
    own = a.get("own_wallet", True)
    note = ""
    try:
        qs = ctx.fx.quotes(src, dst, amt, include_wallet=own)
    except FxUnavailable:
        try:
            qs = ctx.fx.quotes(src, dst, amt, include_wallet=own)
            note = "First quote request timed out; retried successfully."
        except FxUnavailable:
            qs = [q for q in ctx.fx.cached_quotes(src, dst, amt) if own or not q["own_wallet_only"]]
            note = "Live quotes are unavailable right now; these are cached quotes and may be slightly out of date."
    best, worst = qs[0], qs[-1]
    return {"quotes": qs, "amount": amt, "from_currency": src, "best": best["provider"],
            "saving_vs_worst": round(best["you_receive"] - worst["you_receive"], 2),
            "saving_currency": dst, "note": note,
            "disclosure": "Rates are a simulated snapshot for the sandbox. Not financial advice."}


@tool("get_fx_history", "Range of the exchange rate over the last 30 days. Use this instead of predicting rates.",
      {"from_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]},
       "to_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]}},
      ["from_currency", "to_currency"])
def get_fx_history(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    return ctx.fx.history(a["from_currency"], a["to_currency"])


@tool("get_tuition_schedule", "Upcoming tuition installments, due dates, and whether current balances cover them.", {})
def get_tuition_schedule(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    items = [t for t in ctx.bank.tuition(ctx.user_id) if not t["paid"]]
    accs = ctx.bank.accounts(ctx.user_id)
    fund = sum(x["balance"] for x in accs if x["currency"] == "CAD" and "Tuition" in x["label"])
    myr_cad = sum(x["balance"] * ctx.fx.mid("MYR", "CAD") for x in accs if x["currency"] == "MYR")
    out = []
    for t in items:
        days = (date.fromisoformat(t["due"]) - ctx.today).days
        out.append({**t, "days_until_due": days})
    nxt = out[0] if out else None
    shortfall = round(max(0.0, nxt["amount"] - fund), 2) if nxt else 0.0
    return {"installments": out, "tuition_fund_cad": round(fund, 2),
            "next_shortfall_cad": shortfall,
            "myr_wallet_value_cad": round(myr_cad, 2),
            "hint": "Cover a shortfall with prepare_conversion(MYR to CAD, destination='tuition') or by asking "
                    "the sponsor with request_sponsor_topup."}


@tool("budget_summary", "Spending by category over the last 30 days compared with monthly budgets, in CAD.", {})
def budget_summary(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    rows = ctx.bank.transactions(ctx.user_id, 30, "", ctx.today)
    spend: Dict[str, float] = {}
    income = 0.0
    for r in rows:
        cad = r["amount"] * ctx.fx.mid(r["currency"], "CAD")
        if r["category"] == "conversion":
            continue
        if cad < 0:
            spend[r["category"]] = spend.get(r["category"], 0.0) + -cad
        else:
            income += cad
    budgets = ctx.bank.budgets(ctx.user_id)
    cats = []
    for c, v in sorted(spend.items(), key=lambda kv: -kv[1]):
        b = budgets.get(c)
        cats.append({"category": c, "spent_cad": round(v, 2),
                     "budget_cad": b["monthly"] if b else None,
                     "over_budget": bool(b and v > b["monthly"])})
    subs: Dict[str, int] = {}
    for r in rows:
        if r["category"] == "entertainment":
            subs[r["counterparty"]] = subs.get(r["counterparty"], 0) + 1
    dupes = [k for k, n in subs.items() if n > 1]
    return {"period_days": 30, "categories": cats, "total_spent_cad": round(sum(spend.values()), 2),
            "income_cad": round(income, 2),
            "possible_duplicate_charges": dupes}


@tool("credit_building_plan", "Steps to build a Canadian credit history from nothing. General information only.",
      {"has_credit_card": {"type": "boolean"}, "has_sin": {"type": "boolean"},
       "months_in_canada": {"type": "integer"}})
def credit_building_plan(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    steps = []
    if not a.get("has_sin", True):
        steps.append("Get a Social Insurance Number if your study permit allows work; lenders often ask for it.")
    if not a.get("has_credit_card", False):
        steps.append("Open a student or secured credit card with a low limit. A secured card needs a refundable "
                     "deposit and reports to the credit bureaus like a normal card.")
    steps += [
        "Put one small recurring bill on the card (e.g. the phone plan) and set autopay for the full statement balance.",
        "Keep the balance under about 30% of the limit at statement time.",
        "Never miss a payment; payment history is the largest factor in a credit score.",
        "Check your report for free from Equifax and TransUnion Canada once you have a few months of history.",
        "Avoid applying for many cards at once; each hard inquiry has a small effect.",
    ]
    return {"steps": steps, "disclosure": "General information, not personalised financial advice. "
            "HomeBridge is not a licensed adviser."}


@tool("check_message_for_scam",
      "Check a message, email, text or payment request the user received for scam or manipulation patterns.",
      {"text": {"type": "string", "description": "The full message the user received"}}, ["text"])
def check_message_for_scam(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    text = str(a.get("text", ""))[:4000]
    ctx.untrusted_texts.append(text)
    g = guard_check(text)
    explain = shared_classifier().explain(text) if g.model.get("label") != "benign" else []
    verdict = "likely_scam" if "scam" in g.flags else ("suspicious" if g.flags else "no_known_pattern")
    tips = []
    if verdict != "no_known_pattern":
        tips = ["Do not pay or share codes. Contact the organisation using a number from its official website.",
                "Government agencies in Canada do not demand payment by gift card, crypto or wire under threat.",
                "If you already paid, contact your bank right away and report it to the Canadian Anti-Fraud Centre."]
    if "scam" in g.flags and "scam" not in ctx.guard_flags:
        ctx.guard_flags.append("scam")
    return {"verdict": verdict, "signals": g.matches, "model": g.model, "model_keywords": explain, "advice": tips}


@tool("get_pending_actions", "Drafted payments, conversions, payee requests and sponsor requests, with status.", {})
def get_pending_actions(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    acts = ctx.policy.list_for(ctx.user_id)
    return {"actions": [x.for_model() for x in acts[-10:]]}


# ---------------------------------------------------------------- T1 writes
@tool("set_budget", "Set a monthly budget for a spending category.",
      {"category": {"type": "string"}, "monthly_amount": {"type": "number"},
       "currency": {"type": "string", "enum": ["CAD", "MYR"]}}, ["category", "monthly_amount"], tier="T1")
def set_budget(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    amt = _num(a["monthly_amount"])
    if amt < 0 or amt > 100000:
        raise ValueError("budget must be between 0 and 100000")
    ctx.bank.set_budget(ctx.user_id, a["category"], amt, a.get("currency") or "CAD")
    return {"ok": True, "category": a["category"].lower(), "monthly": amt}


@tool("create_reminder", "Create a reminder for a date (YYYY-MM-DD).",
      {"due_date": {"type": "string"}, "text": {"type": "string"}}, ["due_date", "text"], tier="T1")
def create_reminder(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    d = date.fromisoformat(str(a["due_date"])[:10])
    rid = ctx.bank.add_reminder(ctx.user_id, d.isoformat(), str(a["text"])[:200])
    return {"ok": True, "reminder_id": rid, "due_date": d.isoformat()}


@tool("request_sponsor_topup", "Ask the sponsor (parent) to send money, with a reason. The sponsor decides in their app.",
      {"amount": {"type": "number"}, "currency": {"type": "string", "enum": ["MYR", "CAD"]},
       "reason": {"type": "string"}}, ["amount", "reason"], tier="T1")
def request_sponsor_topup(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    act = ctx.policy.draft_topup_request(ctx.user_id, ctx.session_id, _num(a["amount"]),
                                         a.get("currency") or "CAD", str(a["reason"]))
    ctx.created_actions.append(act)
    return {"action": act.for_model()}


# ------------------------------------------------------------- T2/T3 drafts
PAYEE_HINTS = {"rent": ["rent", "landlord", "apartment"], "tuition": ["tuition", "ubc", "school", "fees", "university"],
               "utilities": ["hydro", "electric", "utility", "utilities"], "phone": ["phone", "mobile", "plan"]}


def resolve_payee(ctx: ToolContext, ref: str) -> Optional[Dict[str, Any]]:
    ref = (ref or "").strip().lower()
    payees = [p for p in ctx.bank.payees(ctx.user_id) if p["status"] == "active"]
    for p in payees:
        if ref in (p["id"].lower(), p["name"].lower()):
            return p
    for p in payees:
        if len(ref) >= 3 and (ref in p["name"].lower() or p["name"].lower() in ref):
            return p
    for kind, words in PAYEE_HINTS.items():
        if any(w in ref for w in words):
            match = [p for p in payees if p["kind"] == kind]
            if len(match) == 1:
                return match[0]
    return None


@tool("prepare_transfer",
      "Draft a payment to a SAVED payee. This does not send money: the user must confirm in the app, and some "
      "payments also need sponsor approval. Ask the user for any missing payee or amount first.",
      {"payee": {"type": "string", "description": "Saved payee name or id"},
       "amount": {"type": "number", "description": "Amount in the payee's currency"},
       "memo": {"type": "string"},
       "from_account_id": {"type": "string", "description": "Optional source account id"}},
      ["payee", "amount"], tier="T2/T3")
def prepare_transfer(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    p = resolve_payee(ctx, str(a.get("payee", "")))
    if not p:
        return {"error": "No saved payee matches. Ask the user which payee, or use add_payee for a new one.",
                "saved_payees": [x["name"] for x in ctx.bank.payees(ctx.user_id) if x["status"] == "active"]}
    amount = _num(a["amount"])
    prov = {"amount": "untrusted" if _amount_from_untrusted(ctx, amount) else "user"}
    act = ctx.policy.draft_transfer(ctx.user_id, ctx.session_id, p["id"], amount, str(a.get("memo") or ""),
                                    str(a.get("from_account_id") or ""), list(ctx.guard_flags), prov)
    ctx.created_actions.append(act)
    return {"action": act.for_model()}


@tool("prepare_conversion",
      "Draft a currency conversion between the user's own wallets. Does not execute until the user confirms in the app.",
      {"from_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]},
       "to_currency": {"type": "string", "enum": ["MYR", "CAD", "USD"]},
       "amount": {"type": "number", "description": "Amount in from_currency"},
       "destination": {"type": "string", "enum": ["everyday", "tuition"],
                       "description": "Which account receives the money: 'tuition' for the CAD Tuition Fund "
                                      "(e.g. to cover a tuition shortfall), default 'everyday'"}},
      ["from_currency", "to_currency", "amount"], tier="T2/T3")
def prepare_conversion(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    act = ctx.policy.draft_conversion(ctx.user_id, ctx.session_id, a["from_currency"], a["to_currency"],
                                      _num(a["amount"]), list(ctx.guard_flags),
                                      str(a.get("destination") or "everyday").lower())
    ctx.created_actions.append(act)
    return {"action": act.for_model()}


@tool("add_payee",
      "Request a new payee. Always needs sponsor approval and then a cooling period before the first payment.",
      {"name": {"type": "string"}, "kind": {"type": "string",
       "enum": ["rent", "tuition", "utilities", "phone", "individual", "business", "crypto", "gift_card", "unknown"]},
       "currency": {"type": "string", "enum": ["CAD", "MYR", "USD"]},
       "account_number": {"type": "string"}}, ["name", "kind", "currency", "account_number"], tier="T3")
def add_payee(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    number = str(a["account_number"])
    digits = re.sub(r"\D", "", number)
    prov = {"number": "untrusted" if digits and any(digits in re.sub(r"\D", "", t) for t in ctx.untrusted_texts)
            else "user"}
    act = ctx.policy.draft_add_payee(ctx.user_id, ctx.session_id, str(a["name"]), str(a.get("kind") or "unknown"),
                                     str(a.get("currency") or "CAD"), number, prov)
    ctx.created_actions.append(act)
    return {"action": act.for_model()}


@tool("cancel_pending_action", "Cancel a drafted action that has not executed yet (e.g. when the user changes their mind).",
      {"action_id": {"type": "string"}}, ["action_id"], tier="T1")
def cancel_pending_action(ctx: ToolContext, a: Dict[str, Any]) -> Dict[str, Any]:
    act = ctx.policy.cancel(str(a["action_id"]), ctx.user_id)
    return {"action": act.for_model()}
