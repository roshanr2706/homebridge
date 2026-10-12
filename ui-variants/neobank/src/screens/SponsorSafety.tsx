import { BellOff, BellRing, Minus, Plus, ShieldOff, Snowflake, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { TopBar } from '../components/Chrome';
import { LedgerPanel } from '../components/Ledger';
import { PinSheet } from '../components/PinSheet';
import { AnimatedNumber, Button, Chip, cn, Eyebrow, Glass, Segmented, Sheet, spring, Switch } from '../components/primitives';
import { clockTime, sym, timeAgo } from '../lib/format';
import { useStore } from '../lib/store';

export function SponsorSafety() {
  const { sponsor } = useStore();
  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-36">
      <TopBar eyebrow="Encik Rahman" title="Safety" />
      {sponsor && (
        <div className="space-y-8 px-5 pt-5">
          <EmergencyLock />
          <DigestPanel />
          <AlertsPanel />
          <LimitsPanel />
          <section>
            <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-[-0.02em]">Audit trail</h2>
            <LedgerPanel role="sponsor" />
          </section>
        </div>
      )}
    </div>
  );
}

function EmergencyLock() {
  const { sponsor, backend, refreshSponsor, refresh, toast } = useStore();
  const [scope, setScope] = useState<'sponsor_funded' | 'all'>('sponsor_funded');
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  if (!sponsor) return null;
  const fz = sponsor.freeze;
  const locked = fz.frozen;
  const what = fz.own && fz.sponsor_funded ? 'Everything' : fz.sponsor_funded ? 'Money you fund' : 'Aisha’s own money';
  const byAisha = fz.own === 'student' || fz.sponsor_funded === 'student';

  // Locking is instant and needs nothing; unlocking is a money decision, so it takes the sponsor PIN.
  async function toggle(v: boolean) {
    if (!v) {
      setPinOpen(true);
      return;
    }
    setBusy(true);
    try {
      await backend.sponsorFreeze(scope);
      toast('Payments locked', scope === 'all' ? 'Nothing can leave any of Aisha’s accounts.' : 'Nothing can leave the accounts you fund.', 'warn');
      await Promise.all([refreshSponsor(), refresh()]);
    } catch (e) {
      toast('Couldn’t lock', (e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function unlock(pin: string) {
    try {
      await backend.sponsorUnfreeze(pin);
      toast('Payments unlocked', 'Aisha can confirm payments again.');
      setTimeout(() => void Promise.all([refreshSponsor(), refresh()]), 900);
      return true;
    } catch (e) {
      toast('Still locked', (e as Error).message, 'danger');
      return false;
    }
  }

  return (
    <Glass layout className={cn('relative overflow-hidden p-5 transition-colors duration-500', locked && 'border-danger/30')} transition={spring}>
      <AnimatePresence>
        {locked && <motion.div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-danger/[0.16] via-danger/[0.05] to-transparent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      <div className="relative flex items-start gap-4">
        <motion.span
          animate={{ rotate: locked ? 180 : 0 }}
          transition={spring}
          className={cn('flex size-12 shrink-0 items-center justify-center rounded-full transition-colors', locked ? 'bg-danger text-ink-1' : 'bg-white/[0.07] text-fg-2')}
        >
          <Snowflake className="size-6" strokeWidth={2} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold tracking-tight">{locked ? 'Payments locked' : 'Emergency lock'}</div>
          <div className="mt-1 text-[13px] leading-snug text-fg-2">
            {locked
              ? `${what} is locked${fz.since ? ` since ${clockTime(fz.since)}` : ''}${byAisha ? ', partly by Aisha herself' : ''}. Drafts can’t be confirmed or approved.`
              : 'A strange call, a lost phone, a payment you don’t recognise: lock first, talk later.'}
          </div>
        </div>
        <Switch checked={locked} onChange={toggle} label="Emergency lock" tone="danger" disabled={busy} />
      </div>
      <AnimatePresence initial={false}>
        {!locked && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="relative overflow-hidden">
            <div className="pt-5">
              <Segmented
                label="Lock scope"
                value={scope}
                onChange={setScope}
                className="w-full"
                items={[
                  { value: 'sponsor_funded', label: 'Money I fund' },
                  { value: 'all', label: 'Everything' },
                ]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <PinSheet open={pinOpen} onOpenChange={setPinOpen} title="Unlock payments" description="Enter your sponsor PIN. Aisha will be able to confirm payments again." onSubmit={unlock} />
    </Glass>
  );
}

function DigestPanel() {
  const { sponsor } = useStore();
  if (!sponsor) return null;
  const d = sponsor.digest;
  const stats: [string, number, string?][] = [
    ['Drafted', d.drafted],
    ['Sent', d.executed, 'text-accent'],
    ['Waiting for you', d.awaiting_sponsor, d.awaiting_sponsor ? 'text-warn' : undefined],
    ['Stopped', d.stopped],
  ];
  return (
    <section>
      <div className="mb-3 flex items-end justify-between px-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Last {d.window_hours} hours</h2>
        <span className="num text-[12.5px] text-fg-3">{sym(d.money_out_cad, 'CAD', 0)} out</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(([k, v, c], i) => (
          <Glass key={k} className="p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: i * 0.05 }}>
            <AnimatedNumber value={v} format={(n) => String(Math.round(n))} className={cn('block text-[32px] leading-none font-medium tracking-[-0.04em]', c)} />
            <div className="mt-2 text-[12.5px] text-fg-3">{k}</div>
          </Glass>
        ))}
      </div>
      {d.flagged.length > 0 && (
        <Glass className="mt-3 divide-y divide-line p-0">
          {d.flagged.map((f) => (
            <div key={f.action_id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
              <span className="truncate">{f.summary}</span>
              <Chip tone="danger">risk {f.risk_score}</Chip>
            </div>
          ))}
        </Glass>
      )}
    </section>
  );
}

function AlertsPanel() {
  const { sponsor } = useStore();
  if (!sponsor) return null;
  return (
    <section>
      <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-[-0.02em]">Alerts</h2>
      {sponsor.alerts.length === 0 ? (
        <Glass className="flex items-center gap-3.5 p-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-fg-3">
            <BellOff className="size-4" />
          </span>
          <div>
            <div className="text-[14px] font-medium">Quiet</div>
            <div className="text-[12.5px] text-fg-3">No unusual activity in the last 24 hours.</div>
          </div>
        </Glass>
      ) : (
        <Glass className="divide-y divide-line p-0">
          {sponsor.alerts.map((a) => (
            <div key={a.id} className="flex gap-3.5 px-4 py-3.5">
              <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', a.weight >= 20 ? 'bg-danger-dim text-danger' : 'bg-warn-dim text-warn')}>
                {a.kind === 'student_freeze' ? <ShieldOff className="size-4" /> : <BellRing className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] leading-snug">{a.message}</div>
                <div className="mt-1 text-[11.5px] text-fg-3">
                  {timeAgo(a.ts)}
                  {a.weight > 0 && ` · +${a.weight} risk on new payments`}
                </div>
              </div>
            </div>
          ))}
        </Glass>
      )}
    </section>
  );
}

function LimitsPanel() {
  const { sponsor } = useStore();
  const { backend, refreshSponsor, refresh, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ s: number; d: number } | null>(null);
  if (!sponsor) return null;
  const ceiling = sponsor.kyc?.limit_ceiling;
  const single = sponsor.limits.single_cad;
  const daily = sponsor.limits.daily_cad;
  return (
    <section>
      <div className="mb-3 flex items-end justify-between px-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Aisha’s limits</h2>
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
          <SlidersHorizontal className="size-3.5" /> Edit
        </button>
      </div>
      <Glass className="grid grid-cols-2 divide-x divide-line p-0">
        {[
          ['Alone, per payment', single],
          ['Alone, per 24 hours', daily],
        ].map(([k, v]) => (
          <div key={k} className="p-4">
            <Eyebrow>{k}</Eyebrow>
            <AnimatedNumber value={Number(v)} format={(n) => sym(n, 'CAD', 0)} className="mt-2.5 block text-[22px] font-medium tracking-[-0.03em]" />
          </div>
        ))}
      </Glass>
      <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-fg-3">
        Anything above these, or paid from money you fund, comes to you. The assistant can’t change limits; only you can, here, with your PIN.
        {ceiling && sponsor.kyc && ` Aisha’s identity check (${sponsor.kyc.student.label.toLowerCase()}) caps them at ${sym(ceiling.single_cad, 'CAD', 0)} and ${sym(ceiling.daily_cad, 'CAD', 0)}.`}
      </p>
      <LimitsSheet
        open={open}
        onOpenChange={setOpen}
        single={single}
        daily={daily}
        ceiling={ceiling}
        onSave={(s, d) => {
          setOpen(false);
          setPending({ s, d });
        }}
      />
      <PinSheet
        open={pending !== null}
        onOpenChange={(v) => !v && setPending(null)}
        title="Confirm new limits"
        description={pending ? `${sym(pending.s, 'CAD', 0)} per payment · ${sym(pending.d, 'CAD', 0)} per 24 hours. Enter your sponsor PIN.` : ''}
        onSubmit={async (pin) => {
          if (!pending) return false;
          try {
            await backend.setLimits(pending.s, pending.d, pin);
            toast('Limits updated', `${sym(pending.s, 'CAD', 0)} per payment · ${sym(pending.d, 'CAD', 0)} per day`);
            setTimeout(() => void Promise.all([refreshSponsor(), refresh()]), 900);
            return true;
          } catch (e) {
            toast('Limits not changed', (e as Error).message, 'danger');
            setPending(null);
            return false;
          }
        }}
      />
    </section>
  );
}

function LimitsSheet({
  open,
  onOpenChange,
  single,
  daily,
  ceiling,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  single: number;
  daily: number;
  ceiling?: { single_cad: number; daily_cad: number };
  onSave: (s: number, d: number) => void;
}) {
  const [s, setS] = useState(single);
  const [d, setD] = useState(daily);
  useEffect(() => {
    if (open) {
      setS(single);
      setD(daily);
    }
  }, [open, single, daily]);
  const bad = s > d;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit limits" description="What Aisha can confirm without you.">
      <Stepper label="Per payment" value={s} step={250} min={250} max={ceiling?.single_cad ?? 20000} onChange={setS} />
      <Stepper label="Per 24 hours" value={d} step={500} min={500} max={ceiling?.daily_cad ?? 50000} onChange={setD} />
      {bad && <p className="mt-2 text-[12.5px] text-danger">The per-payment limit can’t be higher than the 24-hour limit.</p>}
      <Button
        className="mt-6 w-full"
        disabled={bad || (s === single && d === daily)}
        onClick={() => onSave(s, d)}
      >
        Continue
      </Button>
    </Sheet>
  );
}

function Stepper({ label, value, step, min, max, onChange }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-4">
      <div>
        <div className="text-[13px] text-fg-3">{label}</div>
        <AnimatedNumber value={value} format={(n) => sym(n, 'CAD', 0)} className="mt-1 block text-[26px] font-medium tracking-[-0.035em]" />
      </div>
      <div className="flex gap-2">
        {[
          [Minus, -step],
          [Plus, step],
        ].map(([Icon, delta], i) => {
          const I = Icon as typeof Plus;
          const next = value + (delta as number);
          return (
            <motion.button
              key={i}
              whileTap={{ scale: 0.88 }}
              disabled={next < min || next > max}
              onClick={() => onChange(next)}
              aria-label={`${(delta as number) > 0 ? 'Increase' : 'Decrease'} ${label}`}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-white/[0.05] disabled:opacity-30"
            >
              <I className="size-4" />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
