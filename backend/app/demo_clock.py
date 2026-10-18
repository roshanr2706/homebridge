"""The sandbox's calendar, for the demo operator's "Skip to tuition week".

The demo pins "today" (HB_DEMO_TODAY). A time skip moves that date forward by N days, everywhere it is read: the
agent's per-turn context and tools (agent.today), the offline engine (which takes it from that context), the
wallet, forecast and tuition endpoints, the sponsor's second opinion, and the autopilot (bank.today).

The sandbox's routine moves with the clock, so ordinary life keeps its shape: past transactions, the recurring
schedule (pay, rent, bills), the secured card's statement cycle and new transactions (bank.now()) all shift by the
same N days. What stays put is what was really scheduled for a date: tuition installments, reminders, mandate expiry
dates and the inbox. So "skip to tuition week" means the tuition due date is now a week away, and the tuition guard,
the forecast and the bills react to that. Payee cooling periods, payee age and remittance timing run on the real
clock and are not skipped. A demo reset puts the calendar back on the pinned date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional

MAX_SKIP_DAYS = 200
TUITION_WEEK_DAYS = 7


class ClockError(Exception):
    """A skip the operator can't make. The message is safe to show."""


def _shift_ts(ts: Optional[str], days: int) -> Optional[str]:
    if not ts:
        return ts
    if len(ts) == 10:
        return (date.fromisoformat(ts) + timedelta(days=days)).isoformat()
    return (datetime.fromisoformat(ts) + timedelta(days=days)).isoformat(timespec="seconds")


def shift_routine(bank: Any, days: int) -> None:
    """Moves the sandbox's history and routine schedule forward by `days` (see the module docstring)."""
    columns = {"transactions": ["ts"], "recurring": ["next_due"], "credit_cards": ["opened", "next_close"],
               "card_statements": ["closed", "due", "paid_on"], "card_activity": ["ts"]}
    with bank._lock:
        for table, cols in columns.items():
            rows = bank.db.execute(f"SELECT id, {', '.join(cols)} FROM {table}").fetchall()
            for r in rows:
                values = [_shift_ts(r[c], days) for c in cols]
                bank.db.execute(f"UPDATE {table} SET {', '.join(c + '=?' for c in cols)} WHERE id=?",
                                (*values, r["id"]))
        bank.db.commit()
        bank.skew_days += days


def tuition_week_days(st: Any, owner: str) -> int:
    """Days to skip so the next unpaid tuition installment is a week away."""
    nxt = next((t for t in st.bank.tuition(owner) if not t["paid"]), None)
    if not nxt:
        raise ClockError("No unpaid tuition installment to skip to.")
    days = (date.fromisoformat(nxt["due"]) - st.agent.today).days - TUITION_WEEK_DAYS
    if days < 1:
        raise ClockError("Tuition is already less than a week away.")
    return days


def skip(st: Any, days: int, actor: str) -> Dict[str, Any]:
    """Moves the sandbox's today forward and runs the autopilot once on the new date."""
    if not 1 <= days <= MAX_SKIP_DAYS:
        raise ClockError(f"Skip between 1 and {MAX_SKIP_DAYS} days.")
    before = st.agent.today
    shift_routine(st.bank, days)
    st.agent.today = before + timedelta(days=days)
    st.bank.today = st.agent.today
    # A sandbox rate move belongs to the day the operator made it: the new week starts back on the snapshot rate,
    # so the rate watch doesn't fire again unless the operator moves the rate again.
    rate_reset = bool(st.fx.overrides)
    st.fx.overrides.clear()
    st.audit.record("time_skipped", actor, days=days, before=before.isoformat(), after=st.agent.today.isoformat(),
                    rate_reset=rate_reset)
    return {"today": st.agent.today.isoformat(), "skipped_days": days, "decisions": st.policy.autopilot.run()}
