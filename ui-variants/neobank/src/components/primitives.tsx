import * as Dialog from '@radix-ui/react-dialog';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Loader2 } from 'lucide-react';
import { animate, AnimatePresence, motion, useDragControls, useMotionValue, useTransform, type HTMLMotionProps } from 'motion/react';
import { useEffect, useId, type ReactNode } from 'react';

import { splitMoney, SYMBOL } from '../lib/format';
import { useStore } from '../lib/store';

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

// Motion tokens. Cards and sheets use the same spring so everything moves with one personality.
export const spring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const;
export const softSpring = { type: 'spring', stiffness: 220, damping: 30 } as const;
export const easeOut = [0.16, 1, 0.3, 1] as const;

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('eyebrow', className)}>{children}</div>;
}

export function Glass({ className, children, press, ...rest }: HTMLMotionProps<'div'> & { press?: boolean }) {
  return (
    <motion.div
      className={cn('glass rounded-card', className)}
      whileTap={press ? { scale: 0.985 } : undefined}
      transition={spring}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-fg-2 border-line',
  accent: 'bg-accent-dim text-accent border-accent/20',
  warn: 'bg-warn-dim text-warn border-warn/20',
  danger: 'bg-danger-dim text-danger border-danger/20',
};

export function Chip({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium tracking-[-0.005em]', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} strokeWidth={2.25} />;
}

/** Counts from the previous value to the new one; digits are tabular so nothing jitters. */
export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: easeOut });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={cn('num', className)}>{text}</motion.span>;
}

/** Hero numeral: symbol and cents set smaller and dimmer than the whole units. */
export function HeroMoney({ value, currency, size = 'display' }: { value: number; currency: string; size?: 'display' | 'lg' }) {
  const mv = useMotionValue(value);
  const whole = useTransform(mv, (v) => splitMoney(v).whole);
  const cents = useTransform(mv, (v) => splitMoney(v).cents);
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.1, ease: easeOut });
    return () => c.stop();
  }, [value, mv]);
  const big = size === 'display';
  return (
    <span className={cn('num inline-flex items-baseline font-medium text-fg', big ? 'text-display' : 'text-[34px] leading-none tracking-[-0.04em]')}>
      <span className={cn('mr-1 self-start text-fg-2', big ? 'mt-1.5 text-[26px] tracking-[-0.03em]' : 'mt-0.5 text-[18px]')}>
        {SYMBOL[currency] ?? currency}
      </span>
      <motion.span>{whole}</motion.span>
      <span className={cn('text-fg-3', big ? 'text-[26px] tracking-[-0.03em]' : 'text-[18px]')}>
        .<motion.span>{cents}</motion.span>
      </span>
    </span>
  );
}

/** Radix toggle group with a sliding pill. Exactly one value is always selected. */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  size = 'md',
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  className?: string;
  label: string;
}) {
  const layoutId = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn('relative inline-flex rounded-full border border-line bg-white/[0.04] p-0.5', className)}
    >
      {items.map((it) => (
        <ToggleGroup.Item
          key={it.value}
          value={it.value}
          className={cn(
            'relative z-0 flex-1 rounded-full font-medium transition-colors duration-200',
            size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-9 px-4 text-[13px]',
            value === it.value ? 'text-accent-ink' : 'text-fg-2 hover:text-fg',
          )}
        >
          {value === it.value && (
            <motion.span layoutId={layoutId} className="absolute inset-0 -z-10 rounded-full bg-fg" transition={spring} />
          )}
          {it.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Switch({ checked, onChange, label, tone = 'accent', disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; tone?: 'accent' | 'danger'; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full p-[3px] transition-colors duration-300 disabled:opacity-50',
        checked ? (tone === 'danger' ? 'bg-danger' : 'bg-accent') : 'bg-white/[0.12]',
      )}
    >
      <motion.span
        className="block size-[25px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.35)]"
        animate={{ x: checked ? 20 : 0 }}
        transition={spring}
      />
    </button>
  );
}

export function Button({
  children,
  variant = 'primary',
  className,
  busy,
  ...rest
}: HTMLMotionProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean; children: ReactNode }) {
  const v = {
    primary: 'bg-accent text-accent-ink',
    secondary: 'bg-white/[0.07] text-fg border border-line',
    ghost: 'text-fg-2 hover:text-fg',
    danger: 'bg-danger-dim text-danger border border-danger/20',
  }[variant];
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={cn('inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold tracking-[-0.01em] disabled:opacity-40', v, className)}
      {...rest}
    >
      {busy ? <Spinner /> : children}
    </motion.button>
  );
}

/** Bottom sheet: Radix Dialog for focus trap and Escape, portalled into the phone frame, spring in, drag down to close. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { frame } = useStore();
  const controls = useDragControls();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount container={frame ?? undefined}>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="absolute inset-0 z-40 bg-black/65"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="absolute inset-x-0 bottom-0 z-50 flex max-h-[90%] flex-col overflow-hidden rounded-t-sheet border-t border-line-strong bg-ink-2 shadow-[0_-30px_60px_-20px_rgb(0_0_0/0.8)] outline-none"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={spring}
                drag="y"
                dragListener={false}
                dragControls={controls}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.05, bottom: 0.7 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 650) onOpenChange(false);
                }}
              >
                <div className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1" onPointerDown={(e) => controls.start(e)}>
                  <span className="h-1 w-10 rounded-full bg-white/20" />
                </div>
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
                  <Dialog.Title className="text-title font-semibold text-fg">{title}</Dialog.Title>
                  {description ? (
                    <Dialog.Description className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{description}</Dialog.Description>
                  ) : (
                    <Dialog.Description className="sr-only">{title}</Dialog.Description>
                  )}
                  <div className="mt-5">{children}</div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between px-1">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">{title}</h2>
      {action}
    </div>
  );
}

export function Row({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
      <span className="text-fg-3">{label}</span>
      <span className={cn('text-right text-fg', mono ? 'font-mono text-[13px]' : 'num')}>{value}</span>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-line', className)} />;
}
