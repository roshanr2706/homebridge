# UI variants

Four working prototypes of the HomeBridge app, each built with a different UI library to compare directions.
All four call the same backend through a Vite proxy (`/api` -> `localhost:8000`) and fall back to captured
fixtures when it is down. Start the backend first, then `npm i && npm run dev` inside a variant folder.
Screenshots of each are in `screenshots/`.

- [playful](playful/README.md): warm, Gen-Z friendly bento UI (Mantine v9, coral/sun palette, streaks, Dad mascot, PIN-pad approvals), port 5184
- [superapp](superapp/README.md): dense Chinese super-app style (antd-mobile, Alipay/WeChat Pay-like service grid, bilingual 中/EN, notice ticker, PIN-pad approvals), port 5181
- [neobank](neobank/README.md): premium dark neo-bank (Tailwind v4, Radix, motion; near-black glass, one lime accent, tabular hero numerals, swipe-to-confirm, animated runway chart, PIN-pad approvals), port 5182
- [material](material/README.md): calm, trustworthy Material 3 bank (MUI v9 with a custom M3 theme; deep-teal tonal roles, large rounded cards, nav bar + assistant FAB, bottom-sheet confirm with stepper, compliance checks, PIN-pad approvals), port 5183
