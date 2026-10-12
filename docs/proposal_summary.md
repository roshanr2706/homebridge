# HomeBridge: Proposal Summary

FinTechathon 2026 · International Track · Topic C (Cross-border & Student Finance Assistant)

**One line:** an AI finance agent for international students and the family that pays for them, which can plan, compare and draft payments but can never move money on its own.

## Problem

A Malaysian student in Vancouver pays tuition in CAD from money her parents earn in MYR. She loses 3 to 7% of a transfer to hidden exchange-rate margins, has no Canadian credit history, and is a prime target of "embassy safe account" and parcel-to-"police" scams. Her parents fund large payments but have no say and no protection if she is defrauded.

## Solution

A chat-first agent in a mobile app (Android, iOS and web) with two roles on separate devices:

- **Student:** asks in English, Malay or Simplified Chinese (casual Malaysian English is understood). The agent checks balances, forecasts cash flow to the next tuition date, ranks providers by what actually arrives, plans tuition and rent, builds credit on a secured card, checks messages for scams, and can freeze payments.
- **Sponsor (parent abroad):** approves large, unusual or sponsor-funded payments with a server-checked PIN, picks the service when sending money, sets limits, and sees alerts and a daily digest. He sees only the accounts he funds, not her wages or chat.

## How the AI participates safely

The model plans and talks; a policy engine in plain code decides. Every payment is a draft bound to its exact parameters, executed only after the student confirms with a single-use token the model never sees and, above set limits, after the sponsor approves. Tiers run from T0 (read) to T4 (not exposed to the model). A compliance layer screens every draft (sample-list sanctions, KYC, FINTRAC EFTR flag, BNM-style purpose codes, structuring). Our own classifier adds friction, tool output is untrusted, account numbers are masked, and every step is in a hash-chained audit log.

## Evidence and feasibility

<!-- counts: tests=619, tasks=95, attacks=79 -->
On the default offline engine (deterministic, no network): 95 / 95 scripted tasks, 79 / 79 attacks blocked (induced transfer, extraction, privilege escalation, prompt injection), 619 automated tests. DeepSeek, reachable from mainland China, is supported and tested against a mocked API; the live run is pending an API key. Compliance is implemented in the sandbox; production would run on licensed partners (a FINTRAC-registered money-services business in Canada, a BNM-licensed bank onshore in Malaysia).
