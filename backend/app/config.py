"""Runtime settings, read from environment variables.

Every security-relevant number lives here so the self-assessment report
can quote one place.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent


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
    llm_timeout: float = field(default_factory=lambda: float(_env("LLM_TIMEOUT", "45")))
    max_agent_steps: int = 8
    demo_mode: bool = field(default_factory=lambda: _env("HB_DEMO_MODE", "1") == "1")
    db_path: str = field(default_factory=lambda: _env("HB_DB", ":memory:"))
    audit_path: str = field(default_factory=lambda: _env("HB_AUDIT", str(VAR_DIR / "audit.jsonl")))
    limits: Limits = field(default_factory=Limits)
    # Demo mode pins the sandbox's "today" so the screenshots, video and docs show the same dates.
    # Tests pass their own date; outside demo mode the real date is used.
    demo_today: str = field(default_factory=lambda: _env("HB_DEMO_TODAY", "2026-10-08"))
    # /demo/reset needs this in an X-Operator header, and only works in demo mode (see R11).
    operator_token: str = field(default_factory=lambda: _env("HB_OPERATOR_TOKEN", "demo-operator"))
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
        if self.demo_mode:
            # Shortened so the cooling period can be shown live on stage.
            self.limits.payee_cooling_seconds = 60
            self.limits.remit_settle = "demo"


def load_settings() -> Settings:
    return Settings()
