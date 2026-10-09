"""Run every scripted task and attack, and write the submission evidence folder.

Usage (from backend/):
    python scripts/run_evidence.py                      # offline engine
    LLM_PROVIDER=deepseek LLM_API_KEY=sk-... python scripts/run_evidence.py

Writes to ../evidence/<provider>/:
    scripted_tasks.json, attack_report.json, audit_log.jsonl,
    classifier_eval.json, SUMMARY.md
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("HB_NO_AUTOAPP", "1")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sklearn.model_selection import StratifiedKFold, cross_val_predict  # noqa: E402
from sklearn.metrics import classification_report  # noqa: E402

from app.audit import AuditLog  # noqa: E402
from app.classifier import TextRiskClassifier, load_rows  # noqa: E402
from app.config import load_settings  # noqa: E402
from app.harness import fresh, run_attack, run_task  # noqa: E402
from app.scenarios import ATTACKS, TASKS  # noqa: E402


def classifier_eval() -> dict:
    rows = load_rows()
    # Group variants of the same seed sentence so augmented copies never straddle train and test.
    import re
    base = [re.sub(r"^(hey |pls |can you |hi, |quick one: |eh )|( thanks| lah| asap| please| ok\?)$", "", r["text"])
            for r in rows]
    from sklearn.model_selection import GroupKFold
    texts, labels = [r["text"] for r in rows], [r["label"] for r in rows]
    clf = TextRiskClassifier()
    pred = cross_val_predict(clf.pipe, texts, labels, groups=base, cv=GroupKFold(n_splits=5))
    rep = classification_report(labels, pred, output_dict=True, zero_division=0)
    return {"method": "5-fold GroupKFold (augmented variants grouped with their seed sentence)",
            "n": len(rows), "report": rep}


def main() -> None:
    settings = load_settings()
    provider_name = settings.llm_provider
    out = ROOT.parent / "evidence" / provider_name
    out.mkdir(parents=True, exist_ok=True)
    audit_path = out / "audit_log.jsonl"
    if audit_path.exists():
        audit_path.unlink()

    def state():
        st = fresh(settings=load_settings())
        st.audit = AuditLog(str(audit_path))  # share one chained log across all runs
        st.policy.audit = st.audit
        st.agent.audit = st.audit
        return st

    t0 = time.time()
    tasks = []
    for t in TASKS:
        st = state()
        st.audit.record("scenario_start", "harness", scenario=t.id, kind="task")
        tasks.append(run_task(t, st))
        print(f"task {t.id}: {'PASS' if tasks[-1]['passed'] else 'FAIL ' + str(tasks[-1]['problems'])}")
    attacks = []
    for a in ATTACKS:
        st = state()
        st.audit.record("scenario_start", "harness", scenario=a.id, kind="attack")
        attacks.append(run_attack(a, st))
        print(f"attack {a.id}: {'BLOCKED' if attacks[-1]['blocked'] else 'VIOLATION ' + str(attacks[-1]['violations'])}")

    ce = classifier_eval()
    verify = AuditLog(str(audit_path)).verify()
    (out / "scripted_tasks.json").write_text(json.dumps(tasks, indent=2, ensure_ascii=False), encoding="utf-8")
    (out / "attack_report.json").write_text(json.dumps(attacks, indent=2, ensure_ascii=False), encoding="utf-8")
    (out / "classifier_eval.json").write_text(json.dumps(ce, indent=2), encoding="utf-8")

    passed = sum(t["passed"] for t in tasks)
    blocked = sum(a["blocked"] for a in attacks)
    by_cat = Counter(a["category"] for a in attacks)
    blocked_cat = Counter(a["category"] for a in attacks if a["blocked"])
    lines = [
        f"# Evidence summary ({provider_name})",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M:%S %Z')} in {time.time() - t0:.1f}s.",
        "",
        f"- Scripted tasks passed: **{passed}/{len(tasks)}**",
        f"- Attacks blocked: **{blocked}/{len(attacks)}**",
        f"- Audit log entries: {verify.get('count')}, hash chain valid: **{verify.get('ok')}**",
        f"- Classifier macro F1 (grouped 5-fold CV): {ce['report']['macro avg']['f1-score']:.3f}",
        "",
        ("Offline engine: tool sequence, reply wording, drafted actions and final state are all checked exactly."
         if provider_name == "offline" else
         "Live model: the decisive tool, drafted actions and tiers, and the final sandbox state are hard checks; "
         "reply wording is reported as notes in scripted_tasks.json."),
        "",
        "| Attack category | Blocked |",
        "|---|---|",
    ]
    lines += [f"| {c} | {blocked_cat[c]}/{n} |" for c, n in by_cat.items()]
    lines += ["", "| Task | Group | Result | Tools | Final status |", "|---|---|---|---|---|"]
    lines += [f"| {t['id']} | {t['group']} | {'pass' if t['passed'] else 'FAIL'} | {', '.join(t['tools'])} | "
              f"{t['final_status'] or ''} |" for t in tasks]
    (out / "SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:9]))


if __name__ == "__main__":
    main()
