import { Check, CircleAlert, Database, RotateCcw, TriangleAlert, Wifi } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';

import { useStore } from '../lib/store';
import type { Role } from '../lib/types';
import { Button, Chip, cn, Eyebrow, Sheet, spring } from './primitives';

const PEOPLE: Record<Role, { name: string; initials: string; line: string }> = {
  student: { name: 'Aisha Rahman', initials: 'AR', line: 'Student · UBC, Vancouver' },
  sponsor: { name: 'Encik Rahman', initials: 'ER', line: 'Sponsor · Kuala Lumpur' },
};

export function Avatar({ role, size = 36 }: { role: Role; size?: number }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight text-ink-1',
        role === 'student' ? 'bg-gradient-to-br from-[#e8ffb0] to-accent' : 'bg-gradient-to-br from-white to-[#b9c0cc]',
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {PEOPLE[role].initials}
    </span>
  );
}

export function DataChip() {
  const { backend } = useStore();
  return backend.mode === 'live' ? (
    <Chip tone="accent" icon={<span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}>Live</Chip>
  ) : (
    <Chip tone="warn" icon={<Database className="size-3" />}>Demo data</Chip>
  );
}

/** Screen header: eyebrow + title on the left; data source and the profile switcher on the right. */
export function TopBar({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  const { role } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <header className="flex items-center justify-between gap-3 px-5 pt-[calc(var(--sat)+14px)] pb-2">
      <div className="min-w-0">
        {eyebrow && <div className="text-[13px] text-fg-3">{eyebrow}</div>}
        <h1 className="truncate text-[24px] font-semibold tracking-[-0.03em]">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {right}
        <DataChip />
        <motion.button whileTap={{ scale: 0.92 }} transition={spring} onClick={() => setOpen(true)} aria-label="Switch profile" className="rounded-full ring-1 ring-white/10 ring-offset-2 ring-offset-ink-1">
          <Avatar role={role} />
        </motion.button>
      </div>
      <ProfileSheet open={open} onOpenChange={setOpen} />
    </header>
  );
}

function ProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { role, setRole, backend, resetDemo } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Switch profile" description="Both people share one HomeBridge household. Each signs in with their own token.">
      <div className="space-y-2">
        {(['student', 'sponsor'] as Role[]).map((r) => (
          <motion.button
            key={r}
            whileTap={{ scale: 0.985 }}
            onClick={() => {
              setRole(r);
              onOpenChange(false);
            }}
            className={cn('flex w-full items-center gap-4 rounded-card border p-4 text-left transition-colors', role === r ? 'border-accent/30 bg-accent/[0.06]' : 'border-line bg-white/[0.02] hover:bg-white/[0.04]')}
          >
            <Avatar role={r} size={44} />
            <div className="flex-1">
              <div className="text-[16px] font-semibold tracking-tight">{PEOPLE[r].name}</div>
              <div className="text-[13px] text-fg-3">{PEOPLE[r].line}</div>
            </div>
            {role === r && (
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            )}
          </motion.button>
        ))}
      </div>

      <div className="mt-6 rounded-card border border-line bg-white/[0.02] p-4">
        <Eyebrow>Data source</Eyebrow>
        <div className="mt-3 flex items-start gap-3 text-[13.5px] leading-snug">
          {backend.mode === 'live' ? <Wifi className="mt-0.5 size-4 shrink-0 text-accent" /> : <Database className="mt-0.5 size-4 shrink-0 text-warn" />}
          <span className="text-fg-2">
            {backend.mode === 'live'
              ? 'Live HomeBridge API on localhost:8000 through the dev proxy. Every action is real in the sandbox.'
              : 'The API on localhost:8000 did not answer, so this is a replay of responses captured from the real backend. Start the server and reload for the live agent.'}
          </span>
        </div>
      </div>

      <Button
        variant="secondary"
        className="mt-4 w-full"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          await resetDemo();
          setBusy(false);
          onOpenChange(false);
        }}
      >
        <RotateCcw className="size-4" /> Reset demo
      </Button>
    </Sheet>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--sat)+8px)] z-[60] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            transition={spring}
            role="status"
            className="glass-bar flex w-full max-w-[358px] items-start gap-3 rounded-[22px] px-4 py-3 shadow-[0_20px_40px_-16px_rgb(0_0_0/0.9)]"
          >
            <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', t.tone === 'ok' ? 'bg-accent text-accent-ink' : t.tone === 'warn' ? 'bg-warn text-ink-1' : 'bg-danger text-ink-1')}>
              {t.tone === 'ok' ? <Check className="size-3" strokeWidth={3.5} /> : t.tone === 'warn' ? <TriangleAlert className="size-3" strokeWidth={3} /> : <CircleAlert className="size-3" strokeWidth={3} />}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-tight">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-fg-2">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
