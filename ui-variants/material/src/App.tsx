// Shell: a 390×844 phone frame centred on desktop (full-screen on phones) with an M3 top app bar,
// navigation bar, assistant FAB, role-switch drawer and the shared overlays.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Avatar,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Chip,
  Divider,
  Drawer,
  Fab,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import FamilyRestroomRoundedIcon from '@mui/icons-material/FamilyRestroomRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SignalCellularAltRoundedIcon from '@mui/icons-material/SignalCellularAltRounded';
import WifiRoundedIcon from '@mui/icons-material/WifiRounded';
import BatteryFullRoundedIcon from '@mui/icons-material/BatteryFullRounded';

import { api, retryLive } from './api';
import { ReviewSheet } from './components/ReviewSheet';
import { Activity } from './screens/Activity';
import { Assistant } from './screens/Assistant';
import { Home } from './screens/Home';
import { Insights } from './screens/Insights';
import { SponsorApprovals, SponsorFamily } from './screens/Sponsor';
import { useStore } from './store';
import type { Role } from './types';

type Tab = { key: string; label: string; icon: ReactElement; activeIcon: ReactElement; badge?: number };

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="10" fill="#006A6A" />
      <path d="M8 17.5l8-7 8 7V24h-5v-5h-6v5H8z" fill="#fff" />
      <path d="M5 26c4-2.5 18-2.5 22 0" stroke="#A6EFEE" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function PhoneStatusBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <Stack
      direction="row"
     
     
      sx={{ alignItems: 'center', justifyContent: 'space-between', display: { xs: 'none', sm: 'flex' }, px: 3.5, pt: 1.5, pb: 0.5, fontSize: 14, fontWeight: 700, color: 'text.primary' }}
    >
      <span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <Stack direction="row" spacing={0.5} sx={{ '& svg': { fontSize: 17 } }}>
        <SignalCellularAltRoundedIcon />
        <WifiRoundedIcon />
        <BatteryFullRoundedIcon sx={{ transform: 'rotate(90deg)' }} />
      </Stack>
    </Stack>
  );
}

export default function App() {
  const t = useTheme();
  const store = useStore();
  const { role, setRole, source, setFrame, overview, queue, openAssistant, snack, closeSnack, refresh, toast, frame } = store;
  const [tab, setTab] = useState('home');
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const tabs: Tab[] =
    role === 'student'
      ? [
          { key: 'home', label: 'Home', icon: <HomeOutlinedIcon />, activeIcon: <HomeRoundedIcon /> },
          { key: 'insights', label: 'Insights', icon: <InsightsRoundedIcon />, activeIcon: <InsightsRoundedIcon /> },
          {
            key: 'activity',
            label: 'Activity',
            icon: <ReceiptLongOutlinedIcon />,
            activeIcon: <ReceiptLongRoundedIcon />,
            badge: overview?.pending.filter((a) => a.status === 'awaiting_user').length,
          },
        ]
      : [
          { key: 'approvals', label: 'Approvals', icon: <TaskAltRoundedIcon />, activeIcon: <TaskAltRoundedIcon />, badge: queue.length },
          { key: 'family', label: 'Funds', icon: <FamilyRestroomRoundedIcon />, activeIcon: <FamilyRestroomRoundedIcon /> },
          { key: 'activity', label: 'Activity', icon: <ReceiptLongOutlinedIcon />, activeIcon: <ReceiptLongRoundedIcon /> },
        ];

  const switchRole = (r: Role) => {
    setRole(r);
    setTab(r === 'student' ? 'home' : 'approvals');
    setDrawer(false);
  };
  const goTo = (k: string) => {
    setTab(k);
    scroller.current?.scrollTo({ top: 0 });
  };
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [tab, role]);

  const screen =
    role === 'student' ? (
      tab === 'insights' ? <Insights /> : tab === 'activity' ? <Activity /> : <Home goTo={goTo} />
    ) : tab === 'family' ? (
      <SponsorFamily />
    ) : tab === 'activity' ? (
      <Activity />
    ) : (
      <SponsorApprovals />
    );

  const person = role === 'student' ? { initial: 'A', name: 'Aisha Rahman', sub: 'Student · UBC, Vancouver' } : { initial: 'R', name: 'Encik Rahman', sub: 'Sponsor · Kuala Lumpur' };

  const reset = async () => {
    setDrawer(false);
    try {
      await api.reset();
      toast('Demo data reset.');
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        p: { xs: 0, sm: 3 },
        background: { xs: t.m3.surface, sm: `radial-gradient(1200px 600px at 20% 10%, #E6F2F1 0%, #D3DFDE 60%, #C9D6D5 100%)` },
      }}
    >
      {/* Desktop caption beside the phone */}
      <Box sx={{ display: { xs: 'none', lg: 'block' }, maxWidth: 300 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 2 }}>
          <Logo />
          <Typography variant="h6">HomeBridge</Typography>
        </Stack>
        <Typography variant="h4" sx={{ mb: 1.5 }}>
          Family money across borders, calmly.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          An assistant that drafts, never sends. Aisha confirms every payment; big ones also need her dad in Kuala Lumpur.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Chip label="Student" onClick={() => switchRole('student')} icon={role === 'student' ? <CheckRoundedIcon /> : undefined} variant={role === 'student' ? 'filled' : 'outlined'} sx={role === 'student' ? { bgcolor: t.m3.secondaryContainer } : {}} />
          <Chip label="Sponsor" onClick={() => switchRole('sponsor')} icon={role === 'sponsor' ? <CheckRoundedIcon /> : undefined} variant={role === 'sponsor' ? 'filled' : 'outlined'} sx={role === 'sponsor' ? { bgcolor: t.m3.secondaryContainer } : {}} />
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 3 }}>
          Material 3 variant · FinTechathon 2026 · sandbox data, not a real bank
        </Typography>
      </Box>

      <Box
        ref={setFrame}
        sx={{
          position: 'relative',
          transform: 'translateZ(0)', // makes fixed-position overlays (sheets, dialogs, snackbars) stay inside the frame
          width: { xs: '100%', sm: 390 },
          height: { xs: '100dvh', sm: 844 },
          maxHeight: { sm: 'calc(100dvh - 48px)' },
          borderRadius: { xs: 0, sm: '48px' },
          border: { xs: 'none', sm: '10px solid #1A2121' },
          boxShadow: { xs: 'none', sm: '0 30px 80px rgba(0,40,40,.28), 0 0 0 2px #39403F' },
          bgcolor: t.m3.surface,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <Box sx={{ bgcolor: scrolled ? t.m3.surfaceContainer : t.m3.surface, transition: 'background-color .2s' }}>
          <PhoneStatusBar />
          {/* Small top app bar */}
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 1, height: 64 }}>
            <IconButton aria-label="Open menu" onClick={() => setDrawer(true)}>
              <MenuRoundedIcon />
            </IconButton>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
              <Logo />
              <Typography variant="h6" sx={{ fontSize: 19 }} noWrap>
                HomeBridge
              </Typography>
            </Stack>
            <Chip
              size="small"
              icon={source === 'fixtures' ? <CloudOffRoundedIcon /> : <CloudDoneRoundedIcon />}
              label={source === 'fixtures' ? 'Demo data' : source === 'live' ? 'Live' : '…'}
              onClick={
                source === 'fixtures'
                  ? async () => {
                      const s = await retryLive();
                      toast(s === 'live' ? 'Connected to the live backend.' : 'Backend still unreachable. Showing demo data.');
                      void refresh();
                    }
                  : undefined
              }
              sx={{
                bgcolor: source === 'fixtures' ? t.m3.warningContainer : t.m3.successContainer,
                color: source === 'fixtures' ? t.m3.onWarningContainer : t.m3.onSuccessContainer,
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
            <IconButton aria-label={`Signed in as ${person.name}. Switch profile`} onClick={() => setDrawer(true)}>
              <Avatar sx={{ width: 32, height: 32, fontSize: 14, fontWeight: 700, bgcolor: role === 'student' ? t.m3.primaryContainer : t.m3.tertiaryContainer, color: role === 'student' ? t.m3.onPrimaryContainer : t.m3.onTertiaryContainer }}>
                {person.initial}
              </Avatar>
            </IconButton>
          </Stack>
        </Box>

        <Box ref={scroller} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 8)} sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pb: role === 'student' ? 6 : 0 }}>
          {screen}
        </Box>

        {role === 'student' && (
          <Fab
            variant={scrolled ? 'circular' : 'extended'}
            aria-label="Open assistant"
            onClick={() => openAssistant()}
            sx={{ position: 'absolute', right: 16, bottom: 96, transition: 'all .2s' }}
          >
            <AutoAwesomeRoundedIcon />
            {!scrolled && 'Ask HomeBridge'}
          </Fab>
        )}

        {/* Navigation bar */}
        <BottomNavigation value={tab} onChange={(_, v) => setTab(v)} showLabels component="nav">
          {tabs.map((tb) => (
            <BottomNavigationAction
              key={tb.key}
              value={tb.key}
              label={tb.label}
              icon={
                <Box className="nav-indicator">
                  <Badge color="error" badgeContent={tb.badge || 0} invisible={!tb.badge}>
                    {tab === tb.key ? tb.activeIcon : tb.icon}
                  </Badge>
                </Box>
              }
            />
          ))}
        </BottomNavigation>

        {/* Navigation drawer: profile / role switch */}
        <Drawer anchor="left" open={drawer} onClose={() => setDrawer(false)} container={frame}>
          <Box sx={{ p: 2, pt: 3 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, mb: 3 }}>
              <Logo />
              <Typography variant="h6">HomeBridge</Typography>
            </Stack>
            <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
              Switch profile
            </Typography>
            <List>
              {(
                [
                  ['student', 'A', 'Aisha Rahman', 'Student · UBC, Vancouver', t.m3.primaryContainer, t.m3.onPrimaryContainer],
                  ['sponsor', 'R', 'Encik Rahman', 'Sponsor · Kuala Lumpur', t.m3.tertiaryContainer, t.m3.onTertiaryContainer],
                ] as const
              ).map(([r, init, name, sub, bg, fg]) => (
                <ListItemButton
                  key={r}
                  selected={role === r}
                  onClick={() => switchRole(r)}
                  sx={{ borderRadius: '28px', mb: 0.5, '&.Mui-selected': { bgcolor: t.m3.secondaryContainer } }}
                >
                  <ListItemIcon sx={{ minWidth: 48 }}>
                    <Avatar sx={{ width: 36, height: 36, bgcolor: bg, color: fg, fontWeight: 700, fontSize: 15 }}>{init}</Avatar>
                  </ListItemIcon>
                  <ListItemText primary={name} secondary={sub} slotProps={{ primary: { sx: { fontWeight: 700 } } }} />
                  {role === r && <CheckRoundedIcon fontSize="small" />}
                </ListItemButton>
              ))}
            </List>
            <Divider sx={{ my: 2 }} />
            <List>
              <ListItemButton sx={{ borderRadius: '28px' }} onClick={reset}>
                <ListItemIcon>
                  <RestartAltRoundedIcon />
                </ListItemIcon>
                <ListItemText primary="Reset demo" secondary="Restore the sandbox balances" />
              </ListItemButton>
            </List>
            <Box sx={{ px: 2, mt: 2 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {source === 'fixtures'
                  ? 'Showing demo data captured from the HomeBridge backend. Start the backend on :8000 and tap “Demo data” to go live.'
                  : 'Connected to the HomeBridge backend.'}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                Sandbox only · not a real bank
              </Typography>
            </Box>
          </Box>
        </Drawer>

        <Snackbar
          key={snack?.key}
          open={!!snack}
          autoHideDuration={3500}
          onClose={closeSnack}
          message={snack?.msg}
          sx={{ bottom: { xs: 96, sm: 96 }, left: 16, right: 16 }}
        />
        <ReviewSheet />
        <Assistant />
      </Box>
    </Box>
  );
}
