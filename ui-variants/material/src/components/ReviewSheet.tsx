// Student review bottom sheet: the drafted payment, and Confirm (POST /actions/{id}/confirm with the
// single-use confirm_token) or Cancel.
import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Drawer, LinearProgress, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import CurrencyExchangeRoundedIcon from '@mui/icons-material/CurrencyExchangeRounded';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';

import { api } from '../api';
import { cityTime, isMove, KIND_LABEL } from '../format';
import { useStore } from '../store';
import type { Action } from '../types';
import { ActionDetails } from './ActionDetails';
import { IconBadge } from './ui';

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function ReviewSheet() {
  const { review, openReview, frame, actions, refresh, toast } = useStore();
  const [current, setCurrent] = useState<Action | null>(review);
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const t = useTheme();

  // Keep the sheet in sync with the latest server copy (polling) while it is open.
  useEffect(() => {
    if (!review) return;
    const fresh = actions.find((a) => a.action_id === review.action_id);
    setCurrent((c) => {
      const base = c && c.action_id === review.action_id ? c : review;
      if (!fresh) return base;
      return { ...fresh, confirm_token: fresh.confirm_token ?? base.confirm_token };
    });
  }, [review, actions]);
  useEffect(() => setError(''), [review?.action_id]);

  const a = current && review && current.action_id === review.action_id ? current : review;
  const waiting = a?.status === 'awaiting_user';
  const now = useNow(!!waiting);
  const left = a ? Math.max(0, Math.round(a.expires_at - now / 1000)) : 0;
  const total = a ? Math.max(1, a.expires_at - a.created_at) : 1;

  const confirm = async () => {
    if (!a) return;
    setBusy('confirm');
    setError('');
    try {
      const res = await api.confirm(a.action_id, a.confirm_token ?? '');
      setCurrent(res);
      toast(res.status === 'awaiting_sponsor' ? 'Confirmed. Sent to Dad for approval.' : res.status === 'executed' ? 'Payment sent.' : `Status: ${res.status}`);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!a) return;
    setBusy('cancel');
    try {
      const res = await api.cancel(a.action_id);
      setCurrent(res);
      toast(a.status === 'awaiting_sponsor' ? 'Request withdrawn.' : 'Draft cancelled. Nothing was sent.');
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const frozen = !!(a?.frozen && waiting);

  return (
    <Drawer
      anchor="bottom"
      open={!!review}
      onClose={() => openReview(null)}
      container={frame}
    >
      {a && (
        <Box sx={{ px: 3, pb: 3, pt: 1.5, overflowY: 'auto' }}>
          <Box sx={{ width: 32, height: 4, borderRadius: 2, bgcolor: t.m3.outline, opacity: 0.5, mx: 'auto', mb: 2 }} />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
            <IconBadge tone="primary">{a.kind === 'conversion' ? <CurrencyExchangeRoundedIcon /> : <ReceiptLongRoundedIcon />}</IconBadge>
            <Box>
              <Typography variant="h6">{waiting ? 'Review and confirm' : 'Payment details'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {isMove(a) ? 'Move between your accounts' : KIND_LABEL[a.kind] ?? a.kind} · drafted by your assistant
              </Typography>
            </Box>
          </Stack>

          <ActionDetails a={a} mode="student" />

          {waiting && (
            <Box sx={{ mt: 2.5 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.75 }}>
                <TimerOutlinedIcon sx={{ fontSize: 16, color: left < 60 ? 'error.main' : 'text.secondary' }} />
                <Typography variant="caption" color={left < 60 ? 'error' : 'text.secondary'}>
                  Single-use confirmation · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={(left / total) * 100} color={left < 60 ? 'error' : 'primary'} sx={{ height: 4 }} />
            </Box>
          )}
          {a.status === 'awaiting_sponsor' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Sent to Dad. It’s {cityTime('Asia/Kuala_Lumpur')} in Kuala Lumpur.
            </Typography>
          )}
          {error && (
            <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 600 }}>
              {error}
            </Typography>
          )}

          <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
            {waiting ? (
              <>
                <Button variant="outlined" size="large" onClick={cancel} disabled={!!busy} sx={{ flex: 1 }}>
                  {busy === 'cancel' ? <CircularProgress size={20} /> : 'Cancel'}
                </Button>
                <Button
                  variant="contained"
                  size="large"
                  onClick={confirm}
                  disabled={!!busy || frozen}
                  startIcon={busy === 'confirm' ? undefined : <CheckRoundedIcon />}
                  sx={{ flex: 2 }}
                >
                  {busy === 'confirm' ? <CircularProgress size={20} color="inherit" /> : frozen ? 'Locked' : a.needs_sponsor_approval ? 'Confirm & send to Dad' : 'Confirm'}
                </Button>
              </>
            ) : (
              <>
                {a.status === 'awaiting_sponsor' && (
                  <Button variant="outlined" size="large" onClick={cancel} disabled={!!busy} sx={{ flex: 1 }}>
                    Withdraw
                  </Button>
                )}
                <Button variant="contained" size="large" onClick={() => openReview(null)} sx={{ flex: 1 }}>
                  Close
                </Button>
              </>
            )}
          </Stack>
        </Box>
      )}
    </Drawer>
  );
}
