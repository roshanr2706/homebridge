"""Who sees what, and where chat text goes.

One source for the `sharing` block both phones show (main.py), the get_data_sharing tool and the agent's answers
to "can my dad see my spending?" or "is my data sent to China?". It describes what the code enforces:

* The sponsor's view (main.py `sponsor_sees`, `/sponsor/overview`, the role-scoped `/audit`): only the accounts he
  funds, the requests sent to him, safety alerts and a daily count of activity. Never the student's own CAD
  Everyday account, wages, spending or chat.
* The language model (agent.py, tools.py, policy.PendingAction.for_model): the chat text the student types, and
  tool results with account numbers masked. Never full account numbers, confirmation tokens, compliance records
  or anything about the sponsor. With the offline engine nothing leaves the server; with a cloud model the chat
  goes to the configured provider (llm.PRESETS), and the provider, and so the region, is a setting.
* The audit log keeps events without message text (length and safety flags only).
"""
from __future__ import annotations

from typing import Any, Dict

SPONSOR_SEES = ["funded_accounts", "requests", "alerts", "digest"]
SPONSOR_NEVER_SEES = ["everyday", "wages", "spending", "chat"]

# What the student agreed to share at onboarding (shown on both phones).
SHARING: Dict[str, Any] = {
    "scope": "sponsor_funded",
    "summary": "Your sponsor sees the accounts they fund (MYR, linked Malaysian account; CAD Tuition Fund), the "
               "requests sent to them, safety alerts and a daily count of activity. Not your CAD Everyday account, "
               "wages, spending or chat.",
    "sponsor_sees": SPONSOR_SEES,
    "sponsor_never_sees": SPONSOR_NEVER_SEES,
    "consented_at_onboarding": True,
}

# Where the chat goes for each LLM_PROVIDER setting (llm.PRESETS; anything else is a custom endpoint).
MODEL_ROUTES: Dict[str, Dict[str, Any]] = {
    "offline": {"label": "HomeBridge's built-in offline engine", "region": "server", "leaves_server": False},
    "deepseek": {"label": "DeepSeek", "region": "cn", "leaves_server": True, "endpoint": "api.deepseek.com"},
    "deepseek-pro": {"label": "DeepSeek", "region": "cn", "leaves_server": True, "endpoint": "api.deepseek.com"},
    "qwen": {"label": "Qwen (Alibaba Cloud international)", "region": "sg", "leaves_server": True,
             "endpoint": "dashscope-intl.aliyuncs.com"},
    "qwen-cn": {"label": "Qwen (Alibaba Cloud)", "region": "cn", "leaves_server": True,
                "endpoint": "dashscope.aliyuncs.com"},
    "custom": {"label": "a self-hosted model", "region": "self", "leaves_server": True, "endpoint": "LLM_BASE_URL"},
}
MODEL_SEES = ["chat_text", "masked_tool_data"]
MODEL_NEVER_SEES = ["full_account_numbers", "confirm_tokens", "compliance_records", "sponsor_data"]


def data_flow(provider: str) -> Dict[str, Any]:
    """The current model route, what it sees and doesn't, and the alternatives."""
    route = MODEL_ROUTES.get(provider) or MODEL_ROUTES["custom"]
    return {
        "provider": provider if provider in MODEL_ROUTES else "custom",
        **route,
        "model_sees": MODEL_SEES if route["leaves_server"] else [],
        "model_never_sees": MODEL_NEVER_SEES,
        "alternatives": {"outside_mainland_china": ["qwen (Singapore endpoint)", "a self-hosted open-weight model"],
                         "mainland_china": ["deepseek", "qwen-cn"]},
        "audit_log": "Events only: no message text (its length and safety flags).",
        "retention": "Chat history is kept in memory for the session (last 40 messages) and is gone on restart.",
    }
