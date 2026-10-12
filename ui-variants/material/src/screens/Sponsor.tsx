// Sponsor (Dad, Kuala Lumpur) mode: approvals queue with reasons, PIN step, reject; emergency lock;
// alerts + 24h digest; family accounts and limits.
import { useState, type ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import NightlightRoundedIcon from '@mui/icons-material/NightlightRounded';
import SpeedRoundedIcon from '@mui/icons-material/SpeedRounded';
import ReportRoundedIcon from '@mui/icons-material/ReportRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';

import { api } from '../api';
import { ActionDetails } from '../components/ActionDetails';
import { PinDialog } from '../components/PinDialog';
import { AccountGlyph } from '../components/ResultCards';
import { Amount, IconBadge, M3Card, SectionHeader, ToneChip, type Tone } from '../components/ui';
import { cityTime, headline, money, timeAgo } from '../format';
import { useStore } from '../store';
import type { Action } from '../types';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: Tone }) {
  const t = useTheme();
  return (
    <Box sx={{ p: 1.5, borderRadius: '16px', bgcolor: t.m3.surfaceContainerLowest }}>
      <Typography sx={{ fontSize: 22, fontWeight: 750, fontVariantNumeric: 'tabular-nums', color: tone === 'warning' ? t.m3.warning : t.m3.onSurface }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function ApprovalCard({ a }: { a: Action }) {
  const { refresh, toast } = useStore();
  const [note, setNote] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [err, setErr] = useState('');
  const h = headline(a);
  const frozen = !!a.frozen;

  // Runs inside the PIN dialog: a wrong PIN throws and the dialog shows the server's message.
  const approve = async (pin: string) => {
    setErr('');
    const r = await api.approve(a.action_id, note, pin);
    setPinOpen(false);
    toast(r.status === 'executed' ? `Approved. ${h.big} sent.` : r.status === 'failed' ? 'Approved, but the payment failed.' : `Approved (${r.status.replace('_', ' ')}).`);
    if (r.status === 'failed' && r.result?.error) setErr(String(r.result.error));
    await refresh();
  };
  const reject = async () => {
    setBusy('reject');
    setErr('');
    try {
      await api.reject(a.action_id, note);
      toast('Rejected. Aisha has been told.');
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <M3Card variant="elevated" sx={{ bgcolor: (t) => t.m3.surfaceContainerLowest }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            Aisha asks · {timeAgo(a.created_at)}
          </Typography>
          <ToneChip tone="warning" icon={<ScheduleRoundedIcon />} label="Waiting for you" />
        </Stack>
        <ActionDetails a={a} mode="sponsor" />
        <TextField
          fullWidth
          size="small"
          label="Note for Aisha (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          sx={{ mt: 2 }}
        />
        {err && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {err}
          </Alert>
        )}
        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="outlined" color="error" size="large" startIcon={<CloseRoundedIcon />} onClick={reject} disabled={!!busy} sx={{ flex: 1 }}>
            {busy === 'reject' ? <CircularProgress size={20} color="inherit" /> : 'Reject'}
          </Button>
          <Button
            variant="contained"
            size="large"
            startIcon={busy ? undefined : frozen ? <LockRoundedIcon /> : <CheckRoundedIcon />}
            onClick={() => setPinOpen(true)}
            disabled={!!busy || frozen}
            sx={{ flex: 1.4 }}
          >
            {busy === 'approve' ? <CircularProgress size={20} color="inherit" /> : frozen ? 'Locked' : 'Approve'}
          </Button>
        </Stack>
      </CardContent>
      <PinDialog open={pinOpen} title={`Approve ${h.big} ${h.sub ?? ''}`} onClose={() => setPinOpen(false)} onSubmit={approve} />
    </M3Card>
  );
}

function klGreeting() {
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const ALERT_ICON: Record<string, ReactElement> = {
  odd_hours: <NightlightRoundedIcon />,
  velocity: <SpeedRoundedIcon />,
  student_freeze: <LockRoundedIcon />,
  failed_confirms: <ReportRoundedIcon />,
};

export function SponsorApprovals() {
  const { sponsor: s, queue, refresh, toast, error, frame } = useStore();
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (!s) {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Skeleton variant="rounded" height={140} sx={{ borderRadius: '24px' }} />
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '24px' }} />
      </Stack>
    );
  }
  const locked = !!s.freeze.sponsor_funded;
  // Locking is instant; unlocking needs the PIN (checked on the server).
  const unlock = async (pin: string) => {
    await api.sponsorUnfreeze(pin);
    setUnlockOpen(false);
    toast('Payments unlocked.');
    await refresh();
  };
  const toggleLock = async (on: boolean, scope: 'sponsor_funded' | 'all' = 'sponsor_funded') => {
    if (!on) {
      setUnlockOpen(true);
      return;
    }
    setBusy(true);
    try {
      await api.sponsorFreeze(scope);
      toast(scope === 'all' ? 'All of Aisha’s payments are locked.' : 'Money you fund is locked.');
      setConfirmAll(false);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ px: 2, pb: 3 }}>
      <Box sx={{ px: 0.5, pt: 0.5 }}>
        <Typography variant="h5">{klGreeting()}, Encik Rahman</Typography>
        <Typography variant="body2" color="text.secondary">
          Aisha is in Vancouver, where it’s {cityTime('America/Vancouver')}.
        </Typography>
      </Box>

      {/* Digest */}
      <M3Card variant="filled" sx={{ bgcolor: t.m3.secondaryContainer, color: t.m3.onSecondaryContainer }}>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle1">Last {s.digest.window_hours} hours</Typography>
            {s.digest.frozen && <ToneChip tone="error" icon={<LockRoundedIcon />} label="Locked" />}
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <Stat label="Waiting for you" value={s.digest.awaiting_sponsor} tone={s.digest.awaiting_sponsor ? 'warning' : undefined} />
            <Stat label="Payments done" value={s.digest.executed} />
            <Stat label="Drafted by Aisha" value={s.digest.drafted} />
            <Stat label={s.digest.money_out_scope === 'sponsor_funded' ? 'Out of money you fund' : 'Money out'} value={money(s.digest.money_out_cad, 'CAD', { decimals: 0 })} />
          </Box>
        </CardContent>
      </M3Card>

      {/* Emergency lock */}
      <M3Card variant="outlined" sx={{ borderColor: locked ? t.m3.error : undefined }}>
        <CardContent>
          <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1.5}>
            <IconBadge tone={locked ? 'error' : 'neutral'}>{locked ? <LockRoundedIcon /> : <LockOpenRoundedIcon />}</IconBadge>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1">Emergency lock</Typography>
              <Typography variant="body2" color="text.secondary">
                {locked
                  ? s.freeze.own
                    ? 'Everything is locked. Only you can unlock it.'
                    : 'Money you fund is locked. Unlocking needs your PIN.'
                  : 'Instantly stop payments from the accounts you fund.'}
              </Typography>
            </Box>
            <Switch
              checked={locked}
              color={locked ? 'error' : 'primary'}
              disabled={busy}
              onChange={(e) => void toggleLock(e.target.checked)}
              slotProps={{ input: { 'aria-label': 'Emergency lock' } }}
            />
          </Stack>
          {!s.freeze.own && (
            <Button size="small" color="error" sx={{ mt: 1.5 }} startIcon={<LockRoundedIcon />} onClick={() => setConfirmAll(true)} disabled={busy}>
              Lock everything, including Aisha’s own money
            </Button>
          )}
        </CardContent>
      </M3Card>

      {/* Approvals */}
      <Box>
        <SectionHeader title="Needs your approval" action={queue.length ? <ToneChip tone="warning" label={queue.length} /> : undefined} />
        {queue.length === 0 ? (
          <M3Card variant="filled" sx={{ bgcolor: t.m3.surfaceContainerLow }}>
            <CardContent>
              <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1.5}>
                <IconBadge tone="success">
                  <TaskAltRoundedIcon />
                </IconBadge>
                <Box>
                  <Typography variant="subtitle2">All clear</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Nothing is waiting. Large or unusual payments will appear here.
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </M3Card>
        ) : (
          <Stack spacing={2}>
            {queue.map((a) => (
              <ApprovalCard key={a.action_id} a={a} />
            ))}
          </Stack>
        )}
      </Box>

      {/* Alerts */}
      <Box>
        <SectionHeader title="Alerts" />
        {s.alerts.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
            No alerts. You’ll hear about odd-hours activity, bursts of payments, failed confirmations and locks.
          </Typography>
        ) : (
          <M3Card variant="outlined">
            <List disablePadding>
              {s.alerts.map((al, i) => (
                <Stack key={al.id} direction="row" spacing={1.5} sx={{ px: 2, py: 1.5, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none' }}>
                  <IconBadge tone={al.weight >= 3 ? 'error' : 'warning'} size={36}>
                    {ALERT_ICON[al.kind] ?? <NotificationsActiveRoundedIcon />}
                  </IconBadge>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {al.message}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(al.ts)} · {al.kind.replace(/_/g, ' ')}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </List>
          </M3Card>
        )}
      </Box>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} container={frame} maxWidth="xs">
        <DialogTitle>Lock everything?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This also locks Aisha’s own CAD Everyday account. She won’t be able to confirm any payment until you unlock it.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => void toggleLock(true, 'all')} disabled={busy}>
            Lock everything
          </Button>
        </DialogActions>
      </Dialog>
      <PinDialog open={unlockOpen} title="Unlock Aisha’s payments" onClose={() => setUnlockOpen(false)} onSubmit={unlock} />
    </Stack>
  );
}

export function SponsorFamily() {
  const { sponsor: s, refresh, toast, frame } = useStore();
  const t = useTheme();
  const [edit, setEdit] = useState(false);
  const [single, setSingle] = useState('');
  const [daily, setDaily] = useState('');
  const [err, setErr] = useState('');
  const [pinOpen, setPinOpen] = useState(false);

  if (!s) return <Skeleton variant="rounded" height={300} sx={{ m: 2, borderRadius: '24px' }} />;

  const ceiling = s.kyc?.limit_ceiling;
  const review = () => {
    const sv = Number(single);
    const dv = Number(daily);
    if (!(sv > 0) || !(dv > 0)) return setErr('Enter two positive amounts.');
    if (sv > dv) return setErr('The single-payment limit can’t be higher than the 24-hour limit.');
    if (ceiling && (sv > ceiling.single_cad || dv > ceiling.daily_cad))
      return setErr(`Aisha’s identity check allows up to ${money(ceiling.single_cad, 'CAD', { decimals: 0 })} per payment and ${money(ceiling.daily_cad, 'CAD', { decimals: 0 })} per day.`);
    setErr('');
    setPinOpen(true);
  };
  const save = async (pin: string) => {
    await api.setLimits(Number(single), Number(daily), pin);
    setPinOpen(false);
    setEdit(false);
    toast('Limits updated.');
    await refresh();
  };

  return (
    <Stack spacing={2} sx={{ px: 2, pb: 3 }}>
      <Box sx={{ px: 0.5, pt: 0.5 }}>
        <Typography variant="h5">Money you fund</Typography>
        <Typography variant="body2" color="text.secondary">
          You can lock, set limits and approve; you can’t move Aisha’s money yourself.
        </Typography>
      </Box>

      <Box sx={{ borderRadius: '28px', bgcolor: t.m3.primary, color: t.m3.onPrimary, p: 2.5 }}>
        <Typography variant="overline" sx={{ opacity: 0.85 }}>
          In accounts you fund
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <Amount value={s.total_cad} currency="CAD" size={34} />
        </Box>
        <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
          ≈ MYR {(s.total_cad * 3.09).toLocaleString('en-MY', { maximumFractionDigits: 0 })} at today’s mid rate
        </Typography>
      </Box>

      <M3Card variant="outlined">
        <List disablePadding>
          {s.accounts.map((a, i) => (
            <Stack key={a.id} direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.5, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none' }}>
              <AccountGlyph currency={a.currency} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2">{a.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {a.number} · {a.currency === 'MYR' ? 'linked Malaysian account' : 'in Canada'}
                </Typography>
              </Box>
              <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(a.balance, a.currency)}
              </Typography>
            </Stack>
          ))}
        </List>
      </M3Card>

      <Box>
        <SectionHeader
          title="Spending limits"
          action={
            <Button
              size="small"
              startIcon={<TuneRoundedIcon />}
              onClick={() => {
                setSingle(String(s.limits.single_cad));
                setDaily(String(s.limits.daily_cad));
                setErr('');
                setEdit(true);
              }}
            >
              Edit
            </Button>
          }
        />
        <M3Card variant="filled" sx={{ bgcolor: t.m3.surfaceContainerLow }}>
          <CardContent>
            <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Single payment
                </Typography>
                <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {money(s.limits.single_cad, 'CAD', { decimals: 0 })}
                </Typography>
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Per 24 hours
                </Typography>
                <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {money(s.limits.daily_cad, 'CAD', { decimals: 0 })}
                </Typography>
              </Box>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Anything above these, from money you fund, or that looks risky comes to you for approval. The assistant can never change them; changes need your PIN.
            </Typography>
          </CardContent>
        </M3Card>
      </Box>

      {s.kyc && (
        <Box>
          <SectionHeader title="Identity checks" />
          <M3Card variant="outlined">
            {[
              ['Aisha', s.kyc.student],
              ['You', s.kyc.sponsor],
            ].map(([who, k], i) => {
              const kyc = k as NonNullable<typeof s.kyc>['student'];
              return (
                <Stack key={String(who)} direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.5, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none' }}>
                  <IconBadge tone="success" size={36}>
                    <VerifiedUserRoundedIcon />
                  </IconBadge>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2">{String(who)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      up to {money(kyc.max_single_cad, 'CAD', { decimals: 0 })} per payment
                    </Typography>
                  </Box>
                  <ToneChip tone="success" label={kyc.label} />
                </Stack>
              );
            })}
          </M3Card>
        </Box>
      )}

      {s.sharing && (
        <Alert severity="info" icon={<VisibilityRoundedIcon />}>
          <b>What you can see</b>
          <br />
          {s.sharing.summary.replace(/^Your sponsor sees/, 'You see')}
        </Alert>
      )}
      <PinDialog open={pinOpen} title={`Set limits to ${money(Number(single), 'CAD', { decimals: 0 })} / ${money(Number(daily), 'CAD', { decimals: 0 })} a day`} onClose={() => setPinOpen(false)} onSubmit={save} />

      <Dialog open={edit} onClose={() => setEdit(false)} container={frame} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { mx: 2 } } }}>
        <DialogTitle>Spending limits</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Single payment (CAD)" type="number" value={single} onChange={(e) => setSingle(e.target.value)} fullWidth />
            <TextField label="Per 24 hours (CAD)" type="number" value={daily} onChange={(e) => setDaily(e.target.value)} fullWidth />
            {err && <Alert severity="error">{err}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEdit(false)}>Cancel</Button>
          <Button variant="contained" onClick={review}>
            Continue
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
