import { ArrowLeftRight, ArrowUp, CreditCard, GraduationCap, Languages, RotateCw, Send, ShieldAlert, ShieldCheck, SquarePen, TrendingDown, Wallet, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { ActionCard } from '../components/ActionCard';
import { TopBar } from '../components/Chrome';
import { Chip, cn, spring } from '../components/primitives';
import { ResultCard } from '../components/ResultCards';
import { useStore, type ChatMessage } from '../lib/store';

const SCAM_TEXT =
  'Is this a scam? "CRA NOTICE: You owe $1,980 in unpaid taxes. Pay today with Apple gift cards or a warrant will be issued for your arrest. Call 1-866-555-0199 now."';

const SUGGESTIONS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: Wallet, label: 'How much money do I have?', prompt: 'How much money do I have?' },
  { icon: ArrowLeftRight, label: 'Cheapest way to change 5,000 MYR to CAD?', prompt: 'Cheapest way to change 5,000 MYR to CAD?' },
  { icon: TrendingDown, label: 'Will I run out before tuition is due?', prompt: 'Will I run out of money before tuition is due?' },
  { icon: CreditCard, label: 'How’s my credit?', prompt: "How's my credit?" },
  { icon: Send, label: 'Pay rent to my landlord', prompt: 'Pay rent to my landlord' },
  { icon: GraduationCap, label: 'Pay my spring tuition', prompt: 'Pay my spring tuition' },
  { icon: ShieldAlert, label: 'Is this “CRA” gift-card text a scam?', prompt: SCAM_TEXT },
  { icon: Languages, label: '我的钱够用到学期末吗？', prompt: '我的钱够用到学期末吗？' },
];

export function Assistant() {
  const { messages, send, newChat } = useStore();
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const busy = messages.some((m) => m.from === 'agent' && 'pending' in m && m.pending);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Scroll so the newest turn's start is in view, not the very bottom of a tall card stack. Wait for the
    // reply's enter animation, or the scroll is clamped to the shorter content height.
    const id = window.setTimeout(() => {
      const turns = el.querySelectorAll<HTMLElement>('[data-turn]');
      const last = turns[turns.length - 1];
      const prevUser = [...el.querySelectorAll<HTMLElement>('[data-from="user"]')].pop();
      // Measured against the scroller itself: offsetTop is relative to the nearest positioned ancestor.
      const target = last?.dataset.from === 'agent' && prevUser
        ? el.scrollTop + prevUser.getBoundingClientRect().top - el.getBoundingClientRect().top - 16
        : el.scrollHeight;
      el.scrollTo({ top: target, behavior: 'smooth' });
    }, 350);
    return () => window.clearTimeout(id);
  }, [messages]);

  const submit = (v = text) => {
    if (!v.trim() || busy) return;
    void send(v);
    setText('');
  };

  return (
    <div className="relative h-full">
      <div ref={scroller} className="no-scrollbar relative h-full overflow-y-auto pb-[184px]">
        <TopBar
          eyebrow="Your money assistant"
          title="Assistant"
          right={
            messages.length > 0 ? (
              <motion.button whileTap={{ scale: 0.9 }} onClick={newChat} aria-label="New chat" className="flex size-9 items-center justify-center rounded-full border border-line bg-white/[0.04] text-fg-2 hover:text-fg">
                <SquarePen className="size-4" />
              </motion.button>
            ) : undefined
          }
        />

        {messages.length === 0 ? (
          <Empty onPick={(p) => submit(p)} />
        ) : (
          <div className="space-y-6 px-4 pt-4">
            {messages.map((m) => (
              <Turn key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      {/* composer, over its own fade so replies scroll out of sight beneath it */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[176px] bg-gradient-to-t from-ink-1 from-55% to-transparent" />
      <div className="absolute inset-x-0 bottom-[calc(max(18px,env(safe-area-inset-bottom))+72px)] z-20 px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="glass-bar flex h-[54px] items-center gap-2 rounded-full pr-1.5 pl-5 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.9)]"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask anything about your money…"
            aria-label="Message"
            maxLength={4000}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
          />
          <motion.button
            type="submit"
            aria-label="Send"
            disabled={!text.trim() || busy}
            whileTap={{ scale: 0.9 }}
            animate={{ scale: text.trim() ? 1 : 0.86, opacity: text.trim() ? 1 : 0.45 }}
            transition={spring}
            className="flex size-[42px] items-center justify-center rounded-full bg-accent text-accent-ink"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </motion.button>
        </form>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="px-5 pt-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="relative mb-6 flex size-14 items-center justify-center rounded-[20px] bg-accent text-accent-ink shadow-[0_16px_40px_-12px_rgb(198_249_74/0.5)]">
          <ShieldCheck className="size-7" strokeWidth={2} />
        </div>
        <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.035em]">
          Ask about your money.
          <br />
          <span className="text-fg-3">It drafts, you decide.</span>
        </h2>
        <p className="mt-3 max-w-[300px] text-[14px] leading-relaxed text-fg-2">
          Balances, cheapest FX, runway, credit and scam checks. Payments are drafts until you swipe; big ones also need Dad.
        </p>
      </motion.div>
      <div className="mt-7 grid grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.label}
            onClick={() => onPick(s.prompt)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.06 + i * 0.035 }}
            whileTap={{ scale: 0.96 }}
            className="glass flex min-h-[96px] flex-col justify-between rounded-[20px] p-3.5 text-left"
          >
            <s.icon className="size-[18px] text-fg-2" strokeWidth={2} />
            <span className="mt-3 text-[13.5px] leading-snug font-medium tracking-[-0.01em]">{s.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

const FLAG_TEXT: Record<string, string> = {
  scam: 'Scam pattern detected',
  injection: 'Instruction injection blocked',
  extraction: 'Data request blocked',
};

function Turn({ m }: { m: ChatMessage }) {
  if (m.from === 'user')
    return (
      <motion.div data-turn data-from="user" initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="flex justify-end">
        <div className="max-w-[82%] rounded-[22px] rounded-br-[8px] bg-white/[0.09] px-4 py-2.5 text-[15px] leading-snug break-words">{m.text}</div>
      </motion.div>
    );

  return (
    <div data-turn data-from="agent" className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink">
          <ShieldCheck className="size-3.5" strokeWidth={2.5} />
        </span>
        <span className="text-[12.5px] font-semibold text-fg-2">HomeBridge</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {'pending' in m && m.pending ? (
          <motion.div key="dots" exit={{ opacity: 0 }} className="flex gap-1.5 px-2 py-2">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="size-2 rounded-full bg-fg-2" animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
            ))}
          </motion.div>
        ) : 'error' in m ? (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-1 text-[14.5px] text-danger">
            {m.error}
            <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-fg-3">
              <RotateCw className="size-3" /> Nothing was sent. Try asking again.
            </span>
          </motion.div>
        ) : 'res' in m ? (
          <motion.div key="res" className="space-y-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            {m.res.guard.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {m.res.guard.flags.map((f) => (
                  <Chip key={f} tone="danger" icon={<ShieldAlert className="size-3" />}>
                    {FLAG_TEXT[f] ?? `Guard: ${f}`}
                  </Chip>
                ))}
              </div>
            )}
            <Reply text={m.res.reply} />
            {m.res.cards.map((c, i) => (
              <ResultCard key={`${c.type}-${i}`} card={c} />
            ))}
            {m.res.actions.map((a) => (
              <ActionCard key={a.action_id} action={a} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Plain text reply; quoted phrases and money amounts get a touch of emphasis. */
function Reply({ text }: { text: string }) {
  const parts = text.split(/((?:CAD|MYR) -?[\d,]+(?:\.\d+)?)/g);
  return (
    <p className={cn('px-1 text-[15.5px] leading-[1.55] tracking-[-0.005em] text-fg/90')}>
      {parts.map((p, i) =>
        /^(CAD|MYR) /.test(p) ? (
          <span key={i} className="num font-semibold text-fg">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}
