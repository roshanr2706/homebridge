import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { liveBackend, newSessionId, probeLive, type Backend } from './api';
import { createDemoBackend } from './demo';
import type { Action, ChatResponse, ForecastCard, Overview, Role, SponsorOverview } from './types';

export type StudentTab = 'home' | 'assistant' | 'wallet';
export type SponsorTab = 'approvals' | 'safety';

export type ChatMessage =
  | { id: string; from: 'user'; text: string }
  | { id: string; from: 'agent'; pending: true }
  | { id: string; from: 'agent'; pending?: false; res: ChatResponse }
  | { id: string; from: 'agent'; pending?: false; error: string };

export type Toast = { id: number; title: string; body?: string; tone: 'ok' | 'warn' | 'danger' };

type Store = {
  ready: boolean;
  backend: Backend;
  role: Role;
  setRole: (r: Role) => void;
  studentTab: StudentTab;
  setStudentTab: (t: StudentTab) => void;
  sponsorTab: SponsorTab;
  setSponsorTab: (t: SponsorTab) => void;

  overview: Overview | null;
  forecast: ForecastCard | null;
  refresh: () => Promise<void>;
  sponsor: SponsorOverview | null;
  queue: Action[];
  refreshSponsor: () => Promise<void>;

  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
  newChat: () => void;
  ask: (prompt: string) => void;
  updateAction: (a: Action) => void;

  currency: 'CAD' | 'MYR';
  setCurrency: (c: 'CAD' | 'MYR') => void;

  toasts: Toast[];
  toast: (title: string, body?: string, tone?: Toast['tone']) => void;
  resetDemo: () => Promise<void>;

  frame: HTMLElement | null;
  setFrame: (el: HTMLElement | null) => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

let mid = 0;
const id = () => `m${++mid}`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend>(liveBackend);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('student');
  const [studentTab, setStudentTab] = useState<StudentTab>('home');
  const [sponsorTab, setSponsorTab] = useState<SponsorTab>('approvals');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [forecast, setForecast] = useState<ForecastCard | null>(null);
  const [sponsor, setSponsor] = useState<SponsorOverview | null>(null);
  const [queue, setQueue] = useState<Action[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currency, setCurrency] = useState<'CAD' | 'MYR'>('CAD');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const session = useRef(newSessionId());
  const sending = useRef(false);

  const toast = useCallback((title: string, body?: string, tone: Toast['tone'] = 'ok') => {
    const t = { id: Date.now() + Math.random(), title, body, tone };
    setToasts((xs) => [...xs.slice(-2), t]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== t.id)), 3600);
  }, []);

  // Live API first; if it doesn't answer, replay captured fixtures and say so in the header.
  useEffect(() => {
    let alive = true;
    probeLive().then((ok) => {
      if (!alive) return;
      setBackend(ok ? liveBackend : createDemoBackend());
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([backend.overview(), backend.forecast().catch(() => null)]);
      setOverview(o);
      setForecast(f);
    } catch (e) {
      toast('Couldn’t load your accounts', (e as Error).message, 'danger');
    }
  }, [backend, toast]);

  const refreshSponsor = useCallback(async () => {
    try {
      const [o, q] = await Promise.all([backend.sponsorOverview(), backend.sponsorQueue()]);
      setSponsor(o);
      setQueue(q.actions);
    } catch (e) {
      toast('Couldn’t load sponsor view', (e as Error).message, 'danger');
    }
  }, [backend, toast]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    void refreshSponsor();
  }, [ready, refresh, refreshSponsor]);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || sending.current) return;
      sending.current = true;
      const pendingId = id();
      setMessages((m) => [...m, { id: id(), from: 'user', text: msg }, { id: pendingId, from: 'agent', pending: true }]);
      try {
        const res = await backend.chat(msg, session.current);
        setMessages((m) => m.map((x) => (x.id === pendingId ? { id: pendingId, from: 'agent', res } : x)));
        if (res.actions.length) void refresh();
      } catch (e) {
        setMessages((m) => m.map((x) => (x.id === pendingId ? { id: pendingId, from: 'agent', error: (e as Error).message } : x)));
      } finally {
        sending.current = false;
      }
    },
    [backend, refresh],
  );

  const ask = useCallback(
    (prompt: string) => {
      setRole('student');
      setStudentTab('assistant');
      // Let the tab transition start before the message appears.
      setTimeout(() => void send(prompt), 260);
    },
    [send],
  );

  const newChat = useCallback(() => {
    session.current = newSessionId();
    setMessages([]);
  }, []);

  const updateAction = useCallback((a: Action) => {
    setMessages((m) =>
      m.map((x) =>
        'res' in x && x.res.actions.some((y) => y.action_id === a.action_id)
          ? { ...x, res: { ...x.res, actions: x.res.actions.map((y) => (y.action_id === a.action_id ? { ...y, ...a } : y)) } }
          : x,
      ),
    );
  }, []);

  const resetDemo = useCallback(async () => {
    if (backend.mode === 'live') {
      try {
        await backend.reset();
        await Promise.all([refresh(), refreshSponsor()]);
      } catch (e) {
        toast('Reset failed', (e as Error).message, 'danger');
        return;
      }
    } else {
      setBackend(createDemoBackend());
    }
    newChat();
    toast('Demo reset', 'Balances, drafts and locks are back to the start.');
  }, [backend, newChat, toast, refresh, refreshSponsor]);

  const value = useMemo<Store>(
    () => ({
      ready,
      backend,
      role,
      setRole,
      studentTab,
      setStudentTab,
      sponsorTab,
      setSponsorTab,
      overview,
      forecast,
      refresh,
      sponsor,
      queue,
      refreshSponsor,
      messages,
      send,
      newChat,
      ask,
      updateAction,
      currency,
      setCurrency,
      toasts,
      toast,
      resetDemo,
      frame,
      setFrame,
    }),
    [ready, backend, role, studentTab, sponsorTab, overview, forecast, refresh, sponsor, queue, refreshSponsor, messages, send, newChat, ask, updateAction, currency, toasts, toast, resetDemo, frame],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
