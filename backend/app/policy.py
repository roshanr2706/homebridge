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
6. While the sponsor or the student has frozen payments (safety.py), drafts are still
   allowed, but Confirm, Approve and execution are refused.
7. Every draft is screened by the compliance layer (compliance.py) before its tier is set: a sanctions
   hit blocks it outright, and nobody whose identity is unverified can confirm or approve money movement.
"""
from __future__ import annotations

import difflib
import functools
import hashlib
import hmac
import json
import math
import re
import secrets
import threading
import time
import unicodedata
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank, BankError, to_minor
from .compliance import Compliance
from .config import Limits
from .fx import FxMarket
from .guard import normalize
from .safety import FROZEN_PREFIX, SafetyMonitor

RISKY_PAYEE_KINDS = {"crypto", "gift_card", "individual", "unknown"}
# The kind becomes the transaction category, and the 24h limit skips 'conversion' rows, so it is an allow-list.
PAYEE_KINDS = {"rent", "tuition", "utilities", "phone", "business"} | RISKY_PAYEE_KINDS


class PolicyError(Exception):
    """Raised for requests the policy refuses. Message is safe to show the model."""


def _amount(amount: Any) -> float:
    """A finite amount that is still positive after rounding to cents."""
    if (isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount)
            or round(amount, 2) <= 0):
        raise PolicyError("Amount must be a positive number.")
    return round(float(amount), 2)


def _fold_name(name: str) -> str:
    return re.sub(r"[\W_]+", "", normalize(name).casefold())


def _lookalike(a: str, b: str) -> bool:
    """Same payee name once case, spacing, punctuation, invisible and lookalike characters are ignored, or one
    or two letters off."""
    a, b = _fold_name(a), _fold_name(b)
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def _locked(fn):
    """Drafts check limits and then record themselves; doing both under the lock stops parallel requests
    from each passing the same check."""
    @functools.wraps(fn)
    def wrapper(self: "PolicyEngine", *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            return fn(self, *args, **kwargs)
    return wrapper


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
    sponsor_reasons: List[str]
    needs_sponsor: bool
    params_hash: str
    token_hash: str
    created_at: float
    expires_at: float
    status: str = "awaiting_user"  # awaiting_user|awaiting_sponsor|executed|rejected|cancelled|expired|failed
    user_confirmed: bool = False
    sponsor_decision: Optional[str] = None
    sponsor_note: str = ""
    result: Optional[Dict[str, Any]] = None
    provenance: Dict[str, str] = field(default_factory=dict)
    compliance: Dict[str, Any] = field(default_factory=dict)  # compliance.py result, shown on the card
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
                "blocked": "Blocked by compliance screening. It cannot be confirmed or approved.",
            }.get(self.status, ""),
            "compliance": {"outcome": self.compliance.get("outcome", "clear"),
                           "notes": [c["detail"] for c in self.compliance.get("checks", [])
                                     if c["status"] in ("flag", "block", "report")]},
        }

    def for_app(self, include_token: bool = False) -> Dict[str, Any]:
        d = self.for_model()
        d.update({
            "params": self.params,
            "risk_reasons": self.risk_reasons,
            "sponsor_reasons": self.sponsor_reasons,
            "risk_signals": [r for r in self.risk_reasons if r not in self.sponsor_reasons],
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "user_confirmed": self.user_confirmed,
            "sponsor_decision": self.sponsor_decision,
            "sponsor_note": self.sponsor_note,
            "result": self.result,
            "provenance": self.provenance,
            "compliance": self.compliance,
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
        self.limits_changed_at = 0.0
        self.bank.ensure_policy_tables()
        self.safety = SafetyMonitor(bank, fx, audit)
        self.compliance = Compliance(bank, fx, audit)
        self._load()

    @property
    def audit(self) -> AuditLog:
        return self._audit

    @audit.setter
    def audit(self, log: AuditLog) -> None:
        # The evidence runner swaps in a shared log; the safety monitor must write to the same one.
        self._audit = log
        if hasattr(self, "safety"):
            self.safety.audit = log
        if hasattr(self, "compliance"):
            self.compliance.audit = log

    def limits_changed(self) -> None:
        """Called after the sponsor edits the limits. Student-only drafts made earlier then go to the sponsor."""
        with self._lock:
            self.limits_changed_at = time.time()

    # ------------------------------------------------------------ storage
    # `actions` and `_drafts` are the working copy; every change is written through to the bank's
    # SQLite database (pending_actions, draft_log), and _load() rebuilds them after a restart.
    # The plaintext token is never written, so a reloaded draft has _token=None: only an app that
    # still holds the token it was given can confirm it.
    def _save(self, a: PendingAction, executing: bool = False) -> None:
        data = asdict(a)
        data.pop("_token", None)
        # Write-ahead marker: if the process dies while the bank call runs, the reloaded action
        # becomes "failed" instead of being executable a second time.
        status = "executing" if executing else a.status
        data["status"] = status
        self.bank.save_action(a.id, a.owner, status, a.created_at, json.dumps(data, sort_keys=True))

    def _load(self) -> None:
        known = {f.name for f in fields(PendingAction)} - {"_token"}
        with self._lock:
            self.actions.clear()
            self._drafts.clear()
            for row in self.bank.load_actions():
                data = json.loads(row["data"])
                a = PendingAction(**{k: v for k, v in data.items() if k in known})
                self.actions[a.id] = a
                if a.status == "executing":
                    a.status = "failed"
                    a.result = {"error": "Interrupted by a server restart during execution; check the ledger."}
                    self.audit.record("action_failed", "system", action_id=a.id, error="interrupted by restart")
                    self._save(a)
            for row in self.bank.load_drafts(time.time() - 3600):
                self._drafts.setdefault(row["owner"], []).append(row["ts"])

    # ------------------------------------------------------------ helpers
    def cad(self, amount: float, currency: str) -> float:
        return amount * self.fx.mid(currency, "CAD")

    def _rate_limit(self, owner: str) -> None:
        # Keyed by the account owner, not the chat session, which the client chooses.
        with self._lock:
            now = time.time()
            recent = [t for t in self._drafts.get(owner, []) if now - t < 3600]
            if len(recent) >= self.limits.drafts_per_hour:
                raise PolicyError("Too many payment drafts in the last hour. Please wait before trying again.")
            recent.append(now)
            self._drafts[owner] = recent
            self.bank.log_draft(owner, now, now - 3600)

    def _daily_outflow_cad(self, owner: str) -> float:
        since = (datetime.now() - timedelta(hours=24)).isoformat(timespec="seconds")
        spent = sum(self.cad(m / 100, c) for c, m in self.bank.outflow_since(owner, since).items())
        # Include drafts already confirmed or waiting, so splitting a payment cannot dodge the limit.
        for a in self.actions.values():
            if (a.owner == owner and a.kind == "transfer" and a.tier == "T2"
                    and a.status in ("awaiting_user", "awaiting_sponsor")):
                spent += self.cad(a.params["amount"], a.params["currency"])
        return spent

    def _sponsor_released_cad(self, owner: str) -> float:
        """CAD value of conversions out of sponsor-funded accounts in the last 24h, including pending drafts."""
        since = time.time() - 24 * 3600
        total = 0.0
        for a in self.actions.values():
            if (a.owner == owner and a.kind == "conversion" and a.created_at >= since
                    and a.status in ("awaiting_user", "awaiting_sponsor", "executed") and a.tier == "T2"
                    and a.params.get("uses_sponsor_money")):
                total += self.cad(a.params["amount"], a.params["from_currency"])
        return total

    def _alert_risk(self, owner: str, reasons: List[str]) -> int:
        """Risk added by an unusual-activity alert from the last 24 hours (safety.py)."""
        alert = self.safety.risk_bump(owner)
        if not alert:
            return 0
        reasons.append(f"Unusual activity on this account in the last 24h: {alert['message']}")
        return int(alert["weight"])

    def _frozen_check(self, a: PendingAction) -> Optional[str]:
        return self.safety.frozen_reason(a.owner, a.kind, a.params)

    def _new(self, kind: str, owner: str, session_id: str, params: Dict[str, Any], summary: str,
             reasons_t3: List[str], risk: int, risk_reasons: List[str], warnings: List[str],
             provenance: Dict[str, str]) -> PendingAction:
        comp = self.compliance.assess(self, kind, owner, params)
        risk += comp["risk"]
        risk_reasons.extend(comp["risk_reasons"])
        lock = self.safety.frozen_reason(owner, kind, params)
        if lock:  # drafting is still allowed while frozen; confirming is not
            warnings.append(f"{FROZEN_PREFIX} {lock}. It can't be confirmed or approved until they are unlocked.")
        token = secrets.token_urlsafe(24)
        needs_sponsor = bool(reasons_t3) or risk >= self.limits.sponsor_risk_threshold
        if risk >= self.limits.sponsor_risk_threshold and not reasons_t3:
            risk_reasons.append("Risk score above sponsor threshold")
        now = time.time()
        action = PendingAction(
            id="act_" + uuid.uuid4().hex[:10], kind=kind, owner=owner, session_id=session_id,
            params=params, summary=summary, tier="T3" if needs_sponsor else "T2",
            risk_score=min(risk, 100), risk_reasons=reasons_t3 + risk_reasons, warnings=warnings,
            sponsor_reasons=list(reasons_t3) + (["Risk score above sponsor threshold"] if risk >= self.limits.sponsor_risk_threshold and not reasons_t3 else []),
            needs_sponsor=needs_sponsor, params_hash=_hash_params(params), token_hash=_hash_token(token),
            created_at=now, expires_at=now + self.limits.pending_ttl_seconds, provenance=provenance,
            compliance=Compliance.public(comp), _token=token,
        )
        if comp["blocked"]:  # e.g. a sanctions hit: recorded and shown, but it can never be confirmed
            action.status, action._token = "blocked", None
            action.result = {"error": comp["block_reason"]}
            action.risk_reasons.insert(0, comp["block_reason"])
            if kind in ("add_payee", "transfer"):  # a listed payee can't be used again
                self.bank.block_payee(params["payee_id"])
        with self._lock:
            self.actions[action.id] = action
            self._save(action)
        self.audit.record("action_drafted", owner, action_id=action.id, kind=kind, params=params,
                          tier=action.tier, risk=action.risk_score, reasons=action.risk_reasons,
                          provenance=provenance)
        self.compliance.record(action, comp)
        if not comp["blocked"]:
            self.safety.note_draft(owner, kind, params, action.id)
        return action

    # ------------------------------------------------------------- drafts
    @_locked
    def draft_transfer(
        self, owner: str, session_id: str, payee_id: str, amount: float, memo: str = "",
        from_account_id: str = "", guard_flags: Optional[List[str]] = None,
        provenance: Optional[Dict[str, str]] = None,
    ) -> PendingAction:
        provenance = provenance or {}
        amount = _amount(amount)
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
        if payee["kind"] == "credit_card":  # Credit Builder: never pay a card above what is owed
            card = self.bank.card_for_payee(payee_id)
            owed = card["balance"] if card else 0
            if to_minor(amount) > owed:
                raise PolicyError(f"That is more than the card balance ({currency} {owed / 100:,.2f}). "
                                  "Card payments can't go above what you owe.")

        self._rate_limit(owner)
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
        elif history:
            # A smaller jump still matters when the new amount came from a message ("rent is now 1,480").
            usual = sorted(history)[len(history) // 2]
            if amount > 1.2 * usual and amount - usual >= 20:
                risk += 20
                reasons.append(f"Usually {currency} {usual:,.2f} to this payee; this is "
                               f"{round(100 * (amount - usual) / usual)}% more")
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
        risk += self._alert_risk(owner, reasons)

        params = {"payee_id": payee_id, "payee_name": payee["name"], "amount": float(amount),
                  "currency": currency, "from_account_id": acc["id"], "from_account": acc["label"],
                  "memo": memo[:120]}
        summary = f"Pay {currency} {amount:,.2f} to {payee['name']} from {acc['label']}"
        return self._new("transfer", owner, session_id, params, summary, t3, risk, reasons, warnings, provenance)

    @_locked
    def draft_conversion(
        self, owner: str, session_id: str, from_currency: str, to_currency: str, amount: float,
        guard_flags: Optional[List[str]] = None, destination: str = "everyday", source: str = "",
    ) -> PendingAction:
        """A conversion between the user's own wallets, or (same currency) a move between two own accounts,
        e.g. CAD Everyday to CAD Tuition Fund. Both go through the same tiers, caps and confirmation token."""
        amount = _amount(amount)
        if destination not in ("everyday", "tuition"):
            raise PolicyError("Destination must be 'everyday' or 'tuition'.")
        labels = {"everyday": "Everyday", "tuition": "Tuition", "wallet": "Wallet"}
        if source and source not in labels:
            raise PolicyError("Source must be 'everyday', 'tuition' or 'wallet'.")
        src_label = labels.get(source) or ("Wallet" if from_currency.upper() == "MYR" else "Everyday")
        src = self.bank.find_account(owner, from_currency, src_label)
        dst = self.bank.find_account(owner, to_currency, "Tuition" if destination == "tuition" else "Everyday")
        if source and (not src or src_label not in src["label"]):
            raise PolicyError(f"There is no {from_currency.upper()} {source} account to move money from.")
        if destination == "tuition" and (not dst or "Tuition" not in dst["label"]):
            raise PolicyError(f"There is no {to_currency.upper()} tuition fund to convert into.")
        if not src or not dst:
            raise PolicyError("You need an account in both currencies to convert.")
        if src["id"] == dst["id"]:
            raise PolicyError("Source and destination are the same account.")
        self._rate_limit(owner)
        same = src["currency"] == dst["currency"]
        if same:   # a move between own accounts: no exchange, no margin
            q = {"rate": 1.0, "mid_rate": 1.0, "you_receive": float(amount)}
            warnings: List[str] = []
        else:
            prov = self.fx.provider("inapp")
            q = self.fx.quote(src["currency"], dst["currency"], amount, prov)
            warnings = [f"Rate {q['rate']} includes a {prov.spread_pct}% margin over mid-market ({q['mid_rate']})."]
        amount_cad = self.cad(amount, src["currency"])
        t3: List[str] = []
        reasons: List[str] = []
        risk = 0
        if "Tuition" in src["label"] and src["sponsor_funded"]:
            # The tuition fund is earmarked by the sponsor: taking money out of it is always their call.
            t3.append(f"Moves money out of the sponsor-funded {src['label']}")
        # Converting sponsor money is capped per 24h, counting pending drafts, so it cannot be released in
        # small chunks. The cap also covers conversions into the tuition fund: the money stays earmarked, but
        # the sponsor still decides when large sums are exchanged and pays the spread.
        elif src["sponsor_funded"]:
            released = self._sponsor_released_cad(owner)
            if released + amount_cad > self.limits.single_cad:
                where = "between your sponsor-funded accounts" if dst["sponsor_funded"] else "into spending"
                t3.append(f"Converts more than CAD {self.limits.single_cad:,.0f} of sponsor money {where} in 24h "
                          f"(already CAD {released:,.2f} converted or pending)")
        if src["balance"] < to_minor(amount):
            warnings.append(f"Balance in {src['label']} is lower than this amount; it will fail.")
        for flag in guard_flags or []:
            risk += 40 if flag in ("scam", "injection") else 10
            reasons.append(f"Conversation was flagged by the safety check: {flag}")
        if set(guard_flags or []) & {"scam", "injection", "escalation"}:
            t3.append("Requested in a conversation the safety check flagged")
        risk += self._alert_risk(owner, reasons)
        params = {"from_account_id": src["id"], "to_account_id": dst["id"], "amount": float(amount),
                  "from_currency": src["currency"], "to_currency": dst["currency"],
                  "rate": q["rate"], "expected_receive": q["you_receive"],
                  "uses_sponsor_money": bool(src["sponsor_funded"])}
        if same:
            summary = f"Move {src['currency']} {amount:,.2f} from {src['label']} to {dst['label']}"
        else:
            summary = (f"Convert {src['currency']} {amount:,.2f} to about {dst['currency']} "
                       f"{q['you_receive']:,.2f} ({src['label']} to {dst['label']})")
        return self._new("conversion", owner, session_id, params, summary, t3, risk, reasons, warnings, {})

    @_locked
    def draft_add_payee(
        self, owner: str, session_id: str, name: str, kind: str, currency: str, number: str,
        provenance: Optional[Dict[str, str]] = None,
    ) -> PendingAction:
        provenance = provenance or {}
        # Drop invisible and direction-control characters, so the name on the sponsor's card is what is stored.
        name = "".join(c for c in unicodedata.normalize("NFKC", name or "")
                       if unicodedata.category(c)[0] != "C").strip()[:60]
        if not name or not number:
            raise PolicyError("A payee needs a name and an account number.")
        if currency.upper() not in ("CAD", "MYR", "USD"):
            raise PolicyError("Payee currency must be CAD, MYR or USD.")
        self._rate_limit(owner)
        kind = (kind or "unknown").lower()
        if kind not in PAYEE_KINDS:
            kind = "unknown"
        risk = 20
        reasons = ["New payee with no payment history yet"]
        if kind in RISKY_PAYEE_KINDS:
            risk += 25
            reasons.append(f"Payee type '{kind}' is commonly used in scams")
        if any(v == "untrusted" for v in provenance.values()):
            risk += 30
            reasons.append("Payee details came from content the user did not type")
        existing = [p for p in self.bank.payees(owner) if _lookalike(p["name"], name)]
        warnings = []
        if existing:
            risk += 30
            if existing[0]["name"].lower() == name.lower():
                warnings.append(f"A payee called '{name}' already exists with a different account. "
                                "Changed bank details are a common fraud tactic.")
            else:
                warnings.append(f"'{name}' looks almost the same as your saved payee '{existing[0]['name']}'. "
                                "Lookalike names are a common fraud tactic.")
        pid = self.bank.create_payee(owner, name, kind, currency, number, provenance.get("number", "user"))
        params = {"payee_id": pid, "name": name, "kind": kind, "currency": currency.upper(),
                  "number_masked": "••••" + "".join(c for c in number if c.isdigit())[-4:]}
        summary = f"Add new payee {name} ({kind}, {currency.upper()}, account {params['number_masked']})"
        return self._new("add_payee", owner, session_id, params, summary,
                         ["New payee"], risk, reasons, warnings, provenance)

    @_locked
    def draft_topup_request(self, owner: str, session_id: str, amount: float, currency: str,
                            reason: str) -> PendingAction:
        """Student asks the sponsor for money. Goes straight to the sponsor; no student token needed."""
        amount = _amount(amount)
        if amount > 100000:
            raise PolicyError("Amount must be a positive number.")
        currency = currency.upper()
        if not self.bank.find_account(owner, currency):
            raise PolicyError(f"No {currency} account to receive money. Use MYR or CAD.")
        self._rate_limit(owner)
        params = {"amount": float(amount), "currency": currency, "reason": reason[:200]}
        a = self._new("topup", owner, session_id, params, f"Ask sponsor for {currency} {amount:,.2f}: {reason[:80]}",
                      ["A request for money: the sponsor decides whether to send it"], 0, [], [], {})
        a.user_confirmed = True
        a._token = None
        a.status = "awaiting_sponsor"
        a.tier = "T1"
        a.expires_at = time.time() + 7 * 24 * 3600
        self._save(a)
        self.audit.record("sponsor_approval_requested", "system", action_id=a.id)
        return a

    # ------------------------------------------------------- confirmations
    def get(self, action_id: str) -> PendingAction:
        a = self.actions.get(action_id)
        if not a:
            raise PolicyError("Unknown action.")
        if a.status in ("awaiting_user", "awaiting_sponsor") and time.time() > a.expires_at:
            a.status = "expired"
            self._save(a)
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
            kyc = self.compliance.check_kyc_for(user_id, a.owner, a.kind, "student", a.id)
            if kyc:
                raise PolicyError(kyc)
            if not token or not hmac.compare_digest(_hash_token(token), a.token_hash):
                self.audit.record("confirm_denied", user_id, action_id=action_id, reason="bad token")
                self.safety.note_failed_confirm(a.owner, a.id, "wrong confirmation code")
                raise PolicyError("Invalid confirmation token.")
            if _hash_params(a.params) != a.params_hash:
                a.status = "failed"
                self._save(a)
                raise PolicyError("Action parameters changed after drafting.")
            lock = self._frozen_check(a)
            if lock:  # checked before the token is used up, so it can still be confirmed once unlocked
                self.audit.record("confirm_denied", user_id, action_id=action_id, reason="payments frozen")
                self.safety.note_failed_confirm(a.owner, a.id, "payments locked")
                raise PolicyError(f"{FROZEN_PREFIX} {lock}. Nothing was sent.")
            a.user_confirmed = True
            a._token = None
            self.audit.record("action_confirmed", user_id, action_id=a.id)
            if not a.needs_sponsor and a.created_at <= self.limits_changed_at:
                # Its tier was set under limits the sponsor has since changed.
                a.needs_sponsor, a.tier = True, "T3"
                a.sponsor_reasons.append("The sponsor changed the limits after this was drafted")
                a.risk_reasons.insert(0, a.sponsor_reasons[-1])
            self.safety.note_confirm(a.owner, a.kind, a.needs_sponsor, a.id)
            if a.needs_sponsor:
                a.status = "awaiting_sponsor"
                a.expires_at = time.time() + 24 * 3600
                self._save(a)
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
            kyc = self.compliance.check_kyc_for(sponsor_id, a.owner, a.kind, "sponsor", a.id) if approve else None
            if kyc:  # rejecting is always allowed
                raise PolicyError(kyc)
            lock = self._frozen_check(a) if approve else None
            if lock:  # rejecting is always allowed
                self.audit.record("sponsor_denied", sponsor_id, action_id=action_id, reason="payments frozen")
                raise PolicyError(f"{FROZEN_PREFIX} {lock}. Unlock payments in Rules before approving, or reject it.")
            a.sponsor_decision = "approved" if approve else "rejected"
            a.sponsor_note = (note or "")[:200]
            self.audit.record("sponsor_" + a.sponsor_decision, sponsor_id, action_id=a.id, note=note[:200])
            if not approve:
                a.status = "rejected"
                if a.kind == "add_payee":
                    self.bank.reject_payee(a.params["payee_id"])
                self._save(a)
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
            self._save(a)
            self.audit.record("action_cancelled", user_id, action_id=a.id)
            return a

    def _execute(self, a: PendingAction) -> PendingAction:
        # Re-check at execution too: since drafts are reloaded from the database, an edited row must not
        # change what is paid after the student confirmed or the sponsor approved.
        if _hash_params(a.params) != a.params_hash:
            a.status = "failed"
            a.result = {"error": "Action parameters changed after drafting."}
            self.audit.record("action_failed", "system", action_id=a.id, error="params hash mismatch")
            self._save(a)
            return a
        lock = self._frozen_check(a)
        if lock:  # confirm() and sponsor_decide() refuse first; this is the last line of defence
            raise PolicyError(f"{FROZEN_PREFIX} {lock}. Nothing was sent.")
        self._save(a, executing=True)
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
        self._save(a)
        return a

    # ------------------------------------------------------------ queries
    def present(self, a: PendingAction, include_token: bool = False) -> Dict[str, Any]:
        """for_app() with the balance warning recomputed, so a card never shows a stale shortfall."""
        d = a.for_app(include_token)
        if a.kind in ("transfer", "conversion") and a.status in ("awaiting_user", "awaiting_sponsor"):
            acc = self.bank.account(a.params["from_account_id"])
            d["warnings"] = [w for w in a.warnings if "lower than this amount" not in w]
            if acc and acc["balance"] < to_minor(a.params["amount"]):
                d["warnings"].append(f"Balance in {acc['label']} is lower than this amount right now; "
                                     "it will fail unless topped up first.")
        # The lock is shown as it is now, not as it was when the draft was made.
        lock = self._frozen_check(a) if a.status in ("awaiting_user", "awaiting_sponsor") else None
        d["frozen"] = lock
        d["warnings"] = [w for w in d["warnings"] if not w.startswith(FROZEN_PREFIX)]
        if lock:
            d["warnings"].append(f"{FROZEN_PREFIX} {lock}. It can't be confirmed or approved until they are unlocked.")
        return d


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
            self.safety.reset()
            self.bank.clear_policy_state()
