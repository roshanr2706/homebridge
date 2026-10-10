// Hand-rolled SVG charts. No chart library: keeps the bundle small and the look on-brand.
import { Box, Group, Stack, Text } from '@mantine/core';
import { IconCheck, IconClock, IconTrophy, IconX } from '@tabler/icons-react';
import { useId } from 'react';

import type { CreditStatus, ForecastCard, Quote } from '../api/types';
import { addDays, C, money, shortDate, shortMoney } from '../theme';

/** Cash runway: daily balance of the Everyday account, red below zero, tuition due dates marked. */
export function RunwayChart({ f, height = 150, compact = false }: { f: ForecastCard; height?: number; compact?: boolean }) {
  const id = useId().replace(/:/g, '');
  const W = 320;
  const H = height;
  const padT = compact ? 6 : 22;
  const padB = compact ? 6 : 22;
  const s = f.series;
  const max = Math.max(...s, 0);
  const min = Math.min(...s, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, s.length - 1)) * W;
  const y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const zero = y(0);
  const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${zero} L0,${zero} Z`;
  const short = f.shortfall_index;
  const low = f.lowest;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Balance forecast for ${f.account} from ${shortDate(f.start_date)} to ${shortDate(f.end_date)}`}>
      <defs>
        <clipPath id={`above-${id}`}>
          <rect x="0" y="0" width={W} height={zero} />
        </clipPath>
        <clipPath id={`below-${id}`}>
          <rect x="0" y={zero} width={W} height={H - zero} />
        </clipPath>
      </defs>
      <path d={area} fill={C.mint} opacity={0.35} clipPath={`url(#above-${id})`} />
      <path d={area} fill={C.tomato} opacity={0.4} clipPath={`url(#below-${id})`} />
      <line x1="0" x2={W} y1={zero} y2={zero} stroke={C.ink} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.6} />
      <path d={line} fill="none" stroke={C.ink} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {!compact &&
        f.tuition.map((t) => (
          <g key={t.term}>
            <line x1={x(Math.min(t.index, s.length - 1))} x2={x(Math.min(t.index, s.length - 1))} y1={padT - 6} y2={H - padB} stroke={C.grape} strokeWidth={2.4} strokeDasharray="2 5" strokeLinecap="round" />
            <rect x={x(Math.min(t.index, s.length - 1)) - 66} y={2} width={64} height={16} rx={8} fill={C.grape} stroke={C.ink} strokeWidth={1.6} />
            <text x={x(Math.min(t.index, s.length - 1)) - 34} y={13.5} fontSize={10} fontWeight={900} textAnchor="middle" fill="#fff">
              Tuition {shortDate(t.due)}
            </text>
          </g>
        ))}
      {short !== null && short < s.length && (
        <g>
          <circle cx={x(short)} cy={y(s[short])} r={6} fill={C.sun} stroke={C.ink} strokeWidth={2.2} />
        </g>
      )}
      {low.balance < 0 && (
        <circle cx={x(low.index)} cy={y(low.balance)} r={4.5} fill={C.tomato} stroke={C.ink} strokeWidth={2} />
      )}
      {!compact && (
        <>
          <text x={2} y={H - 5} fontSize={10.5} fontWeight={800} fill={C.inkSoft}>
            Today
          </text>
          <text x={W / 2} y={H - 5} fontSize={10.5} fontWeight={800} fill={C.inkSoft} textAnchor="middle">
            {shortDate(addDays(f.start_date, Math.round(((s.length - 1) / 2) * f.step_days)))}
          </text>
          <text x={W - 2} y={H - 5} fontSize={10.5} fontWeight={800} fill={C.inkSoft} textAnchor="end">
            {shortDate(f.end_date)}
          </text>
        </>
      )}
    </svg>
  );
}

/** FX "race": what each provider would cost you (fees + rate markup). Shortest bar wins. */
export function FxRace({ quotes, from, amount }: { quotes: Quote[]; from: string; amount: number }) {
  const worst = Math.max(...quotes.map((q) => q.true_cost));
  const best = quotes.reduce((a, b) => (b.you_receive > a.you_receive ? b : a), quotes[0]);
  const lane = [C.mint, C.sky, C.sun, C.coral, C.grape];
  return (
    <Stack gap={10}>
      <Text fz={12} fw={800} c={C.inkSoft}>
        Changing {money(amount, from)}. Bar = what you lose to fees and a worse rate. Shortest bar wins.
      </Text>
      {quotes.map((q, i) => {
        const winner = q === best;
        return (
          <Box key={q.provider_key}>
            <Group justify="space-between" gap={6} wrap="nowrap" mb={4}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                {winner && <IconTrophy size={16} stroke={2.4} color={C.ink} fill={C.sun} />}
                <Text fz={13} fw={winner ? 900 : 700} truncate>
                  {q.provider}
                </Text>
              </Group>
              <Text fz={13} fw={900} className="hb-display" style={{ whiteSpace: 'nowrap' }}>
                {money(q.you_receive, q.receive_currency)}
              </Text>
            </Group>
            <Group gap={8} wrap="nowrap">
              <Box style={{ flex: 1, height: 16, borderRadius: 999, border: `2px solid ${C.ink}`, background: '#fff', overflow: 'hidden' }}>
                <Box
                  style={{
                    width: `${Math.max(4, (q.true_cost / worst) * 100)}%`,
                    height: '100%',
                    background: winner ? C.mint : lane[i % lane.length],
                    borderRight: `2px solid ${C.ink}`,
                    transition: 'width 600ms cubic-bezier(.34,1.56,.64,1)',
                  }}
                />
              </Box>
              <Text fz={11.5} fw={800} c={C.inkSoft} w={92} ta="right" style={{ whiteSpace: 'nowrap' }}>
                −{q.true_cost.toFixed(2)} · {q.true_cost_pct}%
              </Text>
            </Group>
            <Text fz={11} fw={700} c={C.inkSoft} mt={2}>
              {q.speed}
              {q.fee ? ` · fee ${money(q.fee, q.fee_currency)}` : ' · no fee'}
            </Text>
          </Box>
        );
      })}
    </Stack>
  );
}

/** Credit utilization as a chunky speedo: green under 30%, yellow to 50%, red above. */
export function UtilGauge({ pct, target = 30, size = 200, label }: { pct: number; target?: number; size?: number; label?: string }) {
  const W = 200;
  const H = 118;
  const cx = 100;
  const cy = 104;
  const r = 80;
  const pt = (p: number, rr = r) => {
    const a = Math.PI * (1 - Math.min(100, Math.max(0, p)) / 100);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };
  const [nx, ny] = pt(pct, r - 22);
  const [tx, ty] = pt(target, r + 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} role="img" aria-label={`${label ?? 'Utilization'} ${pct}%`}>
      <path d={arc(0, 100)} fill="none" stroke={C.ink} strokeWidth={26} strokeLinecap="round" />
      <path d={arc(0, target)} fill="none" stroke={C.mint} strokeWidth={20} />
      <path d={arc(target, 50)} fill="none" stroke={C.sun} strokeWidth={20} />
      <path d={arc(50, 100)} fill="none" stroke={C.tomato} strokeWidth={20} />
      <circle cx={pt(0)[0]} cy={pt(0)[1]} r={10} fill={C.mint} />
      <circle cx={pt(100)[0]} cy={pt(100)[1]} r={10} fill={C.tomato} />
      <text x={tx} y={ty + 4} fontSize={10} fontWeight={900} textAnchor="middle" fill={C.ink}>
        {target}%
      </text>
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.ink} strokeWidth={5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={9} fill={C.sun} stroke={C.ink} strokeWidth={2.6} />
    </svg>
  );
}

export function Sparkline({ series, height = 44, color = C.sky }: { series: number[]; height?: number; color?: string }) {
  if (!series.length) return null;
  const W = 200;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => `${((i / Math.max(1, series.length - 1)) * W).toFixed(1)},${(4 + ((max - v) / span) * (height - 8)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} aria-hidden preserveAspectRatio="none">
      <polyline points={`0,${height} ${pts.join(' ')} ${W},${height}`} fill={color} opacity={0.3} stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={C.ink} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** On-time payment history as a row of stamps. */
export function StreakDots({ history, size = 26 }: { history: CreditStatus[]; size?: number }) {
  return (
    <Group gap={6} wrap="nowrap">
      {history.map((s, i) => {
        const bg = s === 'on_time' ? C.mint : s === 'late' ? C.tomato : C.sun;
        const Icon = s === 'on_time' ? IconCheck : s === 'late' ? IconX : IconClock;
        return (
          <Box
            key={i}
            title={s === 'on_time' ? 'Paid on time' : s === 'late' ? 'Paid late' : 'Due now'}
            style={{ width: size, height: size, borderRadius: '50%', background: bg, border: `2px solid ${C.ink}`, display: 'grid', placeItems: 'center' }}
          >
            <Icon size={size * 0.6} stroke={3} color={C.ink} />
          </Box>
        );
      })}
    </Group>
  );
}

export const runwayHeadline = (f: ForecastCard) => {
  const gap = f.tuition.find((t) => t.gap > 0);
  if (f.verdict === 'on_track') return { tone: 'ok' as const, title: "You're covered until tuition", body: `Lowest point is ${shortMoney(f.lowest.balance)} on ${shortDate(f.lowest.date)}.` };
  if (gap && f.first_shortfall_date)
    return {
      tone: 'bad' as const,
      title: `${shortMoney(gap.gap)} short for ${shortDate(gap.due).split(' ')[0]} tuition`,
      body: `And Everyday dips below zero on ${shortDate(f.first_shortfall_date)}. Both are fixable.`,
    };
  if (gap) return { tone: 'bad' as const, title: `${shortMoney(gap.gap)} short for ${shortDate(gap.due).split(' ')[0]} tuition`, body: 'Your spending is fine; the tuition fund needs a top-up.' };
  return { tone: 'meh' as const, title: `Everyday dips below zero on ${shortDate(f.first_shortfall_date ?? f.lowest.date)}`, body: `Lowest ${shortMoney(f.lowest.balance)} on ${shortDate(f.lowest.date)}.` };
};
