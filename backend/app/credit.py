"""Credit Builder: what the sandbox secured card says about the student's credit habits.

Pure functions over the card rows from the bank, so the maths is unit-tested on
its own. All amounts are integer minor units (cents) until the result is built.

This is educational. HomeBridge has no access to Equifax or TransUnion files and
never produces or quotes a credit score. The "credit health" band is a simulated
indicator computed only from this one sandbox card, and is labelled as such.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

TARGET = 0.30   # the commonly cited ceiling for reported utilization
IDEAL = 0.10    # under 10% is usually better still

DISCLOSURE = ("General information, not personalised financial advice. HomeBridge is not a licensed adviser. "
              "This is not a credit score: HomeBridge cannot see your Equifax or TransUnion file, and the "
              "indicator is simulated from your sandbox card only.")

# Approximate weights that Canadian credit education material commonly cites. The bureaus do not publish
# exact formulas, so these are for explanation only.
FACTOR_WEIGHTS = [
    ("payment_history", "Payment history", 35),
    ("utilization", "Credit utilization", 30),
    ("history_length", "Length of credit history", 15),
    ("new_credit", "New credit and inquiries", 10),
    ("credit_mix", "Credit mix", 10),
]


def major(minor: int) -> float:
    return round(minor / 100.0, 2)


def utilization_pct(balance_minor: int, limit_minor: int) -> float:
    """Balance as a percentage of the limit, one decimal, rounded down so 29.97% never shows as "30.0%".
    A zero limit or a credit balance counts as 0%."""
    if limit_minor <= 0 or balance_minor <= 0:
        return 0.0
    return (1000 * balance_minor // limit_minor) / 10


def pay_to_get_under(balance_minor: int, limit_minor: int, ratio: float = TARGET) -> int:
    """Smallest whole-dollar payment (in cents) that leaves the balance strictly under ratio x limit.

    Rounded up to a whole dollar so the figure is easy to act on; never more than the balance.
    """
    cap = int(round(limit_minor * ratio))
    if balance_minor < cap:
        return 0
    need = balance_minor - cap
    pay = (need // 100 + 1) * 100
    return min(pay, balance_minor)


def months_between(start: date, end: date) -> int:
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return max(0, months)


def statement_status(st: Dict[str, Any], today: date) -> str:
    """on_time | late | due (minimum not yet paid, due date not passed)."""
    due = date.fromisoformat(st["due"])
    paid_on = date.fromisoformat(st["paid_on"]) if st.get("paid_on") else None
    if st["paid"] >= st["min_due"] and paid_on is not None:
        return "on_time" if paid_on <= due else "late"
    if st["min_due"] <= 0:
        return "on_time"
    return "due" if today <= due else "late"


def on_time_streak(statuses_newest_first: List[str]) -> int:
    """Consecutive on-time statements, newest first. A statement that is not yet due does not break it."""
    streak = 0
    for i, s in enumerate(statuses_newest_first):
        if s == "due" and i == 0:
            continue
        if s != "on_time":
            break
        streak += 1
    return streak


def health_band(late: int, util_now: float, months: int) -> Dict[str, str]:
    if late:
        key, label = "needs_attention", "Needs attention"
    elif util_now >= 50:
        key, label = "needs_attention", "Needs attention"
    elif util_now >= 30:
        key, label = "fair", "Fair"
    elif months >= 12 and util_now < 10:
        key, label = "strong", "Strong"
    else:
        key, label = "on_track", "On track"
    return {"key": key, "label": label,
            "basis": "Simulated from on-time payments, utilization and card age on your sandbox card. "
                     "Not a credit score."}


def _money(minor: int, cur: str) -> str:
    return f"{cur} {minor / 100:,.2f}"


def _whole(minor: int, cur: str) -> str:
    return f"{cur} {minor / 100:,.0f}" if minor % 100 == 0 else _money(minor, cur)


def profile(card: Dict[str, Any], statements: List[Dict[str, Any]], purchases_since_close_minor: int,
            today: date) -> Dict[str, Any]:
    """Everything get_credit_profile returns, from raw card rows (minor units).

    `statements` are newest first. `card["balance"]` is what is owed now.
    """
    cur = card["currency"]
    limit, bal = int(card["credit_limit"]), int(card["balance"])
    next_close = date.fromisoformat(card["next_close"])
    days_to_close = max(0, (next_close - today).days)
    opened = date.fromisoformat(card["opened"])
    months = months_between(opened, today)

    statuses = [statement_status(s, today) for s in statements]
    streak = on_time_streak(statuses)
    late = statuses.count("late")
    closed_count = sum(1 for s in statuses if s != "due")

    last = statements[0] if statements else None
    last_status = statuses[0] if statements else None
    stmt_remaining = max(0, min(last["balance"] - last["paid"], bal)) if last else 0
    min_remaining = max(0, min(last["min_due"] - last["paid"], bal)) if last else 0
    due = date.fromisoformat(last["due"]) if last else None

    util_now = utilization_pct(bal, limit)
    util_reported = utilization_pct(last["balance"], limit) if last else 0.0
    # At the current pace of purchases this cycle, with no payment, what the next statement would report.
    days_in_cycle = max(1, (today - date.fromisoformat(last["closed"])).days) if last else 1
    pace = purchases_since_close_minor / days_in_cycle
    projected = min(limit, bal + int(round(pace * days_to_close)))
    util_projected = utilization_pct(projected, limit)

    pay_30 = pay_to_get_under(bal, limit, TARGET)
    pay_10 = pay_to_get_under(bal, limit, IDEAL)
    recommended = max(stmt_remaining, pay_30)
    after = bal - recommended

    actions: List[Dict[str, Any]] = []
    if last and last_status == "due" and min_remaining > 0:
        days = (due - today).days
        actions.append({"key": "minimum", "amount": major(min_remaining), "by": due.isoformat(),
                        "text": f"Pay at least the minimum, {_money(min_remaining, cur)}, by {due.isoformat()} "
                                f"({days} day{'s' if days != 1 else ''} away). Paying on time is the biggest factor"
                                + (f", and keeps your {streak}-payment on-time streak." if streak
                                   else ", and starts your on-time record.")})
    if stmt_remaining > 0 and due and today <= due:
        interest = max(0, stmt_remaining - min_remaining) * float(card["apr"]) / 100 / 12
        actions.append({"key": "statement_balance", "amount": major(stmt_remaining), "by": due.isoformat(),
                        "text": f"Pay the full statement balance, {_money(stmt_remaining, cur)}, by {due.isoformat()} "
                                f"to avoid interest ({card['apr']}% a year; about {cur} {interest / 100:,.2f} for a "
                                f"month if you pay only the minimum)."})
    if pay_30 > 0:
        actions.append({"key": "under_30", "amount": major(pay_30), "by": next_close.isoformat(),
                        "text": f"Pay {_whole(pay_30, cur)} before your statement closes on {next_close.isoformat()} "
                                f"so the balance reported to the bureaus is under 30% of your limit "
                                f"({_money(bal - pay_30, cur)} of {_whole(limit, cur)})."})
    elif pay_10 > 0:
        actions.append({"key": "under_10", "amount": major(pay_10), "by": next_close.isoformat(),
                        "text": f"You're under 30%. Paying {_whole(pay_10, cur)} before {next_close.isoformat()} "
                                f"would report under 10%, which is better still."})
    if recommended > 0 and len([a for a in actions if a.get("amount")]) > 1:
        actions.append({"key": "one_payment", "amount": major(recommended), "by": (due or next_close).isoformat(),
                        "text": f"One payment of {_money(recommended, cur)} now covers all of that and leaves "
                                f"{_money(after, cur)} ({utilization_pct(after, limit)}% of your limit)."})
    if card.get("autopay", "off") == "off":
        actions.append({"key": "autopay",
                        "text": "Set up autopay for at least the minimum payment with the card issuer, so one busy "
                                "week never costs you your on-time record."})
    actions.append({"key": "keep_open",
                    "text": "Keep this card open, even after you move to an unsecured card. Closing your oldest "
                            "account shortens your credit history and cuts your available credit."})
    if months >= 12 and streak >= 12:
        actions.append({"key": "graduate",
                        "text": f"With a year of on-time payments, ask the issuer about an unsecured card and "
                                f"getting your {_whole(int(card['deposit']), cur)} deposit back."})
    else:
        actions.append({"key": "graduate",
                        "text": f"After about 12 months of on-time payments (you're at {months}), ask the issuer about "
                                f"moving to an unsecured card and getting your {_whole(int(card['deposit']), cur)} "
                                f"deposit back."})

    def status(ok: bool, warn: bool) -> str:
        return "good" if ok else ("attention" if warn else "building")

    factors = [
        {"key": "payment_history", "label": "Payment history", "approx_weight_pct": 35,
         "status": "attention" if late else "good",
         "detail": (f"{closed_count - late} of {closed_count} statements paid on time"
                    + (f"; {late} late" if late else "") + "."),
         "tip": "Never miss the minimum. One late payment can stay on a Canadian report for years."},
        {"key": "utilization", "label": "Credit utilization", "approx_weight_pct": 30,
         "status": status(util_now < 30 and util_reported < 30, util_now >= 30 or util_reported >= 30),
         "detail": f"{util_now}% of your limit used now; your last statement reported {util_reported}%.",
         "tip": "What counts is the balance on the statement date, so pay down before it closes."},
        {"key": "history_length", "label": "Length of credit history", "approx_weight_pct": 15,
         "status": "good" if months >= 24 else "building",
         "detail": f"{months} month{'s' if months != 1 else ''} since the card was opened on {opened.isoformat()}.",
         "tip": "Only time fixes this. Keeping the card open lets it grow."},
        {"key": "new_credit", "label": "New credit and inquiries", "approx_weight_pct": 10,
         "status": "good" if int(card.get("hard_inquiries", 0)) <= 1 else "attention",
         "detail": f"{int(card.get('hard_inquiries', 0))} hard inquiry (the card application).",
         "tip": "Avoid applying for several cards or loans close together."},
        {"key": "credit_mix", "label": "Credit mix", "approx_weight_pct": 10, "status": "building",
         "detail": "One credit card. That is normal for a student.",
         "tip": "Don't borrow just to change your mix."},
    ]

    return {
        "card": {"label": card["label"], "number": card["number_masked"], "currency": cur, "secured": True,
                 "credit_limit": major(limit), "balance": major(bal), "available": major(limit - bal),
                 "deposit": major(int(card["deposit"])), "opened": opened.isoformat(), "apr": card["apr"],
                 "autopay": card.get("autopay", "off")},
        "utilization_pct": util_now,
        "utilization_reported_pct": util_reported,
        "utilization_projected_at_close_pct": util_projected,
        "projected_balance_at_close": major(projected),
        "projection_basis": "At this cycle's pace of purchases, with no payment before the statement closes.",
        "target_pct": int(TARGET * 100),
        "next_statement_date": next_close.isoformat(),
        "days_until_statement": days_to_close,
        "statement": None if not last else {
            "closed": last["closed"], "balance": major(last["balance"]), "minimum_due": major(last["min_due"]),
            "paid": major(last["paid"]), "remaining": major(stmt_remaining), "due_date": last["due"],
            "days_until_due": (due - today).days, "status": last_status},
        "on_time_streak": streak,
        "late_payments": late,
        "months_of_history": months,
        "payment_history": [{"closed": s["closed"], "status": st}
                            for s, st in reversed(list(zip(statements, statuses)))],
        "pay_to_report_under_30": major(pay_30),
        "pay_to_report_under_10": major(pay_10),
        "recommended_payment": {"amount": major(recommended), "balance_after": major(after),
                                "utilization_after_pct": utilization_pct(after, limit)},
        "factors": factors,
        "credit_health": health_band(late, util_now, months),
        "next_actions": actions,
        "not_a_credit_score": True,
        "disclosure": DISCLOSURE,
    }


def payment_amount(target: str, prof: Dict[str, Any]) -> Optional[float]:
    """Amount for a named payment target from a profile, or None for an unknown target."""
    owed = prof["card"]["balance"]
    st = prof.get("statement") or {}
    remaining = st.get("remaining", 0.0)
    minimum = max(0.0, min(st.get("minimum_due", 0.0) - st.get("paid", 0.0), owed))
    return {
        "statement_balance": remaining,
        "minimum": round(minimum, 2),
        "under_30": prof["pay_to_report_under_30"],
        "under_10": prof["pay_to_report_under_10"],
        "full_balance": owed,
        "recommended": prof["recommended_payment"]["amount"],
    }.get(target)
