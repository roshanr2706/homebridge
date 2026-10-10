"""Server-checked sponsor PIN: the second factor on the sponsor's money decisions.

The sponsor's app already asks for Face ID / fingerprint before Approve (client side, stepUp.ts). That
check never reaches the server, so a stolen sponsor bearer token alone could approve. This PIN closes
that gap for the demo: Approve, Unlock and limit changes need the sponsor's 6-digit PIN in the request
body, checked here.

* Stored as PBKDF2-HMAC-SHA256 with a random 16-byte salt (600,000 iterations, the OWASP 2023 figure);
  the PIN itself is never stored or logged.
* Compared with hmac.compare_digest (constant time).
* 5 wrong PINs in a row lock PIN checks for 15 minutes. Every failure and every lockout is audited.
* Demo PIN: 246810 (override with HB_SPONSOR_PIN). Production would use passkeys / FIDO2 device keys
  verified server-side instead (see R3 in docs/security_self_assessment.md).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
from typing import Callable, Dict, Optional, Tuple

from .audit import AuditLog
from .bank import Bank

DEMO_SPONSOR_PIN = "246810"
PIN_ITERATIONS = int(os.getenv("HB_PIN_ITERATIONS", "600000"))
MAX_PIN_FAILURES = 5
PIN_LOCK_SECONDS = 15 * 60
PIN_FORMAT = re.compile(r"^\d{6}$")

_cache: Dict[Tuple[str, int], Tuple[str, str]] = {}


class PinError(Exception):
    """A refused PIN check. Message is safe to show the sponsor."""


def _derive(pin: str, salt_hex: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), iterations).hex()


def hash_pin(pin: str, iterations: int = PIN_ITERATIONS) -> Tuple[str, str]:
    """(salt, hash) for a PIN. The demo seed reuses one salted hash per process, because the sandbox is
    reseeded for every test and every demo reset and PBKDF2 is deliberately slow."""
    key = (pin, iterations)
    if key not in _cache:
        salt = os.urandom(16).hex()
        _cache[key] = (salt, _derive(pin, salt, iterations))
    return _cache[key]


def seed_pin(bank: Bank, user_id: str) -> None:
    pin = os.getenv("HB_SPONSOR_PIN", DEMO_SPONSOR_PIN)
    if not PIN_FORMAT.match(pin):
        raise ValueError("HB_SPONSOR_PIN must be exactly 6 digits")
    salt, digest = hash_pin(pin)
    bank.save_pin(user_id, salt, digest, PIN_ITERATIONS)


class PinChecker:
    def __init__(self, bank: Bank, audit: AuditLog, clock: Callable[[], float] = time.time) -> None:
        self.bank, self.audit, self.clock = bank, audit, clock

    def verify(self, user_id: str, pin: Optional[str], purpose: str) -> None:
        """Returns quietly on the right PIN; raises PinError otherwise. `purpose` goes into the audit entry."""
        rec = self.bank.pin_record(user_id)
        if not rec:
            self.audit.record("sponsor_pin_failed", user_id, purpose=purpose, reason="no PIN set")
            raise PinError("No approval PIN is set for this sponsor.")
        now = self.clock()
        if rec["locked_until"] and rec["locked_until"] > now:
            wait = int(rec["locked_until"] - now)
            self.audit.record("sponsor_pin_failed", user_id, purpose=purpose, reason="locked out")
            raise PinError(f"Too many wrong PINs. PIN approval is locked for another {wait // 60 + 1} minutes.")
        pin = (pin or "").strip()
        if not pin:
            self.audit.record("sponsor_pin_failed", user_id, purpose=purpose, reason="missing")
            raise PinError("Enter your 6-digit approval PIN.")
        # Hash whatever was sent (bounded) so a malformed PIN costs the same time as a wrong one.
        candidate = _derive(pin[:12], rec["salt"], rec["iterations"])
        if PIN_FORMAT.match(pin) and hmac.compare_digest(candidate, rec["hash"]):
            if rec["failures"]:
                self.bank.set_pin_state(user_id, 0, 0)
            return
        failures = (rec["failures"] or 0) + 1
        if failures >= MAX_PIN_FAILURES:
            self.bank.set_pin_state(user_id, 0, now + PIN_LOCK_SECONDS)
            self.audit.record("sponsor_pin_failed", user_id, purpose=purpose, reason="wrong PIN", attempts=failures)
            self.audit.record("sponsor_pin_locked", user_id, purpose=purpose, seconds=PIN_LOCK_SECONDS)
            raise PinError(f"Wrong PIN. That was {failures} wrong tries, so PIN approval is locked for "
                           f"{PIN_LOCK_SECONDS // 60} minutes.")
        self.bank.set_pin_state(user_id, failures, 0)
        self.audit.record("sponsor_pin_failed", user_id, purpose=purpose, reason="wrong PIN", attempts=failures)
        left = MAX_PIN_FAILURES - failures
        raise PinError(f"Wrong PIN. {left} {'try' if left == 1 else 'tries'} left before PIN approval locks.")

    def status(self, user_id: str) -> Dict[str, object]:
        rec = self.bank.pin_record(user_id) or {}
        locked = bool(rec.get("locked_until") and rec["locked_until"] > self.clock())
        return {"set": bool(rec), "locked": locked, "failures": rec.get("failures", 0)}
