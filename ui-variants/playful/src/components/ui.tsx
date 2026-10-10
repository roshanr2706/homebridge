import { Box, Group, Text, type BoxProps } from '@mantine/core';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

import { C } from '../theme';

export function Tile({
  bg = '#fff',
  children,
  onClick,
  p = 16,
  className = '',
  style,
  ...rest
}: BoxProps & { bg?: string; children: ReactNode; onClick?: () => void; className?: string; style?: React.CSSProperties }) {
  const clickable = !!onClick;
  return (
    <Box
      className={`hb-chunk ${clickable ? 'hb-tile' : ''} ${className}`}
      p={p}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick?.() : undefined}
      style={{ background: bg, position: 'relative', overflow: 'hidden', ...style }}
      {...rest}
    >
      {children}
    </Box>
  );
}

export function Eyebrow({ children, color = C.ink }: { children: ReactNode; color?: string }) {
  return (
    <Text fz={11.5} fw={900} tt="uppercase" lts={1} c={color} style={{ opacity: 0.8 }}>
      {children}
    </Text>
  );
}

export function Big({ children, size = 30, color = C.ink }: { children: ReactNode; size?: number; color?: string }) {
  return (
    <Text className="hb-display" fz={size} fw={600} lh={1.05} c={color}>
      {children}
    </Text>
  );
}

export function IconBadge({ children, bg, size = 36 }: { children: ReactNode; bg: string; size?: number }) {
  return (
    <Box
      className="hb-chunk-sm"
      style={{ width: size, height: size, borderRadius: size / 2.6, background: bg, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: `0 2px 0 ${C.ink}` }}
    >
      {children}
    </Box>
  );
}

export function Sticker({ children, bg = C.sun, rotate = -4 }: { children: ReactNode; bg?: string; rotate?: number }) {
  return (
    <Box
      component="span"
      style={{
        display: 'inline-block',
        background: bg,
        border: `2px solid ${C.ink}`,
        borderRadius: 10,
        padding: '2px 8px',
        fontWeight: 900,
        fontSize: 12,
        transform: `rotate(${rotate}deg)`,
        boxShadow: `0 2px 0 ${C.ink}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" py={4}>
      <Text fz={13.5} c={C.inkSoft} fw={700}>
        {label}
      </Text>
      <Text fz={13.5} fw={strong ? 900 : 800} ta="right">
        {value}
      </Text>
    </Group>
  );
}

// ---- App-level plumbing (role, tabs, jump-to-assistant, celebrations) ----
export type Tab = 'home' | 'assistant' | 'money';
export type Celebration = { title: string; body: string; tone: 'done' | 'waiting' | 'blocked' };

export type AppCtx = {
  ask: (prompt: string) => void;
  setTab: (t: Tab) => void;
  celebrate: (c: Celebration) => void;
  refreshKey: number;
  bump: () => void;
};

export const App = createContext<AppCtx>({ ask: () => {}, setTab: () => {}, celebrate: () => {}, refreshKey: 0, bump: () => {} });
export const useApp = () => useContext(App);
