import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { api } from '../api';
import { fonts, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Button, Display, Eyebrow, Mono, Row, Surface } from '../ui';

const TIERS: { tier: string; name: string; gate: string; examples: string }[] = [
  { tier: 'T0', name: 'Read', gate: 'No gate, logged', examples: 'Balances, masked transactions, FX quotes, tuition schedule' },
  { tier: 'T1', name: 'Low-risk write', gate: 'No gate, logged, reversible', examples: 'Budgets, reminders, asking you for money' },
  { tier: 'T2', name: 'Ordinary payment', gate: 'Aisha confirms in the app', examples: 'Saved payee, under both limits; own-wallet conversions' },
  { tier: 'T3', name: 'Elevated payment', gate: 'Aisha confirms, then you approve', examples: 'Over a limit, new payee, from money you fund, flagged as risky' },
  { tier: 'T4', name: 'Forbidden to the AI', gate: 'Not a tool at all', examples: 'Changing limits or sponsor, full account numbers, disabling checks' },
];

function Stepper({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const t = useTheme();
  const btn = (txt: string, d: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${txt === '−' ? 'Decrease' : 'Increase'} ${label}`}
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
  const toast = useToast();
  const [single, setSingle] = useState(1500);
  const [daily, setDaily] = useState(3000);
  const [saved, setSaved] = useState<{ single: number; daily: number } | null>(null);
  const [cooling, setCooling] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await api.sponsorOverview();
      setSingle(o.limits.single_cad);
      setDaily(o.limits.daily_cad);
      setSaved({ single: o.limits.single_cad, daily: o.limits.daily_cad });
      setCooling(o.limits.payee_cooling_seconds);
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
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.setLimits(single, daily);
      setSaved({ single: r.limits.single_cad, daily: r.limits.daily_cad });
      toast('Limits updated', `Aisha can now confirm up to ${money(single, 'CAD', 0)} per payment and ${money(daily, 'CAD', 0)} a day alone.`, 'ok');
    } catch (e) {
      toast("Couldn't save", (e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <View style={{ paddingVertical: 6 }}>
        <Display style={{ fontSize: 24 }}>Rules you set</Display>
        <Body style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
          These limits live on the server and can only be changed here, signed in as the sponsor. The AI has no tool to change them, and
          nothing typed into the chat can.
        </Body>
      </View>

      <Surface>
        <Eyebrow>Aisha can confirm alone</Eyebrow>
        <Stepper label="Per payment" value={single} onChange={setSingle} step={100} min={100} max={Math.min(daily, 20000)} />
        <Stepper label="Per 24 hours" value={daily} onChange={setDaily} step={250} min={Math.max(single, 250)} max={50000} />
        <Body style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>
          Anything above these goes to you. New payees always come to you and then wait {cooling >= 3600 ? `${Math.round(cooling / 3600)} h` : `${cooling} s (demo)`} before
          first use.
        </Body>
        <Button label={dirty ? 'Save limits' : 'Saved'} onPress={save} busy={busy} disabled={!dirty} style={{ marginTop: 12 }} />
      </Surface>

      <Display style={{ fontSize: 18, marginTop: 8 }}>Permission tiers</Display>
      <Body style={{ fontSize: 13, color: t.muted }}>Every tool the AI can call is in one of these tiers. The tier is decided by code, not by the AI.</Body>
      <View style={{ gap: 8 }}>
        {TIERS.map((x) => (
          <Surface key={x.tier} tone={x.tier === 'T4' ? 'danger' : x.tier === 'T3' ? 'warn' : 'plain'} style={{ paddingVertical: 12 }}>
            <Row style={{ gap: 10, alignItems: 'flex-start' }}>
              <Mono style={{ fontFamily: fonts.monoBold, fontSize: 15, color: x.tier === 'T4' ? t.danger : t.accent, width: 28 }}>{x.tier}</Mono>
              <View style={{ flex: 1 }}>
                <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14 }}>{x.name}</Body>
                <Body style={{ fontSize: 13, color: t.text }}>{x.gate}</Body>
                <Body style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>{x.examples}</Body>
              </View>
            </Row>
          </Surface>
        ))}
      </View>
    </ScrollView>
  );
}
