# HomeBridge: Proposal Summary

FinTechathon 2026 · International Track · Topic C (Cross-border & Student Finance Assistant)

**One line:** an AI finance agent for international students and the family that pays for them, which can plan, compare and draft payments but can never move money on its own.

## Problem

Millions of international students live between two financial systems. A Malaysian student in Vancouver pays tuition in CAD from money her parents earn in MYR. She loses 3 to 7% of every transfer to hidden exchange-rate margins, has no Canadian credit history, and is the main target of tax-agency, "embassy safe account" and rental-deposit scams. Her parents fund large payments from abroad but have no say in how the money is spent and no protection if she is defrauded.

## Solution

HomeBridge is a chat-first agent in a mobile app (Android, iOS and web) with two roles on separate devices:

- **Student:** asks in English, Malaysian English, Malay or Mandarin. The agent checks balances, ranks remittance providers by what actually arrives (fee plus spread against mid-market), forecasts cash flow to the next tuition date, plans tuition and rent, builds credit, and checks pasted messages for scams.
- **Sponsor (parent abroad):** approves large, unusual or sponsor-funded payments and new payees on their own phone, sets limits, and can freeze payments in an emergency.

## How the AI participates safely

The language model plans and talks; a policy engine written in plain code decides. Every payment is a draft bound to its exact parameters. It executes only after the student confirms in the app with a single-use token the model never sees, and, above set limits, after the sponsor approves. Permission tiers run from T0 (read) to T4 (not exposed to the model at all). An input guard plus our own trained scam and injection classifier add friction, tool outputs are treated as untrusted data, account numbers are masked before they reach the model, and every step is written to a hash-chained audit log that detects tampering.

## Evidence and feasibility

Scripted tasks in four languages and an adversarial attack suite (induced transfers, data extraction, privilege escalation, prompt injection) run as automated tests and export sandbox logs. The model layer is provider-agnostic and defaults to DeepSeek, reachable from mainland China; a deterministic offline engine keeps the demo working without network access. A production path would add KYC, AML screening and licensed partner rails (FINTRAC in Canada, Bank Negara Malaysia rules).
