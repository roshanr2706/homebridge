import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { accountNote, api, type Account, type Action, type Alert, type Digest, type FreezeState } from '../api';
import { usePoll } from '../hooks';
import { usePersonName } from '../account';
import { ActionCard } from '../components/ActionCard';
import { useT, type Key } from '../i18n';
import { cityTime, splitAmount, useFontSet, money, useSkin, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS_TONE: Record<string, 'ok' | 'danger' | 'plain' | 'gold'> = {
  executed: 'ok',
  in_transit: 'gold',
  rejected: 'danger',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'plain',
  expired: 'plain',
  awaiting_user: 'gold',
};

const ALERT_TITLE: Record<string, Key> = {
  velocity: 'alert.velocity',
  first_large_payment: 'alert.first_large_payment',
  odd_hours: 'alert.odd_hours',
  failed_confirms: 'alert.failed_confirms',
  student_freeze: 'alert.student_freeze',
  scam_message: 'alert.scam_message',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const t = useTheme();
  const fonts = useFontSet();
  return (
    <View style={{ flex: 1, minWidth: 70 }}>
      <Mono style={{ fontFamily: fonts.monoBold, fontSize: 18, color: tone ?? t.text }}>{value}</Mono>
      <Body style={{ fontSize: 11.5, color: t.muted, lineHeight: 15 }}>{label}</Body>
    </View>
  );
}

export function SponsorScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const { skin } = useSkin();
  const name = usePersonName('Rahman bin Ismail');
  const fonts = useFontSet();
  const tr = useT();
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
  const [sources, setSources] = useState<Account[]>([]);
  const [transit, setTransit] = useState<Action[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [q, o] = await Promise.all([api.sponsorQueue(), api.sponsorOverview()]);
      // Announce requests that arrived since the last poll (not the ones already there on first load).
      if (seen.current && activeRef.current) {
        const fresh = q.actions.filter((a) => !seen.current!.has(a.action_id));
        if (fresh.length) toast(tr('sp.newRequest'), tr.summary(fresh[fresh.length - 1].summary), 'info');
      }
      seen.current = new Set(q.actions.map((a) => a.action_id));
      setQueue(q.actions);
      setRecent(o.recent.filter((a) => a.status !== 'awaiting_sponsor').reverse());
      // Remittances he sent that haven't arrived yet: shown as cards with their timeline.
      setTransit(o.recent.filter((a) => a.status === 'in_transit').reverse());
      setSources(o.source_accounts ?? []);
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
  }, [toast, tr]);

  usePoll(refresh, active ? 3000 : 15000);

  const decide = (approve: boolean) => async (a: Action, note: string, pin = '', provider = '') => {
    try {
      const r = await (approve ? api.approve(a.action_id, note, pin, provider) : api.reject(a.action_id, note));
      if (r.status === 'failed' || r.status === 'blocked') toast(tr('sp.bankRefused'), String(r.result?.error ?? ''), 'danger');
      else if (r.status === 'in_transit') toast(tr('sp.sent'), tr.summary(a.summary), 'ok');
      else toast(tr(approve ? 'sp.approved' : 'sp.rejected'), tr.summary(a.summary), approve ? 'ok' : 'danger');
    } catch (e) {
      toast(tr('sp.cantRecord'), (e as Error).message, 'danger');
    }
    refresh();
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      {skin === 'superapp' ? (
        // Super-app: the sponsor's orange header with the three numbers he checks first.
        <View style={{ marginHorizontal: -16, marginTop: -16, backgroundColor: t.sponsorHeaderBg, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 }}>
          <Row style={{ gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Body style={{ color: t.headerText, fontFamily: fonts.bodyBold, fontSize: 16 }}>{name.slice(0, 1).toUpperCase()}</Body>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ color: t.headerText, fontFamily: fonts.display, fontSize: 18, lineHeight: 23 }}>{tr('sa.dadGuard')}</Body>
              <Body style={{ color: t.headerMuted, fontSize: 11.5, lineHeight: 15 }} numberOfLines={1}>
                {name} · {tr('sa.sponsoring')} · {tr('city.kl')} {cityTime('Asia/Kuala_Lumpur')}
              </Body>
            </View>
          </Row>
          <Row style={{ marginTop: 14, alignItems: 'flex-start' }}>
            {[
              { k: tr('sa.herTotal'), v: money(total, '', 2).trim() },
              { k: tr('sa.out24'), v: money(digest?.money_out_cad ?? 0, '', 0).trim() },
              { k: tr('sa.queue'), v: String(queue.length) },
            ].map((x) => (
              <View key={x.k} style={{ flex: 1 }}>
                <Body style={{ color: t.headerMuted, fontSize: 11, lineHeight: 15 }}>{x.k}</Body>
                <Mono style={{ color: t.headerText, fontFamily: fonts.monoBold, fontSize: 20, marginTop: 2 }}>{x.v}</Mono>
              </View>
            ))}
          </Row>
        </View>
      ) : (
        // Neo: greeting, then the money he looks after as a big number with small dim cents.
        <View style={{ paddingVertical: 6 }}>
          <Eyebrow>
            {tr('city.kl')} · {cityTime('Asia/Kuala_Lumpur')}
          </Eyebrow>
          <Display style={{ fontSize: 26, marginTop: 2 }}>{tr('sp.welcomeName', { name: name.split(' ')[0] })}</Display>
          <Body style={{ fontSize: 11, letterSpacing: 1.1, color: t.faint, fontFamily: fonts.bodyBold, textTransform: 'uppercase', marginTop: 14 }}>
            {tr('neo.funds')}
          </Body>
          <Row style={{ alignItems: 'flex-start', marginTop: 4 }}>
            <Body style={{ fontFamily: fonts.bodyMedium, fontSize: 20, lineHeight: 28, color: t.muted, marginRight: 4, marginTop: 4 }}>$</Body>
            <Body style={{ fontFamily: fonts.bodyBold, fontSize: 46, lineHeight: 50, letterSpacing: -2, fontVariant: ['tabular-nums'] }}>
              {splitAmount(total)[0]}
              <Body style={{ fontFamily: fonts.bodyMedium, fontSize: 23, color: t.faint }}>{splitAmount(total)[1]}</Body>
            </Body>
          </Row>
        </View>
      )}
      <Body style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{tr('sp.intro', { time: cityTime('America/Vancouver') })}</Body>
      {error ? <Body style={{ color: t.danger }}>{error}</Body> : null}

      {freeze?.frozen && (
        <Surface tone="danger">
          <Row style={{ justifyContent: 'space-between' }}>
            <Eyebrow style={{ color: t.danger }}>{tr('wal.locked')}</Eyebrow>
            <Pill label={tr(freeze.sponsor_funded === 'sponsor' || freeze.own === 'sponsor' ? 'sp.byYou' : 'sp.byAisha')} tone="danger" />
          </Row>
          <Body style={{ fontSize: 13, marginTop: 4 }}>
            {tr(freeze.own ? 'sp.lockedAll' : 'sp.lockedFunded')}
          </Body>
        </Surface>
      )}

      <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <Display style={{ fontSize: 18 }}>{tr('sp.waiting')}</Display>
        <Pill label={String(queue.length)} tone={queue.length ? 'gold' : 'plain'} />
      </Row>
      {queue.length === 0 ? (
        <Surface style={{ backgroundColor: t.sunken }}>
          <Body style={{ color: t.muted, fontSize: 14 }}>{tr('sp.nothing')}</Body>
        </Surface>
      ) : (
        queue.map((a) => <ActionCard key={a.action_id} action={a} mode="sponsor" onApprove={decide(true)} onReject={decide(false)} />)
      )}

      {transit.length > 0 && (
        <>
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Display style={{ fontSize: 18 }}>{tr('sp.onTheWay')}</Display>
            <Pill label={String(transit.length)} tone="gold" />
          </Row>
          {transit.map((a) => (
            <ActionCard key={a.action_id} action={a} mode="sponsor" />
          ))}
        </>
      )}

      {digest && (
        <>
          <Display style={{ fontSize: 18, marginTop: 10 }}>{tr('sp.last24')}</Display>
          <Surface>
            <Row style={{ gap: 8, alignItems: 'flex-start' }}>
              <Stat label={tr('sp.drafted')} value={String(digest.drafted)} />
              <Stat label={tr('sp.completed')} value={String(digest.executed)} tone={t.ok} />
              <Stat label={tr('sp.stopped')} value={String(digest.stopped)} tone={digest.stopped ? t.danger : undefined} />
              <Stat label={tr(digest.money_out_scope === 'sponsor_funded' ? 'sp.outFunds' : 'sp.moneyOut')} value={money(digest.money_out_cad, 'CAD', 0)} />
            </Row>
            {digest.flagged.length > 0 && (
              <View style={{ marginTop: 12, gap: 4 }}>
                <Eyebrow style={{ color: t.danger }}>{tr('sp.flagged')}</Eyebrow>
                {digest.flagged.map((f) => (
                  <Row key={f.action_id} style={{ justifyContent: 'space-between', gap: 10 }}>
                    <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                      {tr.summary(f.summary)}
                    </Body>
                    <Mono style={{ fontSize: 11, color: t.danger }}>{tr('sp.risk', { n: f.risk_score })}</Mono>
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
            <Eyebrow>{tr('sp.unusual')}</Eyebrow>
            <Pill label={String(alerts.length)} tone="gold" />
          </Row>
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
            {tr('sp.unusualNote')}
          </Body>
          {alerts.map((a, i) => (
            <View key={a.id} style={{ paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderColor: t.border, marginTop: i ? 0 : 6 }}>
              <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                <Body style={{ fontFamily: fonts.bodyBold, fontSize: 13, flex: 1 }}>{ALERT_TITLE[a.kind] ? tr(ALERT_TITLE[a.kind]) : a.kind}</Body>
                <Mono style={{ fontSize: 11, color: t.faint }}>{tr('sp.vancouverTime', { time: cityTime('America/Vancouver', new Date(a.ts * 1000)) })}</Mono>
              </Row>
              <Body style={{ fontSize: 12.5, color: t.muted, lineHeight: 18 }}>{(tr.lang === 'zh' && a.message_zh) || a.message}</Body>
            </View>
          ))}
        </Surface>
      )}

      {sources.map((s) => (
        <Surface key={s.id} style={{ marginTop: 10 }}>
          <Eyebrow>{tr('sp.yourAccount')}</Eyebrow>
          <Row style={{ justifyContent: 'space-between', paddingTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 14 }}>{tr.d(s.label)}</Body>
              <Mono style={{ fontSize: 11, color: t.faint }}>
                {tr('city.kl')} · {s.number}
              </Mono>
            </View>
            <Mono style={{ fontSize: 14 }}>{money(s.balance, s.currency)}</Mono>
          </Row>
        </Surface>
      ))}

      <Display style={{ fontSize: 18, marginTop: 10 }}>{tr('sp.accounts')}</Display>
      <Surface>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Eyebrow>{tr('sp.total')}</Eyebrow>
          <Mono style={{ fontFamily: fonts.monoBold }}>{money(total, 'CAD', 0)}</Mono>
        </Row>
        {accounts.map((a) => (
          <Row key={a.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 14 }}>{tr.d(a.label)}</Body>
              <Mono style={{ fontSize: 11, color: t.faint }}>
                {accountNote(a) ? `${tr.d(accountNote(a))} · ` : ''}
                {a.number}
                {a.sponsor_funded ? tr('sp.fundedByYou') : ''}
              </Mono>
            </View>
            <Mono style={{ fontSize: 14 }}>{money(a.balance, a.currency)}</Mono>
          </Row>
        ))}
        {sharing ? (
          <Body style={{ fontSize: 11.5, color: t.muted, marginTop: 6, lineHeight: 16 }}>
            {tr('sp.sharing')}
          </Body>
        ) : null}
      </Surface>

      <Display style={{ fontSize: 18, marginTop: 10 }}>{tr('sp.recent')}</Display>
      <Surface>
        {recent.length === 0 ? (
          <Body style={{ color: t.muted, fontSize: 14 }}>{tr('sp.noActivity')}</Body>
        ) : (
          recent.slice(0, 10).map((a, i) => (
            <Row key={a.action_id} style={{ justifyContent: 'space-between', gap: 10, paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderColor: t.border }}>
              <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                {tr.summary(a.summary)}
              </Body>
              <Pill label={tr.d(a.status).replace('_', ' ').toUpperCase()} tone={STATUS_TONE[a.status] ?? 'plain'} />
            </Row>
          ))
        )}
      </Surface>
    </ScrollView>
  );
}
