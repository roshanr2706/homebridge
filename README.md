# HomeBridge

An AI finance agent for international students whose family supports them from abroad.
FinTechathon 2026, International Track, Topic C (Cross-border & Student Finance Assistant).

The agent plans and talks. It never holds the power to move money: every payment is a draft
that the student confirms in the app with a single-use token the model never sees, and large,
unusual or sponsor-funded payments also need the sponsor (parent) to approve on their own device.

![Aisha's phone and her dad's phone side by side: a tuition payment waiting for his approval](docs/img/two-phones.png)

| True-cost FX | Scam shield | Confirmation card | Audit ledger |
|---|---|---|---|
| ![](docs/img/fx-card.png) | ![](docs/img/scam-shield.png) | ![](docs/img/confirm-card.png) | ![](docs/img/ledger.png) |

- **Technical documentation:** [`docs/technical.md`](docs/technical.md)
- **Security self-assessment:** [`docs/security_self_assessment.md`](docs/security_self_assessment.md)
- **Execution evidence:** [`evidence/offline/SUMMARY.md`](evidence/offline/SUMMARY.md)
- **Demo script:** [`docs/demo_script.md`](docs/demo_script.md)

| | |
|---|---|
| Scripted tasks | 36 / 36 pass (English, Malaysian English, Malay, Chinese) |
| Attack suite | 46 / 46 blocked (induced transfer, extraction, escalation, prompt injection) |
| Automated tests | 153 passing, no network needed |
| Our classifier | macro F1 0.84 (grouped 5-fold CV) |

## Quick start

Requires Python 3.10+ and Node 20+. No API key is needed: without one the backend runs the
deterministic offline engine, which covers every scripted task.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
# App (Expo / React Native; runs on Android, iOS and web)
cd app
npm install
npx expo start --web            # opens http://localhost:8081; press "a" for Android
```

The app talks to `http://localhost:8000` by default. To point it elsewhere, copy
`app/.env.example` to `app/.env` and set `EXPO_PUBLIC_API_URL`.

### On a phone

- **Development (Expo Go or a development build).** On a phone, `localhost` is the phone itself.
  Set `EXPO_PUBLIC_API_URL` in `app/.env` to your computer's LAN address, e.g.
  `http://192.168.1.20:8000` (the Android emulator reaches the host at `http://10.0.2.2:8000`),
  start the backend with `--host 0.0.0.0`, then fully reload the app. The app's "Can't reach the
  server" banner repeats this on native.
- **Sideloaded APK (`eas build --profile preview`).** Android release builds block plain `http`
  (cleartext) traffic, so the APK needs the demo server behind **HTTPS**. Set the real address in
  `app/eas.json` (`build.preview.env.EXPO_PUBLIC_API_URL`) before building; it is baked in at build
  time. We deliberately do not turn on `usesCleartextTraffic` (an app-wide switch in
  `expo-build-properties`) for a finance app. iOS release builds have the same expectation (App
  Transport Security).
- **Device check.** On Android and iOS, Confirm (student) and Approve (sponsor) first ask for Face ID,
  a fingerprint or the device passcode. Face ID needs a development build (Expo Go doesn't support it
  on iOS). On web, or on a phone with no screen lock, the action goes ahead and
  the card says the device check was skipped.

### One URL for everything (Docker)

```bash
docker compose up --build       # app and API on http://localhost:8000
```

The image builds the Expo web app and serves it from FastAPI. Without Docker you can do the same:
run `npm run build:web` in `app/`, then start the backend; it serves `app/dist` at `/`.

## Using the app

On a wide screen (a laptop at the presentation) the web app shows **both phones side by side**: Aisha's
in Vancouver and her dad's in Kuala Lumpur, on one sandbox, so a request confirmed on one appears on the
other within seconds. On a phone-sized screen the **Aisha / Dad** switch at the top changes view. In
production each person signs in on their own phone and the server decides the role from their credentials.

| Student (Aisha) | Sponsor (Dad) |
|---|---|
| **Assistant**: chat. Answers come with cards built from the bank data (FX comparison, balances, tuition, budget, scam check), labelled as not written by the AI. Drafted payments appear as confirmation cards. | **Approvals**: requests waiting for him, with the reasons they came to him, risk signals, and a note back to Aisha |
| **Wallet**: balances, tuition countdown and shortfall, spending against budget, payees, items in progress | **Rules**: the limits Aisha can confirm alone; only the sponsor can change them |
| **Ledger**: the hash-chained audit log, with live verification and a tamper simulation | **Ledger**: the same audit log |

Try: "Cheapest way to change 5,000 MYR to CAD?", "Pay my spring tuition", "cover the tuition
shortfall from my MYR wallet", "eh rent how much ah, can pay landlord or not", "我还有多少钱？",
or paste a suspicious message after "Is this a scam?". The ↺ button resets the sandbox.

## Choosing the model

```bash
export LLM_PROVIDER=deepseek          # deepseek | deepseek-pro | qwen | qwen-cn | offline | custom
export LLM_API_KEY=sk-...
# optional: LLM_MODEL, LLM_BASE_URL (required for custom), LLM_THINKING=1
```

DeepSeek (`deepseek-flash`) is the default live model because it is reachable from mainland China
and abroad; Qwen (DashScope) is the fallback. If the API fails mid-conversation, the agent finishes
that turn with the offline engine and says so (`"fallback": true`, shown in the app).

## Tests and evidence

```bash
cd backend
pytest -q                                   # tasks, attacks, compromised model, API roles, LLM wire format
python scripts/run_evidence.py              # writes ../evidence/offline/
LLM_PROVIDER=deepseek LLM_API_KEY=sk-... python scripts/run_evidence.py   # writes ../evidence/deepseek/
python scripts/build_classifier_data.py     # rebuilds data/classifier_train.jsonl (already committed)
```

## API

All endpoints take `Authorization: Bearer <token>`. Demo tokens: `demo-student`, `demo-sponsor`
(override with `HB_STUDENT_TOKEN`, `HB_SPONSOR_TOKEN`).

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/chat` | student | `{"message", "session_id"}` → reply, cards, drafted actions, safety flags, tool trace |
| GET | `/overview` | student | Wallet screen: balances, tuition, budget, payees, pending items, limits |
| GET | `/accounts` | student | Balances (masked), payees, tuition schedule |
| GET | `/actions` | student | Drafts and their status (includes the confirm token for drafts awaiting the student) |
| POST | `/actions/{id}/confirm` | student | `{"token"}`: single-use token from the draft |
| POST | `/actions/{id}/cancel` | student | Cancel a draft |
| GET | `/sponsor/queue` | sponsor | Actions waiting for approval |
| GET | `/sponsor/overview` | sponsor | Student balances, limits, recent activity |
| POST | `/sponsor/actions/{id}/approve` · `/reject` | sponsor | `{"note"}`: decide, with an optional note to the student |
| POST | `/sponsor/limits` | sponsor | `{"single_cad", "daily_cad"}`: change the limits |
| GET | `/audit` | any | Recent audit entries |
| GET | `/audit/verify` | any | Verify the hash chain; `?tamper_seq=N` verifies a copy with entry N edited |
| POST | `/demo/reset` | any | Reset the sandbox (demo mode only) |
| GET | `/health` | none | Provider and mode |

## Layout

```
backend/app/    agent loop, tools, policy engine, sandbox bank, FX, guard, classifier, cards, audit log
backend/tests/  scripted tasks, attack suite, compromised-model, API role, LLM wire-format tests
backend/scripts build_classifier_data.py, run_evidence.py
app/            Expo React Native app (student and sponsor views)
docs/           technical documentation, security self-assessment, demo script
evidence/       generated logs for the submission
Dockerfile      single image: web build + API
```

All data is fictional and the bank is a sandbox.
