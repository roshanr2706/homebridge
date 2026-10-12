import { motion } from 'motion/react';
import { useId, useMemo, type ReactNode } from 'react';

import { shortDate, sym } from '../lib/format';
import type { ForecastCard } from '../lib/types';
import { cn, easeOut } from './primitives';

const ACCENT = 'var(--color-accent)';
const DANGER = 'var(--color-danger)';
const svgId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Runway: projected balance per day until the next tuition date. Above zero is lime, below zero is red
 * (two clip regions split at the zero line), the area wipes in left to right while the line draws.
 */
export function RunwayChart({ f, compact = false }: { f: ForecastCard; compact?: boolean }) {
  const uid = svgId(useId());
  const W = 340;
  const H = compact ? 92 : 188;
  const padT = compact ? 8 : 26;
  const padB = compact ? 4 : 26;

  const g = useMemo(() => {
    const s = f.series;
    const n = s.length;
    const lo = Math.min(0, ...s);
    const hi = Math.max(...s);
    const span = hi - lo || 1;
    const top = hi + span * 0.06;
    const bot = lo - span * (lo < 0 ? 0.08 : 0.02);
    const x = (i: number) => (i / Math.max(1, n - 1)) * W;
    const y = (v: number) => padT + ((top - v) / (top - bot)) * (H - padT - padB);
    const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const base = H - padB;
    const area = `${line}L${W},${base}L0,${base}Z`;
    let shortEnd = f.shortfall_index ?? -1;
    if (f.shortfall_index != null) while (shortEnd + 1 < n && s[shortEnd + 1] < 0) shortEnd++;
    return { x, y, line, area, zeroY: y(0), base, n, shortEnd };
  }, [f, H, padT, padB]);

  const low = f.lowest;
  const lowNeg = low.balance < 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Projected balance from ${shortDate(f.start_date)} to ${shortDate(f.end_date)}. Lowest ${sym(low.balance)} on ${shortDate(low.date)}.`}>
      <defs>
        <linearGradient id={`${uid}-up`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${uid}-dn`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={DANGER} stopOpacity={0} />
          <stop offset="100%" stopColor={DANGER} stopOpacity={0.45} />
        </linearGradient>
        <clipPath id={`${uid}-above`}>
          <rect x={-4} y={-40} width={W + 8} height={g.zeroY + 40} />
        </clipPath>
        <clipPath id={`${uid}-below`}>
          <rect x={-4} y={g.zeroY} width={W + 8} height={H} />
        </clipPath>
        <clipPath id={`${uid}-reveal`}>
          <motion.rect x={-4} y={-40} height={H + 80} initial={{ width: 0 }} animate={{ width: W + 8 }} transition={{ duration: 1.5, ease: easeOut, delay: 0.1 }} />
        </clipPath>
      </defs>

      {/* shortfall band */}
      {f.shortfall_index != null && (
        <motion.rect
          x={g.x(f.shortfall_index)}
          y={padT - (compact ? 8 : 18)}
          width={Math.max(2, g.x(g.shortEnd) - g.x(f.shortfall_index))}
          height={H - padT - padB + (compact ? 8 : 18)}
          fill={DANGER}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.07 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          rx={4}
        />
      )}

      {/* zero line */}
      <line x1={0} x2={W} y1={g.zeroY} y2={g.zeroY} stroke="rgb(255 255 255 / 0.16)" strokeDasharray="2 4" />

      <g clipPath={`url(#${uid}-reveal)`}>
        <path d={g.area} fill={`url(#${uid}-up)`} clipPath={`url(#${uid}-above)`} />
        <path d={g.area} fill={`url(#${uid}-dn)`} clipPath={`url(#${uid}-below)`} />
      </g>
      {(['above', 'below'] as const).map((k) => (
        <motion.path
          key={k}
          d={g.line}
          fill="none"
          stroke={k === 'above' ? ACCENT : DANGER}
          strokeWidth={compact ? 1.75 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath={`url(#${uid}-${k})`}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, ease: easeOut, delay: 0.1 }}
        />
      ))}

      {/* tuition due markers */}
      {f.tuition.map((t) => (
        <g key={t.due}>
          <line x1={g.x(t.index)} x2={g.x(t.index)} y1={padT - (compact ? 6 : 14)} y2={H - padB} stroke="rgb(255 255 255 / 0.22)" strokeWidth={1} />
          {!compact && (
            <text x={g.x(t.index) - 4} y={padT - 16} textAnchor="end" className="fill-fg-2 text-[10px] font-medium">
              Tuition {shortDate(t.due)}
            </text>
          )}
        </g>
      ))}

      {/* lowest point */}
      <motion.g initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.3, type: 'spring', stiffness: 400, damping: 20 }} style={{ originX: `${g.x(low.index)}px`, originY: `${g.y(low.balance)}px` }}>
        <circle cx={g.x(low.index)} cy={g.y(low.balance)} r={compact ? 6 : 8} fill={lowNeg ? DANGER : ACCENT} opacity={0.18} />
        <circle cx={g.x(low.index)} cy={g.y(low.balance)} r={compact ? 2.75 : 3.5} fill={lowNeg ? DANGER : ACCENT} stroke="var(--color-ink-2)" strokeWidth={1.5} />
        {!compact && (
          <text x={g.x(low.index)} y={g.y(low.balance) + 18} textAnchor="middle" className={cn('num text-[10.5px] font-semibold', lowNeg ? 'fill-danger' : 'fill-accent')}>
            {sym(low.balance, 'CAD', 0)}
          </text>
        )}
      </motion.g>

      {!compact && (
        <>
          <text x={0} y={H - 6} className="fill-fg-3 text-[10px]">
            {shortDate(f.start_date)}
          </text>
          {f.first_shortfall_date && f.shortfall_index != null && (
            <text x={g.x(f.shortfall_index)} y={H - 6} textAnchor="middle" className="fill-danger text-[10px] font-medium">
              {shortDate(f.first_shortfall_date)}
            </text>
          )}
          <text x={W} y={H - 6} textAnchor="end" className="fill-fg-3 text-[10px]">
            {shortDate(f.end_date)}
          </text>
          <text x={W} y={g.zeroY - 5} textAnchor="end" className="fill-fg-3 text-[9.5px]">
            $0
          </text>
        </>
      )}
    </svg>
  );
}

/** Utilization ring with a tick at the target (30%). */
export function RingGauge({ pct, target, size = 132, stroke = 10, children }: { pct: number; target: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const color = pct <= target ? ACCENT : pct <= 50 ? 'var(--color-warn)' : DANGER;
  const a = (target / 100) * Math.PI * 2 - Math.PI / 2;
  const tick = (d: number) => [c + Math.cos(a) * (r + d), c + Math.sin(a) * (r + d)];
  const [x1, y1] = tick(-stroke / 2 - 3);
  const [x2, y2] = tick(stroke / 2 + 3);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.min(1, pct / 100) }}
          transition={{ duration: 1.3, ease: easeOut, delay: 0.15 }}
        />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-fg)" strokeWidth={2} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const W = 300;
  const H = 56;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * W;
  const y = (v: number) => 4 + ((hi - v) / (hi - lo || 1)) * (H - 8);
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = series[series.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('block h-auto w-full overflow-visible', className)} aria-hidden>
      <motion.path d={d} fill="none" stroke={ACCENT} strokeWidth={1.75} strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: easeOut }} />
      <circle cx={W} cy={y(last)} r={3} fill={ACCENT} />
    </svg>
  );
}

/** Thin progress meter; `marker` draws a hairline at a budget or target. */
export function Meter({ value, max, tone = 'accent', delay = 0, className }: { value: number; max: number; tone?: 'accent' | 'warn' | 'danger' | 'neutral'; delay?: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const bg = { accent: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-fg-2' }[tone];
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <motion.div className={cn('h-full rounded-full', bg)} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.9, ease: easeOut, delay }} />
    </div>
  );
}
