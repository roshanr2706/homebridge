"""Sponsor-side safety controls: the emergency freeze and unusual-activity alerts.

Both are enforced here and in PolicyEngine, never by the model:

* Freeze. A lock on outgoing money, kept per student in the bank's SQLite database. Money the
  sponsor funds and the student's own money are locked separately, and each lock remembers who set
  it. The sponsor can lock either and unlock everything, from the sponsor endpoints only. The
  student can lock everything (from chat through the T1 `freeze_payments` tool, or from the app)
  but can unlock only her own money, only from the app, and only if she locked it herself. There
  is no unlock tool, so nothing typed into the chat can lift a lock. While a lock applies, drafts
  are still allowed but Confirm, Approve and execution are refused.
* Alerts. Deterministic signals (several confirmed payments in an hour, a first payment to a payee
  well above the student's usual size, activity in the small hours in Vancouver, repeated failed
  or refused confirmations) are stored as alerts the sponsor sees in their overview. An alert
  needs no approval; for 24 hours it adds risk to every new draft, so combined with any other
  signal the next payment goes to the sponsor.

`clock` is injectable so tests can fix the time of day.
"""
from __future__ import annotations

import json
import statistics
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank
from .fx import FxMarket

FROZEN_PREFIX = "Payments are locked:"
SCOPES = ("sponsor_funded", "all")

# Points an alert adds to every draft for 24 hours (the largest active one counts, not the sum).
ALERT_WEIGHTS = {"velocity": 25, "failed_confirms": 25, "first_large_payment": 15, "odd_hours": 10,
                 "student_freeze": 0}
VELOCITY_COUNT, VELOCITY_WINDOW = 3, 3600          # confirmed payments within an hour
FAILED_COUNT, FAILED_WINDOW = 3, 3600              # failed or refused confirmations within an hour
ODD_HOURS = range(1, 5)                            # 01:00 to 04:59 in Vancouver
FIRST_PAYMENT_FLOOR_CAD = 250.0                    # a first payment below this is never "large"
ALERT_TTL = 24 * 3600
DEDUPE = 3600                                      # the same kind of alert at most once an hour


class SafetyError(Exception):
    """A freeze request the caller may not make. Message is safe to show."""


def vancouver_time(ts: float) -> datetime:
    """Local time in Vancouver without a tz database (Windows has none by default):
    PDT (UTC-7) from the second Sunday of March to the first Sunday of November, else PST (UTC-8)."""
    utc = datetime.fromtimestamp(ts, timezone.utc)
    mar1, nov1 = datetime(utc.year, 3, 1, tzinfo=timezone.utc), datetime(utc.year, 11, 1, tzinfo=timezone.utc)
    start = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7, hours=10)   # 02:00 PST
    end = nov1 + timedelta(days=(6 - nov1.weekday()) % 7, hours=9)          # 02:00 PDT
    return (utc + timedelta(hours=-7 if start <= utc < end else -8)).replace(tzinfo=None)


class SafetyMonitor:
    def __init__(self, bank: Bank, fx: FxMarket, audit: AuditLog, clock: Callable[[], float] = time.time) -> None:
        self.bank, self.fx, self.audit, self.clock = bank, fx, audit, clock
        self._lock = threading.RLock()
        # In memory, like the per-minute chat limit: losing them on restart only delays an alert.
        self._confirms: Dict[str, List[float]] = {}
        self._failed: Dict[str, List[float]] = {}

    def reset(self) -> None:
        with self._lock:
            self._confirms.clear()
            self._failed.clear()

    def _name(self, owner: str) -> str:
        return ((self.bank.user(owner) or {}).get("name") or owner).split()[0]

    # ------------------------------------------------------------- freeze
    def state(self, owner: str) -> Dict[str, Any]:
        s = self.bank.load_freeze(owner) or {}
        own, sponsor = s.get("own"), s.get("sponsor_funded")
        return {"frozen": bool(own or sponsor), "own": own, "sponsor_funded": sponsor,
                "since": s.get("since") if (own or sponsor) else None}

    def freeze(self, owner: str, by: str, scope: str = "all", actor: str = "") -> Dict[str, Any]:
        if by not in ("student", "sponsor") or scope not in SCOPES:
            raise SafetyError("Unknown freeze scope.")
        with self._lock:
            s = self.state(owner)
            before = dict(s)
            if by == "sponsor":
                s["sponsor_funded"] = "sponsor"
                if scope == "all":
                    s["own"] = "sponsor"
            else:  # the student locks everything, but never downgrades a lock the sponsor set
                s["own"] = s["own"] or "student"
                s["sponsor_funded"] = s["sponsor_funded"] or "student"
            self._store(owner, s, before.get("since"))
            self.audit.record("payments_frozen", actor or owner, owner=owner, by=by, scope=scope,
                              own=s["own"], sponsor_funded=s["sponsor_funded"])
            if by == "student" and not before["frozen"]:
                self._raise(owner, "student_freeze", f"{self._name(owner)} locked all payments, which often means a "
                            "scam attempt. A call to check in is a good idea.")
            return self.state(owner)

    def unfreeze(self, owner: str, by: str, actor: str = "") -> Dict[str, Any]:
        """The sponsor unlocks everything. The student unlocks only her own money, and only a lock she set."""
        with self._lock:
            s = self.state(owner)
            if by == "sponsor":
                lifted = [k for k in ("own", "sponsor_funded") if s[k]]
                s["own"] = s["sponsor_funded"] = None
            elif by == "student":
                if s["own"] == "sponsor":
                    self.audit.record("unfreeze_denied", actor or owner, owner=owner, reason="locked by sponsor")
                    raise SafetyError("Your sponsor locked your payments, so only they can unlock them.")
                lifted = ["own"] if s["own"] else []
                s["own"] = None
            else:
                raise SafetyError("Only the student or the sponsor can unlock payments.")
            self._store(owner, s, s.get("since"))
            out = self.state(owner)
            self.audit.record("payments_unfrozen", actor or owner, owner=owner, by=by, lifted=lifted,
                              still_locked=[k for k in ("own", "sponsor_funded") if out[k]])
            return out

    def _store(self, owner: str, s: Dict[str, Any], since: Optional[float]) -> None:
        frozen = bool(s.get("own") or s.get("sponsor_funded"))
        data = {"own": s.get("own"), "sponsor_funded": s.get("sponsor_funded"),
                "since": (since or self.clock()) if frozen else None}
        self.bank.save_freeze(owner, json.dumps(data, sort_keys=True))

    def frozen_reason(self, owner: str, kind: str, params: Dict[str, Any]) -> Optional[str]:
        """Why an action of this kind cannot run right now, or None. Inbound top-ups are never locked."""
        s = self.state(owner)
        if not s["frozen"] or kind == "topup":
            return None
        if kind == "add_payee":
            return "new payees can't be approved while payments are locked"
        acc = self.bank.account(params.get("from_account_id", ""))
        if not acc:
            return None
        key = "sponsor_funded" if acc["sponsor_funded"] else "own"
        by = s[key]
        if not by:
            return None
        name = self._name(owner)
        who = "the sponsor" if by == "sponsor" else name
        unlock = ("only the sponsor can unlock it" if key == "sponsor_funded" or by == "sponsor"
                  else f"{name} can unlock it in the app")
        return f"{who} locked payments from {acc['label']}; {unlock}"

    # ------------------------------------------------------------- alerts
    def _raise(self, owner: str, kind: str, message: str, **data: Any) -> Optional[Dict[str, Any]]:
        now = self.clock()
        if any(a["kind"] == kind and now - a["ts"] < DEDUPE for a in self.alerts(owner, DEDUPE)):
            return None
        alert = {"id": "al_" + uuid.uuid4().hex[:10], "owner": owner, "ts": now, "kind": kind,
                 "message": message, "weight": ALERT_WEIGHTS.get(kind, 0), **data}
        self.bank.save_alert(alert["id"], owner, now, kind, json.dumps(alert, sort_keys=True))
        self.audit.record("alert_raised", "system", owner=owner, kind=kind, alert_id=alert["id"],
                          **{k: v for k, v in data.items() if k in ("action_id", "count")})
        return alert

    def alerts(self, owner: str, within: float = ALERT_TTL) -> List[Dict[str, Any]]:
        since = self.clock() - within
        return [json.loads(r["data"]) for r in self.bank.load_alerts(owner, since)]

    def risk_bump(self, owner: str) -> Optional[Dict[str, Any]]:
        """The strongest alert of the last 24 hours, if it adds risk."""
        weighted = [a for a in self.alerts(owner) if a.get("weight")]
        return max(weighted, key=lambda a: (a["weight"], a["ts"])) if weighted else None

    def _odd_hours(self, owner: str, action_id: str) -> None:
        local = vancouver_time(self.clock())
        if local.hour in ODD_HOURS:
            self._raise(owner, "odd_hours", f"Payment activity at {local:%H:%M} in Vancouver, when "
                        f"{self._name(owner)} is usually asleep.", action_id=action_id)

    def note_draft(self, owner: str, kind: str, params: Dict[str, Any], action_id: str) -> None:
        with self._lock:
            if kind not in ("transfer", "conversion"):
                return
            self._odd_hours(owner, action_id)
            if kind == "transfer":
                self._first_large_payment(owner, params, action_id)

    def note_confirm(self, owner: str, kind: str, needs_sponsor: bool, action_id: str) -> None:
        """A student confirmation that went through. Velocity counts payments the student can finish alone."""
        with self._lock:
            if kind not in ("transfer", "conversion"):
                return
            self._odd_hours(owner, action_id)
            if needs_sponsor:
                return
            now = self.clock()
            recent = [t for t in self._confirms.get(owner, []) if now - t < VELOCITY_WINDOW] + [now]
            self._confirms[owner] = recent
            if len(recent) >= VELOCITY_COUNT:
                self._raise(owner, "velocity", f"{len(recent)} payments confirmed within an hour.",
                            action_id=action_id, count=len(recent))

    def note_failed_confirm(self, owner: str, action_id: str, why: str) -> None:
        with self._lock:
            now = self.clock()
            recent = [t for t in self._failed.get(owner, []) if now - t < FAILED_WINDOW] + [now]
            self._failed[owner] = recent
            if len(recent) >= FAILED_COUNT:
                self._raise(owner, "failed_confirms", f"{len(recent)} failed or refused confirmations within an "
                            f"hour (latest: {why}).", action_id=action_id, count=len(recent))

    def _first_large_payment(self, owner: str, params: Dict[str, Any], action_id: str) -> None:
        payee = self.bank.payee(params.get("payee_id", "")) or {}
        name = params.get("payee_name", "")
        history = self.bank.transactions(owner, days=120, today=datetime.fromtimestamp(self.clock()).date())
        if any(t["counterparty"] == name for t in history):
            return
        # A scheduled tuition installment is expected, not unusual.
        if any(t["payee_id"] == payee.get("id") and abs(t["amount"] - params["amount"]) < 0.01
               for t in self.bank.tuition(owner) if not t["paid"]):
            return
        outflows = [abs(t["amount"]) * self.fx.mid(t["currency"], "CAD") for t in history
                    if t["amount"] < 0 and t["category"] != "conversion"]
        typical = statistics.median(outflows) if outflows else 0.0
        amount_cad = params["amount"] * self.fx.mid(params["currency"], "CAD")
        if amount_cad > max(3 * typical, FIRST_PAYMENT_FLOOR_CAD):
            self._raise(owner, "first_large_payment",
                        f"First payment to {name} is CAD {amount_cad:,.0f}, far above {self._name(owner)}'s typical payment "
                        f"(about CAD {typical:,.0f}).", action_id=action_id)

    # ------------------------------------------------------------- digest
    def digest(self, owner: str, actions: List[Any]) -> Dict[str, Any]:
        """The sponsor's last-24-hours summary."""
        since = self.clock() - 24 * 3600
        recent = [a for a in actions if a.owner == owner and a.created_at >= since]
        spent = self.bank.outflow_since(owner, datetime.fromtimestamp(since).isoformat(timespec="seconds"))
        flagged = [a for a in recent if a.risk_score >= 40]
        alerts = self.alerts(owner)
        return {
            "window_hours": 24,
            "drafted": len(recent),
            "executed": sum(a.status == "executed" for a in recent),
            "awaiting_sponsor": sum(a.status == "awaiting_sponsor" for a in recent),
            "stopped": sum(a.status in ("rejected", "cancelled", "expired", "failed") for a in recent),
            "money_out_cad": round(sum(m / 100 * self.fx.mid(c, "CAD") for c, m in spent.items()), 2),
            "flagged": [{"action_id": a.id, "summary": a.summary, "risk_score": a.risk_score, "status": a.status}
                        for a in flagged][-5:],
            "alerts": len(alerts),
            "frozen": self.state(owner)["frozen"],
        }
