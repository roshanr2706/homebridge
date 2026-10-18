"""Autopilot: bounded autonomy through mandates.

Until now the assistant only responded: the student asked, it drafted, she confirmed. A mandate is a standing,
revocable permission the family sets, and the autopilot acts on its own inside it. Everything it does goes through
the policy engine (policy.py) exactly like a chat draft: tiers, limits, compliance screening and the freeze all
apply, and the draft is marked origin="autopilot" with the mandate id.

* Kinds. `tuition_guard` (top up the Tuition Fund from the MYR Wallet before tuition is due, sponsor-granted),
  `rate_watch` (convert MYR to CAD Everyday when the mid rate reaches a target, sponsor-granted: the MYR Wallet is
  sponsor-funded), `bill_autopay` (pay a saved bill payee when the bill is due, student-granted: her own CAD
  Everyday money) and `low_balance_topup` (ask the sponsor for money when the forecast dips below a floor: a T1
  request only, never money; student-granted).
* Lifecycle. proposed -> active -> paused / revoked. The chat model can only propose (T1, `propose_mandate`).
  Activating, resuming and widening are app endpoints only (T4 for the model): the sponsor approves his kinds with
  his PIN, the student activates hers with her own tap. Revoking is instant and needs no PIN.
* Pre-authorisation. When a condition holds, the autopilot drafts through the policy engine. A draft that is T2,
  compliance-clear, not frozen and inside the mandate's caps runs without a tap (`PolicyEngine.execute_mandated`)
  and is audited as `autopilot_executed`. Anything else (over the caps, T3 for any reason, a compliance flag, a
  payee younger than 30 days) stays a normal draft waiting for a person (`autopilot_escalated`). While payments are
  locked it does nothing (`autopilot_skipped`). The autopilot never adds payees and never reads chat or memos.
* Idempotent. At most one action per mandate per condition window (a tuition installment and month, a week, a bill
  due date), enforced by a unique key in the database, so the 30-second demo tick can run as often as it likes.

The run takes an injectable date, and the rate comes from fx.FxMarket (whose sandbox mid can be moved by the
operator's /demo/fx_shift), so every decision is deterministic in tests.
"""
from __future__ import annotations

import math
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from . import i18n
from .bank import to_minor
from .seed import add_months

if TYPE_CHECKING:
    from .policy import PendingAction, PolicyEngine

# What each kind may do. The ceilings are policy, not configuration: no mandate, proposal or cap change can go above
# them, whoever asks. Cap amounts are in `currency` (what leaves the source account, or what is requested).
KINDS: Dict[str, Dict[str, Any]] = {
    "tuition_guard": {"grantor": "sponsor", "period": "month", "currency": "MYR", "max_action": 10000.0,
                      "max_period": 10000.0, "label": "Tuition guard"},
    "rate_watch": {"grantor": "sponsor", "period": "week", "currency": "MYR", "max_action": 5000.0,
                   "max_period": 10000.0, "label": "Rate watch"},
    "bill_autopay": {"grantor": "student", "period": "month", "currency": "CAD", "max_action": 500.0,
                     "max_period": 1000.0, "label": "Bill autopay"},
    "low_balance_topup": {"grantor": "student", "period": "month", "currency": "CAD", "max_action": 1000.0,
                          "max_period": 1000.0, "label": "Low-balance request"},
}
LABELS_ZH = {"tuition_guard": "学费守护", "rate_watch": "汇率监控", "bill_autopay": "账单自动支付",
             "low_balance_topup": "余额不足自动申请"}
LABELS_MS = {"tuition_guard": "Pengawal yuran", "rate_watch": "Pemerhati kadar", "bill_autopay": "Autobayar bil",
             "low_balance_topup": "Permintaan baki rendah"}
OPEN = ("proposed", "active", "paused")
BILL_PAYEE_KINDS = {"utilities", "phone", "credit_card"}
PAYEE_MIN_AGE_DAYS = 30          # the autopilot never pays a payee younger than this (policy.py's "new payee" risk)
MIN_CONVERT_MYR = 50.0           # a conversion smaller than this isn't worth the margin
BILL_GRACE_DAYS = 5              # a bill can still be paid this many days after its due date
DEFAULT_EXPIRY_DAYS = 180
ESCALATION_TTL = 24 * 3600       # an escalated draft waits a day for the person, not the usual ten minutes
SESSION = "autopilot"


class MandateError(Exception):
    """A mandate request the rules refuse. The message is safe to show the model and the user."""


def period_key(kind: str, d: date) -> str:
    if KINDS[kind]["period"] == "week":
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"
    return d.strftime("%Y-%m")


def _m(v: float) -> str:
    return f"{v:,.2f}"


def _m0(v: float) -> str:
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.2f}"


def good_rate_target(mid: float) -> float:
    """'When the rate is good' without a number: about 0.4% better than today's mid, rounded up to 0.0005."""
    return round(math.ceil(mid * 1.004 / 0.0005) * 0.0005, 4)


# ------------------------------------------------------------------ plain-language text (en / zh / ms)
TEXT: Dict[str, Dict[str, str]] = {
    "desc.rate_watch": {
        "en": "Convert MYR to CAD Everyday when MYR/CAD reaches {target} or better, up to MYR {cap} a week.",
        "zh": "当马币兑加币汇率达到 {target} 或更好时，把马币换入 CAD 日常账户，每周最多 MYR {cap}。",
        "ms": "Tukar MYR ke CAD Everyday apabila MYR/CAD mencapai {target} atau lebih baik, sehingga MYR {cap} seminggu."},
    "desc.tuition_guard": {
        "en": "{days} days before each tuition due date, top up the Tuition Fund from the MYR Wallet if it is short, "
              "up to MYR {cap} a month.",
        "zh": "每期学费到期前 {days} 天，如学费基金不足，就从马币钱包补足，每月最多 MYR {cap}。",
        "ms": "{days} hari sebelum setiap tarikh akhir yuran, tambah Dana Yuran dari dompet MYR jika tak cukup, "
              "sehingga MYR {cap} sebulan."},
    "desc.bill_autopay": {
        "en": "Pay {payee} from CAD Everyday when the bill is due, up to CAD {cap} a bill.",
        "zh": "账单到期时从 CAD 日常账户支付 {payee}，每张账单最多 CAD {cap}。",
        "ms": "Bayar {payee} dari CAD Everyday apabila bil sampai tempoh, sehingga CAD {cap} satu bil."},
    "desc.low_balance_topup": {
        "en": "If CAD Everyday is forecast to drop below CAD {floor} within {days} days, ask Dad for up to CAD {cap}. "
              "Only a request: he decides.",
        "zh": "如果预测 CAD 日常账户会在 {days} 天内低于 CAD {floor}，就向爸爸申请最多 CAD {cap}。只是申请，由他决定。",
        "ms": "Jika CAD Everyday dijangka jatuh bawah CAD {floor} dalam {days} hari, minta ayah sehingga CAD {cap}. "
              "Hanya permintaan: dia yang putuskan."},
    "watch.rate_watch": {"en": "Now {mid} · target {target}", "zh": "当前 {mid} · 目标 {target}",
                         "ms": "Sekarang {mid} · sasaran {target}"},
    "watch.tuition_short": {"en": "Next: {term} due {due} · Tuition Fund short CAD {gap}",
                            "zh": "下一期：{term}，{due} 到期 · 学费基金差 CAD {gap}",
                            "ms": "Seterusnya: {term} pada {due} · Dana Yuran kurang CAD {gap}"},
    "watch.tuition_ok": {"en": "Next: {term} due {due} · Tuition Fund covers it",
                         "zh": "下一期：{term}，{due} 到期 · 学费基金足够", "ms": "Seterusnya: {term} pada {due} · Dana Yuran cukup"},
    "watch.tuition_none": {"en": "No tuition due", "zh": "暂无到期学费", "ms": "Tiada yuran perlu dibayar"},
    "watch.bill": {"en": "Next bill: CAD {amount} due {due}", "zh": "下一张账单：CAD {amount}，{due} 到期",
                   "ms": "Bil seterusnya: CAD {amount} pada {due}"},
    "watch.bill_none": {"en": "No bill due", "zh": "暂无到期账单", "ms": "Tiada bil perlu dibayar"},
    "watch.low": {"en": "Lowest in {days} days: CAD {low} (floor CAD {floor})",
                  "zh": "{days} 天内最低：CAD {low}（底线 CAD {floor}）",
                  "ms": "Paling rendah dalam {days} hari: CAD {low} (had CAD {floor})"},
    # The activity feed
    "act.rate_watch": {
        "en": "Rate reached {mid} (target {target}): converted MYR {amount} → CAD {recv} via {provider}, CAD {diff} "
              "{cmp} than this week's average. Mandate: Rate watch, MYR {cap}/week, {used} used.",
        "zh": "汇率达到 {mid}（目标 {target}）：通过{provider}把 MYR {amount} 换成 CAD {recv}，比本周平均{cmp} CAD {diff}。"
              "授权：汇率监控，每周 MYR {cap}，已用 {used}。"},
    "act.tuition_guard": {
        "en": "{term} is due {due} and the Tuition Fund was CAD {gap} short: converted MYR {amount} → CAD {recv} into "
              "the Tuition Fund via {provider}. Mandate: Tuition guard, MYR {cap}/month, {used} used.",
        "zh": "{term}将于 {due} 到期，学费基金还差 CAD {gap}：通过{provider}把 MYR {amount} 换成 CAD {recv} 存入学费基金。"
              "授权：学费守护，每月 MYR {cap}，已用 {used}。"},
    "act.bill_autopay": {
        "en": "{payee} bill of CAD {amount} due {due}: paid from CAD Everyday. Mandate: Bill autopay, up to CAD {cap} "
              "a bill.",
        "zh": "{payee} 账单 CAD {amount}，{due} 到期：已从 CAD 日常账户支付。授权：账单自动支付，每张最多 CAD {cap}。"},
    "act.low_balance_topup": {
        "en": "CAD Everyday is forecast to fall to CAD {low} on {date} (floor CAD {floor}): asked Dad for CAD {amount}. "
              "He decides.",
        "zh": "预测 CAD 日常账户将在 {date} 降到 CAD {low}（底线 CAD {floor}）：已向爸爸申请 CAD {amount}，由他决定。"},
    "esc": {"en": "{what} needs a person: {why}. It is waiting for review in the app.",
            "zh": "{what}需要人工确认：{why}。已在应用中等待审核。"},
    "why.over_cap": {"en": "{currency} {amount} is more than this mandate allows ({currency} {left} left this {period}, "
                           "{currency} {per_action} per action)",
                     "zh": "{currency} {amount} 超出授权额度（本{period}剩余 {currency} {left}，每次最多 {currency} {per_action}）"},
    "why.tier": {"en": "the policy engine put it at T3 ({reason})", "zh": "策略引擎将其列为 T3（{reason}）"},
    "why.compliance": {"en": "compliance screening flagged it", "zh": "合规筛查标记了此操作"},
    "why.blocked": {"en": "compliance screening blocked it", "zh": "合规筛查拦截了此操作"},
    "why.new_payee": {"en": "the payee was added less than 30 days ago", "zh": "收款人添加未满 30 天"},
    "why.refused": {"en": "{error}", "zh": "{error}"},
    "skip.frozen": {"en": "Payments are locked ({lock}), so autopilot did nothing for {label}.",
                    "zh": "付款已锁定，{label}未执行任何操作。"},
    "skip.cap_used": {"en": "{label}: this {period}'s {currency} {cap} is used up, so nothing more until next {period}.",
                      "zh": "{label}：本{period}的 {currency} {cap} 额度已用完，下个{period}再执行。"},
    "skip.low_funds": {"en": "{label}: the {account} doesn't have enough to act (needs {currency} {amount}).",
                       "zh": "{label}：{account}余额不足（需要 {currency} {amount}）。"},
    "skip.pending": {"en": "{label}: a similar draft is already waiting, so autopilot left it to you.",
                     "zh": "{label}：已有类似草稿在等待，自动驾驶未重复操作。"},
    "skip.refused": {"en": "{label}: the policy engine refused it ({error}).", "zh": "{label}：策略引擎拒绝了此操作（{error}）。"},
    "skip.paid": {"en": "{label}: the {payee} bill due {due} is already paid.", "zh": "{label}：{payee} 在 {due} 到期的账单已支付。"},
    "fail": {"en": "{what}: the bank refused it ({error}). Nothing moved.", "zh": "{what}：银行拒绝了（{error}），资金未变动。"},
    "period.week": {"en": "week", "zh": "周"},
    "period.month": {"en": "month", "zh": "月"},
    "cmp.better": {"en": "better", "zh": "多"},
    "cmp.worse": {"en": "worse", "zh": "少"},
}


DATE_KEYS = ("due", "date")


def tx(key: str, lang: str, **kw: Any) -> str:
    row = TEXT[key]
    kw = {k: (i18n.date(v, lang) if k in DATE_KEYS and isinstance(v, str) and len(v) == 10 else v)
          for k, v in kw.items()}
    return (row.get(lang) or row["en"]).format(**kw)


def both(key: str, **kw: Any) -> Dict[str, str]:
    """English and Chinese for the app (the feed is stored in both, so the zh phone shows Chinese)."""
    out = {"en": tx(key, "en", **kw)}
    zkw = {k: (i18n.account(v, "zh") if isinstance(v, str) else v) for k, v in kw.items()}
    out["zh"] = tx(key, "zh", **zkw)
    return out


class Autopilot:
    def __init__(self, policy: "PolicyEngine") -> None:
        self.policy = policy
        self.bank, self.fx = policy.bank, policy.fx
        self._lock = threading.RLock()
        self.clock = time.time
        self._run_day: Optional[date] = None   # the injected date while a run is in progress

    @property
    def audit(self):
        return self.policy.audit

    def today(self) -> date:
        return self._run_day or self.bank.today or date.today()

    # ------------------------------------------------------------------ helpers
    def sponsor_of(self, owner: str) -> str:
        return (self.bank.user(owner) or {}).get("sponsor_id") or ""

    def _save(self, m: Dict[str, Any]) -> None:
        self.bank.save_mandate(m["id"], m["owner"], m["status"], m["created_at"], m)

    def get(self, mandate_id: str) -> Dict[str, Any]:
        m = self.bank.load_mandate(str(mandate_id or ""))
        if not m:
            raise MandateError("Unknown mandate.")
        return m

    def mandates(self, owner: str) -> List[Dict[str, Any]]:
        return self.bank.load_mandates(owner)

    def _audit(self, event: str, actor: str, m: Dict[str, Any], **data: Any) -> None:
        self.audit.record(event, actor, owner=m["owner"], mandate_id=m["id"], kind=m["kind"],
                          grantor=m["granted_by"], **data)

    def used(self, m: Dict[str, Any], today: Optional[date] = None) -> float:
        """How much of this period's cap the autopilot has used (actions it took, not escalations)."""
        key = period_key(m["kind"], today or self.today())
        return round(sum(e.get("amount") or 0.0 for e in self.bank.load_autopilot_activity(m["owner"], 500)
                         if e["mandate_id"] == m["id"] and e["outcome"] == "acted" and e.get("period") == key), 2)

    def effective_status(self, m: Dict[str, Any], today: Optional[date] = None) -> str:
        if m["status"] in ("active", "paused") and m.get("expires_on") and \
                date.fromisoformat(m["expires_on"]) < (today or self.today()):
            return "expired"
        return m["status"]

    # ------------------------------------------------------------------ describing a mandate
    def _desc(self, m: Dict[str, Any], lang: str) -> str:
        c, caps = m["conditions"], m["caps"]
        if m["kind"] == "rate_watch":
            return tx("desc.rate_watch", lang, target=f"{c['target_rate']:.4f}", cap=_m0(caps["per_period"]))
        if m["kind"] == "tuition_guard":
            return tx("desc.tuition_guard", lang, days=c["days_before"], cap=_m0(caps["per_period"]))
        if m["kind"] == "bill_autopay":
            return tx("desc.bill_autopay", lang, payee=i18n.account(c["payee_name"], lang), cap=_m0(caps["per_action"]))
        return tx("desc.low_balance_topup", lang, floor=_m0(c["floor_cad"]), days=c["days_ahead"],
                  cap=_m0(caps["per_action"]))

    def _watch(self, m: Dict[str, Any], lang: str, today: date) -> str:
        c = m["conditions"]
        if m["kind"] == "rate_watch":
            return tx("watch.rate_watch", lang, mid=f"{self.fx.mid('MYR', 'CAD'):.4f}", target=f"{c['target_rate']:.4f}")
        if m["kind"] == "tuition_guard":
            nxt = self._next_installment(m["owner"])
            if not nxt:
                return tx("watch.tuition_none", lang)
            gap = self._tuition_gap(m["owner"], nxt)
            kw = {"term": i18n.term(nxt["term"], lang), "due": i18n.date(nxt["due"], lang)}
            return tx("watch.tuition_short", lang, gap=_m(gap), **kw) if gap > 0 else tx("watch.tuition_ok", lang, **kw)
        if m["kind"] == "bill_autopay":
            bill = self._bill(m)
            if not bill:
                return tx("watch.bill_none", lang)
            return tx("watch.bill", lang, amount=_m(bill["amount"]), due=i18n.date(bill["due"].isoformat(), lang))
        low = self._lowest(m["owner"], c["days_ahead"], today)
        return tx("watch.low", lang, days=c["days_ahead"], low=_m(low[0]) if low else "-", floor=_m0(c["floor_cad"]))

    def view(self, m: Dict[str, Any], today: Optional[date] = None) -> Dict[str, Any]:
        """A mandate for the app: its caps, how much is used this period and plain words in en and zh."""
        today = today or self.today()
        spec = KINDS[m["kind"]]
        used = self.used(m, today)
        status = self.effective_status(m, today)
        out = {k: m[k] for k in ("id", "kind", "owner", "granted_by", "caps", "conditions", "created_at",
                                 "expires_on", "proposed_via") if k in m}
        out.update({
            "status": status, "label": spec["label"], "label_zh": LABELS_ZH[m["kind"]],
            "used": used, "remaining": round(max(0.0, m["caps"]["per_period"] - used), 2),
            "period": spec["period"], "activated_at": m.get("activated_at"), "revoked_at": m.get("revoked_at"),
            "text": {"en": self._desc(m, "en"), "zh": self._desc(m, "zh")},
            "ceiling": {"per_action": spec["max_action"], "per_period": spec["max_period"]},
        })
        try:
            out["watch"] = {"en": self._watch(m, "en", today), "zh": self._watch(m, "zh", today)} \
                if status == "active" else None
        except Exception:   # a live status line must never break the list (e.g. a payee row was removed)
            out["watch"] = None
        return out

    def for_model(self, m: Dict[str, Any], lang: str = "en") -> Dict[str, Any]:
        v = self.view(m)
        return {"mandate_id": v["id"], "kind": v["kind"], "label": v["label"], "status": v["status"],
                "granted_by": v["granted_by"], "caps": v["caps"], "used_this_period": v["used"],
                "period": v["period"], "description": self._desc(m, lang), "expires_on": v.get("expires_on"),
                "watch": (v.get("watch") or {}).get("en"),
                "text": {lg: self._desc(m, lg) for lg in ("en", "zh", "ms")},
                "label_i18n": {"en": v["label"], "zh": LABELS_ZH[m["kind"]], "ms": LABELS_MS[m["kind"]]}}

    # ------------------------------------------------------------------ proposals
    def _resolve_bill_payee(self, owner: str, ref: str) -> Dict[str, Any]:
        ref = (ref or "").strip().lower()
        if not ref:
            raise MandateError("Which bill? Autopilot can pay a saved bill payee: BC Hydro, Northline Mobile or the "
                               "HomeBridge Secured Card minimum.")
        payees = [p for p in self.bank.payees(owner) if p["status"] == "active"]
        hints = {"utilities": ("hydro", "electric", "utility", "电费", "elektrik"),
                 "phone": ("phone", "mobile", "northline", "话费", "手机", "telefon"),
                 "credit_card": ("card", "credit", "信用卡", "kad")}
        match = [p for p in payees if ref in (p["id"].lower(), p["name"].lower()) or
                 (len(ref) >= 3 and ref in p["name"].lower())]
        if not match:
            kinds = [k for k, words in hints.items() if any(w in ref for w in words)]
            match = [p for p in payees if p["kind"] in kinds]
        if len(match) != 1:
            raise MandateError("Autopilot can only pay a saved bill payee (BC Hydro, Northline Mobile or the "
                               "HomeBridge Secured Card minimum). It never adds or pays a new payee.")
        p = match[0]
        if p["kind"] not in BILL_PAYEE_KINDS:
            raise MandateError(f"{p['name']} isn't a bill. Bill autopay covers utilities, the phone plan and the "
                               "secured card minimum; rent and tuition stay with you.")
        raw = self.bank.payee(p["id"]) or {}
        if (time.time() - float(raw.get("created_at") or 0)) / 86400 < PAYEE_MIN_AGE_DAYS:
            raise MandateError("Autopilot never pays a payee added less than 30 days ago.")
        return p

    def _bounded(self, kind: str, per_action: float, per_period: float) -> Tuple[float, float]:
        spec = KINDS[kind]
        for v in (per_action, per_period):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
                raise MandateError("Caps must be positive amounts.")
        per_action, per_period = round(float(per_action), 2), round(float(per_period), 2)
        if per_action > spec["max_action"] or per_period > spec["max_period"]:
            raise MandateError(f"A {spec['label']} mandate can be at most {spec['currency']} {_m0(spec['max_action'])} "
                               f"per action and {spec['currency']} {_m0(spec['max_period'])} per {spec['period']}.")
        if per_action > per_period:
            raise MandateError("The per-action cap can't be higher than the per-period cap.")
        return per_action, per_period

    def propose(self, owner: str, kind: str, args: Dict[str, Any], via: str = "chat",
                actor: str = "") -> Tuple[Dict[str, Any], bool]:
        """A new mandate in status 'proposed' (or the same proposal already waiting: returns it with False).
        Proposing never activates anything."""
        kind = str(kind or "").strip().lower()
        if kind not in KINDS:
            raise MandateError("Autopilot can do four things: keep the Tuition Fund topped up, convert MYR when the "
                               "rate reaches a target, pay a saved bill when it's due, or ask your sponsor when money "
                               "is running low. It can't send money to an account.")
        spec = KINDS[kind]

        def num(key: str, default: float) -> float:
            v = args.get(key)
            if v in (None, ""):
                return float(default)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise MandateError(f"{key} must be a number.")
            return float(v)

        conditions: Dict[str, Any]
        if kind == "rate_watch":
            mid = self.fx.mid("MYR", "CAD")
            target = round(num("target_rate", good_rate_target(mid)), 4)
            if not 0.8 * mid <= target <= 1.2 * mid:
                raise MandateError(f"A target of {target} is far from today's rate ({mid:.4f}); pick one within 20%.")
            per_action = num("amount", 2000)
            per_period = num("period_cap", per_action)
            conditions = {"target_rate": target, "pair": "MYR/CAD", "destination": "everyday"}
        elif kind == "tuition_guard":
            days = int(num("days_before", 30))
            if not 1 <= days <= 120:
                raise MandateError("Days before the due date must be between 1 and 120.")
            per_period = num("amount", 4000)
            per_action = per_period
            conditions = {"days_before": days, "destination": "tuition"}
        elif kind == "bill_autopay":
            p = self._resolve_bill_payee(owner, str(args.get("payee") or ""))
            days = int(num("days_before", 3))
            if not 0 <= days <= 10:
                raise MandateError("Days before the due date must be between 0 and 10.")
            per_action = num("amount", 50 if p["kind"] == "credit_card" else 100)
            per_period = num("period_cap", per_action)
            conditions = {"payee_id": p["id"], "payee_name": p["name"], "payee_kind": p["kind"], "days_before": days}
        else:
            floor, days = num("floor_cad", 200), int(num("days_ahead", 14))
            if not 50 <= floor <= 2000 or not 7 <= days <= 60:
                raise MandateError("The floor must be CAD 50 to 2,000 and the look-ahead 7 to 60 days.")
            per_action = num("amount", 300)
            per_period = num("period_cap", per_action)
            conditions = {"floor_cad": round(floor, 2), "days_ahead": days}
        per_action, per_period = self._bounded(kind, per_action, per_period)
        with self._lock:
            for m in self.mandates(owner):
                if m["kind"] != kind or self.effective_status(m) not in OPEN:
                    continue
                if kind == "bill_autopay" and m["conditions"]["payee_id"] != conditions["payee_id"]:
                    continue
                if m["status"] == "proposed":
                    return m, False
                who = "your sponsor" if spec["grantor"] == "sponsor" else "you"
                raise MandateError(f"There's already a {spec['label']} mandate ({m['status']}). Only {who} can change "
                                   "or revoke it, in the app.")
            now = self.clock()
            m = {"id": "md_" + uuid.uuid4().hex[:10], "kind": kind, "owner": owner,
                 "granted_by": spec["grantor"],
                 "grantor_id": self.sponsor_of(owner) if spec["grantor"] == "sponsor" else owner,
                 "caps": {"per_action": per_action, "per_period": per_period, "currency": spec["currency"],
                          "period": spec["period"]},
                 "conditions": conditions, "status": "proposed", "created_at": now,
                 "expires_on": (self.today() + timedelta(days=DEFAULT_EXPIRY_DAYS)).isoformat(),
                 "proposed_via": via, "proposed_by": actor or owner}
            self._save(m)
            self._audit("mandate_proposed", actor or owner, m, via=via, caps=m["caps"], conditions=conditions)
            return m, True

    # ------------------------------------------------------------------ the app's controls (never the model)
    def _check_grantor(self, m: Dict[str, Any], role: str, actor: str) -> None:
        if role == "sponsor":
            if m["granted_by"] != "sponsor" or self.sponsor_of(m["owner"]) != actor:
                raise MandateError("Only the person who grants this mandate can change it.")
        elif role == "student":
            if m["granted_by"] != "student" or m["owner"] != actor:
                raise MandateError("Your sponsor granted this mandate, so only your sponsor can change it.")
        else:
            raise MandateError("Only the person who grants this mandate can change it.")

    def activate(self, mandate_id: str, role: str, actor: str) -> Dict[str, Any]:
        """The grantor's yes: the sponsor approving (the API has checked his PIN) or the student's own tap."""
        with self._lock:
            m = self.get(mandate_id)
            self._check_grantor(m, role, actor)
            if m["status"] != "proposed":
                raise MandateError(f"This mandate is {m['status']}, not waiting for approval.")
            m.update(status="active", activated_at=self.clock(), activated_by=actor)
            self._save(m)
            self._audit("mandate_activated", actor, m, caps=m["caps"])
            return m

    def decline(self, mandate_id: str, role: str, actor: str) -> Dict[str, Any]:
        """The grantor says no, or the student withdraws her own proposal."""
        with self._lock:
            m = self.get(mandate_id)
            if not (role == "student" and m["owner"] == actor):
                self._check_grantor(m, role, actor)
            if m["status"] != "proposed":
                raise MandateError(f"This mandate is {m['status']}, not waiting for approval.")
            m.update(status="revoked", revoked_at=self.clock(), revoked_by=actor, revoked_reason="declined")
            self._save(m)
            self._audit("mandate_declined", actor, m)
            return m

    def pause(self, mandate_id: str, role: str, actor: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mandate_id)
            self._check_grantor(m, role, actor)
            if m["status"] != "active":
                raise MandateError(f"This mandate is {m['status']}, not active.")
            m.update(status="paused", paused_at=self.clock())
            self._save(m)
            self._audit("mandate_paused", actor, m)
            return m

    def resume(self, mandate_id: str, role: str, actor: str) -> Dict[str, Any]:
        with self._lock:
            m = self.get(mandate_id)
            self._check_grantor(m, role, actor)
            if m["status"] != "paused":
                raise MandateError(f"This mandate is {m['status']}, not paused.")
            if self.effective_status(m) == "expired":
                raise MandateError("This mandate has expired. Propose a new one.")
            m.update(status="active", resumed_at=self.clock())
            self._save(m)
            self._audit("mandate_resumed", actor, m)
            return m

    def revoke(self, mandate_id: str, role: str, actor: str) -> Dict[str, Any]:
        """Instant, no PIN: taking autonomy away is always allowed for the grantor. The next run ignores it."""
        with self._lock:
            m = self.get(mandate_id)
            if role == "student" and m["owner"] == actor and m["status"] == "proposed":
                pass   # withdrawing her own proposal
            else:
                self._check_grantor(m, role, actor)
            if m["status"] == "revoked":
                return m
            m.update(status="revoked", revoked_at=self.clock(), revoked_by=actor)
            self._save(m)
            self._audit("mandate_revoked", actor, m)
            return m

    def widens(self, mandate_id: str, per_action: float, per_period: float) -> bool:
        m = self.get(mandate_id)
        return per_action > m["caps"]["per_action"] + 1e-9 or per_period > m["caps"]["per_period"] + 1e-9

    def set_caps(self, mandate_id: str, role: str, actor: str, per_action: float, per_period: float) -> Dict[str, Any]:
        """New caps, within the kind's ceiling. The API asks for the sponsor's PIN first when this widens them."""
        with self._lock:
            m = self.get(mandate_id)
            self._check_grantor(m, role, actor)
            if m["status"] not in OPEN:
                raise MandateError(f"This mandate is {m['status']}.")
            per_action, per_period = self._bounded(m["kind"], per_action, per_period)
            before = dict(m["caps"])
            m["caps"].update(per_action=per_action, per_period=per_period)
            self._save(m)
            self._audit("mandate_caps_changed", actor, m, before=before, after=m["caps"])
            return m

    # ------------------------------------------------------------------ conditions
    def _next_installment(self, owner: str) -> Optional[Dict[str, Any]]:
        return next((t for t in self.bank.tuition(owner) if not t["paid"]), None)

    def _tuition_gap(self, owner: str, inst: Dict[str, Any]) -> float:
        fund = self.bank.find_account(owner, "CAD", "Tuition")
        bal = (fund["balance"] / 100) if fund and "Tuition" in fund["label"] else 0.0
        return round(max(0.0, inst["amount"] - bal), 2)

    def _bill(self, m: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """The bill this mandate pays: the secured card's statement minimum, or the payee's next recurring bill."""
        c = m["conditions"]
        payee = self.bank.payee(c["payee_id"]) or {}
        if payee.get("kind") == "credit_card":
            card = self.bank.card_for_payee(c["payee_id"])
            st = self.bank.card_statements(card["id"]) if card else []
            if not st:
                return None
            s = st[0]
            left = max(0, min(s["min_due"] - s["paid"], card["balance"]))
            return {"due": date.fromisoformat(s["due"]), "amount": round(left / 100, 2), "recurring_id": None,
                    "paid": left <= 0}
        rec = next((r for r in self.bank.recurring(m["owner"]) if r["counterparty"] == payee.get("name")
                    and r["amount"] < 0), None)
        if not rec:
            return None
        return {"due": date.fromisoformat(rec["next_due"]), "amount": round(-rec["amount"], 2),
                "recurring_id": rec["id"], "cadence": rec["cadence"], "paid": False}

    def _lowest(self, owner: str, days: int, today: date) -> Optional[Tuple[float, str]]:
        from .tools import ToolContext, forecast_cashflow   # local: tools imports policy
        ctx = ToolContext(user_id=owner, role="student", session_id=SESSION, bank=self.bank, fx=self.fx,
                          policy=self.policy, audit=self.audit, today=today)
        r = forecast_cashflow(ctx, {"days": days})
        if "error" in r:
            return None
        return float(r["lowest"]["balance"]), r["lowest"]["date"]

    def _waiting(self, owner: str, pred) -> bool:
        return any(pred(a) for a in self.policy.list_for(owner, ["awaiting_user", "awaiting_sponsor"]))

    # ------------------------------------------------------------------ the run
    def run(self, now: Optional[datetime] = None, owner: Optional[str] = None) -> List[Dict[str, Any]]:
        """Evaluates every active mandate once and acts where a condition holds. Returns the decisions recorded in
        this run (already-decided windows and unmet conditions record nothing)."""
        today = now.date() if isinstance(now, datetime) else (now if isinstance(now, date) else self.today())
        out: List[Dict[str, Any]] = []
        with self._lock:
            self._run_day = today
            try:
                out = self._run(today, owner)
            finally:
                self._run_day = None
        return out

    def _run(self, today: date, owner: Optional[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        owners = [owner] if owner else [r["id"] for r in self.bank._q("SELECT id FROM users WHERE role='student'")]
        for o in owners:
            for m in self.mandates(o):
                if m["status"] != "active" or self.effective_status(m, today) != "active":
                    continue
                try:
                    d = self._evaluate(m, today)
                except Exception as e:   # one broken mandate must not stop the others; it is audited
                    self.audit.record("autopilot_error", "autopilot", owner=o, mandate_id=m["id"], error=str(e)[:200])
                    d = None
                if d:
                    out.append(d)
        return out

    def _plan(self, m: Dict[str, Any], today: date) -> Optional[Dict[str, Any]]:
        """What this mandate wants to do today, or None when its condition does not hold."""
        owner, c, caps = m["owner"], m["conditions"], m["caps"]
        label = KINDS[m["kind"]]["label"]
        used = self.used(m, today)
        left = round(caps["per_period"] - used, 2)
        if m["kind"] == "rate_watch":
            mid = self.fx.mid("MYR", "CAD")
            if mid + 1e-12 < c["target_rate"]:
                return None
            wallet = self.bank.find_account(owner, "MYR", "Wallet")
            plan = {"window": period_key("rate_watch", today), "currency": "MYR", "kind": "conversion",
                    "from_account_id": wallet["id"] if wallet else ""}
            if left < MIN_CONVERT_MYR:
                return {**plan, "skip": "cap_used"}
            have = (wallet["balance"] / 100) if wallet else 0.0
            amount = round(min(caps["per_action"], left, have), 2)
            if amount < MIN_CONVERT_MYR:
                return {**plan, "skip": "low_funds", "amount": min(caps["per_action"], left), "account": "MYR Wallet"}
            best = self.fx.quotes("MYR", "CAD", amount, include_wallet=True)[0]
            if best["provider_key"] != "inapp":   # only the in-app conversion moves money between her own wallets
                return {**plan, "skip": "refused", "error": f"the cheapest route is {best['provider']}"}
            hist = self.fx.history("MYR", "CAD", 30)["series"]
            week = hist[-8:-1]
            avg = sum(week) / len(week)
            prov = self.fx.provider("inapp")
            diff = round(amount * (1 - prov.spread_pct / 100) * (mid - avg), 2)
            return {**plan, "amount": amount, "within": True,
                    "draft": lambda a: self.policy.draft_conversion(owner, f"{owner}:{SESSION}", "MYR", "CAD", a, [],
                                                                    "everyday", "wallet", mandate_id=m["id"]),
                    "facts": {"mid": f"{mid:.4f}", "target": f"{c['target_rate']:.4f}", "provider": best["provider"],
                              "diff": _m(abs(diff)), "better": diff >= 0},
                    "what": f"Converting MYR {_m(amount)} to CAD"}
        if m["kind"] == "tuition_guard":
            inst = self._next_installment(owner)
            if not inst:
                return None
            days = (date.fromisoformat(inst["due"]) - today).days
            if days < 0 or days > c["days_before"]:
                return None
            gap = self._tuition_gap(owner, inst)
            if gap <= 0:
                return None
            wallet = self.bank.find_account(owner, "MYR", "Wallet")
            fund = self.bank.find_account(owner, "CAD", "Tuition")
            plan = {"window": f"{inst['id']}:{period_key('tuition_guard', today)}", "currency": "MYR",
                    "kind": "conversion", "from_account_id": wallet["id"] if wallet else ""}
            if fund and self._waiting(owner, lambda a: a.kind == "conversion"
                                      and a.params.get("to_account_id") == fund["id"]):
                return {**plan, "skip": "pending"}
            need = float(self.fx.quote_to_receive("CAD", gap, self.fx.provider("inapp"))["send_amount"])
            have = (wallet["balance"] / 100) if wallet else 0.0
            if have < need:
                return {**plan, "skip": "low_funds", "amount": need, "account": "MYR Wallet"}
            within = need <= caps["per_action"] + 1e-9 and need <= left + 1e-9
            return {**plan, "amount": need, "within": within,
                    "draft": lambda a: self.policy.draft_conversion(owner, f"{owner}:{SESSION}", "MYR", "CAD", a, [],
                                                                    "tuition", "wallet", mandate_id=m["id"]),
                    "facts": {"term": inst["term"], "due": inst["due"], "gap": _m(gap), "provider": "HomeBridge wallet conversion"},
                    "what": f"Topping up the Tuition Fund (MYR {_m(need)})", "left": left}
        if m["kind"] == "bill_autopay":
            bill = self._bill(m)
            if not bill:
                return None
            due = bill["due"]
            if not (due - timedelta(days=c["days_before"]) <= today <= due + timedelta(days=BILL_GRACE_DAYS)):
                return None
            everyday = self.bank.find_account(owner, "CAD", "Everyday")
            plan = {"window": f"{c['payee_id']}:{due.isoformat()}", "currency": "CAD", "kind": "transfer",
                    "from_account_id": everyday["id"] if everyday else ""}
            if bill["paid"] or bill["amount"] <= 0:
                return {**plan, "skip": "paid", "due": due.isoformat()}
            if self._waiting(owner, lambda a: a.kind == "transfer" and a.params.get("payee_id") == c["payee_id"]):
                return {**plan, "skip": "pending"}
            payee = self.bank.payee(c["payee_id"]) or {}
            young = (time.time() - float(payee.get("created_at") or 0)) / 86400 < PAYEE_MIN_AGE_DAYS
            amount = bill["amount"]
            if everyday and everyday["balance"] < to_minor(amount):
                return {**plan, "skip": "low_funds", "amount": amount, "account": "CAD Everyday"}
            within = amount <= caps["per_action"] + 1e-9 and amount <= left + 1e-9
            return {**plan, "amount": amount, "within": within, "young_payee": young, "bill": bill,
                    "draft": lambda a: self.policy.draft_transfer(
                        owner, f"{owner}:{SESSION}", c["payee_id"], a, f"Autopilot: bill due {due.isoformat()}",
                        everyday["id"] if everyday else "", [], {"amount": "computed"}),
                    "facts": {"payee": c["payee_name"], "due": due.isoformat()},
                    "what": f"Paying {c['payee_name']} CAD {_m(amount)}", "left": left}
        # low_balance_topup
        low = self._lowest(owner, c["days_ahead"], today)
        if not low or low[0] >= c["floor_cad"]:
            return None
        plan = {"window": period_key("low_balance_topup", today), "currency": "CAD", "kind": "topup",
                "from_account_id": ""}
        if self._waiting(owner, lambda a: a.kind == "topup"):
            return {**plan, "skip": "pending"}
        if left <= 0:
            return {**plan, "skip": "cap_used"}
        need = math.ceil((c["floor_cad"] - low[0]) / 50.0) * 50.0
        amount = round(min(need, caps["per_action"], left), 2)
        return {**plan, "amount": amount, "within": True,
                "draft": lambda a: self.policy.draft_topup_request(
                    owner, f"{owner}:{SESSION}", a, "CAD",
                    f"Autopilot: CAD Everyday forecast to fall to CAD {low[0]:,.2f} by {low[1]}", "everyday"),
                "facts": {"low": _m(low[0]), "date": low[1], "floor": _m0(c["floor_cad"])},
                "what": f"Asking Dad for CAD {_m(amount)}"}

    def _evaluate(self, m: Dict[str, Any], today: date) -> Optional[Dict[str, Any]]:
        plan = self._plan(m, today)
        if plan is None:
            return None
        owner, caps, kind = m["owner"], m["caps"], m["kind"]
        label = KINDS[kind]["label"]
        act_key = f"{m['id']}|{plan['window']}|act"
        if self.bank.has_autopilot_key(act_key):
            return None   # this window is already decided: idempotent
        period = period_key(kind, today)
        pword = {"en": tx(f"period.{KINDS[kind]['period']}", "en"), "zh": tx(f"period.{KINDS[kind]['period']}", "zh")}
        base = {"mandate_id": m["id"], "kind": kind, "owner": owner, "granted_by": m["granted_by"],
                "window": plan["window"], "period": period, "date": today.isoformat()}

        # Payments locked: do nothing (one note per window and reason, not one every tick).
        lock = self.policy.safety.frozen_reason(owner, plan["kind"], {"from_account_id": plan["from_account_id"]})
        if lock:
            return self._skip(m, base, "frozen", both("skip.frozen", lock=lock, label=label))
        if plan.get("skip"):
            code = plan["skip"]
            cur = plan["currency"]
            if code == "cap_used":
                text = {"en": tx("skip.cap_used", "en", label=label, period=pword["en"], currency=cur,
                                 cap=_m0(caps["per_period"])),
                        "zh": tx("skip.cap_used", "zh", label=LABELS_ZH[kind], period=pword["zh"], currency=cur,
                                 cap=_m0(caps["per_period"]))}
            elif code == "low_funds":
                text = both("skip.low_funds", label=label, account=plan.get("account", ""), currency=cur,
                            amount=_m(plan.get("amount") or 0))
            elif code == "paid":
                text = both("skip.paid", label=label, payee=m["conditions"].get("payee_name", ""),
                            due=plan.get("due", ""))
            elif code == "pending":
                text = both("skip.pending", label=label)
            else:
                text = both("skip.refused", label=label, error=plan.get("error", ""))
            if code == "paid":   # the bill is settled: close the window quietly so it isn't re-checked
                self.bank.save_autopilot_activity("aa_" + uuid.uuid4().hex[:10], m["id"], owner, self.clock(),
                                                  "noted", act_key, {**base, "outcome": "noted", "text": text})
                return None
            return self._skip(m, base, code, text)

        amount = plan["amount"]
        used_before = self.used(m, today)
        try:
            a = plan["draft"](amount)
        except Exception as e:   # PolicyError (rate limit, a refused draft) or a bank error: nothing was created
            return self._skip(m, base, "refused", both("skip.refused", label=label, error=str(e)[:160]))
        a.origin, a.mandate_id = "autopilot", m["id"]
        self.policy._save(a)

        why: List[Dict[str, str]] = []
        if not plan.get("within", True):
            left = plan.get("left", caps["per_period"] - used_before)
            why.append({"en": tx("why.over_cap", "en", currency=plan["currency"], amount=_m(amount), left=_m(max(left, 0)),
                                 period=pword["en"], per_action=_m(caps["per_action"])),
                        "zh": tx("why.over_cap", "zh", currency=plan["currency"], amount=_m(amount), left=_m(max(left, 0)),
                                 period=pword["zh"], per_action=_m(caps["per_action"]))})
        if plan.get("young_payee"):
            why.append(both("why.new_payee"))
        if a.status == "blocked":
            why.append(both("why.blocked"))
        elif a.kind != "topup":
            if a.tier == "T3" or a.needs_sponsor:
                reason = (a.sponsor_reasons or a.risk_reasons or ["needs the sponsor"])[0]
                why.append({"en": tx("why.tier", "en", reason=reason),
                            "zh": tx("why.tier", "zh", reason=i18n.reason(reason, "zh"))})
            if (a.compliance or {}).get("outcome", "clear") != "clear":
                why.append(both("why.compliance"))

        caps_note = {"per_action": caps["per_action"], "per_period": caps["per_period"], "currency": caps["currency"],
                     "period": caps["period"], "used_before": used_before}
        if why or a.kind == "topup" and a.status != "awaiting_sponsor":
            return self._escalate(m, base, act_key, a, plan, why, caps_note)
        if a.kind == "topup":   # a request to the sponsor (T1): sending it is the whole action
            return self._acted(m, base, act_key, a, plan, caps_note, used_before, today)
        try:
            a = self.policy.execute_mandated(a.id, m["id"])
        except Exception as e:   # the policy engine had the last word: leave it for a person
            return self._escalate(m, base, act_key, a, plan, [both("why.refused", error=str(e)[:160])], caps_note)
        if a.status != "executed":
            text = both("fail", what=plan["what"], error=str((a.result or {}).get("error", ""))[:160])
            entry = {**base, "outcome": "failed", "action_id": a.id, "amount": 0.0, "currency": plan["currency"],
                     "text": text, "caps": caps_note}
            self._store(m, entry, act_key)
            self._audit("autopilot_failed", "autopilot", m, action_id=a.id, reason=text["en"])
            return entry
        return self._acted(m, base, act_key, a, plan, caps_note, used_before, today)

    # ------------------------------------------------------------------ recording decisions
    def _store(self, m: Dict[str, Any], entry: Dict[str, Any], key: str) -> bool:
        entry.setdefault("id", "aa_" + uuid.uuid4().hex[:10])
        entry.setdefault("ts", self.clock())
        return self.bank.save_autopilot_activity(entry["id"], m["id"], m["owner"], entry["ts"], entry["outcome"], key,
                                                 entry)

    def _skip(self, m: Dict[str, Any], base: Dict[str, Any], code: str, text: Dict[str, str]) -> Optional[Dict[str, Any]]:
        entry = {**base, "outcome": "skipped", "code": code, "amount": 0.0, "text": text}
        if not self._store(m, entry, f"{m['id']}|{base['window']}|skip:{code}"):
            return None
        self._audit("autopilot_skipped", "autopilot", m, code=code, reason=text["en"], window=base["window"])
        return entry

    def _escalate(self, m, base, key, a: "PendingAction", plan, why, caps_note) -> Dict[str, Any]:
        a.provenance = {**(a.provenance or {}), "autopilot": "escalated"}   # never runnable under the mandate now
        if a.status == "awaiting_user":
            a.expires_at = self.clock() + ESCALATION_TTL
        self.policy._save(a)
        reasons_en = "; ".join(w["en"] for w in why) or "it needs a person"
        reasons_zh = "；".join(w["zh"] for w in why) or "需要人工确认"
        text = {"en": tx("esc", "en", what=plan["what"], why=reasons_en),
                "zh": tx("esc", "zh", what=i18n.summary(a.summary, "zh"), why=reasons_zh)}
        entry = {**base, "outcome": "escalated", "action_id": a.id, "amount": 0.0, "currency": plan["currency"],
                 "requested": plan["amount"], "text": text, "caps": caps_note, "summary": a.summary,
                 "tier": a.tier, "status": a.status}
        self._store(m, entry, key)
        self._audit("autopilot_escalated", "autopilot", m, action_id=a.id, tier=a.tier, status=a.status,
                    reason=text["en"], caps=caps_note)
        return entry

    def _acted(self, m, base, key, a: "PendingAction", plan, caps_note, used_before, today) -> Dict[str, Any]:
        kind, caps, f = m["kind"], m["caps"], plan.get("facts", {})
        amount = plan["amount"]
        used = round(used_before + amount, 2)
        if kind == "rate_watch":
            recv = float((a.result or {}).get("credited", a.params.get("expected_receive", 0)))
            common = {"mid": f["mid"], "target": f["target"], "amount": _m(amount), "recv": _m(recv),
                      "diff": f["diff"], "cap": _m0(caps["per_period"]), "used": _m0(used)}
            text = {"en": tx("act.rate_watch", "en", provider=f["provider"],
                             cmp=tx("cmp.better" if f["better"] else "cmp.worse", "en"), **common),
                    "zh": tx("act.rate_watch", "zh", provider=i18n.provider(f["provider"], "zh"),
                             cmp=tx("cmp.better" if f["better"] else "cmp.worse", "zh"), **common)}
        elif kind == "tuition_guard":
            recv = float((a.result or {}).get("credited", a.params.get("expected_receive", 0)))
            common = {"due": f["due"], "gap": f["gap"], "amount": _m(amount), "recv": _m(recv),
                      "cap": _m0(caps["per_period"]), "used": _m0(used)}
            text = {"en": tx("act.tuition_guard", "en", term=f["term"], provider=f["provider"], **common),
                    "zh": tx("act.tuition_guard", "zh", term=i18n.term(f["term"], "zh"),
                             provider=i18n.provider(f["provider"], "zh"), **common)}
        elif kind == "bill_autopay":
            text = both("act.bill_autopay", payee=f["payee"], amount=_m(amount), due=f["due"],
                        cap=_m0(caps["per_action"]))
            bill = plan.get("bill") or {}
            if bill.get("recurring_id"):   # the bill is paid: its schedule moves on, so the forecast won't count it twice
                months = {"monthly": 1, "bimonthly": 2}.get(bill.get("cadence", ""), 0)
                nxt = add_months(bill["due"], months) if months else bill["due"] + timedelta(
                    days={"weekly": 7, "biweekly": 14}.get(bill.get("cadence", ""), 30))
                self.bank.set_recurring_next_due(bill["recurring_id"], nxt.isoformat())
        else:
            text = both("act.low_balance_topup", low=f["low"], date=f["date"], floor=f["floor"], amount=_m(amount))
        caps_note = {**caps_note, "used_after": used}
        entry = {**base, "outcome": "acted", "action_id": a.id, "amount": amount, "currency": plan["currency"],
                 "text": text, "caps": caps_note, "summary": a.summary, "status": a.status,
                 "result": a.result if kind != "low_balance_topup" else None}
        self._store(m, entry, key)
        self._audit("autopilot_executed", "autopilot", m, action_id=a.id, amount=amount, currency=plan["currency"],
                    caps=caps_note, reason=text["en"])
        return entry

    # ------------------------------------------------------------------ the policy engine's check
    def authorises(self, a: "PendingAction", mandate_id: str) -> Optional[str]:
        """Why this mandate does NOT cover this draft (None when it does). Called by PolicyEngine.execute_mandated, so
        the caps are enforced in policy code, not only by the run that drafted it: the mandate must be active, the
        draft must be exactly what the kind allows (the accounts and payee it names) and fit the caps left this period,
        and it must not be a draft the autopilot already handed to a person."""
        m = self.bank.load_mandate(mandate_id)
        if not m or m["owner"] != a.owner:
            return "Unknown mandate."
        status = self.effective_status(m)
        if status != "active":
            return f"The mandate is {status}."
        if (a.provenance or {}).get("autopilot") == "escalated":
            return "This draft was handed to a person; it can't run under the mandate."
        p, kind = a.params, m["kind"]
        wallet = self.bank.find_account(a.owner, "MYR", "Wallet") or {}
        if kind in ("rate_watch", "tuition_guard"):
            dest = self.bank.find_account(a.owner, "CAD", "Tuition" if kind == "tuition_guard" else "Everyday") or {}
            if a.kind != "conversion" or p.get("from_account_id") != wallet.get("id") or \
                    p.get("to_account_id") != dest.get("id"):
                return "The draft isn't what this mandate allows."
        elif kind == "bill_autopay":
            everyday = self.bank.find_account(a.owner, "CAD", "Everyday") or {}
            if a.kind != "transfer" or p.get("payee_id") != m["conditions"]["payee_id"] or \
                    p.get("from_account_id") != everyday.get("id"):
                return "The draft isn't what this mandate allows."
        else:
            return "This mandate only sends requests; it never moves money."
        amount = float(p.get("amount") or 0)
        left = m["caps"]["per_period"] - self.used(m)
        if amount > m["caps"]["per_action"] + 1e-9 or amount > left + 1e-9:
            return "The amount is outside the mandate's caps."
        return None

    # ------------------------------------------------------------------ feeds
    def activity(self, owner: str, mandate_ids: Optional[set] = None, limit: int = 30) -> List[Dict[str, Any]]:
        rows = [e for e in self.bank.load_autopilot_activity(owner, 300) if e.get("outcome") != "noted"]
        if mandate_ids is not None:
            rows = [e for e in rows if e["mandate_id"] in mandate_ids]
        return rows[:limit]


def start_ticker(get_autopilot, interval: float) -> threading.Thread:
    """Demo mode's light background tick: one autopilot run every `interval` seconds (HB_AUTOPILOT_TICK). The run is
    idempotent, so a tick that finds nothing new records nothing."""
    def loop() -> None:
        while True:
            time.sleep(interval)
            try:
                get_autopilot().run()
            except Exception:   # the tick must never take the server down; errors inside run() are audited
                pass
    t = threading.Thread(target=loop, name="autopilot-tick", daemon=True)
    t.start()
    return t
