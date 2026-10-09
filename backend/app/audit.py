"""Append-only, hash-chained audit log.

Each entry stores the SHA-256 of the previous entry. Editing or deleting any
line breaks the chain, which `verify()` detects. The same file is exported as
execution evidence for the submission.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

GENESIS = "0" * 64


def _digest(entry: Dict[str, Any]) -> str:
    body = {k: v for k, v in entry.items() if k != "hash"}
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AuditLog:
    def __init__(self, path: Optional[str] = None) -> None:
        self._lock = threading.Lock()
        self._entries: List[Dict[str, Any]] = []
        self._path = Path(path) if path else None
        if self._path:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            if self._path.exists():
                for line in self._path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        self._entries.append(json.loads(line))

    @property
    def last_hash(self) -> str:
        return self._entries[-1]["hash"] if self._entries else GENESIS

    def record(self, event: str, actor: str, **data: Any) -> Dict[str, Any]:
        with self._lock:
            entry = {
                "seq": len(self._entries),
                "ts": round(time.time(), 3),
                "event": event,
                "actor": actor,
                "data": data,
                "prev": self.last_hash,
            }
            entry["hash"] = _digest(entry)
            self._entries.append(entry)
            if self._path:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            return entry

    def entries(self, since: int = 0) -> List[Dict[str, Any]]:
        return list(self._entries[since:])

    def verify(self) -> Dict[str, Any]:
        return self.verify_entries(self._entries)

    @staticmethod
    def verify_entries(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
        prev = GENESIS
        for i, entry in enumerate(entries):
            if entry.get("prev") != prev or _digest(entry) != entry.get("hash"):
                return {"ok": False, "broken_at": i, "count": len(entries)}
            prev = entry["hash"]
        return {"ok": True, "count": len(entries), "head": prev}

    def reset(self) -> None:
        with self._lock:
            self._entries = []
            if self._path and self._path.exists():
                self._path.unlink()
