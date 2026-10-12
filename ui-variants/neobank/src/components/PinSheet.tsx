import { Check, Delete, Fingerprint } from 'lucide-react';
import { motion, useAnimationControls } from 'motion/react';
import { useEffect, useState } from 'react';

import { DEMO_PIN } from '../lib/api';
import { cn, Sheet, spring, Spinner } from './primitives';

/** Sponsor PIN step before an approval. The demo PIN is shown, and can be filled with one tap. */
export function PinSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onSubmit: (pin: string) => Promise<boolean>;
}) {
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'entry' | 'busy' | 'done' | 'wrong'>('entry');
  const shake = useAnimationControls();

  useEffect(() => {
    if (open) {
      setPin('');
      setState('entry');
    }
  }, [open]);

  useEffect(() => {
    if (pin.length !== 6 || state !== 'entry') return;
    if (pin !== DEMO_PIN) {
      setState('wrong');
      void shake.start({ x: [0, -12, 10, -8, 6, -3, 0], transition: { duration: 0.45 } }).then(() => {
        setPin('');
        setState('entry');
      });
      return;
    }
    setState('busy');
    void onSubmit(pin).then((ok) => {
      if (ok) {
        setState('done');
        setTimeout(() => onOpenChange(false), 700);
      } else {
        setPin('');
        setState('entry');
      }
    });
  }, [pin, state, onSubmit, onOpenChange, shake]);

  const press = (k: string) => {
    if (state !== 'entry') return;
    if (k === 'del') setPin((p) => p.slice(0, -1));
    else if (k === 'fill') setPin(DEMO_PIN);
    else setPin((p) => (p.length < 6 ? p + k : p));
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'fill', '0', 'del'];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex flex-col items-center">
        <motion.div animate={shake} className="flex h-14 items-center gap-3.5">
          {state === 'busy' ? (
            <Spinner className="size-6 text-accent" />
          ) : state === 'done' ? (
            <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Check className="size-6" strokeWidth={3} />
            </motion.span>
          ) : (
            Array.from({ length: 6 }, (_, i) => (
              <motion.span
                key={i}
                className={cn('size-3.5 rounded-full border-[1.5px]', state === 'wrong' ? 'border-danger bg-danger' : i < pin.length ? 'border-fg bg-fg' : 'border-white/25')}
                animate={{ scale: i === pin.length - 1 ? [1.35, 1] : 1 }}
                transition={spring}
              />
            ))
          )}
        </motion.div>
        <p className={cn('mt-1 h-5 text-[12.5px]', state === 'wrong' ? 'text-danger' : 'text-fg-3')}>
          {state === 'wrong' ? 'That PIN doesn’t match. Try again.' : <span className="num">Demo PIN {DEMO_PIN}</span>}
        </p>

        <div className="mt-5 grid w-full max-w-[300px] grid-cols-3 gap-x-6 gap-y-3">
          {keys.map((k) => (
            <motion.button
              key={k}
              type="button"
              whileTap={{ scale: 0.88, backgroundColor: 'rgba(255,255,255,0.14)' }}
              transition={spring}
              onClick={() => press(k)}
              aria-label={k === 'del' ? 'Delete' : k === 'fill' ? 'Fill demo PIN' : k}
              className={cn('flex h-[62px] items-center justify-center rounded-full text-[26px] font-normal', k === 'fill' || k === 'del' ? 'text-fg-2' : 'num bg-white/[0.06]')}
            >
              {k === 'del' ? <Delete className="size-6" strokeWidth={1.75} /> : k === 'fill' ? <Fingerprint className="size-7 text-accent" strokeWidth={1.75} /> : k}
            </motion.button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
