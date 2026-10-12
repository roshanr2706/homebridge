// Sponsor PIN step before approving, unlocking or changing limits. The PIN goes to the server, which checks
// it (5 wrong tries lock PIN approval for a while). Demo PIN 246810 is shown as a hint, never prefilled.
import { useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, Dialog, Stack, Typography } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import PasswordRoundedIcon from '@mui/icons-material/PasswordRounded';

import { DEMO_PIN } from '../api';
import { useStore } from '../store';

const shake = keyframes`10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}`;

export function PinDialog({
  open,
  title,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Resolves when the server accepted the PIN; throws with the server's message otherwise. */
  onSubmit: (pin: string) => Promise<void>;
}) {
  const t = useTheme();
  const { frame } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const pinRef = useRef('');
  pinRef.current = pin;

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (value: string) => {
    setBusy(true);
    try {
      await onSubmit(value);
    } catch (e) {
      setError((e as Error).message);
      setShakeKey((k) => k + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const cur = pinRef.current;
    if (cur.length >= 6) return;
    const next = cur + d;
    pinRef.current = next;
    setError('');
    setPin(next);
    if (next.length === 6) void submit(next);
  };
  const del = () => {
    if (busy) return;
    pinRef.current = pinRef.current.slice(0, -1);
    setPin(pinRef.current);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') del();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} container={frame} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { mx: 2, width: '100%' } } }}>
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Box sx={{ width: 48, height: 48, borderRadius: '16px', bgcolor: t.m3.secondaryContainer, color: t.m3.onSecondaryContainer, display: 'grid', placeItems: 'center', mx: 'auto', mb: 1.5 }}>
          <PasswordRoundedIcon />
        </Box>
        <Typography variant="h6">Enter your approval PIN</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {title}
        </Typography>
        <Stack
          key={shakeKey}
          direction="row"
          spacing={1.5}
          sx={{ justifyContent: 'center', alignItems: 'center', my: 2.5, minHeight: 18, animation: shakeKey ? `${shake} .4s` : 'none' }}
          aria-label={`${pin.length} of 6 digits entered`}
        >
          {busy ? (
            <CircularProgress size={18} />
          ) : (
            Array.from({ length: 6 }).map((_, i) => (
              <Box
                key={i}
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: i < pin.length ? t.m3.primary : 'transparent',
                  border: `2px solid ${error ? t.m3.error : i < pin.length ? t.m3.primary : t.m3.outline}`,
                  transition: 'background-color .1s',
                }}
              />
            ))
          )}
        </Stack>
        <Typography variant="caption" color={error ? 'error' : 'text.secondary'} component="div" sx={{ minHeight: 32, mb: 1, fontWeight: error ? 650 : 500 }}>
          {error || 'Checked by the bank, not on this phone.'}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, maxWidth: 260, mx: 'auto' }}>
          {keys.map((k, i) =>
            k === '' ? (
              <Box key={i} />
            ) : (
              <ButtonBase
                key={i}
                onClick={() => (k === 'del' ? del() : press(k))}
                aria-label={k === 'del' ? 'Delete' : k}
                disabled={busy}
                sx={{
                  height: 56,
                  borderRadius: '18px',
                  fontSize: 22,
                  fontWeight: 650,
                  fontFamily: 'inherit',
                  bgcolor: k === 'del' ? 'transparent' : t.m3.surfaceContainerHighest,
                  color: t.m3.onSurface,
                  '&:hover': { bgcolor: t.m3.surfaceDim },
                }}
              >
                {k === 'del' ? <BackspaceOutlinedIcon /> : k}
              </ButtonBase>
            ),
          )}
        </Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 2.5 }}>
          <Typography variant="caption" color="text.secondary">
            Demo PIN {DEMO_PIN}
          </Typography>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </Stack>
      </Box>
    </Dialog>
  );
}
