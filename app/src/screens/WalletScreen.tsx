import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { accountNote, api, type ForecastCard, type Overview } from '../api';
import { usePoll } from '../hooks';
import { BudgetCard, CreditCard, RunwayCard, TuitionCard, creditCardFromProfile } from '../components/ResultCards';
import { useT, type Key } from '../i18n';
import { stepUp } from '../stepUp';
import { amount, fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Button, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS: Record<string, Key> = { awaiting_user: 'wal.needsYou', awaiting_sponsor: 'wal.withSponsor' };

export function WalletScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [lockBusy, setLockBusy] = useState(false);
  const [o, setO] = useState<Overview | null>(null);
  const [runway, setRunway] = useState<ForecastCard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // The runway is a nice-to-have: if it fails, the wallet still shows everything else.
      const [ov, fc] = await Promise.all([api.overview(), api.forecast().catch(() => null)]);
      setO(ov);
      setRunway(fc);
      setNow(Date.now());
      setError('');
    } catch {
      setError(api.unreachable);
    } finally {
      setLoading(false);
    }
  }, []);

  usePoll(refresh, 2000, active);

  // Locking is one tap. Unlocking happens only here (never in the chat), asks for the device owner first,
  // and lifts only a lock Aisha set on her own money: what Dad funds stays locked until he unlocks it.
  const lock = async () => {
    setLockBusy(true);
    try {
      await api.freeze();
      toast(tr('wal.locked'), tr('wal.lockedBody'), 'danger');
      refresh();
    } catch (e) {
      toast(tr('wal.cantLock'), (e as Error).message, 'danger');
    } finally {
      setLockBusy(false);
    }
  };
  const unlock = async () => {
    setLockBusy(true);
    try {
      const check = await stepUp(tr('wal.unlockPrompt'));
      if (!check.ok) {
        toast(tr('wal.stillLocked'), tr('wal.nothingChanged', { reason: check.reason }), 'danger');
        return;
      }
      const r = await api.unfreeze();
      toast(tr('wal.unlocked'), tr.lang === 'zh' ? tr('wal.unlockedBody') : r.note || tr('wal.unlockedBody'), 'ok');
      refresh();
    } catch (e) {
      toast(tr('wal.cantUnlock'), (e as Error).message, 'danger');
    } finally {
      setLockBusy(false);
    }
  };

  if (!o) {
    return (
      <View style={{ padding: 24 }}>
        <Body style={{ color: error ? t.danger : t.muted }}>{error || tr('loading')}</Body>
      </View>
    );
  }

  const myr = o.accounts.filter((a) => a.currency === 'MYR').reduce((s, a) => s + a.balance, 0);
  const spendable = o.accounts.filter((a) => !a.sponsor_funded).reduce((s, a) => s + a.balance, 0);
  const credit = creditCardFromProfile(o.credit);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      {/* Hero: two homes, one total */}
      <View style={{ paddingVertical: 8 }}>
        <Eyebrow>{tr('wal.hero')}</Eyebrow>
        <Row style={{ alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
          <Mono style={{ fontSize: 16, color: t.muted, marginBottom: 6 }}>CAD</Mono>
          <Mono style={{ fontFamily: fonts.monoBold, fontSize: 40, letterSpacing: -1.5 }}>{amount(o.total_cad)}</Mono>
        </Row>
        <Body style={{ color: t.muted, fontSize: 13 }}>
          {tr('wal.heroSub', { spend: money(spendable, 'CAD'), myr: money(myr, 'MYR', 0), rate: o.rates['MYR/CAD'] })}
        </Body>
      </View>

      {o.freeze.frozen && (
        <Surface tone="danger">
          <Row style={{ justifyContent: 'space-between' }}>
            <Eyebrow style={{ color: t.danger }}>{tr('wal.locked')}</Eyebrow>
            <Pill label={tr('wal.lockedPill')} tone="danger" />
          </Row>
          <Body style={{ fontSize: 13, marginTop: 4 }}>
            {tr(o.freeze.own ? 'wal.lockedOwn' : 'wal.lockedFunded')}
            {tr('wal.lockedDraft')}
            {o.freeze.own === 'student'
              ? tr('wal.lockedStudent')
              : o.freeze.own === 'sponsor' || o.freeze.sponsor_funded === 'sponsor'
                ? tr('wal.lockedByDad')
                : tr('wal.onlyDad')}
          </Body>
          {o.freeze.own === 'student' && (
            <Button label={tr('wal.unlockOwn')} kind="ghost" busy={lockBusy} onPress={unlock} style={{ marginTop: 10 }} />
          )}
        </Surface>
      )}

      <View style={{ gap: 8 }}>
        {o.accounts.map((a) => (
          <Surface key={a.id} style={{ paddingVertical: 12 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Row style={{ gap: 8 }}>
                  <Body style={{ fontFamily: fonts.bodyBold }}>{tr.d(a.label)}</Body>
                  {a.sponsor_funded && <Pill label={tr('wal.fromDad')} tone="gold" />}
                </Row>
                <Mono style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>
                  {accountNote(a) ? `${tr.d(accountNote(a))} · ` : ''}
                  {a.number}
                </Mono>
              </View>
              <Mono style={{ fontSize: 17, fontFamily: fonts.monoBold }}>{money(a.balance, a.currency)}</Mono>
            </Row>
          </Surface>
        ))}
      </View>

      {o.pending.length > 0 && (
        <Surface tone="warn">
          <Eyebrow>{tr('wal.inProgress')}</Eyebrow>
          <View style={{ gap: 6, marginTop: 6 }}>
            {o.pending.map((a) => (
              <Row key={a.action_id} style={{ justifyContent: 'space-between', gap: 10 }}>
                <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                  {tr.summary(a.summary)}
                </Body>
                <Pill label={STATUS[a.status] ? tr(STATUS[a.status]) : a.status} tone={a.status === 'awaiting_user' ? 'accent' : 'gold'} />
              </Row>
            ))}
          </View>
        </Surface>
      )}

      <Surface>
        <TuitionCard c={{ type: 'tuition', ...o.tuition }} bare />
      </Surface>

      {runway && (
        <Surface>
          <RunwayCard c={runway} bare compact />
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 8 }}>{tr('wal.askRunway')}</Body>
        </Surface>
      )}

      <Surface>
        <BudgetCard c={{ ...o.budget, type: 'budget' }} bare />
      </Surface>

      {credit && <CreditCard c={credit} compact />}

      {o.reminders.length > 0 && (
        <Surface>
          <Eyebrow>{tr('wal.reminders')}</Eyebrow>
          {o.reminders.map((r) => (
            <Row key={r.id} style={{ gap: 10, marginTop: 8 }}>
              <Mono style={{ fontSize: 12, color: t.accent }}>{r.due}</Mono>
              <Body style={{ fontSize: 13, flex: 1 }}>{r.text}</Body>
            </Row>
          ))}
        </Surface>
      )}

      <Surface>
        <Eyebrow>{tr('wal.payees')}</Eyebrow>
        {o.payees.map((p) => {
          const left = p.usable_from ? Math.ceil(p.usable_from - now / 1000) : 0;
          const cooling = left > 0;
          return (
            <Row key={p.id} style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 14 }}>{p.name}</Body>
                <Mono style={{ fontSize: 11, color: t.faint }}>
                  {tr.d(p.kind)} · {p.currency} · {p.number}
                </Mono>
              </View>
              {p.status !== 'active' ? (
                <Pill label={tr.d(p.status).replace('_', ' ').toUpperCase()} tone={p.status === 'rejected' ? 'danger' : 'warn'} />
              ) : cooling ? (
                <Pill
                  label={tr('wal.cooling', { left: left >= 3600 ? `${Math.ceil(left / 3600)}H` : left >= 60 ? `${Math.ceil(left / 60)}M` : `${left}S` })}
                  tone="warn"
                />
              ) : null}
            </Row>
          );
        })}
      </Surface>

      <Surface style={{ backgroundColor: t.sunken }}>
        <Display style={{ fontSize: 17 }}>{tr('wal.rules')}</Display>
        <Body style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>
          {tr('wal.rulesBody', { single: money(o.limits.single_cad, 'CAD', 0), daily: money(o.limits.daily_cad, 'CAD', 0) })}
        </Body>
        {!o.freeze.frozen && (
          <Button
            label={tr('wal.lockButton')}
            kind="danger"
            busy={lockBusy}
            onPress={lock}
            style={{ marginTop: 12 }}
          />
        )}
      </Surface>
    </ScrollView>
  );
}
