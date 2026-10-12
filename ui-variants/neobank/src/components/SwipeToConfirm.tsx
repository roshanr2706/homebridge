import { ArrowRight, Check, Lock } from 'lucide-react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

import { cn, spring, Spinner } from './primitives';

const KNOB = 52;
const PAD = 4;

/**
 * Drag the knob to the end to confirm. Releasing early springs it back. The knob is also a real button:
 * Enter or Space confirms, so the control works without a pointer.
 */
export function SwipeToConfirm({
  label,
  onConfirm,
  disabled,
  disabledLabel,
}: {
  label: string;
  onConfirm: () => Promise<boolean>;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(260);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const x = useMotionValue(0);
  const fill = useTransform(x, (v) => v + KNOB + PAD);
  const labelOpacity = useTransform(x, [0, max * 0.6], [1, 0]);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setMax(el.clientWidth - KNOB - PAD * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function commit() {
    if (state !== 'idle' || disabled) return;
    setState('busy');
    animate(x, max, spring);
    if (navigator.vibrate) navigator.vibrate(12);
    const ok = await onConfirm();
    if (ok) setState('done');
    else {
      setState('idle');
      animate(x, 0, spring);
    }
  }

  if (disabled) {
    return (
      <div className="flex h-[60px] items-center justify-center gap-2 rounded-full border border-line bg-white/[0.03] text-[14px] text-fg-3">
        <Lock className="size-4" /> {disabledLabel ?? 'Unavailable'}
      </div>
    );
  }

  return (
    <div ref={track} className="relative h-[60px] overflow-hidden rounded-full border border-line bg-white/[0.045] select-none">
      <motion.div className="absolute inset-y-0 left-0 rounded-full bg-accent/15" style={{ width: fill }} />
      <motion.div style={{ opacity: labelOpacity }} className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-[15px] font-medium">
        <span className={cn(state === 'idle' && 'shimmer-text')}>{state === 'idle' ? label : ''}</span>
      </motion.div>
      <motion.button
        type="button"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void commit();
          }
        }}
        drag={state === 'idle' ? 'x' : false}
        dragConstraints={{ left: 0, right: max }}
        dragElastic={0.04}
        dragMomentum={false}
        onDragEnd={() => {
          if (x.get() > max * 0.82) void commit();
          else animate(x, 0, spring);
        }}
        style={{ x, width: KNOB, height: KNOB, top: PAD, left: PAD }}
        whileTap={{ scale: 0.94 }}
        className="absolute flex cursor-grab touch-none items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_6px_20px_-6px_rgb(198_249_74/0.6)] active:cursor-grabbing"
      >
        {state === 'busy' ? <Spinner className="size-5" /> : state === 'done' ? <Check className="size-5" strokeWidth={2.75} /> : <ArrowRight className="size-5" strokeWidth={2.5} />}
      </motion.button>
    </div>
  );
}
