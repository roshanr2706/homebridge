import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { RightOutline } from 'antd-mobile-icons';
import { MASK, amount } from '../format';

/** Hide/show balances (the eye on the balance strip). */
export const HideCtx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: false, toggle: () => {} });

export function Amt({ n, d = 2, cur, className }: { n: number; d?: number; cur?: string; className?: string }) {
  const { hidden } = useContext(HideCtx);
  return (
    <span className={`num ${className ?? ''}`}>
      {cur ? <span className="cur">{cur} </span> : null}
      {hidden ? MASK : amount(n, d)}
    </span>
  );
}

/** Chinese label with a small English line under or beside it. */
export function Bi({ zh, en, inline, className }: { zh: ReactNode; en: ReactNode; inline?: boolean; className?: string }) {
  return (
    <span className={`bi ${inline ? 'bi-inline' : ''} ${className ?? ''}`}>
      <span className="zh">{zh}</span>
      <span className="en">{en}</span>
    </span>
  );
}

export function Section({
  zh,
  en,
  extra,
  onExtra,
  children,
  className,
  flush,
}: {
  zh: string;
  en: string;
  extra?: string;
  onExtra?: () => void;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`sec ${flush ? 'sec-flush' : ''} ${className ?? ''}`}>
      <header className="sec-h">
        <span className="sec-t">
          {zh}
          <small>{en}</small>
        </span>
        {extra ? (
          <button className="sec-x" onClick={onExtra}>
            {extra}
            <RightOutline fontSize={10} />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function Pill({ tone = 'default', children }: { tone?: 'blue' | 'red' | 'orange' | 'green' | 'gold' | 'default' | 'purple'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** A thin horizontal meter. */
export function Meter({ value, max, tone = 'blue', marker }: { value: number; max: number; tone?: string; marker?: number }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="meter">
      <div className={`meter-fill t-${tone}`} style={{ width: `${pct}%` }} />
      {marker !== undefined ? <div className="meter-mark" style={{ left: `${Math.min(100, (marker / (max || 1)) * 100)}%` }} /> : null}
    </div>
  );
}

/** Ledger provenance line under server-built cards. */
export function Provenance() {
  return (
    <div className="prov">
      <span className="prov-dot" />
      数据来自 HomeBridge 账本，非 AI 生成 · From your ledger, not written by the AI
    </div>
  );
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    return fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
