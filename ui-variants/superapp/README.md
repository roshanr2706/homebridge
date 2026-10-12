# HomeBridge 家桥: super-app UI variant

A dense, Chinese super-app style front end for HomeBridge, modelled on Alipay 支付宝, the WeChat Pay 微信支付 wallet,
the WeBank 微众银行 app and Meituan. It is built for judges and users who live in those apps: everything is one
tap from the home grid, labels are bilingual (Chinese first, small English underneath), and amounts use
tabular numerals.

## Concept

- **首页 Home**: blue header with a search bar that asks the assistant, four hero actions (转账 Pay, 换汇 Convert,
  找爸爸 Ask Dad, 卡包 Cards), a balance strip with a hide/show eye, a rotating 提醒 notice bar built from live data
  ("学费 1月6日到期 · 还差 1,250", runway, card due, over-budget, duplicate charge), a 5×2 service grid (学费,
  信用, 防骗, 账单, 预算, 冻结, 爸爸, 明细, 跑道, 汇率) with red dots and badges, a runway alert card with a
  one-tap "cover the gap", promo-style banners, mini-program tiles and a pending list. Every tile opens the
  assistant with a prompt, opens a screen, or runs the action (lock, switch to Dad).
- **助手 Assistant**: chat with the agent. Replies render server-built cards: balances, FX quotes ranked by true cost,
  FX range, runway chart (hand-drawn SVG), credit utilization gauge, scam verdict, tuition, budget, transactions,
  checklists. Drafted actions show a confirm card with tier (T1/T2/T3) and risk badges, the server's compliance
  checks, "why Dad approves" reasons, risk signals, a 草拟 → 您确认 → 爸爸批准 → 完成 timeline, a live expiry
  countdown, and an Alipay-style cashier sheet before Confirm spends the single-use token. Quick-prompt chips sit
  above the composer.
- **钱包 Wallet**: bank-card style account tiles, pending actions (confirm or withdraw), the secured credit card with
  gauge and "pay card", runway, tuition installments, 30-day budget, payees and limits.
- **我的 Me**: profile with KYC level, a 学生 / 爸爸 role switch (demo only), lock switch, limits, audit-chain verify,
  data source (live or demo) and demo reset.
- **Sponsor (爸爸守护)**: orange theme so the role is obvious. Approval queue with "为什么需要您批准 · why this came to
  you", approve through a 6-digit PIN pad (server-checked, demo PIN 246810), reject with a note, one-tap lock
  (money Dad funds, or everything), 24h digest, Aisha's accounts, limits editor, and an Activity tab with alerts,
  recent requests and audit-chain verification. Unlock and limit changes also go through the PIN pad.

Trust cues stay visible despite the density: a ledger provenance line under every card, "AI drafts only, you
confirm" on the composer and the home footer, sponsor-funded markers on accounts, and red reserved for risk.

## Library

[antd-mobile](https://mobile.ant.design) 5 (Ant Group, the Alipay design team) with
[antd-mobile-icons](https://www.npmjs.com/package/antd-mobile-icons). Components used: TabBar, Badge, Swiper,
Popup, Dialog, ActionSheet, Toast, PasscodeInput + NumberKeyboard (PIN pad), Steps, Segmented, List, Switch,
Stepper, Skeleton, DotLoading, SpinLoading. Charts are small inline SVGs, so there is no chart dependency.

Dependencies (exact versions): react 18.3.1, react-dom 18.3.1, antd-mobile 5.43.0, antd-mobile-icons 0.3.0;
dev: vite 8.3.4, @vitejs/plugin-react 6.1.2, typescript 5.9.3, @types/react, @types/react-dom.

Works from mainland China: no CDN links and no web fonts. The font stack is system fonts ("PingFang SC" on Apple,
"Microsoft YaHei" on Windows, Noto/Source Han Sans on Android/Linux).

## Run

1. Start the backend on :8000 (from `backend/`, e.g. `uvicorn app.main:app --port 8000`).
2. `cd ui-variants/superapp && npm i && npm run dev` and open http://localhost:5181.

The dev server proxies `/api/*` to `http://localhost:8000` (prefix stripped), so the backend's CORS allow-list is
not involved. On a desktop the app shows in a 390×844 phone frame; on a phone it fills the screen.

Other scripts: `npm run build` (type-check + production build), `npm run preview` (serves `dist/` on 5181 with the
same proxy), `npm run smoke` (server-renders every card, action card and screen from the fixtures and runs the
offline flow; no browser needed).

## Live vs fixtures

Everything calls the live API first with the demo bearer tokens (`demo-student`, `demo-sponsor`). If the backend
can't be reached, the app switches to offline fixtures and shows an orange **演示数据 demo data** chip (tap it to
retry the server). Offline mode keeps a little in-memory state, so the demo flow still works: chat answers come
from captured responses (exact match, then keyword routing, incl. Chinese prompts), drafts can be confirmed,
Dad's queue can be approved (PIN checked) or rejected, and lock/unlock and limits behave like the server.

Fixtures live in `src/fixtures/` and are captured from the real backend in-process (FastAPI TestClient, offline
engine, pinned demo date):

```
C:/Users/rosha/Desktop/Projects/FinTechathon/homebridge/backend/.venv/Scripts/python.exe scripts/capture_fixtures.py
```

They cover overview, forecast, sponsor overview and queue, and /chat for: "How much money do I have?",
"Cheapest way to change 5,000 MYR to CAD?", "Will I run out of money before tuition is due?", "How's my credit?",
"Pay rent to my landlord", "Pay my spring tuition", the CRA gift-card scam check, "我的钱够用到学期末吗？", plus the
prompts behind home tiles (transactions, budget, tuition, FX range, pay card, cover shortfall, ask Dad).

## Porting to the React Native app

The structure maps onto the Expo app directly:

- **Components**: [@ant-design/react-native](https://rn.mobile.ant.design) is the RN sibling of antd-mobile with the same
  design language: TabBar, Grid (the service grid), NoticeBar (the ticker), Carousel (banners), Modal/Popup,
  ActionSheet, Toast, Steps, List, Switch, Stepper, SegmentedControl. The PIN pad becomes six boxes plus a custom
  number pad (or a hidden `TextInput` with `keyboardType="number-pad"`).
- **Icons**: antd-mobile-icons are SVGs; use `@ant-design/icons-react-native` or render the same paths with
  `react-native-svg`.
- **Charts**: the runway chart, utilization gauge and sparkline are plain SVG path math, so they port line by line
  to `react-native-svg`.
- **Data**: `src/api.ts` and `src/types.ts` match `app/src/api.ts`; the offline fixture fallback can be reused as-is.
  Overlays here render inside the phone frame via `getContainer`; on RN they are native modals.
- **Styles**: CSS classes become `StyleSheet` objects; the tokens at the top of `styles.css` (blue #1677ff,
  red #ff3141, orange #ff7a00, 4/8 px spacing, 12 px radii) become the theme.
