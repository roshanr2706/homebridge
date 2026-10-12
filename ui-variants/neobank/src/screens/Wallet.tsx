import * as Tabs from '@radix-ui/react-tabs';
import { Copy, CreditCard, HeartHandshake, Lock, LockOpen, Snowflake } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { KindIcon } from '../components/ActionCard';
import { TopBar } from '../components/Chrome';
import { LedgerPanel } from '../components/Ledger';
import { Chip, cn, Eyebrow, Glass, spring, Switch } from '../components/primitives';
import { BudgetBars } from '../components/ResultCards';
import { money, shortDate, sym, timeAgo } from '../lib/format';
import { useStore } from '../lib/store';
import type { Action } from '../lib/types';

type WTab = 'accounts' | 'budget' | 'activity';

export function Wallet() {
  const [tab, setTab] = useState<WTab>('accounts');
  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-36">
      <TopBar eyebrow="Aisha Rahman" title="Wallet" />
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as WTab)} className="px-5 pt-4">
        <Tabs.List aria-label="Wallet sections" className="relative grid grid-cols-3 rounded-full border border-line bg-white/[0.04] p-1">
          {(['accounts', 'budget', 'activity'] as WTab[]).map((t) => (
            <Tabs.Trigger key={t} value={t} className={cn('relative h-9 rounded-full text-[13.5px] font-semibold capitalize transition-colors', tab === t ? 'text-accent-ink' : 'text-fg-2 hover:text-fg')}>
              {tab === t && <motion.span layoutId="wallet-tab" className="absolute inset-0 rounded-full bg-fg" transition={spring} />}
              <span className="relative z-10">{t}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="mt-5">
          <Tabs.Content value="accounts">
            <Accounts />
          </Tabs.Content>
          <Tabs.Content value="budget">
            <Budget />
          </Tabs.Content>
          <Tabs.Content value="activity">
            <Activity />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

function Accounts() {
  const { overview, backend, refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (!overview) return null;
  const credit = overview.credit?.has_card ? overview.credit : null;
  const fz = overview.freeze;
  const myLock = fz.own === 'student' || fz.sponsor_funded === 'student';

  async function toggle(v: boolean) {
    setBusy(true);
    try {
      if (v) {
        await backend.freeze();
        toast('Payments frozen', 'Nothing can be confirmed or approved until you unlock.', 'warn');
      } else {
        const r = await backend.unfreeze();
        toast('Payments unlocked', r.note || undefined);
      }
      await refresh();
    } catch (e) {
      toast('Couldn’t change the lock', (e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Glass className="divide-y divide-line p-0" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        {overview.accounts.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 * i }} className="flex items-center gap-3.5 px-5 py-4">
            <span className={cn('flex size-10 items-center justify-center rounded-full font-mono text-[11px] font-semibold', a.id === 'acc_cad' ? 'bg-accent text-accent-ink' : 'bg-white/[0.07] text-fg-2')}>{a.currency}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{a.label}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
                <span className="font-mono">{a.number}</span>
                {a.sponsor_funded && (
                  <>
                    <span>·</span>
                    <HeartHandshake className="size-3" /> from Dad
                  </>
                )}
              </div>
            </div>
            <div className="num text-right text-[16px] font-medium">{sym(a.balance, a.currency)}</div>
          </motion.div>
        ))}
        {credit && (
          <div className="flex items-center gap-3.5 px-5 py-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.07] text-fg-2">
              <CreditCard className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">Secured card</div>
              <div className="text-[12px] text-fg-3">
                <span className="font-mono">{credit.card.number}</span> · {Math.round(credit.utilization_pct)}% used
              </div>
            </div>
            <div className="num text-right text-[16px] font-medium">−{sym(credit.card.balance)}</div>
          </div>
        )}
      </Glass>

      <Glass className={cn('p-5', fz.frozen && 'border-warn/25')} transition={spring}>
        <div className="flex items-center gap-4">
          <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full transition-colors', fz.frozen ? 'bg-warn text-ink-1' : 'bg-white/[0.07] text-fg-2')}>
            {fz.frozen ? <Snowflake className="size-5" /> : <LockOpen className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold tracking-tight">{fz.frozen ? 'Payments frozen' : 'Freeze payments'}</div>
            <div className="text-[12.5px] leading-snug text-fg-3">
              {fz.frozen
                ? fz.sponsor_funded === 'sponsor' && !myLock
                  ? 'Dad locked the money he funds. Only he can unlock it.'
                  : 'Lost your phone or got a strange call? Nothing moves until you unlock.'
                : 'One tap stops every payment, including the assistant’s drafts.'}
            </div>
          </div>
          <Switch checked={fz.frozen} onChange={toggle} label="Freeze payments" tone="accent" disabled={busy || (fz.frozen && !myLock)} />
        </div>
      </Glass>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Single payment', overview.limits.single_cad],
          ['Per 24 hours', overview.limits.daily_cad],
        ].map(([k, v]) => (
          <Glass key={k} className="p-4">
            <Eyebrow>{k}</Eyebrow>
            <div className="num mt-2.5 text-[20px] font-medium tracking-[-0.03em]">{sym(Number(v), 'CAD', 0)}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-fg-3">
              <Lock className="size-3" /> set by Dad
            </div>
          </Glass>
        ))}
      </div>
    </div>
  );
}

function Budget() {
  const { overview } = useStore();
  if (!overview) return null;
  const b = overview.budget;
  const net = b.income_cad - b.total_spent_cad;
  return (
    <div className="space-y-4">
      <Glass className="p-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <Eyebrow>Last {b.period_days} days</Eyebrow>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="num text-[38px] leading-none font-medium tracking-[-0.045em]">{sym(b.total_spent_cad)}</span>
          <span className="text-[13px] text-fg-3">spent</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[13px]">
          <span className="num text-fg-3">{sym(b.income_cad)} in</span>
          <Chip tone={net >= 0 ? 'accent' : 'danger'}>
            <span className="num">
              {net >= 0 ? '+' : ''}
              {sym(net)} net
            </span>
          </Chip>
        </div>
      </Glass>
      <Glass className="p-5">
        <BudgetBars categories={b.categories} />
        {b.possible_duplicate_charges.length > 0 && (
          <div className="mt-5 flex items-center gap-2.5 rounded-tile border border-warn/15 bg-warn-dim px-3.5 py-3 text-[13px] text-warn">
            <Copy className="size-4 shrink-0" /> Possible double charge from {b.possible_duplicate_charges.join(', ')}. Worth checking.
          </div>
        )}
      </Glass>
      {overview.credit?.has_card && overview.credit.statement && (
        <p className="px-1 text-[12.5px] text-fg-3">
          Card statement {money(overview.credit.statement.balance)} is due {shortDate(overview.credit.statement.due_date)}.
        </p>
      )}
    </div>
  );
}

const STATUS: Record<string, { text: string; tone: 'accent' | 'warn' | 'danger' | 'neutral' }> = {
  executed: { text: 'Sent', tone: 'accent' },
  awaiting_user: { text: 'Needs you', tone: 'warn' },
  blocked: { text: 'Blocked', tone: 'danger' },
  awaiting_sponsor: { text: 'With Dad', tone: 'warn' },
  rejected: { text: 'Declined', tone: 'danger' },
  failed: { text: 'Failed', tone: 'danger' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' },
};

function Activity() {
  const { backend, overview } = useStore();
  const [actions, setActions] = useState<Action[] | null>(null);
  useEffect(() => {
    backend
      .actions()
      .then((r) => setActions(r.actions.slice().reverse()))
      .catch(() => setActions([]));
  }, [backend, overview]);

  return (
    <div className="space-y-6">
      {actions && actions.length > 0 && (
        <div>
          <Eyebrow className="mb-3 px-1">Payments</Eyebrow>
          <Glass className="divide-y divide-line p-0">
            {actions.slice(0, 6).map((a) => {
              const s = STATUS[a.status] ?? { text: a.status, tone: 'neutral' as const };
              return (
                <div key={a.action_id} className="flex items-center gap-3.5 px-4 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-fg-2">
                    <KindIcon a={a} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{a.params.payee_name ?? a.summary}</div>
                    <div className="text-[11.5px] text-fg-3">
                      {a.tier} · {timeAgo(a.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="num text-[14px] font-medium">{a.params.amount !== undefined ? sym(a.params.amount, a.params.currency ?? a.params.from_currency) : ''}</span>
                    <Chip tone={s.tone} className="h-5 px-2 text-[10.5px]">
                      {s.text}
                    </Chip>
                  </div>
                </div>
              );
            })}
          </Glass>
        </div>
      )}
      <LedgerPanel role="student" />
    </div>
  );
}
