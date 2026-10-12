// The sponsor's 6-digit approval PIN, asked for after the device check (Face ID / fingerprint) and checked on
// the server (backend/app/authn.py): a stolen sponsor token alone cannot approve, unlock or change limits.
// Never prefilled. In demo mode a hint shows the demo PIN.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { DEMO_PIN_HINT } from '../api';
import { useDemoMode } from '../hooks';
import { useT } from '../i18n';
import { fonts, useTheme } from '../theme';
import { Body, Button, Mono, Row } from '../ui';

type Props = {
  title: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
};

export function PinEntry({ title, submitLabel, busy, onSubmit, onCancel }: Props) {
  const t = useTheme();
  const tr = useT();
  const demo = useDemoMode();
  const [pin, setPin] = useState('');
  const ready = /^\d{6}$/.test(pin);
  const submit = () => {
    if (!ready) return;
    const p = pin;
    setPin('');
    onSubmit(p);
  };

  return (
    <View style={[styles.box, { borderColor: t.gold, backgroundColor: t.goldSoft }]}>
      <Body style={{ fontSize: 12.5, fontFamily: fonts.bodyBold, color: t.text }}>{title}</Body>
      <Row style={{ gap: 6, marginTop: 8, justifyContent: 'center' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, { borderColor: t.gold, backgroundColor: i < pin.length ? t.gold : 'transparent' }]}
          />
        ))}
      </Row>
      <TextInput
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
        onSubmitEditing={submit}
        keyboardType="number-pad"
        secureTextEntry
        autoComplete="off"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        accessibilityLabel={tr('pin.label')}
        placeholder={tr('pin.placeholder')}
        placeholderTextColor={t.faint}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface, fontFamily: fonts.mono }]}
      />
      {demo ? <Mono style={{ fontSize: 10.5, color: t.muted, marginTop: 4 }}>{tr('pin.demo', { pin: DEMO_PIN_HINT })}</Mono> : null}
      <Row style={{ gap: 10, marginTop: 10 }}>
        <Button label={tr('btn.cancel')} kind="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button label={submitLabel} busy={busy} disabled={!ready} onPress={submit} style={{ flex: 2 }} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, letterSpacing: 6, textAlign: 'center', marginTop: 8 },
});
