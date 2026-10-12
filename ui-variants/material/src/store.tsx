// App-wide state: role, data source (live / demo data), student + sponsor data, snackbar, and the
// overlays (assistant, review sheet) so any screen can open them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, detectSource, getSource, onSource, type Source } from './api';
import type { Action, ForecastCard, Overview, Role, SponsorOverview } from './types';

type Store = {
  role: Role;
  setRole: (r: Role) => void;
  source: Source;
  frame: HTMLElement | null;
  setFrame: (el: HTMLElement | null) => void;
  overview: Overview | null;
  forecast: ForecastCard | null;
  actions: Action[];
  sponsor: SponsorOverview | null;
  queue: Action[];
  error: string;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
  snack: { msg: string; key: number } | null;
  closeSnack: () => void;
  assistant: { open: boolean; prefill?: string; key: number };
  openAssistant: (prefill?: string) => void;
  closeAssistant: () => void;
  review: Action | null;
  openReview: (a: Action | null) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('student');
  const [source, setSource] = useState<Source>(getSource());
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [forecast, setForecast] = useState<ForecastCard | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [sponsor, setSponsor] = useState<SponsorOverview | null>(null);
  const [queue, setQueue] = useState<Action[]>([]);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState<{ msg: string; key: number } | null>(null);
  const [assistant, setAssistant] = useState<{ open: boolean; prefill?: string; key: number }>({ open: false, key: 0 });
  const [review, setReview] = useState<Action | null>(null);
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => onSource(setSource), []);

  const refresh = useCallback(async () => {
    try {
      if (getSource() === 'checking') await detectSource();
      if (roleRef.current === 'student') {
        const [o, f, a] = await Promise.all([api.overview(), api.forecast(), api.actions()]);
        setOverview(o);
        setForecast(f);
        setActions(a.actions);
      } else {
        const [s, q] = await Promise.all([api.sponsorOverview(), api.sponsorQueue()]);
        setSponsor(s);
        setQueue(q.actions);
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [role, refresh]);

  // Poll only against the live backend; the offline sandbox changes only when the user acts.
  useEffect(() => {
    if (source !== 'live') return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [source, refresh]);

  const toast = useCallback((msg: string) => setSnack({ msg, key: Date.now() }), []);

  const value = useMemo<Store>(
    () => ({
      role,
      setRole: (r) => {
        setAssistant((s) => ({ ...s, open: false }));
        setReview(null);
        setRoleState(r);
      },
      source,
      frame,
      setFrame,
      overview,
      forecast,
      actions,
      sponsor,
      queue,
      error,
      refresh,
      toast,
      snack,
      closeSnack: () => setSnack(null),
      assistant,
      openAssistant: (prefill) => setAssistant((s) => ({ open: true, prefill, key: s.key + 1 })),
      closeAssistant: () => setAssistant((s) => ({ ...s, open: false, prefill: undefined })),
      review,
      openReview: setReview,
    }),
    [role, source, frame, overview, forecast, actions, sponsor, queue, error, refresh, toast, snack, assistant, review],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
