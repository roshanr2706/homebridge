// HomeBridge API client: live backend first (via the Vite /api proxy), saved fixtures as a fallback.
// Once the server answers, we stay live and surface real errors; if it never answers, we switch to demo
// data for the session and the header shows a "demo data" chip.
import { useSyncExternalStore } from 'react';

import { demo, DEMO_PIN } from './demo';
import type { Action, AuditEntry, ChatResponse, ForecastCard, FreezeState, Overview, Role, SponsorOverview, TransactionsCard, Verify } from './types';

export type Source = 'unknown' | 'live' | 'demo';

let source: Source = 'unknown';
const listeners = new Set<() => void>();
const setSource = (s: Source) => {
  if (s === source) return;
  source = s;
  listeners.forEach((l) => l());
};
export const useSource = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => source,
  );

const TOKENS: Record<Role, string> = { student: 'demo-student', sponsor: 'demo-sponsor' };

class Offline extends Error {}

async function live<T>(role: Role, path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path === '/chat' ? 60000 : 6000),
    });
  } catch {
    throw new Offline("Can't reach the HomeBridge server.");
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  // No JSON at all (proxy error page, static host 404) means there is no backend behind /api.
  if (!isJson || (res.status >= 500 && !(data as { detail?: unknown })?.detail)) throw new Offline("Can't reach the HomeBridge server.");
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `Something went wrong (HTTP ${res.status})`);
  }
  return data as T;
}

async function call<T>(role: Role, path: string, method: string, body: unknown, fallback: () => T): Promise<T> {
  if (source === 'demo') {
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
    return fallback();
  }
  try {
    const out = await live<T>(role, path, method, body);
    setSource('live');
    return out;
  } catch (e) {
    if (e instanceof Offline && source !== 'live') {
      setSource('demo');
      return fallback();
    }
    throw e;
  }
}

const get = <T,>(role: Role, path: string, fb: () => T) => call<T>(role, path, 'GET', undefined, fb);
const post = <T,>(role: Role, path: string, body: unknown, fb: () => T) => call<T>(role, path, 'POST', body, fb);

export const api = {
  retryLive: () => setSource('unknown'),
  newSessionId: () => `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  overview: () => get<Overview>('student', '/overview', demo.overview),
  forecast: () => get<ForecastCard>('student', '/forecast', demo.forecast),
  chat: (message: string, session_id: string) => post<ChatResponse>('student', '/chat', { message, session_id }, () => demo.chat(message)),
  // There is no transactions endpoint: the ledger asks the assistant's read-only lookup in its own chat session.
  transactions: async (): Promise<TransactionsCard | null> => {
    const r = await post<ChatResponse>('student', '/chat', { message: 'show my recent transactions', session_id: 'playful-ledger' }, () => ({
      reply: '',
      actions: [],
      cards: [demo.transactions()],
      guard: { flags: [] },
    }));
    return (r.cards.find((c) => c.type === 'transactions') as TransactionsCard | undefined) ?? null;
  },
  confirm: (id: string, token: string) => post<Action>('student', `/actions/${id}/confirm`, { token }, () => demo.confirm(id)),
  cancel: (id: string) => post<Action>('student', `/actions/${id}/cancel`, {}, () => demo.cancel(id)),
  freeze: () => post<{ freeze: FreezeState }>('student', '/freeze', {}, demo.freeze),
  unfreeze: () => post<{ freeze: FreezeState; note: string }>('student', '/unfreeze', {}, demo.unfreeze),
  sponsorQueue: () => get<{ actions: Action[] }>('sponsor', '/sponsor/queue', demo.sponsorQueue),
  sponsorOverview: () => get<SponsorOverview>('sponsor', '/sponsor/overview', demo.sponsorOverview),
  sponsorFreeze: (scope: 'sponsor_funded' | 'all') => post<{ freeze: FreezeState }>('sponsor', '/sponsor/freeze', { scope }, () => demo.sponsorFreeze(scope)),
  sponsorUnfreeze: () => post<{ freeze: FreezeState }>('sponsor', '/sponsor/unfreeze', {}, demo.sponsorUnfreeze),
  approve: (id: string, note: string, pin: string) =>
    post<Action>('sponsor', `/sponsor/actions/${id}/approve`, { note, pin }, () => demo.decide(id, true, note, pin)),
  reject: (id: string, note: string) => post<Action>('sponsor', `/sponsor/actions/${id}/reject`, { note }, () => demo.decide(id, false, note)),
  audit: (role: Role) => get<{ entries: AuditEntry[] }>(role, '/audit', demo.audit),
  auditVerify: (role: Role) => get<Verify>(role, '/audit/verify', demo.auditVerify),
  reset: () => post<{ ok: boolean }>('student', '/demo/reset', {}, demo.reset),
};

export { DEMO_PIN };
