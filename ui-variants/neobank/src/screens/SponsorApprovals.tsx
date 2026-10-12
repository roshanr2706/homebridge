import { CircleCheckBig, Clock, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useState } from 'react';

import { ComplianceStrip, details, headline, KIND, KindIcon, ReasonList, steps, Timeline, TIER, useCountdown } from '../components/ActionCard';
import { Avatar, TopBar } from '../components/Chrome';
import { PinSheet } from '../components/PinSheet';
import { Button, Chip, cn, Eyebrow, Glass, HeroMoney, Sheet, spring } from '../components/primitives';
import { money, sym, timeAgo } from '../lib/format';
import { useStore } from '../lib/store';
import type { Action } from '../lib/types';

export function SponsorApprovals() {
  const { sponsor, queue } = useStore();
  const funded = sponsor?.accounts.filter((a) => a.sponsor_funded).length ?? 0;
  const decided = (sponsor?.recent ?? []).filter((a) => !['awaiting_user', 'awaiting_sponsor'].includes(a.status)).reverse();

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-36">
      <TopBar eyebrow="Sponsor" title="Encik Rahman" />

      <section className="px-5 pt-5">
        <div className="flex items-center gap-2.5">
          <Avatar role="student" size={24} />
          <Eyebrow>Money you fund for Aisha</Eyebrow>
        </div>
        {sponsor && (
          <>
            <div className="mt-4">
              <HeroMoney value={sponsor.total_cad} currency="CAD" />
            </div>
            <div className="mt-2.5 text-[13.5px] text-fg-3">
              {sponsor.accounts.map((a) => a.label).join(' · ') || `${funded} accounts`}
              {sponsor.freeze.frozen && <span className="text-warn"> · payments locked</span>}
            </div>
          </>
        )}
      </section>

      <section className="mt-9 px-5">
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Waiting for you</h2>
          {queue.length > 0 && <span className="num flex h-6 min-w-6 items-center justify-center rounded-full bg-warn px-2 text-[12px] font-bold text-ink-1">{queue.length}</span>}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          {queue.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
              <Glass className="flex flex-col items-center px-6 py-10 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-accent-dim text-accent">
                  <CircleCheckBig className="size-7" strokeWidth={2} />
                </span>
                <div className="mt-4 text-[18px] font-semibold tracking-tight">All clear</div>
                <p className="mt-1 max-w-[260px] text-[13.5px] leading-relaxed text-fg-3">
                  Nothing needs you. Payments over Aisha’s limits, from money you fund, or that look risky will appear here.
                </p>
              </Glass>
            </motion.div>
          ) : (
            queue.map((a) => (
              <motion.div key={a.action_id} layout exit={{ opacity: 0, x: 80, transition: { duration: 0.25 } }} className="mb-3">
                <ApprovalCard a={a} />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </section>

      {sponsor?.sharing && (
        <p className="mt-6 px-6 text-[12px] leading-relaxed text-fg-3">
          <span className="font-semibold text-fg-2">What you can see.</span> {sponsor.sharing.summary.replace(/^Your sponsor sees/, 'You see').replace(/\byour /g, 'her ')}
        </p>
      )}

      {decided.length > 0 && (
        <section className="mt-9 px-5">
          <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-[-0.02em]">Recent</h2>
          <Glass className="divide-y divide-line p-0">
            {decided.slice(0, 6).map((a) => (
              <RecentRow key={a.action_id} a={a} />
            ))}
          </Glass>
        </section>
      )}
    </div>
  );
}

const RECENT: Record<string, { text: string; tone: 'accent' | 'warn' | 'danger' | 'neutral' }> = {
  executed: { text: 'Sent', tone: 'accent' },
  rejected: { text: 'You declined', tone: 'danger' },
  blocked: { text: 'Blocked', tone: 'danger' },
  failed: { text: 'Failed', tone: 'danger' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
  expired: { text: 'Expired', tone: 'neutral' },
};

function RecentRow({ a }: { a: Action }) {
  const h = headline(a);
  const s = RECENT[a.status] ?? { text: a.status, tone: 'neutral' as const };
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-fg-2">
        <KindIcon a={a} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{a.params.payee_name ?? KIND[a.kind]}</div>
        <div className="truncate text-[11.5px] text-fg-3">{a.status === 'failed' && a.result?.error ? String(a.result.error) : `${a.tier} · ${timeAgo(a.created_at)}`}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {h.amount !== undefined && <span className="num text-[14px] font-medium">{sym(h.amount, h.currency)}</span>}
        <Chip tone={s.tone} className="h-5 px-2 text-[10.5px]">
          {s.text}
        </Chip>
      </div>
    </div>
  );
}

function ApprovalCard({ a }: { a: Action }) {
  const { backend, refresh, refreshSponsor, toast } = useStore();
  const [pinOpen, setPinOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const left = useCountdown(a.expires_at, true);
  const h = headline(a);
  const why = a.sponsor_reasons?.length ? a.sponsor_reasons : a.risk_reasons;
  const signals = a.risk_signals ?? [];
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));
  const hours = Math.floor(left / 3600);
  const mins = Math.floor((left % 3600) / 60);

  const approve = useCallback(
    async (pin: string) => {
      try {
        const res = await backend.approve(a.action_id, '', pin);
        if (res.status === 'executed') toast('Approved and sent', `${money(h.amount ?? 0, h.currency)} ${h.sub ?? ''}`);
        else if (res.status === 'failed') toast('Approved, but it didn’t go through', String(res.result?.error ?? ''), 'danger');
        else toast('Approved', a.summary);
        // Refresh after the PIN sheet has shown its tick and closed; the card leaves the queue then.
        setTimeout(() => void Promise.all([refreshSponsor(), refresh()]), 1100);
        return true;
      } catch (e) {
        toast('Not approved', (e as Error).message, 'danger');
        return false;
      }
    },
    [backend, a, h, toast, refresh, refreshSponsor],
  );

  return (
    <Glass className="relative overflow-hidden p-5" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="pointer-events-none absolute -top-24 -left-16 size-56 rounded-full bg-warn/[0.06] blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar role="student" size={30} />
          <div>
            <div className="text-[13.5px] font-semibold">Aisha confirmed</div>
            <div className="text-[11.5px] text-fg-3">{timeAgo(a.created_at)}</div>
          </div>
        </div>
        <Chip tone="warn">
          <span className="font-mono text-[10.5px] opacity-70">{a.tier}</span> {TIER[a.tier]?.short ?? a.tier}
        </Chip>
      </div>

      <div className="relative mt-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Eyebrow className="mb-2.5 flex items-center gap-1.5">
            <KindIcon a={a} className="size-3" /> {KIND[a.kind]}
          </Eyebrow>
          {h.amount !== undefined ? <HeroMoney value={h.amount} currency={h.currency ?? 'CAD'} size="lg" /> : <div className="text-[24px] font-semibold">{h.text}</div>}
          {h.sub && <div className="mt-1.5 text-[15px] text-fg-2">{h.sub}</div>}
        </div>
      </div>

      {details(a).length > 0 && (
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {details(a).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-[13.5px]">
              <dt className="text-fg-3">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <ReasonList title="Why this came to you" items={why} tone="neutral" />
      <ReasonList title="Risk signals" items={signals} tone="danger" />
      <ReasonList title="Before you approve" items={warnings} tone="warn" />
      <ComplianceStrip a={a} />

      <Timeline items={steps(a, 'sponsor')} />

      <div className="mt-5 grid grid-cols-[1fr_1.6fr] gap-2.5">
        <Button variant="secondary" onClick={() => setRejectOpen(true)}>
          Decline
        </Button>
        <Button onClick={() => setPinOpen(true)} disabled={Boolean(a.frozen)}>
          Approve
        </Button>
      </div>
      <div className={cn('mt-3 flex items-center justify-center gap-1.5 text-[12px]', a.frozen ? 'text-warn' : 'text-fg-3')}>
        <Clock className="size-3.5" />
        {a.frozen ? 'Payments are locked. Unlock in Safety to approve.' : <span className="num">Expires in {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}</span>}
      </div>

      <PinSheet
        open={pinOpen}
        onOpenChange={setPinOpen}
        title={`Approve ${h.amount !== undefined ? money(h.amount, h.currency) : KIND[a.kind]}`}
        description={`Enter your sponsor PIN to approve ${h.sub ?? a.summary}.`}
        onSubmit={approve}
      />
      <RejectSheet open={rejectOpen} onOpenChange={setRejectOpen} a={a} />
    </Glass>
  );
}

const NOTES = ['Let’s talk first', 'Not this month', 'Amount looks wrong'];

function RejectSheet({ open, onOpenChange, a }: { open: boolean; onOpenChange: (v: boolean) => void; a: Action }) {
  const { backend, refresh, refreshSponsor, toast } = useStore();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Decline this payment?" description={`${a.summary}. Aisha sees your note.`}>
      <div className="flex flex-wrap gap-2">
        {NOTES.map((n) => (
          <button key={n} onClick={() => setNote(n)} className={cn('h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors', note === n ? 'border-fg bg-fg text-ink-1' : 'border-line bg-white/[0.04] text-fg-2')}>
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 200))}
        placeholder="Add a note (optional)"
        rows={3}
        className="mt-4 w-full resize-none rounded-tile border border-line bg-white/[0.03] p-3.5 text-[14.5px] text-fg outline-none placeholder:text-fg-3 focus:border-line-strong"
      />
      <Button
        variant="danger"
        className="mt-4 w-full"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await backend.reject(a.action_id, note);
            toast('Declined', 'Aisha has been told. Nothing was sent.', 'warn');
            onOpenChange(false);
            setTimeout(() => void Promise.all([refreshSponsor(), refresh()]), 450);
          } catch (e) {
            toast('Couldn’t decline', (e as Error).message, 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        <X className="size-4" /> Decline payment
      </Button>
    </Sheet>
  );
}
