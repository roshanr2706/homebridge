import { Box, Button, Group, Modal, SimpleGrid, Skeleton, Stack, Text, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconBell, IconCheck, IconLock, IconLockOpen, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { api, DEMO_PIN } from '../api/client';
import type { Action, SponsorOverview } from '../api/types';
import { describe, StepTracker } from '../components/ActionCard';
import { AishaAvatar, DadAvatar, LockArt } from '../components/Art';
import { PinPad } from '../components/Overlays';
import { Big, Eyebrow, Sticker, Tile, useApp } from '../components/ui';
import { C, money, shortMoney } from '../theme';
import { klTime } from './Home';

// Plain-words versions of the policy engine's reasons, shown under "Why this came to you".
function plain(reason: string) {
  if (/single-payment limit/i.test(reason)) return `It's bigger than the ${reason.match(/CAD [\d,]+/)?.[0] ?? ''} per-payment limit you set.`;
  if (/24h limit/i.test(reason)) return `It would push today's total past your 24-hour limit. ${reason.match(/\(.*\)/)?.[0] ?? ''}`;
  if (/sponsor-funded/i.test(reason)) return `It comes out of money you fund${reason.match(/\((.*)\)/) ? ` (${reason.match(/\((.*)\)/)![1]})` : ''}.`;
  if (/new payee/i.test(reason)) return `It goes to someone new. ${reason}`;
  return reason;
}

const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Sponsor() {
  const { celebrate, refreshKey, bump } = useApp();
  const [o, setO] = useState<SponsorOverview | null>(null);
  const [queue, setQueue] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [approving, setApproving] = useState<Action | null>(null);
  const [rejecting, setRejecting] = useState<Action | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.sponsorOverview(), api.sponsorQueue()])
      .then(([ov, q]) => {
        if (!live) return;
        setO(ov);
        setQueue(q.actions);
        setErr(null);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (err) return <Tile bg={C.tomatoSoft} m={16}><Text fw={800}>{err}</Text></Tile>;
  if (!o || !queue)
    return (
      <Stack p={16} gap={12}>
        <Skeleton h={140} radius="lg" />
        <Skeleton h={260} radius="lg" />
      </Stack>
    );

  const frozen = o.freeze.frozen;
  const lock = async (scope: 'sponsor_funded' | 'all') => {
    setLockBusy(true);
    try {
      await api.sponsorFreeze(scope);
      bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLockBusy(false);
    }
  };
  const unlock = async () => {
    setLockBusy(true);
    try {
      await api.sponsorUnfreeze();
      bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLockBusy(false);
    }
  };
  const d = o.digest;

  return (
    <Stack gap={16} p={16} pb={28}>
      <Tile bg={C.grapeDeep}>
        <Group wrap="nowrap" gap={14}>
          <DadAvatar size={84} bg={C.sun} />
          <Box>
            <Eyebrow color="#fff">Sponsor mode · Kuala Lumpur · {klTime()}</Eyebrow>
            <Text className="hb-display" fz={24} fw={600} c="#fff" lh={1.1}>
              Hi Encik Rahman
            </Text>
            <Text fz={13} fw={700} c="#fff" style={{ opacity: 0.92 }}>
              {queue.length ? `Aisha needs your thumbs-up on ${queue.length} thing${queue.length > 1 ? 's' : ''}.` : 'Nothing needs you right now. Enjoy your teh tarik.'}
            </Text>
          </Box>
        </Group>
        <Group mt={14} gap={10} wrap="nowrap" className="hb-chunk-sm" p={10} style={{ background: '#fff' }}>
          <AishaAvatar size={36} />
          <Box style={{ flex: 1 }}>
            <Text fz={12} fw={800} c={C.inkSoft}>
              {o.student?.name ?? 'Aisha'} · UBC, Vancouver
            </Text>
            <Text className="hb-display" fz={20} fw={600}>
              {money(o.total_cad)}
            </Text>
          </Box>
          {frozen && <Sticker bg={C.tomato}>Locked</Sticker>}
        </Group>
      </Tile>

      <Box>
        <Text className="hb-display" fz={22} fw={600} mb={8}>
          Needs your thumbs-up
        </Text>
        {queue.length === 0 && (
          <Tile bg={C.mintSoft}>
            <Group gap={10}>
              <IconCheck size={22} stroke={3} />
              <Text fw={800}>All clear. You'll get a ping when something big comes up.</Text>
            </Group>
          </Tile>
        )}
        <Stack gap={12}>
          {queue.map((a) => (
            <ApprovalCard key={a.action_id} a={a} onApprove={() => setApproving(a)} onReject={() => setRejecting(a)} frozen={frozen} />
          ))}
        </Stack>
      </Box>

      <Tile bg={frozen ? C.tomatoSoft : '#fff'}>
        <Group wrap="nowrap" gap={12}>
          <LockArt size={46} locked={frozen} />
          <Box style={{ flex: 1 }}>
            <Text fw={900} fz={15}>
              {frozen ? 'Payments are locked' : 'Something feels off?'}
            </Text>
            <Text fz={12.5} fw={700} c={C.inkSoft}>
              {frozen
                ? `Locked by ${o.freeze.sponsor_funded === 'sponsor' || o.freeze.own === 'sponsor' ? 'you' : 'Aisha'}. Nothing can be confirmed or approved.`
                : "Lock the money you fund in one tap. Aisha's own money stays hers unless you lock everything."}
            </Text>
          </Box>
        </Group>
        {frozen ? (
          <Button mt={12} fullWidth color="mint" leftSection={<IconLockOpen size={18} />} loading={lockBusy} onClick={unlock}>
            Unlock
          </Button>
        ) : (
          <Group mt={12} grow>
            <Button color="tomato" leftSection={<IconLock size={18} />} loading={lockBusy} onClick={() => lock('sponsor_funded')}>
              Lock my funds
            </Button>
            <Button color="ink" variant="outline" bg="#fff" loading={lockBusy} onClick={() => lock('all')}>
              Lock all
            </Button>
          </Group>
        )}
      </Tile>

      <Box>
        <Group justify="space-between" mb={8}>
          <Text className="hb-display" fz={22} fw={600}>
            Last {d.window_hours}h digest
          </Text>
        </Group>
        <SimpleGrid cols={3} spacing={10}>
          <Stat label="Drafted" value={d.drafted} bg={C.sunSoft} />
          <Stat label="Went through" value={d.executed} bg={C.mintSoft} />
          <Stat label="Waiting on you" value={d.awaiting_sponsor} bg={C.grapeSoft} />
          <Stat label="Stopped" value={d.stopped} bg={C.tomatoSoft} />
          <Stat label="Alerts" value={d.alerts} bg={C.skySoft} />
          <Stat label="Money out" value={shortMoney(d.money_out_cad, '$')} bg="#fff" />
        </SimpleGrid>
        {d.flagged.length > 0 && (
          <Tile bg={C.sunSoft} mt={10} p={12}>
            <Eyebrow>Flagged</Eyebrow>
            {d.flagged.map((f) => (
              <Text key={f.action_id} fz={13} fw={700} mt={4}>
                • {f.summary} (risk {f.risk_score}, {f.status.replace('_', ' ')})
              </Text>
            ))}
          </Tile>
        )}
      </Box>

      <Tile bg="#fff">
        <Group gap={8} mb={8}>
          <IconBell size={20} stroke={2.4} />
          <Text className="hb-display" fz={19} fw={600}>
            Alerts
          </Text>
        </Group>
        {o.alerts.length === 0 ? (
          <Text fz={13} fw={700} c={C.inkSoft}>
            No alerts. Late-night payments, new payees and scam flags show up here.
          </Text>
        ) : (
          <Stack gap={8}>
            {o.alerts.map((al) => (
              <Group key={al.id} gap={8} wrap="nowrap" align="flex-start">
                <IconAlertTriangle size={18} color={al.weight >= 2 ? C.tomato : C.ink} style={{ flexShrink: 0, marginTop: 2 }} />
                <Box>
                  <Text fz={13} fw={800}>
                    {al.message}
                  </Text>
                  <Text fz={11} fw={700} c={C.inkSoft}>
                    {fmtTime(al.ts)}
                  </Text>
                </Box>
              </Group>
            ))}
          </Stack>
        )}
      </Tile>

      <Tile bg={C.cream}>
        <Eyebrow>Your rules</Eyebrow>
        <Text fz={13.5} fw={800} mt={4}>
          Anything over {shortMoney(o.limits.single_cad)} at once, or {shortMoney(o.limits.daily_cad)} in 24h, or from money you fund, comes to you first. New payees wait{' '}
          {Math.round((o.limits.payee_cooling_seconds ?? 60) / 60)} min before they can be paid.
        </Text>
      </Tile>

      <ApproveModal
        a={approving}
        onClose={() => setApproving(null)}
        onDone={(res) => {
          setApproving(null);
          bump();
          const dd = describe(res);
          if (res.status === 'executed') celebrate({ tone: 'done', title: 'Approved and sent!', body: `${dd.big} ${dd.sub ?? ''} is on its way. Aisha gets a ping.` });
          else if (res.status === 'failed')
            celebrate({ tone: 'blocked', title: 'Approved, but it bounced', body: String(res.result?.error ?? 'The account could not cover it yet. Nothing moved.') });
          else celebrate({ tone: 'waiting', title: 'Approved!', body: 'It will go through as soon as everything else checks out.' });
        }}
      />
      <RejectModal
        a={rejecting}
        onClose={() => setRejecting(null)}
        onDone={() => {
          setRejecting(null);
          bump();
        }}
      />
    </Stack>
  );
}

function Stat({ label, value, bg }: { label: string; value: number | string; bg: string }) {
  return (
    <Box className="hb-chunk-sm" p={10} style={{ background: bg }}>
      <Big size={22}>{value}</Big>
      <Text fz={11} fw={800} c={C.inkSoft} lh={1.2}>
        {label}
      </Text>
    </Box>
  );
}

function ApprovalCard({ a, onApprove, onReject, frozen }: { a: Action; onApprove: () => void; onReject: () => void; frozen: boolean }) {
  const d = describe(a);
  const why = a.sponsor_reasons?.length ? a.sponsor_reasons : a.risk_reasons;
  const signals = a.risk_signals ?? [];
  return (
    <Tile bg="#fff" p={0} className="hb-rise">
      <Box px={16} py={10} style={{ background: C.grapeSoft, borderBottom: `2.5px solid ${C.ink}` }}>
        <Text fw={900} fz={12.5}>
          {d.kind} · asked {fmtTime(a.created_at)}
        </Text>
      </Box>
      <Stack gap={12} p={16}>
        <Box>
          <Big size={32}>{d.big}</Big>
          {d.sub && (
            <Text fw={800} fz={15}>
              {d.sub}
            </Text>
          )}
          {a.params.memo && (
            <Text fz={12.5} fw={700} c={C.inkSoft}>
              “{a.params.memo}” · from {a.params.from_account}
            </Text>
          )}
        </Box>
        <Box className="hb-chunk-sm" p={12} style={{ background: C.sunSoft }}>
          <Eyebrow>Why this came to you</Eyebrow>
          {why.map((r) => (
            <Text key={r} fz={13} fw={700} mt={4}>
              • {plain(r)}
            </Text>
          ))}
        </Box>
        {signals.length > 0 && (
          <Box className="hb-chunk-sm" p={12} style={{ background: C.tomatoSoft }}>
            <Eyebrow>Risk signals · {a.risk_score}/100</Eyebrow>
            {signals.map((r) => (
              <Text key={r} fz={13} fw={700} mt={4}>
                • {r}
              </Text>
            ))}
          </Box>
        )}
        {a.warnings.map((w) => (
          <Text key={w} fz={12.5} fw={800} c="tomato.8">
            Heads up: {w}
          </Text>
        ))}
        <StepTracker a={a} mode="sponsor" />
        {(frozen || a.frozen) && (
          <Text fz={12.5} fw={800} c="tomato.7">
            Payments are locked. Unlock to approve.
          </Text>
        )}
        <Group grow>
          <Button color="tomato" variant="outline" bg="#fff" leftSection={<IconX size={18} stroke={3} />} onClick={onReject}>
            Not now
          </Button>
          <Button color="mint" leftSection={<IconCheck size={18} stroke={3} />} onClick={onApprove} disabled={frozen || !!a.frozen}>
            Approve
          </Button>
        </Group>
      </Stack>
    </Tile>
  );
}

function ApproveModal({ a, onClose, onDone }: { a: Action | null; onClose: () => void; onDone: (a: Action) => void }) {
  const [step, setStep] = useState<'note' | 'pin'>('note');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  if ((a?.action_id ?? null) !== current) {
    setCurrent(a?.action_id ?? null);
    setStep('note');
    setNote('');
    setErr(null);
  }
  const d = a ? describe(a) : null;
  const submit = async (pin: string) => {
    if (!a) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await api.approve(a.action_id, note, pin));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={!!a} onClose={onClose} title={step === 'note' ? 'Approve this?' : 'Enter your PIN'} size="sm">
      {a && d && step === 'note' && (
        <Stack gap={12}>
          <Box className="hb-chunk-sm" p={12} style={{ background: C.mintSoft }}>
            <Big size={26}>{d.big}</Big>
            <Text fw={800}>{d.sub}</Text>
          </Box>
          <Textarea label="Add a note for Aisha (optional)" placeholder="Study hard, sayang!" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={200} autosize minRows={2} />
          <Button color="mint" size="lg" onClick={() => setStep('pin')}>
            Continue to PIN
          </Button>
        </Stack>
      )}
      {a && step === 'pin' && (
        <Stack gap={10}>
          <Text fz={13.5} fw={700} ta="center">
            Approving {d?.big} {d?.sub}. Your PIN proves it's really you.
          </Text>
          <PinPad onSubmit={submit} busy={busy} error={err} hint={`Demo PIN: ${DEMO_PIN}`} />
          <Button variant="subtle" color="ink" size="xs" onClick={() => setStep('note')}>
            Back
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

const REJECT_NOTES = ['Call me first', 'Not this month', 'Use your own account', 'Looks wrong'];

function RejectModal({ a, onClose, onDone }: { a: Action | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = a ? describe(a) : null;
  const submit = async () => {
    if (!a) return;
    setBusy(true);
    setErr(null);
    try {
      await api.reject(a.action_id, note);
      setNote('');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={!!a} onClose={onClose} title="Say no, kindly" size="sm">
      {a && d && (
        <Stack gap={12}>
          <Text fz={14} fw={700}>
            {d.big} {d.sub} won't go through. Aisha sees your note.
          </Text>
          <Group gap={6}>
            {REJECT_NOTES.map((n) => (
              <button key={n} type="button" className="hb-chip" onClick={() => setNote(n)}>
                {n}
              </button>
            ))}
          </Group>
          <Textarea placeholder="Your note" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={200} autosize minRows={2} />
          {err && (
            <Text fz={13} fw={800} c="tomato.7">
              {err}
            </Text>
          )}
          <Button color="tomato" size="lg" loading={busy} onClick={submit}>
            Reject with note
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
