# HomeBridge · Neo (premium dark neo-bank variant)

A UI prototype for HomeBridge in the style of Revolut, Wise, Monzo (dark) and Apple Wallet. It runs against the
real FastAPI backend, or against fixtures captured from it when the server is not running.

## Concept

- **Near-black, one accent.** Ink surfaces (`#0a0b0d` to `#22252a`) with hairline borders and a faint top-lit
  gradient for depth. One vivid accent, signal lime `#c6f94a`, used for the primary account card, the active
  tab, money that is OK and the confirm control. Amber and red appear only when something needs attention
  (waiting for Dad, shortfall, scam, lock).
- **Numbers first.** The total balance is a 52 px tabular numeral with the symbol and cents set smaller and
  dimmer. It counts between values and between CAD and MYR. All money uses tabular figures, so digits don't
  shift while animating.
- **Tokens, not one-offs.** Radii tile 16 / card 24 / sheet 32; a 4 pt spacing grid; one spring
  (`stiffness 420, damping 38`) shared by cards, sheets, tabs and toggles. Defined once in `src/index.css`
  (`@theme`) and `src/components/primitives.tsx`.
- **Micro-interactions with a purpose.** Swipe-to-confirm for payments (drag the knob to the end; Enter or Space
  also confirms), the runway chart draws itself left to right with the below-zero part in red, the credit ring
  fills to its value with a tick at the 30% target, and bottom sheets spring in and can be dragged down to close.
  The approval PIN pad shakes on a wrong PIN.

## Screens

1. **Home**: greeting, total balance with a CAD/MYR switch, quick actions (Convert, Pay rent, Runway, Scam check),
   an account carousel (CAD Everyday in lime, MYR Wallet "from Dad", CAD Tuition Fund with progress to the next
   instalment, Secured card with a utilization ring), "For you" insight chips built from the data (statement due,
   over-budget categories, possible double charge, utilization, payments waiting for Dad), the runway mini-chart
   (opens a sheet with the full forecast) and the tuition countdown with "Cover it from your MYR wallet".
2. **Assistant**: chat with the agent and suggested prompts (including one in Chinese). Replies render the
   backend's cards: balances, FX true-cost ranking (cheapest first, bars by true cost, saving vs worst), runway
   chart with the shortfall zone and tuition marker, credit utilization ring and statement, scam verdict with
   model confidence and signals, tuition, budget, transactions, checklists. Payment drafts render as a confirm
   card: tier chip (T2 "You confirm", T3 "You + Dad"), "Why Dad approves this too", risk signals and warnings,
   compliance screening (expandable list of checks; blocked drafts shown as blocked), a Drafted → You confirm →
   Dad approves → Done timeline, expiry countdown and swipe-to-confirm calling `/actions/{id}/confirm` with the
   draft's `confirm_token`.
3. **Wallet**: Accounts (balances, secured card, freeze payments switch, the limits Dad set), Budget (spent vs
   income, category bars against budgets, double-charge warning) and Activity (recent payments with status, and
   the audit ledger with an "Audit chain verified" badge from `/audit/verify`, plus "Simulate a tampered entry",
   which asks the server to verify a copy with one entry edited and shows where the chain breaks).
4. **Sponsor mode** (tap the avatar to switch profile): **Approvals** shows the money he funds, the queue with
   "Why this came to you", warnings, compliance and timeline, Approve (6-digit PIN pad, demo PIN 246810, with a
   one-tap fill) and Decline (sheet with quick notes), recent decisions, and what the sponsor can and can't see.
   **Safety** has the emergency lock (scope: money I fund / everything; unlocking takes the PIN), the 24-hour
   digest, alerts, Aisha's limits (edit with steppers capped at her KYC ceiling, confirmed with the PIN) and the
   sponsor's own audit trail.

The app is phone-first: a 390 × 844 frame centred over a dark stage on desktop, full screen on a phone.
English UI; the assistant accepts any language the backend does.

## Libraries

| Package | Why |
| --- | --- |
| React 19, Vite 8, TypeScript 6 | app and build |
| Tailwind CSS 4 (`@tailwindcss/vite`) | tokens in `@theme`, utilities |
| Radix UI: `react-dialog`, `react-tabs`, `react-toggle-group` | sheets (focus trap, Escape, portalled into the phone frame), bottom tab bar and wallet tabs, segmented controls; composed by hand in shadcn style |
| `motion` (successor to framer-motion) | springs, layout animations, drag (swipe-to-confirm, sheets), chart drawing |
| `lucide-react` | icons |
| `@fontsource-variable/geist`, `geist-mono` | fonts bundled locally (no Google Fonts or CDN, so it works from mainland China); CJK text falls back to PingFang SC / Microsoft YaHei |

All versions are pinned exactly in `package.json`.

## Run

1. Start the backend on port 8000 (from the repo root, see the main README), for example
   `cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000`.
2. In this folder: `npm i && npm run dev`, then open http://localhost:5182.

The dev server proxies `/api/*` to `http://localhost:8000/*` (prefix stripped), so the browser never makes a
cross-origin request and the backend's CORS allow-list doesn't matter. Tokens: `Bearer demo-student` (Aisha) and
`Bearer demo-sponsor` (Encik Rahman). Sponsor approvals, unlocks and limit changes send `pin: "246810"` once
the PIN pad has been completed.

`npm run build` type-checks and builds to `dist/`.

## Live API vs demo data

On start the app calls `/api/health` (1.8 s timeout). If it answers, everything is live and the header shows a
lime **Live** chip. If not, it switches to an in-memory replay of fixtures captured from the real backend and the
header shows an amber **Demo data** chip. The replay keeps state, so the flows still work end to end:
confirming moves money, a T3 payment goes to the sponsor queue, approving executes it (or fails exactly as the
server would when the tuition fund is short, until the shortfall is covered), locks and the PIN behave like the
server's, and the sponsor only sees what he funds. Free-typed chat messages are matched to the nearest captured
answer; anything else gets a short "demo mode" reply.

Refresh the fixtures from the current backend code (offline engine, fixed demo date, FastAPI TestClient; no
server needed):

```
npm run fixtures
# or: ../../backend/.venv/Scripts/python.exe scripts/capture_fixtures.py
```

It writes `src/fixtures/*.json`: overview, forecast, sponsor overview and queue, both audit views, the audit
verification and ten chat responses (balances, MYR→CAD, runway, credit, rent, tuition, a CRA gift-card scam check,
a Chinese runway question, transactions and covering the tuition shortfall).

## Porting to the React Native app

The structure maps one-to-one onto the Expo app in `app/`:

- **Styling**: the `@theme` tokens become a NativeWind (Tailwind for RN) config with the same colour, radius and
  font names, so most `className` strings carry over. `glass` becomes a `View` with the same border and a
  `LinearGradient` (or `expo-blur` for the tab bar and toasts).
- **Motion**: springs and enter/exit transitions map to Moti (`MotiView` with `transition={{ type: 'spring' }}`,
  `AnimatePresence`) on Reanimated. Swipe-to-confirm becomes a `Gesture.Pan()` from react-native-gesture-handler
  driving a shared value with `withSpring`, plus `expo-haptics` at the end of the track. Animated numerals use a
  Reanimated derived value rendered through `react-native-redash`'s `ReText`, or Skia text.
- **Charts**: the runway, ring and sparkline are plain SVG paths, so they port to `react-native-svg` unchanged;
  path drawing uses Reanimated `strokeDashoffset`.
- **Primitives**: Radix Dialog becomes `@gorhom/bottom-sheet` (drag to dismiss built in), Tabs becomes the Expo
  Router tab bar with a custom pill, ToggleGroup becomes a small segmented component. Fonts load with
  `expo-font` from the same Geist files.
- **Data**: `src/lib/api.ts` has the same shape as `app/src/api.ts`; the demo backend (`src/lib/demo.ts`) can be
  reused as an offline mode in the app.

## Files

```
src/
  App.tsx              stage, phone frame, status bar, tab bar, screen transitions
  index.css            design tokens and utilities
  lib/                 api (live), demo (fixture replay), store (context), types, format
  components/          primitives, charts, SwipeToConfirm, ActionCard (+ compliance), ResultCards,
                       PinSheet, Ledger, Chrome (header, profile switcher, toasts)
  screens/             Home, Assistant, Wallet, SponsorApprovals, SponsorSafety
  fixtures/            captured backend responses
scripts/capture_fixtures.py
```
