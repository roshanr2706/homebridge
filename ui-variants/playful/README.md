# HomeBridge UI variant: Playful

A warm, Gen-Z friendly take on HomeBridge. Think Monzo coral, Cash App confidence and Duolingo-level friendliness: bold colour blocks, chunky outlines with hard drop shadows, a bento-grid home, streaks and progress rings, and simple hand-drawn SVG characters (Aisha, and Dad in his songkok). The tone is friendly ("You're CAD 1,250 short for January. Here's the cheapest fix.") but the numbers, who signs off, and the risk reasons are always spelled out.

## Screens

Phone-first (390×844 frame centred on desktop, full screen on phones).

1. **Home (bento)**: shortfall callout with the cheapest fix, big balance tile (with hide toggle), tuition goal ring ("83% of January's tuition"), cash runway tile with a mini chart, credit on-time streak, Dad tile (pending approvals, KL local time), scam-shield tile, emergency lock tile, quick asks.
2. **Ask (assistant)**: chat with result cards: balances, FX "race" (bar = true cost, shortest wins), runway chart with shortfall and tuition markers plus numbered fixes, credit utilization speedo with streak stamps, scam verdict with shield, tuition plan, budget, transactions. Drafted payments show a confirm card: big amount, who signs off in plain words (Just you / You + Dad), why Dad sees it, risk check, Drafted → You confirm → Dad approves → Done tracker, expiry countdown, and a big Confirm button that calls `/actions/{id}/confirm` with the `confirm_token`. Success shows a confetti celebration; T3 shows a waving Dad.
3. **Money**: accounts (yours vs funded by Dad), spending bars with icon badges and over-budget/duplicate-charge callouts, ledger, audit log tail with an "Audit verified" badge from `/audit/verify`, emergency lock, demo reset.
4. **Dad (sponsor mode, role switch at the top)**: approvals with "Why this came to you" in plain words, Approve → optional note → 6-digit PIN pad (always sends `pin`, demo PIN 246810), Reject with quick note chips, lock my funds / lock all / unlock, 24h digest tiles, alerts, his rules.

## Libraries

- Mantine v9 (`@mantine/core`, `@mantine/hooks`) with a custom theme (coral/sun/mint/grape/sky/ink palettes, chunky radius, hard shadows).
- `@tabler/icons-react` for icons.
- Fonts bundled with `@fontsource-variable/fredoka` (display) and `@fontsource-variable/nunito` (body). No Google Fonts, no CDN, no image assets: everything works offline and in mainland China.
- Charts are hand-written SVG (`src/components/Charts.tsx`); `@mantine/charts` was skipped to avoid pulling in recharts.
- Vite + React 19 + TypeScript. All versions pinned exactly.

## Run

```bash
# 1. backend (from the repo root), on :8000
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000

# 2. this UI
cd ui-variants/playful
npm i && npm run dev        # → http://localhost:5184
npm run build               # type-check + production build
```

The dev server proxies `/api/*` to `http://localhost:8000` (prefix stripped), so there is no CORS setup.

## Live vs demo data

Every call goes to the live backend first. If the backend never answers (no server, proxy error, or a static host with no `/api`), the app switches to saved fixtures for the session and shows a yellow **demo data** chip in the header (tap it to retry live). Once the backend has answered, real errors (policy refusals, wrong PIN) are shown as errors rather than hidden behind fixtures.

The fixtures in `src/fixtures/` are captured from the real backend in-process with FastAPI's `TestClient` (overview, forecast, sponsor overview/queue, audit, and `/chat` for eight messages including the scam check and a Chinese question):

```bash
../../backend/.venv/Scripts/python.exe scripts/capture_fixtures.py   # or: npm run fixtures (Windows)
```

In demo mode a small in-memory store (`src/api/demo.ts`) lets you walk the whole flow: confirm a draft, switch to Dad, approve with the PIN, lock and unlock.

## Porting to React Native

The structure maps cleanly onto a React Native app:

- **Tamagui** is the closest fit: its theme tokens can carry this palette, radius and the hard-shadow "chunky" style as a reusable `styled()` variant, and it compiles to native views. **gluestack-ui** (NativeWind/Tailwind tokens) is a good alternative if the team prefers utility classes.
- The SVG illustrations and charts port almost line for line to `react-native-svg` (same `path`/`circle` primitives).
- Mantine-specific pieces to swap: `RingProgress` → an SVG ring, `Modal` → a bottom sheet, `SegmentedControl` → Tamagui `ToggleGroup`.
- `src/api/*` (types, live-then-fixtures client, demo store) is plain TypeScript and can be shared as is.
- Confetti and the PIN pad are plain components; on native use Reanimated for the confetti and add biometric step-up (as the main Expo app does) before the PIN.
