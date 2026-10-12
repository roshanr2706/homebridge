import { AlertTriangle, ArrowLeftRight, Ban, Check, ChevronDown, Clock, Lock, Send, ShieldAlert, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { money, sym } from '../lib/format';
import { useStore } from '../lib/store';
import type { Action } from '../lib/types';
import { Chip, cn, Eyebrow, Glass, HeroMoney, spring } from './primitives';
import { SwipeToConfirm } from './SwipeToConfirm';

export const KIND: Record<string, string> = {
  transfer: 'Payment',
  conversion: 'Conversion',
  add_payee: 'New payee',
  topup: 'Top-up request',
};

export const TIER: Record<string, { short: string; long: string }> = {
  T1: { short: 'Sponsor decides', long: 'Your sponsor decides' },
  T2: { short: 'You confirm', long: 'Only you need to confirm' },
  T3: { short: 'You + Dad', long: 'You confirm, then Dad approves' },
};

export const isMove = (a: Action) => a.kind === 'conversion' && a.params.from_currency === a.params.to_currency;

export function KindIcon({ a, className }: { a: Action; className?: string }) {
  const I = a.kind === 'transfer' ? Send : a.kind === 'conversion' ? ArrowLeftRight : a.kind === 'add_payee' ? UserPlus : Users;
  return <I className={className} strokeWidth={2} />;
}

export function headline(a: Action): { amount?: number; currency?: string; text?: string; sub?: string } {
  const p = a.params;
  if (a.kind === 'transfer') return { amount: p.amount, currency: p.currency, sub: `to ${p.payee_name}` };
  if (a.kind === 'conversion')
    return {
      amount: p.amount,
      currency: p.from_currency,
      sub: isMove(a) ? a.summary.replace(/^Move [^ ]+ [^ ]+ /, '') : `→ about ${money(p.expected_receive, p.to_currency)}`,
    };
  if (a.kind === 'topup') return { amount: p.amount, currency: p.currency, sub: p.reason ? `for ${p.reason}` : undefined };
  if (a.kind === 'add_payee') return { text: p.name, sub: `${p.kind} · ${p.currency} · ${p.number_masked}` };
  return { text: a.summary };
}

export function details(a: Action): [string, string][] {
  const p = a.params;
  if (a.kind === 'transfer') {
    const rows: [string, string][] = [['From', p.from_account]];
    if (p.memo) rows.push(['Memo', p.memo]);
    return rows;
  }
  if (isMove(a)) return [['Fee', 'None, between your accounts']];
  if (a.kind === 'conversion')
    return [
      ['Rate', `${p.rate} ${p.to_currency}/${p.from_currency}`],
      ['You receive', money(p.expected_receive, p.to_currency)],
      ['Into', p.to_account_id === 'acc_tui' ? 'CAD Tuition Fund' : p.to_account_id === 'acc_cad' ? 'CAD Everyday' : p.to_account_id],
    ];
  return [];
}

type Step = { label: string; state: 'done' | 'current' | 'todo' | 'bad' };

export function steps(a: Action, mode: 'student' | 'sponsor'): Step[] {
  const bad = ['rejected', 'cancelled', 'expired', 'failed', 'blocked'].includes(a.status);
  const out: Step[] = [{ label: 'Drafted', state: 'done' }];
  if (a.kind !== 'topup')
    out.push({
      label: mode === 'sponsor' ? 'Aisha confirmed' : 'You confirm',
      state: a.user_confirmed ? 'done' : a.status === 'awaiting_user' ? 'current' : bad ? 'bad' : 'todo',
    });
  if (a.needs_sponsor_approval)
    out.push({
      label: mode === 'sponsor' ? 'You approve' : 'Dad approves',
      state:
        a.sponsor_decision === 'approved'
          ? 'done'
          : a.sponsor_decision === 'rejected'
            ? 'bad'
            : a.status === 'awaiting_sponsor'
              ? 'current'
              : bad && a.user_confirmed
                ? 'bad'
                : 'todo',
    });
  out.push({
    label: a.status === 'failed' ? 'Failed' : a.status === 'blocked' ? 'Blocked' : 'Done',
    state: a.status === 'executed' ? 'done' : a.status === 'failed' || a.status === 'blocked' ? 'bad' : 'todo',
  });
  return out;
}

export function Timeline({ items }: { items: Step[] }) {
  return (
    <div className="mt-5">
      <div className="flex items-center">
        {items.map((s, i) => (
          <div key={s.label} className={cn('flex items-center', i < items.length - 1 && 'flex-1')}>
            <motion.span
              layout
              className={cn(
                'relative flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
                s.state === 'done' && 'border-accent bg-accent text-accent-ink',
                s.state === 'current' && 'border-warn',
                s.state === 'bad' && 'border-danger bg-danger text-ink-1',
                s.state === 'todo' && 'border-white/15',
              )}
            >
              {s.state === 'done' && <Check className="size-2.5" strokeWidth={3.5} />}
              {s.state === 'bad' && <X className="size-2.5" strokeWidth={3.5} />}
              {s.state === 'current' && (
                <>
                  <span className="size-1.5 rounded-full bg-warn" />
                  <motion.span className="absolute inset-[-4px] rounded-full border border-warn/60" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }} />
                </>
              )}
            </motion.span>
            {i < items.length - 1 && (
              <div className="mx-1 h-[1.5px] flex-1 overflow-hidden rounded bg-white/10">
                <motion.div className="h-full bg-accent" initial={false} animate={{ width: s.state === 'done' ? '100%' : '0%' }} transition={{ duration: 0.6, ease: 'easeOut' }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex">
        {items.map((s, i) => (
          <span
            key={s.label}
            className={cn(
              'flex-1 text-[11px]',
              i === 0 ? 'text-left' : i === items.length - 1 ? 'text-right' : 'text-center',
              s.state === 'current' ? 'font-semibold text-warn' : s.state === 'bad' ? 'text-danger' : s.state === 'done' ? 'text-fg-2' : 'text-fg-3',
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function useCountdown(until: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.max(0, Math.round(until - now));
}

export function ReasonList({ title, items, tone }: { title: string; items: string[]; tone: 'neutral' | 'warn' | 'danger' }) {
  if (!items.length) return null;
  const Icon = tone === 'danger' ? ShieldAlert : tone === 'warn' ? AlertTriangle : Users;
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg-2';
  return (
    <div className={cn('mt-4 rounded-tile border p-3.5', tone === 'danger' ? 'border-danger/20 bg-danger-dim' : tone === 'warn' ? 'border-warn/15 bg-warn-dim' : 'border-line bg-white/[0.03]')}>
      <div className={cn('flex items-center gap-2 text-[12.5px] font-semibold', color)}>
        <Icon className="size-3.5" strokeWidth={2.25} /> {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((r) => (
          <li key={r} className="flex gap-2 text-[13px] leading-snug text-fg-2">
            <span className={cn('mt-[7px] size-1 shrink-0 rounded-full', tone === 'neutral' ? 'bg-fg-3' : tone === 'warn' ? 'bg-warn' : 'bg-danger')} />
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compliance screening on a draft: one quiet line when clear, expandable to every check; loud when blocked. */
export function ComplianceStrip({ a }: { a: Action }) {
  const [open, setOpen] = useState(false);
  const c = a.compliance;
  if (!c) return null;
  const checks = c.checks ?? [];
  const flagged = checks.filter((k) => k.status !== 'pass');
  if (c.blocked || a.status === 'blocked')
    return <ReasonList title="Blocked by compliance screening" items={[c.block_reason ?? 'This payment cannot be confirmed or approved.', ...flagged.map((k) => k.detail)]} tone="danger" />;
  if (!checks.length && !c.notes?.length) return null;
  return (
    <div className="mt-4 rounded-tile border border-line bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left">
        <ShieldCheck className={cn('size-4 shrink-0', flagged.length ? 'text-warn' : 'text-accent')} strokeWidth={2.25} />
        <span className="flex-1 text-[12.5px] text-fg-2">
          <span className="font-semibold text-fg">Compliance {flagged.length ? 'flagged' : 'clear'}</span>
          {checks.length > 0 && ` · ${checks.length - flagged.length}/${checks.length} checks passed`}
          {c.purpose_code && <span className="font-mono text-fg-3"> · {c.purpose_code}</span>}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring}>
          <ChevronDown className="size-4 text-fg-3" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
            {(checks.length ? checks : (c.notes ?? []).map((n, i) => ({ id: String(i), label: 'Note', status: 'flag', detail: n }))).map((k) => (
              <li key={k.id} className="flex gap-2.5 border-t border-line px-3.5 py-2.5">
                <span className={cn('mt-[6px] size-1.5 shrink-0 rounded-full', k.status === 'pass' ? 'bg-accent' : k.status === 'block' ? 'bg-danger' : 'bg-warn')} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">{k.label}</span>
                  <span className="block text-[11.5px] leading-snug text-fg-3">{k.detail}</span>
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

const STATUS: Record<string, { text: string; tone: 'accent' | 'warn' | 'danger' | 'neutral' }> = {
  blocked: { text: 'Blocked by compliance', tone: 'danger' },
  executed: { text: 'Sent', tone: 'accent' },
  awaiting_sponsor: { text: 'Waiting for Dad', tone: 'warn' },
  rejected: { text: 'Declined by Dad', tone: 'danger' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' },
  failed: { text: 'Failed', tone: 'danger' },
};

/** The student's confirmation card: what, tier, why it needs Dad, swipe to confirm. */
export function ActionCard({ action: a }: { action: Action }) {
  const { backend, updateAction, refresh, refreshSponsor, toast } = useStore();
  const [cancelling, setCancelling] = useState(false);
  const live = a.status === 'awaiting_user';
  const left = useCountdown(a.expires_at, live);
  const expired = live && left === 0;
  const h = headline(a);
  const tier = TIER[a.tier] ?? { short: a.tier, long: a.tier };
  const sponsorWhy = a.sponsor_reasons ?? [];
  const signals = a.risk_signals ?? a.risk_reasons.filter((r) => !sponsorWhy.includes(r));
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));
  const status = STATUS[a.status];

  async function confirm(): Promise<boolean> {
    if (!a.confirm_token) {
      toast('Can’t confirm here', 'This draft has no confirmation token.', 'danger');
      return false;
    }
    try {
      const res = await backend.confirm(a.action_id, a.confirm_token);
      updateAction(res);
      if (res.status === 'executed') toast('Done', `${a.summary}.`);
      else if (res.status === 'awaiting_sponsor') toast('Sent to Dad', 'He’ll get it in his approvals.', 'warn');
      else if (res.status === 'failed') toast('Didn’t go through', res.result?.error, 'danger');
      void refresh();
      void refreshSponsor();
      return true;
    } catch (e) {
      toast('Not confirmed', (e as Error).message, 'danger');
      return false;
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      updateAction(await backend.cancel(a.action_id));
      void refresh();
    } catch (e) {
      toast('Couldn’t cancel', (e as Error).message, 'danger');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Glass initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-accent/[0.07] blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-white/[0.07] text-fg">
            <KindIcon a={a} className="size-4" />
          </span>
          <Eyebrow>{KIND[a.kind] ?? a.kind}</Eyebrow>
        </div>
        <Chip tone={a.tier === 'T3' ? 'warn' : 'neutral'}>
          <span className="font-mono text-[10.5px] opacity-70">{a.tier}</span> {tier.short}
        </Chip>
      </div>

      <div className="mt-5">
        {h.amount !== undefined ? <HeroMoney value={h.amount} currency={h.currency ?? 'CAD'} size="lg" /> : <div className="text-[26px] font-semibold tracking-tight">{h.text}</div>}
        {h.sub && <div className="mt-1.5 text-[15px] text-fg-2">{h.sub}</div>}
      </div>

      {details(a).length > 0 && (
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {details(a).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-[13.5px]">
              <dt className="text-fg-3">{k}</dt>
              <dd className="num text-right text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <ReasonList title="Why Dad approves this too" items={sponsorWhy} tone="neutral" />
      <ReasonList title="Risk signals" items={signals} tone="danger" />
      <ReasonList title="Heads up" items={warnings} tone="warn" />
      <ComplianceStrip a={a} />

      <Timeline items={steps(a, 'student')} />

      <div className="mt-5">
        {live && !expired ? (
          <>
            <SwipeToConfirm
              label={a.needs_sponsor_approval ? 'Swipe to confirm & send to Dad' : `Swipe to pay ${h.amount !== undefined ? sym(h.amount, h.currency) : ''}`}
              onConfirm={confirm}
              disabled={Boolean(a.frozen)}
              disabledLabel="Payments are locked"
            />
            <div className="mt-3 flex items-center justify-between px-1 text-[12.5px]">
              <span className="num flex items-center gap-1.5 text-fg-3">
                <Clock className="size-3.5" /> Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
              <button onClick={cancel} disabled={cancelling} className="font-medium text-fg-2 hover:text-fg disabled:opacity-50">
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </>
        ) : expired ? (
          <div className="flex items-center gap-2 text-[13.5px] text-fg-3">
            <Clock className="size-4" /> This draft expired. Ask again to redraft it.
          </div>
        ) : status ? (
          <div className="flex items-center gap-2">
            <Chip tone={status.tone} icon={a.status === 'executed' ? <Check className="size-3" strokeWidth={3} /> : a.status === 'awaiting_sponsor' ? <Clock className="size-3" /> : a.status === 'blocked' ? <Ban className="size-3" /> : <X className="size-3" />}>
              {status.text}
            </Chip>
            {a.status === 'failed' && a.result?.error && <span className="text-[12.5px] text-fg-3">{String(a.result.error)}</span>}
          </div>
        ) : null}
        {a.frozen && live && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-3">
            <Lock className="size-3" /> {a.frozen}
          </p>
        )}
      </div>
    </Glass>
  );
}
