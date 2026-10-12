// Student home: balance summary, quick actions, things waiting on her, runway + tuition alerts,
// accounts and a budget glance.
import { useState } from 'react';
import { Alert, Box, Button, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, List, ListItemButton, Skeleton, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CurrencyExchangeRoundedIcon from '@mui/icons-material/CurrencyExchangeRounded';
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import FamilyRestroomRoundedIcon from '@mui/icons-material/FamilyRestroomRounded';

import { api } from '../api';
import { RunwayChart } from '../components/charts';
import { AccountGlyph, BudgetView } from '../components/ResultCards';
import { Amount, IconBadge, M3Card, SectionHeader, ToneChip } from '../components/ui';
import { headline, longDate, money, shortDate, STATUS } from '../format';
import { useStore } from '../store';

const QUICK = [
  { label: 'Pay rent', icon: <HomeWorkRoundedIcon />, message: 'Pay rent to my landlord' },
  { label: 'Convert MYR', icon: <CurrencyExchangeRoundedIcon />, message: 'Cheapest way to change 5,000 MYR to CAD?' },
  { label: 'My runway', icon: <ShowChartRoundedIcon />, message: 'Will I run out of money before tuition is due?' },
  {
    label: 'Check a message',
    icon: <GppMaybeRoundedIcon />,
    message: 'I got a text: "This is the CRA. You owe $1,850 in back taxes. Pay today with Apple gift cards or police will arrest you." Is this real?',
  },
];

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Vancouver', hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home({ goTo }: { goTo: (tab: string) => void }) {
  const { overview: o, forecast: f, openAssistant, openReview, refresh, toast, error, frame } = useStore();
  const t = useTheme();
  const [lockOpen, setLockOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!o) {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Skeleton variant="rounded" height={170} sx={{ borderRadius: '28px' }} />
        <Skeleton variant="rounded" height={120} sx={{ borderRadius: '24px' }} />
        <Skeleton variant="rounded" height={220} sx={{ borderRadius: '24px' }} />
      </Stack>
    );
  }

  const next = o.tuition.installments[0];
  const covered = next ? Math.min(100, (o.tuition.tuition_fund_cad / next.amount) * 100) : 100;
  const runShort = f && f.verdict !== 'on_track' && f.first_shortfall_date;

  const lock = async () => {
    setBusy(true);
    try {
      await api.freeze();
      toast('All payments locked. Dad has been told.');
      setLockOpen(false);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unlock = async () => {
    setBusy(true);
    try {
      const r = await api.unfreeze();
      toast(r.note || 'Your payments are unlocked.');
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
        <Typography variant="h5">{greeting()}, Aisha</Typography>
        <Typography variant="body2" color="text.secondary">
          {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })} · Vancouver
        </Typography>
      </Box>

      {o.freeze.frozen && (
        <Alert
          severity="error"
          icon={<LockRoundedIcon />}
          action={
            o.freeze.own === 'student' ? (
              <Button color="inherit" size="small" onClick={unlock} disabled={busy} startIcon={<LockOpenRoundedIcon />}>
                Unlock
              </Button>
            ) : undefined
          }
        >
          <b>Payments are locked</b>
          <br />
          {o.freeze.own === 'sponsor' || o.freeze.sponsor_funded === 'sponsor' ? 'Dad locked some of your accounts.' : 'You locked your payments.'}{' '}
          Nothing can be confirmed until unlocked.
        </Alert>
      )}

      {/* Balance hero */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '28px',
          bgcolor: t.m3.primary,
          color: t.m3.onPrimary,
          p: 2.5,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            right: -60,
            top: -70,
            width: 220,
            height: 220,
            borderRadius: '50%',
            bgcolor: 'rgba(255,255,255,0.07)',
          }}
        />
        <Box aria-hidden sx={{ position: 'absolute', right: 30, bottom: -90, width: 160, height: 160, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.05)' }} />
        <Typography variant="overline" sx={{ opacity: 0.85 }}>
          Total balance
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <Amount value={o.total_cad} currency="CAD" size={38} />
        </Box>
        <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
          {o.accounts.length} accounts · 1 MYR = {o.rates['MYR/CAD']} CAD
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Chip
            size="small"
            icon={<FamilyRestroomRoundedIcon />}
            label={`${o.accounts.filter((a) => a.sponsor_funded).length} funded by Dad`}
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: 'inherit', '& .MuiChip-icon': { color: 'inherit' } }}
          />
          <Chip
            size="small"
            label={`Limit ${money(o.limits.single_cad, 'CAD', { decimals: 0 })} / payment`}
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: 'inherit' }}
          />
        </Stack>
      </Box>

      {/* Quick action (assist) chips */}
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', mx: -2, px: 2, pb: 0.5 }}>
        {QUICK.map((q) => (
          <Chip key={q.label} variant="outlined" icon={q.icon} label={q.label} onClick={() => openAssistant(q.message)} sx={{ flexShrink: 0, height: 36, '& .MuiChip-icon': { color: 'primary.main' } }} />
        ))}
        {!o.freeze.frozen && (
          <Chip
            variant="outlined"
            icon={<LockRoundedIcon />}
            label="Lock payments"
            onClick={() => setLockOpen(true)}
            sx={{ flexShrink: 0, height: 36, '& .MuiChip-icon': { color: 'error.main' } }}
          />
        )}
      </Stack>

      {/* Waiting on someone */}
      {o.pending.length > 0 && (
        <Box>
          <SectionHeader title="Waiting for action" action={<ToneChip tone="primary" label={o.pending.length} />} />
          <M3Card variant="outlined">
            <List disablePadding>
              {o.pending.map((a) => {
                const h = headline(a);
                const st = STATUS[a.status];
                return (
                  <ListItemButton key={a.action_id} onClick={() => openReview(a)} sx={{ px: 2, py: 1.5, borderRadius: 0, gap: 1.5 }}>
                    <IconBadge tone={a.status === 'awaiting_user' ? 'primary' : 'warning'}>
                      <HourglassTopRoundedIcon />
                    </IconBadge>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {h.big} <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary' }}>{h.sub}</Box>
                      </Typography>
                      <Typography variant="caption" color={a.status === 'awaiting_user' ? 'primary' : 'warning.main'} sx={{ fontWeight: 700 }}>
                        {st?.label ?? a.status} · {a.tier}
                      </Typography>
                    </Box>
                    <ChevronRightRoundedIcon color="action" />
                  </ListItemButton>
                );
              })}
            </List>
          </M3Card>
        </Box>
      )}

      {/* Alerts */}
      {(runShort || (next && o.tuition.next_shortfall_cad > 0)) && <SectionHeader title="Heads up" />}
      {runShort && f && (
        <M3Card variant="filled" sx={{ bgcolor: t.m3.errorContainer, color: t.m3.onErrorContainer }}>
          <CardContent>
            <Stack sx={{ alignItems: 'flex-start' }} direction="row" spacing={1.5}>
              <IconBadge tone="error">
                <TrendingDownRoundedIcon />
              </IconBadge>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1">Everyday runs short {shortDate(f.first_shortfall_date!)}</Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  At about {money(f.weekly_spending_cad, 'CAD', { decimals: 0 })}/week, the lowest point is {money(f.lowest.balance)} on {shortDate(f.lowest.date)}.
                </Typography>
              </Box>
            </Stack>
            <Box sx={{ mt: 1.5, mx: -0.5, bgcolor: 'rgba(255,255,255,0.55)', borderRadius: '16px', p: 1 }}>
              <RunwayChart f={f} compact height={64} />
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" color="error" size="small" onClick={() => goTo('insights')}>
                See runway
              </Button>
              <Button size="small" color="inherit" onClick={() => openAssistant('Will I run out of money before tuition is due?')}>
                Ask assistant
              </Button>
            </Stack>
          </CardContent>
        </M3Card>
      )}

      {next && (
        <M3Card variant="filled" sx={{ bgcolor: t.m3.tertiaryContainer, color: t.m3.onTertiaryContainer }}>
          <CardContent>
            <Stack sx={{ alignItems: 'flex-start' }} direction="row" spacing={1.5}>
              <IconBadge tone="tertiary">
                <SchoolRoundedIcon />
              </IconBadge>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1">
                  Tuition {money(next.amount, next.currency, { decimals: 0 })} due {shortDate(next.due)}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {next.term} · in {next.days_until_due} days
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1.5, mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                Tuition Fund {money(o.tuition.tuition_fund_cad, 'CAD', { decimals: 0 })}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {Math.round(covered)}% covered
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={covered} sx={{ bgcolor: 'rgba(255,255,255,0.6)', '& .MuiLinearProgress-bar': { bgcolor: t.m3.tertiary } }} />
            {o.tuition.next_shortfall_cad > 0 && (
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
                Short {money(o.tuition.next_shortfall_cad)}. Your MYR Wallet (~{money(o.tuition.myr_wallet_value_cad, 'CAD', { decimals: 0 })}) can cover it.
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                variant="contained"
                size="small"
                sx={{ bgcolor: t.m3.tertiary, '&:hover': { bgcolor: '#33507a' } }}
                onClick={() => openAssistant('Cover the tuition shortfall from my MYR wallet')}
              >
                Cover the gap
              </Button>
              <Button size="small" color="inherit" onClick={() => openAssistant('When is my tuition due?')}>
                Schedule
              </Button>
            </Stack>
          </CardContent>
        </M3Card>
      )}

      {/* Accounts */}
      <Box>
        <SectionHeader title="Accounts" />
        <M3Card variant="outlined">
          <List disablePadding>
            {o.accounts.map((a, i) => (
              <ListItemButton
                key={a.id}
                onClick={() => openAssistant('How much money do I have?')}
                sx={{ px: 2, py: 1.5, borderRadius: 0, gap: 1.5, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none' }}
              >
                <AccountGlyph currency={a.currency} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{a.label}</Typography>
                  <Stack sx={{ alignItems: 'center' }} direction="row" spacing={0.75}>
                    <Typography variant="caption" color="text.secondary">
                      {a.number}
                    </Typography>
                    {a.sponsor_funded && <ToneChip tone="secondary" label="Funded by Dad" sx={{ height: 20, fontSize: 11 }} />}
                  </Stack>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {money(a.balance, a.currency)}
                  </Typography>
                  {a.currency !== 'CAD' && (
                    <Typography variant="caption" color="text.secondary">
                      ≈ {money(a.balance * (o.rates['MYR/CAD'] ?? 0.32), 'CAD', { decimals: 0 })}
                    </Typography>
                  )}
                </Box>
              </ListItemButton>
            ))}
          </List>
        </M3Card>
      </Box>

      {/* Budget glance */}
      <Box>
        <SectionHeader
          title="This month"
          action={
            <Button size="small" endIcon={<ChevronRightRoundedIcon />} onClick={() => goTo('insights')}>
              Insights
            </Button>
          }
        />
        <M3Card variant="filled" sx={{ bgcolor: t.m3.surfaceContainerLow }}>
          <CardContent>
            <BudgetView c={o.budget} limit={4} />
          </CardContent>
        </M3Card>
      </Box>

      {next && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', pt: 1 }}>
          Next tuition {longDate(next.due)} · sandbox data, not a real bank
        </Typography>
      )}

      <Dialog open={lockOpen} onClose={() => setLockOpen(false)} maxWidth="xs" container={frame}>
        <DialogTitle>Lock all payments?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Use this if someone is pressuring you to pay. Nothing can be confirmed until it’s unlocked, and Dad gets an alert. You can unlock your own money here; money Dad funds stays locked until he unlocks it.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setLockOpen(false)}>Not now</Button>
          <Button variant="contained" color="error" onClick={lock} disabled={busy} startIcon={<LockRoundedIcon />}>
            Lock payments
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
