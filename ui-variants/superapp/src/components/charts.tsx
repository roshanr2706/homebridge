// Small hand-drawn SVG charts (no chart library: keeps the bundle small and works offline in China).
import type { ForecastCard } from '../types';
import { amount, enDate, zhDate } from '../format';

/** Runway: the spending balance per day around a zero line, red below zero, tuition due dates marked. */
export function RunwayChart({ c, height = 112 }: { c: ForecastCard; height?: number }) {
  const W = 320;
  const H = height;
  const top = 14;
  const bottom = 16;
  const n = c.series.length;
  const hi = Math.max(0, ...c.series);
  const lo = Math.min(0, ...c.series);
  const range = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / range) * (H - top - bottom);
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const zero = y(0);
  const line = c.series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${zero} L0,${zero} Z`;
  const low = c.lowest;
  const id = `rw-${c.start_date}-${n}`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Runway forecast">
      <defs>
        <linearGradient id={`${id}-up`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1677ff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#1677ff" stopOpacity="0.02" />
        </linearGradient>
        <clipPath id={`${id}-above`}>
          <rect x="0" y="0" width={W} height={zero} />
        </clipPath>
        <clipPath id={`${id}-below`}>
          <rect x="0" y={zero} width={W} height={H - zero} />
        </clipPath>
      </defs>
      {lo < 0 && <rect x="0" y={zero} width={W} height={H - bottom - zero} fill="#fff1f0" />}
      <path d={area} fill={`url(#${id}-up)`} clipPath={`url(#${id}-above)`} />
      <path d={area} fill="#ff3141" fillOpacity="0.18" clipPath={`url(#${id}-below)`} />
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="#c8c9cc" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke="#1677ff" strokeWidth="1.6" clipPath={`url(#${id}-above)`} vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke="#ff3141" strokeWidth="1.6" clipPath={`url(#${id}-below)`} vectorEffect="non-scaling-stroke" />
      {c.tuition.map((t) => {
        const tx = Math.min(W - 1, x(t.index));
        return (
          <g key={t.due}>
            <line x1={tx} x2={tx} y1={top - 4} y2={H - bottom} stroke={t.gap > 0 ? '#ff8f1f' : '#00b578'} strokeWidth="1.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      <circle cx={x(low.index)} cy={y(low.balance)} r="3" fill={low.balance < 0 ? '#ff3141' : '#1677ff'} stroke="#fff" strokeWidth="1.5" />
      <text x="0" y={H - 3} className="chart-ax">
        {zhDate(c.start_date)}
      </text>
      <text x={W} y={H - 3} textAnchor="end" className="chart-ax">
        {zhDate(c.end_date)}
      </text>
      <text
        x={Math.min(W - 60, Math.max(4, x(low.index) - 30))}
        y={Math.min(H - bottom - 2, y(low.balance) + 13)}
        className="chart-lbl"
        fill={low.balance < 0 ? '#ff3141' : '#666'}
      >
        最低 {amount(low.balance, 0)} · {enDate(low.date)}
      </text>
    </svg>
  );
}

/** Half-ring gauge for credit utilization, with a tick at the target (30%). */
export function UtilGauge({ pct, target, size = 132 }: { pct: number; target: number; size?: number }) {
  const r = 52;
  const cx = 64;
  const cy = 62;
  const arc = (p: number) => {
    const a = Math.PI * (1 - Math.min(100, Math.max(0, p)) / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [ex, ey] = arc(pct);
  const [tx, ty] = arc(target);
  const [tx2, ty2] = [cx + (r + 9) * Math.cos(Math.PI * (1 - target / 100)), cy - (r + 9) * Math.sin(Math.PI * (1 - target / 100))];
  const color = pct <= target ? '#00b578' : pct <= 50 ? '#ff8f1f' : '#ff3141';
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 128 76" role="img" aria-label={`Utilization ${pct}%`}>
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="#eef0f3" strokeWidth="10" strokeLinecap="round" />
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      <line x1={tx} y1={ty} x2={tx2} y2={ty2} stroke="#1a1a1a" strokeWidth="1.5" />
      <text x={tx2 - 2} y={ty2 - 2} textAnchor="end" className="chart-ax">
        {target}%
      </text>
      <text x={cx} y={cy - 8} textAnchor="middle" className="gauge-v" fill={color}>
        {Math.round(pct)}%
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" className="chart-ax">
        利用率 Utilization
      </text>
    </svg>
  );
}

export function Sparkline({ series, height = 44, color = '#1677ff' }: { series: number[]; height?: number; color?: string }) {
  const W = 300;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const r = hi - lo || 1;
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * W).toFixed(1)},${(4 + ((hi - v) / r) * (height - 8)).toFixed(1)}`);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trend">
      <polyline points={`0,${height} ${pts.join(' ')} ${W},${height}`} fill={color} fillOpacity="0.08" stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
