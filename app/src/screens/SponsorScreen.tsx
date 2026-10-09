import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { api, type Account, type Action } from '../api';
import { ActionCard } from '../components/ActionCard';
import { cityTime, fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'plain' | 'gold'> = {
  executed: 'ok',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'plain',
  expired: 'plain',
  awaiting_user: 'gold',
};

export function SponsorScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const toast = useToast();
  const [queue, setQueue] = useState<Action[]>([]);
  const [recent, setRecent] = useState<Action[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [total, setTotal] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [q, o] = await Promise.all([api.sponsorQueue(), api.sponsorOverview()]);
      // Announce requests that arrived since the last poll (not the ones already there on first load).
      if (seen.current && activeRef.current) {
        const fresh = q.actions.filter((a) => !seen.current!.has(a.action_id));
        if (fresh.length) toast('New request from Aisha', fresh[fresh.length - 1].summary, 'info');
      }
      seen.current = new Set(q.actions.map((a) => a.action_id));
      setQueue(q.actions);
      setRecent(o.recent.filter((a) => a.status !== 'awaiting_sponsor').reverse());
      setAccounts(o.accounts);
      setTotal(o.total_cad);
      setError('');
    } catch {
      setError(`Can't reach the server at ${api.base}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const decide = (approve: boolean) => async (a: Action, note: string) => {
    try {
      const r = await (approve ? api.approve(a.action_id, note) : api.reject(a.action_id, note));
      if (r.status === 'failed') toast('Approved, but the bank refused it', String(r.result?.error ?? ''), 'danger');
      else toast(approve ? 'Approved' : 'Rejected', a.summary, approve ? 'ok' : 'danger');
    } catch (e) {
      toast('Could not record that', (e as Error).message, 'danger');
    }
    refresh();
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      <View style={{ paddingVertical: 6 }}>
        <Eyebrow>Kuala Lumpur · {cityTime('Asia/Kuala_Lumpur')}</Eyebrow>
        <Display style={{ fontSize: 26, marginTop: 2 }}>Selamat datang, Encik Rahman</Display>
        <Body style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
          Aisha is in Vancouver, where it's {cityTime('America/Vancouver')}. You approve her large payments, new payees and spending
          from the money you send.
        </Body>
      </View>
      {error ? <Body style={{ color: t.danger }}>{error}</Body> : null}

      <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <Display style={{ fontSize: 18 }}>Waiting for you</Display>
        <Pill label={String(queue.length)} tone={queue.length ? 'gold' : 'plain'} />
      </Row>
      {queue.length === 0 ? (
        <Surface style={{ backgroundColor: t.sunken }}>
          <Body style={{ color: t.muted, fontSize: 14 }}>Nothing to approve right now. New requests show up here within a few seconds.</Body>
        </Surface>
      ) : (
        queue.map((a) => <ActionCard key={a.action_id} action={a} mode="sponsor" onApprove={decide(true)} onReject={decide(false)} />)
      )}

      <Display style={{ fontSize: 18, marginTop: 10 }}>Aisha's accounts</Display>
      <Surface>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Eyebrow>Total, about</Eyebrow>
          <Mono style={{ fontFamily: fonts.monoBold }}>{money(total, 'CAD', 0)}</Mono>
        </Row>
        {accounts.map((a) => (
          <Row key={a.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 14 }}>{a.label}</Body>
              <Mono style={{ fontSize: 11, color: t.faint }}>
                {a.number}
                {a.sponsor_funded ? ' · funded by you' : ''}
              </Mono>
            </View>
            <Mono style={{ fontSize: 14 }}>{money(a.balance, a.currency)}</Mono>
          </Row>
        ))}
      </Surface>

      <Display style={{ fontSize: 18, marginTop: 10 }}>Recent activity</Display>
      <Surface>
        {recent.length === 0 ? (
          <Body style={{ color: t.muted, fontSize: 14 }}>No activity yet.</Body>
        ) : (
          recent.slice(0, 10).map((a, i) => (
            <Row key={a.action_id} style={{ justifyContent: 'space-between', gap: 10, paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderColor: t.border }}>
              <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                {a.summary}
              </Body>
              <Pill label={a.status.replace('_', ' ').toUpperCase()} tone={STATUS_TONE[a.status] ?? 'plain'} />
            </Row>
          ))
        )}
      </Surface>
    </ScrollView>
  );
}
