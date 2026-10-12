import { CalendarClock, Check, CircleCheck, Copy, GraduationCap, Quote as QuoteIcon, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { money, shortDate, sym, titleCase } from '../lib/format';
import type { BudgetCategory, Card, CreditCardData, ForecastCard, TuitionCard } from '../lib/types';
import { Meter, RingGauge, RunwayChart, Sparkline } from './charts';
import { Chip, cn, Eyebrow, Glass, HeroMoney, spring } from './primitives';

const enter = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: spring };
const stagger = (i: number) => ({ initial: { opacity: 0, x: -8 }, animate: { opacity: 1, x: 0 }, transition: { ...spring, delay: 0.08 + i * 0.06 } });

function Shell({ eyebrow, right, children, className }: { eyebrow: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Glass {...enter} className={cn('p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        {right}
      </div>
      {children}
    </Glass>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[11.5px] leading-relaxed text-fg-3">{children}</p>;
}

// ---------------------------------------------------------------- balances
function Balances({ c }: { c: Extract<Card, { type: 'balances' }> }) {
  return (
    <Shell eyebrow="Balances" right={<span className="text-[12px] text-fg-3">{c.accounts.length} accounts</span>}>
      <HeroMoney value={c.total} currency={c.total_currency} size="lg" />
      <div className="mt-1 text-[13px] text-fg-3">Total, converted at mid-market</div>
      <div className="mt-4 divide-y divide-line">
        {c.accounts.map((a, i) => (
          <motion.div key={a.label} {...stagger(i)} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[10.5px] font-semibold text-fg-2">{a.currency}</span>
              <div>
                <div className="text-[14.5px] font-medium">{a.label}</div>
                <div className="font-mono text-[11.5px] text-fg-3">{a.number}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="num text-[15px] font-medium">{sym(a.balance, a.currency)}</div>
              {a.sponsor_funded && <div className="text-[11.5px] text-fg-3">from Dad</div>}
            </div>
          </motion.div>
        ))}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- fx quotes: true-cost ranking
function FxQuotes({ c }: { c: Extract<Card, { type: 'fx_quotes' }> }) {
  const qs = [...c.quotes].sort((a, b) => a.true_cost - b.true_cost);
  const maxPct = Math.max(...qs.map((q) => q.true_cost_pct));
  return (
    <Shell eyebrow={`${c.from_currency} ${c.amount.toLocaleString('en-CA')} → ${c.to_currency}`} right={<Chip tone="accent" icon={<Sparkles className="size-3" />}>True cost</Chip>}>
      <div className="flex items-baseline gap-2">
        <span className="num text-[34px] font-medium tracking-[-0.04em] text-accent">{sym(c.saving_vs_worst, c.to_currency)}</span>
        <span className="text-[14px] text-fg-2">saved vs worst</span>
      </div>
      <div className="mt-1 text-[13px] text-fg-3">Fees and rate margin combined, ranked cheapest first.</div>
      <div className="mt-5 space-y-2">
        {qs.map((q, i) => {
          const best = i === 0;
          return (
            <motion.div key={q.provider_key} {...stagger(i)} className={cn('rounded-tile border p-3.5', best ? 'border-accent/25 bg-accent/[0.06]' : 'border-line bg-white/[0.02]')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn('num flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold', best ? 'bg-accent text-accent-ink' : 'bg-white/[0.07] text-fg-2')}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{q.provider}</div>
                    <div className="flex items-center gap-1 text-[11.5px] text-fg-3">
                      {q.speed === 'instant' && <Zap className="size-3 text-accent" />}
                      {q.speed}
                      {q.fee > 0 && ` · fee ${money(q.fee, q.fee_currency, 0)}`}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('num text-[15px] font-semibold', best && 'text-accent')}>{sym(q.you_receive, q.receive_currency)}</div>
                  <div className="text-[11px] text-fg-3">you receive</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className={cn('h-full rounded-full', best ? 'bg-accent' : i === qs.length - 1 ? 'bg-danger/80' : 'bg-fg-2/60')}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(3, (q.true_cost_pct / maxPct) * 100)}%` }}
                    transition={{ duration: 0.9, delay: 0.2 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <span className="num w-[92px] text-right text-[11.5px] text-fg-2">
                  {q.true_cost_pct}% · {sym(q.true_cost, q.receive_currency)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      <Foot>{c.note || 'Sandbox rate snapshot. Mid-market'} {qs[0] && `${qs[0].mid_rate} ${c.to_currency}/${c.from_currency}.`} Not advice.</Foot>
    </Shell>
  );
}

function FxHistory({ c }: { c: Extract<Card, { type: 'fx_history' }> }) {
  return (
    <Shell eyebrow={`${c.pair} · ${c.days} days`}>
      <div className="num text-[34px] font-medium tracking-[-0.04em]">{c.today}</div>
      <Sparkline series={c.series} className="mt-3" />
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Low', c.low],
          ['Average', c.average],
          ['High', c.high],
        ].map(([k, v]) => (
          <div key={k} className="rounded-tile bg-white/[0.03] py-2.5">
            <div className="eyebrow">{k}</div>
            <div className="num mt-1.5 text-[13.5px]">{v}</div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- forecast
const VERDICT: Record<ForecastCard['verdict'], { text: string; tone: 'accent' | 'warn' | 'danger' }> = {
  on_track: { text: 'On track', tone: 'accent' },
  tuition_gap: { text: 'Tuition gap', tone: 'warn' },
  spending_shortfall: { text: 'Runs short', tone: 'danger' },
  both: { text: 'Short twice', tone: 'danger' },
};

export function Forecast({ c }: { c: ForecastCard }) {
  const v = VERDICT[c.verdict];
  const gap = c.tuition.find((t) => t.gap > 0);
  return (
    <Shell eyebrow={`Runway · ${c.account}`} right={<Chip tone={v.tone}>{v.text}</Chip>}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[12px] text-fg-3">Lowest point</div>
          <div className={cn('num mt-1 text-[26px] font-medium tracking-[-0.035em]', c.lowest.balance < 0 ? 'text-danger' : 'text-fg')}>{sym(c.lowest.balance)}</div>
          <div className="text-[12px] text-fg-3">{shortDate(c.lowest.date)}</div>
        </div>
        {gap && (
          <div>
            <div className="text-[12px] text-fg-3">Tuition gap</div>
            <div className="num mt-1 text-[26px] font-medium tracking-[-0.035em] text-warn">{sym(gap.gap)}</div>
            <div className="text-[12px] text-fg-3">due {shortDate(gap.due)}</div>
          </div>
        )}
      </div>
      <div className="mt-5 -mx-1">
        <RunwayChart f={c} />
      </div>
      <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-tile border border-line">
        {[
          ['Today', sym(c.starting_balance, 'CAD', 0)],
          ['Weekly spend', sym(c.weekly_spending_cad, 'CAD', 0)],
          [shortDate(c.end_date), sym(c.ending_balance, 'CAD', 0)],
        ].map(([k, val]) => (
          <div key={k} className="px-3 py-2.5">
            <div className="text-[11px] text-fg-3">{k}</div>
            <div className="num mt-0.5 text-[14px] font-medium">{val}</div>
          </div>
        ))}
      </div>
      {c.suggestions.length > 0 && (
        <div className="mt-5 space-y-2.5">
          <Eyebrow>What would fix it</Eyebrow>
          {c.suggestions.map((s, i) => (
            <motion.div key={s} {...stagger(i)} className="flex gap-3 text-[13.5px] leading-snug text-fg-2">
              <span className="num mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[10.5px] font-semibold text-fg">{i + 1}</span>
              {s}
            </motion.div>
          ))}
        </div>
      )}
      <Foot>{c.disclosure}</Foot>
    </Shell>
  );
}

// ---------------------------------------------------------------- credit
const HIST = { on_time: 'bg-accent', due: 'bg-warn', late: 'bg-danger' } as const;

function Credit({ c }: { c: CreditCardData }) {
  const st = c.statement;
  return (
    <Shell eyebrow={c.card.label} right={<Chip tone={c.health.key === 'strong' || c.health.key === 'on_track' ? 'accent' : 'warn'}>{c.health.label}</Chip>}>
      <div className="flex items-center gap-5">
        <RingGauge pct={c.utilization_pct} target={c.target_pct}>
          <span className="num text-[28px] font-medium tracking-[-0.04em]">{Math.round(c.utilization_pct)}%</span>
          <span className="text-[11px] text-fg-3">utilization</span>
        </RingGauge>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-[11.5px] text-fg-3">Balance</div>
            <div className="num text-[17px] font-medium">
              {sym(c.card.balance)} <span className="text-[13px] text-fg-3">/ {sym(c.card.credit_limit, 'CAD', 0)}</span>
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-fg-3">Target</div>
            <div className="text-[13.5px]">Under {c.target_pct}% at statement</div>
          </div>
          <div>
            <div className="text-[11.5px] text-fg-3">On-time streak</div>
            <div className="mt-1 flex gap-1">
              {c.payment_history.map((h, i) => (
                <motion.span key={i} className={cn('h-2 w-5 rounded-full', HIST[h])} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...spring, delay: 0.3 + i * 0.06 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      {st && (
        <div className="mt-5 flex items-center justify-between rounded-tile border border-warn/15 bg-warn-dim px-4 py-3">
          <div className="flex items-center gap-3">
            <CalendarClock className="size-4 text-warn" />
            <div>
              <div className="text-[13.5px] font-medium">Statement {sym(st.balance)} due {shortDate(st.due_date)}</div>
              <div className="text-[12px] text-fg-3">
                Minimum {sym(st.minimum_due)} · {st.days_until_due} days left
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between rounded-tile border border-line bg-white/[0.03] px-4 py-3">
        <div>
          <div className="text-[12px] text-fg-3">Pay now to report under {c.target_pct}%</div>
          <div className="num text-[17px] font-semibold text-accent">{sym(c.recommended_payment.amount)}</div>
        </div>
        <div className="text-right text-[12px] text-fg-3">
          leaves {sym(c.recommended_payment.balance_after)}
          <div className="num text-fg-2">{c.recommended_payment.utilization_after_pct}% used</div>
        </div>
      </div>
      <Foot>{c.footnote}</Foot>
    </Shell>
  );
}

// ---------------------------------------------------------------- scam check
function Scam({ c }: { c: Extract<Card, { type: 'scam_check' }> }) {
  const bad = c.verdict === 'likely_scam';
  const sus = c.verdict === 'suspicious';
  const Icon = bad ? ShieldAlert : sus ? ShieldQuestion : ShieldCheck;
  const title = bad ? 'Likely a scam' : sus ? 'Looks suspicious' : 'No known scam pattern';
  return (
    <Glass {...enter} className={cn('overflow-hidden p-0', bad && 'border-danger/25')}>
      <div className={cn('relative px-5 pt-5 pb-4', bad ? 'bg-gradient-to-b from-danger/[0.14] to-transparent' : sus ? 'bg-gradient-to-b from-warn/[0.1] to-transparent' : '')}>
        <div className="flex items-center gap-4">
          <span className={cn('relative flex size-12 items-center justify-center rounded-full', bad ? 'bg-danger text-ink-1' : sus ? 'bg-warn text-ink-1' : 'bg-accent text-accent-ink')}>
            <Icon className="size-6" strokeWidth={2.25} />
            {bad && <motion.span className="absolute inset-0 rounded-full border-2 border-danger" animate={{ scale: [1, 1.5], opacity: [0.7, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />}
          </span>
          <div>
            <Eyebrow>Scam check</Eyebrow>
            <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{title}</div>
          </div>
        </div>
        {c.model_confidence !== undefined && c.model_label && (
          <div className="mt-4 flex items-center gap-3">
            <Meter value={c.model_confidence} max={1} tone={bad ? 'danger' : sus ? 'warn' : 'accent'} className="flex-1" />
            <span className="num text-[12px] text-fg-2">{(c.model_confidence * 100).toFixed(1)}% {c.model_label}</span>
          </div>
        )}
      </div>
      <div className="px-5 pb-5">
        {c.quote && (
          <blockquote className="flex gap-2.5 rounded-tile border border-line bg-white/[0.03] p-3.5 text-[13.5px] leading-snug text-fg-2 italic">
            <QuoteIcon className="mt-0.5 size-3.5 shrink-0 text-fg-3" />“{c.quote}”
          </blockquote>
        )}
        {c.signals.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {c.signals.map((s, i) => (
              <motion.span key={s.name} {...stagger(i)}>
                <Chip tone="danger">{s.name}</Chip>
              </motion.span>
            ))}
          </div>
        )}
        <ul className="mt-4 space-y-2.5">
          {c.advice.map((a) => (
            <li key={a} className="flex gap-2.5 text-[13.5px] leading-snug text-fg-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-accent" strokeWidth={3} />
              {a}
            </li>
          ))}
        </ul>
      </div>
    </Glass>
  );
}

// ---------------------------------------------------------------- tuition
export function Tuition({ c }: { c: Omit<TuitionCard, 'type'> }) {
  const next = c.installments[0];
  if (!next) return null;
  return (
    <Shell eyebrow="Tuition" right={<GraduationCap className="size-4 text-fg-3" />}>
      <div className="flex items-end justify-between">
        <div>
          <div className="num text-[44px] leading-none font-medium tracking-[-0.045em]">
            {next.days_until_due}
            <span className="ml-1.5 text-[16px] font-normal tracking-normal text-fg-3">days</span>
          </div>
          <div className="mt-1.5 text-[13px] text-fg-2">
            {next.term} · {shortDate(next.due)}
          </div>
        </div>
        <div className="num text-right text-[15px] font-medium">{sym(next.amount, next.currency)}</div>
      </div>
      <Meter value={c.tuition_fund_cad} max={next.amount} tone={c.next_shortfall_cad > 0 ? 'warn' : 'accent'} className="mt-4" />
      <div className="mt-2 flex justify-between text-[12px]">
        <span className="text-fg-3">Fund {sym(c.tuition_fund_cad, 'CAD', 0)}</span>
        {c.next_shortfall_cad > 0 ? <span className="num text-warn">{sym(c.next_shortfall_cad)} short</span> : <span className="text-accent">Fully funded</span>}
      </div>
      {c.installments.slice(1).map((i) => (
        <div key={i.due} className="mt-4 flex justify-between border-t border-line pt-3 text-[13px]">
          <span className="text-fg-2">{i.term}</span>
          <span className="num text-fg-3">
            {shortDate(i.due)} · {sym(i.amount, i.currency, 0)}
          </span>
        </div>
      ))}
    </Shell>
  );
}

// ---------------------------------------------------------------- budget
export function BudgetBars({ categories }: { categories: BudgetCategory[] }) {
  return (
    <div className="space-y-3.5">
      {categories.map((b, i) => {
        const max = b.budget_cad ?? b.spent_cad;
        return (
          <div key={b.category}>
            <div className="mb-1.5 flex items-baseline justify-between text-[13.5px]">
              <span className="font-medium">{titleCase(b.category)}</span>
              <span className="num text-fg-2">
                <span className={cn(b.over_budget && 'text-danger')}>{sym(b.spent_cad, 'CAD', 0)}</span>
                {b.budget_cad != null && <span className="text-fg-3"> / {sym(b.budget_cad, 'CAD', 0)}</span>}
              </span>
            </div>
            <Meter value={b.spent_cad} max={max} tone={b.over_budget ? 'danger' : b.budget_cad == null ? 'neutral' : 'accent'} delay={i * 0.05} />
          </div>
        );
      })}
    </div>
  );
}

function Budget({ c }: { c: Extract<Card, { type: 'budget' }> }) {
  return (
    <Shell eyebrow={`Spending · ${c.period_days} days`}>
      <div className="mb-5 flex items-baseline gap-2">
        <span className="num text-[30px] font-medium tracking-[-0.04em]">{sym(c.total_spent_cad)}</span>
        <span className="text-[13px] text-fg-3">of {sym(c.income_cad, 'CAD', 0)} in</span>
      </div>
      <BudgetBars categories={c.categories} />
      {c.possible_duplicate_charges.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-warn">
          <Copy className="size-3.5" /> Possible duplicate: {c.possible_duplicate_charges.join(', ')}
        </div>
      )}
    </Shell>
  );
}

function Transactions({ c }: { c: Extract<Card, { type: 'transactions' }> }) {
  return (
    <Shell eyebrow="Recent transactions" right={<span className="text-[12px] text-fg-3">{c.count} total</span>}>
      <div className="divide-y divide-line">
        {c.rows.slice(0, 8).map((r, i) => (
          <motion.div key={`${r.date}-${r.counterparty}-${i}`} {...stagger(i)} className="flex items-center justify-between py-2.5">
            <div>
              <div className="text-[14px] font-medium">{r.counterparty}</div>
              <div className="text-[11.5px] text-fg-3">
                {shortDate(r.date)} · {titleCase(r.category)}
              </div>
            </div>
            <span className={cn('num text-[14px]', r.amount > 0 ? 'text-accent' : 'text-fg')}>
              {r.amount > 0 ? '+' : ''}
              {sym(r.amount, r.currency)}
            </span>
          </motion.div>
        ))}
      </div>
    </Shell>
  );
}

function Checklist({ c }: { c: Extract<Card, { type: 'checklist' }> }) {
  return (
    <Shell eyebrow={c.title}>
      <ul className="space-y-2.5">
        {c.items.map((it) => (
          <li key={it} className="flex gap-2.5 text-[13.5px] leading-snug text-fg-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            {it}
          </li>
        ))}
      </ul>
      {c.footnote && <Foot>{c.footnote}</Foot>}
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
    case 'forecast':
      return <Forecast c={card} />;
    case 'credit':
      return <Credit c={card} />;
    case 'scam_check':
      return <Scam c={card} />;
    case 'tuition':
      return <Tuition c={card} />;
    case 'budget':
      return <Budget c={card} />;
    case 'transactions':
      return <Transactions c={card} />;
    case 'checklist':
      return <Checklist c={card} />;
    default:
      return null;
  }
}
