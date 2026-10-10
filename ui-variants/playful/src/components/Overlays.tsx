import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { IconBackspace } from '@tabler/icons-react';
import { useState } from 'react';

import { C } from '../theme';
import { BigCheck, Confetti, DadAvatar, ShieldArt } from './Art';
import type { Celebration } from './ui';

export function CelebrationOverlay({ c, onClose }: { c: Celebration; onClose: () => void }) {
  return (
    <Box className="hb-celebrate" role="dialog" aria-live="polite" aria-label={c.title}>
      {c.tone === 'done' && <Confetti />}
      <Box style={{ position: 'relative' }}>
        {c.tone === 'done' && <BigCheck size={120} />}
        {c.tone === 'waiting' && (
          <Box className="hb-pop">
            <DadAvatar size={124} wave />
          </Box>
        )}
        {c.tone === 'blocked' && (
          <Box className="hb-pop">
            <ShieldArt size={110} tone="meh" />
          </Box>
        )}
      </Box>
      <Text className="hb-display hb-rise" fz={32} fw={600} mt={18} lh={1.1}>
        {c.title}
      </Text>
      <Text fz={15} fw={700} mt={8} maw={300} c={C.inkSoft} className="hb-rise">
        {c.body}
      </Text>
      <Button mt={24} size="lg" color={c.tone === 'done' ? 'mint' : c.tone === 'waiting' ? 'grape' : 'sun'} onClick={onClose} autoFocus>
        {c.tone === 'blocked' ? 'Okay, got it' : 'Nice!'}
      </Button>
    </Box>
  );
}

/** Six-digit PIN pad. Chunky keys, dots fill grape, wrong PIN shakes. */
export function PinPad({ onSubmit, busy, error, hint }: { onSubmit: (pin: string) => void; busy?: boolean; error?: string | null; hint?: string }) {
  const [pin, setPin] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [lastErr, setLastErr] = useState(error);
  if (error !== lastErr) {
    setLastErr(error);
    if (error) {
      setPin('');
      setShakeKey((k) => k + 1);
    }
  }
  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) onSubmit(next);
  };
  return (
    <Stack gap={14} align="center">
      <Group gap={12} key={shakeKey} className={shakeKey ? 'hb-shake' : ''} aria-label={`${pin.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <Box key={i} className="hb-pin-dot" data-on={i < pin.length} />
        ))}
      </Group>
      {error ? (
        <Text fz={13} fw={800} c="tomato.7" ta="center">
          {error}
        </Text>
      ) : (
        hint && (
          <Text fz={12.5} fw={700} c={C.inkSoft} ta="center">
            {hint}
          </Text>
        )
      )}
      <Box className="hb-keypad" w="100%" maw={280}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="hb-key" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" className="hb-key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button type="button" className="hb-key" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy} style={{ background: C.cream }}>
          <IconBackspace size={24} stroke={2.2} />
        </button>
      </Box>
    </Stack>
  );
}
