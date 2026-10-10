import { Box, Button, Group, Skeleton, Stack, Text } from '@mantine/core';
import { IconRefresh, IconRosetteDiscountCheck, IconShieldX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { api, useSource } from '../api/client';
import type { AuditEntry, Overview, TransactionsCard, Verify } from '../api/types';
import { LockArt } from '../components/Art';
import { BudgetBars, CategoryBadge } from '../components/ResultCards';
import { Big, Eyebrow, Sticker, Tile, useApp } from '../components/ui';
import { C, money, shortDate, shortMoney } from '../theme';

const ACCOUNT_BG = [C.sun, C.grapeSoft, C.mintSoft, C.skySoft];

const EVENT_WORDS: Record<string, string> = {
  user_message: 'Aisha asked something',
  assistant_reply: 'Assistant replied',
  tool_call: 'Assistant looked something up',
  tool_denied: 'Assistant was blocked from a tool',
  action_drafted: 'Assistant drafted a payment',
  action_confirmed: 'Aisha confirmed a payment',
  sponsor_approval_requested: 'Sent to Dad for approval',
  sponsor_approved: 'Dad approved',
  sponsor_rejected: 'Dad said no',
  sponsor_denied: 'Approval refused',
  action_executed: 'Money moved',
  action_cancelled: 'Cancelled',
  action_expired: 'Draft expired',
  action_failed: 'Payment failed',
  confirm_denied: 'Confirm refused',
  payments_frozen: 'Payments locked',
  payments_unfrozen: 'Payments unlocked',
  alert_raised: 'Safety alert raised',
  limits_changed: 'Dad changed limits',
  demo_reset: 'Demo reset',
};
const humanEvent = (e: string) => EVENT_WORDS[e] ?? e.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function Money() {
  const { refreshKey, bump } = useApp();
  const source = useSource();
  const [o, setO] = useState<Overview | null>(null);
  const [tx, setTx] = useState<TransactionsCard | null | undefined>(undefined);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.overview().then((x) => live && setO(x)).catch((e) => live && setErr((e as Error).message));
    api.auditVerify('student').then((v) => live && setVerify(v)).catch(() => {});
    api.audit('student').then((a) => live && setLog(a.entries.slice(-6).reverse())).catch(() => {});
    return () => {
      live = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    api.transactions().then(setTx).catch(() => setTx(null));
  }, []);

  const lock = async () => {
    setBusy(true);
    try {
      if (o?.freeze.frozen) await api.unfreeze();
      else await api.freeze();
      bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await api.reset();
      bump();
    } finally {
      setBusy(false);
    }
  };

  if (!o) return err ? <Tile bg={C.tomatoSoft} m={16}><Text fw={800}>{err}</Text></Tile> : <Stack p={16}><Skeleton h={300} radius="lg" /></Stack>;

  const b = o.budget;
  const over = b.categories.filter((c) => c.over_budget);

  return (
    <Stack gap={16} p={16} pb={28}>
      <Box>
        <Text className="hb-display" fz={28} fw={600} lh={1}>
          Money
        </Text>
        <Text fz={13.5} fw={700} c={C.inkSoft} mt={4}>
          Accounts, spending and a ledger nobody can quietly edit.
        </Text>
      </Box>

      <Stack gap={10}>
        {o.accounts.map((a, i) => (
          <Tile key={a.id} bg={ACCOUNT_BG[i % ACCOUNT_BG.length]} p={14}>
            <Group justify="space-between" wrap="nowrap">
              <Box>
                <Text fw={900} fz={15}>
                  {a.label}
                </Text>
                <Text fz={12} fw={700} c={C.inkSoft}>
                  {a.number}
                </Text>
              </Box>
              <Stack gap={2} align="flex-end">
                <Big size={22}>{money(a.balance, a.currency)}</Big>
                <Sticker bg={a.sponsor_funded ? C.grape : '#fff'} rotate={a.sponsor_funded ? 2 : -2}>
                  <Text span fz={11} fw={900} c={a.sponsor_funded ? '#fff' : C.ink}>
                    {a.sponsor_funded ? 'Funded by Dad' : 'All yours'}
                  </Text>
                </Sticker>
              </Stack>
            </Group>
          </Tile>
        ))}
        <Text fz={12} fw={700} c={C.inkSoft}>
          Limits: {shortMoney(o.limits.single_cad)} per payment, {shortMoney(o.limits.daily_cad)} per 24h. Bigger ones go to Dad.
        </Text>
      </Stack>

      <Tile bg="#fff">
        <Group justify="space-between" mb={4} wrap="nowrap">
          <Box>
            <Eyebrow>Last {b.period_days} days</Eyebrow>
            <Text className="hb-display" fz={20} fw={600}>
              {shortMoney(b.total_spent_cad)} out · {shortMoney(b.income_cad)} in
            </Text>
          </Box>
        </Group>
        {over.length > 0 && (
          <Text fz={13} fw={800} mb={12}>
            {over.map((c) => c.category).join(' and ')} went over budget. Small fix, big runway.
          </Text>
        )}
        <BudgetBars b={b} />
        {b.possible_duplicate_charges.length > 0 && (
          <Box mt={12} className="hb-chunk-sm" p={10} style={{ background: C.sunSoft }}>
            <Text fz={13} fw={800}>
              {b.possible_duplicate_charges.join(', ')} might be charging you twice. Worth a look.
            </Text>
          </Box>
        )}
      </Tile>

      <Tile bg="#fff">
        <Group justify="space-between" mb={10} wrap="nowrap">
          <Box>
            <Eyebrow>Ledger</Eyebrow>
            <Text className="hb-display" fz={20} fw={600}>
              Recent activity
            </Text>
          </Box>
          {verify && (
            <Sticker bg={verify.ok ? C.mint : C.tomato} rotate={3}>
              <Group gap={4} wrap="nowrap">
                {verify.ok ? <IconRosetteDiscountCheck size={16} stroke={2.4} /> : <IconShieldX size={16} stroke={2.4} />}
                {verify.ok ? 'Audit verified' : 'Audit broken!'}
              </Group>
            </Sticker>
          )}
        </Group>
        {tx === undefined && <Skeleton h={200} radius="md" />}
        {tx === null && (
          <Text fz={13} fw={700} c={C.inkSoft}>
            Couldn't load transactions right now.
          </Text>
        )}
        {tx && (
          <Stack gap={10}>
            {tx.rows.map((r, i) => (
              <Group key={i} gap={10} wrap="nowrap">
                <CategoryBadge category={r.category} size={32} />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fz={14} fw={800} truncate>
                    {r.counterparty}
                  </Text>
                  <Text fz={11.5} fw={700} c={C.inkSoft}>
                    {shortDate(r.date)} · {r.category}
                  </Text>
                </Box>
                <Text fz={14.5} fw={600} className="hb-display" c={r.amount < 0 ? C.ink : 'mint.7'} style={{ whiteSpace: 'nowrap' }}>
                  {r.amount < 0 ? '−' : '+'}
                  {money(Math.abs(r.amount), r.currency)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
        {verify && (
          <Box mt={14} pt={12} style={{ borderTop: `2px dashed ${C.ink}` }}>
            <Text fz={12.5} fw={800}>
              {verify.count} audit entries, hash-chained. {verify.ok ? 'Every link checks out.' : `Broken at entry ${verify.broken_at}.`}
            </Text>
            {log.map((e) => (
              <Group key={e.seq} gap={8} wrap="nowrap" mt={6}>
                <Text fz={11} fw={900} c={C.inkSoft} w={30}>
                  #{e.seq}
                </Text>
                <Text fz={12.5} fw={700} style={{ flex: 1 }} truncate>
                  {humanEvent(e.event)}
                </Text>
                <Text fz={10.5} fw={700} c={C.inkSoft} ff="monospace">
                  {e.hash.slice(0, 8)}
                </Text>
              </Group>
            ))}
          </Box>
        )}
      </Tile>

      <Tile bg={o.freeze.frozen ? C.tomatoSoft : C.cream}>
        <Group wrap="nowrap" gap={12}>
          <LockArt size={48} locked={o.freeze.frozen} />
          <Box style={{ flex: 1 }}>
            <Text fw={900} fz={15}>
              {o.freeze.frozen ? 'Payments are locked' : 'Emergency lock'}
            </Text>
            <Text fz={12.5} fw={700} c={C.inkSoft}>
              {o.freeze.frozen
                ? o.freeze.sponsor_funded === 'sponsor'
                  ? 'Dad locked the money he funds. You can only unlock your own.'
                  : 'Nothing can be confirmed or approved until you unlock.'
                : 'Phone stolen or something feels off? Lock every payment in one tap.'}
            </Text>
          </Box>
        </Group>
        <Button mt={12} fullWidth color={o.freeze.frozen ? 'mint' : 'tomato'} loading={busy} onClick={lock}>
          {o.freeze.frozen ? 'Unlock my payments' : 'Lock everything now'}
        </Button>
      </Tile>

      <Group justify="center" gap={8}>
        <Button variant="subtle" color="ink" size="xs" leftSection={<IconRefresh size={14} />} onClick={reset} disabled={busy}>
          Reset demo data{source === 'demo' ? ' (offline)' : ''}
        </Button>
      </Group>
    </Stack>
  );
}
