import * as Tabs from '@radix-ui/react-tabs';
import { BatteryFull, House, Inbox, ShieldCheck, Signal, Sparkles, WalletCards, Wifi } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

import { Toasts } from './components/Chrome';
import { cn, spring } from './components/primitives';
import { StoreProvider, useStore, type SponsorTab, type StudentTab } from './lib/store';
import { Assistant } from './screens/Assistant';
import { Home } from './screens/Home';
import { SponsorApprovals } from './screens/SponsorApprovals';
import { SponsorSafety } from './screens/SponsorSafety';
import { Wallet } from './screens/Wallet';

export default function App() {
  return (
    <StoreProvider>
      <Stage />
    </StoreProvider>
  );
}

/** Desktop: a 390×844 phone centred over a dark stage. Phones: the app fills the screen. */
function Stage() {
  const { backend, ready, role } = useStore();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink-0 sm:py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
        <div className="absolute top-[-20%] left-[10%] size-[720px] rounded-full bg-accent/[0.05] blur-[140px]" />
        <div className="absolute right-[-10%] bottom-[-30%] size-[640px] rounded-full bg-[#5b6cff]/[0.06] blur-[160px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,var(--color-ink-0)_75%)]" />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        <Phone />
        <div className="hidden items-center gap-2 text-[12px] text-fg-3 sm:flex">
          <span className="font-semibold tracking-tight text-fg-2">HomeBridge</span>
          <span>·</span>
          <span>Neo variant</span>
          <span>·</span>
          <span>{role === 'student' ? 'Aisha, student' : 'Encik Rahman, sponsor'}</span>
          {ready && (
            <>
              <span>·</span>
              <span className={backend.mode === 'live' ? 'text-accent' : 'text-warn'}>{backend.mode === 'live' ? 'Live API' : 'Demo data'}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Phone() {
  const { setFrame, ready } = useStore();
  return (
    <div
      ref={setFrame}
      className={cn(
        'relative isolate h-dvh w-full overflow-hidden bg-ink-1 [--sat:env(safe-area-inset-top,0px)]',
        'sm:h-[min(844px,calc(100dvh-80px))] sm:w-[390px] sm:rounded-[54px] sm:[--sat:46px]',
        'sm:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_0_0_9px_#0d0e10,0_0_0_10px_rgb(255_255_255/0.07),0_60px_120px_-30px_rgb(0_0_0/0.9)]',
      )}
    >
      <StatusBar />
      {ready ? <Screens /> : <Splash />}
      <Toasts />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 hidden h-[46px] items-center justify-between px-8 pt-1 text-fg sm:flex">
      <span className="num text-[15px] font-semibold tracking-tight">9:41</span>
      <span className="absolute top-[11px] left-1/2 h-[30px] w-[118px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5">
        <Signal className="size-4" strokeWidth={2.5} />
        <Wifi className="size-4" strokeWidth={2.5} />
        <BatteryFull className="size-5" strokeWidth={2} />
      </span>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <motion.svg viewBox="0 0 64 64" className="size-14" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
        <motion.path d="M14 42c6-14 30-14 36 0" fill="none" stroke="var(--color-accent)" strokeWidth={5} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, repeat: Infinity, repeatType: 'reverse' }} />
        <path d="M20 42v-6M32 42V30M44 42v-6" stroke="var(--color-accent)" strokeWidth={4} strokeLinecap="round" />
      </motion.svg>
      <span className="eyebrow">Connecting</span>
    </div>
  );
}

type TabDef<T extends string> = { value: T; label: string; icon: ReactNode; badge?: number };

function Screens() {
  const { role, studentTab, setStudentTab, sponsorTab, setSponsorTab, queue } = useStore();
  const student = role === 'student';
  const tabs: TabDef<string>[] = student
    ? [
        { value: 'home', label: 'Home', icon: <House className="size-[21px]" /> },
        { value: 'assistant', label: 'Assistant', icon: <Sparkles className="size-[21px]" /> },
        { value: 'wallet', label: 'Wallet', icon: <WalletCards className="size-[21px]" /> },
      ]
    : [
        { value: 'approvals', label: 'Approvals', icon: <Inbox className="size-[21px]" />, badge: queue.length },
        { value: 'safety', label: 'Safety', icon: <ShieldCheck className="size-[21px]" /> },
      ];
  const value = student ? studentTab : sponsorTab;
  const onChange = (v: string) => (student ? setStudentTab(v as StudentTab) : setSponsorTab(v as SponsorTab));
  const key = `${role}:${value}`;

  return (
    <Tabs.Root value={value} onValueChange={onChange} className="absolute inset-0">
      <AnimatePresence initial={false}>
        <Tabs.Content key={key} value={value} forceMount asChild>
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {value === 'home' && <Home />}
            {value === 'assistant' && <Assistant />}
            {value === 'wallet' && <Wallet />}
            {value === 'approvals' && <SponsorApprovals />}
            {value === 'safety' && <SponsorSafety />}
          </motion.div>
        </Tabs.Content>
      </AnimatePresence>

      {value !== 'assistant' && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-gradient-to-t from-ink-1 via-ink-1/80 to-transparent" />}
      <Tabs.List
        aria-label="Sections"
        className="glass-bar absolute bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full p-1.5 shadow-[0_20px_40px_-12px_rgb(0_0_0/0.8)]"
      >
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className={cn('relative flex h-12 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition-colors', active ? 'text-accent-ink' : 'text-fg-2 hover:text-fg')}
            >
              {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-accent" transition={spring} />}
              <span className="relative z-10">{t.icon}</span>
              <AnimatePresence initial={false}>
                {active && (
                  <motion.span
                    className="relative z-10 overflow-hidden whitespace-nowrap"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={spring}
                  >
                    {t.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {!active && !!t.badge && (
                <span className="num absolute top-1.5 right-2 z-10 flex size-4 items-center justify-center rounded-full bg-warn text-[10px] font-bold text-ink-1">{t.badge}</span>
              )}
              {!active && <span className="sr-only">{t.label}</span>}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
