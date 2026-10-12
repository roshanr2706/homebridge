# HomeBridge · Material 3 variant

A calm, trustworthy "serious bank that's easy to use" take on HomeBridge, in the Google Pay–era Material You /
modern European bank style: light tonal surfaces, a deep-teal primary, large rounded cards, a clear top app bar
and navigation bar, an extended FAB for the assistant, bottom sheets and dialogs for anything that moves money.

## Concept

- **Tonal colour roles, not shadows.** A hand-tuned M3 scheme from a deep-teal seed (`primary #006A6A`, tonal
  `primaryContainer`, a muted-blue tertiary for tuition, amber/green/red status containers) and the M3 surface
  ladder (`surfaceContainerLowest … Highest`) carry hierarchy. Elevation is used only for floating things (FAB,
  sheets, approval cards).
- **M3 shapes and type.** Corner scale 8 / 12 / 16 / 24 / 28 / full; pill buttons; 8 dp chips; 28 dp dialogs and
  sheet corners; M3 switch, segmented buttons, navigation-bar active indicator. Manrope (variable) with tabular
  numerals for every amount.
- **Every status is text + icon**, never colour alone: tier chips (T2 You confirm, T3 You + Dad), risk chips,
  compliance outcome, status chips, verified badge.
- **Money only moves through a sheet or a PIN.** The assistant drafts; the review bottom sheet shows the amount,
  payee, tier/risk chips, compliance checks, "why Dad approves this", warnings, a Stepper (Drafted → You confirm
  → Dad approves → Done) and a single-use-token countdown. Sponsor approvals, unlocks and limit changes go through
  a PIN pad dialog; the PIN is checked by the server.

## Screens (phone-first 390×844 frame centred on desktop; full-screen on phones)

1. **Home** (student): greeting, teal balance hero (total, MYR rate, funded-by-Dad and limit chips), quick-action
   assist chips (pay rent, convert MYR, runway, check a message, lock payments), "Waiting for action" list
   (opens the review sheet), runway alert (error container with a mini runway chart), tuition alert (fund coverage
   progress, "Cover the gap"), accounts list, 30-day budget glance.
2. **Insights**: full runway forecast (SVG line chart with below-zero stretch, tuition marker, lowest point and a
   hover crosshair/tooltip), tuition schedule, credit builder (utilisation gauge with the 30% target, on-time
   streak, recommended payment), full budget.
3. **Assistant** (FAB → full-screen dialog): chat bubbles, suggestion chips (including the CRA gift-card scam check
   and a Chinese question), guard flag chips, result cards for balances, FX true-cost comparison, FX history,
   runway forecast, credit, tuition, budget, transactions, scam verdict, checklist. A drafted payment shows as a
   "Drafted for you" card and opens the review bottom sheet; **Confirm** calls `POST /actions/{id}/confirm` with
   the action's `confirm_token`.
4. **Activity**: segmented button Payments | Audit log. Payments lists every draft with status chips. The audit
   log shows the verified-chain badge (count + head hash), "Simulate tampering" (`/audit/verify?tamper_seq=`),
   and the role-scoped hash-chained entries.
5. **Sponsor mode** (switch from the avatar / menu drawer, or the chips beside the phone on wide screens):
   *Approvals* (24h digest, emergency-lock switch + "lock everything", approval cards with reasons, risk,
   compliance checks, note field, Reject / Approve → PIN pad), alerts; *Funds* (only the accounts Dad funds,
   spending limits with a PIN-confirmed edit dialog, KYC levels, what the sponsor can see); *Activity*.

## Libraries

Runtime: `react`, `react-dom`, `@mui/material` 9, `@mui/icons-material` 9, `@emotion/react`, `@emotion/styled`,
`@fontsource-variable/manrope`. Dev: `vite` 7, `@vitejs/plugin-react`, `typescript`. Versions are pinned exactly.
No runtime CDN links: fonts are bundled by Vite from `@fontsource`, so it works from mainland China.
Charts are hand-written SVG (no chart library).

## Run

```bash
# 1. Backend on :8000 (from the repo root)
cd backend && uvicorn app.main:app --port 8000      # inside the backend venv (see the root README)

# 2. This app
cd ui-variants/material
npm i && npm run dev        # → http://localhost:5183
```

The dev server runs on port **5183** (`strictPort`) and proxies `/api/*` to `http://localhost:8000` (the `/api`
prefix is stripped). `npm run build` type-checks and builds to `dist/`; `npm run preview` serves the build on 5183
with the same proxy.

Demo identities are bearer tokens: `demo-student` (Aisha, Malaysian student at UBC) and `demo-sponsor` (her dad,
Encik Rahman, Kuala Lumpur). Sponsor PIN for the demo: **246810** (shown as a hint under the PIN pad; the server
checks it, and 5 wrong tries lock PIN approval for a while). "Reset demo" in the drawer calls `/demo/reset` with the
demo operator header.

## Live vs demo data

On start the app calls `/api/health`. If the backend answers, everything is live (the chip in the top app bar says
**Live**, and data polls every 5 s). If not, or if any later call can't reach it, the app switches to an in-browser
sandbox built from **fixtures captured from the real backend** and the chip says **Demo data** (tap it to retry
live). The sandbox mimics the server for confirm / cancel / approve (with PIN check) / reject / lock / unlock /
limits / audit scoping, so the whole flow can be clicked through offline. Chat in demo mode answers the captured
questions (and close paraphrases); anything else gets a polite "demo data" reply.

Re-capture fixtures (no server needed; runs the FastAPI app in-process with the offline engine):

```bash
<repo>/backend/.venv/Scripts/python.exe ui-variants/material/scripts/capture_fixtures.py
```

It writes `src/fixtures/*.json`: health, overview, forecast, 12 chat turns (balances, FX, runway, credit, tuition
due, budget, transactions, pay rent, pay spring tuition, cover the tuition gap, CRA gift-card scam, 我的钱够用到学期末吗？),
actions, sponsor overview/queue, audit and audit verify.

## Porting to React Native

The structure maps directly onto **React Native Paper** (Material Design 3):

| Here (MUI) | React Native Paper (MD3) |
|---|---|
| `theme.ts` `m3` colour roles | `MD3LightTheme.colors` (same role names: `primaryContainer`, `surfaceVariant`, `elevation.level1…`) |
| Card / M3Card variants | `Card mode="contained" / "outlined" / "elevated"` |
| Top app bar | `Appbar.Header` |
| BottomNavigation + indicator | `BottomNavigation` (MD3 pill indicator built in) |
| Extended Fab | `AnimatedFAB` (extends/collapses on scroll) |
| Drawer anchor bottom (review sheet) | `@gorhom/bottom-sheet` or Paper `Modal` |
| Dialog / PIN pad | `Portal` + `Dialog` |
| Chip, ToneChip | `Chip mode="flat"` with container colours |
| ToggleButtonGroup | `SegmentedButtons` |
| Switch, LinearProgress, Snackbar | `Switch`, `ProgressBar`, `Snackbar` |
| Stepper | small custom row (Paper has none) |
| SVG charts | `react-native-svg` (same paths) |

`api.ts`, `mock.ts`, `types.ts` and `format.ts` are framework-free and can be reused as-is (swap the `/api` base
for the server URL).
