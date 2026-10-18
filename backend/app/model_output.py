"""Checks on what the language model sends back, before any of it is acted on or shown.

* validate_call: a tool call is checked against the tool's own JSON schema (tools.REGISTRY) before it runs. An
  unknown tool, arguments that are not a JSON object, a missing required field, a wrong type or a value outside an
  enum comes back to the model as a structured error it can correct (agent.py caps the corrections per turn).
* guard_reply: the final text is scanned before it reaches the user. Full account numbers are masked, strings
  shaped like confirmation tokens are removed, and a reply that echoes the system prompt is replaced.
* explicit_command / real_question: used by the agent's one-time reliability nudge, which fires only when the
  user gave a plain "pay hydro 2000"-style command and the model stopped without a draft or a real question.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ----------------------------------------------------------------------------- tool-call validation
_NUMERIC = re.compile(r"^\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s*k?\s*$", re.I)


def _type_ok(kind: str, v: Any) -> bool:
    if kind == "string":
        return isinstance(v, (str, int, float)) and not isinstance(v, bool)
    if kind == "number":
        if isinstance(v, bool):
            return False
        if isinstance(v, (int, float)):
            return True
        # Models sometimes quote numbers ("2000", "1,150.50"); the tools parse those. Words and "1e9" are not.
        return isinstance(v, str) and bool(_NUMERIC.match(v)) and any(c.isdigit() for c in v)
    if kind == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if kind == "boolean":
        return isinstance(v, bool)
    if kind == "array":
        return isinstance(v, list)
    if kind == "object":
        return isinstance(v, dict)
    return True


def validate_call(name: str, args: Any, registry: Dict[str, Dict[str, Any]],
                  allowed: Optional[Iterable[str]] = None) -> Optional[Dict[str, Any]]:
    """None when the call may run; otherwise the structured error to hand back to the model."""
    names = sorted(registry) if allowed is None else sorted(n for n in registry if n in set(allowed))
    if not name or name not in names:
        return {"error": f"There is no tool called '{str(name)[:60]}'. Call one of the available tools, or "
                         "answer without a tool.", "error_type": "unknown_tool", "available_tools": names}
    if isinstance(args, dict) and "_unparseable" in args:
        return {"error": "The arguments were not valid JSON. Call the tool again with a JSON object that "
                         "matches its parameters.", "error_type": "invalid_json"}
    if not isinstance(args, dict):
        return {"error": "The arguments must be a JSON object.", "error_type": "invalid_arguments"}
    schema = registry[name]["spec"]["function"]["parameters"]
    props: Dict[str, Any] = schema.get("properties") or {}
    problems: List[str] = []
    for req in schema.get("required") or []:
        if args.get(req) in (None, ""):
            problems.append(f"'{req}' is required")
    for key, val in args.items():
        spec = props.get(key)
        if spec is None or val is None:
            continue   # extra keys are ignored by the tools; null means "not given"
        kind = spec.get("type")
        if kind and not _type_ok(kind, val):
            problems.append(f"'{key}' must be a {kind}")
            continue
        enum = spec.get("enum")
        if enum and str(val).lower() not in {str(e).lower() for e in enum}:
            problems.append(f"'{key}' must be one of {', '.join(map(str, enum))}")
    if problems:
        return {"error": "Invalid arguments for " + name + ": " + "; ".join(problems) + ". Fix them and call the "
                         "tool again, or ask the user for what is missing.", "error_type": "schema",
                "problems": problems}
    return None


# ----------------------------------------------------------------------------- final-reply guard
ACCOUNT_NUMBER = re.compile(r"\b\d{4}-\d{4}-(\d{4})\b")
# Confirmation tokens are secrets.token_urlsafe(24): 32 URL-safe characters. Anything that long, made of those
# characters and mixing letters with digits (so a long ordinary word is left alone), is removed. Hashes go too.
TOKEN_LIKE = re.compile(r"(?<![A-Za-z0-9_\-/.@])(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{24,}"
                        r"(?![A-Za-z0-9_\-/.@])")
TOKEN_LABEL = re.compile(r"(confirm(?:ation)?[_ ]token|token_hash|confirm_token)\s*[:=]\s*\S+", re.I)
PROMPT_LEAK_REPLY = ("I can't share my internal instructions. I can help with your balances, payments, exchange "
                     "rates, tuition and scam checks.")


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower())


class PromptFingerprint:
    """Recognises a reply that reproduces the system prompt: the version marker, a section heading, or long
    word-for-word runs from two or more of its lines (one shared phrase can be a coincidence)."""

    def __init__(self, prompt: str, markers: Iterable[str], run: int = 12) -> None:
        self.markers = [m.lower() for m in markers if m]
        self.run = run
        self.lines: List[set] = []
        for line in prompt.splitlines():
            w = _words(line)
            if len(w) >= run:
                self.lines.append({" ".join(w[i:i + run]) for i in range(len(w) - run + 1)})

    def leaks(self, reply: str) -> bool:
        low = (reply or "").lower()
        if any(m in low for m in self.markers):
            return True
        w = _words(reply)
        grams = {" ".join(w[i:i + self.run]) for i in range(len(w) - self.run + 1)}
        return sum(1 for line in self.lines if line & grams) >= 2


def guard_reply(text: str, fingerprint: Optional[PromptFingerprint] = None) -> Tuple[str, List[str]]:
    """(safe text, what was redacted)."""
    text = text or ""
    found: List[str] = []
    if fingerprint and fingerprint.leaks(text):
        return PROMPT_LEAK_REPLY, ["system_prompt"]
    out = ACCOUNT_NUMBER.sub(r"••••\1", text)
    if out != text:
        found.append("account_number")
    t2 = TOKEN_LABEL.sub(lambda m: m.group(1) + ": [removed]", out)
    t2 = TOKEN_LIKE.sub("[removed]", t2)
    if t2 != out:
        found.append("token")
    return t2, found


# ----------------------------------------------------------------------------- explicit commands
_VERB_EN = r"\b(pay|send|transfer|e-?transfer|convert|change|exchange|move|top ?up|put)\b"
_VERB_MS = r"\b(bayar|bayarkan|hantar|kirim|pindah|pindahkan|tukar|tukarkan|masukkan)\b"
_VERB_ZH = r"(支付|付款|付|转账|转|汇款|汇|兑换|换|交)"
_AMOUNT = re.compile(r"(?<![\w.-])(?:rm|cad|myr|usd|\$|c\$)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s?(k\b|千|万)?",
                     re.I)
_CURRENCY = re.compile(r"\b(myr|cad|usd|rm|ringgit|dollars?|ringgit)\b|令吉|加元|加币|马币|美元", re.I)
_QUESTION_START = re.compile(
    r"^\s*(can|could|should|shall|would|will|do|does|did|is|are|am|how|what|when|why|which|where|who|if|"
    r"boleh(kah)?|adakah|patutkah|bagaimana|berapa|kenapa|bila|apa)\b", re.I)
_NEGATION = re.compile(r"\b(don'?t|do not|never|not|no|stop|cancel|jangan|tak|tidak|batal)\b|不要|别|不用|取消", re.I)
_SELF_REFERENCE = re.compile(r"\b(confirm|approve|undo|refund)\b|确认|批准", re.I)


def explicit_command(text: str, payee_words: Iterable[str]) -> Optional[Dict[str, Any]]:
    """{"kind": "payment" | "conversion", "amount": float, "payee_word": str | None} when the message is a plain
    instruction to move money with one amount and a payee (or currencies), e.g. "pay hydro 2000" or "convert
    RM 3000 to CAD". None for questions, negations, conditionals, confirmations, anything long or multi-sentence
    (pasted text), several amounts, and amounts that are not plain positive numbers."""
    t = (text or "").strip()
    if not t or len(t) > 120 or "\n" in t or t.count(".") > 2:
        return None
    if t.endswith(("?", "？")) or "吗" in t or "呢" in t or _QUESTION_START.search(t):
        return None
    if _NEGATION.search(t) or _SELF_REFERENCE.search(t) or re.search(r"[\"'“”‘’].{3,}[\"'“”‘’]", t):
        return None
    if re.search(r"(?<![\w])-\s?\d|\d[eE][+-]?\d", t):
        return None   # "-50", "1e9": the prompt says ask for the amount
    low = t.lower()
    verb = re.search(_VERB_EN, low) or re.search(_VERB_MS, low) or re.search(_VERB_ZH, t)
    if not verb:
        return None
    amounts = []
    for m in _AMOUNT.finditer(t):
        if not m.group(1):
            continue
        v = float(m.group(1).replace(",", "")) * {"k": 1000, "千": 1000, "万": 10000}.get((m.group(2) or "").lower(), 1)
        if v > 0:
            amounts.append(v)
    if len(set(amounts)) != 1:
        return None
    amount = amounts[0]
    word = verb.group(0).lower()
    currencies = {m.lower() for m in _CURRENCY.findall(low) if m}
    if word in ("convert", "change", "exchange", "tukar", "tukarkan", "兑换", "换") or len(currencies) >= 2:
        return {"kind": "conversion", "amount": amount, "payee_word": None} if _CURRENCY.search(t) else None
    for w in sorted({w.lower() for w in payee_words if w and len(w) >= 3}, key=len, reverse=True):
        if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low) or (not w.isascii() and w in t):
            return {"kind": "payment", "amount": amount, "payee_word": w}
    return None


# A question that only asks permission ("want me to draft it?", "shall I go ahead?") or re-checks a clear amount
# is not the one specific question the prompt allows; the prompt already tells the model not to ask those.
_PERMISSION_ASK = re.compile(
    r"(want me to|shall i|should i|do you want|would you like( me)? to|like me to|go ahead|proceed|"
    r"is (that|this|it)( the)? (right|correct|ok)|did you mean|are you sure|just confirm|confirm (that|this)|"
    r"draft it anyway|nak saya|mahu saya|patutkah saya|要我|需要我|是否要|确定要|对吗|是吗)", re.I)


def real_question(reply: str) -> bool:
    """True when the reply asks the user something specific (a missing payee, amount or choice)."""
    qs = [q for q in re.split(r"(?<=[?？])", reply or "") if q.strip().endswith(("?", "？"))]
    return any(not _PERMISSION_ASK.search(q) for q in qs)
