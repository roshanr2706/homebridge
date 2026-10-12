// Hand-rolled SVG charts (no chart library): the runway forecast line and the credit utilisation gauge.
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { money, shortDate } from '../format';
import type { ForecastCard } from '../types';

const W = 340;

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}

/** Cash runway: projected Everyday balance per day, with the below-zero stretch and tuition due date marked. */
export function RunwayChart({ f, compact = false, height }: { f: ForecastCard; compact?: boolean; height?: number }) {
  const t = useTheme();
  const m = t.m3;
  const H = height ?? (compact ? 64 : 190);
  const pad = compact ? { l: 2, r: 2, t: 6, b: 6 } : { l: 40, r: 10, t: 14, b: 26 };
  const n = f.series.length;
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  const { min, max } = useMemo(() => {
    const lo = Math.min(0, ...f.series);
    const hi = Math.max(...f.series);
    const span = hi - lo || 1;
    return { min: lo - span * 0.08, max: hi + span * 0.1 };
  }, [f.series]);

  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const zeroY = y(0);
  const line = f.series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)}L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`;
  const months = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    for (let i = 1; i < n; i++) {
      const d = addDays(f.start_date, i * f.step_days);
      if (d.getDate() <= f.step_days) out.push({ i, label: d.toLocaleDateString('en-CA', { month: 'short' }) });
    }
    return out;
  }, [f.start_date, f.step_days, n]);
  const top = Math.max(...f.series);
  const yTicks = compact ? [] : [0, Math.round(top / 1000) * 1000 || Math.round(top)].filter((v, i, a) => a.indexOf(v) === i);
  const low = f.lowest;
  const negative = low.balance < 0;

  const onMove = (e: PointerEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hv = hover !== null ? f.series[hover] : null;
  const hDate = hover !== null ? addDays(f.start_date, hover * f.step_days) : null;

  return (
    <Box ref={wrap} sx={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Projected ${f.account} balance from ${shortDate(f.start_date)} to ${shortDate(f.end_date)}; lowest ${money(low.balance)} on ${shortDate(low.date)}`}
        style={{ display: 'block', overflow: 'visible', touchAction: 'pan-y' }}
        onPointerMove={compact ? undefined : onMove}
        onPointerLeave={compact ? undefined : () => setHover(null)}
      >
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={m.primary} stopOpacity={0.22} />
            <stop offset="1" stopColor={m.primary} stopOpacity={0.02} />
          </linearGradient>
          <clipPath id={`above-${uid}`}>
            <rect x="0" y="0" width={W} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`below-${uid}`}>
            <rect x="0" y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
          </clipPath>
        </defs>

        {!compact &&
          yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={m.outlineVariant} strokeWidth={1} strokeDasharray={v === 0 ? '0' : '2 4'} />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill={m.onSurfaceVariant} fontWeight={600}>
                {v === 0 ? '0' : `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`}
              </text>
            </g>
          ))}
        {compact && <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke={m.outlineVariant} strokeWidth={1} strokeDasharray="3 3" />}

        <path d={area} fill={`url(#g-${uid})`} clipPath={`url(#above-${uid})`} />
        <path d={area} fill={m.error} fillOpacity={0.14} clipPath={`url(#below-${uid})`} />
        <path d={line} fill="none" stroke={m.primary} strokeWidth={2} strokeLinejoin="round" clipPath={`url(#above-${uid})`} />
        <path d={line} fill="none" stroke={m.error} strokeWidth={2} strokeLinejoin="round" clipPath={`url(#below-${uid})`} />

        {f.tuition
          .filter((tu) => tu.index < n)
          .map((tu) => (
            <g key={tu.term}>
              <line x1={x(tu.index)} x2={x(tu.index)} y1={pad.t - 4} y2={H - pad.b} stroke={m.tertiary} strokeWidth={1.5} strokeDasharray="3 3" />
              {!compact && (
                <text x={x(tu.index) - 4} y={pad.t + 6} textAnchor="end" fontSize="10.5" fontWeight={700} fill={m.tertiary}>
                  Tuition due
                </text>
              )}
            </g>
          ))}

        {negative && (
          <circle cx={x(low.index)} cy={y(low.balance)} r={compact ? 3.5 : 4.5} fill={m.error} stroke={m.surfaceContainerLowest} strokeWidth={2} />
        )}
        {!compact && negative && (
          <text x={x(low.index)} y={y(low.balance) + 17} textAnchor="middle" fontSize="10.5" fontWeight={700} fill={m.onErrorContainer}>
            {money(low.balance, 'CAD', { decimals: 0 })}
          </text>
        )}

        {!compact &&
          months.map((mo) => (
            <text key={mo.i} x={x(mo.i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill={m.onSurfaceVariant} fontWeight={600}>
              {mo.label}
            </text>
          ))}

        {hover !== null && hv !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={m.onSurfaceVariant} strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hv)} r={4.5} fill={hv < 0 ? m.error : m.primary} stroke={m.surfaceContainerLowest} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && hv !== null && hDate && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: `${Math.min(78, Math.max(4, (x(hover) / W) * 100 - 11))}%`,
            bgcolor: m.inverseSurface,
            color: m.inverseOnSurface,
            px: 1.25,
            py: 0.5,
            borderRadius: '8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <Typography sx={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>
            {hDate.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{money(hv)}</Typography>
        </Box>
      )}
    </Box>
  );
}

/** Semicircle utilisation gauge with the 30% target marked. */
export function UtilizationGauge({ pct, target, reported }: { pct: number; target: number; reported?: number }) {
  const t = useTheme();
  const m = t.m3;
  const size = 200;
  const r = 80;
  const cx = size / 2;
  const cy = 96;
  const stroke = 14;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const pt = (v: number, rr = r) => {
    const a = Math.PI * (1 - clamp(v) / 100);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };
  const tone = pct <= target ? m.success : pct <= 50 ? m.warning : m.error;
  const [tx1, ty1] = pt(target, r - stroke / 2 - 4);
  const [tx2, ty2] = pt(target, r + stroke / 2 + 4);
  return (
    <Box sx={{ position: 'relative', width: size, mx: 'auto' }}>
      <svg viewBox={`0 0 ${size} 112`} width={size} role="img" aria-label={`Utilization ${pct}%, target under ${target}%`}>
        <path d={arc(0, 100)} fill="none" stroke={m.surfaceContainerHighest} strokeWidth={stroke} strokeLinecap="round" />
        <path d={arc(0, pct)} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" />
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={m.onSurface} strokeWidth={2.5} strokeLinecap="round" />
        {reported !== undefined && <circle cx={pt(reported)[0]} cy={pt(reported)[1]} r={4} fill={m.surfaceContainerLowest} stroke={m.onSurfaceVariant} strokeWidth={2} />}
      </svg>
      <Box sx={{ position: 'absolute', left: 0, right: 0, top: 46, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 34, fontWeight: 750, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(pct)}%
        </Typography>
        <Typography variant="caption" color="text.secondary">
          used · aim under {target}%
        </Typography>
      </Box>
    </Box>
  );
}
