"""Policy engine: the only path by which money moves.

Design rules (quoted in the security self-assessment):
1. The language model can only *draft* actions. Drafting never moves money.
2. Every draft gets a tier (T2 or T3), a risk score with reasons, and a
   single-use confirmation token bound to a hash of its exact parameters.
3. The token is returned to the app over the API, never to the model. Text in
   the chat cannot confirm anything.
4. T3 actions additionally need the sponsor, acting through the sponsor
   endpoint with the sponsor's own credentials.
5. Execution re-checks everything (hash, expiry, balance, cooling period).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank, BankError, to_minor
from .config import Limits
from .fx import FxMarket

RISKY_PAYEE_KINDS = {"crypto", "gift_card", "individual", "unknown"}


class PolicyError(Exception):
    """Raised for requests the policy refuses. Message is safe to show the model."""


def _hash_params(params: Dict[str, Any]) -> str:
    raw = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class PendingAction:
    id: str
    kind: str                      # transfer | conversion | add_payee
    owner: str
    session_id: str
    params: Dict[str, Any]
    summary: str
    tier: str
    risk_score: int
    risk_reasons: List[str]
    warnings: List[str]
    needs_sponsor: bool
    params_hash: str
    token_hash: str
    created_at: float
    expires_at: float
    status: str = "awaiting_user"  # awaiting_user|awaiting_sponsor|executed|rejected|cancelled|expired|failed
    user_confirmed: bool = False
    sponsor_decision: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    provenance: Dict[str, str] = field(default_factory=dict)
    _token: Optional[str] = None   # plaintext, handed to the app once, never to the model

    def for_model(self) -> Dict[str, Any]:
        """What the language model is allowed to see."""
        return {
            "action_id": self.id,
            "kind": self.kind,
            "summary": self.summary,
            "tier": self.tier,
            "status": self.status,
            "needs_sponsor_approval": self.needs_sponsor,
            "risk_score": self.risk_score,
            "warnings": self.warnings,
            "next_step": {
                "awaiting_user": "The user must review and tap Confirm in the app. You cannot confirm it.",
                "awaiting_sponsor": "Waiting for the sponsor to approve in their own app.",
            }.get(self.status, ""),
        }

    def for_app(self, include_token: bool = False) -> Dict[str, Any]:
        d = self.for_model()
        d.update({
            "params": self.params,
            "risk_reasons": self.risk_reasons,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "user_confirmed": self.user_confirmed,
            "sponsor_decision": self.sponsor_decision,
            "result": self.result,
            "provenance": self.provenance,
        })
        if include_token and self._token and self.status == "awaiting_user":
            d["confirm_token"] = self._token
        return d


class PolicyEngine:
    def __init__(self, bank: Bank, fx: FxMarket, audit: AuditLog, limits: Limits) -> None:
        self.bank, self.fx, self.audit, self.limits = bank, fx, audit, limits
        self.actions: Dict[str, PendingAction] = {}
        self._drafts: Dict[str, List[float]] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------ helpers
    def cad(self, amount: float, currency: str) -> float:
        return amount * self.fx.mid(currency, "CAD")

    def _rate_limit(self, session_id: str) -> None:
        now = time.time()
        recent = [t for t in self._drafts.get(session_id, []) if now - t < 3600]
        if len(recent) >= self.limits.drafts_per_hour:
            raise PolicyError("Too many payment drafts in the last hour. Please wait before trying again.")
        recent.append(now)
        self._drafts[session_id] = recent

    def _daily_outflow_cad(self, owner: str) -> float:
        since = (datetime.now() - timedelta(hours=24)).isoformat(timespec="seconds")
        spent = sum(self.cad(m / 100, c) for c, m in self.bank.outflow_since(owner, since).items())
        # Include drafts already confirmed or waiting, so splitting a payment cannot dodge the limit.
        for a in self.actions.values():
            if (a.owner == owner and a.kind == "transfer" and a.tier == "T2"
                    and a.status in ("awaiting_user", "awaiting_sponsor")):
                spent += self.cad(a.params["amount"], a.params["currency"])
        return spent

    def _new(self, kind: str, owner: str, session_id: str, params: Dict[str, Any], summary: str,
             reasons_t3: List[str], risk: int, risk_reasons: List[str], warnings: List[str],
             provenance: Dict[str, str]) -> PendingAction:
        token = secrets.token_urlsafe(24)
        needs_sponsor = bool(reasons_t3) or risk >= self.limits.sponsor_risk_threshold
        if risk >= self.limits.sponsor_risk_threshold and not reasons_t3:
            risk_reasons.append("Risk score above sponsor threshold")
        now = time.time()
        action = PendingAction(
            id="act_" + uuid.uuid4().hex[:10], kind=kind, owner=owner, session_id=session_id,
            params=params, summary=summary, tier="T3" if needs_sponsor else "T2",
            risk_score=min(risk, 100), risk_reasons=reasons_t3 + risk_reasons, warnings=warnings,
            needs_sponsor=needs_sponsor, params_hash=_hash_params(params), token_hash=_hash_token(token),
            created_at=now, expires_at=now + self.limits.pending_ttl_seconds, provenance=provenance,
            _token=token,
        )
        with self._lock:
            self.actions[action.id] = action
        self.audit.record("action_drafted", owner, action_id=action.id, kind=kind, params=params,
                          tier=action.tier, risk=action.risk_score, reasons=action.risk_reasons,
                          provenance=provenance)
        return action

    # ------------------------------------------------------------- drafts
    def draft_transfer(
        self, owner: str, session_id: str, payee_id: str, amount: float, memo: str = "",
        from_account_id: str = "", guard_flags: Optional[List[str]] = None,
        provenance: Optional[Dict[str, str]] = None,
    ) -> PendingAction:
        provenance = provenance or {}
        if not isinstance(amount, (int, float)) or amount <= 0 or amount != amount:
            raise PolicyError("Amount must be a positive number.")
        if round(amount, 2) != amount:
            amount = round(amount, 2)
        payee = self.bank.payee(payee_id)
        if not payee or payee["owner"] != owner:
            raise PolicyError("Unknown payee. Use list_payees to see saved payees, or add_payee to request a new one.")
        if payee["status"] == "pending_approval":
            raise PolicyError("This payee is still waiting for sponsor approval.")
        if payee["status"] != "active":
            raise PolicyError("This payee is not active.")
        if payee["usable_from"] and payee["usable_from"] > time.time():
            wait = int(payee["usable_from"] - time.time())
            raise PolicyError(f"This payee is in its safety cooling period for another {wait} seconds.")
        currency = payee["currency"]

        if from_account_id:
            acc = self.bank.account(from_account_id)
            if not acc or acc["owner"] != owner:
                raise PolicyError("Unknown source account.")
        else:
            prefer = "Tuition" if payee["kind"] == "tuition" else "Everyday"
            acc = self.bank.find_account(owner, currency, prefer)
            if not acc:
                raise PolicyError(f"No {currency} account to pay from. Convert money into {currency} first.")
        if acc["currency"] != currency:
            raise PolicyError(f"{acc['label']} holds {acc['currency']} but this payee is paid in {currency}.")

        self._rate_limit(session_id)
        amount_cad = self.cad(amount, currency)
        t3: List[str] = []
        reasons: List[str] = []
        warnings: List[str] = []
        risk = 0

        if amount_cad > self.limits.single_cad:
            t3.append(f"Amount above the single-payment limit of CAD {self.limits.single_cad:,.0f}")
        daily = self._daily_outflow_cad(owner)
        if daily + amount_cad > self.limits.daily_cad:
            t3.append(f"Would exceed the 24h limit of CAD {self.limits.daily_cad:,.0f} "
                      f"(already CAD {daily:,.2f} sent or pending)")
        if acc["sponsor_funded"]:
            t3.append(f"Paid from a sponsor-funded account ({acc['label']})")
        if acc["balance"] < to_minor(amount):
            warnings.append(f"Balance in {acc['label']} is lower than this amount; it will fail unless topped up.")

        age_days = (time.time() - (payee["created_at"] or 0)) / 86400
        if age_days < 30:
            risk += 35
            reasons.append("Payee was added less than 30 days ago")
        if payee["kind"] in RISKY_PAYEE_KINDS:
            risk += 25
            reasons.append(f"Payee type '{payee['kind']}' is commonly used in scams")
        if amount >= 1000 and float(amount).is_integer() and amount % 500 == 0:
            risk += 10
            reasons.append("Large round amount")
        history = [abs(t["amount"]) for t in self.bank.transactions(owner, days=120) if t["counterparty"] == payee["name"]]
        if history and amount > 3 * max(history):
            risk += 25
            reasons.append("Much larger than past payments to this payee")
        if any(v == "untrusted" for v in provenance.values()):
            risk += 30
            reasons.append("Payment details came from content the user did not type (e.g. a pasted message)")
            warnings.append("Check the payee and amount against an official source before confirming.")
        for flag in guard_flags or []:
            risk += 40 if flag in ("scam", "injection") else 10
            reasons.append(f"Conversation was flagged by the safety check: {flag}")
        if set(guard_flags or []) & {"scam", "injection", "escalation"}:
            t3.append("Requested in a conversation the safety check flagged")
        if guard_flags and "scam" in guard_flags:
            warnings.append("This request matches a known scam pattern. Legitimate agencies never demand urgent payment by chat.")

        params = {"payee_id": payee_id, "payee_name": payee["name"], "amount": float(amount),
                  "currency": currency, "from_account_id": acc["id"], "from_account": acc["label"],
                  "memo": memo[:120]}
        summary = f"Pay {currency} {amount:,.2f} to {payee['name']} from {acc['label']}"
        return self._new("transfer", owner, session_id, params, summary, t3, risk, reasons, warnings, provenance)

    def draft_conversion(
        self, owner: str, session_id: str, from_currency: str, to_currency: str, amount: float,
        guard_flags: Optional[List[str]] = None,
    ) -> PendingAction:
        if not isinstance(amount, (int, float)) or amount <= 0 or amount != amount:
            raise PolicyError("Amount must be a positive number.")
        src = self.bank.find_account(owner, from_currency, "Wallet" if from_currency.upper() == "MYR" else "Everyday")
        dst = self.bank.find_account(owner, to_currency, "Everyday")
        if not src or not dst:
            raise PolicyError("You need an account in both currencies to convert.")
        if src["id"] == dst["id"]:
            raise PolicyError("Source and destination are the same account.")
        self._rate_limit(session_id)
        prov = self.fx.provider("inapp")
        q = self.fx.quote(src["currency"], dst["currency"], amount, prov)
        amount_cad = self.cad(amount, src["currency"])
        t3: List[str] = []
        reasons: List[str] = []
        warnings = [f"Rate {q['rate']} includes a {prov.spread_pct}% margin over mid-market ({q['mid_rate']})."]
        risk = 0
        if src["sponsor_funded"] and amount_cad > self.limits.single_cad:
            t3.append(f"Moves more than CAD {self.limits.single_cad:,.0f} of sponsor money into spending")
        if src["balance"] < to_minor(amount):
            warnings.append(f"Balance in {src['label']} is lower than this amount; it will fail.")
        for flag in guard_flags or []:
            risk += 40 if flag in ("scam", "injection") else 10
            reasons.append(f"Conversation was flagged by the safety check: {flag}")
        if set(guard_flags or []) & {"scam", "injection", "escalation"}:
            t3.append("Requested in a conversation the safety check flagged")
        params = {"from_account_id": src["id"], "to_account_id": dst["id"], "amount": float(amount),
                  "from_currency": src["currency"], "to_currency": dst["currency"],
                  "rate": q["rate"], "expected_receive": q["you_receive"]}
        summary = (f"Convert {src['currency']} {amount:,.2f} to about {dst['currency']} "
                   f"{q['you_receive']:,.2f} ({src['label']} to {dst['label']})")
        return self._new("conversion", owner, session_id, params, summary, t3, risk, reasons, warnings, {})

    def draft_add_payee(
        self, owner: str, session_id: str, name: str, kind: str, currency: str, number: str,
        provenance: Optional[Dict[str, str]] = None,
    ) -> PendingAction:
        provenance = provenance or {}
        name = (name or "").strip()[:60]
        if not name or not number:
            raise PolicyError("A payee needs a name and an account number.")
        if currency.upper() not in ("CAD", "MYR", "USD"):
            raise PolicyError("Payee currency must be CAD, MYR or USD.")
        self._rate_limit(session_id)
        kind = (kind or "unknown").lower()
        risk = 20
        reasons = ["New payees always need sponsor approval and a cooling period"]
        if kind in RISKY_PAYEE_KINDS:
            risk += 25
            reasons.append(f"Payee type '{kind}' is commonly used in scams")
        if any(v == "untrusted" for v in provenance.values()):
            risk += 30
            reasons.append("Payee details came from content the user did not type")
        existing = [p for p in self.bank.payees(owner) if p["name"].lower() == name.lower()]
        warnings = []
        if existing:
            risk += 30
            warnings.append(f"A payee called '{name}' already exists with a different account. "
                            "Changed bank details are a common fraud tactic.")
        pid = self.bank.create_payee(owner, name, kind, currency, number, provenance.get("number", "user"))
        params = {"payee_id": pid, "name": name, "kind": kind, "currency": currency.upper(),
                  "number_masked": "••••" + "".join(c for c in number if c.isdigit())[-4:]}
        summary = f"Add new payee {name} ({kind}, {currency.upper()}, account {params['number_masked']})"
        return self._new("add_payee", owner, session_id, params, summary,
                         ["New payee"], risk, reasons, warnings, provenance)

    def draft_topup_request(self, owner: str, session_id: str, amount: float, currency: str,
                            reason: str) -> PendingAction:
        """Student asks the sponsor for money. Goes straight to the sponsor; no student token needed."""
        if not isinstance(amount, (int, float)) or amount <= 0 or amount > 100000:
            raise PolicyError("Amount must be a positive number.")
        currency = currency.upper()
        if not self.bank.find_account(owner, currency):
            raise PolicyError(f"No {currency} account to receive money. Use MYR or CAD.")
        self._rate_limit(session_id)
        params = {"amount": float(amount), "currency": currency, "reason": reason[:200]}
        a = self._new("topup", owner, session_id, params, f"Ask sponsor for {currency} {amount:,.2f}: {reason[:80]}",
                      ["Sponsor money"], 0, [], [], {})
        a.user_confirmed = True
        a._token = None
        a.status = "awaiting_sponsor"
        a.tier = "T1"
        a.expires_at = time.time() + 7 * 24 * 3600
        self.audit.record("sponsor_approval_requested", "system", action_id=a.id)
        return a

    # ------------------------------------------------------- confirmations
    def get(self, action_id: str) -> PendingAction:
        a = self.actions.get(action_id)
        if not a:
            raise PolicyError("Unknown action.")
        if a.status in ("awaiting_user", "awaiting_sponsor") and time.time() > a.expires_at:
            a.status = "expired"
            self.audit.record("action_expired", "system", action_id=a.id)
        return a

    def confirm(self, action_id: str, user_id: str, token: str) -> PendingAction:
        """Called only by the app's confirm endpoint with the student's credentials."""
        with self._lock:
            a = self.get(action_id)
            if a.owner != user_id:
                self.audit.record("confirm_denied", user_id, action_id=action_id, reason="not owner")
                raise PolicyError("Only the account owner can confirm this action.")
            if a.status != "awaiting_user":
                raise PolicyError(f"Action is {a.status}, not awaiting confirmation.")
            if not token or not hmac.compare_digest(_hash_token(token), a.token_hash):
                self.audit.record("confirm_denied", user_id, action_id=action_id, reason="bad token")
                raise PolicyError("Invalid confirmation token.")
            if _hash_params(a.params) != a.params_hash:
                a.status = "failed"
                raise PolicyError("Action parameters changed after drafting.")
            a.user_confirmed = True
            a._token = None
            self.audit.record("action_confirmed", user_id, action_id=a.id)
            if a.needs_sponsor:
                a.status = "awaiting_sponsor"
                a.expires_at = time.time() + 24 * 3600
                self.audit.record("sponsor_approval_requested", "system", action_id=a.id)
                return a
            return self._execute(a)

    def sponsor_decide(self, action_id: str, sponsor_id: str, approve: bool, note: str = "") -> PendingAction:
        with self._lock:
            a = self.get(action_id)
            owner = self.bank.user(a.owner)
            if not owner or owner.get("sponsor_id") != sponsor_id:
                self.audit.record("sponsor_denied", sponsor_id, action_id=action_id, reason="not sponsor")
                raise PolicyError("You are not the sponsor for this account.")
            if a.status != "awaiting_sponsor":
                raise PolicyError(f"Action is {a.status}, not awaiting sponsor approval.")
            a.sponsor_decision = "approved" if approve else "rejected"
            self.audit.record("sponsor_" + a.sponsor_decision, sponsor_id, action_id=a.id, note=note[:200])
            if not approve:
                a.status = "rejected"
                if a.kind == "add_payee":
                    self.bank.reject_payee(a.params["payee_id"])
                return a
            return self._execute(a)

    def cancel(self, action_id: str, user_id: str) -> PendingAction:
        with self._lock:
            a = self.get(action_id)
            if a.owner != user_id:
                raise PolicyError("Only the account owner can cancel this action.")
            if a.status not in ("awaiting_user", "awaiting_sponsor"):
                raise PolicyError(f"Action is already {a.status}.")
            a.status = "cancelled"
            a._token = None
            if a.kind == "add_payee":
                self.bank.reject_payee(a.params["payee_id"])
            self.audit.record("action_cancelled", user_id, action_id=a.id)
            return a

    def _execute(self, a: PendingAction) -> PendingAction:
        try:
            if a.kind == "transfer":
                cat = (self.bank.payee(a.params["payee_id"]) or {}).get("kind", "transfer")
                a.result = self.bank.transfer_out(a.params["from_account_id"], a.params["payee_id"],
                                                  to_minor(a.params["amount"]), a.params["memo"], cat)
            elif a.kind == "conversion":
                fee = 0
                a.result = self.bank.convert(a.params["from_account_id"], a.params["to_account_id"],
                                             to_minor(a.params["amount"]), a.params["rate"], fee)
            elif a.kind == "topup":
                self.bank.credit_sponsor_topup(a.owner, to_minor(a.params["amount"]), a.params["currency"],
                                               a.params["reason"])
                a.result = {"credited": a.params["amount"], "currency": a.params["currency"]}
            elif a.kind == "add_payee":
                self.bank.activate_payee(a.params["payee_id"], self.limits.payee_cooling_seconds)
                a.result = {"payee_id": a.params["payee_id"],
                            "usable_after_seconds": self.limits.payee_cooling_seconds}
            a.status = "executed"
            self.audit.record("action_executed", "system", action_id=a.id, kind=a.kind, result=a.result)
        except BankError as e:
            a.status = "failed"
            a.result = {"error": str(e)}
            self.audit.record("action_failed", "system", action_id=a.id, error=str(e))
        return a

    # ------------------------------------------------------------ queries
    def list_for(self, owner: str, statuses: Optional[List[str]] = None) -> List[PendingAction]:
        out = []
        for a in list(self.actions.values()):
            if a.owner != owner:
                continue
            self.get(a.id)
            if statuses is None or a.status in statuses:
                out.append(a)
        return sorted(out, key=lambda x: x.created_at)

    def sponsor_queue(self, sponsor_id: str) -> List[PendingAction]:
        out = []
        for a in list(self.actions.values()):
            owner = self.bank.user(a.owner)
            if owner and owner.get("sponsor_id") == sponsor_id and self.get(a.id).status == "awaiting_sponsor":
                out.append(a)
        return out

    def reset(self) -> None:
        with self._lock:
            self.actions.clear()
            self._drafts.clear()
