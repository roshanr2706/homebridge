import { useEffect } from 'react';

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
