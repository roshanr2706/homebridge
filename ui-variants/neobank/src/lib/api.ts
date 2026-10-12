// Two interchangeable backends: the live FastAPI server (through the Vite /api proxy) and an in-memory
// replay of captured fixtures for when the server is not running. The UI only sees `Backend`.
import type { Action, AuditEntry, ChatResponse, ForecastCard, FreezeState, Overview, Role, SponsorOverview, Verify } from './types';

export interface Backend {
  mode: 'live' | 'demo';
  overview(): Promise<Overview>;
  forecast(): Promise<ForecastCard>;
  actions(): Promise<{ actions: Action[] }>;
  chat(message: string, sessionId: string): Promise<ChatResponse>;
  confirm(id: string, token: string): Promise<Action>;
  cancel(id: string): Promise<Action>;
  freeze(): Promise<{ freeze: FreezeState }>;
  unfreeze(): Promise<{ freeze: FreezeState; note?: string }>;
  sponsorOverview(): Promise<SponsorOverview>;
  sponsorQueue(): Promise<{ actions: Action[] }>;
  approve(id: string, note: string, pin: string): Promise<Action>;
  reject(id: string, note: string): Promise<Action>;
  sponsorFreeze(scope: 'sponsor_funded' | 'all'): Promise<{ freeze: FreezeState }>;
  sponsorUnfreeze(pin: string): Promise<{ freeze: FreezeState }>;
  setLimits(single_cad: number, daily_cad: number, pin: string): Promise<{ limits: Record<string, number> }>;
  audit(role: Role): Promise<{ entries: AuditEntry[] }>;
  auditVerify(role: Role, tamperSeq?: number): Promise<Verify>;
  reset(): Promise<{ ok: boolean }>;
}

const BASE = '/api';
const TOKENS: Record<Role, string> = { student: 'demo-student', sponsor: 'demo-sponsor' };

async function call<T>(role: Role, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${res.status})`);
  }
  return data as T;
}

export const liveBackend: Backend = {
  mode: 'live',
  overview: () => call('student', '/overview'),
  forecast: () => call('student', '/forecast'),
  actions: () => call('student', '/actions'),
  chat: (message, session_id) => call('student', '/chat', 'POST', { message, session_id }),
  confirm: (id, token) => call('student', `/actions/${id}/confirm`, 'POST', { token }),
  cancel: (id) => call('student', `/actions/${id}/cancel`, 'POST'),
  freeze: () => call('student', '/freeze', 'POST'),
  unfreeze: () => call('student', '/unfreeze', 'POST'),
  sponsorOverview: () => call('sponsor', '/sponsor/overview'),
  sponsorQueue: () => call('sponsor', '/sponsor/queue'),
  approve: (id, note, pin) => call('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note, pin }),
  reject: (id, note) => call('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  sponsorFreeze: (scope) => call('sponsor', '/sponsor/freeze', 'POST', { scope }),
  // Sponsor money decisions (approve, unlock, limits) carry the sponsor PIN; the server checks it.
  sponsorUnfreeze: (pin) => call('sponsor', '/sponsor/unfreeze', 'POST', { pin }),
  setLimits: (single_cad, daily_cad, pin) => call('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad, pin }),
  audit: (role) => call(role, '/audit'),
  auditVerify: (role, tamperSeq) =>
    call(role, `/audit/verify${tamperSeq === undefined ? '' : `?tamper_seq=${tamperSeq}`}`),
  reset: () => call('student', '/demo/reset', 'POST'),
};

/** True when the HomeBridge API answers /health within the timeout. */
export async function probeLive(timeoutMs = 1800): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/health`, { signal: ctl.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const DEMO_PIN = '246810';
export const newSessionId = () => `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
