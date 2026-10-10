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
};

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
  flagged: { action_id: string; summary: string; risk_score: number; status: string }[];
  alerts: number;
  frozen: boolean;
};

export type SponsorOverview = {
  accounts: Account[];
  total_cad: number;
  limits: Record<string, number>;
  recent: Action[];
  freeze: FreezeState;
  alerts: Alert[];
  digest: Digest;
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
  | CreditCardData;

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
  rates: Record<string, number>;
};

export type AuditEntry = { seq: number; ts: number; event: string; actor: string; data: Record<string, any>; prev: string; hash: string };
export type Verify = { ok: boolean; count: number; head?: string; broken_at?: number; simulated_tamper_seq?: number };

async function call<T>(role: Role, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}` },
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
  health: () => call<{ ok: boolean; provider: string; demo_mode: boolean }>('student', '/health'),
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
  sponsorUnfreeze: () => call<{ freeze: FreezeState }>('sponsor', '/sponsor/unfreeze', 'POST'),
  approve: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note }),
  reject: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  setLimits: (single_cad: number, daily_cad: number) =>
    call<{ limits: Record<string, number> }>('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad }),
  audit: (role: Role, since = 0) => call<{ entries: AuditEntry[] }>(role, `/audit?since=${since}`),
  auditVerify: (role: Role = 'sponsor', tamperSeq?: number) =>
    call<Verify>(role, `/audit/verify${tamperSeq === undefined ? '' : `?tamper_seq=${tamperSeq}`}`),
  reset: () => call<{ ok: boolean }>('student', '/demo/reset', 'POST'),
};
