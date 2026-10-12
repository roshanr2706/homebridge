// Activity: payment drafts and their status, plus the hash-chained audit ledger with a verified badge
// (GET /audit, /audit/verify, and ?tamper_seq= to show tamper detection).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CardContent, List, ListItemButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import GppBadRoundedIcon from '@mui/icons-material/GppBadRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import CurrencyExchangeRoundedIcon from '@mui/icons-material/CurrencyExchangeRounded';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';

import { api } from '../api';
import { IconBadge, M3Card, SectionHeader, ToneChip, type Tone } from '../components/ui';
import { clockTime, headline, STATUS, timeAgo } from '../format';
import { useStore } from '../store';
import type { Action, AuditEntry, Verify } from '../types';

const EVENT_TONE: Record<string, Tone> = {
  action_executed: 'success',
  sponsor_approved: 'success',
  action_confirmed: 'primary',
  action_drafted: 'tertiary',
  sponsor_approval_requested: 'warning',
  sponsor_rejected: 'error',
  confirm_denied: 'error',
  sponsor_denied: 'error',
  tool_denied: 'error',
  action_failed: 'error',
  rate_limited: 'warning',
  limits_changed: 'warning',
  payments_frozen: 'error',
  payments_unfrozen: 'warning',
  unfreeze_denied: 'error',
  alert_raised: 'warning',
};

function summary(e: AuditEntry): string {
  const d = e.data ?? {};
  if (e.event === 'tool_call') return `${d.tool} (${d.tier})${d.ok === false ? ' · refused' : ''}`;
  if (e.event === 'user_message') return `${d.chars} characters${d.guard?.length ? ` · flagged: ${d.guard.join(', ')}` : ''}`;
  if (e.event === 'assistant_reply') return d.tools?.length ? `used ${d.tools.join(', ')}` : 'no tools';
  if (e.event === 'action_drafted') return `${d.kind ?? ''} ${d.tier ?? ''}${d.risk !== undefined ? ` · risk ${d.risk}` : ''}`;
  if (e.event === 'limits_changed') return `single ${d.before?.single_cad} → ${d.after?.single_cad}, daily ${d.before?.daily_cad} → ${d.after?.daily_cad}`;
  if (e.event === 'payments_frozen') return `by ${d.by} · ${d.scope === 'all' ? 'everything' : 'sponsor-funded money'}`;
  if (e.event === 'payments_unfrozen') return `by ${d.by} · still locked: ${d.still_locked?.length ? d.still_locked.join(', ') : 'nothing'}`;
  if (e.event === 'alert_raised') return String(d.kind ?? '');
  if (d.action_id) return d.action_id + (d.reason ? ` · ${d.reason}` : '') + (d.note ? ` · “${d.note}”` : '');
  return '';
}

function Payments({ list, mode }: { list: Action[]; mode: 'student' | 'sponsor' }) {
  const { openReview } = useStore();
  const t = useTheme();
  if (!list.length) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'center', py: 6, color: 'text.secondary' }}>
        <InboxRoundedIcon sx={{ fontSize: 40, opacity: 0.6 }} />
        <Typography variant="body2">No payments yet. Ask the assistant to draft one.</Typography>
      </Stack>
    );
  }
  return (
    <M3Card variant="outlined">
      <List disablePadding>
        {[...list].reverse().map((a, i) => {
          const h = headline(a);
          const st = STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const };
          const label = mode === 'sponsor' && a.status === 'awaiting_sponsor' ? 'Needs your approval' : mode === 'sponsor' && a.status === 'awaiting_user' ? 'Aisha hasn’t confirmed' : st.label;
          return (
            <ListItemButton
              key={a.action_id}
              disabled={mode === 'sponsor'}
              onClick={() => openReview(a)}
              sx={{ px: 2, py: 1.5, gap: 1.5, borderRadius: 0, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none', '&.Mui-disabled': { opacity: 1 } }}
            >
              <IconBadge tone={st.tone === 'neutral' ? 'neutral' : st.tone} size={40}>
                {a.kind === 'conversion' ? <CurrencyExchangeRoundedIcon /> : <ReceiptLongRoundedIcon />}
              </IconBadge>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap>
                  {h.sub ? h.sub.replace(/^to /, '') : a.summary}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {timeAgo(a.created_at)} · {a.tier}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {h.big}
                </Typography>
                <ToneChip tone={st.tone === 'neutral' ? 'neutral' : st.tone} label={label} sx={{ height: 20, fontSize: 11, mt: 0.25 }} />
              </Box>
            </ListItemButton>
          );
        })}
      </List>
    </M3Card>
  );
}

function Ledger() {
  const { role, source, toast } = useStore();
  const t = useTheme();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [scope, setScope] = useState<{ visible: number; total: number } | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [tamper, setTamper] = useState<Verify | null>(null);
  const [limit, setLimit] = useState(30);

  const load = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([api.audit(role), api.auditVerify(role)]);
      setEntries(a.entries.slice().reverse());
      setScope({ visible: a.visible ?? a.entries.length, total: a.total ?? a.entries.length });
      setVerify(v);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [role, toast]);

  useEffect(() => {
    void load();
    if (source !== 'live') return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load, source]);

  const simulate = async () => {
    const target = entries.length > 3 ? entries[Math.floor(entries.length / 2)].seq : 0;
    try {
      setTamper(await api.auditVerify(role, target));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Stack spacing={2}>
      {verify && (
        <M3Card variant="filled" sx={{ bgcolor: verify.ok ? t.m3.successContainer : t.m3.errorContainer, color: verify.ok ? t.m3.onSuccessContainer : t.m3.onErrorContainer }}>
          <CardContent>
            <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1.5}>
              <Box sx={{ '& svg': { fontSize: 40 } }}>{verify.ok ? <VerifiedRoundedIcon /> : <GppBadRoundedIcon />}</Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1">{verify.ok ? 'Audit chain verified' : `Chain broken at #${verify.broken_at}`}</Typography>
                <Typography variant="body2">
                  {verify.count} entries, each sealed with the hash of the one before.
                </Typography>
              </Box>
            </Stack>
            {verify.head && (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 1.5, opacity: 0.85 }}>
                <LinkRoundedIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
                  head {verify.head.slice(0, 24)}…
                </Typography>
              </Stack>
            )}
            <Button size="small" color="inherit" variant="outlined" startIcon={<BugReportRoundedIcon />} sx={{ mt: 1.5, borderColor: 'currentColor' }} onClick={simulate}>
              Simulate tampering
            </Button>
          </CardContent>
        </M3Card>
      )}
      {tamper && (
        <Alert severity={tamper.ok ? 'error' : 'success'} onClose={() => setTamper(null)}>
          {tamper.ok
            ? 'Edit was not detected.'
            : `Edited a copy of entry #${tamper.simulated_tamper_seq}: verification fails at #${tamper.broken_at}. The real log is untouched.`}
        </Alert>
      )}
      <Box>
        <SectionHeader
          title="Ledger"
          action={
            <Typography variant="caption" color="text.secondary">
              {scope && scope.visible < scope.total ? `your view: ${scope.visible} of ${scope.total}` : 'newest first'}
            </Typography>
          }
        />
        {role === 'sponsor' && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.5, mb: 1 }}>
            You see decisions and events about the money you fund, never Aisha’s chat. The whole chain is still verified.
          </Typography>
        )}
        <M3Card variant="outlined">
          {entries.slice(0, limit).map((e, i) => {
            const hit = tamper && !tamper.ok && tamper.broken_at === e.seq;
            return (
              <Stack
                key={e.seq}
                direction="row"
                spacing={1.5}
                sx={{ px: 2, py: 1.25, borderTop: i ? `1px solid ${t.m3.outlineVariant}` : 'none', bgcolor: hit ? t.m3.errorContainer : 'transparent' }}
              >
                <Typography variant="caption" sx={{ width: 32, pt: 0.25, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  #{e.seq}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <ToneChip tone={EVENT_TONE[e.event] ?? 'neutral'} label={e.event.replace(/_/g, ' ')} sx={{ height: 20, fontSize: 11 }} />
                    <Typography variant="caption" color="text.secondary">
                      {e.actor} · {clockTime(e.ts)}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.25, wordBreak: 'break-word' }}>
                    {summary(e)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10.5 }}>
                    {e.prev.slice(0, 8)}… → {e.hash.slice(0, 8)}…{hit ? '  ✕ mismatch' : ''}
                  </Typography>
                </Box>
              </Stack>
            );
          })}
        </M3Card>
        {entries.length > limit && (
          <Button fullWidth sx={{ mt: 1 }} onClick={() => setLimit(limit + 40)}>
            Show older entries
          </Button>
        )}
      </Box>
    </Stack>
  );
}

export function Activity() {
  const { role, actions, sponsor } = useStore();
  const [tab, setTab] = useState<'payments' | 'audit'>('payments');
  const list = role === 'student' ? actions : sponsor?.recent ?? [];
  return (
    <Stack spacing={2} sx={{ px: 2, pb: 3 }}>
      <Box sx={{ px: 0.5, pt: 0.5 }}>
        <Typography variant="h5">Activity</Typography>
        <Typography variant="body2" color="text.secondary">
          {role === 'student' ? 'Everything your assistant drafted, and the tamper-evident record behind it.' : 'Aisha’s recent payments and the shared audit record.'}
        </Typography>
      </Box>
      <ToggleButtonGroup exclusive fullWidth value={tab} onChange={(_, v) => v && setTab(v)} aria-label="Activity view">
        <ToggleButton value="payments">Payments</ToggleButton>
        <ToggleButton value="audit">
          <VerifiedRoundedIcon sx={{ fontSize: 18, mr: 0.75 }} />
          Audit log
        </ToggleButton>
      </ToggleButtonGroup>
      {tab === 'payments' ? <Payments list={list} mode={role} /> : <Ledger />}
    </Stack>
  );
}
