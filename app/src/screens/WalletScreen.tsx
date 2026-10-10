import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { api, type ForecastCard, type Overview } from '../api';
import { usePoll } from '../hooks';
import { BudgetCard, CreditCard, RunwayCard, TuitionCard, creditCardFromProfile } from '../components/ResultCards';
import { stepUp } from '../stepUp';
import { amount, fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Button, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS: Record<string, string> = { awaiting_user: 'needs your confirmation', awaiting_sponsor: 'with your sponsor' };

export function WalletScreen({ active }: { active: boolean }) {
  const t = useTheme();
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
      toast('Payments locked', 'Nothing can be confirmed until they’re unlocked. Dad has been alerted.', 'danger');
      refresh();
    } catch (e) {
      toast("Couldn't lock", (e as Error).message, 'danger');
    } finally {
      setLockBusy(false);
    }
  };
  const unlock = async () => {
    setLockBusy(true);
    try {
      const check = await stepUp('Unlock your own money');
      if (!check.ok) {
        toast('Still locked', `${check.reason} Nothing changed.`, 'danger');
        return;
      }
      const r = await api.unfreeze();
      toast('Your own money is unlocked', r.note || 'You can confirm payments again.', 'ok');
      refresh();
    } catch (e) {
      toast("Couldn't unlock", (e as Error).message, 'danger');
    } finally {
      setLockBusy(false);
    }
  };

  if (!o) {
    return (
      <View style={{ padding: 24 }}>
        <Body style={{ color: error ? t.danger : t.muted }}>{error || 'Loading…'}</Body>
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
        <Eyebrow>Everything you have, in CAD</Eyebrow>
        <Row style={{ alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
          <Mono style={{ fontSize: 16, color: t.muted, marginBottom: 6 }}>CAD</Mono>
          <Mono style={{ fontFamily: fonts.monoBold, fontSize: 40, letterSpacing: -1.5 }}>{amount(o.total_cad)}</Mono>
        </Row>
        <Body style={{ color: t.muted, fontSize: 13 }}>
          {money(spendable, 'CAD')} is yours to spend · {money(myr, 'MYR', 0)} sits in ringgit · 1 MYR = {o.rates['MYR/CAD']} CAD
        </Body>
      </View>

      {o.freeze.frozen && (
        <Surface tone="danger">
          <Row style={{ justifyContent: 'space-between' }}>
            <Eyebrow style={{ color: t.danger }}>Payments locked</Eyebrow>
            <Pill label="LOCKED" tone="danger" />
          </Row>
          <Body style={{ fontSize: 13, marginTop: 4 }}>
            {o.freeze.own ? 'Nothing can leave your accounts' : 'Nothing can leave the accounts Dad funds'}. You can still ask me to draft
            payments, but they can’t be confirmed until they’re unlocked.{' '}
            {o.freeze.own === 'student'
              ? 'You can unlock your own money below. Money Dad funds stays locked until he unlocks it.'
              : o.freeze.own === 'sponsor' || o.freeze.sponsor_funded === 'sponsor'
                ? 'Dad locked this, so only he can unlock it.'
                : 'Only Dad can unlock the money he funds.'}
          </Body>
          {o.freeze.own === 'student' && (
            <Button label="Unlock my own money" kind="ghost" busy={lockBusy} onPress={unlock} style={{ marginTop: 10 }} />
          )}
        </Surface>
      )}

      <View style={{ gap: 8 }}>
        {o.accounts.map((a) => (
          <Surface key={a.id} style={{ paddingVertical: 12 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Row style={{ gap: 8 }}>
                  <Body style={{ fontFamily: fonts.bodyBold }}>{a.label}</Body>
                  {a.sponsor_funded && <Pill label="FROM DAD" tone="gold" />}
                </Row>
                <Mono style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>{a.number}</Mono>
              </View>
              <Mono style={{ fontSize: 17, fontFamily: fonts.monoBold }}>{money(a.balance, a.currency)}</Mono>
            </Row>
          </Surface>
        ))}
      </View>

      {o.pending.length > 0 && (
        <Surface tone="warn">
          <Eyebrow>In progress</Eyebrow>
          <View style={{ gap: 6, marginTop: 6 }}>
            {o.pending.map((a) => (
              <Row key={a.action_id} style={{ justifyContent: 'space-between', gap: 10 }}>
                <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                  {a.summary}
                </Body>
                <Pill label={STATUS[a.status] ?? a.status} tone={a.status === 'awaiting_user' ? 'accent' : 'gold'} />
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
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 8 }}>Ask the assistant “will I run out of money before tuition?” for what would help.</Body>
        </Surface>
      )}

      <Surface>
        <BudgetCard c={{ ...o.budget, type: 'budget' }} bare />
      </Surface>

      {credit && <CreditCard c={credit} compact />}

      {o.reminders.length > 0 && (
        <Surface>
          <Eyebrow>Reminders</Eyebrow>
          {o.reminders.map((r) => (
            <Row key={r.id} style={{ gap: 10, marginTop: 8 }}>
              <Mono style={{ fontSize: 12, color: t.accent }}>{r.due}</Mono>
              <Body style={{ fontSize: 13, flex: 1 }}>{r.text}</Body>
            </Row>
          ))}
        </Surface>
      )}

      <Surface>
        <Eyebrow>Saved payees</Eyebrow>
        {o.payees.map((p) => {
          const left = p.usable_from ? Math.ceil(p.usable_from - now / 1000) : 0;
          const cooling = left > 0;
          return (
            <Row key={p.id} style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 14 }}>{p.name}</Body>
                <Mono style={{ fontSize: 11, color: t.faint }}>
                  {p.kind} · {p.currency} · {p.number}
                </Mono>
              </View>
              {p.status !== 'active' ? (
                <Pill label={p.status.replace('_', ' ').toUpperCase()} tone={p.status === 'rejected' ? 'danger' : 'warn'} />
              ) : cooling ? (
                <Pill
                  label={`COOLING · ${left >= 3600 ? `${Math.ceil(left / 3600)}H` : left >= 60 ? `${Math.ceil(left / 60)}M` : `${left}S`}`}
                  tone="warn"
                />
              ) : null}
            </Row>
          );
        })}
      </Surface>

      <Surface style={{ backgroundColor: t.sunken }}>
        <Display style={{ fontSize: 17 }}>Your safety rules</Display>
        <Body style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>
          You can confirm payments up to {money(o.limits.single_cad, 'CAD', 0)} each and {money(o.limits.daily_cad, 'CAD', 0)} a day on
          your own. Anything bigger, any new payee, and any payment straight out of the accounts Dad funds needs his approval too. Only he can change
          these limits, from his own phone.
        </Body>
        {!o.freeze.frozen && (
          <Button
            label="Lost your phone or think you’ve been scammed? Lock payments"
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
