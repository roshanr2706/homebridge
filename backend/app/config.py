"""Runtime settings, read from environment variables.

Every security-relevant number lives here so the self-assessment report
can quote one place.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
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
    # Max transfer drafts per session per hour (slows down scripted abuse).
    drafts_per_hour: int = 20
    # Risk score at or above which an action needs the sponsor regardless of size.
    sponsor_risk_threshold: int = 50


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

    def __post_init__(self) -> None:
        if self.demo_mode:
            # Shortened so the cooling period can be shown live on stage.
            self.limits.payee_cooling_seconds = 60


def load_settings() -> Settings:
    return Settings()
