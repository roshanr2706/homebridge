"""Runtime settings, read from environment variables.

Every security-relevant number lives here so the self-assessment report
can quote one place.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent
# The default operator token in demo mode. The web app's default EXPO_PUBLIC_OPERATOR_TOKEN matches it, so anyone who
# can load the demo page can use the Demo menu: set HB_OPERATOR_TOKEN and EXPO_PUBLIC_OPERATOR_TOKEN to a random value
# at the venue.
DEMO_OPERATOR_TOKEN = "demo-operator"


def load_dotenv(path: Path = BASE_DIR / ".env") -> None:
    """Read KEY=VALUE lines from backend/.env (gitignored) so a key works with plain uvicorn too.
    Variables already set in the environment win, so tests (which pin LLM_PROVIDER=offline) stay offline."""
    if os.getenv("HB_NO_DOTENV") or not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()
VAR_DIR = Path(os.getenv("HB_VAR_DIR", BASE_DIR / "var"))


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


@dataclass
class Limits:
    # Student may confirm a single payment up to this amount (CAD-equivalent) alone.
    single_cad: float = 1500.0
    # Total student-confirmed outflow per rolling 24h (CAD-equivalent).
    daily_cad: float = 3000.0
    # New payees wait this long after sponsor approval before first use.
    payee_cooling_seconds: int = 24 * 3600
    # Pending actions expire after this many seconds.
    pending_ttl_seconds: int = 600
    # Max money drafts per account owner per hour, across all chat sessions (slows down scripted abuse).
    drafts_per_hour: int = 20
    # Risk score at or above which an action needs the sponsor regardless of size.
    sponsor_risk_threshold: int = 50
    # How long an approved remittance stays "in transit" before it is credited (remit.py): 'business_days' uses
    # each provider's real speed (1 to 4 business days, same day, instant); 'demo' uses a few seconds so the
    # whole timeline can be shown live on stage.
    remit_settle: str = "business_days"


@dataclass
class Settings:
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "offline"))
    # Leave base URL and model empty to use the preset for LLM_PROVIDER (see llm.PRESETS).
    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL", ""))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", ""))
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY", ""))
    llm_thinking: bool = field(default_factory=lambda: _env("LLM_THINKING", "0") == "1")
    # Provider robustness (llm.py). One request may take llm_timeout seconds to answer (connecting: at most
    # llm_connect_timeout); 429, 5xx, timeouts and connection errors are retried llm_max_retries times with
    # jittered exponential backoff (llm_backoff_base * 2^n, capped at llm_backoff_max, or the server's
    # Retry-After when it sends one). A whole chat turn gets llm_turn_budget seconds of model time; when it runs
    # out, the turn finishes on the offline engine. After llm_breaker_failures failed turns in a row the circuit
    # opens and chat uses the offline engine for llm_breaker_cooldown seconds (the reply says so).
    llm_timeout: float = field(default_factory=lambda: float(_env("LLM_TIMEOUT", "30")))
    llm_connect_timeout: float = field(default_factory=lambda: float(_env("LLM_CONNECT_TIMEOUT", "5")))
    llm_max_retries: int = field(default_factory=lambda: int(_env("LLM_MAX_RETRIES", "2")))
    llm_backoff_base: float = field(default_factory=lambda: float(_env("LLM_BACKOFF_BASE", "0.5")))
    llm_backoff_max: float = field(default_factory=lambda: float(_env("LLM_BACKOFF_MAX", "8")))
    llm_turn_budget: float = field(default_factory=lambda: float(_env("LLM_TURN_BUDGET", "75")))
    llm_breaker_failures: int = field(default_factory=lambda: int(_env("LLM_BREAKER_FAILURES", "3")))
    llm_breaker_cooldown: float = field(default_factory=lambda: float(_env("LLM_BREAKER_COOLDOWN", "60")))
    # Sampling. The evidence scripts set LLM_TEMPERATURE=0 (and a seed where the provider accepts one) so runs
    # are as repeatable as the provider allows; SUMMARY.md records what was used.
    llm_temperature: float = field(default_factory=lambda: float(_env("LLM_TEMPERATURE", "0.2")))
    llm_seed: Optional[int] = field(default_factory=lambda: int(_env("LLM_SEED", "")) if _env("LLM_SEED", "") else None)
    # Model-output validation (agent.py): malformed tool calls handed back to the model for correction per turn,
    # and identical repeated calls refused (not run again), before the turn ends with a plain reply. loop_guard
    # switches the repeat check off (tests use that to show the draft rate limit holds on its own).
    max_tool_corrections: int = 3
    max_repeat_calls: int = 2
    loop_guard: bool = True
    # One internal "draft it now or ask one specific question" round when the user gave an explicit payment
    # command and the model stopped without a draft or a real question (agent.py).
    llm_nudge: bool = field(default_factory=lambda: _env("LLM_NUDGE", "1") == "1")
    # Sponsor second opinion (reviewer.py): a separate small model call, JSON only, temperature 0.
    reviewer_timeout: float = field(default_factory=lambda: float(_env("HB_REVIEWER_TIMEOUT", "6")))
    reviewer_model: bool = field(default_factory=lambda: _env("HB_REVIEWER_MODEL", "1") == "1")
    max_agent_steps: int = 8
    demo_mode: bool = field(default_factory=lambda: _env("HB_DEMO_MODE", "1") == "1")
    db_path: str = field(default_factory=lambda: _env("HB_DB", ":memory:"))
    audit_path: str = field(default_factory=lambda: _env("HB_AUDIT", str(VAR_DIR / "audit.jsonl")))
    limits: Limits = field(default_factory=Limits)
    # Demo mode pins the sandbox's "today" so the screenshots, video and docs show the same dates.
    # Tests pass their own date; outside demo mode the real date is used.
    demo_today: str = field(default_factory=lambda: _env("HB_DEMO_TODAY", "2026-10-08"))
    # /demo/reset and the other stage controls need this in an X-Operator header, and only work in demo mode (see
    # R11). Unset: demo mode uses the well-known DEMO_OPERATOR_TOKEN (a stage convenience, not a control: the web
    # app ships it, security_self_assessment.md R22); outside demo mode a random token is generated at startup.
    operator_token: str = field(default_factory=lambda: _env("HB_OPERATOR_TOKEN", ""))
    # Browsers may call the API only from these origins. The exported web app is served by the API itself
    # (same origin, no CORS needed); the defaults cover the Expo dev server and a local API.
    cors_origins: List[str] = field(default_factory=lambda: [
        o.strip() for o in _env("HB_CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081,"
                                "http://localhost:8000,http://127.0.0.1:8000,http://localhost:19006").split(",")
        if o.strip()])

    def pinned_today(self) -> Optional[date]:
        """The fixed demo date, or None outside demo mode (or when HB_DEMO_TODAY is empty)."""
        if not self.demo_mode or not self.demo_today:
            return None
        return date.fromisoformat(self.demo_today)

    def __post_init__(self) -> None:
        if not self.operator_token:
            self.operator_token = DEMO_OPERATOR_TOKEN if self.demo_mode else secrets.token_urlsafe(32)
        if self.demo_mode:
            # Shortened so the cooling period can be shown live on stage.
            self.limits.payee_cooling_seconds = 60
            self.limits.remit_settle = "demo"


def load_settings() -> Settings:
    return Settings()
