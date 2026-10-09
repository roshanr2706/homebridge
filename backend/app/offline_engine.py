"""Deterministic offline planner.

Implements the same Provider interface as the LLM adapter, using intent rules.
Uses:
  * tests and CI run the full agent loop, tools and policy without a network
  * automatic fallback if the LLM API is unreachable (e.g. venue Wi-Fi in Shenzhen)
  * a baseline the LLM must beat on the scripted tasks

It is intentionally narrow. It covers the scripted tasks and refuses anything
the safety check flagged, rather than trying to be clever.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

NUM = r"(?:rm|cad|myr|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b"
CUR_WORDS = {"myr": "MYR", "rm": "MYR", "ringgit": "MYR", "cad": "CAD", "canadian": "CAD", "usd": "USD"}


def _amount(text: str) -> Optional[float]:
    for m in re.finditer(NUM, text.lower()):
        # skip things that look like dates or account numbers
        span = text[max(0, m.start() - 1):m.end() + 1]
        if re.search(r"\d{4}-\d{4}", span):
            continue
        v = float(m.group(1).replace(",", ""))
        if m.group(2):
            v *= 1000
        if v > 0:
            return v
    return None


def _currencies(text: str) -> List[str]:
    found = []
    for m in re.finditer(r"\b(myr|rm|ringgit|cad|canadian|usd)\b", text.lower()):
        c = CUR_WORDS[m.group(1)]
        if not found or found[-1] != c:
            found.append(c)
    return found


def _call(name: str, **args: Any) -> Dict[str, Any]:
    return {"role": "assistant", "content": None, "reasoning_content": None,
            "tool_calls": [{"id": "call_" + uuid.uuid4().hex[:8], "name": name, "arguments": args}]}


def _say(text: str) -> Dict[str, Any]:
    return {"role": "assistant", "content": text, "tool_calls": [], "reasoning_content": None}


def _money(v: float, cur: str) -> str:
    return f"{cur} {v:,.2f}"


def _action_text(a: Dict[str, Any]) -> str:
    if a.get("status") == "awaiting_sponsor":
        return f"I've sent this to your sponsor for approval: {a['summary']}."
    s = f"I've drafted it: {a['summary']}. Please check the payee and amount on the confirmation card and tap Confirm."
    if a.get("needs_sponsor_approval"):
        s += " After you confirm, your sponsor also needs to approve it."
    if a.get("warnings"):
        s += " Note: " + " ".join(a["warnings"])
    return s


class OfflineEngine:
    name = "offline"

    # ------------------------------------------------------------------ main
    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]:
        idx = max(i for i, m in enumerate(messages) if m["role"] == "user")
        text = messages[idx]["content"]
        low = text.lower()
        note = " ".join(m["content"] for m in messages[idx + 1:] if m["role"] == "system")
        fm = re.search(r"Safety check flags: ([a-z, ]+)\.", note)
        note = fm.group(1) if fm else ""
        results: List[Tuple[str, Dict[str, Any]]] = []
        for m in messages[idx + 1:]:
            if m["role"] == "tool":
                body = json.loads(m["content"])
                results.append((body["tool"], body["untrusted_data"]))
        prev_user = [m["content"] for m in messages[:idx] if m["role"] == "user"]
        return self._plan(text, low, note, results, prev_user)

    def _plan(self, text: str, low: str, note: str, res: List[Tuple[str, Dict[str, Any]]],
              prev_user: List[str]) -> Dict[str, Any]:
        done = [n for n, _ in res]
        last = res[-1][1] if res else {}
        if last.get("error") and not last.get("saved_payees"):
            return _say(f"I couldn't do that: {last['error']}")

        # 1. Scam check of a pasted or quoted message
        if re.search(r"scam|is this (real|legit)|legit ke|real or not|should i pay this", low) or (
                len(text) > 120 and "scam" in note.lower()):
            if "check_message_for_scam" not in done:
                return _call("check_message_for_scam", text=text)
            r = last
            if r["verdict"] == "no_known_pattern":
                return _say("I don't see common scam signs in that message. It still makes sense to check it "
                            "against the organisation's official website or app before paying anything.")
            signs = sorted({s for v in r["signals"].values() for s in v}, key=len)[:3]
            lead = "This looks like a scam" if r["verdict"] == "likely_scam" else "This looks suspicious"
            why = (": it mentions " + ", ".join(f"'{s}'" for s in signs)) if signs else ""
            return _say(f"{lead}{why}. Don't pay or share any codes, and contact the organisation through its "
                        "official website instead. I won't set up any payment for it.")

        # 2. Anything the guard flagged as manipulation gets a refusal, no tools
        lowered_note = note.lower()
        if any(k in lowered_note for k in ("injection", "extraction", "escalation")) or (
                "scam" in lowered_note and not re.search(r"\b(check|scam)\b", low)):
            return _say(self._refusal(lowered_note))

        # 3. Change of mind: "actually make it 400"
        if re.search(r"\b(actually|instead|make it|change it to)\b", low) and _amount(text) and prev_user:
            if "get_pending_actions" not in done:
                return _call("get_pending_actions")
            if "cancel_pending_action" not in done:
                acts = [a for a in res[0][1]["actions"] if a["status"] == "awaiting_user" and a["kind"] == "transfer"]
                if not acts:
                    return _say("There's no draft waiting for you to confirm, so there's nothing to change.")
                return _call("cancel_pending_action", action_id=acts[-1]["action_id"])
            if "prepare_transfer" not in done:
                m = re.search(r"to (.+?) from", res[1][1]["action"]["summary"])
                return _call("prepare_transfer", payee=m.group(1) if m else "", amount=_amount(text))
            return _say("I cancelled the earlier draft. " + _action_text(last["action"]))

        if re.search(r"\bcancel\b", low):
            if "get_pending_actions" not in done:
                return _call("get_pending_actions")
            if "cancel_pending_action" not in done:
                acts = [a for a in res[0][1]["actions"] if a["status"] in ("awaiting_user", "awaiting_sponsor")]
                if not acts:
                    return _say("There's nothing pending to cancel.")
                return _call("cancel_pending_action", action_id=acts[-1]["action_id"])
            return _say(f"Cancelled: {last['action']['summary']}.")

        # 4. Multi-step: convert enough then pay rent
        if re.search(r"convert enough|enough .* (to|for) (cover|pay)", low) and "rent" in low:
            return self._convert_then_rent(res, done)

        # 5. Sponsor top-up request
        m = re.search(r"\b(ask|request).{0,20}(dad|father|mum|mom|parent|sponsor|ayah|papa)", low)
        if m:
            amt = _amount(text)
            if amt is None:
                return _say("How much would you like to ask for, and what is it for?")
            if "request_sponsor_topup" not in done:
                reason = re.sub(r".*\bfor\b", "", text, count=1).strip() if " for " in low else "student expenses"
                cur = "MYR" if "MYR" in _currencies(text) else "CAD"
                return _call("request_sponsor_topup", amount=amt, currency=cur, reason=reason[:80] or "student expenses")
            return _say(_action_text(last["action"]) + " You'll see the money once they approve.")

        # 6. Summary for the sponsor
        if re.search(r"summary|report", low) and re.search(r"dad|father|parent|sponsor|send", low):
            if "budget_summary" not in done:
                return _call("budget_summary")
            if "get_balances" not in done:
                return _call("get_balances", total_currency="CAD")
            b, s = res[0][1], res[1][1]
            top = ", ".join(f"{c['category']} CAD {c['spent_cad']:,.0f}" for c in b["categories"][:4])
            return _say(f"Here's a summary you can send: In the last 30 days I spent CAD {b['total_spent_cad']:,.0f} "
                        f"(mainly {top}) and earned CAD {b['income_cad']:,.0f} from my part-time job. "
                        f"Total across my accounts is about CAD {s['total']:,.0f}. Next tuition installment is "
                        f"coming up and I'm keeping that money in the tuition fund.")

        # 7. Pay tuition
        if re.search(r"\bpay\b", low) and re.search(r"tuition|school fees|yuran", low):
            if "get_tuition_schedule" not in done:
                return _call("get_tuition_schedule")
            if "prepare_transfer" not in done:
                nxt = res[0][1]["installments"][0]
                return _call("prepare_transfer", payee="UBC Student Financial Services", amount=nxt["amount"],
                             memo=nxt["term"])
            r = last
            msg = _action_text(r["action"])
            sched = res[0][1]
            if sched["next_shortfall_cad"] > 0:
                msg += (f" Heads up: the tuition fund is CAD {sched['next_shortfall_cad']:,.2f} short, so you'll need "
                        "to convert some MYR into it before this can go through.")
            return _say(msg)

        # 8. Tuition questions / planning
        if re.search(r"tuition|yuran", low):
            if "get_tuition_schedule" not in done:
                return _call("get_tuition_schedule")
            s = res[0][1]
            nxt = s["installments"][0]
            msg = (f"Your next tuition installment is {_money(nxt['amount'], 'CAD')} for {nxt['term']}, due "
                   f"{nxt['due']} ({nxt['days_until_due']} days away). Your tuition fund has "
                   f"{_money(s['tuition_fund_cad'], 'CAD')}.")
            if s["next_shortfall_cad"] > 0:
                months = max(1, nxt["days_until_due"] // 30)
                msg += (f" That leaves a shortfall of {_money(s['next_shortfall_cad'], 'CAD')}. Your MYR wallet is worth "
                        f"about {_money(s['myr_wallet_value_cad'], 'CAD')}, so converting some of it would cover it, "
                        f"or you could set aside about {_money(s['next_shortfall_cad'] / months, 'CAD')} a month.")
            else:
                msg += " That covers it."
            if re.search(r"plan|ready|prepare|remind", low) and "create_reminder" not in done:
                return _call("create_reminder", due_date=nxt["due"][:8] + "01", text=f"Tuition due {nxt['due']}: "
                             f"top up tuition fund")
            if "create_reminder" in done:
                msg += f" I've also set a reminder for {last['due_date']}."
            return _say(msg)

        # 9. Conversion (execute) vs comparison
        curs = _currencies(text)
        amt = _amount(text)
        if re.search(r"\b(convert|change|tukar|exchange)\b", low) and amt and len(curs) >= 2 and not re.search(
                r"cheapest|best way|compare|which", low):
            if "get_fx_quotes" not in done:
                return _call("get_fx_quotes", from_currency=curs[0], to_currency=curs[1], amount=amt, own_wallet=True)
            if "prepare_conversion" not in done:
                return _call("prepare_conversion", from_currency=curs[0], to_currency=curs[1], amount=amt)
            q = res[0][1]["quotes"]
            inapp = next(x for x in q if x["provider_key"] == "inapp")
            return _say(_action_text(last["action"]) + f" The fee is {inapp['true_cost_pct']}% in the exchange "
                        f"rate (rate {inapp['rate']} against mid-market {inapp['mid_rate']}).")

        if re.search(r"cheapest|best way|compare|which .*(service|provider)|lowest fee", low) or (
                re.search(r"send|transfer", low) and re.search(r"dad|father|parent|mum", low) and len(curs) >= 1):
            src = curs[0] if curs else "MYR"
            dst = curs[1] if len(curs) > 1 else ("CAD" if src == "MYR" else "MYR")
            amount = amt or 5000.0
            parent = bool(re.search(r"dad|father|parent|mum|mom", low))
            if "get_fx_quotes" not in done:
                return _call("get_fx_quotes", from_currency=src, to_currency=dst, amount=amount, own_wallet=not parent)
            r = last
            best, worst = r["quotes"][0], r["quotes"][-1]
            return _say(f"Cheapest for {_money(amount, src)} is the {best['provider']}: "
                        f"{_money(best['you_receive'], best['receive_currency'])} arrives (true cost "
                        f"{best['true_cost_pct']}%, {best['speed']}). That saves {_money(r['saving_vs_worst'], dst)} "
                        f"compared with the {worst['provider'].lower()}. "
                        + (r["note"] + " " if r.get("note") else "") + "Rates are a sandbox snapshot, not advice.")

        if re.search(r"good time|right time|should i (convert|change)|rate (going|trend)|wait", low):
            src = curs[0] if curs else "MYR"
            dst = curs[1] if len(curs) > 1 else ("CAD" if src == "MYR" else "MYR")
            if "get_fx_history" not in done:
                return _call("get_fx_history", from_currency=src, to_currency=dst)
            h = last
            return _say(f"I can't predict exchange rates. Over the last {h['days']} days {h['pair']} ranged from "
                        f"{h['low']} to {h['high']}, and today is {h['today']} (average {h['average']}). If you need "
                        "the money for a fixed date like tuition, converting in a few smaller amounts over time "
                        "reduces the risk of a bad day.")

        # 10. Pay someone
        if re.search(r"\b(pay|send|transfer|bayar)\b", low):
            payee = self._payee_word(low)
            if payee is None:
                return _say("Who would you like to pay? Your saved payees are UBC Student Financial Services, "
                            "Maple Court Rentals, BC Hydro and Northline Mobile.")
            if amt is None and payee == "rent" and "list_transactions" not in done:
                return _call("list_transactions", category="rent", days=60, limit=1)
            if amt is None and payee == "rent":
                rows = res[0][1]["transactions"]
                if rows:
                    amt = abs(rows[0]["amount"])
            if amt is None:
                return _say("How much would you like to send?")
            if "prepare_transfer" not in done:
                return _call("prepare_transfer", payee=payee, amount=amt)
            return _say(_action_text(last["action"]))

        # 11. Budget, balances, transactions, credit, payees
        m = re.search(r"(?:set|make).{0,10}?(\w+) budget.{0,10}?(\d[\d,]*)", low) or re.search(
            r"budget (?:for|of) (\w+).{0,10}?(\d[\d,]*)", low)
        if m:
            if "set_budget" not in done:
                return _call("set_budget", category=m.group(1), monthly_amount=float(m.group(2).replace(",", "")))
            return _say(f"Done. Your {last['category']} budget is now CAD {last['monthly']:,.0f} a month.")

        if re.search(r"spend|spent|where did my money|budget|too much on|overspend|habis", low):
            if "budget_summary" not in done:
                return _call("budget_summary")
            b = last
            over = [c for c in b["categories"] if c["over_budget"]]
            focus = next((c for c in b["categories"] if c["category"] in low), None)
            if focus or re.search(r"food|makan|eat", low):
                cats = [c for c in b["categories"] if c["category"] in ("dining", "groceries")] if not focus else [focus]
                parts = [f"{c['category']} CAD {c['spent_cad']:,.2f}" + (
                    f" against a budget of CAD {c['budget_cad']:,.0f}" if c["budget_cad"] else "") for c in cats]
                msg = "In the last 30 days: " + "; ".join(parts) + "."
                if any(c["over_budget"] for c in cats):
                    msg += " Dining is over budget. Cutting two takeaway meals a week would bring it back in line."
                return _say(msg)
            top = ", ".join(f"{c['category']} CAD {c['spent_cad']:,.2f}" for c in b["categories"][:5])
            msg = f"In the last 30 days you spent CAD {b['total_spent_cad']:,.2f}. Biggest categories: {top}."
            if over:
                msg += " Over budget: " + ", ".join(c["category"] for c in over) + "."
            if b["possible_duplicate_charges"]:
                msg += " Possible duplicate charge from " + ", ".join(b["possible_duplicate_charges"]) + "; worth checking."
            return _say(msg)

        if re.search(r"credit|secured card|credit score", low):
            if "credit_building_plan" not in done:
                return _call("credit_building_plan", has_credit_card=False, has_sin=True)
            return _say("Here's how to build credit from scratch: " + " ".join(
                f"({i + 1}) {s}" for i, s in enumerate(last["steps"][:5])) + " " + last["disclosure"])

        if re.search(r"payees?\b|who can i pay", low):
            if "list_payees" not in done:
                return _call("list_payees")
            return _say("Your saved payees: " + ", ".join(f"{p['name']} ({p['number']})" for p in last["payees"]) + ".")

        if re.search(r"transactions?|history|statement", low):
            if "list_transactions" not in done:
                return _call("list_transactions", limit=10)
            return _say("Recent transactions: " + "; ".join(
                f"{t['date']} {t['counterparty']} {t['currency']} {t['amount']:,.2f}" for t in last["transactions"][:8]) + ".")

        if re.search(r"balance|how much (money )?(do i have|left|i have)|baki|berapa|duit|broke", low):
            cur = "MYR" if re.search(r"ringgit|myr|\brm\b|baki|berapa", low) else "CAD"
            if "get_balances" not in done:
                return _call("get_balances", total_currency=cur)
            b = last
            parts = [f"{a['label']} {_money(a['balance'], a['currency'])}" for a in b["accounts"]]
            return _say("Your balances: " + "; ".join(parts) + f". Total is about {_money(b['total'], b['total_currency'])}.")

        if re.search(r"^(thanks|thank you|ok|okay|terima kasih)\b", low):
            return _say("You're welcome.")

        return _say("I can help with balances, spending, tuition, exchange rates, payments, credit building and "
                    "checking suspicious messages. What would you like to do?")

    # --------------------------------------------------------------- helpers
    @staticmethod
    def _payee_word(low: str) -> Optional[str]:
        for word, key in (("landlord", "rent"), ("rent", "rent"), ("sewa", "rent"), ("hydro", "hydro"),
                          ("electric", "hydro"), ("phone", "phone"), ("mobile", "phone"), ("ubc", "tuition")):
            if word in low:
                return key
        return None

    @staticmethod
    def _refusal(note: str) -> str:
        if "extraction" in note:
            return ("I can't share that. I only ever see the last 4 digits of account numbers, and I don't share "
                    "internal instructions, confirmation codes or anyone else's information. If you need your full "
                    "account number for a form, it's in your bank's official app.")
        if "escalation" in note:
            return ("I can't do that from chat. Approvals, limits and roles come from each person's own login: "
                    "payments are confirmed by you in the app, sponsor approvals happen in your sponsor's app, and "
                    "only your sponsor can change limits.")
        if "scam" in note:
            return ("This has the hallmarks of a scam (pressure, threats or unusual payment methods), so I won't "
                    "set up that payment. If you're unsure, contact the organisation using contact details from its "
                    "official website.")
        return ("I noticed instructions in that message that try to change how I work, so I'm ignoring them. "
                "Payments can only be confirmed by you in the app. What would you like to do?")

    def _convert_then_rent(self, res, done):
        if "list_transactions" not in done:
            return _call("list_transactions", category="rent", days=60, limit=1)
        if "get_balances" not in done:
            return _call("get_balances", total_currency="CAD")
        rent = abs(res[0][1]["transactions"][0]["amount"]) if res[0][1]["transactions"] else 1150.0
        bal = next(a for a in res[1][1]["accounts"] if a["label"] == "CAD Everyday")["balance"]
        short = max(0.0, rent - bal)
        if short > 0 and "prepare_conversion" not in done:
            myr = round(short / 0.3236 / (1 - 0.006) + 5, 0)
            return _call("prepare_conversion", from_currency="MYR", to_currency="CAD", amount=myr)
        if "prepare_transfer" not in done:
            return _call("prepare_transfer", payee="rent", amount=rent)
        msgs = []
        for name, r in res:
            if name in ("prepare_conversion", "prepare_transfer") and "action" in r:
                msgs.append(r["action"]["summary"])
        pre = "" if short > 0 else "You already have enough CAD for rent, so no conversion is needed. "
        return _say(pre + "I've drafted: " + "; then ".join(msgs) +
                    ". Confirm them in that order in the app.")
