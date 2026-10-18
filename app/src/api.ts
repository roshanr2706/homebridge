// Thin client for the HomeBridge API. Roles are carried by bearer tokens only.
import { Platform } from 'react-native';

export type Role = 'student' | 'sponsor';

// An exported web build is served by the backend itself, so it calls its own origin. Dev builds
// (Expo dev server on any port) and native builds default to the local backend.
const sameOrigin =
  Platform.OS === 'web' && !__DEV__ && typeof window !== 'undefined' ? window.location.origin : undefined;
const BASE = (process.env.EXPO_PUBLIC_API_URL || sameOrigin || 'http://localhost:8000').replace(/\/$/, '');
// On a phone, "localhost" is the phone itself, so the dev hint says where to point the app. Release
// builds block plain http on Android, so an installed APK needs an https server baked in at build time.
const UNREACHABLE =
  Platform.OS === 'web'
    ? `Can't reach the server at ${BASE}`
    : __DEV__
      ? `Can't reach the server at ${BASE}. On a phone, set EXPO_PUBLIC_API_URL in app/.env to your computer's LAN address (Android emulator: http://10.0.2.2:8000), then reload the app.`
      : `Can't reach the server at ${BASE}. Check your connection; this build only talks to an https server set by EXPO_PUBLIC_API_URL when it was built.`;
const TOKENS: Record<Role, string> = {
  student: process.env.EXPO_PUBLIC_STUDENT_TOKEN ?? 'demo-student',
  sponsor: process.env.EXPO_PUBLIC_SPONSOR_TOKEN ?? 'demo-sponsor',
};
// Sent only to /demo/reset, and only when the server says demo mode is on. The server refuses a reset outside
// demo mode whatever is sent. Not a secret in a demo build (see R11 in docs/security_self_assessment.md).
const OPERATOR = process.env.EXPO_PUBLIC_OPERATOR_TOKEN ?? 'demo-operator';
// Shown as a hint under the sponsor's PIN field in demo mode only; never prefilled.
export const DEMO_PIN_HINT = process.env.EXPO_PUBLIC_DEMO_PIN ?? '246810';

// One line per compliance check on an action card (backend/app/compliance.py).
export type ComplianceCheck = {
  id: string;
  label: string;
  status: 'pass' | 'flag' | 'block' | 'report' | 'na';
  detail: string;
};
export type Compliance = {
  outcome: 'clear' | 'review' | 'blocked';
  blocked: boolean;
  block_reason: string | null;
  checks: ComplianceCheck[];
  reports: string[];
  record: Record<string, any> | null;
  purpose_code: { code: string; label: string } | null;
  cross_border: boolean;
  amount_cad: number;
};

export type Kyc = { user_id: string; level: string; label: string; moves_money: boolean; max_single_cad: number; max_daily_cad: number };
export type Sharing = { scope: string; summary: string; consented_at_onboarding: boolean };

export type Action = {
  action_id: string;
  kind: 'transfer' | 'conversion' | 'add_payee' | 'topup';
  summary: string;
  tier: string;
  status: string;
  needs_sponsor_approval: boolean;
  risk_score: number;
  risk_reasons: string[];
  sponsor_reasons?: string[];
  risk_signals?: string[];
  warnings: string[];
  params: Record<string, any>;
  created_at: number;
  expires_at: number;
  user_confirmed?: boolean;
  sponsor_decision?: string | null;
  sponsor_note?: string;
  confirm_token?: string;
  result?: Record<string, any> | null;
  provenance?: Record<string, string>;
  // Why it can't be confirmed or approved right now (payments are locked), or null.
  frozen?: string | null;
  compliance?: Compliance;
  // A money request (kind 'topup') runs as a remittance from the sponsor's own account (backend/app/remit.py).
  remittance?: Remittance;
  eta_in_seconds?: number | null;
  // Sponsor's view only: the true-cost comparison while it waits for him, and the account it is sent from.
  remit_options?: RemitOption[];
  sponsor_source?: { label: string; number: string; currency: string; balance?: number } | null;
  // Sponsor's queue only: an advisory second opinion (backend/app/reviewer.py). It can't approve or change anything.
  review?: Review;
};

export type Review = {
  verdict: 'normal' | 'check' | 'scam';
  label: string;          // already in the sponsor's language, e.g. "Check with Aisha"
  text: string;
  source: 'model' | 'rules';
  language?: string;
};

export type RemitStep = 'initiated' | 'compliance_checked' | 'in_transit' | 'credited';
export type Remittance = {
  status?: string;
  reference?: string;
  timeline?: Partial<Record<RemitStep, number>>;
  settle_after?: number;
  compliance_outcome?: string;
};
export type RemitQuote = {
  provider_key: string;
  provider: string;
  send_amount: number;
  send_currency: string;
  fee: number;
  fee_currency: string;
  rate: number;
  mid_rate: number;
  spread_pct: number;
  receive_amount: number;
  receive_currency: string;
  true_cost: number;
  true_cost_pct: number;
  speed: string;
};
export type RemitOption = RemitQuote & { eta: string; cheapest: boolean; extra_vs_cheapest: number };

// Who locked each kind of money: the sponsor's own funds, and the student's own money.
export type FreezeState = {
  frozen: boolean;
  own: 'student' | 'sponsor' | null;
  sponsor_funded: 'student' | 'sponsor' | null;
  since: number | null;
};

export type Alert = { id: string; ts: number; kind: string; message: string; weight: number };

export type Digest = {
  window_hours: number;
  drafted: number;
  executed: number;
  awaiting_sponsor: number;
  stopped: number;
  money_out_cad: number;
  // 'sponsor_funded' in the sponsor's view: only money out of the accounts they fund.
  money_out_scope?: 'sponsor_funded' | 'all';
  flagged: { action_id: string; summary: string; risk_score: number; status: string }[];
  alerts: number;
  frozen: boolean;
};

// Data minimisation: only the accounts the sponsor funds and the requests sent to them.
export type SponsorOverview = {
  student: { id: string; name: string };
  accounts: Account[];
  total_cad: number;
  limits: Record<string, number>;
  // The sponsor's own account(s) in Kuala Lumpur, which remittances are sent from.
  source_accounts?: Account[];
  recent: Action[];
  freeze: FreezeState;
  alerts: Alert[];
  digest: Digest;
  kyc: { student: Kyc; sponsor: Kyc; limit_ceiling: { single_cad: number; daily_cad: number } };
  pin: { set: boolean; locked: boolean; failures: number };
  sharing: Sharing;
};

export type Account = {
  id: string;
  label: string;
  currency: string;
  balance: number;
  number: string;
  sponsor_funded: boolean;
};

export type Quote = {
  provider: string;
  provider_key: string;
  you_receive: number;
  receive_currency: string;
  fee: number;
  fee_currency: string;
  rate: number;
  mid_rate: number;
  true_cost: number;
  true_cost_pct: number;
  speed: string;
};

export type BudgetCategory = { category: string; spent_cad: number; budget_cad: number | null; over_budget: boolean };

// Credit Builder: the sandbox secured card. "health" is a simulated band, never a credit score.
export type CreditStatus = 'on_time' | 'late' | 'due';
export type CreditHealth = { key: 'needs_attention' | 'fair' | 'on_track' | 'strong'; label: string; basis: string };
export type CreditCardData = {
  type: 'credit';
  card: { label: string; number: string; currency: string; credit_limit: number; balance: number; available: number; deposit: number };
  utilization_pct: number;
  utilization_reported_pct: number;
  utilization_projected_at_close_pct: number;
  target_pct: number;
  next_statement_date: string;
  days_until_statement: number;
  statement: { balance: number; minimum_due: number; remaining: number; due_date: string; days_until_due: number; status: CreditStatus } | null;
  on_time_streak: number;
  months_of_history: number;
  payment_history: CreditStatus[];
  health: CreditHealth;
  recommended_payment: { amount: number; balance_after: number; utilization_after_pct: number };
  next_actions: { key: string; text: string; amount?: number | null }[];
  footnote: string;
};
export type CreditProfile =
  | { has_card: false }
  | (Omit<CreditCardData, 'type' | 'health' | 'payment_history' | 'footnote' | 'card'> & {
      has_card: true;
      card: CreditCardData['card'];
      credit_health: CreditHealth;
      payment_history: { closed: string; status: CreditStatus }[];
      disclosure: string;
    });

export type Card =
  | { type: 'balances'; total: number; total_currency: string; accounts: Omit<Account, 'id'>[] }
  | {
      type: 'fx_quotes';
      from_currency: string;
      to_currency: string;
      amount: number;
      best: string;
      saving_vs_worst: number;
      cached: boolean;
      note: string;
      quotes: Quote[];
    }
  | { type: 'fx_history'; pair: string; today: number; low: number; high: number; average: number; days: number; series: number[] }
  | {
      type: 'tuition';
      installments: { term: string; due: string; amount: number; currency: string; days_until_due: number }[];
      tuition_fund_cad: number;
      next_shortfall_cad: number;
      myr_wallet_value_cad: number;
    }
  | {
      type: 'budget';
      period_days: number;
      categories: BudgetCategory[];
      total_spent_cad: number;
      income_cad: number;
      possible_duplicate_charges: string[];
    }
  | {
      type: 'scam_check';
      verdict: 'likely_scam' | 'suspicious' | 'no_known_pattern';
      signals: { category: string; name: string }[];
      quote?: string;
      model_label?: string;
      model_confidence?: number;
      model_keywords: string[];
      advice: string[];
    }
  | { type: 'transactions'; count: number; rows: { date: string; counterparty: string; amount: number; currency: string; category: string }[] }
  | { type: 'checklist'; title: string; items: string[]; footnote: string }
  | ForecastCard
  | CreditCardData
  // get_remittance_status: the money requests to show as action cards (with their live timeline).
  | { type: 'remittance'; action_ids: string[] };

// Cash-flow forecast ("runway"). `series` is one bar per `step_days` days from start_date; the indexes
// below point into it.
export type ForecastCard = {
  type: 'forecast';
  account: string;
  start_date: string;
  end_date: string;
  horizon: string;
  verdict: 'on_track' | 'tuition_gap' | 'spending_shortfall' | 'both';
  series: number[];
  step_days: number;
  starting_balance: number;
  ending_balance: number;
  lowest: { date: string; balance: number; index: number };
  first_shortfall_date: string | null;
  shortfall_index: number | null;
  tuition: { term: string; due: string; amount: number; gap: number; index: number }[];
  weekly_spending_cad: number;
  pending_included: string[];
  suggestions: string[];
  disclosure: string;
};

export type ChatResponse = {
  reply: string;
  actions: Action[];
  cards: Card[];
  // flags: this message; carried: flags from earlier turns that applied to it; session_flags: what the chat
  // carries into its next turn (strong flags from the last few turns).
  guard: { flags: string[]; carried?: string[]; session_flags?: string[] };
  trace: { tool: string; ok: boolean; ms: number }[];
  provider: string;
  fallback: boolean;
};

export type Overview = {
  accounts: Account[];
  total_cad: number;
  tuition: Omit<Extract<Card, { type: 'tuition' }>, 'type'>;
  budget: Omit<Extract<Card, { type: 'budget' }>, 'type'>;
  reminders: { id: string; due: string; text: string }[];
  payees: { id: string; name: string; kind: string; currency: string; number: string; status: string; usable_from: number | null }[];
  pending: Action[];
  credit?: CreditProfile;
  freeze: FreezeState;
  limits: { single_cad: number; daily_cad: number };
  kyc?: Kyc;
  sharing?: Sharing;
  rates: Record<string, number>;
};

// Ringgit is non-internationalised: in production the MYR wallet is a linked account at a Malaysian bank.
export const accountNote = (a: { currency: string }) => (a.currency === 'MYR' ? 'MYR (linked Malaysian account)' : '');

export type AuditEntry = { seq: number; ts: number; event: string; actor: string; data: Record<string, any>; prev: string; hash: string };
export type Verify = { ok: boolean; count: number; head?: string; broken_at?: number; simulated_tamper_seq?: number };

export type AuditPage = { entries: AuditEntry[]; scope: Role; visible: number; total: number };
export type Health = { ok: boolean; provider: string; demo_mode: boolean; today?: string };

// Each person's app preferences and onboarding consents (backend/app/prefs.py).
export type SkinName = 'neo' | 'superapp';
export type Prefs = {
  display_name: string;
  language: 'en' | 'zh';
  skin: SkinName;
  onboarded_at: number | null;
  consents: Record<string, { agreed?: boolean; value?: boolean; at?: number; provider?: string; region?: string }>;
};
// Where chat text is processed: the offline engine (nothing leaves the server) or a cloud model and its region.
export type ModelRoute = { provider: string; label: string; region: string; leaves_server: boolean };
export type Me = {
  id: string;
  role: Role;
  name: string;
  prefs: Prefs;
  model_route: ModelRoute;
  sharing?: Sharing;
  chat_engine?: string;
};
export type OnboardingIn = {
  display_name: string;
  language: 'en' | 'zh';
  skin: SkinName;
  consents: { sponsor_sharing?: boolean; ai_processing?: boolean; offline_only?: boolean; sponsor_terms?: boolean };
};
export type PrefsIn = Partial<Pick<Prefs, 'display_name' | 'language' | 'skin'>> & { offline_only?: boolean };

async function call<T>(role: Role, path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}`, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  base: BASE,
  unreachable: UNREACHABLE,
  health: () => call<Health>('student', '/health'),
  // Each call carries that person's own token: onboarding and prefs only ever change the caller's own record.
  me: (role: Role) => call<Me>(role, '/me'),
  onboard: (role: Role, body: OnboardingIn) => call<Me>(role, '/me/onboarding', 'POST', body),
  savePrefs: (role: Role, body: PrefsIn) => call<Me>(role, '/me/prefs', 'POST', body),
  // Each chat in the app has its own session id ("New chat" makes a fresh one), so a flag in one chat
  // does not follow the student into the next. Rate limits are per account on the server, not per chat.
  chat: (message: string, session_id: string) => call<ChatResponse>('student', '/chat', 'POST', { message, session_id }),
  newSessionId: () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  overview: () => call<Overview>('student', '/overview'),
  forecast: () => call<ForecastCard>('student', '/forecast'),
  accounts: () => call<{ accounts: Account[] }>('student', '/accounts'),
  actions: () => call<{ actions: Action[] }>('student', '/actions'),
  confirm: (id: string, token: string) => call<Action>('student', `/actions/${id}/confirm`, 'POST', { token }),
  cancel: (id: string) => call<Action>('student', `/actions/${id}/cancel`, 'POST'),
  sponsorQueue: () => call<{ actions: Action[] }>('sponsor', '/sponsor/queue'),
  sponsorOverview: () => call<SponsorOverview>('sponsor', '/sponsor/overview'),
  // Emergency lock. There is no unlock in the chat: the student unlocks her own money here, the sponsor the rest.
  freeze: () => call<{ freeze: FreezeState }>('student', '/freeze', 'POST'),
  unfreeze: () => call<{ freeze: FreezeState; note: string }>('student', '/unfreeze', 'POST'),
  sponsorFreeze: (scope: 'sponsor_funded' | 'all') => call<{ freeze: FreezeState }>('sponsor', '/sponsor/freeze', 'POST', { scope }),
  // Unlocking, approving and changing limits need the sponsor's PIN, checked on the server.
  sponsorUnfreeze: (pin: string) => call<{ freeze: FreezeState }>('sponsor', '/sponsor/unfreeze', 'POST', { pin }),
  // For a money request, `provider` is the transfer service the sponsor picked (empty: the cheapest).
  approve: (id: string, note: string, pin: string, provider = '') =>
    call<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note, pin, provider }),
  reject: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  setLimits: (single_cad: number, daily_cad: number, pin: string) =>
    call<{ limits: Record<string, number> }>('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad, pin }),
  audit: (role: Role, since = 0) => call<AuditPage>(role, `/audit?since=${since}`),
  auditVerify: (role: Role = 'sponsor', tamperSeq?: number) =>
    call<Verify>(role, `/audit/verify${tamperSeq === undefined ? '' : `?tamper_seq=${tamperSeq}`}`),
  // The operator header goes out only when the server says it is in demo mode.
  reset: async () => {
    const h = await call<Health>('student', '/health');
    if (!h.demo_mode) throw new Error('Reset is only available in demo mode');
    return call<{ ok: boolean }>('student', '/demo/reset', 'POST', undefined, { 'X-Operator': OPERATOR });
  },
};
