import { ActionIcon, Box, Button, Group, RingProgress, Skeleton, Stack, Text } from '@mantine/core';
import { IconArrowRight, IconEye, IconEyeOff, IconSparkles } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { ForecastCard, Overview } from '../api/types';
import { DadAvatar, Flame, GradCap, Hourglass, LockArt, ShieldArt, Squiggle } from '../components/Art';
import { RunwayChart, StreakDots } from '../components/Charts';
import { Big, Eyebrow, Sticker, Tile, useApp } from '../components/ui';
import { C, money, monthName, shortDate, shortMoney } from '../theme';

export const QUICK_ASKS = [
  'How much money do I have?',
  'Cheapest way to change 5,000 MYR to CAD?',
  'Will I run out of money before tuition is due?',
  "How's my credit?",
  'Pay rent to my landlord',
  'Pay my spring tuition',
];

export const SCAM_SAMPLE = "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'";

export function klTime() {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
  } catch {
    return '';
  }
}

export function Home({ goSponsor }: { goSponsor: () => void }) {
  const { ask, refreshKey, bump } = useApp();
  const [o, setO] = useState<Overview | null>(null);
  const [f, setF] = useState<ForecastCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hide, setHide] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockErr, setLockErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.overview(), api.forecast().catch(() => null)])
      .then(([ov, fc]) => {
        if (!live) return;
        setO(ov);
        setF(fc);
        setLoaded(true);
        setErr(null);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (err) return <Tile bg={C.tomatoSoft} m={16}><Text fw={800}>{err}</Text></Tile>;
  if (!o || !loaded) return <HomeSkeleton />;

  const next = o.tuition.installments.find((i) => !i.paid) ?? o.tuition.installments[0];
  const pct = next ? Math.min(100, Math.round((o.tuition.tuition_fund_cad / next.amount) * 100)) : 100;
  const gap = o.tuition.next_shortfall_cad;
  const credit = o.credit && o.credit.has_card ? o.credit : null;
  const waiting = o.pending.filter((p) => p.status === 'awaiting_sponsor');
  const mine = o.pending.filter((p) => p.status === 'awaiting_user');
  const frozen = o.freeze.frozen;
  const hidden = (s: string) => (hide ? '••••••' : s);

  const toggleLock = async () => {
    setLocking(true);
    setLockErr(null);
    try {
      if (frozen) await api.unfreeze();
      else await api.freeze();
      bump();
    } catch (e) {
      setLockErr((e as Error).message);
    } finally {
      setLocking(false);
    }
  };

  return (
    <Stack gap={14} p={16} pb={28}>
      <Box>
        <Text className="hb-display" fz={30} fw={600} lh={1}>
          Hey Aisha!
        </Text>
        <Squiggle width={110} />
        <Text fz={14} fw={700} c={C.inkSoft} mt={6}>
          Here's your money at a glance.
        </Text>
      </Box>

      {gap > 0 && next && (
        <Tile bg={C.coral} onClick={() => ask('Will I run out of money before tuition is due?')}>
          <Group wrap="nowrap" gap={12} align="flex-start">
            <Box style={{ flex: 1 }}>
              <Text className="hb-display" fz={20} fw={600} lh={1.15}>
                You're {shortMoney(gap)} short for {monthName(next.due)}. Here's the cheapest fix.
              </Text>
              <Text fz={13} fw={700} mt={6}>
                {f?.suggestions[0]?.split('. Cheapest')[0] ?? 'Top up your tuition fund before it is due'}.
              </Text>
            </Box>
            <ActionIcon size={42} color="sun" variant="filled" className="hb-press" aria-label="Show me the fix">
              <IconArrowRight size={22} stroke={3} color={C.ink} />
            </ActionIcon>
          </Group>
        </Tile>
      )}

      <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Balance */}
        <Tile bg={C.sun} style={{ gridColumn: 'span 2' }}>
          <Group justify="space-between" wrap="nowrap">
            <Eyebrow>All your money</Eyebrow>
            <ActionIcon variant="transparent" color="ink" onClick={() => setHide((h) => !h)} aria-label={hide ? 'Show balances' : 'Hide balances'}>
              {hide ? <IconEyeOff size={20} /> : <IconEye size={20} />}
            </ActionIcon>
          </Group>
          <Big size={38}>{hidden(money(o.total_cad))}</Big>
          <Text fz={12} fw={800} c={C.inkSoft} mt={2}>
            about, in CAD · 1 MYR = {o.rates['MYR/CAD']} CAD
          </Text>
          <Group gap={6} mt={12} wrap="wrap">
            {o.accounts.map((a) => (
              <Box key={a.id} className="hb-chunk-sm" px={10} py={6} style={{ background: a.sponsor_funded ? C.grapeSoft : '#fff', borderRadius: 14 }}>
                <Text fz={11} fw={800} c={C.inkSoft}>
                  {a.label}
                </Text>
                <Text fz={14} fw={600} className="hb-display">
                  {hidden(money(a.balance, a.currency, 0))}
                </Text>
              </Box>
            ))}
          </Group>
        </Tile>

        {/* Tuition goal ring */}
        <Tile bg={C.grapeSoft} onClick={() => ask('When is my tuition due and how much do I still need?')} style={{ gridRow: 'span 2' }}>
          <Eyebrow>Tuition goal</Eyebrow>
          <Box style={{ display: 'grid', placeItems: 'center' }} my={6}>
            <RingProgress
              size={132}
              thickness={16}
              roundCaps
              rootColor="#fff"
              sections={[{ value: pct, color: C.grape }]}
              label={
                <Box style={{ display: 'grid', placeItems: 'center' }}>
                  <GradCap size={34} />
                  <Text className="hb-display" fz={22} fw={600} lh={1}>
                    {pct}%
                  </Text>
                </Box>
              }
            />
          </Box>
          <Text fw={900} fz={14} lh={1.2}>
            {pct}% of {monthName(next?.due ?? '2027-01-01')}'s tuition
          </Text>
          <Text fz={12} fw={700} c={C.inkSoft} mt={4}>
            {gap > 0 ? `${shortMoney(gap)} to go · due ${shortDate(next.due)}` : 'Fully covered!'}
          </Text>
        </Tile>

        {/* Runway */}
        <Tile bg={C.mintSoft} onClick={() => ask('Will I run out of money before tuition is due?')} p={14}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Eyebrow>Runway</Eyebrow>
            <Hourglass size={28} />
          </Group>
          <Text fw={900} fz={14.5} lh={1.15} mt={2}>
            {!f ? 'Forecast unavailable' : f.first_shortfall_date ? `Cash lasts till ${shortDate(f.first_shortfall_date)}` : 'Covered to tuition'}
          </Text>
          <Box mt={6} style={{ background: '#fff', borderRadius: 12, border: `2px solid ${C.ink}`, overflow: 'hidden' }}>
            {f && <RunwayChart f={f} height={48} compact />}
          </Box>
        </Tile>

        {/* Credit streak */}
        <Tile bg={C.coralSoft} onClick={() => ask("How's my credit?")} p={14}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Eyebrow>Credit streak</Eyebrow>
            <Flame size={30} lit={!!credit && credit.on_time_streak > 0} />
          </Group>
          {credit ? (
            <>
              <Group gap={6} align="baseline">
                <Big size={32}>{credit.on_time_streak}</Big>
                <Text fz={12.5} fw={900}>
                  on time
                </Text>
              </Group>
              <Box mt={6}>
                <StreakDots history={credit.payment_history.map((p) => p.status)} size={20} />
              </Box>
              <Text fz={11.5} fw={800} c={C.inkSoft} mt={6}>
                {credit.statement ? `Next due ${shortDate(credit.statement.due_date)} · ` : ''}
                {credit.utilization_pct}% used
              </Text>
            </>
          ) : (
            <Text fz={13} fw={700}>
              No card yet
            </Text>
          )}
        </Tile>

        {/* Dad */}
        <Tile bg={C.grapeDeep} style={{ gridColumn: 'span 2' }} onClick={goSponsor}>
          <Group wrap="nowrap" gap={14}>
            <DadAvatar size={76} bg={C.sun} wave />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow color="#fff">Your sponsor · Dad</Eyebrow>
              <Text className="hb-display" fz={20} fw={600} c="#fff" lh={1.15}>
                {waiting.length > 0 ? `${waiting.length} waiting for Dad's thumbs-up` : "Dad's in the loop"}
              </Text>
              <Text fz={12.5} fw={700} c="#fff" mt={2} style={{ opacity: 0.92 }}>
                {waiting.length > 0 ? waiting.map((w) => w.summary.replace(/ from .*/, '')).join(' · ') : 'Big or unusual payments go to him first.'}
              </Text>
              <Group gap={6} mt={8}>
                <Sticker bg="#fff" rotate={-2}>
                  It's {klTime()} in KL
                </Sticker>
                <Sticker bg={C.mint} rotate={2}>
                  Linked
                </Sticker>
              </Group>
            </Box>
          </Group>
        </Tile>

        {/* Scam shield */}
        <Tile bg="#fff" onClick={() => ask(SCAM_SAMPLE)} p={14}>
          <ShieldArt size={46} />
          <Text fw={900} fz={14.5} mt={4} lh={1.15}>
            Scam shield is on
          </Text>
          <Text fz={12} fw={700} c={C.inkSoft} mt={2}>
            Got a sketchy text? Tap and I'll sniff it.
          </Text>
        </Tile>

        {/* Lock */}
        <Tile bg={frozen ? C.tomatoSoft : '#fff'} onClick={locking ? undefined : toggleLock} p={14}>
          <LockArt size={42} locked={frozen} />
          <Text fw={900} fz={14.5} mt={4} lh={1.15}>
            {frozen ? 'Payments locked' : 'Lost your phone?'}
          </Text>
          <Text fz={12} fw={700} c={C.inkSoft} mt={2}>
            {frozen ? (o.freeze.sponsor_funded === 'sponsor' ? 'Dad locked his funds. Tap to unlock yours.' : 'Tap to unlock.') : 'One tap locks every payment.'}
          </Text>
          {lockErr && (
            <Text fz={11.5} fw={800} c="tomato.7" mt={4}>
              {lockErr}
            </Text>
          )}
        </Tile>
      </Box>

      {mine.length > 0 && (
        <Tile bg={C.sunSoft}>
          <Text fw={900} fz={14}>
            {mine.length} draft{mine.length > 1 ? 's' : ''} waiting for you
          </Text>
          <Text fz={12.5} fw={700} c={C.inkSoft}>
            {mine.map((m) => m.summary).join(' · ')}. Confirm it in the chat before it expires.
          </Text>
        </Tile>
      )}

      <Box>
        <Group gap={6} mb={8}>
          <IconSparkles size={18} stroke={2.4} />
          <Text fw={900} fz={14}>
            Quick asks
          </Text>
        </Group>
        <Group gap={8}>
          {QUICK_ASKS.map((q) => (
            <button key={q} className="hb-chip" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </Group>
      </Box>
      <Button variant="subtle" color="ink" size="xs" onClick={() => ask('我的钱够用到学期末吗？')}>
        Try asking in Chinese: 我的钱够用到学期末吗？
      </Button>
    </Stack>
  );
}

function HomeSkeleton() {
  return (
    <Stack gap={14} p={16}>
      <Skeleton h={40} w={180} radius="xl" />
      <Skeleton h={110} radius="lg" />
      <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Skeleton h={150} radius="lg" style={{ gridColumn: 'span 2' }} />
        <Skeleton h={260} radius="lg" style={{ gridRow: 'span 2' }} />
        <Skeleton h={124} radius="lg" />
        <Skeleton h={124} radius="lg" />
      </Box>
    </Stack>
  );
}
