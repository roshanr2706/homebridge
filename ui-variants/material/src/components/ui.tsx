// Small shared building blocks on top of MUI, in M3 terms (tonal chips, section headers, card shells).
import type { ReactNode } from 'react';
import { Box, Card, Chip, Stack, Typography, type ChipProps, type SxProps, type Theme } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { splitAmount } from '../format';

export type Tone = 'primary' | 'secondary' | 'tertiary' | 'warning' | 'success' | 'error' | 'neutral';

export function toneColors(t: Theme, tone: Tone): { bg: string; fg: string; solid: string } {
  const m = t.m3;
  switch (tone) {
    case 'primary':
      return { bg: m.primaryContainer, fg: m.onPrimaryContainer, solid: m.primary };
    case 'secondary':
      return { bg: m.secondaryContainer, fg: m.onSecondaryContainer, solid: m.secondary };
    case 'tertiary':
      return { bg: m.tertiaryContainer, fg: m.onTertiaryContainer, solid: m.tertiary };
    case 'warning':
      return { bg: m.warningContainer, fg: m.onWarningContainer, solid: m.warning };
    case 'success':
      return { bg: m.successContainer, fg: m.onSuccessContainer, solid: m.success };
    case 'error':
      return { bg: m.errorContainer, fg: m.onErrorContainer, solid: m.error };
    default:
      return { bg: m.surfaceContainerHighest, fg: m.onSurfaceVariant, solid: m.outline };
  }
}

/** Tonal (filled-container) chip, used for statuses and tiers. Always text + optional icon, never colour alone. */
export function ToneChip({ tone, sx, ...rest }: ChipProps & { tone: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <Chip
      size="small"
      {...rest}
      sx={{ bgcolor: c.bg, color: c.fg, '& .MuiChip-icon': { color: c.fg }, ...(sx as object) }}
    />
  );
}

export function SectionHeader({ title, action, sx }: { title: string; action?: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 0.5, mt: 1, mb: 1, minHeight: 36, ...(sx as object) }}>
      <Typography variant="subtitle1" component="h2">
        {title}
      </Typography>
      {action}
    </Stack>
  );
}

/** M3 card variants: filled (surface container), outlined, elevated. */
export function M3Card({
  variant = 'filled',
  children,
  sx,
  onClick,
}: {
  variant?: 'filled' | 'outlined' | 'elevated' | 'lowest';
  children: ReactNode;
  sx?: SxProps<Theme>;
  onClick?: () => void;
}) {
  const t = useTheme();
  const m = t.m3;
  const base =
    variant === 'outlined'
      ? { bgcolor: m.surface, border: `1px solid ${m.outlineVariant}` }
      : variant === 'elevated'
        ? { bgcolor: m.surfaceContainerLow, boxShadow: '0 1px 2px rgba(0,32,32,.10), 0 1px 3px 1px rgba(0,32,32,.06)' }
        : variant === 'lowest'
          ? { bgcolor: m.surfaceContainerLowest }
          : { bgcolor: m.surfaceContainerHigh };
  return (
    <Card
      onClick={onClick}
      sx={{
        ...base,
        ...(onClick ? { cursor: 'pointer', transition: 'background-color .15s', '&:hover': { filter: 'brightness(0.985)' } } : {}),
        ...(sx as object),
      }}
    >
      {children}
    </Card>
  );
}

/** Big tabular amount with smaller cents, the way banking apps show balances. */
export function Amount({ value, currency, size = 34, color }: { value: number; currency: string; size?: number; color?: string }) {
  const [whole, cents] = splitAmount(value);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, color, fontVariantNumeric: 'tabular-nums' }}>
      <Box component="span" sx={{ fontSize: size * 0.42, fontWeight: 700, opacity: 0.8, letterSpacing: '0.04em' }}>
        {currency}
      </Box>
      <Box component="span" sx={{ fontSize: size, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {whole}
        <Box component="span" sx={{ fontSize: size * 0.6, opacity: 0.75 }}>
          {cents}
        </Box>
      </Box>
    </Box>
  );
}

export function IconBadge({ tone, children, size = 40 }: { tone: Tone; children: ReactNode; size?: number }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? '14px' : '10px',
        bgcolor: c.bg,
        color: c.fg,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        '& svg': { fontSize: size * 0.55 },
      }}
    >
      {children}
    </Box>
  );
}

export function KeyValue({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'baseline', py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {k}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 550, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {v}
      </Typography>
    </Stack>
  );
}
