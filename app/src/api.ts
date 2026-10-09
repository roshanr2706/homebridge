// Thin client for the HomeBridge API. Roles are carried by bearer tokens only.
import { Platform } from 'react-native';

export type Role = 'student' | 'sponsor';

// An exported web build is served by the backend itself, so it calls its own origin. Dev builds
// (Expo dev server on any port) and native builds default to the local backend.
const sameOrigin =
  Platform.OS === 'web' && !__DEV__ && typeof window !== 'undefined' ? window.location.origin : undefined;
const BASE = (process.env.EXPO_PUBLIC_API_URL || sameOrigin || 'http://localhost:8000').replace(/\/$/, '');
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
      signals: Record<string, string[]>;
      model_label?: string;
      model_confidence?: number;
      model_keywords: string[];
      advice: string[];
    }
  | { type: 'transactions'; count: number; rows: { date: string; counterparty: string; amount: number; currency: string; category: string }[] }
  | { type: 'checklist'; title: string; items: string[]; footnote: string };

export type ChatResponse = {
  reply: string;
  actions: Action[];
  cards: Card[];
  guard: { flags: string[] };
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
  health: () => call<{ ok: boolean; provider: string; demo_mode: boolean }>('student', '/health'),
  chat: (message: string, session_id = 'app') => call<ChatResponse>('student', '/chat', 'POST', { message, session_id }),
  overview: () => call<Overview>('student', '/overview'),
  accounts: () => call<{ accounts: Account[] }>('student', '/accounts'),
  actions: () => call<{ actions: Action[] }>('student', '/actions'),
  confirm: (id: string, token: string) => call<Action>('student', `/actions/${id}/confirm`, 'POST', { token }),
  cancel: (id: string) => call<Action>('student', `/actions/${id}/cancel`, 'POST'),
  sponsorQueue: () => call<{ actions: Action[] }>('sponsor', '/sponsor/queue'),
  sponsorOverview: () =>
    call<{ accounts: Account[]; total_cad: number; limits: Record<string, number>; recent: Action[] }>('sponsor', '/sponsor/overview'),
  approve: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note }),
  reject: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  setLimits: (single_cad: number, daily_cad: number) =>
    call<{ limits: Record<string, number> }>('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad }),
  audit: (role: Role, since = 0) => call<{ entries: AuditEntry[] }>(role, `/audit?since=${since}`),
  auditVerify: (role: Role = 'sponsor', tamperSeq?: number) =>
    call<Verify>(role, `/audit/verify${tamperSeq === undefined ? '' : `?tamper_seq=${tamperSeq}`}`),
  reset: () => call<{ ok: boolean }>('student', '/demo/reset', 'POST'),
};
