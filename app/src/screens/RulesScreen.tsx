import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { api, type FreezeState } from '../api';
import { PinEntry } from '../components/PinEntry';
import { useT, type Key } from '../i18n';
import { stepUp } from '../stepUp';
import { fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Button, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'] as const;
const tierKey = (tier: (typeof TIERS)[number], part: 'name' | 'gate' | 'ex') => `tier${tier}.${part}` as Key;

const LOCKED_BY: Record<string, Key> = { sponsor: 'ru.lockedBy.sponsor', student: 'ru.lockedBy.student' };

// One tap stops money leaving Aisha's accounts. The server refuses Confirm and Approve while locked; the
// AI can lock (if Aisha asks) but has no way to unlock, and only the sponsor can unlock the money they fund.
function EmergencyLock({ freeze, onChange }: { freeze: FreezeState | null; onChange: (f: FreezeState) => void }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [askPin, setAskPin] = useState(false);
  if (!freeze) return null;

  const lock = (scope: 'sponsor_funded' | 'all') => async () => {
    setBusy(scope);
    try {
      onChange((await api.sponsorFreeze(scope)).freeze);
      toast(
        tr('wal.locked'),
        tr(scope === 'all' ? 'ru.lockedAll' : 'ru.lockedFunded'),
        'danger',
      );
    } catch (e) {
      toast(tr('wal.cantLock'), (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  // Unlocking lets money move again, so it asks for the device owner first, then the sponsor's PIN (checked on
  // the server), like Approve does.
  const unlock = async () => {
    const check = await stepUp(tr('ru.unlockPrompt'));
    if (!check.ok) {
      toast(tr('wal.stillLocked'), tr('wal.nothingChanged', { reason: check.reason }), 'danger');
      return;
    }
    setAskPin(true);
  };
  const unlockWithPin = async (pin: string) => {
    setAskPin(false);
    setBusy('unlock');
    try {
      onChange((await api.sponsorUnfreeze(pin)).freeze);
      toast(tr('ru.unlocked'), tr('ru.unlockedBody'), 'ok');
    } catch (e) {
      toast(tr('wal.cantUnlock'), (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const row = (label: string, by: string | null) => (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Body style={{ fontSize: 14 }}>{label}</Body>
      <Mono style={{ fontSize: 12, color: by ? t.danger : t.muted, fontFamily: by ? fonts.monoBold : fonts.mono }}>
        {by && LOCKED_BY[by] ? tr(LOCKED_BY[by]) : tr('ru.open')}
      </Mono>
    </Row>
  );

  return (
    <Surface tone={freeze.frozen ? 'danger' : 'plain'}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow style={freeze.frozen ? { color: t.danger } : undefined}>{tr('ru.lockTitle')}</Eyebrow>
        {freeze.frozen && <Pill label={tr('wal.lockedPill')} tone="danger" />}
      </Row>
      <Body style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>
        {freeze.frozen
          ? tr('ru.frozenNote')
          : tr('ru.openNote')}
      </Body>
      <View style={{ marginTop: 8 }}>
        {row(tr('ru.moneyYouFund'), freeze.sponsor_funded)}
        {row(tr('ru.aishaMoney'), freeze.own)}
      </View>
      <Row style={{ gap: 10, marginTop: 12 }}>
        {!freeze.frozen && (
          <Button label={tr('ru.lockFunded')} kind="danger" busy={busy === 'sponsor_funded'} onPress={lock('sponsor_funded')} style={{ flex: 1 }} />
        )}
        {freeze.own !== 'sponsor' && (
          <Button label={tr('ru.lockAll')} kind="danger" busy={busy === 'all'} onPress={lock('all')} style={{ flex: 1 }} />
        )}
        {freeze.frozen && !askPin && <Button label={tr('ru.unlock')} busy={busy === 'unlock'} onPress={unlock} style={{ flex: 1 }} />}
      </Row>
      {askPin && <PinEntry title={tr('ru.pinUnlock')} submitLabel={tr('ru.unlock')} onSubmit={unlockWithPin} onCancel={() => setAskPin(false)} />}
    </Surface>
  );
}

function Stepper({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const t = useTheme();
  const tr = useT();
  const btn = (txt: string, d: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(txt === '−' ? 'ru.decrease' : 'ru.increase', { label })}
      onPress={() => onChange(Math.min(max, Math.max(min, value + d)))}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.sunken : t.surface,
      })}
    >
      <Body style={{ fontSize: 20, lineHeight: 22 }}>{txt}</Body>
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
      <Body style={{ flex: 1, fontSize: 14 }}>{label}</Body>
      <Row style={{ gap: 10 }}>
        {btn('−', -step)}
        <Mono style={{ fontFamily: fonts.monoBold, fontSize: 16, minWidth: 96, textAlign: 'center' }}>{money(value, 'CAD', 0)}</Mono>
        {btn('+', step)}
      </Row>
    </Row>
  );
}

export function RulesScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [single, setSingle] = useState(1500);
  const [daily, setDaily] = useState(3000);
  const [saved, setSaved] = useState<{ single: number; daily: number } | null>(null);
  const [cooling, setCooling] = useState(0);
  const [busy, setBusy] = useState(false);
  const [freeze, setFreeze] = useState<FreezeState | null>(null);
  const [askPin, setAskPin] = useState(false);
  // The most the sponsor may allow, set by Aisha's identity-check (KYC) level on the server.
  const [ceiling, setCeiling] = useState<{ single_cad: number; daily_cad: number; label: string }>({
    single_cad: 20000,
    daily_cad: 50000,
    label: '',
  });

  const load = useCallback(async () => {
    try {
      const o = await api.sponsorOverview();
      setSingle(o.limits.single_cad);
      setDaily(o.limits.daily_cad);
      setSaved({ single: o.limits.single_cad, daily: o.limits.daily_cad });
      setCooling(o.limits.payee_cooling_seconds);
      setFreeze(o.freeze);
      if (o.kyc) setCeiling({ ...o.kyc.limit_ceiling, label: o.kyc.student.label });
    } catch {
      /* the approvals screen already shows connection errors */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [active, load]);

  const dirty = saved && (saved.single !== single || saved.daily !== daily);
  const save = async (pin: string) => {
    setAskPin(false);
    setBusy(true);
    try {
      const r = await api.setLimits(single, daily, pin);
      setSaved({ single: r.limits.single_cad, daily: r.limits.daily_cad });
      toast(tr('ru.limitsUpdated'), tr('ru.limitsBody', { single: money(single, 'CAD', 0), daily: money(daily, 'CAD', 0) }), 'ok');
    } catch (e) {
      toast(tr('ru.cantSave'), (e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <View style={{ paddingVertical: 6 }}>
        <Display style={{ fontSize: 24 }}>{tr('ru.title')}</Display>
        <Body style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
          {tr('ru.intro')}
        </Body>
      </View>

      <EmergencyLock freeze={freeze} onChange={setFreeze} />

      <Surface>
        <Eyebrow>{tr('ru.alone')}</Eyebrow>
        <Stepper label={tr('ru.perPayment')} value={single} onChange={setSingle} step={100} min={100} max={Math.min(daily, ceiling.single_cad)} />
        <Stepper label={tr('ru.per24')} value={daily} onChange={setDaily} step={250} min={Math.max(single, 250)} max={ceiling.daily_cad} />
        <Body style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>
          {tr('ru.above', { wait: cooling >= 3600 ? tr('ru.waitHours', { n: Math.round(cooling / 3600) }) : tr('ru.waitSeconds', { n: cooling }) })}
        </Body>
        {ceiling.label ? (
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>
            {tr('ru.kyc', { label: tr.d(ceiling.label).toLowerCase(), single: money(ceiling.single_cad, 'CAD', 0), daily: money(ceiling.daily_cad, 'CAD', 0) })}
          </Body>
        ) : null}
        {askPin ? (
          <PinEntry title={tr('ru.pinSave')} submitLabel={tr('ru.save')} busy={busy} onSubmit={save} onCancel={() => setAskPin(false)} />
        ) : (
          <Button label={tr(dirty ? 'ru.save' : 'ru.saved')} onPress={() => setAskPin(true)} busy={busy} disabled={!dirty} style={{ marginTop: 12 }} />
        )}
      </Surface>

      <Display style={{ fontSize: 18, marginTop: 8 }}>{tr('ru.tiers')}</Display>
      <Body style={{ fontSize: 13, color: t.muted }}>{tr('ru.tiersNote')}</Body>
      <View style={{ gap: 8 }}>
        {TIERS.map((tier) => (
          <Surface key={tier} tone={tier === 'T4' ? 'danger' : tier === 'T3' ? 'warn' : 'plain'} style={{ paddingVertical: 12 }}>
            <Row style={{ gap: 10, alignItems: 'flex-start' }}>
              <Mono style={{ fontFamily: fonts.monoBold, fontSize: 15, color: tier === 'T4' ? t.danger : t.accent, width: 28 }}>{tier}</Mono>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14 }}>{tr(tierKey(tier, 'name'))}</Body>
                <Body style={{ fontSize: 13, color: t.text }}>{tr(tierKey(tier, 'gate'))}</Body>
                <Body style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>{tr(tierKey(tier, 'ex'))}</Body>
              </View>
            </Row>
          </Surface>
        ))}
      </View>
    </ScrollView>
  );
}
