import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { accountNote, api, type Account, type Action, type Alert, type Digest, type FreezeState } from '../api';
import { usePoll } from '../hooks';
import { ActionCard } from '../components/ActionCard';
import { cityTime, fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'plain' | 'gold'> = {
  executed: 'ok',
  rejected: 'danger',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'plain',
  expired: 'plain',
  awaiting_user: 'gold',
};

const ALERT_TITLE: Record<string, string> = {
  velocity: 'Several payments in an hour',
  first_large_payment: 'Large first payment to a payee',
  odd_hours: 'Activity at an unusual hour',
  failed_confirms: 'Repeated failed confirmations',
  student_freeze: 'Aisha locked her payments',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 70 }}>
      <Mono style={{ fontFamily: fonts.monoBold, fontSize: 18, color: tone ?? t.text }}>{value}</Mono>
      <Body style={{ fontSize: 11.5, color: t.muted, lineHeight: 15 }}>{label}</Body>
    </View>
  );
}

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
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const [total, setTotal] = useState(0);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [freeze, setFreeze] = useState<FreezeState | null>(null);
  const [sharing, setSharing] = useState('');

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
      setDigest(o.digest);
      setAlerts(o.alerts);
      setFreeze(o.freeze);
      setSharing(o.sharing?.summary ?? '');
      setError('');
    } catch {
      setError(api.unreachable);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  usePoll(refresh, active ? 3000 : 15000);

  const decide = (approve: boolean) => async (a: Action, note: string, pin = '') => {
    try {
      const r = await (approve ? api.approve(a.action_id, note, pin) : api.reject(a.action_id, note));
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
          Aisha is in Vancouver, where it’s {cityTime('America/Vancouver')}. You approve her large payments, new payees and spending
          from the money you send.
        </Body>
      </View>
      {error ? <Body style={{ color: t.danger }}>{error}</Body> : null}

      {freeze?.frozen && (
        <Surface tone="danger">
          <Row style={{ justifyContent: 'space-between' }}>
            <Eyebrow style={{ color: t.danger }}>Payments locked</Eyebrow>
            <Pill label={freeze.sponsor_funded === 'sponsor' || freeze.own === 'sponsor' ? 'BY YOU' : 'BY AISHA'} tone="danger" />
          </Row>
          <Body style={{ fontSize: 13, marginTop: 4 }}>
            Nothing can be confirmed or approved from {freeze.own ? 'any of Aisha’s accounts' : 'the accounts you fund'} until it’s unlocked in
            Rules. The AI cannot unlock it.
          </Body>
        </Surface>
      )}

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

      {digest && (
        <>
          <Display style={{ fontSize: 18, marginTop: 10 }}>Last 24 hours</Display>
          <Surface>
            <Row style={{ gap: 8, alignItems: 'flex-start' }}>
              <Stat label="drafted" value={String(digest.drafted)} />
              <Stat label="completed" value={String(digest.executed)} tone={t.ok} />
              <Stat label="stopped" value={String(digest.stopped)} tone={digest.stopped ? t.danger : undefined} />
              <Stat label={digest.money_out_scope === 'sponsor_funded' ? 'out of your funds' : 'money out'} value={money(digest.money_out_cad, 'CAD', 0)} />
            </Row>
            {digest.flagged.length > 0 && (
              <View style={{ marginTop: 12, gap: 4 }}>
                <Eyebrow style={{ color: t.danger }}>Flagged as risky</Eyebrow>
                {digest.flagged.map((f) => (
                  <Row key={f.action_id} style={{ justifyContent: 'space-between', gap: 10 }}>
                    <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                      {f.summary}
                    </Body>
                    <Mono style={{ fontSize: 11, color: t.danger }}>risk {f.risk_score}</Mono>
                  </Row>
                ))}
              </View>
            )}
          </Surface>
        </>
      )}

      {alerts.length > 0 && (
        <Surface tone="warn">
          <Row style={{ justifyContent: 'space-between' }}>
            <Eyebrow>Unusual activity</Eyebrow>
            <Pill label={String(alerts.length)} tone="gold" />
          </Row>
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
            For your information; nothing to approve. For 24 hours, Aisha’s new payments carry extra risk, so more of them come to you.
          </Body>
          {alerts.map((a, i) => (
            <View key={a.id} style={{ paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderColor: t.border, marginTop: i ? 0 : 6 }}>
              <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                <Body style={{ fontFamily: fonts.bodyBold, fontSize: 13, flex: 1 }}>{ALERT_TITLE[a.kind] ?? a.kind}</Body>
                <Mono style={{ fontSize: 11, color: t.faint }}>{cityTime('America/Vancouver', new Date(a.ts * 1000))} Vancouver</Mono>
              </Row>
              <Body style={{ fontSize: 12.5, color: t.muted, lineHeight: 18 }}>{a.message}</Body>
            </View>
          ))}
        </Surface>
      )}

      <Display style={{ fontSize: 18, marginTop: 10 }}>Accounts you fund</Display>
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
                {accountNote(a) ? `${accountNote(a)} · ` : ''}
                {a.number}
                {a.sponsor_funded ? ' · funded by you' : ''}
              </Mono>
            </View>
            <Mono style={{ fontSize: 14 }}>{money(a.balance, a.currency)}</Mono>
          </Row>
        ))}
        {sharing ? (
          <Body style={{ fontSize: 11.5, color: t.muted, marginTop: 6, lineHeight: 16 }}>
            Aisha agreed to share the accounts you fund, requests sent to you, safety alerts and a daily activity count. Her own CAD
            Everyday account, wages, spending and chat stay private.
          </Body>
        ) : null}
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
