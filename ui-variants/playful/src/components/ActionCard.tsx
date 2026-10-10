import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconLock, IconShieldCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { Action } from '../api/types';
import { C, money } from '../theme';
import { DadAvatar } from './Art';
import { Big, Eyebrow, Row, Sticker, Tile, useApp } from './ui';

const KIND: Record<string, string> = {
  transfer: 'Payment',
  conversion: 'Currency swap',
  add_payee: 'New payee',
  topup: 'Ask Dad for money',
};

const isMove = (a: Action) => a.kind === 'conversion' && a.params.from_currency === a.params.to_currency;

export function describe(a: Action): { big: string; sub?: string; kind: string } {
  const p = a.params;
  const kind = isMove(a) ? 'Move between your accounts' : KIND[a.kind] ?? 'Action';
  if (isMove(a)) return { kind, big: money(p.amount, p.from_currency), sub: a.summary.replace(/^Move [^ ]+ [^ ]+ /, '') };
  if (a.kind === 'transfer') return { kind, big: money(p.amount, p.currency), sub: `to ${p.payee_name}` };
  if (a.kind === 'conversion') return { kind, big: money(p.amount, p.from_currency), sub: `→ about ${money(p.expected_receive, p.to_currency)}` };
  if (a.kind === 'topup') return { kind, big: money(p.amount, p.currency), sub: p.reason ? `for ${p.reason}` : undefined };
  if (a.kind === 'add_payee') return { kind, big: p.name, sub: `${p.kind} · ${p.currency} · ${p.number_masked}` };
  return { kind, big: a.summary };
}

export function tierWords(a: Action) {
  if (a.tier === 'T3' || (a.needs_sponsor_approval && a.kind !== 'topup'))
    return { label: 'You + Dad', bg: C.grapeDeep, text: 'After you confirm, Dad gets a ping to approve it from KL. Nothing moves until he says yes.' };
  if (a.tier === 'T1' || a.kind === 'topup') return { label: 'Dad decides', bg: C.grapeDeep, text: 'This goes straight to Dad. He can say yes, no, or add a note.' };
  return { label: 'Just you', bg: C.sun, text: "You're the only one who needs to tap Confirm. The assistant can draft, but it can never press this for you." };
}

type StepState = 'done' | 'current' | 'todo' | 'bad';
export function steps(a: Action, mode: 'student' | 'sponsor'): { label: string; state: StepState }[] {
  const bad = ['rejected', 'cancelled', 'expired', 'failed'].includes(a.status);
  const out: { label: string; state: StepState }[] = [{ label: 'Drafted', state: 'done' }];
  if (a.kind !== 'topup')
    out.push({
      label: mode === 'sponsor' ? 'Aisha confirmed' : 'You confirm',
      state: a.user_confirmed ? 'done' : a.status === 'awaiting_user' ? 'current' : bad ? 'bad' : 'todo',
    });
  if (a.needs_sponsor_approval)
    out.push({
      label: mode === 'sponsor' ? 'You approve' : 'Dad approves',
      state:
        a.sponsor_decision === 'approved' ? 'done' : a.sponsor_decision === 'rejected' ? 'bad' : a.status === 'awaiting_sponsor' ? 'current' : bad && a.user_confirmed ? 'bad' : 'todo',
    });
  out.push({ label: a.status === 'failed' ? 'Failed' : 'Done', state: a.status === 'executed' ? 'done' : a.status === 'failed' ? 'bad' : 'todo' });
  return out;
}

export function StepTracker({ a, mode }: { a: Action; mode: 'student' | 'sponsor' }) {
  const items = steps(a, mode);
  const fill = (s: StepState) => (s === 'done' ? C.mint : s === 'current' ? C.sun : s === 'bad' ? C.tomato : '#fff');
  return (
    <Box>
      <Group gap={0} wrap="nowrap">
        {items.map((s, i) => (
          <Group key={s.label} gap={0} wrap="nowrap" style={{ flex: i < items.length - 1 ? 1 : 0 }}>
            <Box
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: fill(s.state),
                border: `2.5px solid ${C.ink}`,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {s.state === 'done' && <IconCheck size={14} stroke={3.4} />}
              {s.state === 'bad' && <IconX size={14} stroke={3.4} />}
              {s.state === 'current' && <Box style={{ width: 7, height: 7, borderRadius: '50%', background: C.ink }} />}
            </Box>
            {i < items.length - 1 && <Box style={{ flex: 1, height: 4, background: s.state === 'done' ? C.ink : '#E4E2EB', borderRadius: 2, margin: '0 3px' }} />}
          </Group>
        ))}
      </Group>
      <Group gap={0} wrap="nowrap" mt={4}>
        {items.map((s, i) => (
          <Text
            key={s.label}
            fz={11}
            fw={s.state === 'current' ? 900 : 700}
            c={s.state === 'bad' ? 'tomato.7' : s.state === 'current' ? C.ink : C.inkSoft}
            style={{ flex: 1, textAlign: i === 0 ? 'left' : i === items.length - 1 ? 'right' : 'center' }}
          >
            {s.label}
          </Text>
        ))}
      </Group>
    </Box>
  );
}

function useCountdown(until: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.round(until - now));
}

const STATUS: Record<string, [string, string]> = {
  executed: ['Done! Money moved.', C.mint],
  awaiting_sponsor: ['Waiting for Dad', C.grapeSoft],
  rejected: ['Dad said not this time', C.tomatoSoft],
  cancelled: ['Cancelled. Nothing moved.', '#E4E2EB'],
  expired: ['Expired. Ask again if you still need it.', '#E4E2EB'],
  failed: ['Failed. Nothing moved.', C.tomatoSoft],
};

export function ActionCard({ action, onChange }: { action: Action; onChange: (a: Action) => void }) {
  const { celebrate, bump } = useApp();
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = action;
  const d = describe(a);
  const tier = tierWords(a);
  const left = useCountdown(a.expires_at, a.status === 'awaiting_user');
  const sponsorWhy = a.sponsor_reasons ?? [];
  const signals = a.risk_signals ?? a.risk_reasons.filter((r) => !sponsorWhy.includes(r));
  const frozen = a.frozen && ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? a.frozen : null;
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));
  const status = STATUS[a.status];

  const confirm = async () => {
    if (!a.confirm_token) return;
    setBusy('confirm');
    setErr(null);
    try {
      const out = await api.confirm(a.action_id, a.confirm_token);
      onChange(out);
      bump();
      if (out.status === 'executed') celebrate({ tone: 'done', title: 'Done and dusted!', body: `${d.big} ${d.sub ?? ''} went through. It's in your ledger and the audit log.` });
      else if (out.status === 'awaiting_sponsor')
        celebrate({ tone: 'waiting', title: 'Sent to Dad!', body: `You confirmed ${d.big} ${d.sub ?? ''}. Dad gets a ping to approve it. We'll show it here when he does.` });
      else if (out.status === 'failed') celebrate({ tone: 'blocked', title: "That didn't go through", body: (out.result?.error as string) ?? 'Nothing moved. Try again in a bit.' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    setBusy('cancel');
    setErr(null);
    try {
      onChange(await api.cancel(a.action_id));
      bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Tile bg="#fff" p={0} className="hb-rise">
      <Group justify="space-between" px={16} py={10} style={{ background: tier.bg, borderBottom: `2.5px solid ${C.ink}` }} wrap="nowrap">
        <Text fw={900} fz={13} c={tier.bg === C.grapeDeep ? '#fff' : C.ink}>
          {d.kind} · needs your OK
        </Text>
        <Sticker bg="#fff" rotate={3}>
          {tier.label}
        </Sticker>
      </Group>
      <Stack gap={12} p={16}>
        <Box>
          <Big size={34}>{d.big}</Big>
          {d.sub && (
            <Text fw={800} fz={15} mt={2}>
              {d.sub}
            </Text>
          )}
        </Box>
        <Box>
          {a.kind === 'transfer' && <Row label="From" value={a.params.from_account} />}
          {a.kind === 'transfer' && a.params.memo && <Row label="Memo" value={a.params.memo} />}
          {a.kind === 'conversion' && !isMove(a) && <Row label="Rate" value={`${a.params.rate} ${a.params.to_currency} per ${a.params.from_currency}`} />}
          {isMove(a) && <Row label="Fee" value="None, it's your own money" />}
        </Box>

        <Box className="hb-chunk-sm" p={12} style={{ background: a.tier === 'T3' ? C.grapeSoft : C.sunSoft }}>
          <Group gap={10} wrap="nowrap" align="flex-start">
            {a.needs_sponsor_approval ? <DadAvatar size={40} /> : <IconShieldCheck size={28} stroke={2.2} style={{ flexShrink: 0 }} />}
            <Box>
              <Text fw={900} fz={13.5}>
                Who signs off: {tier.label}
              </Text>
              <Text fz={12.5} fw={700}>
                {tier.text}
              </Text>
            </Box>
          </Group>
          {sponsorWhy.length > 0 && (
            <Box mt={10}>
              <Eyebrow>Why Dad sees this one</Eyebrow>
              {sponsorWhy.map((r) => (
                <Text key={r} fz={12.5} fw={700} mt={3}>
                  • {r}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        {signals.length > 0 && (
          <Box className="hb-chunk-sm" p={12} style={{ background: C.tomatoSoft }}>
            <Group gap={6}>
              <IconAlertTriangle size={18} stroke={2.4} />
              <Text fw={900} fz={13.5}>
                Risk check: {a.risk_score}/100
              </Text>
            </Group>
            {signals.map((r) => (
              <Text key={r} fz={12.5} fw={700} mt={3}>
                • {r}
              </Text>
            ))}
          </Box>
        )}
        {a.risk_score < 40 && signals.length === 0 && a.status === 'awaiting_user' && (
          <Group gap={6}>
            <IconShieldCheck size={18} color={C.mint} stroke={2.6} />
            <Text fz={12.5} fw={800}>
              Risk check passed ({a.risk_score}/100). Known payee, normal amount.
            </Text>
          </Group>
        )}
        {warnings.map((w) => (
          <Box key={w} className="hb-chunk-sm" p={10} style={{ background: C.sunSoft }}>
            <Text fz={12.5} fw={800}>
              Heads up: {w}
            </Text>
          </Box>
        ))}
        {frozen && (
          <Group gap={8} className="hb-chunk-sm" p={10} style={{ background: C.tomatoSoft }} wrap="nowrap">
            <IconLock size={18} />
            <Text fz={12.5} fw={800}>
              {frozen}
            </Text>
          </Group>
        )}

        <StepTracker a={a} mode="student" />

        {status && (
          <Box className="hb-chunk-sm" p={10} style={{ background: status[1] }}>
            <Text fw={900} fz={14}>
              {status[0]}
            </Text>
            {a.status === 'failed' && a.result?.error && (
              <Text fz={12.5} fw={700}>
                {String(a.result.error)}
              </Text>
            )}
            {a.sponsor_note && (
              <Text fz={12.5} fw={700}>
                Dad's note: “{a.sponsor_note}”
              </Text>
            )}
          </Box>
        )}
        {err && (
          <Text fz={13} fw={800} c="tomato.7">
            {err}
          </Text>
        )}
        {a.status === 'awaiting_user' && (
          <Stack gap={8}>
            <Button size="lg" fullWidth color="coral" loading={busy === 'confirm'} disabled={!!frozen || !a.confirm_token || busy !== null} onClick={confirm} leftSection={<IconCheck size={22} stroke={3} />}>
              Confirm {d.big}
            </Button>
            <Group justify="space-between">
              <Text fz={12} fw={700} c={C.inkSoft}>
                Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </Text>
              <Button variant="subtle" color="ink" size="xs" onClick={cancel} loading={busy === 'cancel'} disabled={busy !== null}>
                Not now, cancel
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Tile>
  );
}
