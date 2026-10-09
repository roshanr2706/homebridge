"""The real-LLM path, without a network.

Runs the agent with the OpenAI-compatible provider (as used for DeepSeek and
Qwen) against a mocked HTTP transport, and checks the wire format both ways:
tool specs and tool results going out, tool calls coming back, and the
offline fallback when the API fails.
"""
import json

import httpx
import pytest
from openai import OpenAI

from app.config import Settings
from app.harness import fresh
from app.llm import OpenAICompatProvider
from app.seed import STUDENT


def completion(message, finish="stop"):
    return {
        "id": "chatcmpl-test", "object": "chat.completion", "created": 0, "model": "deepseek-flash",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def make_provider(handler, provider="deepseek"):
    s = Settings()
    s.llm_api_key = "sk-test"
    p = OpenAICompatProvider(s, provider)
    p.client = OpenAI(api_key="sk-test", base_url=str(p.client.base_url), max_retries=0,
                      http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    return p


def test_tool_call_round_trip():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(200, json=completion({
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "call_1", "type": "function",
                                "function": {"name": "get_balances", "arguments": '{"total_currency": "CAD"}'}}],
            }, "tool_calls"))
        return httpx.Response(200, json=completion({"role": "assistant", "content": "You have about CAD 14,230."}))

    st = fresh(provider=make_provider(handler))
    r = st.agent.run(STUDENT, "student", "s", "how much money do I have")

    assert r.reply == "You have about CAD 14,230." and not r.fallback
    assert [t["tool"] for t in r.trace] == ["get_balances"]
    assert any(c["type"] == "balances" for c in r.cards)

    first, second = requests
    assert first["model"] == "deepseek-flash"
    assert first["extra_body"]["thinking"]["type"] == "disabled" if "extra_body" in first else \
        first["thinking"]["type"] == "disabled"
    names = {t["function"]["name"] for t in first["tools"]}
    assert {"get_balances", "prepare_transfer", "check_message_for_scam"} <= names
    assert not names & {"confirm_action", "approve", "set_limits", "execute_transfer"}
    assert first["messages"][0]["role"] == "system"

    # Second request carries the assistant tool call and the matching tool result.
    asst = next(m for m in second["messages"] if m["role"] == "assistant" and m.get("tool_calls"))
    tool = next(m for m in second["messages"] if m["role"] == "tool")
    assert asst["tool_calls"][0]["id"] == tool["tool_call_id"] == "call_1"
    payload = json.loads(tool["content"])
    assert payload["tool"] == "get_balances" and "untrusted_data" in payload
    # Masked numbers only, even inside tool results sent to the provider.
    raw = {row[0] for row in st.bank.db.execute("SELECT number FROM accounts")}
    assert not any(n in tool["content"] for n in raw)


def test_api_failure_falls_back_to_offline_engine():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": {"message": "overloaded"}})

    st = fresh(provider=make_provider(handler))
    r = st.agent.run(STUDENT, "student", "s", "How much money do I have?")
    assert r.fallback and r.provider == "offline"
    assert "CAD Everyday" in r.reply
    assert any(e["event"] == "llm_error" for e in st.audit.entries())


def test_unparseable_tool_arguments_do_not_crash():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(200, json=completion({
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "c1", "type": "function",
                                "function": {"name": "prepare_transfer", "arguments": "{not json"}}],
            }, "tool_calls"))
        return httpx.Response(200, json=completion({"role": "assistant", "content": "Which payee?"}))

    st = fresh(provider=make_provider(handler))
    r = st.agent.run(STUDENT, "student", "s", "pay")
    assert r.reply == "Which payee?"
    assert r.trace[0]["ok"] is False
    assert not st.policy.actions


@pytest.mark.parametrize("preset,url", [("qwen", "dashscope-intl.aliyuncs.com"), ("deepseek-pro", "api.deepseek.com")])
def test_presets_resolve(preset, url):
    s = Settings()
    s.llm_api_key = "sk-test"
    p = OpenAICompatProvider(s, preset)
    assert url in str(p.client.base_url)
