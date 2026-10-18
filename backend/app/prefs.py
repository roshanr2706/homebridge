"""Per-person app preferences and the consents given at onboarding.

Each phone runs its own onboarding on first use (app: Onboarding.tsx). What it records, per person, in the sandbox
database (bank.user_prefs):

* display_name: what the app calls you. Stripped, control characters removed, whitespace collapsed, at most 40
  characters. The only free text kept, and it never goes into the audit log (only whether it changed).
* language ('en' | 'zh') and skin ('neo' | 'superapp'): the app's look, switchable later in Settings.
* consents, with the time and what was shown:
  - student: sponsor_sharing (what the sponsor sees, privacy.SHARING), ai_processing (which model provider
    processes chat text and where, privacy.MODEL_ROUTES), and offline_only, a preference to keep chat on the
    built-in offline engine whatever the server is configured with (agent.py honours it per user).
  - sponsor: sponsor_terms (the approval PIN and what he can and cannot see).

Every save is audited as `prefs_updated`, and every consent decision as `consent_recorded`, with booleans and the
provider/region only. /demo/reset drops the table with the rest of the sandbox, so onboarding runs again, unless the
operator asks it to keep onboarding ({"keep_onboarding": true}, the Demo menu's default "Reset (keep setup)").
"""
from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Dict, Optional

from .audit import AuditLog
from .bank import Bank
from .privacy import MODEL_ROUTES

LANGUAGES = ("en", "zh")
SKINS = ("neo", "superapp")
NAME_MAX = 40
# Bumped when the wording of a consent screen changes, so a stored consent says which text was agreed to.
CONSENT_VERSION = "2026-10"
# The look each person starts with before choosing: the dark neo-bank for the student, the super-app for the sponsor.
DEFAULT_SKIN = {"student": "neo", "sponsor": "superapp"}


class PrefsError(ValueError):
    """A refused preference or consent. The message is safe to show."""


def clean_name(raw: Optional[str], fallback: str) -> str:
    """Strip, drop control and format characters, collapse whitespace, cap the length."""
    text = "".join(c for c in (raw or "") if unicodedata.category(c)[0] != "C")
    text = re.sub(r"\s+", " ", text).strip()[:NAME_MAX].strip()
    return text or fallback


def route(provider: str) -> Dict[str, Any]:
    r = MODEL_ROUTES.get(provider) or MODEL_ROUTES["custom"]
    return {"provider": provider if provider in MODEL_ROUTES else "custom", "label": r["label"],
            "region": r["region"], "leaves_server": r["leaves_server"]}


def defaults(role: str, name: str) -> Dict[str, Any]:
    return {"display_name": name, "language": "en", "skin": DEFAULT_SKIN.get(role, "neo"), "onboarded_at": None,
            "consents": {}}


def get(bank: Bank, user_id: str, role: str) -> Dict[str, Any]:
    u = bank.user(user_id) or {}
    out = defaults(role, u.get("name") or user_id)
    stored = bank.load_prefs(user_id)
    if stored:
        out.update({k: stored[k] for k in out if k in stored})
    return out


def consent_covers(ai: Optional[Dict[str, Any]], provider: str) -> bool:
    """True when a recorded ai_processing consent was given for this provider (or another name for the same
    service in the same region, e.g. deepseek and deepseek-pro). A consent to the offline engine, or to a
    provider in another region, does not cover a cloud model."""
    if not ai or not ai.get("agreed"):
        return False
    now, then = route(provider), route(str(ai.get("provider") or ""))
    return then["provider"] == now["provider"] or (
        then["label"] == now["label"] and then["region"] == now["region"] == ai.get("region"))


def offline_only(bank: Bank, user_id: str, provider: str) -> bool:
    """True when this person's chat must stay on the offline engine with the server's current provider: she chose
    "offline engine only", she has not onboarded yet (no consent exists), or her recorded consent does not cover
    the current provider and region (the server was restarted with a different model: she reviews it in Settings).
    """
    p = bank.load_prefs(user_id) or {}
    c = p.get("consents") or {}
    if (c.get("offline_only") or {}).get("value"):
        return True
    if not p.get("onboarded_at"):
        return True
    if not route(provider)["leaves_server"]:
        return False   # the server runs the offline engine anyway
    return not consent_covers(c.get("ai_processing"), provider)


def consent_stale(bank: Bank, user_id: str, provider: str) -> bool:
    """True when she onboarded and didn't choose offline-only, but her consent names a different provider or region
    than the current one. Settings then shows "Your AI provider changed: review consent"."""
    p = bank.load_prefs(user_id) or {}
    c = p.get("consents") or {}
    if not p.get("onboarded_at") or (c.get("offline_only") or {}).get("value"):
        return False
    return route(provider)["leaves_server"] and not consent_covers(c.get("ai_processing"), provider)


def seed_consent(bank: Bank, user_id: str, provider: str) -> None:
    """For the test and evidence harness only: the student has onboarded and agreed to the configured provider,
    as she would have in the app. Not audited (no person did it)."""
    u = bank.user(user_id) or {}
    now = round(time.time(), 3)
    bank.save_prefs(user_id, {**defaults("student", u.get("name") or user_id), "onboarded_at": now, "consents": {
        "sponsor_sharing": {"agreed": True, "at": now, "version": CONSENT_VERSION, "scope": "sponsor_funded"},
        "ai_processing": {"agreed": True, "at": now, "version": CONSENT_VERSION, **route(provider)},
        "offline_only": {"value": False, "at": now}}})


def _agree_ai(audit: AuditLog, user_id: str, provider: str, consents: Dict[str, Any]) -> bool:
    """Records agreement to the current cloud provider unless her consent already covers it. True if recorded."""
    r = route(provider)
    if not r["leaves_server"] or consent_covers(consents.get("ai_processing"), provider):
        return False
    consents["ai_processing"] = {"agreed": True, "at": round(time.time(), 3), "version": CONSENT_VERSION, **r}
    audit.record("consent_recorded", user_id, owner=user_id, consent="ai_processing", agreed=True,
                 version=CONSENT_VERSION, provider=r["provider"], region=r["region"], leaves_server=r["leaves_server"])
    return True


def _check(language: Optional[str], skin: Optional[str]) -> None:
    if language is not None and language not in LANGUAGES:
        raise PrefsError("language must be 'en' or 'zh'")
    if skin is not None and skin not in SKINS:
        raise PrefsError("skin must be 'neo' or 'superapp'")


def onboard(bank: Bank, audit: AuditLog, user_id: str, role: str, provider: str, *, display_name: str,
            language: str, skin: str, consents: Dict[str, bool]) -> Dict[str, Any]:
    _check(language, skin)
    now = round(time.time(), 3)
    current = get(bank, user_id, role)
    recorded: Dict[str, Any] = {}
    if role == "student":
        if not consents.get("sponsor_sharing"):
            raise PrefsError("Agree to what your sponsor will see to finish setting up.")
        ai, offline = bool(consents.get("ai_processing")), bool(consents.get("offline_only"))
        r = route(provider)
        if r["leaves_server"] and not (ai or offline):
            raise PrefsError("Agree to how chat is processed, or choose the offline engine only.")
        recorded = {
            "sponsor_sharing": {"agreed": True, "at": now, "version": CONSENT_VERSION, "scope": "sponsor_funded"},
            # With the offline engine there is nothing to agree to beyond the notice: chat stays on the server.
            "ai_processing": {"agreed": ai or not r["leaves_server"], "at": now, "version": CONSENT_VERSION,
                              "provider": r["provider"], "region": r["region"], "leaves_server": r["leaves_server"]},
            "offline_only": {"value": offline, "at": now},
        }
    else:
        if not consents.get("sponsor_terms"):
            raise PrefsError("Confirm you have read how approvals and your view work to finish setting up.")
        recorded = {"sponsor_terms": {"agreed": True, "at": now, "version": CONSENT_VERSION}}
    name = clean_name(display_name, current["display_name"])
    data = {"display_name": name, "language": language, "skin": skin, "onboarded_at": now, "consents": recorded}
    bank.save_prefs(user_id, data)
    for key, val in recorded.items():
        extra = {k: val[k] for k in ("provider", "region", "leaves_server") if k in val}
        audit.record("consent_recorded", user_id, owner=user_id, consent=key,
                     agreed=bool(val.get("agreed", val.get("value"))), version=CONSENT_VERSION, **extra)
    audit.record("prefs_updated", user_id, owner=user_id, source="onboarding", language=language, skin=skin,
                 display_name_changed=name != current["display_name"], name_chars=len(name))
    return get(bank, user_id, role)


def update(bank: Bank, audit: AuditLog, user_id: str, role: str, provider: str, *,
           display_name: Optional[str] = None, language: Optional[str] = None, skin: Optional[str] = None,
           offline: Optional[bool] = None, ai_consent: Optional[bool] = None) -> Dict[str, Any]:
    """Later changes from Settings. Only the fields sent change. Turning "offline engine only" off in Settings,
    where the provider and its region are shown next to the switch, is recorded as agreeing to that processing;
    so is ai_consent=True, her answer to "Your AI provider changed: review consent"."""
    _check(language, skin)
    if (offline is not None or ai_consent is not None) and role != "student":
        raise PrefsError("Only the student's chat has a model setting.")
    stored = bank.load_prefs(user_id) or {}
    current = get(bank, user_id, role)
    data = {**current, **{k: v for k, v in stored.items() if k not in current}}
    changed: Dict[str, Any] = {}
    if language is not None and language != current["language"]:
        data["language"] = changed["language"] = language
    if skin is not None and skin != current["skin"]:
        data["skin"] = changed["skin"] = skin
    if display_name is not None:
        name = clean_name(display_name, current["display_name"])
        if name != current["display_name"]:
            data["display_name"] = name
            changed["display_name_changed"] = True
            changed["name_chars"] = len(name)
    consents = dict(current["consents"])
    if offline is not None and bool((consents.get("offline_only") or {}).get("value")) != offline:
        now = round(time.time(), 3)
        consents["offline_only"] = {"value": offline, "at": now}
        audit.record("consent_recorded", user_id, owner=user_id, consent="offline_only", agreed=offline,
                     version=CONSENT_VERSION)
        if not offline:
            _agree_ai(audit, user_id, provider, consents)
        data["consents"] = consents
    if ai_consent and _agree_ai(audit, user_id, provider, consents):
        data["consents"] = consents
    bank.save_prefs(user_id, data)
    if changed:
        audit.record("prefs_updated", user_id, owner=user_id, source="settings", **changed)
    return get(bank, user_id, role)
