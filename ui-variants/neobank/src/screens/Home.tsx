import { ArrowLeftRight, ArrowUpRight, ChevronRight, CreditCard, GraduationCap, HeartHandshake, Send, ShieldCheck, TrendingDown, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';

import { RingGauge, RunwayChart, Meter } from '../components/charts';
import { TopBar } from '../components/Chrome';
import { Chip, cn, Eyebrow, Glass, HeroMoney, Segmented, SectionHeader, Sheet, spring } from '../components/primitives';
import { Forecast } from '../components/ResultCards';
import { shortDate, sym } from '../lib/format';
import { useStore } from '../lib/store';
import type { Account, CreditProfile, Overview } from '../lib/types';

const PROMPTS = {
  fx: 'Cheapest way to change 5,000 MYR to CAD?',
  rent: 'Pay rent to my landlord',
  runway: 'Will I run out of money before tuition is due?',
  scam: 'Is this a scam? "CRA NOTICE: You owe $1,980 in unpaid taxes. Pay today with Apple gift cards or a warrant will be issued for your arrest."',
  credit: "How's my credit?",
  cover: 'Cover the tuition shortfall from my MYR wallet',
  spend: 'Show my recent transactions',
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { overview, forecast, currency, setCurrency, ask } = useStore();
  const [runwayOpen, setRunwayOpen] = useState(false);
  if (!overview) return <Skeleton />;

  const rate = overview.rates['CAD/MYR'] ?? 3.09;
  const total = currency === 'CAD' ? overview.total_cad : overview.total_cad * rate;
  const other = currency === 'CAD' ? sym(overview.total_cad * rate, 'MYR', 0) : sym(overview.total_cad, 'CAD', 0);
  const credit = overview.credit?.has_card ? overview.credit : null;

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-36">
      <TopBar eyebrow={greeting()} title="Aisha" />

      {/* hero */}
      <section className="px-5 pt-5">
        <div className="flex items-center justify-between">
          <Eyebrow>Total balance</Eyebrow>
          <Segmented
            label="Display currency"
            size="sm"
            value={currency}
            onChange={setCurrency}
            items={[
              { value: 'CAD', label: 'CAD' },
              { value: 'MYR', label: 'MYR' },
            ]}
          />
        </div>
        <div className="mt-4">
          <HeroMoney value={total} currency={currency} />
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[13.5px] text-fg-3">
          <span className="num">≈ {other}</span>
          <span className="size-[3px] rounded-full bg-fg-3" />
          <span className="num">1 CAD = {rate.toFixed(4)} MYR</span>
        </div>

        <div className="mt-7 grid grid-cols-4 gap-2">
          <Quick icon={ArrowLeftRight} label="Convert" onClick={() => ask(PROMPTS.fx)} />
          <Quick icon={Send} label="Pay rent" onClick={() => ask(PROMPTS.rent)} />
          <Quick icon={TrendingDown} label="Runway" onClick={() => setRunwayOpen(true)} />
          <Quick icon={ShieldCheck} label="Scam check" onClick={() => ask(PROMPTS.scam)} />
        </div>
      </section>

      <Carousel overview={overview} credit={credit} />

      <Insights overview={overview} credit={credit} />

      <section className="mt-8 space-y-3 px-5">
        <SectionHeader title="Looking ahead" />
        {forecast && (
          <Glass press onClick={() => setRunwayOpen(true)} className="cursor-pointer p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            <div className="flex items-center justify-between">
              <Eyebrow>Runway · to {shortDate(forecast.end_date)}</Eyebrow>
              {forecast.first_shortfall_date ? <Chip tone="danger">Short {shortDate(forecast.first_shortfall_date)}</Chip> : <Chip tone="accent">On track</Chip>}
            </div>
            <div className="mt-3 text-[19px] leading-snug font-medium tracking-[-0.02em]">
              {forecast.first_shortfall_date ? (
                <>
                  Everyday dips below zero on <span className="text-danger">{shortDate(forecast.first_shortfall_date)}</span>
                </>
              ) : (
                'You stay above zero until tuition'
              )}
            </div>
            <div className="mt-4 -mx-1">
              <RunwayChart f={forecast} compact />
            </div>
            <div className="mt-3 flex items-center justify-between text-[12.5px]">
              <span className="num text-fg-3">
                Lowest {sym(forecast.lowest.balance, 'CAD', 0)} · {shortDate(forecast.lowest.date)}
              </span>
              <span className="flex items-center gap-0.5 font-medium text-fg-2">
                Details <ChevronRight className="size-3.5" />
              </span>
            </div>
          </Glass>
        )}
        <TuitionCountdown overview={overview} onCover={() => ask(PROMPTS.cover)} />
      </section>

      <Sheet open={runwayOpen} onOpenChange={setRunwayOpen} title="Runway" description="Your CAD Everyday balance, day by day, on your usual spending and known bills.">
        {forecast ? <Forecast c={forecast} /> : <p className="text-fg-3">No forecast available.</p>}
        <button
          onClick={() => {
            setRunwayOpen(false);
            ask(PROMPTS.runway);
          }}
          className="mt-4 flex w-full items-center justify-center gap-1.5 text-[14px] font-medium text-accent"
        >
          Ask the assistant about this <ArrowUpRight className="size-4" />
        </button>
      </Sheet>
    </div>
  );
}

function Quick({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <motion.button whileTap={{ scale: 0.92 }} transition={spring} onClick={onClick} className="group flex flex-col items-center gap-2">
      <span className="flex size-[54px] items-center justify-center rounded-full border border-line bg-white/[0.05] text-fg transition-colors group-hover:bg-white/[0.09]">
        <Icon className="size-[20px]" strokeWidth={2} />
      </span>
      <span className="text-[12px] font-medium text-fg-2">{label}</span>
    </motion.button>
  );
}

// ---------------------------------------------------------------- account carousel
function Carousel({ overview, credit }: { overview: Overview; credit: Extract<CreditProfile, { has_card: true }> | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const cards: ReactNode[] = overview.accounts.map((a) => <AccountCard key={a.id} a={a} overview={overview} />);
  if (credit) cards.push(<CardTile key="card" credit={credit} />);

  return (
    <section className="mt-9">
      <div className="mb-3 flex items-end justify-between px-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Accounts</h2>
        <div className="flex gap-1.5">
          {cards.map((_, i) => (
            <motion.span key={i} className="h-1.5 rounded-full bg-fg" animate={{ width: i === idx ? 18 : 6, opacity: i === idx ? 1 : 0.22 }} transition={spring} />
          ))}
        </div>
      </div>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetWidth + 12 : 1;
          setIdx(Math.round(el.scrollLeft / w));
        }}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-5 pb-2"
        style={{ scrollPaddingInline: 20 }}
      >
        {cards.map((c, i) => (
          <motion.div
            key={i}
            className="w-[82%] shrink-0 snap-start"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.05 + i * 0.07 }}
          >
            {c}
          </motion.div>
        ))}
        <div className="w-2 shrink-0" />
      </div>
    </section>
  );
}

function AccountCard({ a, overview }: { a: Account; overview: Overview }) {
  const primary = a.id === 'acc_cad';
  const tuition = a.id === 'acc_tui';
  const myr = a.currency === 'MYR';
  const next = overview.tuition.installments[0];
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={cn(
        'relative flex h-[196px] flex-col justify-between overflow-hidden rounded-card p-5',
        primary ? 'bg-accent text-accent-ink shadow-[0_24px_50px_-24px_rgb(198_249_74/0.55)]' : 'glass',
      )}
    >
      {primary && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-16 -right-10 size-48 rounded-full bg-white/40 blur-2xl" />
          <svg className="absolute right-0 bottom-0 h-full w-2/3 opacity-[0.12]" viewBox="0 0 200 200" preserveAspectRatio="none">
            {Array.from({ length: 9 }, (_, i) => (
              <path key={i} d={`M0 ${200 - i * 14} C 60 ${160 - i * 14}, 120 ${220 - i * 14}, 200 ${120 - i * 14}`} stroke="#0a0b0d" fill="none" strokeWidth="1" />
            ))}
          </svg>
        </div>
      )}
      <div className="relative flex items-start justify-between">
        <div>
          <div className={cn('text-[13px] font-semibold', primary ? 'text-accent-ink/70' : 'text-fg-2')}>{a.label}</div>
          <div className={cn('mt-0.5 font-mono text-[11.5px]', primary ? 'text-accent-ink/55' : 'text-fg-3')}>{a.number}</div>
        </div>
        {a.sponsor_funded ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-fg-2">
            <HeartHandshake className="size-3" /> from Dad
          </span>
        ) : (
          <span className={cn('rounded-full px-2 py-1 font-mono text-[10.5px] font-semibold', primary ? 'bg-ink-1/10' : 'bg-white/[0.06]')}>{a.currency}</span>
        )}
      </div>
      <div className="relative">
        <div className={cn('num text-[34px] leading-none font-medium tracking-[-0.045em]')}>{sym(a.balance, a.currency)}</div>
        {myr && <div className="num mt-1.5 text-[12.5px] text-fg-3">≈ {sym(a.balance * (overview.rates['MYR/CAD'] ?? 0.32), 'CAD', 0)}</div>}
        {tuition && next && (
          <div className="mt-3">
            <Meter value={a.balance} max={next.amount} tone={a.balance < next.amount ? 'warn' : 'accent'} />
            <div className="mt-1.5 flex justify-between text-[11.5px] text-fg-3">
              <span>
                for {sym(next.amount, 'CAD', 0)} · {shortDate(next.due)}
              </span>
              <span className="num">{Math.round((a.balance / next.amount) * 100)}%</span>
            </div>
          </div>
        )}
        {primary && <div className="mt-1.5 text-[12.5px] font-medium text-accent-ink/60">Everyday spending · Visa debit</div>}
      </div>
    </motion.div>
  );
}

function CardTile({ credit }: { credit: Extract<CreditProfile, { has_card: true }> }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className="relative flex h-[196px] items-center justify-between overflow-hidden rounded-card border border-line bg-[linear-gradient(135deg,#2a2d33_0%,#14161a_55%,#1d2025_100%)] p-5"
    >
      <div className="flex h-full flex-col justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-2">
            <CreditCard className="size-3.5" /> Secured card
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-3">{credit.card.number}</div>
        </div>
        <div>
          <div className="num text-[30px] leading-none font-medium tracking-[-0.045em]">{sym(credit.card.balance)}</div>
          <div className="num mt-1.5 text-[12.5px] text-fg-3">of {sym(credit.card.credit_limit, 'CAD', 0)} limit</div>
        </div>
      </div>
      <RingGauge pct={credit.utilization_pct} target={credit.target_pct} size={92} stroke={7}>
        <span className="num text-[18px] font-medium tracking-tight">{Math.round(credit.utilization_pct)}%</span>
        <span className="text-[9.5px] text-fg-3">used</span>
      </RingGauge>
    </motion.div>
  );
}

// ---------------------------------------------------------------- insights
function Insights({ overview, credit }: { overview: Overview; credit: Extract<CreditProfile, { has_card: true }> | null }) {
  const { ask, setStudentTab } = useStore();
  const items: { key: string; tone: 'warn' | 'danger' | 'neutral' | 'accent'; text: string; prompt?: string }[] = [];
  const waiting = overview.pending.filter((p) => p.status === 'awaiting_sponsor').length;
  if (waiting) items.push({ key: 'waiting', tone: 'warn', text: `${waiting} payment${waiting > 1 ? 's' : ''} waiting for Dad` });
  if (credit?.statement)
    items.push({ key: 'stmt', tone: 'warn', text: `Card statement due in ${credit.statement.days_until_due} days`, prompt: "How's my credit?" });
  for (const b of overview.budget.categories)
    if (b.over_budget && b.budget_cad)
      items.push({ key: b.category, tone: 'danger', text: `${b.category[0].toUpperCase()}${b.category.slice(1)} ${Math.round((b.spent_cad / b.budget_cad - 1) * 100)}% over budget`, prompt: PROMPTS.spend });
  for (const d of overview.budget.possible_duplicate_charges) items.push({ key: `dup-${d}`, tone: 'neutral', text: `Possible double charge: ${d}`, prompt: PROMPTS.spend });
  if (credit && credit.utilization_pct > credit.target_pct)
    items.push({ key: 'util', tone: 'neutral', text: `Card ${Math.round(credit.utilization_pct)}% used, aim under ${credit.target_pct}%`, prompt: PROMPTS.credit });
  if (!items.length) return null;
  const dot = { warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-fg-3', accent: 'bg-accent' };
  return (
    <section className="mt-8">
      <h2 className="mb-3 px-6 text-[17px] font-semibold tracking-[-0.02em]">For you</h2>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
        {items.map((it, i) => (
          <motion.button
            key={it.key}
            onClick={() => (it.prompt ? ask(it.prompt) : setStudentTab('wallet'))}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.2 + i * 0.05 }}
            className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white/[0.04] pr-3.5 pl-3 text-[13px] font-medium whitespace-nowrap text-fg-2 hover:text-fg"
          >
            <span className={cn('size-1.5 rounded-full', dot[it.tone])} />
            {it.text}
            <ChevronRight className="size-3.5 text-fg-3" />
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function TuitionCountdown({ overview, onCover }: { overview: Overview; onCover: () => void }) {
  const t = overview.tuition;
  const next = t.installments[0];
  if (!next) return null;
  const short = t.next_shortfall_cad > 0;
  return (
    <Glass className="p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.08 }}>
      <div className="flex items-center justify-between">
        <Eyebrow>Tuition · {next.term.replace('Winter Term 2, ', '')}</Eyebrow>
        <GraduationCap className="size-4 text-fg-3" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="num text-[56px] leading-[0.9] font-medium tracking-[-0.055em]">{next.days_until_due}</div>
          <div className="mt-2 text-[13px] text-fg-3">days until {shortDate(next.due)}</div>
        </div>
        <div className="pb-1 text-right">
          <div className="num text-[17px] font-medium">{sym(next.amount, next.currency)}</div>
          <div className={cn('num mt-0.5 text-[12.5px]', short ? 'text-warn' : 'text-accent')}>{short ? `${sym(t.next_shortfall_cad)} short` : 'Fully funded'}</div>
        </div>
      </div>
      <Meter value={t.tuition_fund_cad} max={next.amount} tone={short ? 'warn' : 'accent'} className="mt-5" />
      {short && (
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={onCover}
          className="mt-4 flex w-full items-center justify-between rounded-tile border border-line bg-white/[0.04] px-4 py-3 text-left"
        >
          <span>
            <span className="block text-[14px] font-medium">Cover it from your MYR wallet</span>
            <span className="num block text-[12px] text-fg-3">Wallet worth ≈ {sym(t.myr_wallet_value_cad, 'CAD', 0)} · cheapest rate</span>
          </span>
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink">
            <ArrowUpRight className="size-4" strokeWidth={2.5} />
          </span>
        </motion.button>
      )}
    </Glass>
  );
}

function Skeleton() {
  return (
    <div className="px-5 pt-[calc(var(--sat)+24px)]">
      {[64, 120, 196, 160].map((h, i) => (
        <motion.div key={i} className="mb-4 rounded-card bg-white/[0.04]" style={{ height: h }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.1 }} />
      ))}
    </div>
  );
}
