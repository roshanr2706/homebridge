// Client for the HomeBridge API (through the Vite proxy at /api). Roles travel only as bearer tokens.
// If the backend can't be reached, the app switches to offline fixtures captured from the real
// backend (scripts/capture_fixtures.py) and shows a "demo data" chip until a retry reaches the server.
import { useSyncExternalStore } from 'react';
import { offline } from './offline';
import type { Action, ChatResponse, ForecastCard, FreezeState, Overview, Role, SponsorOverview, Verify } from './types';

const BASE = '/api';
const TOKENS: Record<Role, string> = { student: 'demo-student', sponsor: 'demo-sponsor' };

export type Source = 'checking' | 'live' | 'demo';
let source: Source = 'checking';
let provider = '';
const listeners = new Set<() => void>();
function setSource(s: Source) {
  if (s === source) return;
  source = s;
  listeners.forEach((l) => l());
}
export function useSource(): Source {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => source,
    () => source,
  );
}
export const getProvider = () => provider;

class Unreachable extends Error {}

async function live<T>(role: Role, path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Unreachable('network');
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  // The dev proxy answers 5xx with a non-JSON body when nothing listens on :8000.
  if (!isJson && res.status >= 500) throw new Unreachable(`proxy ${res.status}`);
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
  }
  return data as T;
}

async function call<T>(role: Role, path: string, method = 'GET', body?: unknown): Promise<T> {
  if (source !== 'demo') {
    try {
      const r = await live<T>(role, path, method, body);
      setSource('live');
      return r;
    } catch (e) {
      if (!(e instanceof Unreachable)) throw e;
      setSource('demo');
    }
  }
  return offline<T>(role, path, method, body);
}

/** Probe the server; on success leave demo mode. */
export async function checkLive(): Promise<boolean> {
  try {
    const h = await live<{ ok: boolean; provider: string }>('student', '/health', 'GET');
    provider = h.provider;
    setSource('live');
    return true;
  } catch {
    provider = 'fixtures';
    setSource('demo');
    return false;
  }
}

export const newSessionId = () => `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const api = {
  chat: (message: string, session_id: string) => call<ChatResponse>('student', '/chat', 'POST', { message, session_id }),
  overview: () => call<Overview>('student', '/overview'),
  forecast: () => call<ForecastCard>('student', '/forecast'),
  actions: () => call<{ actions: Action[] }>('student', '/actions'),
  confirm: (id: string, token: string) => call<Action>('student', `/actions/${id}/confirm`, 'POST', { token }),
  cancel: (id: string) => call<Action>('student', `/actions/${id}/cancel`, 'POST'),
  freeze: () => call<{ freeze: FreezeState }>('student', '/freeze', 'POST'),
  unfreeze: () => call<{ freeze: FreezeState; note: string }>('student', '/unfreeze', 'POST'),
  sponsorOverview: () => call<SponsorOverview>('sponsor', '/sponsor/overview'),
  sponsorQueue: () => call<{ actions: Action[] }>('sponsor', '/sponsor/queue'),
  // The server checks the sponsor's 6-digit PIN on Approve, Unlock and limit changes (demo PIN 246810).
  approve: (id: string, note: string, pin: string) =>
    call<Action>('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note, pin }),
  reject: (id: string, note: string) => call<Action>('sponsor', `/sponsor/actions/${id}/reject`, 'POST', { note }),
  sponsorFreeze: (scope: 'sponsor_funded' | 'all') => call<{ freeze: FreezeState }>('sponsor', '/sponsor/freeze', 'POST', { scope }),
  sponsorUnfreeze: (pin: string) => call<{ freeze: FreezeState }>('sponsor', '/sponsor/unfreeze', 'POST', { pin }),
  setLimits: (single_cad: number, daily_cad: number, pin: string) =>
    call<{ limits: Record<string, number> }>('sponsor', '/sponsor/limits', 'POST', { single_cad, daily_cad, pin }),
  auditVerify: () => call<Verify>('sponsor', '/audit/verify'),
  reset: () => call<{ ok: boolean }>('student', '/demo/reset', 'POST'),
};
