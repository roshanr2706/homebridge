import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { api, type Overview } from '../api';
import { usePoll } from '../hooks';
import { BudgetCard, CreditCard, TuitionCard, creditCardFromProfile } from '../components/ResultCards';
import { amount, fonts, money, useTheme } from '../theme';
import { Body, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const STATUS: Record<string, string> = { awaiting_user: 'needs your confirmation', awaiting_sponsor: 'with your sponsor' };

export function WalletScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setO(await api.overview());
      setNow(Date.now());
      setError('');
    } catch {
      setError(api.unreachable);
    } finally {
      setLoading(false);
    }
  }, []);

  usePoll(refresh, 2000, active);

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
      </Surface>
    </ScrollView>
  );
}
