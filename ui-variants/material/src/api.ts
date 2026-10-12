// API client. Talks to the FastAPI backend through the Vite proxy (/api -> :8000). If the backend can't be
// reached the app switches to the offline sandbox (fixtures captured from the real backend) and shows a
// "Demo data" chip. Roles are carried by bearer tokens only.
import { sandbox } from './mock';
import type { Action, AuditPage, ChatResponse, ForecastCard, FreezeState, Overview, Role, SponsorOverview, Verify } from './types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';
const TOKENS: Record<Role, string> = { student: 'demo-student', sponsor: 'demo-sponsor' };
// Shown as a hint under the sponsor's PIN pad; the server checks the PIN.
export const DEMO_PIN = '246810';
const OPERATOR = 'demo-operator';

export type Source = 'checking' | 'live' | 'fixtures';
let source: Source = 'checking';
const listeners = new Set<(s: Source) => void>();
const setSource = (s: Source) => {
  if (s === source) return;
  source = s;
  listeners.forEach((l) => l(s));
};
export const getSource = () => source;
export const onSource = (fn: (s: Source) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

class NetworkError extends Error {}

async function http<T>(role: Role, path: string, method = 'GET', body?: unknown, timeoutMs = 8000, extra: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}`, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError('unreachable');
  } finally {
    clearTimeout(timer);
  }
  // The Vite proxy answers 502/504 (or an HTML error page) when the backend is down.
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json') && (res.status >= 500 || res.status === 404)) throw new NetworkError('proxy');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
  }
  return data as T;
}

/** Live call with a fixture fallback: a network failure flips the whole app into demo-data mode. */
async function call<T>(live: () => Promise<T>, offline: () => T): Promise<T> {
  if (source === 'fixtures') return offline();
  try {
    const out = await live();
    setSource('live');
    return out;
  } catch (e) {
    if (e instanceof NetworkError) {
      setSource('fixtures');
      return offline();
    }
    throw e;
  }
}

export async function detectSource(): Promise<Source> {
  try {
    await http<{ ok: boolean }>('student', '/health', 'GET', undefined, 2500);
    setSource('live');
  } catch {
    setSource('fixtures');
  }
  return source;
}

/** Try the live backend again (from the "Demo data" chip). */
export async function retryLive(): Promise<Source> {
  source = 'checking';
  return detectSource();
}

export const newSessionId = () => `m3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const api = {
  overview: () => call(() => http<Overview>('student', '/overview'), () => sandbox.getOverview()),
  forecast: () => call(() => http<ForecastCard>('student', '/forecast'), () => sandbox.getForecast()),
  actions: () => call(() => http<{ actions: Action[] }>('student', '/actions'), () => sandbox.getActions()),
  chat: (message: string, session_id: string) =>
    call(
      () => http<ChatResponse>('student', '/chat', 'POST', { message, session_id }, 45000),
      () => sandbox.chat(message),
    ),
  confirm: (id: string, token: string) =>
    call(() => http<Action>('student', `/actions/${id}/confirm`, 'POST', { token }), () => sandbox.confirm(id, token)),
  cancel: (id: string) => call(() => http<Action>('student', `/actions/${id}/cancel`, 'POST'), () => sandbox.cancel(id)),
  freeze: () =>
    call(() => http<{ freeze: FreezeState }>('student', '/freeze', 'POST'), () => ({ freeze: sandbox.studentFreeze() })),
  unfreeze: () =>
    call(() => http<{ freeze: FreezeState; note: string }>('student', '/unfreeze', 'POST'), () => sandbox.studentUnfreeze()),
  sponsorOverview: () => call(() => http<SponsorOverview>('sponsor', '/sponsor/overview'), () => sandbox.sponsorOverview()),
  sponsorQueue: () => call(() => http<{ actions: Action[] }>('sponsor', '/sponsor/queue'), () => sandbox.sponsorQueue()),
  // Approve, unlock and limit changes carry the sponsor's PIN; the server checks it (demo PIN 246810).
  approve: (id: string, note: string, pin: string) =>
    call(
      () => http<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note, pin }),
      () => sandbox.decide(id, true, note, pin),
    ),
  reject: (id: string, note = '') =>
    call(() => http<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }), () => sandbox.decide(id, false, note)),
  sponsorFreeze: (scope: 'sponsor_funded' | 'all') =>
    call(
      () => http<{ freeze: FreezeState }>('sponsor', '/sponsor/freeze', 'POST', { scope }),
      () => ({ freeze: sandbox.sponsorFreeze(scope) }),
    ),
  sponsorUnfreeze: (pin: string) =>
    call(
      () => http<{ freeze: FreezeState }>('sponsor', '/sponsor/unfreeze', 'POST', { pin }),
      () => ({ freeze: sandbox.sponsorUnfreeze(pin) }),
    ),
  setLimits: (single_cad: number, daily_cad: number, pin: string) =>
    call(
      () => http<{ limits: Record<string, number> }>('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad, pin }),
      () => sandbox.setLimits(single_cad, daily_cad, pin),
    ),
  audit: (role: Role) => call(() => http<AuditPage>(role, '/audit'), () => sandbox.auditEntries(role)),
  auditVerify: (role: Role, tamperSeq?: number) =>
    call(
      () => http<Verify>(role, `/audit/verify${tamperSeq === undefined ? '' : `?tamper_seq=${tamperSeq}`}`),
      () => sandbox.verify(tamperSeq),
    ),
  // /demo/reset needs demo mode plus the operator token in X-Operator (not a secret in a demo build).
  reset: () =>
    call(
      () => http<{ ok: boolean }>('student', '/demo/reset', 'POST', undefined, 8000, { 'X-Operator': OPERATOR }),
      () => {
        sandbox.reset();
        return { ok: true };
      },
    ),
};
