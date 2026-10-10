"""Compliance layer: sanctions screening, KYC levels, FINTRAC and BNM record-keeping, structuring detection.

PolicyEngine calls `assess()` for every draft (payments, conversions, money requests and new payees),
before the tier is decided, and stores the result on the pending action. The app shows it as the
"Compliance checks" block on the action card, for the student and for the sponsor. Every decision is
written to the audit log (`compliance_check`, plus `sanctions_hit` and `kyc_denied`).

What each check models (a sandbox model of the rules, not legal advice):

* Sanctions / watchlist screening. Payee names are screened against SAMPLE_WATCHLIST when a payee is
  requested and again on every payment. Names are normalised (homoglyphs, accents, case, punctuation and
  legal-form words such as "LLC" removed, tokens sorted) and compared with difflib. A score of 0.90 or
  more blocks the draft; 0.80 to 0.90 adds risk and asks for manual review. The list is SAMPLE DATA:
  fictional names in the style of a sanctions listing, not the real SEMA, UN or OFAC lists.
* KYC. Each person has a level (KYC_LEVELS). An unverified person can chat and draft but cannot confirm
  or approve money movement; the level also caps the limits the sponsor can set.
* FINTRAC (Canada). An international electronic funds transfer of CAD 10,000 or more, alone or with
  others by the same person within 24 hours (the 24-hour rule), is flagged for a Large Electronic
  Funds Transfer Report (EFTR). No cash is handled, so a Large Cash Transaction Report (LCTR) is never
  needed. Every cross-border draft keeps a record: originator, beneficiary, purpose, source of funds.
* Bank Negara Malaysia. Ringgit is non-internationalised, so in production the "MYR Wallet" is a linked
  account at a Malaysian licensed bank and conversions run onshore through a licensed partner. Money
  leaving ringgit carries a purpose-of-payment code; BNM_PURPOSE_CODES is modelled on BNM's
  purpose-of-payment categories (the codes themselves are ours).
* Structuring. Several payments to one payee (or conversions of sponsor money) within 24 hours that
  are each under the single-payment limit but together exceed it are flagged as possible structuring.
  The policy engine already counts pending drafts toward the 24-hour limit; this names the pattern.
"""
from __future__ import annotations

import difflib
import re
import time
import unicodedata
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from .audit import AuditLog
from .bank import Bank, mask
from .fx import FxMarket
from .guard import normalize

if TYPE_CHECKING:
    from .policy import PendingAction, PolicyEngine

SAMPLE_WATCHLIST_NOTE = ("SAMPLE list for the demo: fictional names in the style of a sanctions listing. "
                         "It is not the real SEMA, UN or OFAC list.")
# name, the (sample) list it is on, and any aliases. All fictional.
SAMPLE_WATCHLIST: List[Dict[str, Any]] = [
    {"name": "Crimson Harbor Trading LLC", "list": "SAMPLE-SEMA", "aliases": ["Crimson Harbour Trading"]},
    {"name": "Northwind Shadow Exchange", "list": "SAMPLE-OFAC", "aliases": []},
    {"name": "Golden Lotus Remittance House", "list": "SAMPLE-UN", "aliases": ["Golden Lotus Money Transfer"]},
    {"name": "Blackfin Maritime Holdings", "list": "SAMPLE-SEMA", "aliases": []},
    {"name": "Red Meridian Arms Supply", "list": "SAMPLE-UN", "aliases": []},
    {"name": "Silverline Crypto Mixer", "list": "SAMPLE-OFAC", "aliases": ["Silverline Mixer"]},
    {"name": "Eastgate Petroleum Brokers", "list": "SAMPLE-SEMA", "aliases": []},
    {"name": "Obsidian Star Bank", "list": "SAMPLE-OFAC", "aliases": []},
    {"name": "Azure Peak Logistics FZE", "list": "SAMPLE-UN", "aliases": []},
    {"name": "Tri-Ocean Cash Express", "list": "SAMPLE-SEMA", "aliases": []},
    {"name": "Kestrel Defence Procurement", "list": "SAMPLE-UN", "aliases": ["Kestrel Defense Procurement"]},
    {"name": "Phantom Ledger Payments", "list": "SAMPLE-OFAC", "aliases": []},
]
SANCTIONS_HIT = 0.90
SANCTIONS_REVIEW = 0.80
# Legal-form and filler words that say nothing about who the party is.
NOISE_WORDS = {"llc", "ltd", "limited", "inc", "incorporated", "corp", "corporation", "co", "company", "plc",
               "sdn", "bhd", "fze", "gmbh", "sa", "ag", "the", "and", "of"}

KYC_LEVELS: Dict[str, Dict[str, Any]] = {
    "unverified": {"label": "Not verified", "moves_money": False, "max_single_cad": 0, "max_daily_cad": 0,
                   "evidence": "Account opened; identity not yet checked"},
    "verified_basic": {"label": "Verified (basic)", "moves_money": True, "max_single_cad": 5000,
                       "max_daily_cad": 10000,
                       "evidence": "Government photo ID (passport / study permit) and a liveness selfie"},
    "verified_full": {"label": "Verified (full)", "moves_money": True, "max_single_cad": 20000,
                      "max_daily_cad": 50000,
                      "evidence": "Basic, plus proof of address and source of funds"},
}
MONEY_KINDS = {"transfer", "conversion", "topup"}

EFTR_THRESHOLD_CAD = 10000.0
STRUCTURING_WINDOW = 24 * 3600
SANCTIONS_REVIEW_RISK = 25

BNM_PURPOSE_CODES: Dict[str, str] = {
    "ED01": "Education: tuition and course fees abroad",
    "ED02": "Education: living expenses of a student abroad",
    "FS01": "Family support and maintenance",
    "OA01": "Transfer to own account abroad",
}
BNM_NOTE = ("Purpose codes modelled on Bank Negara Malaysia purpose-of-payment categories (illustrative "
            "codes). Ringgit is non-internationalised: in production the MYR wallet is a linked account at a "
            "Malaysian licensed bank and conversions run onshore through a licensed partner.")
COUNTRY = {"CAD": "CA", "MYR": "MY", "USD": "US"}
LIVE = ("awaiting_user", "awaiting_sponsor", "executed")


def normalise_name(name: str) -> str:
    """Homoglyphs and invisible characters folded (guard.normalize), accents dropped, case folded,
    punctuation removed, legal-form words dropped, tokens sorted."""
    s = unicodedata.normalize("NFKD", normalize(name or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).casefold()
    s = re.sub(r"[.'’]", "", s)  # "L.L.C." -> "llc", "O'Neil" -> "oneil"
    tokens = [t for t in re.split(r"[\W_]+", s) if t and t not in NOISE_WORDS]
    return " ".join(sorted(tokens))


def screen_name(name: str) -> Dict[str, Any]:
    """The closest watchlist entry and how close it is: status clear, review or hit."""
    key = normalise_name(name)
    best: Dict[str, Any] = {"score": 0.0, "entry": None}
    if key:
        for entry in SAMPLE_WATCHLIST:
            for cand in [entry["name"], *entry["aliases"]]:
                score = difflib.SequenceMatcher(None, key, normalise_name(cand)).ratio()
                if score > best["score"]:
                    best = {"score": score, "entry": entry}
    score = round(best["score"], 3)
    status = "hit" if score >= SANCTIONS_HIT else "review" if score >= SANCTIONS_REVIEW else "clear"
    e = best["entry"] or {}
    return {"status": status, "score": score, "match": e.get("name"), "list": e.get("list")}


def _check(cid: str, label: str, status: str, detail: str) -> Dict[str, str]:
    # status: pass (nothing to do), flag (needs attention / manual review), block, report (a regulatory
    # report or record is due), na (does not apply)
    return {"id": cid, "label": label, "status": status, "detail": detail}


class Compliance:
    def __init__(self, bank: Bank, fx: FxMarket, audit: AuditLog) -> None:
        self.bank, self.fx, self.audit = bank, fx, audit

    # ---------------------------------------------------------------- KYC
    def kyc(self, user_id: str) -> Dict[str, Any]:
        row = self.bank.kyc(user_id) or {"level": "unverified", "verified_on": None, "method": None}
        info = KYC_LEVELS.get(row["level"], KYC_LEVELS["unverified"])
        return {"user_id": user_id, "level": row["level"] if row["level"] in KYC_LEVELS else "unverified",
                "label": info["label"], "moves_money": info["moves_money"], "verified_on": row.get("verified_on"),
                "max_single_cad": info["max_single_cad"], "max_daily_cad": info["max_daily_cad"]}

    def kyc_refusal(self, user_id: str, kind: str, role: str) -> Optional[str]:
        """Why this person may not confirm or approve this kind of action, or None."""
        if kind not in MONEY_KINDS:
            return None
        k = self.kyc(user_id)
        if k["moves_money"]:
            return None
        who = "Your identity" if role in ("student", "sponsor") else "The account holder's identity"
        return f"{who} has not been verified yet (KYC level: {k['label']}), so money can't be moved. Nothing was sent."

    def check_kyc_for(self, actor: str, owner: str, kind: str, role: str, action_id: str) -> Optional[str]:
        """Refusal reason for a confirmation (actor is the owner) or a sponsor approval (both must be
        verified). Refusals are audited."""
        why = self.kyc_refusal(actor, kind, role)
        if not why and actor != owner:
            why = self.kyc_refusal(owner, kind, "holder")
        if why:
            self.audit.record("kyc_denied", actor, action_id=action_id, owner=owner, kind=kind,
                              level=self.kyc(actor)["level"], owner_level=self.kyc(owner)["level"])
        return why

    def limit_ceiling(self, user_id: str) -> Dict[str, float]:
        k = self.kyc(user_id)
        return {"single_cad": float(k["max_single_cad"]), "daily_cad": float(k["max_daily_cad"])}

    # ------------------------------------------------------------- assess
    def _cad(self, amount: float, currency: str) -> float:
        return amount * self.fx.mid(currency, "CAD")

    def _party(self, name: str, account: Optional[Dict[str, Any]], currency: str) -> Dict[str, str]:
        return {"name": name, "account": mask(account["number"]) if account else "",
                "institution": ("linked Malaysian bank account" if currency == "MYR" else "HomeBridge (Canada)")
                if account else "", "country": COUNTRY.get(currency, "?")}

    def _sanctions(self, name: str, out: Dict[str, Any]) -> None:
        s = screen_name(name)
        out["screening"] = {"name": name, **s}
        if s["status"] == "hit":
            out["blocked"] = True
            out["block_reason"] = (f"Sanctions screening: '{name}' matches '{s['match']}' on the {s['list']} "
                                   f"watchlist (score {s['score']:.2f}). This payee is blocked.")
            out["checks"].append(_check("sanctions", "Sanctions screening", "block",
                                        f"Match: {s['match']} ({s['list']}, {s['score']:.0%})"))
        elif s["status"] == "review":
            out["risk"] += SANCTIONS_REVIEW_RISK
            out["risk_reasons"].append(f"Payee name is close to a watchlist entry ({s['match']}, "
                                       f"{s['score']:.0%}): manual review")
            out["checks"].append(_check("sanctions", "Sanctions screening", "flag",
                                        f"Near match: {s['match']} ({s['list']}, {s['score']:.0%}). Manual review."))
        else:
            out["checks"].append(_check("sanctions", "Sanctions screening", "pass",
                                        f"No match on the sample watchlist ({len(SAMPLE_WATCHLIST)} entries)"))

    def _kyc_check(self, owner: str, out: Dict[str, Any], sponsor_too: bool) -> None:
        people = [self.kyc(owner)]
        sponsor = (self.bank.user(owner) or {}).get("sponsor_id")
        if sponsor_too and sponsor:
            people.append(self.kyc(sponsor))
        names = {p["user_id"]: ((self.bank.user(p["user_id"]) or {}).get("name") or p["user_id"]).split()[0]
                 for p in people}
        detail = " · ".join(f"{names[p['user_id']]}: {p['label'].lower()}" for p in people)
        ok = all(p["moves_money"] for p in people)
        out["checks"].append(_check("kyc", "Identity (KYC)", "pass" if ok else "flag",
                                    detail if ok else detail + ". Money can't move until verified."))

    def _structuring(self, policy: "PolicyEngine", owner: str, kind: str, params: Dict[str, Any],
                     amount_cad: float, out: Dict[str, Any]) -> None:
        now = time.time()
        if kind == "transfer":
            same = lambda a: a.kind == "transfer" and a.params.get("payee_id") == params["payee_id"]  # noqa: E731
            to = params["payee_name"]
            noun = "payments to"
        else:
            same = lambda a: (a.kind == "conversion"  # noqa: E731
                              and a.params.get("from_account_id") == params["from_account_id"])
            to = (self.bank.account(params["from_account_id"]) or {}).get("label", "this account")
            noun = "conversions from"
        prior = [a for a in policy.actions.values()
                 if a.owner == owner and same(a) and a.status in LIVE and now - a.created_at < STRUCTURING_WINDOW]
        cur_key = "currency" if kind == "transfer" else "from_currency"
        total = amount_cad + sum(self._cad(a.params["amount"], a.params[cur_key]) for a in prior)
        limit = policy.limits.single_cad
        if prior and total > limit:
            msg = f"Possible structuring: {len(prior) + 1} {noun} {to} totalling CAD {total:,.0f} in 24h"
            # A flag for review, not extra risk points: the 24h limit (which counts pending drafts) already
            # sends the payment that crosses it to the sponsor, and the flag lands in the compliance report.
            out["structuring"] = {"count": len(prior) + 1, "total_cad": round(total, 2), "counterparty": to}
            out["checks"].append(_check("structuring", "Structuring detection", "flag", msg))
        else:
            out["checks"].append(_check("structuring", "Structuring detection", "pass",
                                        "No split payments in the last 24h" if not prior else
                                        f"{len(prior) + 1} in 24h, CAD {total:,.0f} in total: under the limit"))

    def _cross_border(self, policy: "PolicyEngine", owner: str, amount_cad: float, record: Dict[str, Any],
                      out: Dict[str, Any]) -> None:
        out["cross_border"] = True
        out["record"] = record
        out["checks"].append(_check("record_keeping", "Cross-border record", "pass",
                                    "Originator, beneficiary, purpose and source of funds recorded"))
        since = time.time() - 24 * 3600
        prior = [a for a in policy.actions.values() if a.owner == owner and a.status in LIVE and
                 a.created_at >= since and (a.compliance or {}).get("cross_border")]
        prior_cad = sum(float((a.compliance or {}).get("amount_cad") or 0) for a in prior)
        if amount_cad >= EFTR_THRESHOLD_CAD:
            out["reports"].append("EFTR")
            out["checks"].append(_check("eftr", "FINTRAC EFTR", "report",
                                        f"International EFT of CAD {amount_cad:,.0f} (≥ CAD 10,000): "
                                        "Large Electronic Funds Transfer Report due"))
        elif prior_cad + amount_cad >= EFTR_THRESHOLD_CAD:
            out["reports"].append("EFTR")
            out["checks"].append(_check("eftr", "FINTRAC EFTR", "report",
                                        f"24-hour rule: CAD {prior_cad + amount_cad:,.0f} across {len(prior) + 1} "
                                        "international EFTs. EFTR due"))
        else:
            out["checks"].append(_check("eftr", "FINTRAC EFTR", "pass",
                                        f"Below the CAD 10,000 reporting threshold (24h total CAD "
                                        f"{prior_cad + amount_cad:,.0f})"))

    def _purpose(self, code: str, out: Dict[str, Any]) -> None:
        out["purpose_code"] = {"code": code, "label": BNM_PURPOSE_CODES[code]}
        if out.get("record") is not None:
            out["record"]["purpose_code"] = code
            out["record"]["purpose"] = out["record"].get("purpose") or BNM_PURPOSE_CODES[code]
        out["checks"].append(_check("bnm_purpose", "BNM purpose code", "pass",
                                    f"{code}: {BNM_PURPOSE_CODES[code]}"))

    def _source_of_funds(self, owner: str, account: Optional[Dict[str, Any]]) -> str:
        if account and account.get("sponsor_funded"):
            sponsor = (self.bank.user(owner) or {}).get("sponsor_id") or ""
            name = (self.bank.user(sponsor) or {}).get("name") or "sponsor"
            return f"Sponsor allowance from parent in Malaysia ({name})"
        return "Account holder's own funds"

    def assess(self, policy: "PolicyEngine", kind: str, owner: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Runs every check that applies to this draft. Nothing here moves money or raises."""
        out: Dict[str, Any] = {"outcome": "clear", "blocked": False, "block_reason": None, "checks": [],
                               "reports": [], "record": None, "purpose_code": None, "cross_border": False,
                               "amount_cad": 0.0, "risk": 0, "risk_reasons": [], "screened_at": round(time.time(), 3)}
        user = self.bank.user(owner) or {"name": owner}
        sponsor_id = user.get("sponsor_id") or ""
        sponsor = self.bank.user(sponsor_id) or {"name": "sponsor"}
        if kind == "add_payee":
            self._sanctions(params["name"], out)
            self._kyc_check(owner, out, sponsor_too=True)
            if COUNTRY.get(params["currency"], "?") != "CA":
                out["checks"].append(_check("record_keeping", "Cross-border payee", "pass",
                                            f"Foreign beneficiary ({params['currency']}): payments to it keep a "
                                            "full cross-border record"))
        elif kind == "transfer":
            src = self.bank.account(params["from_account_id"])
            amount_cad = self._cad(params["amount"], params["currency"])
            out["amount_cad"] = round(amount_cad, 2)
            self._sanctions(params["payee_name"], out)
            self._kyc_check(owner, out, sponsor_too=bool(src and src["sponsor_funded"]))
            self._structuring(policy, owner, kind, params, amount_cad, out)
            src_country = COUNTRY.get(src["currency"] if src else "CAD", "?")
            dst_country = COUNTRY.get(params["currency"], "?")
            if src_country != dst_country:
                payee = self.bank.payee(params["payee_id"]) or {}
                self._cross_border(policy, owner, amount_cad, {
                    "originator": self._party(user["name"], src, src["currency"] if src else "CAD"),
                    "beneficiary": {"name": params["payee_name"], "account": mask(payee.get("number", "")),
                                    "country": dst_country},
                    "purpose": params.get("memo") or payee.get("kind", ""),
                    "source_of_funds": self._source_of_funds(owner, src),
                    "amount": params["amount"], "currency": params["currency"]}, out)
        elif kind == "conversion":
            src, dst = self.bank.account(params["from_account_id"]), self.bank.account(params["to_account_id"])
            amount_cad = self._cad(params["amount"], params["from_currency"])
            out["amount_cad"] = round(amount_cad, 2)
            out["checks"].append(_check("sanctions", "Sanctions screening", "pass",
                                        "Both sides are the account holder's own accounts (screened at onboarding)"))
            self._kyc_check(owner, out, sponsor_too=bool(src and src["sponsor_funded"]))
            if src and src["sponsor_funded"]:
                self._structuring(policy, owner, kind, params, amount_cad, out)
            if COUNTRY.get(params["from_currency"]) != COUNTRY.get(params["to_currency"]):
                self._cross_border(policy, owner, amount_cad, {
                    "originator": self._party(user["name"], src, params["from_currency"]),
                    "beneficiary": self._party(user["name"], dst, params["to_currency"]),
                    # Money leaving ringgit gets its purpose from the BNM purpose code below.
                    "purpose": "" if params["from_currency"] == "MYR" else "Transfer between own accounts",
                    "source_of_funds": self._source_of_funds(owner, src),
                    "amount": params["amount"], "currency": params["from_currency"]}, out)
            if params["from_currency"] == "MYR":
                tuition = bool(dst and "tuition" in dst["label"].lower())
                self._purpose("ED01" if tuition else "ED02", out)
        elif kind == "topup":
            dst = self.bank.find_account(owner, params["currency"])
            amount_cad = self._cad(params["amount"], params["currency"])
            out["amount_cad"] = round(amount_cad, 2)
            out["checks"].append(_check("sanctions", "Sanctions screening", "pass",
                                        "Sender is the verified sponsor (screened at onboarding)"))
            self._kyc_check(owner, out, sponsor_too=True)
            reason = params.get("reason", "")
            tuition = bool(re.search(r"tuition|fee|yuran|学费|sem(ester)? fee", reason, re.I))
            if params["currency"] != "MYR":   # the sponsor's ringgit leaves Malaysia
                self._cross_border(policy, owner, amount_cad, {
                    "originator": {"name": sponsor["name"], "account": "sponsor's Malaysian bank account",
                                   "country": "MY"},
                    "beneficiary": self._party(user["name"], dst, params["currency"]),
                    "purpose": reason, "source_of_funds": f"Sponsor's own funds ({sponsor['name']}, parent)",
                    "amount": params["amount"], "currency": params["currency"]}, out)
                self._purpose("ED01" if tuition else "ED02", out)
            else:
                out["checks"].append(_check("record_keeping", "Domestic transfer", "pass",
                                            "Within Malaysia (sponsor's bank to the linked MYR account)"))
        if out["blocked"]:
            out["outcome"] = "blocked"
        elif any(c["status"] in ("flag", "report") for c in out["checks"]):
            out["outcome"] = "review"
        return out

    def record(self, action: "PendingAction", result: Dict[str, Any]) -> None:
        """Audits the decision. The payee name is already in the action_drafted entry; only the match is new."""
        self.audit.record("compliance_check", "system", action_id=action.id, kind=action.kind,
                          outcome=result["outcome"],
                          checks={c["id"]: c["status"] for c in result["checks"]},
                          reports=result["reports"],
                          purpose_code=(result.get("purpose_code") or {}).get("code"))
        s = result.get("screening") or {}
        if s.get("status") == "hit":
            self.audit.record("sanctions_hit", "system", action_id=action.id, owner=action.owner,
                              match=s["match"], list=s["list"], score=s["score"])
        elif s.get("status") == "review":
            self.audit.record("sanctions_review", "system", action_id=action.id, owner=action.owner,
                              match=s["match"], list=s["list"], score=s["score"])

    @staticmethod
    def public(result: Dict[str, Any]) -> Dict[str, Any]:
        """What is stored on the action and shown on the card."""
        keep = ("outcome", "blocked", "block_reason", "checks", "reports", "record", "purpose_code",
                "cross_border", "amount_cad", "screened_at", "structuring")
        return {k: result[k] for k in keep if k in result}

    # ------------------------------------------------------------- report
    def report(self, actions: List["PendingAction"], people: List[str], scope: str) -> Dict[str, Any]:
        """Evidence summary over the given (already role-scoped) actions."""
        by_check: Dict[str, Dict[str, int]] = {}
        hits, eftr, structuring, purposes, decisions = [], [], [], {}, []
        screened = 0
        for a in actions:
            c = a.compliance or {}
            if not c:
                continue
            screened += 1
            for ch in c.get("checks", []):
                by_check.setdefault(ch["id"], {}).setdefault(ch["status"], 0)
                by_check[ch["id"]][ch["status"]] += 1
                if ch["id"] == "sanctions" and ch["status"] in ("block", "flag"):
                    hits.append({"action_id": a.id, "status": ch["status"], "detail": ch["detail"]})
                if ch["id"] == "eftr" and ch["status"] == "report":
                    eftr.append({"action_id": a.id, "summary": a.summary, "detail": ch["detail"]})
                if ch["id"] == "structuring" and ch["status"] == "flag":
                    structuring.append({"action_id": a.id, "detail": ch["detail"]})
            if c.get("purpose_code"):
                code = c["purpose_code"]["code"]
                purposes[code] = purposes.get(code, 0) + 1
            decisions.append({"action_id": a.id, "kind": a.kind, "summary": a.summary, "status": a.status,
                              "outcome": c.get("outcome"), "created_at": a.created_at,
                              "flags": [ch["detail"] for ch in c.get("checks", [])
                                        if ch["status"] in ("flag", "block", "report")]})
        return {
            "scope": scope,
            "generated_at": round(time.time(), 3),
            "drafts_screened": screened,
            "by_check": by_check,
            "sanctions": hits,
            "eftr": eftr,
            "structuring": structuring,
            "purpose_codes_used": purposes,
            "kyc": [self.kyc(p) for p in people],
            "decisions": decisions[-50:],
            "watchlist": {"entries": len(SAMPLE_WATCHLIST), "note": SAMPLE_WATCHLIST_NOTE,
                          "hit_score": SANCTIONS_HIT, "review_score": SANCTIONS_REVIEW},
            "thresholds": {"eftr_cad": EFTR_THRESHOLD_CAD, "lctr": "not applicable: no cash is handled",
                           "structuring": "2+ payments to one payee in 24h totalling more than the single limit"},
            "purpose_code_table": BNM_PURPOSE_CODES,
            "notes": [BNM_NOTE],
        }
