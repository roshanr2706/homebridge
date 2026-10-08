// Thin client for the HomeBridge API. Roles are carried by bearer tokens only.
export type Role = 'student' | 'sponsor';

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
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
  warnings: string[];
  params: Record<string, unknown>;
  expires_at: number;
  confirm_token?: string;
  result?: Record<string, unknown> | null;
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

export type ChatResponse = {
  reply: string;
  actions: Action[];
  guard: { flags: string[] };
  trace: { tool: string; ok: boolean; ms: number }[];
  provider: string;
  fallback: boolean;
};

async function call<T>(role: Role, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  base: BASE,
  health: () => call<{ ok: boolean; provider: string }>('student', '/health'),
  chat: (message: string, session_id = 'app') =>
    call<ChatResponse>('student', '/chat', 'POST', { message, session_id }),
  accounts: () => call<{ accounts: Account[] }>('student', '/accounts'),
  actions: () => call<{ actions: Action[] }>('student', '/actions'),
  confirm: (id: string, token: string) => call<Action>('student', `/actions/${id}/confirm`, 'POST', { token }),
  cancel: (id: string) => call<Action>('student', `/actions/${id}/cancel`, 'POST'),
  sponsorQueue: () => call<{ actions: Action[] }>('sponsor', '/sponsor/queue'),
  sponsorOverview: () =>
    call<{ accounts: Account[]; limits: Record<string, number>; recent: Action[] }>('sponsor', '/sponsor/overview'),
  approve: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note }),
  reject: (id: string, note = '') => call<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  auditVerify: () => call<{ ok: boolean; count: number }>('sponsor', '/audit/verify'),
  reset: () => call<{ ok: boolean }>('student', '/demo/reset', 'POST'),
};
