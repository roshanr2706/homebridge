# HomeBridge

An AI finance agent for international students whose family supports them from abroad.
FinTechathon 2026, International Track, Topic C (Cross-border & Student Finance Assistant).

The agent plans and talks. It never holds the power to move money: every payment is a draft
that the student confirms in the app, and large, unusual or sponsor-funded payments also need
the sponsor (parent) to approve on their own device. See `PLAN.md` for the full design.

## Quick start

Requires Python 3.10+ and Node 20+.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/build_classifier_data.py                # once; builds data/classifier_train.jsonl
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
# App (Expo / React Native; runs on Android, iOS and web)
cd app
npm install
cp .env.example .env            # set EXPO_PUBLIC_API_URL to the backend address
npx expo start --web            # or press "a" for Android
```

## Choosing the model

The backend runs with no API key in **offline mode** (a deterministic planner that covers the
scripted tasks). For the real agent, use DeepSeek, which works from mainland China and abroad:

```bash
export LLM_PROVIDER=deepseek          # deepseek | deepseek-pro | qwen | qwen-cn | offline | custom
export LLM_API_KEY=sk-...
# optional: LLM_MODEL, LLM_BASE_URL (required for custom), LLM_THINKING=1
```

If the LLM API fails mid-conversation, the agent falls back to offline mode for that turn
and says so in the response (`"fallback": true`).

## Tests and evidence

```bash
cd backend
pytest -q                                   # scripted tasks, attack suite, API role tests
python scripts/run_evidence.py              # writes ../evidence/<provider>/
LLM_PROVIDER=deepseek LLM_API_KEY=sk-... python scripts/run_evidence.py
```

The evidence folder holds the scripted task results, the attack report, the classifier
evaluation, and a hash-chained audit log of every sandbox operation (`/audit/verify` checks it).

## API

All endpoints take `Authorization: Bearer <token>`. Demo tokens: `demo-student`, `demo-sponsor`
(override with `HB_STUDENT_TOKEN`, `HB_SPONSOR_TOKEN`).

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/chat` | student | `{"message": "...", "session_id": "..."}` → reply, drafted actions, safety flags, tool trace |
| GET | `/accounts` | student | balances (masked), payees, tuition schedule |
| GET | `/actions` | student | drafts and their status |
| POST | `/actions/{id}/confirm` | student | `{"token": "..."}` single-use token from the draft |
| POST | `/actions/{id}/cancel` | student | cancel a draft |
| GET | `/sponsor/queue` | sponsor | actions waiting for approval |
| POST | `/sponsor/actions/{id}/approve` · `/reject` | sponsor | decide |
| GET | `/audit`, `/audit/verify` | any | audit entries, chain verification |
| POST | `/demo/reset` | any | reset the sandbox (demo mode only) |

## Layout

```
backend/app/    agent, tools, policy engine, sandbox bank, FX, guard, classifier, audit log
backend/tests/  scripted tasks, attack suite, compromised-model tests, API role tests
app/            Expo React Native app (student chat + sponsor approvals)
docs/           technical document and security self-assessment
evidence/       generated logs for the submission
```

All data is fictional and the bank is a sandbox.
