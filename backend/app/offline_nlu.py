"""Text parsing for the offline engine: amounts, currencies, payees, dates and question forms.

Kept apart from offline_engine.py so the planner reads as a list of intents, and so each parser can be
unit-tested on its own (tests/test_engine_routing.py). Everything here is pure: no tools, no state.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Optional, Tuple

from .i18n import t

# ------------------------------------------------------------------ amounts
MAX_AMOUNT = 100_000.0   # anything above this in one chat request is treated as a typo and asked about
MIN_AMOUNT = 0.01

_CUR_PREFIX = r"(?:rmb|cny|rm|cad|myr|usd|c\$|us\$|\$|¥)"
_CUR_SUFFIX = (r"(?:rmb|cny|yuan|renminbi|rm|cad|myr|usd|ringgit|dollars?|bucks|canadian dollars?|"
               r"块钱|块|元人民币|人民币|元|加币|加元|马币|令吉|美元|美金)")
_AMOUNT_RE = re.compile(
    r"(?P<neg>-\s*|\bminus\s+|\bnegative\s+)?"
    rf"(?P<pre>(?<![a-z]){_CUR_PREFIX}\s*)?"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?P<dec>\.\d+)?"
    r"(?P<exp>e[+-]?\d+)?"
    r"(?:\s*(?P<k>k)(?![a-z]))?"
    rf"(?P<post>\s*{_CUR_SUFFIX}(?![a-z]))?",
    re.I)
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_MONTH_RE = (r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
             r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?")
_UNIT_AFTER = re.compile(r"\s*(?:days?|weeks?|months?|years?|hours?|hrs?|mins?|minutes?|hari|minggu|bulan|天|周|个月|小时)\b|"
                         r"\s*(?:%|percent|st\b|nd\b|rd\b|th\b|am\b|pm\b|号|日|点)", re.I)
_LABEL_BEFORE = re.compile(r"(?:\b(?:installment|instalment|term|step|number|level|tier|page|room|unit|apt|t)|"
                           r"\bno\.|#)\s*$", re.I)

# Chinese numerals: 五百, 一千二, 两千五百, 3千 ...
_CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8,
              "九": 9}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_CN_RE = re.compile(r"[零〇一二两三四五六七八九十百千万\d]+(?=\s*(?:块|元|加币|加元|马币|令吉|美元|美金|人民币|给|到|去|换))")


@dataclass
class Amount:
    value: float
    start: int
    end: int
    currency: Optional[str]      # currency written next to the number, if any
    issue: Optional[str] = None  # negative | scientific | too_small | too_large


def _cn_number(s: str) -> Optional[float]:
    if s.isdigit():
        return float(s)
    total, section, num = 0, 0, 0
    for ch in s:
        if ch.isdigit():
            num = num * 10 + int(ch)
        elif ch in _CN_DIGITS:
            num = _CN_DIGITS[ch]
        elif ch in _CN_UNITS:
            unit = _CN_UNITS[ch]
            if unit == 10000:
                total += (section + num) * unit
                section, num = 0, 0
            else:
                section += (num or 1) * unit
                num = 0
        else:
            return None
    # 一千二 means 1200: a trailing digit after a unit scales to the next unit down
    if num and s and s[-1] in _CN_DIGITS and len(s) >= 2 and s[-2] in ("百", "千"):
        num *= _CN_UNITS[s[-2]] // 10
    v = total + section + num
    return float(v) if v else None


def _cur_word(w: str) -> Optional[str]:
    w = (w or "").strip().lower()
    if not w:
        return None
    if w in ("rm", "myr", "ringgit", "马币", "令吉"):
        return "MYR"
    if w in ("usd", "us$", "美元", "美金"):
        return "USD"
    if w in ("rmb", "cny", "yuan", "renminbi", "人民币", "元人民币", "¥"):
        return "CNY"
    if w in ("cad", "c$", "加币", "加元") or w.startswith("canadian"):
        return "CAD"
    return None   # "$", "dollars", "块" do not say which dollar


def parse_amounts(text: str) -> List[Amount]:
    """Every money-looking number in the text, with any problem that should be asked about rather than guessed."""
    out: List[Amount] = []
    low = text.lower()
    for m in _AMOUNT_RE.finditer(low):
        s, e = m.start("num"), m.end()
        before, after = low[:s], low[m.end("num"):]
        if not m.group("pre") and before and (before[-1].isascii() and (before[-1].isalnum() or before[-1] == ".")):
            continue                                     # part of a word or code: "T3", "abc123", "1.5.2"
        if re.match(r"-\d", after) or re.search(r"\d-$", before) or re.match(r":\d", after) or before.endswith(":"):
            continue                                     # account numbers, dates, times
        if not m.group("post") and not m.group("k") and _UNIT_AFTER.match(after):
            continue                                     # "3 days", "30%", "1st", "5pm"
        if re.search(_MONTH_RE + r"\s*$", before) or re.match(r"\s*" + _MONTH_RE + r"(?![a-z])", after):
            continue                                     # "Oct 30", "30 October"
        if not m.group("pre") and _LABEL_BEFORE.search(before):
            continue                                     # "installment 1", "T 3"
        v = float(m.group("num").replace(",", "") + (m.group("dec") or ""))
        issue = None
        if m.group("exp"):
            issue = "scientific"
        if m.group("k"):
            v *= 1000
        neg = m.group("neg")
        if neg and (neg.strip() != "-" or m.start() == 0 or not low[m.start() - 1].isalnum()):
            issue = "negative"
        if issue is None and v < MIN_AMOUNT:
            issue = "too_small"
        if issue is None and v > MAX_AMOUNT:
            issue = "too_large"
        cur = _cur_word((m.group("pre") or "").strip()) or _cur_word((m.group("post") or "").strip())
        out.append(Amount(v, m.start(), e, cur, issue))
    if not out:
        for m in _CN_RE.finditer(text):
            v = _cn_number(m.group(0))
            if v:
                out.append(Amount(v, m.start(), m.end(), None, None if v <= MAX_AMOUNT else "too_large"))
    return out


def first_amount(text: str) -> Optional[float]:
    """The first amount without a problem (None if the first one has a problem: ask, don't skip to another)."""
    amts = parse_amounts(text)
    if not amts or amts[0].issue:
        return None
    return amts[0].value


def amount_issue(text: str, lang: str = "en") -> Optional[str]:
    """A clarifying question (in the reply language) if an amount in the text should not be used as written."""
    for a in parse_amounts(text):
        if a.issue == "too_large":
            return t("amt_too_large", lang, value=f"{a.value:,.0f}")
        if a.issue in ("negative", "scientific", "too_small"):
            return t("amt_" + a.issue, lang)
    return None


# --------------------------------------------------------------- currencies
_CUR_RE = re.compile(r"(?<![a-z])(myr|ringgit|rmb|cny|yuan|renminbi|rm(?=\s*\d)|rm(?![a-z])|cad|canadian|c\$|usd|"
                     r"us\$|dolar kanada|令吉|马币|加币|加元|美元|美金|人民币)(?![a-z])", re.I)


def currencies(text: str) -> List[str]:
    """Currencies in the order they are written (so 'from' comes before 'to'), in English, Malay and Chinese."""
    found: List[str] = []
    for m in _CUR_RE.finditer(text.lower()):
        c = "CAD" if m.group(1) == "dolar kanada" else _cur_word(m.group(1))
        if c and (not found or found[-1] != c):
            found.append(c)
    return found


# ------------------------------------------------------------------ payees
# Saved-payee keys the prepare_transfer tool resolves, with the words that point at each.
PAYEE_WORDS: List[Tuple[str, str]] = [
    ("rent", r"landlord|\brent\b|rental|maple court|\bsewa\b|tuan rumah|房东|房租|租金"),
    ("hydro", r"hydro|electric|utilit|bil elektrik|电费"),
    ("phone", r"\bphone\b|mobile|northline|\btelefon\b|话费|手机费|电话费"),
    ("tuition", r"tuition|\bubc\b|school fees?|uni(versity)? fees?|\byuran\b|学费"),
]
PAYEE_NAMES = {"rent": "Maple Court Rentals", "hydro": "BC Hydro", "phone": "Northline Mobile",
               "tuition": "UBC Student Financial Services"}


def payee_mentions(low: str) -> List[Tuple[str, int]]:
    """(payee key, position) for every payee word in the text, in order."""
    out = []
    for key, pat in PAYEE_WORDS:
        for m in re.finditer(pat, low):
            out.append((key, m.start()))
    return sorted(out, key=lambda kv: kv[1])


def payee_keys(low: str) -> List[str]:
    return list(dict.fromkeys(k for k, _ in payee_mentions(low)))


# --------------------------------------------------------- multi-payment
_CLAUSE_SPLIT = re.compile(r"\s*(?:\band then\b|\bthen\b|\balso\b|\band\b|&|\+|;|,(?=\s*[a-z一-鿿])|"
                           r"\bdan\b|\blepas tu\b|和|还有|然后|再)\s*")


def payment_clauses(low: str) -> Optional[List[Tuple[Optional[str], Optional[float], Optional[str]]]]:
    """Split "pay my phone bill 60 and my hydro bill 85" into (payee, amount, issue) per payment.

    Each amount goes with the payee in its own clause; inside a clause the payee nearest the amount wins.
    Clauses naming the same payee without a second amount are merged ("rent how much, can pay landlord").
    Returns None when the text has no payment clause at all.
    """
    items: List[List] = []
    for part in _CLAUSE_SPLIT.split(low):
        if not part.strip():
            continue
        payees = payee_mentions(part)
        amts = parse_amounts(part)
        if not payees and not amts:
            continue
        if amts and len(payees) > 1:
            a = amts[0]
            key = min(payees, key=lambda kv: min(abs(kv[1] - a.start), abs(kv[1] - a.end)))[0]
        else:
            key = payees[0][0] if payees else None
        amt = amts[0] if amts else None
        items.append([key, amt.value if amt and not amt.issue else None, amt.issue if amt else None])
        for extra in amts[1:]:   # "pay hydro 45 and 50": a second amount with no payee of its own
            items.append([None, extra.value if not extra.issue else None, extra.issue])
    merged: List[List] = []
    for it in items:
        same = next((m for m in merged if m[0] == it[0] and it[0] is not None and (m[1] is None or it[1] is None)
                     and not (m[1] is not None and it[1] is not None)), None)
        if same:
            same[1] = same[1] if same[1] is not None else it[1]
            same[2] = same[2] or it[2]
        else:
            merged.append(it)
    return [tuple(m) for m in merged] or None  # type: ignore[misc]


# ---------------------------------------------------------- question forms
# Question forms in English, Malaysian English, Malay and Chinese. A question mark anywhere counts ("tuition
# need to pay when ah? still short how much"), as do question words after the verb ("pay when ah", "还差多少")
# and the Malay and Chinese question words and particles.
_QUESTION = re.compile(
    r"^(what|what's|whats|how|why|when|where|which|who|is|are|does|do|did|will|would|should|am|was|were)\b|"
    r"\bwhat (if|happens|happen)\b|\bcan i\b|\bcould i\b|\bam i able\b|\bis it (ok|okay|possible|safe)\b|"
    r"\bhow (do|can|should|to|much|many|long)\b|\b(when|where|why|what time)\b.{0,12}\b(ah|ar|leh|hor|one)\b|"
    r"[?？]|"
    r"吗|呢|怎么|如何|什么|多少|几号|几时|是不是|为什么|为啥|哪(个|里|天|儿)|能不能|可不可以|有没有|"
    r"\b(boleh ke|macam mana|bila|berapa|kenapa|mengapa|bagaimana|adakah|bolehkah|apakah)\b")
_COMMAND = re.compile(r"\b(can|could|would|will) you\b|\bcan help\b|\bhelp me\b|\bplease\b|\bpls\b|\bplz\b|"
                      r"\btolong\b|帮我|\bor not\b|\bboleh tak\b|\bfor me\b")


def is_question(raw: str) -> bool:
    """An informational question ('can I pay tuition in installments?', 'tuition need to pay when ah?',
    '学费要交多少呢', 'bila kena bayar sewa'), not a polite command ('can you pay my rent?', 'can pay landlord
    or not', '帮我交学费'). Questions are answered from the data and never draft money."""
    low = raw.lower().strip()
    if _COMMAND.search(low):
        return False
    return bool(_QUESTION.search(low))


# --------------------------------------------------------- relayed messages
_RELAY_WORDS = (r"\b(whats ?app(ed)?|texted|text(ed)? me|messaged|message[ds]? me|e-?mailed|sms(ed)?|wechat(ed)?|"
                r"dm(ed)?|sent me|wrote|says?|said|told me|got (a|an|this) (message|text|email|sms))\b|"
                r"发来|发给我|发消息|短信|微信|\bmesej\b|\bkata\b")
_OWN_REQUEST = (r"\b(pay|send|transfer|convert|bayar|tukar|e-?transfer|draft|add)\b|付|转|交|帮我|"
                r"\bis (this|it) (real|legit|a scam)\b")
_CHANGED_DETAILS = (r"\b(new|different|another|changed|updated) (bank )?(account|acc|bank details|details)\b|"
                    r"\b\d{4}[- ]\d{4}[- ]\d{3,4}\b|新的?(银行)?(账户|账号)|\bakaun baru\b")


def relayed_message(text: str) -> bool:
    """A message passed on from someone else, with no request of the user's own: "My landlord WhatsApp me:
    'rent go up to 1,600 … new account 4444-5555-6666'", or unquoted, "landlord texted me rent now 1600, new
    account 4444-…". Such a message is checked for scam signs and nothing is drafted; "pay it" outside the
    quote is the user's own request and is handled as a payment (the amount is still marked as untrusted)."""
    from .guard import quoted_segments   # guard imports nothing from here; kept local to keep this module pure
    quotes = quoted_segments(text)
    if quotes:
        outside = text
        for q in quotes:
            outside = outside.replace(q, " ")
        outside = outside.lower()
        return not re.search(_OWN_REQUEST, outside) and bool(re.search(_RELAY_WORDS + r"|:", outside))
    low = text.lower()
    return bool(re.search(_RELAY_WORDS, low)) and bool(re.search(_CHANGED_DETAILS, low))


# --------------------------------------------------------------- dates
_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_WD_RE = r"(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday|sday)?"
_CN_WD = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


def _next_day_of_month(today: date, day: int) -> date:
    y, m = today.year, today.month
    for _ in range(13):
        last = calendar.monthrange(y, m)[1]
        d = date(y, m, min(day, last))
        if d > today:
            return d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return today + timedelta(days=30)


def parse_date(low: str, today: date) -> Optional[Tuple[date, str]]:
    """A date in the text, and the phrase that gave it (so it can be removed from a reminder's wording)."""
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", low)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))), m.group(0)
        except ValueError:
            pass
    m = re.search(r"\b(today|tonight|hari ini)\b|今天", low)
    if m:
        return today, m.group(0)
    m = re.search(r"\b(tomorrow|tmr|tmrw|esok)\b|明天", low)
    if m:
        return today + timedelta(days=1), m.group(0)
    m = re.search(r"\bday after tomorrow\b|后天|\blusa\b", low)
    if m:
        return today + timedelta(days=2), m.group(0)
    m = re.search(r"\bin (\d{1,3}) (day|days|week|weeks)\b", low)
    if m:
        n = int(m.group(1)) * (7 if m.group(2).startswith("week") else 1)
        return today + timedelta(days=n), m.group(0)
    m = re.search(r"\b(?:at the |by the |on the )?end of (?:the |this )?month\b|月底", low)
    if m:
        return date(today.year, today.month, calendar.monthrange(today.year, today.month)[1]), m.group(0)
    m = re.search(r"\b(next|this|on|coming)?\s*" + _WD_RE + r"\b", low)
    if m and m.group(2):
        wd = next(i for i, w in enumerate(_WEEKDAYS) if w.startswith(m.group(2)[:3]))
        ahead = (wd - today.weekday()) % 7 or 7
        d = today + timedelta(days=ahead)
        if m.group(1) == "next":   # "next friday" = the friday of next week
            monday_next = today + timedelta(days=7 - today.weekday())
            d = monday_next + timedelta(days=wd)
        return d, m.group(0).strip()
    m = re.search(r"(下)?(?:周|星期|礼拜)([一二三四五六日天])", low)
    if m:
        wd = _CN_WD[m.group(2)]
        ahead = (wd - today.weekday()) % 7 or 7
        d = today + timedelta(days=ahead)
        if m.group(1):
            d = today + timedelta(days=7 - today.weekday()) + timedelta(days=wd)
        return d, m.group(0)
    m = re.search(r"\b(" + _MONTH_RE + r")\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?("
                  + _MONTH_RE + r")", low)
    if m:
        mon = (m.group(1) or m.group(4))[:3]
        day = int(m.group(2) or m.group(3))
        if mon in _MONTHS:
            month = _MONTHS.index(mon) + 1
            year = today.year + (1 if (month, day) < (today.month, today.day) else 0)
            try:
                return date(year, month, min(day, calendar.monthrange(year, month)[1])), m.group(0)
            except ValueError:
                pass
    m = re.search(r"\b(?:on |by )?(?:the )?(\d{1,2})(st|nd|rd|th)\b(?: of (?:the |every |each )?month)?|(\d{1,2})(?:号|日)", low)
    if m:
        day = int(m.group(1) or m.group(3))
        if 1 <= day <= 31:
            return _next_day_of_month(today, day), m.group(0)
    return None


def nice_date(d: date) -> str:
    return f"{d:%a} {d:%b} {d.day}"


def short_date(iso: str) -> str:
    y, mo, day = iso[:10].split("-")
    return f"{_MONTHS[int(mo) - 1].title()} {int(day)}"
