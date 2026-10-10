"""Sandbox bank backed by SQLite.

Amounts are stored as integer minor units (cents / sen). Nothing in this
module is exposed to the language model directly: tools read through the
masking helpers, and money only moves through `PolicyEngine.execute`.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional


class BankError(Exception):
    pass


def to_minor(amount: float) -> int:
    return int(round(float(amount) * 100))


def to_major(minor: int) -> float:
    return round(minor / 100.0, 2)


def mask(number: str) -> str:
    digits = [c for c in number if c.isdigit()]
    return "••••" + "".join(digits[-4:]) if digits else "••••"


SCHEMA = """
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, sponsor_id TEXT);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, owner TEXT, label TEXT, currency TEXT,
  balance INTEGER, number TEXT, sponsor_funded INTEGER DEFAULT 0
);
CREATE TABLE payees (
  id TEXT PRIMARY KEY, owner TEXT, name TEXT, kind TEXT, currency TEXT,
  number TEXT, status TEXT, usable_from REAL, created_at REAL, source TEXT
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, account_id TEXT, ts TEXT, amount INTEGER, currency TEXT,
  category TEXT, counterparty TEXT, memo TEXT
);
CREATE TABLE tuition (
  id TEXT PRIMARY KEY, owner TEXT, term TEXT, due TEXT, amount INTEGER,
  currency TEXT, paid INTEGER DEFAULT 0, payee_id TEXT
);
CREATE TABLE budgets (owner TEXT, category TEXT, monthly INTEGER, currency TEXT,
  PRIMARY KEY (owner, category));
CREATE TABLE reminders (id TEXT PRIMARY KEY, owner TEXT, due TEXT, text TEXT);
"""

# Policy state, kept in the same database so drafts and balances survive a restart together.
# Drafts are stored with their token hash only; the plaintext confirmation token is never written.
POLICY_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY, owner TEXT, status TEXT, created_at REAL, data TEXT
);
CREATE TABLE IF NOT EXISTS draft_log (owner TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS freeze_state (owner TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, owner TEXT, ts REAL, kind TEXT, data TEXT);
"""
SCHEMA += POLICY_SCHEMA

# Known recurring money in and out (payday, allowance, rent, bills), used by the cash-flow forecast.
# `next_due` is the next expected date; cadence is weekly, biweekly, monthly or bimonthly.
RECURRING_SCHEMA = """
CREATE TABLE IF NOT EXISTS recurring (
  id TEXT PRIMARY KEY, owner TEXT, account_id TEXT, counterparty TEXT, category TEXT,
  amount INTEGER, currency TEXT, cadence TEXT, next_due TEXT
);
"""
SCHEMA += RECURRING_SCHEMA
# Credit Builder: a sandbox secured credit card. It is a liability, kept out of `accounts` so balances and
# totals stay what they were; it is paid like a saved payee (kind 'credit_card') through the policy engine.
CARD_SCHEMA = """
CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY, owner TEXT, label TEXT, currency TEXT, credit_limit INTEGER, balance INTEGER,
  deposit INTEGER, number TEXT, payee_id TEXT, opened TEXT, next_close TEXT, apr REAL,
  autopay TEXT DEFAULT 'off', hard_inquiries INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS card_statements (
  id TEXT PRIMARY KEY, card_id TEXT, closed TEXT, due TEXT, balance INTEGER, min_due INTEGER,
  paid INTEGER DEFAULT 0, paid_on TEXT
);
CREATE TABLE IF NOT EXISTS card_activity (
  id TEXT PRIMARY KEY, card_id TEXT, ts TEXT, amount INTEGER, description TEXT
);
"""
SCHEMA += CARD_SCHEMA


class Bank:
    def __init__(self, db_path: str = ":memory:") -> None:
        self._lock = threading.RLock()
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.today: Optional[date] = None  # the sandbox's "today", set by reset(); card payments use it
        with self._lock:  # a file database from before the Credit Builder gets empty card tables
            self.db.executescript(CARD_SCHEMA)
            self.db.commit()

    # ------------------------------------------------------------------ setup
    def reset(self, today: Optional[date] = None) -> None:
        from .seed import seed  # local import avoids a cycle

        with self._lock:
            cur = self.db.cursor()
            for (name,) in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall():
                cur.execute(f"DROP TABLE IF EXISTS {name}")
            cur.executescript(SCHEMA)
            self.today = today or date.today()
            seed(self, self.today)
            self.db.commit()

    def is_seeded(self) -> bool:
        """True when the database already holds a sandbox (a file DB from an earlier run)."""
        with self._lock:
            if not self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").fetchall():
                return False
            return bool(self.db.execute("SELECT 1 FROM users LIMIT 1").fetchall())

    def _q(self, sql: str, args: tuple = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self.db.execute(sql, args).fetchall()

    def _x(self, sql: str, args: tuple = ()) -> None:
        with self._lock:
            self.db.execute(sql, args)
            self.db.commit()

    # ------------------------------------------------------------- reading
    def user(self, user_id: str) -> Optional[Dict[str, Any]]:
        rows = self._q("SELECT * FROM users WHERE id=?", (user_id,))
        return dict(rows[0]) if rows else None

    def accounts(self, owner: str) -> List[Dict[str, Any]]:
        rows = self._q("SELECT * FROM accounts WHERE owner=? ORDER BY id", (owner,))
        return [
            {
                "id": r["id"],
                "label": r["label"],
                "currency": r["currency"],
                "balance": to_major(r["balance"]),
                "number": mask(r["number"]),
                "sponsor_funded": bool(r["sponsor_funded"]),
            }
            for r in rows
        ]

    def account(self, account_id: str) -> Optional[Dict[str, Any]]:
        rows = self._q("SELECT * FROM accounts WHERE id=?", (account_id,))
        return dict(rows[0]) if rows else None

    def find_account(self, owner: str, currency: str, prefer_label: str = "") -> Optional[Dict[str, Any]]:
        rows = [dict(r) for r in self._q(
            "SELECT * FROM accounts WHERE owner=? AND currency=? ORDER BY sponsor_funded, id",
            (owner, currency.upper()),
        )]
        if prefer_label:
            for r in rows:
                if prefer_label.lower() in r["label"].lower():
                    return r
        return rows[0] if rows else None

    def transactions(
        self, owner: str, days: int = 30, category: str = "", today: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        since = ((today or date.today()) - timedelta(days=days)).isoformat()
        sql = (
            "SELECT t.* , a.label AS account FROM transactions t JOIN accounts a "
            "ON a.id=t.account_id WHERE a.owner=? AND t.ts>=?"
        )
        args: tuple = (owner, since)
        if category:
            sql += " AND t.category=?"
            args += (category.lower(),)
        sql += " ORDER BY t.ts DESC"
        return [
            {
                "date": r["ts"][:10],
                "account": r["account"],
                "amount": to_major(r["amount"]),
                "currency": r["currency"],
                "category": r["category"],
                "counterparty": r["counterparty"],
                "memo": r["memo"],
            }
            for r in self._q(sql, args)
        ]

    def payees(self, owner: str, include_pending: bool = True) -> List[Dict[str, Any]]:
        rows = self._q("SELECT * FROM payees WHERE owner=? ORDER BY name", (owner,))
        out = []
        for r in rows:
            if not include_pending and r["status"] != "active":
                continue
            out.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "kind": r["kind"],
                    "currency": r["currency"],
                    "number": mask(r["number"]),
                    "status": r["status"],
                    "usable_from": r["usable_from"],
                }
            )
        return out

    def payee(self, payee_id: str) -> Optional[Dict[str, Any]]:
        rows = self._q("SELECT * FROM payees WHERE id=?", (payee_id,))
        return dict(rows[0]) if rows else None

    def payee_raw_number(self, payee_id: str) -> str:
        p = self.payee(payee_id)
        return p["number"] if p else ""

    def tuition(self, owner: str) -> List[Dict[str, Any]]:
        rows = self._q("SELECT * FROM tuition WHERE owner=? ORDER BY due", (owner,))
        return [
            {
                "id": r["id"],
                "term": r["term"],
                "due": r["due"],
                "amount": to_major(r["amount"]),
                "currency": r["currency"],
                "paid": bool(r["paid"]),
                "payee_id": r["payee_id"],
            }
            for r in rows
        ]

    def budgets(self, owner: str) -> Dict[str, Dict[str, Any]]:
        return {
            r["category"]: {"monthly": to_major(r["monthly"]), "currency": r["currency"]}
            for r in self._q("SELECT * FROM budgets WHERE owner=?", (owner,))
        }

    def recurring(self, owner: str) -> List[Dict[str, Any]]:
        """Recurring items in major units. A database seeded before this table existed has none."""
        try:
            rows = self._q("SELECT * FROM recurring WHERE owner=? ORDER BY next_due, id", (owner,))
        except sqlite3.OperationalError:
            return []
        return [
            {
                "id": r["id"],
                "account_id": r["account_id"],
                "counterparty": r["counterparty"],
                "category": r["category"],
                "amount": to_major(r["amount"]),
                "currency": r["currency"],
                "cadence": r["cadence"],
                "next_due": r["next_due"],
            }
            for r in rows
        ]

    def reminders(self, owner: str) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._q("SELECT * FROM reminders WHERE owner=? ORDER BY due", (owner,))]

    def outflow_since(self, owner: str, since_ts: str) -> Dict[str, int]:
        """Minor-unit outflow per currency since an ISO timestamp (for daily limits)."""
        rows = self._q(
            "SELECT t.currency, SUM(-t.amount) AS s FROM transactions t JOIN accounts a ON a.id=t.account_id "
            "WHERE a.owner=? AND t.ts>=? AND t.amount<0 AND t.category NOT IN ('conversion') GROUP BY t.currency",
            (owner, since_ts),
        )
        return {r["currency"]: int(r["s"] or 0) for r in rows}

    def known_counterparties(self, owner: str) -> List[str]:
        rows = self._q(
            "SELECT DISTINCT counterparty FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.owner=?",
            (owner,),
        )
        return [r["counterparty"] for r in rows]

    # ------------------------------------------------------------- writing
    # Only PolicyEngine and the seed/T1 tools call these.
    def add_transaction(
        self, account_id: str, amount_minor: int, currency: str, category: str,
        counterparty: str, memo: str = "", ts: Optional[str] = None,
    ) -> str:
        tid = "tx_" + uuid.uuid4().hex[:10]
        self._x(
            "INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?)",
            (tid, account_id, ts or datetime.now().isoformat(timespec="seconds"),
             amount_minor, currency, category, counterparty, memo),
        )
        return tid

    def _adjust(self, account_id: str, delta_minor: int) -> None:
        acc = self.account(account_id)
        if not acc:
            raise BankError("Unknown account")
        if acc["balance"] + delta_minor < 0:
            raise BankError(
                f"Insufficient funds in {acc['label']}: balance {to_major(acc['balance'])} {acc['currency']}"
            )
        self._x("UPDATE accounts SET balance=balance+? WHERE id=?", (delta_minor, account_id))

    def transfer_out(
        self, account_id: str, payee_id: str, amount_minor: int, memo: str, category: str
    ) -> Dict[str, Any]:
        with self._lock:
            acc, payee = self.account(account_id), self.payee(payee_id)
            if not acc or not payee:
                raise BankError("Unknown account or payee")
            if payee["status"] != "active":
                raise BankError("Payee is not active")
            if payee["usable_from"] and payee["usable_from"] > time.time():
                raise BankError("Payee is still in its cooling period")
            if acc["currency"] != payee["currency"]:
                raise BankError("Currency mismatch between account and payee")
            card = self.card_for_payee(payee_id) if payee["kind"] == "credit_card" else None
            if card and amount_minor > card["balance"]:
                raise BankError(f"Payment is more than the card balance ({to_major(card['balance'])} {card['currency']})")
            self._adjust(account_id, -amount_minor)
            tid = self.add_transaction(account_id, -amount_minor, acc["currency"], category, payee["name"], memo)
            if card:
                self._apply_card_payment(card, amount_minor, acc["label"])
            if category == "tuition":
                self._x(
                    "UPDATE tuition SET paid=1 WHERE id = (SELECT id FROM tuition WHERE owner=? AND paid=0 "
                    "AND payee_id=? AND amount=? ORDER BY due LIMIT 1)",
                    (acc["owner"], payee_id, amount_minor),
                )
            return {"transaction_id": tid, "new_balance": to_major(self.account(account_id)["balance"])}

    def convert(
        self, from_id: str, to_id: str, amount_minor: int, rate: float, fee_minor: int
    ) -> Dict[str, Any]:
        with self._lock:
            src, dst = self.account(from_id), self.account(to_id)
            if not src or not dst or src["owner"] != dst["owner"]:
                raise BankError("Conversions are only allowed between your own accounts")
            credited = int(round((amount_minor - fee_minor) * rate))
            self._adjust(from_id, -amount_minor)
            self._adjust(to_id, credited)
            self.add_transaction(from_id, -amount_minor, src["currency"], "conversion",
                                 f"Convert to {dst['currency']}", f"rate {rate:.5f}")
            self.add_transaction(to_id, credited, dst["currency"], "conversion",
                                 f"Convert from {src['currency']}", f"rate {rate:.5f}")
            return {"debited": to_major(amount_minor), "credited": to_major(credited),
                    "from_currency": src["currency"], "to_currency": dst["currency"]}

    def create_payee(self, owner: str, name: str, kind: str, currency: str, number: str, source: str) -> str:
        pid = "py_" + uuid.uuid4().hex[:8]
        self._x(
            "INSERT INTO payees VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, owner, name, kind, currency.upper(), number, "pending_approval", None, time.time(), source),
        )
        return pid

    def activate_payee(self, payee_id: str, cooling_seconds: int) -> None:
        self._x(
            "UPDATE payees SET status='active', usable_from=? WHERE id=?",
            (time.time() + cooling_seconds, payee_id),
        )

    def reject_payee(self, payee_id: str) -> None:
        self._x("UPDATE payees SET status='rejected' WHERE id=?", (payee_id,))

    def set_budget(self, owner: str, category: str, monthly: float, currency: str) -> None:
        self._x(
            "INSERT OR REPLACE INTO budgets VALUES (?,?,?,?)",
            (owner, category.lower(), to_minor(monthly), currency.upper()),
        )

    def add_reminder(self, owner: str, due: str, text: str) -> str:
        rid = "rm_" + uuid.uuid4().hex[:8]
        self._x("INSERT INTO reminders VALUES (?,?,?,?)", (rid, owner, due, text))
        return rid

    # ------------------------------------------------------- credit cards
    def credit_cards(self, owner: str) -> List[Dict[str, Any]]:
        """Raw card rows (minor units) with a masked number; the full number never leaves the bank."""
        out = []
        for r in self._q("SELECT * FROM credit_cards WHERE owner=? ORDER BY id", (owner,)):
            d = dict(r)
            d["number_masked"] = mask(d.pop("number"))
            out.append(d)
        return out

    def card_for_payee(self, payee_id: str) -> Optional[Dict[str, Any]]:
        rows = self._q("SELECT * FROM credit_cards WHERE payee_id=?", (payee_id,))
        return dict(rows[0]) if rows else None

    def card_statements(self, card_id: str) -> List[Dict[str, Any]]:
        """Newest first."""
        return [dict(r) for r in self._q("SELECT * FROM card_statements WHERE card_id=? ORDER BY closed DESC",
                                         (card_id,))]

    def card_purchases_since(self, card_id: str, since: str) -> int:
        rows = self._q("SELECT SUM(amount) AS s FROM card_activity WHERE card_id=? AND amount>0 AND ts>=?",
                       (card_id, since))
        return int(rows[0]["s"] or 0)

    def _apply_card_payment(self, card: Dict[str, Any], amount_minor: int, from_label: str) -> None:
        """Called inside transfer_out, under the lock, after the debit."""
        today = self.today or date.today()
        self._x("UPDATE credit_cards SET balance=balance-? WHERE id=?", (amount_minor, card["id"]))
        self._x("INSERT INTO card_activity VALUES (?,?,?,?,?)",
                ("ca_" + uuid.uuid4().hex[:10], card["id"], datetime.combine(today, datetime.now().time())
                 .isoformat(timespec="seconds"), -amount_minor, f"Payment from {from_label}"))
        st = self.card_statements(card["id"])
        if st and st[0]["paid"] < st[0]["balance"]:
            s = st[0]
            paid = s["paid"] + min(amount_minor, s["balance"] - s["paid"])
            # The date the minimum was first covered decides whether this statement was paid on time.
            paid_on = s["paid_on"] or (today.isoformat() if paid >= s["min_due"] else None)
            self._x("UPDATE card_statements SET paid=?, paid_on=? WHERE id=?", (paid, paid_on, s["id"]))

    # ------------------------------------------------------- policy state
    # Storage for PolicyEngine, which keeps a working copy in memory and writes through here.
    def ensure_policy_tables(self) -> None:
        with self._lock:
            self.db.executescript(POLICY_SCHEMA)
            self.db.commit()

    def save_action(self, action_id: str, owner: str, status: str, created_at: float, data: str) -> None:
        self._x("INSERT OR REPLACE INTO pending_actions VALUES (?,?,?,?,?)",
                (action_id, owner, status, created_at, data))

    def load_actions(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._q("SELECT * FROM pending_actions ORDER BY created_at, id")]

    def log_draft(self, owner: str, ts: float, window_start: float) -> None:
        with self._lock:
            self.db.execute("DELETE FROM draft_log WHERE ts < ?", (window_start,))
            self.db.execute("INSERT INTO draft_log VALUES (?,?)", (owner, ts))
            self.db.commit()

    def load_drafts(self, since: float) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._q("SELECT owner, ts FROM draft_log WHERE ts >= ? ORDER BY ts", (since,))]

    def clear_policy_state(self) -> None:
        with self._lock:
            self.db.executescript(POLICY_SCHEMA)
            self.db.execute("DELETE FROM pending_actions")
            self.db.execute("DELETE FROM draft_log")
            self.db.execute("DELETE FROM freeze_state")
            self.db.execute("DELETE FROM alerts")
            self.db.commit()

    # Freeze state and alerts (see safety.py), stored next to the drafts they govern.
    def save_freeze(self, owner: str, data: str) -> None:
        self._x("INSERT OR REPLACE INTO freeze_state VALUES (?,?)", (owner, data))

    def load_freeze(self, owner: str) -> Optional[Dict[str, Any]]:
        rows = self._q("SELECT data FROM freeze_state WHERE owner=?", (owner,))
        return json.loads(rows[0]["data"]) if rows else None

    def save_alert(self, alert_id: str, owner: str, ts: float, kind: str, data: str) -> None:
        self._x("INSERT INTO alerts VALUES (?,?,?,?,?)", (alert_id, owner, ts, kind, data))

    def load_alerts(self, owner: str, since: float) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._q("SELECT * FROM alerts WHERE owner=? AND ts >= ? ORDER BY ts, id",
                                         (owner, since))]

    def credit_sponsor_topup(self, student: str, amount_minor: int, currency: str, memo: str) -> None:
        acc = self.find_account(student, currency)
        if not acc:
            raise BankError(f"No {currency} account to receive the top-up")
        self._adjust(acc["id"], amount_minor)
        self.add_transaction(acc["id"], amount_minor, currency, "allowance", "Sponsor top-up", memo)
