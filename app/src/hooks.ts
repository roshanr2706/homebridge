import { useEffect, useState } from 'react';

import { api } from './api';

// Runs `fn` now (on the next tick, outside the effect body) and then every `ms` while enabled.
export function usePoll(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(fn, 0);
    const id = setInterval(fn, ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [fn, ms, enabled]);
}

// Whether the server runs in demo mode (asked once per app load). Demo-only hints, such as the demo PIN,
// show only when this is true.
let demoModePromise: Promise<boolean> | null = null;
export function useDemoMode() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let live = true;
    demoModePromise ??= api
      .health()
      .then((h) => h.demo_mode)
      .catch(() => {
        demoModePromise = null;
        return false;
      });
    demoModePromise.then((d) => live && setDemo(d));
    return () => {
      live = false;
    };
  }, []);
  return demo;
}
