"""Deterministic offline planner.

Implements the same Provider interface as the LLM adapter, using intent rules.
Uses:
  * tests and CI run the full agent loop, tools and policy without a network
  * automatic fallback if the LLM API is unreachable (e.g. venue Wi-Fi in Shenzhen)
  * a baseline the LLM must beat on the scripted tasks

It is intentionally narrow. It refuses anything the safety check flagged, asks a short question when a payee
or amount is missing or odd, and never drafts a payment for a question. Parsing (amounts, currencies, payees,
dates) lives in offline_nlu.py.

Replies come in the language the user wrote in (English, Chinese or Malay; see i18n.py for detection and the
template table). Amounts, payee names and tool calls are the same in every language.

Multi-turn state: a reply may carry "_hb_state" (a pending question such as "which payee?", whether it drafted
something, or an offer such as "say X and I'll draft it"). The agent keeps that reply in the session history,
the next turn reads it back, and llm.to_wire drops the key, so a real model never sees it. It holds nothing
that can approve or confirm: drafts still need the Confirm tap in the app.
"""
from __future__ import annotations

import difflib
import json
import math
import re
import uuid
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from . import i18n
from .guard import quoted_segments
from .i18n import t
from .offline_nlu import (PAYEE_NAMES, amount_issue, currencies, first_amount, is_question, nice_date,
                          parse_amounts, parse_date, payee_keys, payment_clauses, relayed_message, short_date)


def _amount(text: str) -> Optional[float]:
    """First usable amount in the text (kept for callers of the old helper)."""
    return first_amount(text)


def _currencies(text: str) -> List[str]:
    return currencies(text)


# Chinese and Malay phrases mapped to the English intent words the planner matches on.
# Appended to the lowered text, so amounts and the original wording are kept.
INTENT_WORDS = [
    (r"余额|多少钱|还剩|还有多少|baki|duit saya", "balance"),
    (r"房租|租金|sewa", "rent landlord"),
    (r"房东|tuan rumah", "landlord"),
    (r"(交|付|缴)(房租|租金|学费|电费|话费|水电|钱|款)|支付(?!宝)|转账|转(?!换).{0,12}给|汇给|打钱给|付给|付(?=\s*\d)|"
     r"bayar", "pay"),
    (r"学费|yuran", "tuition"),
    (r"诈骗|骗局|骗子|是真的吗|是不是真的|scam ke|tipu", "scam"),
    (r"兑换|换成|换钱|tukar(?!an)", "convert"),
    (r"令吉|马币|ringgit", "myr"),
    (r"加币|加元|dolar kanada", "cad"),
    (r"最便宜|最划算|paling murah", "cheapest"),
    (r"信用", "credit"),
    (r"花了|开销|消费|belanja", "spent"),
    (r"预算|bajet", "budget"),
    # "ask" before "dad", so "问爸爸要500" and "minta ayah 500" read as "ask ... dad"
    (r"(问|向|跟|找).{0,6}要|minta", "ask"),
    (r"爸爸|父亲|ayah|bapa", "dad"),
    # Spending categories, so "我这个月交通花了多少？" answers for transport
    (r"交通|车费|公交|地铁", "transport"),
    (r"餐饮|吃饭|外卖|下馆子", "dining"),
    (r"买菜|杂货|超市", "groceries"),
    # "用马币钱包补上学费缺口" / "tampung kekurangan yuran": cover the tuition shortfall
    (r"补.{0,8}(缺口|差额)|\btampung\b", "cover the shortfall"),
    # Credit Builder
    (r"信用卡|kad kredit", "credit card"),
    (r"还(信用卡|卡|款)|还清", "pay"),
    (r"建立|积累|bina", "build"),
    (r"提高|提升|改善|naikkan|tingkatkan|baiki", "improve"),
    # Reminders, status, limits, income, rates
    (r"提醒|ingatkan", "remind"),
    (r"汇率|kadar tukaran", "exchange rate"),
    (r"待处理|待批准|批准了吗|审批", "pending"),
    (r"限额|额度", "limit"),
    (r"工资|收入|薪水|gaji", "income"),
    (r"订阅|langganan", "subscriptions"),
    (r"欠|hutang", "owe"),
    (r"买得起|负担得起|mampu", "afford"),
    (r"取消|撤销|batalkan", "cancel"),
]


def _normalize(text: str) -> str:
    low = text.lower()
    extra = [w for pat, w in INTENT_WORDS if re.search(pat, low)]
    return low + (" " + " ".join(extra) if extra else "")


def _call(tool_name: str, /, **args: Any) -> Dict[str, Any]:
    return {"role": "assistant", "content": None, "reasoning_content": None,
            "tool_calls": [{"id": "call_" + uuid.uuid4().hex[:8], "name": tool_name, "arguments": args}]}


def _say(text: str, state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {"role": "assistant", "content": text, "tool_calls": [], "reasoning_content": None}
    if state:
        out["_hb_state"] = state
    return out


def _money(v: float, cur: str) -> str:
    return f"{cur} {v:,.2f}"


def _result(res: List[Tuple[str, Dict[str, Any]]], name: str) -> Optional[Dict[str, Any]]:
    """The latest result of a tool in this turn."""
    return next((r for n, r in reversed(res) if n == name), None)


def _account(bal: Dict[str, Any], word: str) -> Optional[Dict[str, Any]]:
    return next((a for a in bal.get("accounts", []) if word.lower() in a["label"].lower()), None)


def _action_text(a: Dict[str, Any], lang: str = "en") -> str:
    what = i18n.summary(a["summary"], lang)
    if a.get("status") == "awaiting_sponsor":
        return t("sent_to_sponsor", lang, summary=what)
    s = t("drafted_it", lang, summary=what)
    if a.get("needs_sponsor_approval"):
        s += t("then_sponsor", lang)
    if a.get("warnings"):
        s += t("note", lang, text=("" if lang == "zh" else " ").join(i18n.warning(w, lang) for w in a["warnings"]))
    return s


# Cash-flow forecast intent, in English, Malay ("cukup" = enough) and Chinese ("够用" = enough to live on).
FORECAST_WORDS = (r"run(ning)? out of (money|cash|funds)|cash ?flow|forecast|runway|\bsurvive\b|"
                  r"\blast (me )?(until|till|til|through)\b|how long .{0,25}\blast\b|"
                  r"enough (money|cash|funds)? ?(until|till|to last|for the rest|to get through)|"
                  r"make it (to|until|till|through)\b|\bcukup\b|够用|够不够|撑到|撑得|现金流")

# Short confirmations after a draft: "yes confirm it", "ok go ahead", "approve it". Only the app's Confirm
# button (with the student's token) confirms anything, so these get a pointer to it, never an action.
_ACK = r"yes|yeah|yea|yep|yup|ya|ok|okay|k|sure|alright|right|correct|great|cool|fine|boleh|好|好的|可以|行|是的|对"
_CONFIRM_VERB = (r"confirm|approve|go ahead|proceed|do it|do that|send it|pay it|execute|make it happen|carry on|"
                 r"teruskan|sahkan|确认|批准|继续|执行")
CHATTER_RE = re.compile(
    rf"^(?:(?:{_ACK})[\s,.!，、。！]*)*(?:(?:please|pls|plz|just|now|then|can|you can)\s+)*(?P<verb>{_CONFIRM_VERB})?"
    r"(?:\s*(?:it|that|this|them|all|now|please|pls|lah|la|for me|already|then|the (?:payment|transfer|draft|"
    r"conversion)|吧|一下|啦|了|这笔|它))*[\s.!。！]*$")
ACCEPT_VERBS = (None, "do it", "do that", "go ahead", "proceed", "carry on", "pay it", "send it", "teruskan", "继续")
DRAFT_TOOLS = {"prepare_transfer", "prepare_conversion", "prepare_card_payment", "add_payee", "request_sponsor_topup"}

CANCEL_RE = r"\b(cancel|undo|revoke|scrap|batal(kan)?)\b|取消|撤销|撤回"
CANCEL_TARGET = (r"\b(draft|drafts|payment|payments|transfer|transfers|conversion|convert|request|top-?up|it|that|"
                 r"this|those|them|pending|last one|everything|all|bayaran|pembayaran)\b|这笔|那笔|付款|转账")
SUBSCRIPTION_RE = r"subscriptions?|membership|streambox|netflix|spotify|\blangganan\b|订阅"
REMIND_RE = r"\bremind(er|ers)?\b|\bset (an? )?(alert|alarm)\b|\bremind\b"
AFFORD_RE = r"\bafford\b"
PENDING_RE = (r"\bpending\b|waiting (for|on) (my )?(dad|sponsor|approval|me)|\bawaiting\b|approved yet|been approved|"
              r"\bis (it|my .{0,30}) approved\b|did (my )?(dad|father|sponsor|ayah|papa) approve|"
              r"what did (my )?(dad|father|sponsor) approve|status of (my )?|\bin progress\b")
LIMITS_RE = (r"\blimits?\b|why (does|do|did|must|should|would) (my )?(dad|father|sponsor|ayah|papa)|"
             r"needs? (my )?(dad|sponsor|father)('s)? (to )?approv|who('?s| is) my sponsor|\bmy sponsor\b\??$|"
             r"what (is|are|does) (a )?t[123]\b|\bt[123]\b.{0,12}mean|\btiers?\b|"
             r"(为什么|为啥).{0,10}(爸爸|父亲|担保人).{0,8}(批准|审批|同意)|(kenapa|mengapa).{0,30}(ayah|bapa|penaja)"
             r".{0,30}lulus|\bhad (bayaran|harian|saya)\b")
OWE_RE = r"\bowe\b|\bowing\b|\bdebts?\b"
INCOME_RE = (r"\b(get|got|been|getting) paid\b|\bpaid (this|last) week\b|\bearn(ed|ings|ing)?\b|\bincome\b|"
             r"\bsalary\b|\bpaycheque|\bpaycheck|\bpayday\b|\bwages?\b")
RATE_RE = (r"exchange rate|\bfx rate|\brate (today|now)\b|what('?s| is) the rate|today'?s rate|"
           r"how much is .{0,25}\d.{0,25}\b(in|to)\b|\d[\d,.]*\s*(cad|myr|rm|ringgit|usd)\b.{0,10}\b(in|into|to) "
           r"(cad|myr|rm|ringgit|usd|canadian)|berapa .{0,25}dalam")
REMIT_RE = (r"\b(send|sending|transfer|remit|wire)\b.{0,40}\b(dad|father|mum|mom|mother|parents?|family|home|"
            r"malaysia)\b|\b(dad|father|mum|mom|mother|parents?|family)\b.{0,40}\b(send|sending|transfer|remit)\b|"
            r"汇款|寄钱|kirim duit|hantar duit")
PARENT_RE = r"\b(dad|father|mum|mom|mother|parents?|family|ayah|bapa|ibu|papa)\b"
# "Did dad send the money?": where a remittance from the sponsor is (get_remittance_status). Checked on the raw
# text, before the remittance-quote and balance rules, which share words with it.
_DAD = r"(my )?(dad|father|papa|sponsor|parents?|mum|mom)"
REMIT_STATUS_RE = (
    rf"\b(did|has|have) {_DAD} (send|sent|transfer(red)?|wire[d]?|remit(ted)?)\b|"
    rf"\b(where('?s| is| are)|any sign of|status of) .{{0,20}}\bmoney from {_DAD}\b|"
    rf"\bmoney from {_DAD} .{{0,25}}\b(arrive[d]?|come in|land(ed)?|here|in yet|credited)\b|"
    r"\b(has|did|is) (the |my )?(money|transfer|remittance|top-?up)( from (my )?(dad|father|sponsor))? "
    r"(arrive[d]?|come in|land(ed)?|been credited|on (its|the) way|here|in)\b|"
    r"\b(remittance|top-?up) status\b|\bstatus of (my )?(remittance|top-?up)\b|"
    r"\b(duit|wang) (ayah|bapa|abah)\b.{0,12}\b(masuk|sampai|tiba)\b|\b(ayah|bapa|abah) (dah|sudah) "
    r"(hantar|kirim|transfer)\b|"
    r"(爸爸|父亲|爸)(的|汇的|转的|打的|寄的)?钱.{0,4}(到了|到账|到没|收到|来了)|(爸爸|父亲)(汇|转|打)钱了|汇款(到了|到账|状态|进度)")
# Currency words, for "convert 500 of it to MYR" (the one currency named is where the money goes).
_CUR_WORDS = r"myr|ringgit|rm|cad|canadian(?: dollars?)?|dolar kanada|usd|加币|加元|马币|令吉"
# "Convert all my ringgit": the whole balance of the wallet.
ALL_RE = (r"\b(all|everything|whole|entire|semua|seluruh)\b.{0,20}\b(ringgit|myr|rm|cad|wallet|money|duit|balance|baki)\b|"
          r"全部|所有的?(马币|加币|钱)")
# Privacy questions: someone else seeing her data, or where her data and chat go.
_PRIV_TARGET = (r"(data|transactions?|spend\w*|purchases?|messages?|chats?|accounts?|balances?|money|history|buy|"
                r"bought|wages?|salary|food)")
PRIVACY_WHO_RE = (
    r"\b(who|anyone|anybody|someone|(my )?(dad|father|sponsor|parents?|mum|mom|family)|homebridge|the bank)\b"
    r"(?! (send|sent|transfer))[^.?]{0,25}\b(see|sees|view|access|read|track|monitor|know)\b[^.?]{0,40}\b"
    + _PRIV_TARGET + r"\b|"
    r"(谁|爸爸|父亲|我爸|家长|担保人|别人).{0,8}(看到|看得到|看见|查看|知道).{0,10}(消费|开销|花销|记录|数据|聊天|余额|交易|账户)|"
    r"(siapa|ayah|bapa|penaja|ibu bapa).{0,25}(nampak|tengok|lihat|tahu|baca).{0,30}"
    r"(perbelanjaan|belanja|transaksi|data|mesej|chat|akaun|baki)")
PRIVACY_DATA_RE = (
    r"\b(my|our|the) (data|information|info|chats?|messages|conversations?|details)\b[^.]{0,30}\b(sent|send|go(es)?|"
    r"stored|shared|leave|leaves|processed|kept|safe|private)\b|\bprivacy\b|"
    r"\b(deepseek|qwen|china|chinese servers?)\b.{0,40}\b(data|chats?|see|read|servers?)\b|"
    r"\b(data|chats?)\b.{0,40}\b(china|deepseek|qwen)\b|"
    r"(数据|信息|聊天记录|聊天内容).{0,10}(发送|传到|存在|存到|发到|上传|去哪|给谁|出境|中国)|隐私|"
    r"data saya.{0,30}(hantar|dihantar|simpan|disimpan|china|cina)|privasi")
# Emergency lock, in any wording: "freeze my account", "冻结账户", "快帮我冻结账户", "锁定付款", "kunci akaun".
LOCK_RE = (r"\b(freeze|lock|block)\s+(my|all|everything|the account|payments)\b|"
           r"(?<!解)(冻结|锁定|锁住|锁上|锁)(一下)?(我的)?(账户|账号|钱包|付款|支付|银行卡|卡|钱)|"
           r"(账户|账号|付款|钱包).{0,4}(冻结|锁定|锁住)|(冻结|锁定|锁住)我的|\b(kunci|bekukan|sekat)\b.{0,10}\b(akaun|bayaran|pembayaran|dompet|kad)\b")
# "I've been scammed": lock first, explain after (the system prompt asks the live model for the same).
BEEN_SCAMMED_RE = (r"\bi (think |might have |may have )?(have |'ve |just )?(been|got|was|get) (scammed|conned|defrauded)\b|"
                   r"\bi'?ve been (scammed|conned|defrauded)\b|被骗|上当了|\bkena (tipu|scam|tipu daya)\b")
ACCOUNT_WORDS = {"everyday": r"everyday|chequing|checking|spending account|cad account|cad wallet",
                 "tuition": r"tuition fund|tuition account|tuition savings|dana yuran|学费账户",
                 "wallet": r"myr wallet|ringgit wallet|myr account|ringgit account|malaysian account|马币账户"}
MOVE_RE = (r"\b(move|put|transfer|shift|top ?up|add|deposit|send|convert|change|exchange|tukar|pindah(kan)?|masukkan)\b|"
           r"转到|存到|转入|存入|换到|换进")

# Suggestions for messages the planner does not understand: (example, keywords that point at it).
SUGGESTIONS: List[Tuple[str, List[str]]] = [
    ("how much money do I have?", ["balance", "balances", "money", "left", "total", "duit", "baki"]),
    ("where did my money go this month?", ["spend", "spent", "spending", "budget", "expenses", "food"]),
    ("pay rent", ["pay", "rent", "bill", "bills", "landlord", "hydro", "phone", "bayar"]),
    ("convert 1,000 MYR to CAD", ["convert", "change", "exchange", "ringgit", "myr", "cad", "tukar"]),
    ("cheapest way to send 3,000 MYR to CAD", ["cheapest", "cheap", "rate", "fee", "fees", "remit", "remittance"]),
    ("when is my next tuition due?", ["tuition", "fees", "school", "ubc", "semester", "installment"]),
    ("will I run out of money before tuition?", ["run", "last", "enough", "forecast", "survive"]),
    ("how's my credit?", ["credit", "card", "score", "utilization"]),
    ("ask my dad for 500 for textbooks", ["dad", "ask", "sponsor", "father", "request", "allowance"]),
    ("remind me to pay rent on the 1st", ["remind", "reminder", "alert"]),
    ("what's pending?", ["pending", "approved", "approval", "status", "waiting"]),
    ("is this a scam? <paste the message>", ["scam", "fake", "legit", "suspicious", "fraud"]),
]


def _forecast_horizon(low: str) -> Dict[str, Any]:
    if re.search(r"end of (the |this )?(term|semester|sem)\b|(hujung|akhir) sem|学期末|期末|this (term|semester)", low):
        return {"until": "end_of_term"}
    # English and Malay month names ("may" is left out: it usually reads as a verb)
    m = re.search(r"\b(january|januari|jan|february|februari|feb|march|mac|mar|april|apr|june|jun|july|julai|jul|"
                  r"august|ogos|aug|september|sept|sep|october|oktober|oct|november|nov|december|disember|dec)\b", low)
    if not m:
        return {}
    month = {"mac": "march", "ogos": "august", "oktober": "october", "disember": "december"}.get(m.group(1), m.group(1))
    return {"until": month}


def _forecast_pick(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The single most useful next step. With a spending dip: the cheapest fix for it (a spending cut when one is
    enough, else converting into Everyday), since a tuition gap is covered by the offer that ends the reply. With
    only a tuition gap: the conversion that covers it. Otherwise the buffer tip, if any."""
    tips = r["suggestions"]
    if r["first_shortfall_date"]:
        return (next((s for s in tips if s["kind"] == "cut_spending"), None)
                or next((s for s in tips if s["kind"] == "convert" and s["destination"] == "everyday"), None)
                or next((s for s in tips if s["kind"] == "ask_sponsor"), None))
    if any(g["gap"] > 0 for g in r["tuition"]):
        return next((s for s in tips if s["kind"] == "convert"), None)
    return next((s for s in tips if s["kind"] == "buffer"), None)


def _forecast_reply(r: Dict[str, Any], lang: str = "en") -> str:
    """Verdict, the single most useful next step, and the offer, in at most three sentences and in the user's
    language. The runway card under the reply shows the chart and every suggestion, so the reply doesn't repeat
    them. Each piece is rebuilt from the tool's fields (its suggestion text is English and longer)."""
    d = (lambda iso: short_date(iso)) if lang == "en" else (lambda iso: i18n.date(iso, lang))  # noqa: E731
    m = lambda v: _money(v, "CAD")  # noqa: E731
    stop = "。" if lang == "zh" else "."
    lo = r["lowest"]
    gaps = [g for g in r["tuition"] if g["gap"] > 0]
    short = r["first_shortfall_date"]
    acct = i18n.account(r["account"], lang)
    if short:
        msg = t("fc_short", lang, account=acct, date=d(short), lowest=m(lo["balance"]), low_date=d(lo["date"]))
    else:
        msg = t("fc_ok", lang, verdict=t("fc_mostly" if gaps else "fc_yes", lang), end=d(r["end_date"]),
                lowest=m(lo["balance"]), low_date=d(lo["date"]))
    if gaps:
        msg += t("fc_gap", lang, join=t("fc_and" if short else "fc_but", lang), gap=m(gaps[0]["gap"]),
                 term=i18n.term(gaps[0]["term"], lang), due=d(gaps[0]["due"])) + stop
    elif r["tuition"]:
        msg += t("fc_covered", lang, due=d(r["tuition"][0]["due"]))
    else:
        msg += stop
    s = _forecast_pick(r)
    if s and s["kind"] == "convert":
        why = (t("fc_why_gap", lang, gap=f"{s['receive_cad']:,.2f}") if s["destination"] == "tuition"
               else t("fc_why_zero", lang))
        msg += t("fc_tip_convert", lang, myr=f"{s['amount']:,.0f}", by=d(s["by_date"]), why=why,
                 dest=i18n.account("Tuition Fund" if s["destination"] == "tuition" else "CAD Everyday", lang),
                 provider=i18n.provider(s["provider"], lang), pct=s["true_cost_pct"])
    elif s and s["kind"] == "cut_spending":
        msg += t("fc_tip_cut_dining" if s["category"] == "dining" else "fc_tip_cut_all", lang,
                 n=math.ceil(s["weekly_cut_cad"]))
    elif s and s["kind"] == "ask_sponsor":
        msg += t("fc_tip_ask", lang, date=d(short))
    elif s and s["kind"] == "buffer":
        msg += t("fc_tip_buffer", lang)
    if gaps:
        msg += t("fc_end_offer", lang, offer=i18n.offer("cover the tuition shortfall from my MYR wallet", lang))
    elif s and s["kind"] == "convert":
        msg += t("fc_end_ask", lang)
    else:
        msg += t("fc_end", lang)
    return msg


class OfflineEngine:
    name = "offline"
    _lang = "en"

    def _t(self, key: str, **kw: Any) -> str:
        """A reply template in the language of this turn."""
        return t(key, self._lang, **kw)

    def _act(self, a: Dict[str, Any]) -> str:
        return _action_text(a, self._lang)

    def _forecast(self, r: Dict[str, Any]) -> str:
        return _forecast_reply(r, self._lang)

    # ------------------------------------------------------------------ main
    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]:
        idx = max(i for i, m in enumerate(messages) if m["role"] == "user")
        text = messages[idx]["content"]
        low = _normalize(text)
        note = " ".join(m["content"] for m in messages[idx + 1:] if m["role"] == "system")
        fm = re.search(r"Safety check flags: ([a-z, ]+)\.", note)
        note = fm.group(1) if fm else ""
        results: List[Tuple[str, Dict[str, Any]]] = []
        for m in messages[idx + 1:]:
            if m["role"] == "tool":
                body = json.loads(m["content"])
                results.append((body["tool"], body["untrusted_data"]))
        prev_user = [m["content"] for m in messages[:idx] if m["role"] == "user"]
        # What the previous reply left open (a question, an offer), read back from the session history.
        prev = next((m for m in reversed(messages[:idx]) if m["role"] == "assistant"), None)
        state = dict((prev or {}).get("_hb_state") or {})
        system = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
        dm = re.search(r"Today is (\d{4}-\d{2}-\d{2})", system)
        nm = re.search(r"You are helping (.+?) \(role", system)
        self._today = date.fromisoformat(dm.group(1)) if dm else date.today()
        self._name = nm.group(1).split()[0] if nm else ""
        # Reply in the user's language; "300" or "ok" keeps the language of the conversation.
        self._lang = i18n.conversation_lang(text, prev_user)
        out = self._plan(text, low, note, results, prev_user, state)
        if not out.get("tool_calls") and any(n in DRAFT_TOOLS and "action" in r for n, r in results):
            out.setdefault("_hb_state", {})["drafted"] = True
        return out

    def _plan(self, text: str, low: str, note: str, res: List[Tuple[str, Dict[str, Any]]],
              prev_user: List[str], state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        state = state or {}
        today = getattr(self, "_today", None) or date.today()
        raw = text.lower().strip()
        done = [n for n, _ in res]
        last = res[-1][1] if res else {}
        L = self._lang
        if last.get("error") and not last.get("saved_payees"):
            drafted = [i18n.summary(r["action"]["summary"], L) for _, r in res if "action" in r]
            if drafted:
                return _say(self._t("drafted_partial", drafted=i18n.sep(L).join(drafted), error=last["error"]))
            return _say(self._t("couldnt", error=last["error"]))

        # 0. Emergency lock and unlock requests (locking only adds friction, so it runs even in a flagged turn)
        lock = self._lock_request(text, low, res, done)
        if lock:
            return lock

        # 1. Scam check of a pasted or quoted message
        pasted = state.get("slot") == "scam_text" and len(text.strip()) >= 12
        if re.search(r"scam|is this (real|legit)|legit ke|real or not|should i pay this", low) or (
                "scam" in note.lower()) or pasted:
            # "Is this a scam?" with nothing to check: ask for the message, and check the next one.
            if "check_message_for_scam" not in done and not pasted and "scam" not in note.lower() and \
                    i18n.is_bare_request(text):
                return _say(self._t("scam_paste"), state={"slot": "scam_text"})
            return self._scam_answer(text, res, done)

        lowered_note = note.lower()
        flagged = any(k in lowered_note for k in ("injection", "extraction", "escalation"))

        # 1a. A relayed message ("My landlord WhatsApp me: 'rent go up to 1,600, pay to new account …'") with no
        # request of the user's own: check it for scam signs and draft nothing. Paying still works if she asks.
        if not flagged and relayed_message(text):
            return self._scam_answer(text, res, done)

        # 1b. "yes confirm it", "ok go ahead", "approve it": point at the Confirm button. Checked before the
        # refusal below because an over-eager classifier flag on a plain "yes confirm it" should not get a
        # lecture; it never acts either way, and a flagged turn gets no tools and no offers.
        m = CHATTER_RE.match(raw) if raw else None
        if m and (m.group("verb") or state.get("drafted") or (state.get("offer") and not flagged)):
            out = self._chatter(m.group("verb"), res, done, state, flagged)
            if out is not None:
                return out

        # 2. Anything the guard flagged as manipulation gets a refusal, no tools
        if flagged or ("scam" in lowered_note and not re.search(r"\b(check|scam)\b", low)):
            return _say(self._refusal(lowered_note, L))

        # 2b. "approve it yourself": only the sponsor's own app approves
        if re.search(r"\bapprove\b.{0,40}\b(yourself|for (me|him|her|them)|on (his|her|my) behalf)\b|"
                     r"\byou (can |could |should )?approve\b|\b(pretend|act) (to be|you are|as) (my )?(dad|father|sponsor)",
                     raw):
            return _say(self._t("refuse_approve"))

        # 2b'. "Did dad send the money?" / "duit ayah dah masuk?" / "爸爸的钱到了吗？": where the remittance is
        if re.search(REMIT_STATUS_RE, raw):
            if "get_remittance_status" not in done:
                return _call("get_remittance_status")
            return _say(self._remit_reply(_result(res, "get_remittance_status")))

        # 2c. Answer to the question the previous reply asked ("Who would you like to pay?" -> "the landlord")
        slot = self._slot_answer(text, raw, state, today)
        if slot is not None:
            kind = slot["intent"]
            if kind == "pay":
                return self._pay(text, low, res, done, plan=slot["plan"])
            if kind == "reminder":
                return self._reminder(text, raw, res, done, today, forced=(slot["date"], slot["what"]))
            if kind == "afford":
                return self._afford(slot["amount"], slot.get("item", ""), res, done)
            if kind == "ask":
                return _say(slot["text"], state=state)

        # 3. Change of mind: "actually make it 400"
        if re.search(r"\b(actually|instead|make it|change it to|tukar jadi|ubah jadi)\b|改成|改为", low) and \
                _amount(text) and prev_user:
            return self._amend(text, res, done)

        # 3b. Cancel a draft, but only when the text points at one; merchants' subscriptions are not ours to cancel
        if re.search(CANCEL_RE, low) or re.search(r"\brefund\b", raw):
            return self._cancel(raw, res, done, state)

        # 3c. Reminders come before payments: "set a reminder to pay rent on the 1st" is not a payment
        if re.search(REMIND_RE, low):
            return self._reminder(text, raw, res, done, today)

        # 3d. Cash-flow forecast: "will I run out of money before tuition?" (advice only, drafts nothing)
        if re.search(FORECAST_WORDS, low) and not re.search(r"\b(pay|convert|transfer|send|bayar|tukar)\b", low):
            if "forecast_cashflow" not in done:
                return _call("forecast_cashflow", **_forecast_horizon(low))
            return _say(self._forecast(last), state=self._forecast_state(last))

        # 3e. "Can I afford a $1,200 laptop?" and "how should I fund it?" (advice only)
        if re.search(AFFORD_RE, low):
            amt = _amount(text)
            if amt is None:
                return _say(self._t("ask_afford"), state={"slot": "afford_amount", "item": self._afford_item(raw)})
            return self._afford(amt, self._afford_item(raw), res, done)
        if re.search(r"how (should|do|can|would) i (fund|cover|pay for|afford)|\bfund (it|this|that)\b", raw):
            if "forecast_cashflow" not in done:
                nxt = date(today.year + (today.month == 12), today.month % 12 + 1, 1)
                return _call("forecast_cashflow", until=nxt.strftime("%B").lower())
            return _say(self._forecast(last),
                        state=self._forecast_state(last))

        # 4. Multi-step: convert enough then pay rent
        if re.search(r"convert enough|enough .* (to|for) (cover|pay)", low) and "rent" in low:
            return self._convert_then_rent(res, done)

        # 5. Sponsor top-up request
        m = re.search(r"\b(ask|request).{0,20}(dad|father|mum|mom|parent|sponsor|ayah|papa)", low)
        if m:
            issue = amount_issue(text, L)
            if issue:
                return _say(issue)
            amt = _amount(text)
            if amt is None:
                return _say(self._t("ask_topup"), state={"slot": "topup_amount"})
            if "request_sponsor_topup" not in done:
                reason = re.sub(r".*\bfor\b", "", text, count=1).strip() if " for " in low else "student expenses"
                why = re.search(r"(买|交|付|用来|用于|为了).+|\buntuk\b.+", text)   # "…要500买课本", "… untuk buku"
                if " for " not in low and why:
                    reason = re.sub(r"^untuk\s+", "", why.group(0)).strip(" 。.!！")
                cur = "MYR" if "MYR" in _currencies(text) else "CAD"
                return _call("request_sponsor_topup", amount=amt, currency=cur, reason=reason[:80] or "student expenses")
            acct = (last["action"].get("remittance") or {}).get("to_account") or "CAD Everyday"
            return _say(self._act(last["action"]) + self._t("topup_sent", account=i18n.account(acct, L)))

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

        # 6b. New payee: always goes to the sponsor, then a cooling period
        if re.search(r"\b(add|new|save)\b.{0,12}\bpayee\b", low):
            if "add_payee" not in done:
                return self._add_payee(text, low)
            a = last["action"]
            return _say(f"I've drafted a request to add {a['summary'].replace('Add new payee ', '')}. New payees always "
                        "need your sponsor's approval, and then there's a short cooling period before the first "
                        "payment. That pause is what stops most 'urgent new account' scams. Confirm it in the app "
                        "to send it to your dad." + (" I can't pay them until then." if re.search(r"pay", low)
                                                     else ""))

        # 6c. Questions answered from the data, before anything that could draft: status, limits, money owed,
        # income, subscriptions, rent, exchange rates, saved payee details, greetings and out-of-scope topics.
        info = self._info(text, raw, low, res, done)
        if info is not None:
            return info

        # 6d. Credit Builder: profile, building advice, paying the secured card
        if re.search(r"\bcredit\b|secured card|credit score|\bkredit\b", low) or (
                re.search(r"\b(pay|bayar|payment|due|late|statement|bill)\b", low) and
                re.search(r"\b(my|the) card\b|\bcard (payment|bill|statement)\b", low)):
            if not re.search(r"gift ?cards?|compass card", low):
                return self._credit(text, low, res, done)

        # 6e. Moving money between the user's own accounts: "put 500 into my tuition fund"
        move = self._move_request(raw, low)
        if move is not None:
            return self._move(text, move, res, done)

        # 7a. Cover a tuition shortfall from the MYR wallet (and optionally pay it)
        if re.search(r"tuition|yuran", low) and not is_question(text) and re.search(
                r"(cover|top ?up|fill)\s+(up\s+)?(the |my )?(tuition )?(shortfall|gap|fund)", low):
            return self._cover_tuition(low, res, done)

        # 7. Pay tuition (a question about paying tuition is answered, never drafted)
        question = is_question(text)
        if re.search(r"\bpay\b", low) and re.search(r"tuition|school fees|yuran", low) and not question:
            if re.search(r"\bfrom (my |the )?(cad )?(everyday|chequing|checking|spending)\b", raw):
                return self._pay(text, low, res, done)   # paid from the account she named, not the Tuition Fund
            if re.search(r"from (my |the )?(myr|ringgit|rm|malaysian|wallet)|马币|令吉", raw):
                return self._cover_tuition(low, res, done, pay=True, lead=self._t("cover_lead_myr"))
            if "get_tuition_schedule" not in done:
                return _call("get_tuition_schedule")
            if "prepare_transfer" not in done:
                nxt = res[0][1]["installments"][0]
                return _call("prepare_transfer", payee="UBC Student Financial Services", amount=nxt["amount"],
                             memo=nxt["term"])
            r = last
            sched = res[0][1]
            act = dict(r["action"])
            if sched["next_shortfall_cad"] > 0:  # the heads-up below says it better than the generic warning
                act["warnings"] = [w for w in act.get("warnings", []) if "lower than this amount" not in w]
            msg = self._act(act)
            if sched["next_shortfall_cad"] > 0:
                offer = "cover the tuition shortfall from my MYR wallet"
                msg += self._t("tuition_heads_up", short=_money(sched["next_shortfall_cad"], "CAD"),
                               offer=i18n.offer(offer, L))
                return _say(msg, state={"offer": offer})
            return _say(msg)

        # 8. Tuition questions / planning
        if re.search(r"tuition|yuran", low):
            return self._tuition_info(text, raw, low, res, done)

        # 9. Conversion (execute) vs comparison
        curs = _currencies(text)
        amt = _amount(text)
        fee_q = re.search(r"\bhow much (is the |are the )?(fees?|charges?|cost)\b|\bfees?\b.{0,30}\b(send|sending|transfer|"
                          r"convert|remit|change)\b|\b(send|sending|transfer|convert|remit)\b.{0,30}\b(fees?|charges?)\b|"
                          r"手续费|yuran (pindahan|tukaran)|caj", low)
        if re.search(r"\b(convert|change|tukar|exchange)\b", low) and curs and (
                amt or amount_issue(text) or re.search(ALL_RE, low)) and \
                not re.search(r"cheapest|cheaper|best way|compare|which", low) and not question and not fee_q:
            return self._convert(text, curs, res, done)

        if re.search(r"cheapest|cheaper|best way|compare|which .*(service|provider)|lowest fee", low) or \
                re.search(REMIT_RE, low) or (fee_q and (curs or amt)):
            return self._fx_compare(text, raw, low, curs, amt, res, done)

        if re.search(r"good time|right time|should i (convert|change)|rate (going|trend)|wait", low):
            src = curs[0] if curs else "MYR"
            dst = curs[1] if len(curs) > 1 else ("CAD" if src == "MYR" else "MYR")
            if "get_fx_history" not in done:
                return _call("get_fx_history", from_currency=src, to_currency=dst)
            h = last
            return _say(self._t("fx_history", days=h["days"], pair=h["pair"], low=h["low"], high=h["high"],
                                today=h["today"], avg=h["average"]))

        # 9b. Someone else urgently asking for money through the student ("Mom says the emergency needs 1400 to X
        # immediately"): a classic impersonation pattern. Explain and draft nothing; a direct request still works.
        m = re.search(r"\b(mom|mum|dad|father|mother|brother|sister|friend|someone|caller|landlord|uncle|aunt|cousin|"
                      r"he|she|they)\b.{0,20}\b(says?|said|told|asked|wants?|needs?|texted|messaged|called)\b", raw)
        if m and _amount(text) and re.search(r"\b(emergency|urgent(ly)?|immediately|right now|asap|tonight)\b", raw):
            keys = payee_keys(raw)
            cmd = f" If you've checked and still want to pay, say 'pay {keys[0]} {_amount(text):g}'." if keys else ""
            return _say(self._t("relay_scam", who=m.group(1), cmd=cmd if L == "en" else ""))

        # 10. Pay someone
        if re.search(r"\b(pay|send|transfer|bayar|e-?transfer)\b", low):
            return self._pay(text, low, res, done)

        # 11. Budget, balances, transactions, credit, payees
        m = re.search(r"(?:set|make).{0,10}?(\w+) budget.{0,10}?(\d[\d,]*)", low) or re.search(
            r"budget (?:for|of) (\w+).{0,10}?(\d[\d,]*)", low)
        if m:
            if "set_budget" not in done:
                return _call("set_budget", category=m.group(1), monthly_amount=float(m.group(2).replace(",", "")))
            return _say(self._t("budget_set", category=i18n.category(last["category"], L),
                                amount=f"{last['monthly']:,.0f}"))

        if re.search(r"spend|spent|where did my money|where .{0,12}money go|budget|too much on|overspend|habis|"
                     r"cut (my )?(costs|spending|back)|save money|saving money|spend less|lost my job|jimat|省钱", low):
            if "budget_summary" not in done:
                return _call("budget_summary")
            return _say(self._spending_reply(low, last))

        if re.search(r"payees?\b|who can i pay", low):
            if "list_payees" not in done:
                return _call("list_payees")
            return _say(self._t("payees_list", list=i18n.comma(L).join(
                f"{p['name']} ({p['number']})" for p in last["payees"])))

        if re.search(r"transactions?|history|statement", low):
            if "list_transactions" not in done:
                return _call("list_transactions", limit=10)
            rows = last["transactions"][:8]   # the transactions card lists them
            if not rows:
                return _say(self._t("tx_list", n=0, latest="-"))
            x = rows[0]
            on = {"en": "on", "zh": "，", "ms": "pada"}[L]
            return _say(self._t("tx_list", n=len(rows), latest=f"{x['counterparty']} {x['currency']} {x['amount']:,.2f} "
                                f"{on} {i18n.date(x['date'], L)}"))

        if re.search(r"balance|how much (money )?(do i have|left|i have)|baki|berapa|duit|broke|net worth|"
                     r"how much .{0,15}\bin (my|the) .{0,20}(account|wallet|fund)", low):
            cur = "MYR" if re.search(r"ringgit|myr|\brm\b|baki|berapa", low) else "CAD"
            if "get_balances" not in done:
                return _call("get_balances", total_currency=cur)
            b = last   # the balances card lists every account; the reply gives the spending money and the total
            main = _account(b, "Everyday") or b["accounts"][0]
            return _say(self._t("balances", account=i18n.account(main["label"], L),
                                main=_money(main["balance"], main["currency"]),
                                total=_money(b["total"], b["total_currency"])))

        if re.search(r"^(thanks|thank you|thx|ty|terima kasih|谢谢)\b", low):
            return _say(self._t("welcome"))
        if CHATTER_RE.match(raw or "x"):
            return _say(self._t("okay_else"))

        return self._fallback(raw)

    # ---------------------------------------------------------------- amend
    def _amend(self, text: str, res, done) -> Dict[str, Any]:
        """'Actually make it 2500': cancel the latest draft waiting for her (a payment or a conversion) and draft
        it again with the new amount, through the same tools and tiers. Nothing else changes."""
        amt = _amount(text)
        if "get_pending_actions" not in done:
            return _call("get_pending_actions")
        if "cancel_pending_action" not in done:
            acts = [a for a in _result(res, "get_pending_actions")["actions"]
                    if a["status"] == "awaiting_user" and a["kind"] in ("transfer", "conversion")]
            if not acts:
                return _say(self._t("amend_nothing"))
            return _call("cancel_pending_action", action_id=acts[-1]["action_id"])
        old = _result(res, "cancel_pending_action")["action"]
        if old["kind"] == "transfer":
            if "prepare_transfer" not in done:
                m = re.search(r"to (.+?) from", old["summary"])
                return _call("prepare_transfer", payee=m.group(1) if m else "", amount=amt)
            new = _result(res, "prepare_transfer")
        else:
            if "prepare_conversion" not in done:
                return _call("prepare_conversion", amount=amt, **_conversion_args(old["summary"]))
            new = _result(res, "prepare_conversion")
        return _say(self._t("amend_done", old=i18n.summary(old["summary"], self._lang)) + self._act(new["action"]))

    # ------------------------------------------------------------- scam check
    def _scam_answer(self, text: str, res, done) -> Dict[str, Any]:
        """check_message_for_scam on the message, the verdict with its warning signs, and for a relayed message
        that names a saved payee, that payee's saved account (bank details never change from chat)."""
        L = self._lang
        if "check_message_for_scam" not in done:
            return _call("check_message_for_scam", text=text)
        relayed = relayed_message(text)
        keys = payee_keys(text.lower()) if relayed else []
        if keys and "list_payees" not in done:
            return _call("list_payees")
        r = _result(res, "check_message_for_scam")
        if r["verdict"] == "no_known_pattern":
            msg = self._t("scam_none")
        else:
            lead = self._t("scam_likely" if r["verdict"] == "likely_scam" else "scam_suspicious")
            if L == "en":
                why = f" {r['explanation']}" if r.get("explanation") else ""
            else:
                names = [i18n.signal(s["name"], L) for s in r.get("signals", [])[:3]]
                q = (f"（“{r['quote']}”）" if L == "zh" else f' ("{r["quote"]}")') if r.get("quote") else ""
                why = self._t("scam_why", signals=i18n.sep(L).join(names), quote=q) if names else ""
            msg = self._t("scam_verdict", lead=lead, why=why)
        if keys:
            p = next((x for x in _result(res, "list_payees")["payees"] if x["name"] == PAYEE_NAMES[keys[0]]), None)
            if p:
                msg += self._t("relay_saved", name=p["name"], last4=p["number"][-4:])
        if relayed and r["verdict"] == "no_known_pattern":
            msg += self._t("relay_none")
        return _say(msg)

    # ------------------------------------------------------- confirmations
    def _chatter(self, verb: Optional[str], res, done, state, flagged: bool) -> Optional[Dict[str, Any]]:
        offer = state.get("offer")
        L = self._lang
        if flagged:
            return _say(self._t("chatter_flagged"))
        if offer and not state.get("drafted") and verb in ACCEPT_VERBS:
            # Accepting what the previous reply offered ("say X and I'll draft it"): plan X as if typed.
            # Whatever it drafts still waits for the Confirm tap.
            return self._plan(offer, _normalize(offer), "", res, [], {})
        if not verb and not state.get("drafted"):
            return None
        if "get_pending_actions" not in done:
            return _call("get_pending_actions")
        acts = _result(res, "get_pending_actions")["actions"]
        mine = [a for a in acts if a["status"] == "awaiting_user"]
        dad = [a for a in acts if a["status"] == "awaiting_sponsor"]
        if mine:
            what = (i18n.summary(mine[-1]["summary"], L) if len(mine) == 1 else
                    self._t("chatter_n_waiting", n=len(mine)))
            msg = self._t("chatter_mine", what=what)
            if any(a["needs_sponsor_approval"] for a in mine):
                msg += self._t("chatter_then_dad")
        elif dad:
            msg = self._t("chatter_dad", what=i18n.summary(dad[-1]["summary"], L))
        else:
            msg = self._t("chatter_none")
        if offer:
            msg += self._t("chatter_offer", offer=i18n.offer(offer, L))
        return _say(msg)

    # ------------------------------------------------------------ slots
    def _slot_answer(self, text: str, raw: str, state: Dict[str, Any], today: date) -> Optional[Dict[str, Any]]:
        slot = state.get("slot")
        if not slot or len(raw.split()) > 8 or re.search(r"\b(cancel|balance|convert|scam|budget|remind)\b", raw):
            return None
        if slot == "payee":
            keys = payee_keys(raw)
            if len(keys) == 1:
                amt = first_amount(text) or state.get("amount")
                return {"intent": "pay", "plan": [(keys[0], amt)]}
        elif slot == "amount":
            issue = amount_issue(text, self._lang)
            if issue:
                return {"intent": "ask", "text": issue}
            amt = first_amount(text)
            keys = payee_keys(raw)
            if amt is not None and (not keys or keys == [state["payee"]]) and len(raw.split()) <= 6:
                return {"intent": "pay", "plan": [(state["payee"], amt)]}
        elif slot == "reminder_date":
            d = parse_date(raw, today)
            if d:
                return {"intent": "reminder", "date": d[0], "what": state.get("what") or "Reminder"}
        elif slot == "afford_amount":
            amt = first_amount(text)
            if amt is not None:
                return {"intent": "afford", "amount": amt, "item": state.get("item", "")}
        elif slot == "topup_amount":
            amt = first_amount(text)
            if amt is not None and len(raw.split()) <= 3:
                return {"intent": "ask", "text": self._t("ask_topup_reason", amount=f"{amt:g}")}
        return None

    # ---------------------------------------------------------------- pay
    def _pay(self, text: str, low: str, res, done, plan: Optional[List[Tuple[Optional[str], Optional[float]]]] = None
             ) -> Dict[str, Any]:
        raw = text.lower()
        L = self._lang
        info_only = False
        if plan is None:
            clauses = payment_clauses(raw) or [(None, None, None)]
            keyed = [k for k, _, _ in clauses if k]
            issue = amount_issue(text, L)
            if issue:
                st = {"slot": "amount", "payee": keyed[0]} if len(set(keyed)) == 1 else None
                return _say(issue, state=st)
            if len(clauses) > 4:
                return _say(self._t("too_many"))
            plan = [(k, a) for k, a, _ in clauses]
            info_only = is_question(text)
            if not keyed and re.search(PARENT_RE, raw):
                return self._fx_compare(text, raw, low, _currencies(text), _amount(text), res, done)
            if not keyed and re.search(r"\b(job|offer|employer|recruiter|hiring|internship)\b", raw) and \
                    re.search(r"\b(fee|deposit|upfront|equipment|training)\b", raw):
                return self._job_fee(text, res, done)

        # Who?
        if any(k is None for k, _ in plan):
            if len(plan) > 1:
                return _say(self._t("ask_which_each"))
            amt = plan[0][1]
            person = re.search(r"\b(?:to|my friend|friend|pay)\s+([A-Z][a-z]{1,20})\b", text)
            if person and person.group(1).lower() not in ("my", "the", "rent", "hydro", "ubc", "cad", "myr", "rm"):
                return _say(self._t("not_a_payee", name=person.group(1)))
            if "list_payees" not in done:
                return _call("list_payees")
            names = [p["name"] for p in _result(res, "list_payees")["payees"]
                     if p.get("status") == "active" and "Card" not in p["name"]]
            lead = self._t("ask_who_amount", amount=_money(amt, "CAD")) if amt else self._t("ask_who")
            return _say(self._t("ask_who_payees", lead=lead, names=i18n.and_list(names, L)),
                        state={"slot": "payee", "amount": amt})

        if re.search(r"from (my |the )?(myr|ringgit|rm|malaysian)( wallet| account)?\b|马币账户", raw):
            return _say(self._t("from_myr_wallet", payee=PAYEE_NAMES[plan[0][0]]))
        # Saved payees are paid in CAD: "pay hydro 50 USD" is asked about, never silently sent as CAD 50
        foreign = next((a for a in parse_amounts(text) if a.currency in ("USD", "MYR") and not a.issue), None)
        if foreign and len(plan) == 1:
            k = plan[0][0]
            cmd = f"pay {k} {foreign.value:g}"
            return _say(self._t("pay_in_cad", payee=PAYEE_NAMES[k], cur=foreign.currency,
                                amount=f"{foreign.value:,.2f}", cmd=cmd,
                                extra=self._t("no_usd_note") if foreign.currency == "USD" else ""),
                        state={"offer": cmd})
        # "from my everyday account" / "from my tuition fund": the account she named, not the default
        named = re.search(r"\bfrom (my |the )?(cad )?(everyday|chequing|checking|spending)\b|\bdari (akaun )?everyday\b|"
                          r"从(我的)?日常", raw)
        named_fund = re.search(r"\bfrom (my |the )?(cad )?tuition (fund|account|savings)\b|\bdari dana yuran\b|从(我的)?学费(基金|账户)",
                               raw)

        # How much? Last month's rent only when the text says rent; anything else is asked.
        says_rent = bool(re.search(r"\brent\b|\bsewa\b|房租|租金", raw))
        rent_row = None
        if any(k == "rent" and a is None for k, a in plan) and says_rent:
            if "list_transactions" not in done:
                return _call("list_transactions", category="rent", days=60, limit=1)
            rows = _result(res, "list_transactions")["transactions"]
            if rows:
                rent_row = rows[0]
                plan = [(k, abs(rent_row["amount"]) if k == "rent" and a is None else a) for k, a in plan]
        missing = [k for k, a in plan if a is None]
        if missing:
            k = missing[0]
            if k == "tuition" and len(plan) == 1:
                return self._tuition_info(text, raw, low, res, done)
            if len(plan) > 1:
                q = self._t("ask_how_much_each", payee=PAYEE_NAMES[k], key=k)
            else:
                q = self._t("ask_how_much_to", payee=PAYEE_NAMES[k],
                            hint=self._t("rent_hint") if k == "rent" else "")
            return _say(q, state={"slot": "amount", "payee": k} if len(plan) == 1 else None)

        # Is there enough money? A payment that would fail gets a plan instead of a doomed draft.
        if "get_balances" not in done:
            return _call("get_balances", total_currency="CAD")
        bal = _result(res, "get_balances")
        everyday = _account(bal, "Everyday")
        fund = _account(bal, "Tuition")
        stated = everyday if named else fund if named_fund else None
        source = lambda k: stated or (fund if k == "tuition" else everyday)  # noqa: E731
        need_everyday = sum(a for k, a in plan if source(k) is everyday)
        src_note = ""
        if rent_row:
            src_note = self._t("rent_was", amount=_money(abs(rent_row["amount"]), rent_row["currency"]),
                               payee=rent_row["counterparty"], date=i18n.date(rent_row["date"], L))
        if everyday and need_everyday > everyday["balance"] + 1e-9:
            return self._shortfall(plan, everyday, need_everyday, src_note, res, done)

        if info_only:
            k, a = plan[0]
            have = source(k)
            lead = (src_note + ("。" if L == "zh" else ". ")) if src_note else ""
            cmd = f"pay {k} {a:g}"
            return _say(self._t("can_pay_offer", lead=lead, account=i18n.account(have["label"], L),
                                balance=_money(have["balance"], "CAD"), amount=_money(a, "CAD"),
                                payee=PAYEE_NAMES[k], cmd=cmd),
                        state={"offer": cmd})

        n = done.count("prepare_transfer")
        if n < len(plan):
            k, a = plan[n]
            if stated:
                return _call("prepare_transfer", payee=k, amount=a, from_account_id=stated["id"])
            return _call("prepare_transfer", payee=k, amount=a)
        acts = [r["action"] for nm, r in res if nm == "prepare_transfer" and "action" in r]
        if len(acts) == 1:
            msg = self._act(acts[0])
            if src_note and re.search(r"how much|can (i )?pay|or not|enough|boleh|可以|能不能", raw):
                return _say(self._t("rent_can_pay", note=src_note, balance=_money(everyday["balance"], "CAD"),
                                    account=i18n.account(everyday["label"], L), msg=msg))
            if src_note:
                return _say(self._t("rent_used", note=src_note, msg=msg))
            if re.search(r"or not|boleh|can (i )?pay|enough", raw) and everyday:
                return _say(self._t("yes_you_have", balance=_money(everyday["balance"], "CAD"),
                                    account=i18n.account(everyday["label"], L), msg=msg))
            return _say(msg)
        msg = self._t("drafted_n", n=len(acts), list=i18n.sep(L).join(i18n.summary(a["summary"], L) for a in acts))
        if src_note:
            msg = self._t("rent_used_multi", note=src_note, msg=msg)
        sponsor = [a for a in acts if a.get("needs_sponsor_approval")]
        if sponsor:
            msg += self._t("multi_sponsor_last" if sponsor == acts[-1:] else "multi_sponsor_some")
        warns = list(dict.fromkeys(w for a in acts for w in a.get("warnings", [])))
        if warns:
            msg += self._t("note", text=("" if L == "zh" else " ").join(i18n.warning(w, L) for w in warns))
        return _say(msg)

    def _shortfall(self, plan, everyday, need: float, src_note: str, res, done) -> Dict[str, Any]:
        L = self._lang
        short = round(need - everyday["balance"], 2)
        if "get_fx_quotes" not in done:
            return _call("get_fx_quotes", from_currency="MYR", to_currency="CAD", amount=1000, own_wallet=True)
        rate = next(q for q in _result(res, "get_fx_quotes")["quotes"] if q["provider_key"] == "inapp")["rate"]
        myr = math.ceil(short / rate / 10) * 10
        wallet = _account(_result(res, "get_balances"), "Wallet")
        what = (self._t("shortfall_one", amount=_money(plan[0][1], "CAD"), payee=PAYEE_NAMES[plan[0][0]])
                if len(plan) == 1 else self._t("shortfall_many", n=len(plan), total=_money(need, "CAD")))
        msg = self._t("shortfall", note=(src_note + ("。" if L == "zh" else ". ")) if src_note else "",
                      account=i18n.account(everyday["label"], L), balance=_money(everyday["balance"], "CAD"),
                      what=what, short=_money(short, "CAD"))
        ask = self._t("ask_dad_cmd", n=math.ceil(short))
        if wallet and wallet["balance"] >= myr:
            convert = f"convert {myr} MYR to CAD"
            msg += self._t("shortfall_convert", myr=f"{myr:,}", convert=i18n.offer(convert, L), ask=ask,
                           big=self._t("shortfall_big") if short > 1500 else "")
            return _say(msg, state={"offer": convert})
        msg += self._t("shortfall_ask", ask=ask)
        return _say(msg)

    # ------------------------------------------------------------- cancel
    def _cancel(self, raw: str, res, done, state) -> Dict[str, Any]:
        if re.search(SUBSCRIPTION_RE, raw):
            return self._subscriptions(res, done, cancel=True)
        if re.search(r"\brefund\b", raw) and not re.search(CANCEL_RE, raw):
            payee = next(iter(payee_keys(raw)), None)
            who = PAYEE_NAMES.get(payee, "the payee") if payee else "the payee"
            return _say(f"I can't reverse a payment that has already gone out. Ask {who} for a refund directly; if you "
                        "think the payment was fraud, contact your bank right away. If it's a draft that hasn't gone "
                        "through yet, say 'cancel that payment'.")
        target = re.search(CANCEL_TARGET, raw) or payee_keys(raw) or (len(raw.split()) <= 2 and state.get("drafted"))
        if not target:
            return _say(self._t("ask_cancel_what"))
        if "get_pending_actions" not in done:
            return _call("get_pending_actions")
        acts = [a for a in _result(res, "get_pending_actions")["actions"]
                if a["status"] in ("awaiting_user", "awaiting_sponsor")]
        if re.search(r"\bconver(sion|t)\b", raw):
            acts = [a for a in acts if a["kind"] == "conversion"]
        elif re.search(r"top-?up|request", raw):
            acts = [a for a in acts if a["kind"] == "topup"]
        keys = payee_keys(raw)
        if keys:
            acts = [a for a in acts if PAYEE_NAMES[keys[0]].lower() in a["summary"].lower()]
        cancelled = [r["action"] for n, r in res if n == "cancel_pending_action" and "action" in r]
        todo = [a for a in acts if a["action_id"] not in {c["action_id"] for c in cancelled}]
        every = bool(re.search(r"\b(all|everything|those|them)\b", raw))
        if todo and (every or not cancelled):
            return _call("cancel_pending_action", action_id=todo[-1]["action_id"])
        if cancelled:
            return _say(self._t("cancelled", list=i18n.sep(self._lang).join(
                i18n.summary(c["summary"], self._lang) for c in cancelled)))
        extra = (" Payments that have already gone through can't be undone from chat; ask the payee for a refund."
                 if re.search(r"\bundo\b|already", raw) else "")
        return _say(self._t("nothing_to_cancel") + extra)

    def _subscriptions(self, res, done, cancel: bool = False) -> Dict[str, Any]:
        if "list_transactions" not in done:
            return _call("list_transactions", days=60, limit=50)
        rows = _result(res, "list_transactions")["transactions"]
        subs: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            if r["amount"] < 0 and re.search(r"subscription|plan", r.get("memo") or "", re.I):
                subs.setdefault(r["counterparty"], []).append(r)
        dupes = []
        for name, rs in subs.items():
            amounts = [abs(r["amount"]) for r in rs[:2]]
            if len(rs) > 1 and amounts[0] == amounts[1]:   # rows are newest first
                gap = (date.fromisoformat(rs[0]["date"]) - date.fromisoformat(rs[1]["date"])).days
                if gap < 20:
                    dupes.append(f"{name} charged you {_money(amounts[0], rs[0]['currency'])} twice, on "
                                 f"{short_date(rs[1]['date'])} and {short_date(rs[0]['date'])}")
        lst = ", ".join(f"{n} {_money(abs(rs[0]['amount']), rs[0]['currency'])} a month" for n, rs in subs.items())
        if cancel:
            msg = ("I can't cancel subscriptions with a merchant; cancel it in the merchant's own app or website. "
                   "I haven't cancelled anything.")
            if dupes:
                msg += " While you're there: " + "; ".join(dupes) + ". That looks like a duplicate, so ask them to refund one."
            return _say(msg)
        if not subs:
            return _say("I don't see any subscriptions in the last 60 days.")
        msg = f"Your subscriptions and regular plans: {lst}."
        if dupes:
            msg += " " + "; ".join(dupes) + ", which looks like a duplicate charge worth disputing."
        return _say(msg)

    # ----------------------------------------------------------- reminders
    def _reminder(self, text: str, raw: str, res, done, today: date,
                  forced: Optional[Tuple[date, str]] = None) -> Dict[str, Any]:
        if forced:
            when, what = forced
        else:
            found = parse_date(raw, today)
            what = re.sub(r"^(please |pls |can you |could you |hey |eh )*(set (up )?(me )?(an? )?(reminder|alert|alarm)"
                          r"( for me)?( to| for| about| that)?|remind me( to| about| of| that)?|create (an? )?reminder"
                          r"( to| for)?)\s*", "", text.strip(), flags=re.I)
            if found:
                what = re.sub(r"\s*(\b(on|by|for)\s+)?" + re.escape(found[1]), "", what, count=1, flags=re.I).strip()
            what = re.sub(r"^\s*(ingatkan saya( untuk)?|记得)\s*", "", re.sub(r"提醒我", "", what), flags=re.I)
            what = re.sub(r"[\s,.!?]+$", "", what).strip() or "Reminder"
            what = what[0].upper() + what[1:]
            if not found:
                return _say(self._t("ask_when"), state={"slot": "reminder_date", "what": what})
            when = found[0]
        if "create_reminder" not in done:
            return _call("create_reminder", due_date=when.isoformat(), text=what[:200])
        due = last_due(res)
        shown = nice_date(date.fromisoformat(due)) if self._lang == "en" else i18n.date(due, self._lang)
        msg = self._t("reminder_set", date=shown, what=what)
        if re.search(r"\b(pay|bayar|transfer|send)\b|交|付", what.lower()):
            msg += self._t("reminder_no_draft", what=what[0].lower() + what[1:])
        return _say(msg)

    # ------------------------------------------------------------- afford
    @staticmethod
    def _afford_item(raw: str) -> str:
        m = re.search(r"\b(?:afford|buy|get)\s+(?:a |an |the |this |that )?(?:[$\w.,]*\d[\w.,]*\s+)?([a-z][a-z ]{1,30}?)"
                      r"(?:\?|$| for| now| this| next)", raw)
        return m.group(1).strip() if m else ""

    def _afford(self, amt: float, item: str, res, done) -> Dict[str, Any]:
        if "forecast_cashflow" not in done:
            return _call("forecast_cashflow")
        r = _result(res, "forecast_cashflow")
        start, lo = r["starting_balance"], r["lowest"]
        after = round(lo["balance"] - amt, 2)
        thing = f"a {_money(amt, 'CAD')} {item}".strip() if item else _money(amt, "CAD")
        base = (f"You have {_money(start, 'CAD')} in {r['account']} now, and on your usual spending and bills its "
                f"lowest point before {short_date(r['end_date'])} is {_money(lo['balance'], 'CAD')} on "
                f"{short_date(lo['date'])}")
        if after >= 300:
            msg = f"Yes. {base}; after {thing} it would still be about {_money(after, 'CAD')}."
        elif after >= 0:
            msg = (f"Just about, but it would be tight. {base}; after {thing} it would drop to about "
                   f"{_money(after, 'CAD')}.")
        else:
            msg = (f"Not comfortably. {base}, so {thing} would take it to about {_money(after, 'CAD')}. You could wait "
                   f"until after the next pay, find a cheaper option, or ask your dad (say 'ask my dad for "
                   f"{math.ceil(amt)} for {item or 'it'}'). Converting from your MYR Wallet uses sponsor money, so "
                   "check with him first.")
        return _say(msg + " This is an estimate from your schedule and recent spending; I haven't moved any money.")

    # --------------------------------------------------------------- info
    def _info(self, text: str, raw: str, low: str, res, done) -> Optional[Dict[str, Any]]:
        last = res[-1][1] if res else {}
        pays = bool(re.search(r"\b(pay|bayar|convert|tukar|send|transfer)\b", low))

        # Privacy: "can my dad see what I spend?", "who can see my transactions?", "is my data sent to China?"
        if re.search(PRIVACY_WHO_RE, raw) or re.search(PRIVACY_DATA_RE, raw):
            return self._privacy(raw, res, done)

        if re.search(PENDING_RE, low):
            if "get_pending_actions" not in done:
                return _call("get_pending_actions")
            return _say(self._pending_reply(raw, last["actions"]))

        if re.search(LIMITS_RE, low) and not re.search(r"\bbudget\b|\bcredit\b", low):
            if "get_limits" not in done:
                return _call("get_limits")
            return _say(self._limits_reply(raw, last))

        if re.search(OWE_RE, low):
            if "get_tuition_schedule" not in done:
                return _call("get_tuition_schedule")
            if "get_credit_profile" not in done:
                return _call("get_credit_profile")
            return _say(self._owe_reply(_result(res, "get_tuition_schedule"), _result(res, "get_credit_profile")))

        if re.search(INCOME_RE, low) and not pays:
            if "list_transactions" not in done:
                return _call("list_transactions", category="income", days=60, limit=20)
            return _say(self._income_reply(raw, last["transactions"]))

        if re.search(SUBSCRIPTION_RE + r"|recurring (charges|payments|bills)", low) and not pays:
            return self._subscriptions(res, done)

        # "When is rent due?", and asked the Malaysian-English, Malay or Chinese way ("rent how much ah? when need
        # to pay?", "bila kena bayar sewa?", "房租什么时候交？"): a question, so it is answered even with "pay" in it.
        if re.search(r"when('?s| is)? (my |the )?rent (due|paid)|rent due|next rent|bila .{0,12}sewa|sewa .{0,12}bila|"
                     r"how much (is|was) (my |the )?rent\b|berapa sewa|\brent\b.{0,25}\b(when|how much)\b|"
                     r"房租.{0,6}(什么时候|几号|哪天|多少)", low) and (not pays or is_question(text)):
            if "list_transactions" not in done:
                return _call("list_transactions", category="rent", days=60, limit=1)
            rows = last["transactions"]
            if not rows:
                return _say(self._t("rent_none"))
            r0 = rows[0]
            d0 = date.fromisoformat(r0["date"])
            nxt = date(d0.year + (d0.month == 12), d0.month % 12 + 1, min(d0.day, 28)).isoformat()
            L = self._lang
            day = short_date if L == "en" else (lambda iso: i18n.date(iso, L))  # noqa: E731
            return _say(self._t("rent_due", amount=_money(abs(r0["amount"]), r0["currency"]), payee=r0["counterparty"],
                                date=day(r0["date"]), next=day(nxt), offer=i18n.offer("pay rent", L)),
                        state={"offer": "pay rent"})

        if re.search(RATE_RE, low) and not re.search(r"good time|right time|should i|\b(convert|change|tukar)\b|"
                                                     r"exchange \d|cheapest|cheaper", low):
            curs = _currencies(text)
            src = curs[0] if curs else "CAD"
            dst = curs[1] if len(curs) > 1 else ("MYR" if src == "CAD" else "CAD")
            amt = _amount(text) or 1000.0
            if "get_fx_quotes" not in done:
                return _call("get_fx_quotes", from_currency=src, to_currency=dst, amount=amt, own_wallet=True)
            qs = last["quotes"]
            mid = qs[0]["mid_rate"]
            inapp = next((q for q in qs if q["provider_key"] == "inapp"), qs[0])
            return _say(self._t("fx_rate", src=src, dst=dst, mid=f"{mid:.4f}", inv=f"{1 / mid:.4f}",
                                amount=_money(amt, src), mid_amount=_money(amt * mid, dst),
                                inapp=_money(inapp["you_receive"], dst), pct=inapp["true_cost_pct"]))

        if re.search(r"(bank|account|details?).{0,30}\b(same|changed?|still|different)\b|"
                     r"\b(same|changed?|different)\b.{0,30}\b(bank|account|details?)\b", raw) and payee_keys(raw) \
                and not re.search(r"\d{4}", raw):
            if "list_payees" not in done:
                return _call("list_payees")
            key = payee_keys(raw)[0]
            p = next((x for x in last["payees"] if x["name"] == PAYEE_NAMES[key]), None)
            if not p:
                return _say("I don't see that payee in your saved payees.")
            return _say(f"Your saved payee {p['name']} still has the account ending {p['number'][-4:]}; it hasn't "
                        "changed in HomeBridge. Bank details can only change by adding a new payee, which your dad "
                        "must approve, followed by a cooling period. If someone tells you the details changed, call "
                        f"{p['name']} on a number you already have before paying anything new.")

        if re.search(r"^(hi|hello|hey|yo|hai|helo|hiya|good (morning|afternoon|evening)|你好|嗨|selamat)\b", raw) and \
                len(raw.split()) <= 4 or re.search(r"what can you do|what do you do|how can you help|what are you|"
                                                   r"what('?s| is) homebridge|^help\??$|你是谁|你能做什么|你会做什么|"
                                                   r"能帮我(做)?什么|siapa (awak|anda)|apa (awak|anda) boleh (buat|bantu)",
                                                   raw):
            name = getattr(self, "_name", "")
            return _say(self._t("hello", name=(("，" if self._lang == "zh" else " ") + name) if name else ""))

        if re.search(r"\btax(es)?\b|\bcukai\b|报税", raw):
            return _say("I can't file taxes for you. In general, international students in Canada file a return each "
                        "spring, even with a small income, to claim tuition amounts and benefit credits. I can show "
                        "what you earned (ask 'how much did I earn?'); for the filing itself, a free community tax "
                        "clinic or the tax office's guidance for newcomers is the place to go.")

        if re.search(r"\b(invest|investing|investment|etfs?|stocks?|shares|mutual funds?|tfsa|rrsp|bitcoin)\b|"
                     r"投资|股票|\bsaham\b|pelaburan", raw) and not pays:
            return _say("I'm not a licensed adviser, so I can't tell you whether to invest or what to buy. In general, "
                        "people keep money they need soon (like tuition) in cash, build an emergency buffer first, "
                        "and only invest money they won't need for years. I can show what's left after your bills: "
                        "ask 'will I run out of money before tuition?'")
        return None

    def _privacy(self, raw: str, res, done) -> Dict[str, Any]:
        """Who sees her data and where the chat goes, from get_data_sharing (the same scope the app enforces)."""
        if "get_data_sharing" not in done:
            return _call("get_data_sharing")
        d = _result(res, "get_data_sharing")
        L = self._lang
        sp, model = d["sponsor"], d["model"]
        about_sponsor = re.search(PRIVACY_WHO_RE, raw)
        about_model = re.search(PRIVACY_DATA_RE, raw) or re.search(r"^who\b|谁|siapa", raw)
        china = re.search(r"china|chinese|中国|大陆|境外|出境|\bcina\b|\bchina\b", raw)
        msg = ""
        if about_sponsor:
            private = re.search(r"spend|food|buy|bought|purchase|transaction|chat|message|wage|salary|everyday|"
                                r"消费|开销|花销|记录|聊天|工资|交易|belanja|perbelanjaan|transaksi|mesej|gaji", raw)
            dad = re.search(r"dad|father|sponsor|parent|mum|mom|爸|父亲|家长|担保人|ayah|bapa|penaja", raw)
            if private and dad:
                msg += self._t("privacy_no")
            funded = i18n.comma(L).join(i18n.account(a, L) for a in sp["funded_accounts"]) or "-"
            msg += self._t("privacy_sponsor", funded=funded)
        if about_model or not about_sponsor:
            if china and not msg:
                msg += self._t("privacy_yes" if model["region"] == "cn" else "privacy_not_china").strip() + (
                    "" if L == "zh" else " ")
            if model["leaves_server"]:
                part = self._t("privacy_cloud", model=model["label"], region=self._t("region_" + model["region"]))
            else:
                part = self._t("privacy_offline")
            if china and model["region"] != "cn":
                part += self._t("privacy_china_option")
            msg += part + self._t("privacy_log")
        return _say(re.sub(r" {2,}", " ", msg).strip())

    def _remit_reply(self, r: Dict[str, Any]) -> str:
        """The latest money request's stage in one or two sentences; the action card under it has the timeline."""
        L = self._lang
        x = r.get("latest")
        if not x:
            return self._t("remit_none")
        req = x["requested"]
        amount = _money(req["amount"], req["currency"])
        rec = x.get("receive") or {}
        receive = _money(rec["amount"], rec["currency"]) if rec else amount
        account = i18n.account(x.get("to_account") or "", L)
        provider = i18n.provider(x.get("provider") or "", L)
        if x["stage"] == "awaiting_sponsor":
            return self._t("remit_waiting", amount=amount, reason=req.get("reason") or "-")
        if x["stage"] == "in_transit":
            secs = x.get("eta_in_seconds") or 0
            eta = (self._t("remit_eta_soon") if secs < 3600 else self._t("remit_eta_today") if secs < 12 * 3600
                   else self._t("remit_eta_date", date=i18n.date(x["eta"][:10], L)))
            return self._t("remit_transit", receive=receive, account=account, provider=provider, eta=eta)
        if x["stage"] == "credited":
            ago = x.get("credited_seconds_ago") or 0
            when = (self._t("remit_when_now") if ago < 3600
                    else self._t("remit_when_date", date=i18n.date(x["credited_at"][:10], L)))
            return self._t("remit_credited", receive=receive, account=account, provider=provider, when=when)
        if x["stage"] == "rejected":
            note = x.get("sponsor_note") or ""
            note = (f"（“{note}”）" if L == "zh" else f' ("{note}")') if note else ""
            return self._t("remit_rejected", amount=amount, note=note)
        why = {"expired": "remit_why_expired", "cancelled": "remit_why_cancelled",
               "returned": "remit_why_returned"}.get(x["stage"], "remit_why_other")
        return self._t("remit_stopped", amount=amount, why=self._t(why))

    def _pending_reply(self, raw: str, acts: List[Dict[str, Any]]) -> str:
        keys = payee_keys(raw)
        if keys:
            acts = [a for a in acts if PAYEE_NAMES[keys[0]].lower() in a["summary"].lower()]
        mine = [a for a in acts if a["status"] == "awaiting_user"]
        dad = [a for a in acts if a["status"] == "awaiting_sponsor"]
        transit = [a for a in acts if a["status"] == "in_transit"]
        approved = [a for a in acts if a["status"] == "executed" and a["needs_sponsor_approval"]]
        rejected = [a for a in acts if a["status"] == "rejected"]
        done_ = [a for a in acts if a["status"] == "executed" and not a["needs_sponsor_approval"]]
        if keys and not acts:
            what = PAYEE_NAMES[keys[0]]
            return (f"I don't see a payment to {what} in progress. Say 'pay my {keys[0]}' to draft one"
                    + ("; after you confirm it, it goes to your dad to approve." if keys[0] == "tuition" else "."))
        L = self._lang
        lst = lambda xs: i18n.sep(L).join(i18n.summary(a["summary"], L) for a in xs)  # noqa: E731
        about_dad = re.search(r"dad|sponsor|approv|爸爸|批准|审批|ayah|lulus", raw)
        parts = []
        if mine:
            parts.append(self._t("pending_mine", list=lst(mine)))
        if dad:
            parts.append(self._t("pending_dad", list=lst(dad)))
        if transit:
            parts.append(self._t("pending_transit", list=lst(transit)))
        if approved:
            parts.append(self._t("pending_approved", list=lst(approved)))
        if rejected:
            parts.append(self._t("pending_rejected", list=lst(rejected)))
        if done_ and not about_dad:
            parts.append(self._t("pending_done", list=lst(done_[-3:])))
        if not parts:
            return self._t("pending_none_dad" if about_dad else "pending_none")
        return ("。".join(parts) + "。") if L == "zh" else (". ".join(parts) + ".")

    def _limits_reply(self, raw: str, L: Dict[str, Any]) -> str:
        if self._lang != "en":
            return self._limits_reply_local(raw, L)
        sp = (L.get("sponsor") or {}).get("name") or "your sponsor"
        funded = " and ".join(L["sponsor_funded_accounts"]) or "none"
        single, daily = L["single_payment_cad"], L["daily_cad"]
        change = (" I can't change limits; only he can, in his own app." if re.search(
            r"\b(set|change|increase|raise|lower|remove|lift|naikkan)\b", raw) else "")
        if re.search(r"who('?s| is) my sponsor|my sponsor\b\??$", raw):
            return (f"Your sponsor is {sp} (your dad). He sets your limits and approves T3 actions in his own app: big "
                    f"payments, payments from or large conversions of sponsor-funded money ({funded}), new payees "
                    "and anything flagged as risky." + change)
        if re.search(r"\bt[123]\b|\btiers?\b", raw):
            t = L["tiers"]
            return f"T1: {t['T1']} T2: {t['T2']} T3: {t['T3']}"
        if re.search(r"why", raw):
            if re.search(r"tuition|ubc|yuran", raw):
                return (f"Your tuition payment goes to your dad for two reasons: it's paid from your CAD Tuition Fund, "
                        f"which is sponsor-funded, and it's above the CAD {single:,.0f} you can confirm alone. Either "
                        "one makes it T3: you confirm, then he approves in his own app. It's his money and his rule, "
                        "and a message in chat can't skip it.")
            return (f"Your dad approves payments above CAD {single:,.0f}, anything over CAD {daily:,.0f} in 24 hours, "
                    f"payments from sponsor-funded accounts ({funded}), new payees and flagged requests. It's his money "
                    "and his rule, and it's also what stops a scammer who gets you to tap Confirm.")
        return (f"You can confirm payments up to CAD {single:,.0f} each and CAD {daily:,.0f} in 24 hours on your own; "
                f"CAD {L['used_24h_cad']:,.2f} is used, so CAD {L['remaining_24h_cad']:,.2f} is left. Anything bigger, "
                f"paid from sponsor-funded money ({funded}), more than CAD {L['sponsor_money_conversion_cap_cad_24h']:,.0f} "
                f"of sponsor money converted in 24 hours, a new payee, or anything flagged as risky goes to {sp} to "
                "approve. Only he can change these limits, in his app." + (change and ""))

    def _limits_reply_local(self, raw: str, L: Dict[str, Any]) -> str:
        """The limits and the tiers in Chinese or Malay, built from get_limits (the same policy numbers)."""
        lang = self._lang
        funded = i18n.comma(lang).join(i18n.account(a, lang) for a in L["sponsor_funded_accounts"]) or "-"
        nums = dict(single=f"{L['single_payment_cad']:,.0f}", daily=f"{L['daily_cad']:,.0f}", funded=funded,
                    used=f"{L['used_24h_cad']:,.2f}", left=f"{L['remaining_24h_cad']:,.2f}",
                    cap=f"{L['sponsor_money_conversion_cap_cad_24h']:,.0f}")
        if re.search(r"为什么|为啥|kenapa|mengapa", raw):
            key = "limits_why_tuition" if re.search(r"学费|yuran|tuition|ubc", raw) else "limits_why"
            return self._t(key, **nums) + self._t("limits_tiers", **nums)
        if re.search(r"\bt[123]\b|tier|等级|层级|peringkat", raw):
            return self._t("limits_tiers", **nums).strip()
        return self._t("limits_now", **nums) + self._t("limits_tiers", **nums)

    @staticmethod
    def _owe_reply(sched: Dict[str, Any], prof: Dict[str, Any]) -> str:
        parts = []
        inst = sched.get("installments") or []
        if inst:
            t = "; ".join(f"{_money(i['amount'], i['currency'])} due {short_date(i['due'])}" for i in inst[:3])
            parts.append(f"tuition: {t}, and your Tuition Fund has {_money(sched['tuition_fund_cad'], 'CAD')} "
                         "toward it")
        if prof and prof.get("has_card"):
            c, st = prof["card"], prof.get("statement") or {}
            s = f"your {c['label']}: {_money(c['balance'], 'CAD')} balance"
            if st.get("status") == "due" and st.get("remaining"):
                s += (f", with a {_money(st['remaining'], 'CAD')} statement due {short_date(st['due_date'])} "
                      f"(minimum {_money(st['minimum_due'], 'CAD')})")
            parts.append(s)
        if not parts:
            return "You don't owe anything in your HomeBridge accounts right now."
        return ("Here's what you owe: " + "; ".join(parts) + ". Nothing else is owed in your HomeBridge accounts. "
                "Rent and bills are paid as they come, so they aren't counted as debt.")

    def _income_reply(self, raw: str, rows: List[Dict[str, Any]]) -> str:
        today = getattr(self, "_today", None) or date.today()
        if not rows:
            return "I don't see any income in the last 60 days."
        days = 7 if re.search(r"this week|minggu ini|这周|本周", raw) else 14 if "last week" in raw else 30
        start = today.toordinal() - days
        recent = [r for r in rows if date.fromisoformat(r["date"]).toordinal() >= start]
        if "last week" in raw:
            recent = [r for r in recent if date.fromisoformat(r["date"]).toordinal() < today.toordinal() - 7]
        r0 = rows[0]
        cadence = ""
        if len(rows) > 1:
            gap = (date.fromisoformat(rows[0]["date"]) - date.fromisoformat(rows[1]["date"])).days
            if 12 <= gap <= 16:
                nxt = date.fromordinal(date.fromisoformat(r0["date"]).toordinal() + gap)
                cadence = f" You're paid every two weeks, so the next one should arrive around {short_date(nxt.isoformat())}."
        if days <= 14:
            if recent:
                return ("Yes: " + "; ".join(f"{_money(r['amount'], r['currency'])} from {r['counterparty']} on "
                                            f"{short_date(r['date'])}" for r in recent) + "." + cadence)
            return (f"Not {'this' if days == 7 else 'last'} week. Your last pay was {_money(r0['amount'], r0['currency'])} "
                    f"from {r0['counterparty']} on {short_date(r0['date'])}.{cadence}")
        total = sum(r["amount"] for r in recent if r["currency"] == "CAD")
        lst = ", ".join(f"{short_date(r['date'])} {_money(r['amount'], r['currency'])}" for r in recent)
        return (f"In the last 30 days you earned {_money(total, 'CAD')} from {r0['counterparty']} ({len(recent)} "
                f"payment{'s' if len(recent) != 1 else ''}: {lst}).{cadence} Money from your dad isn't counted as "
                "earnings.")

    # ------------------------------------------------------------- tuition
    def _tuition_info(self, text: str, raw: str, low: str, res, done) -> Dict[str, Any]:
        if "get_tuition_schedule" not in done:
            return _call("get_tuition_schedule")
        s = _result(res, "get_tuition_schedule")
        if not s["installments"]:
            return _say(self._t("tuition_none"))
        nxt = s["installments"][0]
        short = s["next_shortfall_cad"]
        gap = (f"Your Tuition Fund has {_money(s['tuition_fund_cad'], 'CAD')}, so the next installment is "
               f"{_money(short, 'CAD')} short." if short > 0 else
               f"Your Tuition Fund has {_money(s['tuition_fund_cad'], 'CAD')}, which covers the next installment.")
        if re.search(r"cheapest|cheaper|best way|lowest fee|from malaysia|汇款|最便宜", low):
            if "get_fx_quotes" not in done:
                return _call("get_fx_quotes", from_currency="MYR", to_currency="CAD", amount=10000, own_wallet=True)
            first = _result(res, "get_fx_quotes")
            myr = math.ceil(nxt["amount"] / first["quotes"][0]["mid_rate"] / 10) * 10
            if done.count("get_fx_quotes") < 2:
                return _call("get_fx_quotes", from_currency="MYR", to_currency="CAD", amount=myr, own_wallet=True)
            qs = {q["provider_key"]: q for q in _result(res, "get_fx_quotes")["quotes"]}
            msg = (f"Your next installment is {_money(nxt['amount'], 'CAD')}, due {short_date(nxt['due'])}; that's about "
                   f"MYR {myr:,} at today's mid-market rate.")
            if "inapp" in qs:
                msg += (f" If the ringgit is in your MYR Wallet, converting in HomeBridge is cheapest: "
                        f"{_money(qs['inapp']['you_receive'], 'CAD')} arrives (true cost {qs['inapp']['true_cost_pct']}%).")
            if "lowcost" in qs and "bank" in qs:
                msg += (f" If your dad sends it from his Malaysian bank, a low-cost transfer service delivers "
                        f"{_money(qs['lowcost']['you_receive'], 'CAD')} ({qs['lowcost']['true_cost_pct']}%), "
                        f"{_money(qs['lowcost']['you_receive'] - qs['bank']['you_receive'], 'CAD')} more than a bank "
                        "telegraphic transfer.")
            msg += " " + gap
            if short > 0:
                msg += " Say 'cover the tuition shortfall from my MYR wallet' and I'll draft just that part."
            return _say(msg + " Rates are a sandbox snapshot, not advice. I haven't drafted anything.",
                        state={"offer": "cover the tuition shortfall from my MYR wallet"} if short > 0 else None)
        if re.search(r"install?ments?|split|plan(s)? .{0,10}pay|ansuran|分期", low) and is_question(text):
            lst = " and ".join(f"{_money(i['amount'], i['currency'])} due {short_date(i['due'])}" for i in s["installments"])
            return _say(f"Your tuition is already split into installments: {lst}. I can't change UBC's payment "
                        "schedule; if you need a different plan, ask UBC Student Financial Services. " + gap)
        if re.search(r"can'?t pay|cannot pay|unable to pay|late|miss(ed)? (the )?(deadline|payment)|on time|tak sempat|"
                     r"交不起|付不起|迟交", low):
            msg = (f"Your next installment is {_money(nxt['amount'], 'CAD')}, due {short_date(nxt['due'])} "
                   f"({nxt['days_until_due']} days away). {gap} Paying late usually means late fees or a hold on your "
                   "student account, so if you think you'll miss it, contact UBC Student Financial Services before the "
                   "due date.")
            if short > 0:
                msg += (f" Ways to close the gap: convert from your MYR Wallet (worth about "
                        f"{_money(s['myr_wallet_value_cad'], 'CAD')}; say 'cover the tuition shortfall from my MYR "
                        "wallet') or ask your dad for a top-up.")
            return _say(msg + " I haven't drafted anything.",
                        state={"offer": "cover the tuition shortfall from my MYR wallet"} if short > 0 else None)
        L = self._lang
        msg = self._t("tuition_next", amount=_money(nxt["amount"], "CAD"), term=i18n.term(nxt["term"], L),
                      due=nxt["due"] if L == "en" else i18n.date(nxt["due"], L), days=nxt["days_until_due"],
                      fund=_money(s["tuition_fund_cad"], "CAD"))
        if short > 0:
            months = max(1, nxt["days_until_due"] // 30)
            msg += self._t("tuition_short", short=_money(short, "CAD"), myr=_money(s["myr_wallet_value_cad"], "CAD"),
                           monthly=_money(short / months, "CAD"))
        else:
            msg += self._t("tuition_covered")
        if re.search(r"plan|ready|prepare|remind", low) and "create_reminder" not in done:
            return _call("create_reminder", due_date=nxt["due"][:8] + "01", text=f"Tuition due {nxt['due']}: "
                         f"top up tuition fund")
        if "create_reminder" in done:
            due = res[-1][1]["due_date"]
            msg += self._t("tuition_reminder", date=due if L == "en" else i18n.date(due, L))
        return _say(msg, state={"offer": "cover the tuition shortfall from my MYR wallet"} if short > 0 else None)

    # ---------------------------------------------------------- conversion
    def _convert(self, text: str, curs: List[str], res, done) -> Dict[str, Any]:
        L = self._lang
        issue = amount_issue(text, L)
        if issue:
            return _say(issue)
        if "USD" in curs:   # quotes can show USD, but there is no USD wallet to convert from or into
            return _say(self._t("no_usd_wallet", amount=f"{_amount(text) or 0:,.2f}"))
        amt = _amount(text)
        src = curs[0]
        dst = curs[1] if len(curs) > 1 else ("CAD" if src == "MYR" else "MYR")
        amts = parse_amounts(text)
        if len(curs) == 1 and amts and amts[0].currency and amts[0].currency != src:
            src, dst = amts[0].currency, src     # "convert RM500 to cad": the currency is on the amount
        elif len(curs) == 1 and re.search(r"\b(to|into|ke|kepada|jadi)\s+(" + _CUR_WORDS + r")\b|(换成|兑换成|换)(" +
                                          _CUR_WORDS + ")", text.lower()):
            dst = curs[0]                        # "convert 500 of it to MYR": the one currency named is the target
            src = "CAD" if dst == "MYR" else "MYR"
        if "get_balances" not in done:
            return _call("get_balances", total_currency="CAD")
        acc = next((a for a in _result(res, "get_balances")["accounts"] if a["currency"] == src), None)
        whole_wallet = amt is None and bool(re.search(ALL_RE, text.lower()))
        if whole_wallet:   # "convert all my ringgit": the whole balance of the source wallet
            if not acc or acc["balance"] <= 0:
                return _say(self._t("convert_nothing", account=i18n.account(acc["label"], L) if acc else src))
            amt = acc["balance"]
        if amt is None:
            return _say(self._t("ask_convert_amount", src=src, dst=dst))
        if acc and acc["balance"] < amt:
            whole = int(acc["balance"])
            return _say(self._t("convert_too_much", account=i18n.account(acc["label"], L),
                                balance=_money(acc["balance"], src), amount=_money(amt, src), whole=_money(whole, src),
                                sponsor=self._t("convert_sponsor_cap") if acc.get("sponsor_funded") else ""),
                        state={"offer": f"convert {whole} {src} to {dst}"} if whole > 0 else None)
        if "get_fx_quotes" not in done:
            return _call("get_fx_quotes", from_currency=src, to_currency=dst, amount=amt, own_wallet=True)
        if "prepare_conversion" not in done:
            return _call("prepare_conversion", from_currency=src, to_currency=dst, amount=amt)
        q = _result(res, "get_fx_quotes")["quotes"]
        inapp = next(x for x in q if x["provider_key"] == "inapp")
        act = _without_rate_note(res[-1][1]["action"])   # the fee sentence below says it once
        msg = self._act(act) + self._t("convert_fee", pct=inapp["true_cost_pct"], rate=inapp["rate"],
                                       mid=inapp["mid_rate"])
        if whole_wallet and acc and acc.get("sponsor_funded"):
            msg += self._t("convert_all_sponsor", account=i18n.account(acc["label"], L))
        return _say(msg)

    def _fx_compare(self, text: str, raw: str, low: str, curs: List[str], amt: Optional[float], res, done):
        last = res[-1][1] if res else {}
        parent = bool(re.search(PARENT_RE + r"|\bhome\b|malaysia", low))   # someone else's bank: no in-app option
        inbound = bool(re.search(r"\b(dad|father|mum|mom|mother|parents?|family)\b.{0,40}\b(send|sending|transfer)\b",
                                 raw)) or bool(re.search(r"send (me|to me)\b", raw))
        if curs:
            src = curs[0]
            dst = curs[1] if len(curs) > 1 else ("CAD" if src == "MYR" else "MYR")
        elif parent and not inbound:
            src, dst = "CAD", "MYR"
        else:
            src, dst = "MYR", "CAD"
        amount = amt or (5000.0 if not parent else 3000.0 if src == "MYR" else 500.0)
        if "get_fx_quotes" not in done:
            return _call("get_fx_quotes", from_currency=src, to_currency=dst, amount=amount, own_wallet=not parent)
        r = last
        best, worst = r["quotes"][0], r["quotes"][-1]
        L = self._lang
        lead = ""
        if parent and not inbound and re.search(r"\b(send|transfer)\b|汇|寄|kirim|hantar", raw):
            who = re.search(PARENT_RE, raw)
            lead = self._t("fx_not_payee", who=self._t("fx_your", who=who.group(1)) if who else self._t("fx_family"))
        if re.search(r"\b(wise|remitly|western union|paypal|instarem|bigpay|moneygram)\b", raw):
            lead += self._t("fx_brands")
        note = self._t("fx_cached", note=r["note"]) if "cached" in (r.get("note") or "") else \
            (r["note"] + " " if r.get("note") and L == "en" else "")
        msg = self._t("fx_cheapest", lead=lead, amount=_money(amount, src),
                      example="" if amt else self._t("fx_example"),
                      best=i18n.provider(best["provider"], L) if L != "en" else best["provider"],
                      receive=_money(best["you_receive"], best["receive_currency"]), pct=best["true_cost_pct"],
                      speed=i18n.speed(best["speed"], L), saving=_money(r["saving_vs_worst"], dst),
                      worst=i18n.provider(worst["provider"], L) if L != "en" else worst["provider"].lower(),
                      note=note)
        return _say(msg)

    def _job_fee(self, text: str, res, done) -> Dict[str, Any]:
        if "check_message_for_scam" not in done:
            return _call("check_message_for_scam", text=text)
        return _say(self._t("job_fee"))

    # ------------------------------------------------------- own accounts
    @staticmethod
    def _move_request(raw: str, low: str) -> Optional[Dict[str, Any]]:
        if not re.search(MOVE_RE, raw):
            return None
        found = []
        for key, pat in ACCOUNT_WORDS.items():
            for m in re.finditer(pat, raw):
                found.append((m.start(), key))
        if not found:
            return None
        found.sort()
        keys = list(dict.fromkeys(k for _, k in found))
        frm = re.search(r"\bfrom (my |the )?(" + "|".join(ACCOUNT_WORDS.values()) + ")", raw)
        src = next((k for k, pat in ACCOUNT_WORDS.items() if frm and re.fullmatch(pat, frm.group(2))), None)
        others = [k for k in keys if k != src]
        if src and others:
            return {"source": src, "dest": others[0]}
        if not src and len(keys) == 2:
            return {"source": keys[0], "dest": keys[1]}
        if not src and len(keys) == 1 and re.search(r"\b(into|to|in)\b (my |the )?" + ACCOUNT_WORDS[keys[0]], raw):
            dest = keys[0]
            if dest == "tuition":
                return {"source": "wallet" if re.search(r"\b(myr|ringgit|rm)\b", raw) else "everyday", "dest": dest}
            if dest == "everyday" and re.search(r"\b(myr|ringgit|rm)\b", raw):
                return {"source": "wallet", "dest": dest}
            return {"source": None, "dest": dest}
        return None

    def _move(self, text: str, mv: Dict[str, Any], res, done) -> Dict[str, Any]:
        L = self._lang
        issue = amount_issue(text, L)
        if issue:
            return _say(issue)
        amt = _amount(text)
        if not mv.get("source"):
            return _say(self._t("ask_from_account"))
        if amt is None:
            return _say(self._t("ask_move_amount"))
        if "get_balances" not in done:
            return _call("get_balances", total_currency="CAD")
        bal = _result(res, "get_balances")
        word = {"everyday": "Everyday", "tuition": "Tuition", "wallet": "Wallet"}
        src, dst = _account(bal, word[mv["source"]]), _account(bal, word[mv["dest"]])
        if not src or not dst:
            return _say("I couldn't find both of those accounts.")
        if src["balance"] < amt:
            return _say(self._t("move_too_much", account=i18n.account(src["label"], L),
                                balance=_money(src["balance"], src["currency"]), amount=_money(amt, src["currency"])))
        same = src["currency"] == dst["currency"]
        args = dict(from_currency=src["currency"], to_currency=dst["currency"], amount=amt,
                    destination="tuition" if mv["dest"] == "tuition" else "everyday", source=mv["source"])
        if not same and "get_fx_quotes" not in done:
            return _call("get_fx_quotes", from_currency=src["currency"], to_currency=dst["currency"], amount=amt,
                         own_wallet=True)
        if "prepare_conversion" not in done:
            return _call("prepare_conversion", **args)
        act = _without_rate_note(res[-1][1]["action"])
        msg = self._act(act)
        if same:
            msg += self._t("move_no_fee")
            if mv["source"] == "tuition":
                msg += self._t("move_from_fund")
        else:
            inapp = next(q for q in _result(res, "get_fx_quotes")["quotes"] if q["provider_key"] == "inapp")
            msg += self._t("convert_fee", pct=inapp["true_cost_pct"], rate=inapp["rate"], mid=inapp["mid_rate"])
        return _say(msg)

    # ------------------------------------------------------------- spending
    def _spending_reply(self, low: str, b: Dict[str, Any]) -> str:
        L = self._lang
        cat = lambda c: i18n.category(c["category"], L)  # noqa: E731
        over = [c for c in b["categories"] if c["over_budget"]]
        focus = next((c for c in b["categories"] if c["category"] in low), None)
        if focus or re.search(r"food|makan|eat", low):
            cats = [c for c in b["categories"] if c["category"] in ("dining", "groceries")] if not focus else [focus]
            parts = [f"{cat(c)} CAD {c['spent_cad']:,.2f}" + (
                self._t("spent_against", budget=f"CAD {c['budget_cad']:,.0f}") if c["budget_cad"] else "")
                for c in cats]
            msg = self._t("spent_focus", parts=i18n.sep(L).join(parts))
            if any(c["over_budget"] for c in cats):
                msg += self._t("spent_dining_over")
            return msg
        if re.search(r"cut (my )?(costs|spending|back)|save money|saving money|spend less|lost my job|jimat|省钱", low):
            fixed = {"rent", "phone", "utilities", "tuition", "family"}
            flex = [c for c in b["categories"] if c["category"] not in fixed][:3]
            op, cp = ("（", "）") if L == "zh" else (" (", ")")
            items = [f"{cat(c)}{op}CAD {c['spent_cad']:,.2f}" +
                     (self._t("spent_over_tag") if c["over_budget"] else "") + cp for c in flex]
            msg = self._t("spent_cut", total=f"CAD {b['total_spent_cad']:,.2f}", list=i18n.comma(L).join(items))
            if b["possible_duplicate_charges"]:
                msg += self._t("spent_twice", list=i18n.comma(L).join(b["possible_duplicate_charges"]))
            if "lost my job" in low:
                msg += (" Tell your dad early, and ask me 'will I run out of money before tuition?' to see how long "
                        "your money lasts.")
            return msg
        top = i18n.comma(L).join(f"{cat(c)} CAD {c['spent_cad']:,.2f}" for c in b["categories"][:3])  # card: all
        msg = self._t("spent_total", total=f"CAD {b['total_spent_cad']:,.2f}", top=top)
        if over:
            msg += self._t("spent_over", list=i18n.comma(L).join(cat(c) for c in over))
        if b["possible_duplicate_charges"]:
            msg += self._t("spent_dupe", list=i18n.comma(L).join(b["possible_duplicate_charges"]))
        if re.search(r"\b(make|create|plan|set up)\b.{0,12}budget", low):
            msg += self._t("spent_set_budget")
        return msg

    # ------------------------------------------------------------- fallback
    def _fallback(self, raw: str) -> Dict[str, Any]:
        vocab = {w: i for i, (_, ws) in enumerate(SUGGESTIONS) for w in ws}
        votes: Dict[int, int] = {}
        for w in re.findall(r"[a-z]{3,}", raw):
            hit = difflib.get_close_matches(w, list(vocab), n=1, cutoff=0.8)
            if hit:
                votes[vocab[hit[0]]] = votes.get(vocab[hit[0]], 0) + 1
        best = max(votes, key=lambda i: (votes[i], -i)) if votes else None
        L = self._lang
        if L != "en":   # the closest-intent guess works on English words; other languages get local examples
            return _say(self._t("fallback", tries=i18n.or_list(i18n.FALLBACK_EXAMPLES[L][:3], L)))
        others = [ex for i, (ex, _) in enumerate(SUGGESTIONS) if i != best and i in (0, 2, 4, 6)][:3]
        tries = i18n.or_list(others, L)
        if best is not None:
            ex = SUGGESTIONS[best][0]
            state = {"offer": ex} if "<" not in ex else None
            return _say(self._t("fallback_guess", guess=ex.rstrip("?"), tries=tries), state=state)
        return _say(self._t("fallback", tries=tries))

    def _forecast_state(self, r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if any(t["gap"] > 0 for t in r.get("tuition", [])):
            return {"offer": "cover the tuition shortfall from my MYR wallet"}
        return None

    # --------------------------------------------------------------- credit
    def _credit(self, text: str, low: str, res, done) -> Dict[str, Any]:
        last = res[-1][1] if res else {}
        pay = re.search(r"\b(pay|paying|bayar)\b|pay ?(it )?(off|down)|clear (my|the) (credit )?card", low)
        # "What happens if I don't pay my card on time?" / "when is my card payment due?": answered, not drafted
        asked = is_question(text) and bool(pay or re.search(r"\b(due|late|statement|payment)\b|还款|到期", low))
        if pay and not asked:
            if "prepare_card_payment" not in done:
                if re.search(r"30\s*%|30 ?percent|under 30|below 30|bawah 30", low):
                    return _call("prepare_card_payment", target="under_30")
                if re.search(r"10\s*%|10 ?percent|under 10|below 10", low):
                    return _call("prepare_card_payment", target="under_10")
                if re.search(r"minimum|\bmin\b", low):
                    return _call("prepare_card_payment", target="minimum")
                if re.search(r"statement", low):
                    return _call("prepare_card_payment", target="statement_balance")
                if re.search(r"\boff\b|\bfull\b|whole|entire|everything|all of it|clear|还清", low):
                    return _call("prepare_card_payment", target="full_balance")
                issue = amount_issue(text, self._lang)
                if issue:
                    return _say(issue)
                amt = _amount(text)
                if amt is not None:
                    return _call("prepare_card_payment", amount=amt)
                return _call("prepare_card_payment", target="recommended")
            if last.get("nothing_to_pay"):
                return _say(f"{last['note'][0].upper()}{last['note'][1:]} Your card is at {last['utilization_pct']}% "
                            "of its limit.")
            after = last["card_after"]
            close = last["next_statement_date"]
            close = close if self._lang == "en" else i18n.date(close, self._lang)
            msg = self._act(last["action"])
            msg += self._t("card_after", balance=f"{after['balance']:,.2f}", util=after["utilization_pct"])
            msg += self._t("card_under30" if after["utilization_pct"] < 30 else "card_over30", close=close)
            if last.get("target") == "minimum":
                msg += self._t("card_minimum")
            return _say(msg)

        if "get_credit_profile" not in done:
            return _call("get_credit_profile")
        prof = res[0][1]
        L = self._lang
        if asked and prof.get("has_card"):
            return self._card_question(prof)
        build = re.search(r"\bbuild|start|establish|from scratch|nothing|no (credit )?history|secured card|"
                          r"get a (credit )?card|new to canada", low)
        if build and "credit_building_plan" not in done:
            return _call("credit_building_plan", has_credit_card=bool(prof.get("has_card")), has_sin=True)
        # The cards under the reply (credit profile, checklist) carry the detail: the reply is the verdict, the one
        # next step with its offer, and the disclosure, in at most three sentences.
        disclosure = self._t("credit_disclosure")
        sp = "" if L == "zh" else " "
        if not prof.get("has_card"):
            first = i18n.credit_step(last["steps"][0], L) if last.get("steps") else ""
            return _say(self._t("credit_scratch", step=first, disclosure=disclosure))
        c, st = prof["card"], prof.get("statement") or {}
        rec = prof["recommended_payment"]
        card = i18n.account(c["label"], L)
        cmd = i18n.offer("pay my card", L)
        offer = {"offer": "pay my card"} if rec["amount"] > 0 else None
        if build:
            msg = self._t("credit_have_card", card=card, limit=f"{c['credit_limit']:,.0f}",
                          streak=prof["on_time_streak"], months=prof["months_of_history"])
            if prof["utilization_pct"] >= 30 and rec["amount"] > 0:
                msg += self._t("credit_util_now", util=prof["utilization_pct"], amount=f"{rec['amount']:,.2f}",
                               after=rec["utilization_after_pct"], cmd=cmd)
            else:
                msg += self._t("credit_next_keep")
            return _say(msg + sp + disclosure, state=offer)
        lead = ""
        if re.search(r"\bscore\b|评分|分数", low) and not re.search(r"improve|raise|increase|boost|build|naik|提高", low):
            lead = self._t("credit_score_lead")
        day = (lambda iso: iso) if L == "en" else (lambda iso: i18n.date(iso, L))  # noqa: E731
        msg = self._t("credit_now", lead=lead, your="your" if lead else "Your", card=card,
                      util=prof["utilization_pct"], balance=f"{c['balance']:,.2f}", limit=f"{c['credit_limit']:,.0f}",
                      streak=prof["on_time_streak"],
                      label=i18n.health(prof["credit_health"]["key"], prof["credit_health"]["label"], L))
        if rec["amount"] > 0:
            covers = (self._t("credit_covers", remaining=f"{st['remaining']:,.2f}", due=day(st["due_date"]))
                      if st.get("status") == "due" and st.get("remaining") else "")
            msg += self._t("credit_pay_rec", amount=f"{rec['amount']:,.2f}", covers=covers,
                           after=rec["utilization_after_pct"], close=day(prof["next_statement_date"]), cmd=cmd)
        else:
            msg += self._t("credit_keep")
        msg += self._t("credit_health")
        return _say(msg, state=offer)

    def _card_question(self, prof: Dict[str, Any]) -> Dict[str, Any]:
        """When the card is due and what paying late costs, from the profile. Offers the payment, drafts nothing."""
        L = self._lang
        c, st = prof["card"], prof.get("statement") or {}
        day = (lambda iso: iso) if L == "en" else (lambda iso: i18n.date(iso, L))  # noqa: E731
        card = i18n.account(c["label"], L)
        if st.get("status") == "due" and st.get("remaining"):
            msg = self._t("card_due", card=card, remaining=f"{st['remaining']:,.2f}", due=day(st["due_date"]),
                          minimum=f"{st['minimum_due']:,.2f}")
        else:
            msg = self._t("card_nothing_due", card=card, close=day(prof["next_statement_date"]))
        offer = prof["recommended_payment"]["amount"] > 0
        msg += self._t("card_late") + (self._t("card_offer", cmd=i18n.offer("pay my card", L)) if offer else "")
        return _say(msg, state={"offer": "pay my card"} if offer else None)

    # --------------------------------------------------------------- helpers
    @staticmethod
    def _payee_word(low: str) -> Optional[str]:
        keys = payee_keys(low)
        return keys[0] if keys else None

    def _lock_request(self, text: str, low: str, res, done: List[str]) -> Optional[Dict[str, Any]]:
        """'Lock my account' calls freeze_payments. Unlocking is never done from chat."""
        # "I've been scammed" / "我被骗了" / "saya kena tipu" locks too, unless it comes with a message to check.
        scammed = bool(re.search(BEEN_SCAMMED_RE, low)) and not quoted_segments(text) and not re.search(
            r"is (this|it) (a scam|real|legit)|是不是|诈骗吗|scam ke", low)
        if re.search(LOCK_RE, low) or scammed:
            if "freeze_payments" not in done:
                return _call("freeze_payments", reason="user asked to lock payments")
            # When she also says what happened ("someone called from the bank and asked me to transfer"), name
            # the warning signs too, after the lock.
            if scammed and not re.search(LOCK_RE, low) and len(re.findall(r"\w+", text)) >= 8 and \
                    "check_message_for_scam" not in done:
                return _call("check_message_for_scam", text=text)
            r = _result(res, "check_message_for_scam")
            if r and r["verdict"] != "no_known_pattern":
                L = self._lang
                if L == "en":
                    why = f" {r['explanation']}" if r.get("explanation") else ""
                else:
                    names = [i18n.signal(s["name"], L) for s in r.get("signals", [])[:3]]
                    why = self._t("scam_why", signals=i18n.sep(L).join(names), quote="") if names else ""
                lead = self._t("scam_likely" if r["verdict"] == "likely_scam" else "scam_suspicious")
                return _say(lead + ("。" if L == "zh" else ".") + why + ("" if L == "zh" else " ") + self._t("frozen"))
            return _say(self._t("frozen"))
        if re.search(r"\b(unfreez\w*|unlock\w*|unblock\w*)\b|\blift (the )?(freeze|lock)\b|解冻|解锁|buka (kunci|semula)",
                     low) and not re.search(r"scam|is this (real|legit)|legit ke", low):
            return _say(self._t("refuse_unlock"))
        return None

    @staticmethod
    def _refusal(note: str, lang: str = "en") -> str:
        if "extraction" in note:
            return t("refuse_extraction", lang)
        if "escalation" in note:
            return t("refuse_escalation", lang)
        if "scam" in note:
            return t("refuse_scam", lang)
        return t("refuse_injection", lang)

    def _add_payee(self, text: str, low: str) -> Dict[str, Any]:
        number = re.search(r"\b\d{4}-\d{4}-\d{4}\b|\b\d{8,16}\b", text)
        quoted = re.search(r"['\"“]([^'\"”]{2,60})['\"”]", text)
        named = re.search(r"payee(?: called| named)?\s+([A-Z][\w&.' -]{1,58}?)(?:,| with| for| account|$)", text)
        name = (quoted or named).group(1).strip() if (quoted or named) else ""
        if not name or not number:
            return _say(self._t("ask_payee_details"))
        kinds = ["rent", "tuition", "utilities", "phone", "individual", "business", "crypto", "gift_card"]
        kind = next((k for k in kinds if k.replace("_", " ") in low), "unknown")
        cur = next((c for c in _currencies(text) if c in ("CAD", "MYR", "USD")), "CAD")
        return _call("add_payee", name=name, kind=kind, currency=cur, account_number=number.group(0))

    def _cover_tuition(self, low, res, done, pay: Optional[bool] = None, lead: str = ""):
        if "get_tuition_schedule" not in done:
            return _call("get_tuition_schedule")
        sched = res[0][1]
        short = sched["next_shortfall_cad"]
        nxt = sched["installments"][0] if sched["installments"] else None
        if pay is None:
            pay = bool(re.search(r"\b(then|and) pay\b|pay (it|the tuition|my tuition)", low))
        if short <= 0 and not pay:
            return _say(self._t("cover_nothing"))
        if short > 0 and "get_fx_quotes" not in done:
            return _call("get_fx_quotes", from_currency="MYR", to_currency="CAD", amount=1000, own_wallet=True)
        if short > 0 and "prepare_conversion" not in done:
            # The schedule's own figure (fx.quote_to_receive), the one the forecast suggests too
            myr = sched.get("cover_shortfall_myr") or float(math.ceil(short / next(
                q for q in _result(res, "get_fx_quotes")["quotes"] if q["provider_key"] == "inapp")["rate"]))
            return _call("prepare_conversion", from_currency="MYR", to_currency="CAD", amount=myr,
                         destination="tuition")
        if pay and nxt and "prepare_transfer" not in done:
            return _call("prepare_transfer", payee="UBC Student Financial Services", amount=nxt["amount"],
                         memo=nxt["term"])
        # Is the tuition payment already drafted? Then the next step is its card, not "ask me to pay".
        if not pay and "get_pending_actions" not in done:
            return _call("get_pending_actions")
        tuition_waiting = not pay and any(
            a["kind"] == "transfer" and "UBC Student Financial Services" in a["summary"]
            and a["status"] in ("awaiting_user", "awaiting_sponsor")
            for a in _result(res, "get_pending_actions")["actions"])
        drafted = [i18n.summary(r["action"]["summary"], self._lang) for n, r in res
                   if n in ("prepare_conversion", "prepare_transfer") and "action" in r]
        msg = lead + self._t("cover_drafted", list=self._t("then").join(drafted))
        if short > 0:
            msg += self._t("cover_short", short=f"{short:,.2f}")
        elif lead:
            msg += self._t("cover_no_conversion")
        msg += self._t("cover_in_order" if pay else "cover_then_tuition_card" if tuition_waiting else "cover_then_pay")
        return _say(msg)

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


_ACCOUNT_KEYS = {"Wallet": "wallet", "Tuition": "tuition", "Everyday": "everyday"}


def _without_rate_note(action: Dict[str, Any]) -> Dict[str, Any]:
    """The draft without its 'Rate … includes a 0.6% margin' warning, for replies that state the fee themselves
    (the card still shows the warning)."""
    return {**action, "warnings": [w for w in action.get("warnings", []) if not w.startswith("Rate ")]}


def _conversion_args(summary: str) -> Dict[str, str]:
    """prepare_conversion arguments (currencies, source, destination) read back from a drafted conversion's summary:
    'Convert MYR 2,000.00 to about CAD 643.32 (MYR Wallet to CAD Everyday)' or 'Move CAD 500.00 from CAD Everyday
    to CAD Tuition Fund'. The model never sees action params, only the summary."""
    m = re.match(r"Convert (\w{3}) [\d,.]+ to about (\w{3}) [\d,.]+ \((.+) to (.+)\)$", summary) or \
        re.match(r"Move (\w{3}) [\d,.]+ from ((.+)) to (.+)$", summary)
    if not m:
        return {}
    src_cur = m.group(1)
    dst_cur = m.group(2) if summary.startswith("Convert") else src_cur
    key = lambda label: next((v for k, v in _ACCOUNT_KEYS.items() if k in label), "")  # noqa: E731
    return {"from_currency": src_cur, "to_currency": dst_cur, "source": key(m.group(3)),
            "destination": "tuition" if key(m.group(4)) == "tuition" else "everyday"}


def last_due(res: List[Tuple[str, Dict[str, Any]]]) -> str:
    r = _result(res, "create_reminder") or {}
    return r.get("due_date") or date.today().isoformat()
