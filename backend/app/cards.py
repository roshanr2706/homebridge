"""Structured cards for the app, built from tool results.

The app shows numbers (balances, quotes, due dates, scam signals) from these
cards rather than from the model's prose. The cards come straight from our
tools, so a model that misreads or invents a figure cannot put a wrong number
in front of the user in a card. The model's text sits next to the card, and
the card is the source of truth.

Only read-only (T0) tool results become cards. Drafted actions already have
their own confirmation card.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Callable, Dict, List, Optional, Tuple

Builder = Callable[[Dict[str, Any], Dict[str, Any]], Optional[Dict[str, Any]]]


def _balances(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "accounts" not in r:
        return None
    return {"type": "balances", "total": r["total"], "total_currency": r["total_currency"],
            "accounts": [{k: a[k] for k in ("label", "currency", "balance", "number", "sponsor_funded")}
                         for a in r["accounts"]]}


def _fx_quotes(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    qs = r.get("quotes")
    if not qs:
        return None
    amount = r.get("amount")  # parsed by the tool; the model may have sent "5,000" or "5k"
    keep = ("provider", "provider_key", "you_receive", "receive_currency", "fee", "fee_currency", "rate",
            "mid_rate", "true_cost", "true_cost_pct", "speed")
    return {"type": "fx_quotes", "from_currency": str(args.get("from_currency", "")).upper(),
            "to_currency": qs[0]["receive_currency"], "amount": amount,
            "best": r.get("best"), "saving_vs_worst": r.get("saving_vs_worst"),
            "cached": any(q.get("cached") for q in qs), "note": r.get("note") or "",
            "quotes": [{k: q.get(k) for k in keep} for q in qs]}


def _fx_history(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "pair" not in r:
        return None
    return {"type": "fx_history", **{k: r.get(k) for k in ("pair", "today", "low", "high", "average", "days", "series")}}


def _tuition(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    items = r.get("installments")
    if items is None:
        return None
    return {"type": "tuition", "installments": [{k: t[k] for k in ("term", "due", "amount", "currency", "days_until_due")}
                                                for t in items],
            "tuition_fund_cad": r["tuition_fund_cad"], "next_shortfall_cad": r["next_shortfall_cad"],
            "myr_wallet_value_cad": r["myr_wallet_value_cad"]}


def _budget(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "categories" not in r:
        return None
    return {"type": "budget", "period_days": r["period_days"], "categories": r["categories"],
            "total_spent_cad": r["total_spent_cad"], "income_cad": r["income_cad"],
            "possible_duplicate_charges": r.get("possible_duplicate_charges", [])}


def _scam(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "verdict" not in r:
        return None
    model = r.get("model") or {}
    return {"type": "scam_check", "verdict": r["verdict"], "signals": r.get("signals", {}),
            "model_label": model.get("label"), "model_confidence": model.get("confidence"),
            "model_keywords": r.get("model_keywords", []), "advice": r.get("advice", [])}


def _transactions(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = r.get("transactions")
    if rows is None:
        return None
    return {"type": "transactions", "count": r.get("count", len(rows)),
            "rows": [{k: t[k] for k in ("date", "counterparty", "amount", "currency", "category")} for t in rows[:8]]}


def _credit(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "steps" not in r:
        return None
    return {"type": "checklist", "title": "Building Canadian credit", "items": r["steps"],
            "footnote": r.get("disclosure", "")}


FORECAST_POINTS = 92  # enough bars for a phone-width chart


def forecast_card(args: Dict[str, Any], r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Runway chart: the daily series bucketed to at most FORECAST_POINTS bars, each bar its bucket's minimum
    so a short dip below zero still shows. Marker positions are bar indexes."""
    series = r.get("series")
    if not series:
        return None
    step = max(1, -(-len(series) // FORECAST_POINTS))
    bars = [min(series[i:i + step]) for i in range(0, len(series), step)]
    start = date.fromisoformat(r["start_date"])

    def bar(iso: Optional[str]) -> Optional[int]:
        return None if not iso else min(len(bars) - 1, (date.fromisoformat(iso) - start).days // step)

    return {"type": "forecast", "account": r["account"], "start_date": r["start_date"], "end_date": r["end_date"],
            "horizon": r["horizon"], "verdict": r["verdict"], "series": bars, "step_days": step,
            "starting_balance": r["starting_balance"], "ending_balance": r["ending_balance"],
            "lowest": {**r["lowest"], "index": bar(r["lowest"]["date"])},
            "first_shortfall_date": r["first_shortfall_date"], "shortfall_index": bar(r["first_shortfall_date"]),
            "tuition": [{**{k: t[k] for k in ("term", "due", "amount", "gap")}, "index": bar(t["due"])}
                        for t in r.get("tuition", [])],
            "weekly_spending_cad": r["weekly_spending_cad"],
            "pending_included": r.get("pending_included", []),
            "suggestions": [s["text"] for s in r.get("suggestions", [])],
            "disclosure": r.get("disclosure", "")}


BUILDERS: Dict[str, Builder] = {
    "get_balances": _balances,
    "get_fx_quotes": _fx_quotes,
    "get_fx_history": _fx_history,
    "get_tuition_schedule": _tuition,
    "budget_summary": _budget,
    "check_message_for_scam": _scam,
    "list_transactions": _transactions,
    "credit_building_plan": _credit,
    "forecast_cashflow": forecast_card,
}

# A transfer is drafted with a confirmation card already; showing the rent
# lookup that preceded it as a separate table is noise.
# A conversion draft shows its own rate and margin, so a quote table next to it is noise too.
SUPPRESS_WHEN_ACTION = {"list_transactions", "get_balances", "get_tuition_schedule", "get_fx_quotes"}


def build(results: List[Tuple[str, Dict[str, Any], Dict[str, Any]]], has_actions: bool) -> List[Dict[str, Any]]:
    """One card per tool (the latest call wins), in the order the tools first ran."""
    order: List[str] = []
    latest: Dict[str, Dict[str, Any]] = {}
    for name, args, result in results:
        if name not in BUILDERS or "error" in result:
            continue
        if has_actions and name in SUPPRESS_WHEN_ACTION:
            continue
        try:
            card = BUILDERS[name](args or {}, result)
        except (KeyError, TypeError, IndexError):
            card = None
        if card is None:
            continue
        if name not in latest:
            order.append(name)
        latest[name] = card
    return [latest[n] for n in order]
