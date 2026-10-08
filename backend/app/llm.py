"""Provider adapter.

All providers return the same shape:
    {"role": "assistant", "content": str | None,
     "tool_calls": [{"id": str, "name": str, "arguments": dict}],
     "reasoning_content": str | None}

DeepSeek and Qwen (DashScope compatible mode) both speak the OpenAI wire
format, so one client covers both; switching is two environment variables.
Anthropic and OpenAI endpoints are not reachable from mainland China, so they
are not defaults.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Protocol

from .config import Settings

PRESETS = {
    "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-flash"},
    "deepseek-pro": {"base_url": "https://api.deepseek.com", "model": "deepseek-v4-pro"},
    "qwen": {"base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    "qwen-cn": {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
}


class LLMError(Exception):
    pass


class Provider(Protocol):
    name: str

    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]: ...


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


class OpenAICompatProvider:
    def __init__(self, settings: Settings, preset: str) -> None:
        from openai import OpenAI  # imported lazily so offline mode needs no network package config

        p = PRESETS.get(preset, {})
        self.name = preset
        self.model = settings.llm_model or p.get("model", "")
        base = settings.llm_base_url or p.get("base_url", "")
        if not self.model or not base:
            raise LLMError("Set LLM_BASE_URL and LLM_MODEL for a custom provider")
        if not settings.llm_api_key:
            raise LLMError("LLM_API_KEY is not set")
        self.client = OpenAI(api_key=settings.llm_api_key, base_url=base, timeout=settings.llm_timeout, max_retries=2)
        self.thinking = settings.llm_thinking
        self.is_deepseek = "deepseek" in base

    def chat(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {"model": self.model, "messages": to_wire(messages), "temperature": 0.2}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if self.is_deepseek:
            kwargs["extra_body"] = {"thinking": {"type": "enabled" if self.thinking else "disabled"}}
        try:
            resp = self.client.chat.completions.create(**kwargs)
        except Exception as e:  # network, auth, rate limit
            raise LLMError(f"{type(e).__name__}: {e}") from e
        msg = resp.choices[0].message
        calls = []
        for tc in msg.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"_unparseable": tc.function.arguments}
            calls.append({"id": tc.id, "name": tc.function.name, "arguments": args})
        return {"role": "assistant", "content": msg.content, "tool_calls": calls,
                "reasoning_content": getattr(msg, "reasoning_content", None)}


def make_provider(settings: Settings) -> Provider:
    kind = settings.llm_provider.lower()
    if kind == "offline":
        from .offline_engine import OfflineEngine

        return OfflineEngine()
    return OpenAICompatProvider(settings, kind if kind in PRESETS else "custom")
