// Renders the structured cards the assistant returns with each reply (POST /chat → cards[]).
import { useState, type ReactNode } from 'react';
import { Box, Button, Chip, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import CurrencyExchangeRoundedIcon from '@mui/icons-material/CurrencyExchangeRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import PieChartRoundedIcon from '@mui/icons-material/PieChartRounded';
import GppBadRoundedIcon from '@mui/icons-material/GppBadRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import LightbulbRoundedIcon from '@mui/icons-material/LightbulbRounded';

import { CATEGORY_LABEL, longDate, money, shortDate } from '../format';
import type { BudgetCard, Card, CreditCardData, ForecastCard, Quote, TuitionCard } from '../types';
import { RunwayChart, UtilizationGauge } from './charts';
import { Amount, IconBadge, KeyValue, ToneChip, type Tone } from './ui';

function Shell({ icon, tone = 'primary', title, subtitle, children, right }: {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Box sx={{ bgcolor: t.m3.surfaceContainerLowest, borderRadius: '20px', border: `1px solid ${t.m3.outlineVariant}`, p: 2, overflow: 'hidden' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
        <IconBadge tone={tone} size={36}>
          {icon}
        </IconBadge>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.25 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" component="div">
              {subtitle}
            </Typography>
          )}
        </Box>
        {right}
      </Stack>
      {children}
    </Box>
  );
}

const ACCOUNT_TONE: Record<string, Tone> = { CAD: 'primary', MYR: 'tertiary' };

export function AccountGlyph({ currency, size = 40 }: { currency: string; size?: number }) {
  return (
    <IconBadge tone={ACCOUNT_TONE[currency] ?? 'secondary'} size={size}>
      <Typography component="span" sx={{ fontSize: size * 0.3, fontWeight: 800, letterSpacing: '0.02em' }}>
        {currency}
      </Typography>
    </IconBadge>
  );
}

function Balances({ c }: { c: Extract<Card, { type: 'balances' }> }) {
  return (
    <Shell icon={<AccountBalanceWalletRoundedIcon />} title="Your balances" subtitle={`${c.accounts.length} accounts`}>
      <Amount value={c.total} currency={c.total_currency} size={28} />
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        approximate total at today’s mid rate
      </Typography>
      <Divider sx={{ mb: 0.5 }} />
      {c.accounts.map((a) => (
        <Stack key={a.label} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
          <AccountGlyph currency={a.currency} size={32} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {a.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {a.number}
              {a.sponsor_funded ? ' · funded by Dad' : ''}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {money(a.balance, a.currency)}
          </Typography>
        </Stack>
      ))}
    </Shell>
  );
}

function FxRow({ q, best, worstCost }: { q: Quote; best: boolean; worstCost: number }) {
  const t = useTheme();
  return (
    <Box
      sx={{
        borderRadius: '14px',
        p: 1.5,
        bgcolor: best ? t.m3.primaryContainer : 'transparent',
        color: best ? t.m3.onPrimaryContainer : 'inherit',
        border: best ? 'none' : `1px solid ${t.m3.outlineVariant}`,
      }}
    >
      <Stack sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }} direction="row" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Stack sx={{ alignItems: 'center' }} direction="row" spacing={0.75}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {q.provider}
            </Typography>
            {best && <EmojiEventsRoundedIcon sx={{ fontSize: 16 }} />}
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', opacity: 0.8 }}>
            {q.speed === 'instant' ? <BoltRoundedIcon sx={{ fontSize: 14 }} /> : <ScheduleRoundedIcon sx={{ fontSize: 14 }} />}
            <Typography variant="caption">
              {q.speed} · fee {q.fee ? money(q.fee, q.fee_currency) : 'none'}
            </Typography>
          </Stack>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
            {money(q.you_receive, q.receive_currency)}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 650, color: best ? 'inherit' : q.true_cost_pct > 3 ? 'error.main' : 'text.secondary' }}>
            true cost {q.true_cost_pct}%
          </Typography>
        </Box>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={(q.true_cost / worstCost) * 100}
        color={q.true_cost_pct > 3 ? 'error' : 'primary'}
        sx={{ mt: 1, height: 4, bgcolor: best ? 'rgba(0,32,32,.10)' : undefined }}
        aria-label={`True cost ${money(q.true_cost, q.receive_currency)}`}
      />
    </Box>
  );
}

function FxQuotes({ c }: { c: Extract<Card, { type: 'fx_quotes' }> }) {
  const sorted = [...c.quotes].sort((a, b) => b.you_receive - a.you_receive);
  const worst = Math.max(...c.quotes.map((q) => q.true_cost)) || 1;
  return (
    <Shell
      icon={<CurrencyExchangeRoundedIcon />}
      title={`${money(c.amount, c.from_currency, { decimals: 0 })} → ${c.to_currency}`}
      subtitle={`True cost = fees + rate markup vs mid ${sorted[0]?.mid_rate}`}
    >
      <Stack spacing={1}>
        {sorted.map((q) => (
          <FxRow key={q.provider_key} q={q} best={q.provider === c.best} worstCost={worst} />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
        <ToneChip tone="success" icon={<CheckCircleRoundedIcon />} label={`Saves ${money(c.saving_vs_worst, c.to_currency)} vs worst`} />
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {c.note || 'Sandbox rates snapshot, not advice.'}
      </Typography>
    </Shell>
  );
}

function FxHistory({ c }: { c: Extract<Card, { type: 'fx_history' }> }) {
  const t = useTheme();
  const W = 300;
  const H = 60;
  const lo = Math.min(...c.series);
  const hi = Math.max(...c.series);
  const pts = c.series.map((v, i) => `${(i / (c.series.length - 1)) * W},${H - ((v - lo) / (hi - lo || 1)) * (H - 8) - 4}`).join(' ');
  return (
    <Shell icon={<ShowChartRoundedIcon />} title={`${c.pair} · last ${c.days} days`} subtitle={`Today ${c.today}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${c.pair} rate history`}>
        <polyline points={pts} fill="none" stroke={t.m3.primary} strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Chip size="small" variant="outlined" label={`Low ${c.low}`} />
        <Chip size="small" variant="outlined" label={`Avg ${c.average}`} />
        <Chip size="small" variant="outlined" label={`High ${c.high}`} />
      </Stack>
    </Shell>
  );
}

export function TuitionView({ c }: { c: Omit<TuitionCard, 'type'> }) {
  const next = c.installments[0];
  const covered = next ? Math.min(100, (c.tuition_fund_cad / next.amount) * 100) : 100;
  return (
    <Box>
      {next && (
        <>
          <Stack sx={{ justifyContent: 'space-between', alignItems: 'baseline' }} direction="row">
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              Tuition Fund covers {Math.round(covered)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {money(c.tuition_fund_cad, 'CAD', { decimals: 0 })} of {money(next.amount, next.currency, { decimals: 0 })}
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={covered} color={c.next_shortfall_cad > 0 ? 'warning' : 'success'} sx={{ my: 1 }} />
        </>
      )}
      {c.installments.map((i) => (
        <Stack key={i.term} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {i.term}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              due {longDate(i.due)} · in {i.days_until_due} days
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {money(i.amount, i.currency, { decimals: 0 })}
          </Typography>
        </Stack>
      ))}
      {c.next_shortfall_cad > 0 && (
        <Typography variant="body2" sx={{ mt: 1, color: 'warning.main', fontWeight: 650 }}>
          Short {money(c.next_shortfall_cad)} for the next installment. Your MYR Wallet is worth about {money(c.myr_wallet_value_cad, 'CAD', { decimals: 0 })}.
        </Typography>
      )}
    </Box>
  );
}

export function BudgetView({ c, limit }: { c: Omit<BudgetCard, 'type'>; limit?: number }) {
  const cats = limit ? c.categories.slice(0, limit) : c.categories;
  return (
    <Box>
      <Stack direction="row" spacing={3} sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Spent · {c.period_days} days
          </Typography>
          <Typography variant="subtitle1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(c.total_spent_cad, 'CAD', { decimals: 0 })}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Income
          </Typography>
          <Typography variant="subtitle1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(c.income_cad, 'CAD', { decimals: 0 })}
          </Typography>
        </Box>
      </Stack>
      <Stack spacing={1.25}>
        {cats.map((k) => {
          const pct = k.budget_cad ? Math.min(100, (k.spent_cad / k.budget_cad) * 100) : 0;
          return (
            <Box key={k.category}>
              <Stack sx={{ justifyContent: 'space-between', alignItems: 'center' }} direction="row">
                <Stack sx={{ alignItems: 'center' }} direction="row" spacing={0.75}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {CATEGORY_LABEL(k.category)}
                  </Typography>
                  {k.over_budget && <ToneChip tone="error" icon={<WarningAmberRoundedIcon />} label="Over" sx={{ height: 20, '& .MuiChip-label': { px: 0.75 } }} />}
                </Stack>
                <Typography variant="caption" sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }} color={k.over_budget ? 'error' : 'text.secondary'}>
                  {money(k.spent_cad, 'CAD', { decimals: 0 })}
                  {k.budget_cad ? ` / ${k.budget_cad.toFixed(0)}` : ''}
                </Typography>
              </Stack>
              {k.budget_cad ? (
                <LinearProgress variant="determinate" value={pct} color={k.over_budget ? 'error' : pct > 85 ? 'warning' : 'primary'} sx={{ mt: 0.5, height: 5 }} />
              ) : null}
            </Box>
          );
        })}
      </Stack>
      {c.possible_duplicate_charges.length > 0 && (
        <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 1.5, fontWeight: 650 }}>
          Possible duplicate: {c.possible_duplicate_charges.join(', ')}
        </Typography>
      )}
    </Box>
  );
}

const VERDICT: Record<ForecastCard['verdict'], { label: string; tone: Tone }> = {
  on_track: { label: 'On track', tone: 'success' },
  tuition_gap: { label: 'Tuition gap', tone: 'warning' },
  spending_shortfall: { label: 'Runs short', tone: 'error' },
  both: { label: 'Runs short + tuition gap', tone: 'error' },
};

export function ForecastView({ f, showSuggestions = true }: { f: ForecastCard; showSuggestions?: boolean }) {
  const v = VERDICT[f.verdict];
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <ToneChip tone={v.tone} icon={v.tone === 'success' ? <CheckCircleRoundedIcon /> : <ErrorRoundedIcon />} label={v.label} />
        {f.first_shortfall_date && <ToneChip tone="neutral" label={`Below zero ${shortDate(f.first_shortfall_date)}`} />}
      </Stack>
      <RunwayChart f={f} />
      <Box sx={{ mt: 1 }}>
        <KeyValue k="Lowest point" v={`${money(f.lowest.balance)} · ${shortDate(f.lowest.date)}`} />
        <KeyValue k="Usual spending" v={`${money(f.weekly_spending_cad)} / week`} />
        {f.tuition.map((tu) => (
          <KeyValue key={tu.term} k={`Tuition ${shortDate(tu.due)}`} v={tu.gap > 0 ? `short ${money(tu.gap)}` : 'covered'} />
        ))}
      </Box>
      {showSuggestions && f.suggestions.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {f.suggestions.map((s) => (
            <Stack sx={{ alignItems: 'flex-start' }} key={s} direction="row" spacing={1}>
              <LightbulbRoundedIcon sx={{ fontSize: 18, color: 'warning.main', mt: '1px' }} />
              <Typography variant="body2">{s}</Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {f.pending_included.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Includes pending: {f.pending_included.join('; ')}
        </Typography>
      )}
    </Box>
  );
}

const HEALTH_TONE: Record<string, Tone> = { needs_attention: 'error', fair: 'warning', on_track: 'primary', strong: 'success' };

export function CreditView({ c }: { c: Omit<CreditCardData, 'type'> }) {
  const t = useTheme();
  return (
    <Box>
      <UtilizationGauge pct={c.utilization_pct} target={c.target_pct} reported={c.utilization_reported_pct} />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', mt: 0.5, mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <ToneChip tone={HEALTH_TONE[c.health.key] ?? 'neutral'} label={`Simulated: ${c.health.label}`} />
        <Chip size="small" variant="outlined" label={`Last reported ${c.utilization_reported_pct}%`} />
      </Stack>
      <KeyValue k="Balance" v={`${money(c.card.balance)} of ${money(c.card.credit_limit, 'CAD', { decimals: 0 })}`} />
      {c.statement && <KeyValue k="Statement due" v={`${money(c.statement.remaining)} · ${shortDate(c.statement.due_date)}`} />}
      <KeyValue k="Statement closes" v={`${shortDate(c.next_statement_date)} · in ${c.days_until_statement} days`} />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          On-time streak
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {c.payment_history.map((s, i) => (
            <Box
              key={i}
              title={s.replace('_', ' ')}
              sx={{
                width: 14,
                height: 14,
                borderRadius: '4px',
                bgcolor: s === 'on_time' ? t.m3.success : s === 'late' ? t.m3.error : 'transparent',
                border: s === 'due' ? `2px solid ${t.m3.warning}` : 'none',
              }}
            />
          ))}
        </Stack>
      </Stack>
      <Box sx={{ mt: 1, p: 1.5, borderRadius: '14px', bgcolor: t.m3.primaryContainer, color: t.m3.onPrimaryContainer }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Pay {money(c.recommended_payment.amount)} now
        </Typography>
        <Typography variant="caption" component="div">
          Reported utilization drops to {c.recommended_payment.utilization_after_pct}% when the statement closes.
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {c.health.basis}
      </Typography>
    </Box>
  );
}

function Scam({ c }: { c: Extract<Card, { type: 'scam_check' }> }) {
  const t = useTheme();
  const v =
    c.verdict === 'likely_scam'
      ? { label: 'Likely a scam', tone: 'error' as Tone, icon: <GppBadRoundedIcon /> }
      : c.verdict === 'suspicious'
        ? { label: 'Suspicious', tone: 'warning' as Tone, icon: <GppMaybeRoundedIcon /> }
        : { label: 'No known scam pattern', tone: 'success' as Tone, icon: <VerifiedUserRoundedIcon /> };
  const bg = v.tone === 'error' ? t.m3.errorContainer : v.tone === 'warning' ? t.m3.warningContainer : t.m3.successContainer;
  const fg = v.tone === 'error' ? t.m3.onErrorContainer : v.tone === 'warning' ? t.m3.onWarningContainer : t.m3.onSuccessContainer;
  return (
    <Box sx={{ borderRadius: '20px', overflow: 'hidden', border: `1px solid ${t.m3.outlineVariant}`, bgcolor: t.m3.surfaceContainerLowest }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', bgcolor: bg, color: fg, p: 2 }}>
        <Box sx={{ '& svg': { fontSize: 32 } }}>{v.icon}</Box>
        <Box>
          <Typography variant="subtitle1">{v.label}</Typography>
          {c.model_confidence !== undefined && (
            <Typography variant="caption">
              Classifier: {c.model_label} · {Math.round(c.model_confidence * 100)}% confidence
            </Typography>
          )}
        </Box>
      </Stack>
      <Box sx={{ p: 2 }}>
        {c.quote && (
          <Typography variant="body2" sx={{ fontStyle: 'italic', borderLeft: `3px solid ${t.m3.error}`, pl: 1.5, mb: 1.5 }}>
            “{c.quote}”
          </Typography>
        )}
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75, mb: 1.5 }}>
          {c.signals.map((s) => (
            <ToneChip key={s.name} tone={v.tone} label={s.name} />
          ))}
        </Stack>
        <Stack spacing={1}>
          {c.advice.map((a) => (
            <Stack sx={{ alignItems: 'flex-start' }} key={a} direction="row" spacing={1}>
              <CheckCircleRoundedIcon sx={{ fontSize: 18, color: 'primary.main', mt: '1px' }} />
              <Typography variant="body2">{a}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function Transactions({ c }: { c: Extract<Card, { type: 'transactions' }> }) {
  const [all, setAll] = useState(false);
  const rows = all ? c.rows : c.rows.slice(0, 6);
  return (
    <Shell icon={<ReceiptLongRoundedIcon />} title="Recent transactions" subtitle={`${c.count} in the last 30 days`}>
      {rows.map((r, i) => (
        <Stack key={`${r.date}-${i}`} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {r.counterparty}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {shortDate(r.date)} · {CATEGORY_LABEL(r.category)}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: r.amount > 0 ? 'success.main' : 'text.primary' }}>
            {money(r.amount, r.currency, { sign: true })}
          </Typography>
        </Stack>
      ))}
      {c.rows.length > 6 && (
        <Button size="small" onClick={() => setAll(!all)} sx={{ mt: 0.5 }}>
          {all ? 'Show less' : `Show all ${c.rows.length}`}
        </Button>
      )}
    </Shell>
  );
}

export function ResultCard({ card }: { card: Card }) {
  switch (card.type) {
    case 'balances':
      return <Balances c={card} />;
    case 'fx_quotes':
      return <FxQuotes c={card} />;
    case 'fx_history':
      return <FxHistory c={card} />;
    case 'tuition':
      return (
        <Shell icon={<SchoolRoundedIcon />} tone="tertiary" title="Tuition schedule" subtitle="UBC Student Financial Services">
          <TuitionView c={card} />
        </Shell>
      );
    case 'budget':
      return (
        <Shell icon={<PieChartRoundedIcon />} title="Budget" subtitle={`Last ${card.period_days} days`}>
          <BudgetView c={card} />
        </Shell>
      );
    case 'scam_check':
      return <Scam c={card} />;
    case 'transactions':
      return <Transactions c={card} />;
    case 'checklist':
      return (
        <Shell icon={<ChecklistRoundedIcon />} title={card.title}>
          <Stack spacing={1}>
            {card.items.map((i) => (
              <Stack sx={{ alignItems: 'flex-start' }} key={i} direction="row" spacing={1}>
                <CheckCircleRoundedIcon sx={{ fontSize: 18, color: 'primary.main', mt: '1px' }} />
                <Typography variant="body2">{i}</Typography>
              </Stack>
            ))}
          </Stack>
          {card.footnote && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
              {card.footnote}
            </Typography>
          )}
        </Shell>
      );
    case 'forecast':
      return (
        <Shell icon={<ShowChartRoundedIcon />} title={`Runway · ${card.account}`} subtitle={`to ${card.horizon} (${shortDate(card.end_date)})`}>
          <ForecastView f={card} />
        </Shell>
      );
    case 'credit':
      return (
        <Shell icon={<CreditCardRoundedIcon />} title={card.card.label} subtitle={`${card.card.number} · sandbox secured card`}>
          <CreditView c={card} />
        </Shell>
      );
    default:
      return null;
  }
}
