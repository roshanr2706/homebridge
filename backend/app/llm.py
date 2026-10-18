"""Provider adapter.

All providers return the same shape:
    {"role": "assistant", "content": str | None,
     "tool_calls": [{"id": str, "name": str, "arguments": dict}],
     "reasoning_content": str | None}

DeepSeek and Qwen (DashScope compatible mode) both speak the OpenAI wire
format, so one client covers both; switching is two environment variables.
Anthropic and OpenAI endpoints are not reachable from mainland China, so they
are not defaults.

Robustness (settings in config.py, tests in test_llm_robustness.py):
* explicit connect and read timeouts on every request, and never longer than what is left of the turn's budget;
* bounded retries on 429, 5xx, timeouts and connection errors, with jittered exponential backoff that honours
  the server's Retry-After; other errors (bad key, bad request) fail at once;
* a circuit breaker (CircuitBreaker, owned by the agent): after a few failed turns in a row chat goes to the
  offline engine for a cool-down period instead of making every user wait for timeouts.
The SDK's own retries are switched off so that this module is the one place retry behaviour is decided.
"""
from __future__ import annotations

import json
import random
import time
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, List, Optional, Protocol

from .config import Settings

PRESETS = {
    "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-flash"},
    "deepseek-pro": {"base_url": "https://api.deepseek.com", "model": "deepseek-v4-pro"},
    "qwen": {"base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    "qwen-cn": {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
}

RETRYABLE = ("timeout", "connection", "rate_limit", "server", "bad_response")


class LLMError(Exception):
    """A model call that failed. `kind` is one of timeout, connection, rate_limit, server, bad_response (all
    retryable), auth, bad_request, budget (the turn ran out of time) or circuit_open."""

    def __init__(self, message: str, kind: str = "error", attempts: int = 1,
                 retry_after: Optional[float] = None) -> None:
        super().__init__(message)
        self.kind, self.attempts, self.retry_after = kind, attempts, retry_after

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE


class Provider(Protocol):
    name: str

    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]: ...


class CircuitBreaker:
    """closed -> (N failures in a row) -> open -> (cool-down passes) -> half_open -> one trial call:
    success closes it, failure opens it again for another cool-down."""

    def __init__(self, failures: int = 3, cooldown: float = 60.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.threshold, self.cooldown, self.clock = max(1, failures), cooldown, clock
        self.state, self.failures, self.opened_at = "closed", 0, 0.0

    def allow(self) -> bool:
        if self.state == "open" and self.clock() - self.opened_at >= self.cooldown:
            self.state = "half_open"
        return self.state != "open"

    def remaining(self) -> float:
        return max(0.0, self.cooldown - (self.clock() - self.opened_at)) if self.state == "open" else 0.0

    def success(self) -> bool:
        """Returns True when this closes a circuit that was open or half-open."""
        recovered = self.state != "closed"
        self.state, self.failures = "closed", 0
        return recovered

    def failure(self) -> bool:
        """Returns True when this failure opens the circuit."""
        self.failures += 1
        if self.state == "half_open" or (self.state == "closed" and self.failures >= self.threshold):
            self.state, self.opened_at = "open", self.clock()
            return True
        return False


def to_wire(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Internal message list -> OpenAI wire format."""
    out = []
    for m in messages:
        if m["role"] == "assistant":
            w: Dict[str, Any] = {"role": "assistant", "content": m.get("content") or ""}
            if m.get("tool_calls"):
                w["tool_calls"] = [
                    {"id": tc["id"], "type": "function",
                     "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"], ensure_ascii=False)}}
                    for tc in m["tool_calls"]
                ]
            if m.get("reasoning_content"):
                # DeepSeek thinking mode requires this to be passed back on tool turns.
                w["reasoning_content"] = m["reasoning_content"]
            out.append(w)
        elif m["role"] == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


def _retry_after(headers: Any) -> Optional[float]:
    """Seconds from a Retry-After (seconds or HTTP date) or retry-after-ms header, if the server sent one."""
    if not headers:
        return None
    ms = headers.get("retry-after-ms")
    if ms:
        try:
            return max(0.0, float(ms) / 1000)
        except ValueError:
            pass
    raw = headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        try:
            return max(0.0, parsedate_to_datetime(raw).timestamp() - time.time())
        except (TypeError, ValueError, IndexError):
            return None


def classify(e: Exception) -> LLMError:
    """SDK exception -> LLMError with a kind that says whether to retry."""
    import openai

    if isinstance(e, LLMError):
        return e
    msg = f"{type(e).__name__}: {e}"[:300]
    if isinstance(e, openai.APITimeoutError):
        return LLMError(msg, "timeout")
    if isinstance(e, openai.APIConnectionError):
        return LLMError(msg, "connection")
    if isinstance(e, openai.APIStatusError):
        status = getattr(e, "status_code", 0) or 0
        ra = _retry_after(getattr(getattr(e, "response", None), "headers", None))
        if status == 429:
            return LLMError(msg, "rate_limit", retry_after=ra)
        if status >= 500:
            return LLMError(msg, "server", retry_after=ra)
        if status in (401, 403):
            return LLMError(msg, "auth")
        return LLMError(msg, "bad_request")
    if isinstance(e, (json.JSONDecodeError, AttributeError, IndexError, KeyError, TypeError)):
        return LLMError(msg, "bad_response")
    return LLMError(msg, "error")


class OpenAICompatProvider:
    supports_deadline = True

    def __init__(self, settings: Settings, preset: str, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, rand: Callable[[], float] = random.random) -> None:
        import httpx
        from openai import OpenAI  # imported lazily so offline mode needs no network package config

        p = PRESETS.get(preset, {})
        self.name = preset
        self.model = settings.llm_model or p.get("model", "")
        base = settings.llm_base_url or p.get("base_url", "")
        if not self.model or not base:
            raise LLMError("Set LLM_BASE_URL and LLM_MODEL for a custom provider", "bad_request")
        if not settings.llm_api_key:
            raise LLMError("LLM_API_KEY is not set", "auth")
        self.settings = settings
        self.timeout = httpx.Timeout(settings.llm_timeout, connect=settings.llm_connect_timeout)
        # max_retries=0: retries happen in chat() below, where backoff, Retry-After and the turn budget are known.
        self.client = OpenAI(api_key=settings.llm_api_key, base_url=base, timeout=self.timeout, max_retries=0)
        self.thinking = settings.llm_thinking
        self.is_deepseek = "deepseek" in base
        self.sleep, self.clock, self.rand = sleep, clock, rand
        self.last_attempts = 0

    def params(self) -> Dict[str, Any]:
        """Sampling and transport settings, recorded in evidence summaries."""
        s = self.settings
        return {"provider": self.name, "model": self.model, "temperature": s.llm_temperature, "seed": s.llm_seed,
                "thinking": bool(self.thinking), "timeout_s": s.llm_timeout, "max_retries": s.llm_max_retries,
                "turn_budget_s": s.llm_turn_budget}

    def backoff(self, attempt: int, retry_after: Optional[float]) -> float:
        cap = self.settings.llm_backoff_max
        if retry_after is not None:
            return min(retry_after, cap)
        base = min(cap, self.settings.llm_backoff_base * (2 ** attempt))
        return base * (0.5 + 0.5 * self.rand())   # equal jitter: never zero, never in lockstep with other clients

    def _create(self, kwargs: Dict[str, Any], deadline: Optional[float]) -> Any:
        """One request with retries. Raises LLMError (with the attempts made) when it gives up."""
        attempts = 0
        while True:
            timeout = self.timeout
            if deadline is not None:
                left = deadline - self.clock()
                if left < 1.0:
                    raise LLMError("The turn's time budget ran out", "budget", attempts)
                if left < self.settings.llm_timeout:
                    import httpx
                    timeout = httpx.Timeout(left, connect=min(self.settings.llm_connect_timeout, left))
            attempts += 1
            try:
                resp = self.client.chat.completions.create(timeout=timeout, **kwargs)
                if not getattr(resp, "choices", None):
                    raise LLMError("The provider returned no choices", "bad_response")
                self.last_attempts = attempts
                return resp
            except Exception as e:  # network, auth, rate limit, malformed body
                err = classify(e)
                err.attempts = attempts
                if not err.retryable or attempts > self.settings.llm_max_retries:
                    self.last_attempts = attempts
                    raise err from e
                wait = self.backoff(attempts - 1, err.retry_after)
                if deadline is not None and self.clock() + wait >= deadline - 1.0:
                    self.last_attempts = attempts
                    raise LLMError(f"{err} (no time left in the turn to retry)", "budget", attempts) from e
                self.sleep(wait)

    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]],
             deadline: Optional[float] = None) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {"model": self.model, "messages": to_wire(messages),
                                  "temperature": self.settings.llm_temperature}
        if self.settings.llm_seed is not None:
            kwargs["seed"] = self.settings.llm_seed
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if self.is_deepseek:
            kwargs["extra_body"] = {"thinking": {"type": "enabled" if self.thinking else "disabled"}}
        resp = self._create(kwargs, deadline)
        try:
            msg = resp.choices[0].message
            calls = []
            for tc in msg.tool_calls or []:
                raw = tc.function.arguments or "{}"
                try:
                    args = json.loads(raw)
                except json.JSONDecodeError:
                    args = {"_unparseable": raw[:2000]}
                calls.append({"id": tc.id or f"call_{len(calls)}", "name": tc.function.name or "", "arguments": args})
            return {"role": "assistant", "content": msg.content, "tool_calls": calls,
                    "reasoning_content": getattr(msg, "reasoning_content", None)}
        except (AttributeError, IndexError, TypeError) as e:
            raise LLMError(f"Malformed response: {type(e).__name__}", "bad_response") from e

    def complete_json(self, system: str, user: str, timeout: float, max_tokens: int = 400) -> Dict[str, Any]:
        """One small JSON-only completion (the sponsor's second opinion): temperature 0, no tools, no retries,
        a short timeout. Raises LLMError when the call fails or the answer is not a JSON object."""
        import httpx

        kwargs: Dict[str, Any] = {
            "model": self.model, "temperature": 0, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "timeout": httpx.Timeout(timeout, connect=min(self.settings.llm_connect_timeout, timeout)),
        }
        if self.settings.llm_seed is not None:
            kwargs["seed"] = self.settings.llm_seed
        if self.is_deepseek:
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        try:
            resp = self.client.chat.completions.create(**kwargs)
            text = resp.choices[0].message.content or ""
        except Exception as e:
            raise classify(e) from e
        return parse_json_object(text)


def parse_json_object(text: str) -> Dict[str, Any]:
    """The JSON object in a model answer: tolerates raw newlines inside strings and text around the object."""
    text = (text or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise LLMError("The answer was not a JSON object", "bad_response")
    try:
        out = json.loads(text[start:end + 1], strict=False)
    except json.JSONDecodeError as e:
        raise LLMError(f"The answer was not valid JSON: {e}", "bad_response") from e
    if not isinstance(out, dict):
        raise LLMError("The answer was not a JSON object", "bad_response")
    return out


def make_provider(settings: Settings) -> Provider:
    kind = settings.llm_provider.lower()
    if kind == "offline":
        from .offline_engine import OfflineEngine

        return OfflineEngine()
    return OpenAICompatProvider(settings, kind if kind in PRESETS else "custom")
