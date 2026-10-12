"""Remittances: money the sponsor sends from his own ringgit account in Kuala Lumpur to the student.

A money request (`request_sponsor_topup`, kind 'topup') waits for the sponsor. When he approves:

1. **Initiated.** He picks a transfer service from a true-cost comparison (`options()`, cheapest first and
   preselected in the app). The quote is locked: provider, rate, fee, what he sends and what arrives are written
   into the action's params as `quote`, and the params hash is recomputed over them, so the amounts can't change
   afterwards without the settlement noticing.
2. **Compliance checked.** The compliance layer runs again with the locked quote (sanctions on beneficiary and
   originator, KYC, the FINTRAC EFT record with rate and intermediary, the EFTR flag at CAD 10,000 or more, the
   BNM purpose code ED01/ED02). A sanctions hit blocks it before any money moves.
3. **In transit.** His account is debited by the send amount. The action is `in_transit` until `settle_after`:
   a few seconds per provider in demo mode, the provider's real speed (business days) otherwise.
4. **Credited.** Checked on read (`PolicyEngine.get` calls `tick`): once the clock passes `settle_after`, the
   student's chosen account is credited with exactly the locked receive amount and the action is `executed`.
   If the params no longer match their hash, nothing is credited and the money goes back to the sponsor.

Each leg is posted once under a reference derived from the action id (`Bank.post_once`), so a remittance can't
be debited, credited or refunded twice, even across a restart. Every step is audited. `clock` is injectable so
tests can move time forward.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank, BankError, mask, to_major, to_minor
from .config import Limits
from .fx import FxMarket, remit_providers

if TYPE_CHECKING:
    from .policy import PendingAction, PolicyEngine

# How long each service takes: seconds in demo mode, and the real delay otherwise.
SETTLE: Dict[str, Dict[str, int]] = {
    "lowcost": {"demo": 20, "business_days": 1},
    "express": {"demo": 10, "hours": 4},
    "bank": {"demo": 45, "business_days": 4},
    "duitnow": {"demo": 3, "minutes": 1},
    "ibg": {"demo": 12, "hours": 4},
}
STEPS = ("initiated", "compliance_checked", "in_transit", "credited")


def add_business_days(ts: float, n: int) -> float:
    d = datetime.fromtimestamp(ts, timezone.utc)
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.timestamp()


def _iso(ts: Optional[float]) -> Optional[str]:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds") if ts else None


class Remittances:
    def __init__(self, bank: Bank, fx: FxMarket, audit: AuditLog, limits: Limits,
                 clock: Callable[[], float] = time.time) -> None:
        self.bank, self.fx, self.audit, self.limits, self.clock = bank, fx, audit, limits, clock

    # ------------------------------------------------------------ quotes
    def sponsor_of(self, owner: str) -> str:
        return (self.bank.user(owner) or {}).get("sponsor_id") or ""

    def source(self, owner: str) -> Optional[Dict[str, Any]]:
        """The sponsor's own MYR account (raw row). Never shown to the student beyond its masked label."""
        sponsor = self.sponsor_of(owner)
        return self.bank.find_account(sponsor, "MYR") if sponsor else None

    def source_public(self, owner: str, with_balance: bool) -> Optional[Dict[str, Any]]:
        src = self.source(owner)
        if not src:
            return None
        out = {"label": src["label"], "number": mask(src["number"]), "currency": src["currency"]}
        if with_balance:   # the sponsor's own view only
            out["balance"] = to_major(src["balance"])
        return out

    def settle_delay(self, provider_key: str, start: float) -> float:
        """The timestamp at which a remittance sent through this provider at `start` arrives."""
        s = SETTLE.get(provider_key, {"demo": 20, "business_days": 1})
        if self.limits.remit_settle == "demo":
            return start + s["demo"]
        if "business_days" in s:
            return add_business_days(start, s["business_days"])
        return start + 3600 * s.get("hours", 0) + 60 * s.get("minutes", 0)

    def options(self, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Every service that can deliver the requested amount, cheapest for the sponsor first: what he sends,
        the fee, the spread, what arrives and when."""
        dst, want = params["currency"], float(params["amount"])
        now = self.clock()
        out = []
        for p in remit_providers(dst):
            q = self.fx.quote_to_receive(dst, want, p)
            out.append({"provider_key": p.key, "provider": p.name, "send_amount": q["send_amount"],
                        "send_currency": "MYR", "fee": q["fee"], "fee_currency": "MYR", "rate": q["rate"],
                        "mid_rate": q["mid_rate"], "spread_pct": p.spread_pct, "receive_amount": q["you_receive"],
                        "receive_currency": dst, "true_cost": q["true_cost"], "true_cost_pct": q["true_cost_pct"],
                        "speed": p.speed, "eta": _iso(self.settle_delay(p.key, now))})
        out.sort(key=lambda o: (o["send_amount"], -o["receive_amount"]))
        for i, o in enumerate(out):
            o["cheapest"] = i == 0
            o["extra_vs_cheapest"] = round(o["send_amount"] - out[0]["send_amount"], 2)
        return out

    def pick(self, a: "PendingAction", provider_key: str = "") -> Dict[str, Any]:
        """The chosen option (the cheapest when none is named). Raises PolicyError for a service this route
        doesn't offer."""
        from .policy import PolicyError

        opts = self.options(a.params)
        if not provider_key:
            return opts[0]
        choice = next((o for o in opts if o["provider_key"] == provider_key), None)
        if not choice:
            raise PolicyError("That transfer service can't send this request. Choose one of: "
                              + ", ".join(o["provider_key"] for o in opts) + ".")
        return choice

    # ------------------------------------------------------------ approve
    def initiate(self, policy: "PolicyEngine", a: "PendingAction", choice: Dict[str, Any], sponsor_id: str
                 ) -> "PendingAction":
        """Called by PolicyEngine.sponsor_decide under its lock, after the sponsor, KYC, PIN and freeze checks."""
        from .compliance import Compliance
        from .policy import _hash_params

        if _hash_params(a.params) != a.params_hash:
            return self._fail(policy, a, "Request details changed after it was sent.", "params hash mismatch")
        src = self.source(a.owner)
        if not src:
            return self._fail(policy, a, "The sponsor has no MYR account to send from.", "no source account")
        now = self.clock()
        quote = {k: choice[k] for k in ("provider_key", "provider", "send_amount", "send_currency", "fee",
                                        "fee_currency", "rate", "mid_rate", "spread_pct", "receive_amount",
                                        "receive_currency", "true_cost", "true_cost_pct", "speed")}
        quote["quoted_at"] = round(now, 3)
        # Lock the quote: it becomes part of the parameters the hash covers.
        a.params = {**a.params, "quote": quote, "from_sponsor_account": f"{src['label']} {mask(src['number'])}"}
        a.params_hash = _hash_params(a.params)
        rm = a.remittance = {**(a.remittance or {}), "status": "initiated", "reference": "RM-" + a.id[4:].upper(),
                             "timeline": {"initiated": round(now, 3)}}
        self.audit.record("remittance_initiated", sponsor_id, action_id=a.id, provider=quote["provider_key"],
                          send=quote["send_amount"], receive=quote["receive_amount"],
                          currency=quote["receive_currency"], rate=quote["rate"], fee=quote["fee"],
                          params_hash=a.params_hash)
        comp = policy.compliance.assess(policy, "topup", a.owner, a.params, exclude_id=a.id)
        a.compliance = Compliance.public(comp)
        policy.compliance.record(a, comp, stage="remittance")
        rm["timeline"]["compliance_checked"] = round(self.clock(), 3)
        rm["compliance_outcome"] = comp["outcome"]
        if comp["blocked"]:
            a.status, rm["status"] = "blocked", "blocked"
            a.result = {"error": comp["block_reason"]}
            self.audit.record("remittance_blocked", "system", action_id=a.id, reason=comp["block_reason"])
            policy._save(a)
            return a
        policy._save(a, executing=True)   # write-ahead: a restart now resumes from the ledger (recover())
        try:
            self.bank.post_once("rmd_" + a.id, src["id"], -to_minor(quote["send_amount"]), "remittance",
                                f"Remittance to {(self.bank.user(a.owner) or {}).get('name', a.owner)}",
                                f"{rm['reference']} via {quote['provider']}")
        except BankError as e:
            return self._fail(policy, a, str(e), str(e))
        t = self.clock()
        rm["timeline"]["in_transit"] = round(t, 3)
        rm["settle_after"] = round(self.settle_delay(quote["provider_key"], t), 3)
        rm["status"] = "in_transit"
        a.status = "in_transit"
        a.result = {"sent": quote["send_amount"], "sent_currency": "MYR", "receive": quote["receive_amount"],
                    "currency": quote["receive_currency"], "eta": _iso(rm["settle_after"])}
        self.audit.record("remittance_in_transit", "system", action_id=a.id, eta=_iso(rm["settle_after"]))
        policy._save(a)
        return self.tick(policy, a)

    # ------------------------------------------------------------ settle
    def tick(self, policy: "PolicyEngine", a: "PendingAction") -> "PendingAction":
        """Credits an in-transit remittance once it is due. Safe to call on every read."""
        with policy._lock:
            if a.kind != "topup" or a.status != "in_transit":
                return a
            rm = a.remittance or {}
            if self.clock() < float(rm.get("settle_after") or 0):
                return a
            return self._settle(policy, a)

    def _settle(self, policy: "PolicyEngine", a: "PendingAction") -> "PendingAction":
        from .policy import _hash_params

        rm, q = a.remittance, a.params.get("quote") or {}
        src = self.source(a.owner)
        if _hash_params(a.params) != a.params_hash or not q:
            # Something edited the locked request after approval: credit nothing, send the money back.
            return self._return(policy, a, src, "Remittance details changed after approval; nothing was credited "
                                "and the money went back to the sponsor.")
        dst = self.bank.account(a.params.get("to_account_id", ""))
        if not dst or dst["owner"] != a.owner or dst["currency"] != q["receive_currency"]:
            return self._return(policy, a, src, "The receiving account is not available; the money went back to "
                                "the sponsor.")
        policy._save(a, executing=True)
        repeat = False
        try:
            self.bank.post_once("rmc_" + a.id, dst["id"], to_minor(q["receive_amount"]), "allowance",
                                "Sponsor top-up", f"{a.params.get('reason', '')[:60]} · {rm['reference']} via "
                                f"{q['provider']}")
        except BankError as e:
            if not self.bank.has_transaction("rmc_" + a.id):
                return self._return(policy, a, src, f"Could not credit: {e}")
            repeat = True   # already credited (a second settle): mark it done without paying again
        if repeat:
            a.status, rm["status"] = "executed", "credited"
            self.audit.record("remittance_settle_repeated", "system", action_id=a.id)
            policy._save(a)
            return a
        now = self.clock()
        rm["timeline"]["credited"] = round(now, 3)
        rm["status"] = "credited"
        a.status = "executed"
        a.result = {"credited": q["receive_amount"], "currency": q["receive_currency"], "account": dst["label"],
                    "provider": q["provider"], "sent": q["send_amount"], "sent_currency": "MYR"}
        self.audit.record("remittance_credited", "system", action_id=a.id, amount=q["receive_amount"],
                          currency=q["receive_currency"], account=dst["id"])
        self.audit.record("action_executed", "system", action_id=a.id, kind=a.kind, result=a.result)
        policy._save(a)
        return a

    def _return(self, policy: "PolicyEngine", a: "PendingAction", src: Optional[Dict[str, Any]], why: str
                ) -> "PendingAction":
        q = a.params.get("quote") or {}
        if src and self.bank.has_transaction("rmd_" + a.id) and not self.bank.has_transaction("rmr_" + a.id):
            sent = -next(r["amount"] for r in self.bank.db.execute(
                "SELECT amount FROM transactions WHERE id=?", ("rmd_" + a.id,)))
            self.bank.post_once("rmr_" + a.id, src["id"], sent, "remittance", "Remittance returned",
                                (a.remittance or {}).get("reference", ""))
        a.remittance["status"] = "returned"
        a.status = "failed"
        a.result = {"error": why}
        self.audit.record("remittance_failed", "system", action_id=a.id, error=why, returned=q.get("send_amount"))
        self.audit.record("action_failed", "system", action_id=a.id, error=why)
        policy._save(a)
        return a

    def _fail(self, policy: "PolicyEngine", a: "PendingAction", why: str, log: str) -> "PendingAction":
        a.status = "failed"
        a.result = {"error": why}
        if a.remittance:
            a.remittance["status"] = "failed"
        self.audit.record("action_failed", "system", action_id=a.id, error=log)
        policy._save(a)
        return a

    def recover(self, a: "PendingAction") -> bool:
        """After a restart, an action saved as 'executing' mid-remittance resumes from what the ledger shows.
        Returns True when it was a remittance (so the caller doesn't mark it failed)."""
        rm = a.remittance or {}
        if a.kind != "topup" or not rm.get("timeline"):
            return False
        if self.bank.has_transaction("rmc_" + a.id):
            a.status, rm["status"] = "executed", "credited"
            rm["timeline"].setdefault("credited", rm.get("settle_after"))
        elif self.bank.has_transaction("rmd_" + a.id):
            a.status, rm["status"] = "in_transit", "in_transit"
            if "settle_after" not in rm:
                t = self.clock()
                rm["timeline"].setdefault("in_transit", t)
                rm["settle_after"] = self.settle_delay((a.params.get("quote") or {}).get("provider_key", ""), t)
        else:
            return False
        return True

    # ------------------------------------------------------------ views
    def view(self, a: "PendingAction") -> Dict[str, Any]:
        """Where one money request stands, for the student's tool and the model. No sponsor balance."""
        rm, q, p = a.remittance or {}, a.params.get("quote") or {}, a.params
        stage = {"awaiting_sponsor": "awaiting_sponsor", "in_transit": "in_transit", "executed": "credited"}.get(
            a.status, rm.get("status") if rm.get("status") == "returned" else a.status)
        tl = rm.get("timeline") or {}
        now = self.clock()
        settle = rm.get("settle_after")
        return {
            "action_id": a.id, "summary": a.summary, "stage": stage,
            "requested": {"amount": p["amount"], "currency": p["currency"], "reason": p.get("reason", "")},
            "to_account": p.get("to_account", ""), "reference": rm.get("reference"),
            "provider": q.get("provider"), "speed": q.get("speed"),
            "sent": {"amount": q["send_amount"], "currency": "MYR"} if q else None,
            "fee": q.get("fee"), "rate": q.get("rate"),
            "receive": {"amount": q["receive_amount"], "currency": q["receive_currency"]} if q else None,
            "eta": _iso(settle) if stage == "in_transit" else None,
            "eta_in_seconds": max(0, int(settle - now)) if stage == "in_transit" and settle else None,
            "credited_at": _iso(tl.get("credited")),
            "credited_seconds_ago": int(now - tl["credited"]) if tl.get("credited") else None,
            "sponsor_note": a.sponsor_note,
            "timeline": [{"step": s, "done": s in tl, "at": _iso(tl.get(s))} for s in STEPS],
            "compliance": (a.compliance or {}).get("outcome"),
            "error": (a.result or {}).get("error") if a.status in ("failed", "blocked") else None,
        }
