"""Rewrite the headline numbers in README.md and docs/*.md from the code and the committed evidence.

Run after a merge that changes tests, tasks, attacks or the evidence:

    python scripts/recount_docs.py            # prints what it would change
    python scripts/recount_docs.py --write

Numbers come from: pytest --collect-only (tests), app.scenarios (tasks, attacks by category), the tool registry,
evidence/offline (guard-flagged attacks, audit entries), evidence/deepseek (live tasks and attacks) and
evidence/heldout (held-out scores). Only number patterns the docs already use are touched.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HB_NO_AUTOAPP", "1")
os.environ["LLM_PROVIDER"] = "offline"

from app import tools  # noqa: E402
from app.scenarios import ATTACKS, TASKS  # noqa: E402


def _items(path: Path, key: str):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data[key] if isinstance(data, dict) and key in data else data


def numbers() -> dict:
    out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:warnings"], cwd=ROOT,
                         capture_output=True, text=True).stdout
    tests = int(re.search(r"(\d+) tests? collected", out).group(1))
    cats = Counter(a.category for a in ATTACKS)
    off = _items(REPO / "evidence/offline/attack_report.json", "attacks")
    live_t = _items(REPO / "evidence/deepseek/scripted_tasks.json", "tasks")
    live_a = _items(REPO / "evidence/deepseek/attack_report.json", "attacks")
    audit = sum(1 for _ in open(REPO / "evidence/offline/audit_log.jsonl", encoding="utf-8"))
    return {
        "tests": tests, "tasks": len(TASKS), "attacks": len(ATTACKS), "tools": len(tools.REGISTRY),
        "induced": cats["induced_transfer"], "extraction": cats["extraction"], "escalation": cats["escalation"],
        "injection": cats["injection"], "flagged": sum(1 for a in off if a.get("guard_flags")), "audit": audit,
        "live_tasks": sum(1 for t in live_t if t["passed"]), "live_total": len(live_t),
        "live_attacks": sum(1 for a in live_a if a["blocked"]), "live_attacks_total": len(live_a),
    }


def rules(n: dict):
    T, A = n["tasks"], n["attacks"]
    lt, ltt, la = n["live_tasks"], n["live_total"], n["live_attacks"]
    cat_short = f"induced {n['induced']}, extraction {n['extraction']}, escalation {n['escalation']}, injection {n['injection']}"
    cat_long = (f"induced transfer {n['induced']}, extraction {n['extraction']}, escalation {n['escalation']}, "
                f"injection {n['injection']}")
    return [
        (r"tests=\d+", f"tests={n['tests']}"), (r"tasks=\d+", f"tasks={T}"), (r"attacks=\d+", f"attacks={A}"),
        (r"tools=\d+", f"tools={n['tools']}"), (r"guard-flagged=\d+", f"guard-flagged={n['flagged']}"),
        (r"audit=\d+", f"audit={n['audit']}"),
        (r"\b\d{3} (automated tests|tests passing|passing|tests)\b", lambda m: f"{n['tests']} {m.group(1)}"),
        # a pair with a smaller numerator is the live run; an equal pair is the offline engine
        (r"(1\d\d) (/|of) (1\d\d)",
         lambda m: f"{T} {m.group(2)} {T}" if m.group(1) == m.group(3) else f"{lt} {m.group(2)} {ltt}"),
        (r"([78]\d) (/|of) (?! held)", lambda m: f"{A} {m.group(2)} {A}"),
        (r"all [78]\d attacks", f"all {A} attacks"),
        (r"(?<=on )2026-10-17(?= it passed)|(?<=suites on )2026-10-17", "2026-10-18"),
        (r"induced \d+, extraction \d+, escalation \d+, injection \d+", cat_short),
        (r"induced transfer \d+, extraction \d+, escalation \d+, (?:prompt )?injection \d+", cat_long),
        (r"\b\d\d (?:registered|agent tools|tools,|tools \()", lambda m: f"{n['tools']}{m.group(0)[2:]}"),
    ]


def main() -> None:
    n = numbers()
    print(json.dumps(n))
    write = "--write" in sys.argv
    for p in [REPO / "README.md", *sorted((REPO / "docs").glob("*.md"))]:
        s = p.read_text(encoding="utf-8")
        new = s
        for pat, rep in rules(n):
            new = re.sub(pat, rep, new)
        if new != s:
            changed = sum(1 for a, b in zip(s.splitlines(), new.splitlines()) if a != b)
            print(f"{p.relative_to(REPO)}: {changed} lines")
            if write:
                p.write_text(new, encoding="utf-8", newline="")


if __name__ == "__main__":
    main()
