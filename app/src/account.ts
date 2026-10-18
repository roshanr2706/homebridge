// One person's app state on a phone: who they are (/me), their saved look and language, and whether they still
// need onboarding. Each demo phone has its own, so the student and the sponsor onboard and choose separately.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, type Me, type OnboardingIn, type PrefsIn, type Role } from './api';
import { setLang as setSharedLang, useLang, type Lang } from './i18n';
import type { Skin } from './theme';

const DEFAULT_SKIN: Record<Role, Skin> = { student: 'neo', sponsor: 'superapp' };

export type Person = {
  role: Role;
  me: Me | null;
  status: 'loading' | 'ready' | 'offline';
  /** The look and language in effect, including an unsaved choice made during onboarding. */
  skin: Skin;
  lang: Lang;
  name: string;
  /** Show onboarding now (first run, or "Replay onboarding" from Settings). */
  onboarding: boolean;
  replaying: boolean;
  /** Try a look or language during onboarding without saving it. */
  preview: (p: { skin?: Skin; language?: Lang }) => void;
  setSkin: (s: Skin) => void;
  setLanguage: (l: Lang) => void;
  save: (body: PrefsIn) => Promise<void>;
  finish: (body: OnboardingIn) => Promise<void>;
  replay: () => void;
  cancelReplay: () => void;
};

export function usePerson(role: Role, epoch: number): Person {
  const shared = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Person['status']>('loading');
  const [draft, setDraft] = useState<{ skin?: Skin; language?: Lang }>({});
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .me(role)
      .then((m) => {
        if (!live) return;
        setMe(m);
        setStatus('ready');
        setDraft({});
        setReplaying(false);
      })
      .catch(() => live && setStatus('offline'));
    return () => {
      live = false;
    };
  }, [role, epoch]);

  const onboarding = status === 'ready' && !!me && (!me.prefs.onboarded_at || replaying);

  const save = useCallback(
    async (body: PrefsIn) => {
      // Optimistic: the phone switches at once; the server's answer then replaces it.
      setMe((m) => (m ? { ...m, prefs: { ...m.prefs, ...body } } : m));
      try {
        setMe(await api.savePrefs(role, body));
      } catch {
        /* offline: the choice lasts for this session */
      }
    },
    [role],
  );

  const preview = useCallback((p: { skin?: Skin; language?: Lang }) => setDraft((d) => ({ ...d, ...p })), []);

  const setSkin = useCallback(
    (s: Skin) => {
      if (onboarding) preview({ skin: s });
      else if (me) save({ skin: s });
      else setDraft((d) => ({ ...d, skin: s }));
    },
    [onboarding, me, preview, save],
  );

  const setLanguage = useCallback(
    (l: Lang) => {
      if (onboarding) preview({ language: l });
      else if (me) save({ language: l });
      else setSharedLang(l);
    },
    [onboarding, me, preview, save],
  );

  const finish = useCallback(
    async (body: OnboardingIn) => {
      const m = await api.onboard(role, body);
      setMe(m);
      setDraft({});
      setReplaying(false);
    },
    [role],
  );

  const replay = useCallback(() => setReplaying(true), []);
  const cancelReplay = useCallback(() => {
    setReplaying(false);
    setDraft({});
  }, []);

  return useMemo(
    () => ({
      role,
      me,
      status,
      skin: draft.skin ?? me?.prefs.skin ?? DEFAULT_SKIN[role],
      // Before onboarding, start from the language this browser last used.
      lang: draft.language ?? (me?.prefs.onboarded_at ? me.prefs.language : shared),
      name: me?.prefs.display_name ?? me?.name ?? '',
      onboarding,
      replaying,
      preview,
      setSkin,
      setLanguage,
      save,
      finish,
      replay,
      cancelReplay,
    }),
    [role, me, status, draft, shared, onboarding, replaying, preview, setSkin, setLanguage, save, finish, replay, cancelReplay],
  );
}

// The person whose phone this is, for screens that greet them by name.
const PersonCtx = createContext<Person | null>(null);
export const PersonScope = PersonCtx.Provider;
export function usePersonName(fallback: string): string {
  const p = useContext(PersonCtx);
  return p?.name || fallback;
}
