import { Fingerprint, ShieldCheck, ShieldX } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

import { clockTime, titleCase } from '../lib/format';
import { useStore } from '../lib/store';
import type { AuditEntry, Role, Verify } from '../lib/types';
import { cn, Eyebrow, Glass, spring, Spinner } from './primitives';

const EVENT: Record<string, string> = {
  user_message: 'Message to assistant',
  compliance_check: 'Compliance screened',
  sponsor_pin_failed: 'Wrong sponsor PIN',
  sponsor_pin_locked: 'Sponsor PIN locked',
  assistant_reply: 'Assistant replied',
  action_drafted: 'Draft created',
  action_confirmed: 'Confirmed by Aisha',
  sponsor_approval_requested: 'Sent to sponsor',
  sponsor_approved: 'Approved by sponsor',
  sponsor_rejected: 'Declined by sponsor',
  sponsor_denied: 'Sponsor action refused',
  action_executed: 'Money moved',
  action_failed: 'Execution failed',
  action_cancelled: 'Draft cancelled',
  action_expired: 'Draft expired',
  alert_raised: 'Safety alert',
  limits_changed: 'Limits changed',
  demo_reset: 'Demo reset',
  rate_limited: 'Rate limited',
  freeze: 'Payments locked',
  unfreeze: 'Payments unlocked',
};

const ACTOR: Record<string, string> = { aisha: 'Aisha', rahman: 'Encik Rahman', agent: 'Assistant', system: 'System' };

function describe(e: AuditEntry) {
  if (e.event === 'tool_call') return { title: `Tool · ${e.data.tool}`, sub: e.data.tier ? `tier ${e.data.tier}` : '' };
  const title = EVENT[e.event] ?? titleCase(e.event);
  const sub = e.data.action_id ? String(e.data.action_id) : e.data.kind ? String(e.data.kind) : '';
  return { title, sub };
}

const MONEY_EVENTS = new Set(['compliance_check', 'sponsor_pin_failed', 'sponsor_pin_locked', 'action_executed', 'action_failed', 'sponsor_approved', 'sponsor_rejected', 'action_confirmed', 'alert_raised', 'freeze', 'unfreeze', 'limits_changed']);

/** Tamper-evident audit chain: each entry hashes the previous one. Verify runs on the server. */
export function LedgerPanel({ role }: { role: Role }) {
  const { backend } = useStore();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [checking, setChecking] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    const [a, v] = await Promise.all([backend.audit(role), backend.auditVerify(role)]);
    setEntries(a.entries);
    setVerify(v);
  }, [backend, role]);

  useEffect(() => {
    void load().catch(() => setEntries([]));
  }, [load]);

  async function tamper() {
    if (!entries?.length) return;
    setChecking(true);
    const seq = entries[Math.floor(entries.length / 2)].seq;
    try {
      setVerify(await backend.auditVerify(role, seq));
      setTimeout(async () => setVerify(await backend.auditVerify(role)), 4200);
    } finally {
      setChecking(false);
    }
  }

  const shown = (entries ?? []).slice().reverse().filter((e) => all || MONEY_EVENTS.has(e.event) || e.event === 'action_drafted');

  return (
    <div className="space-y-4">
      <Glass className="overflow-hidden p-0" layout>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={verify ? (verify.ok ? 'ok' : `bad-${verify.broken_at}`) : 'loading'}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className={cn('flex items-center gap-4 p-5', verify && !verify.ok && 'bg-danger-dim')}
          >
            <span className={cn('relative flex size-12 shrink-0 items-center justify-center rounded-full', !verify ? 'bg-white/[0.06]' : verify.ok ? 'bg-accent text-accent-ink' : 'bg-danger text-ink-1')}>
              {!verify ? <Spinner /> : verify.ok ? <ShieldCheck className="size-6" strokeWidth={2.25} /> : <ShieldX className="size-6" strokeWidth={2.25} />}
              {verify?.ok && <motion.span className="absolute inset-0 rounded-full border-2 border-accent" initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 1.2 }} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold tracking-tight">
                {!verify ? 'Verifying ledger…' : verify.ok ? 'Audit chain verified' : `Tamper detected at #${verify.broken_at}`}
              </div>
              <div className="mt-0.5 truncate text-[12.5px] text-fg-3">
                {verify && (
                  <>
                    <span className="num">{verify.count}</span> entries · SHA-256 hash chain
                    {verify.ok && verify.head && <span className="font-mono"> · {verify.head.slice(0, 8)}</span>}
                    {verify.simulated_tamper_seq !== undefined && ' · simulated edit'}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
        <button onClick={tamper} disabled={checking || !verify?.ok} className="flex w-full items-center justify-center gap-2 border-t border-line py-3 text-[13px] font-medium text-fg-2 hover:text-fg disabled:opacity-40">
          <Fingerprint className="size-4" /> Simulate a tampered entry
        </button>
      </Glass>

      <div className="flex items-center justify-between px-1">
        <Eyebrow>Ledger</Eyebrow>
        <button onClick={() => setAll((v) => !v)} className="text-[12.5px] font-medium text-fg-2 hover:text-fg">
          {all ? 'Money events only' : 'Show every event'}
        </button>
      </div>

      {!entries ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-1 text-[13.5px] text-fg-3">Nothing recorded yet.</p>
      ) : (
        <ol className="relative">
          <span className="absolute top-3 bottom-3 left-[15px] w-px bg-line-strong" aria-hidden />
          {shown.slice(0, 40).map((e, i) => {
            const d = describe(e);
            const money = e.event === 'action_executed';
            const bad = ['sponsor_pin_failed', 'sponsor_pin_locked', 'action_failed', 'sponsor_rejected', 'alert_raised', 'sponsor_denied'].includes(e.event);
            const broken = verify && !verify.ok && verify.broken_at === e.seq;
            return (
              <motion.li key={e.seq} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: Math.min(i, 12) * 0.025 }} className="relative flex gap-3.5 py-2.5">
                <span className={cn('relative z-10 mt-1 flex size-[31px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold', broken ? 'border-danger bg-danger text-ink-1' : money ? 'border-accent/40 bg-ink-1 text-accent' : bad ? 'border-danger/40 bg-ink-1 text-danger' : 'border-line-strong bg-ink-1 text-fg-3')}>
                  <span className="num">{e.seq}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-[14px] font-medium', broken && 'text-danger')}>{d.title}</span>
                    <span className="num shrink-0 text-[11.5px] text-fg-3">{clockTime(e.ts)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-fg-3">
                    <span>{ACTOR[e.actor] ?? e.actor}</span>
                    {d.sub && <span className="truncate font-mono">{d.sub}</span>}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-fg-3/70">
                    {e.prev.slice(0, 6)} → {e.hash.slice(0, 10)}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
