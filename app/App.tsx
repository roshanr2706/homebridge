import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';

import { api, type Role } from './src/api';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { LedgerScreen } from './src/screens/LedgerScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { SponsorScreen } from './src/screens/SponsorScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { cityTime, fonts, useTheme } from './src/theme';
import { ToastProvider, useToast } from './src/toast';
import { Body, Mono, Row } from './src/ui';

type Tab = 'assistant' | 'wallet' | 'ledger' | 'approvals' | 'rules';

const TABS: Record<Role, { key: Tab; label: string; glyph: string }[]> = {
  student: [
    { key: 'assistant', label: 'Assistant', glyph: '◐' },
    { key: 'wallet', label: 'Wallet', glyph: '▤' },
    { key: 'ledger', label: 'Ledger', glyph: '⛓' },
  ],
  sponsor: [
    { key: 'approvals', label: 'Approvals', glyph: '✓' },
    { key: 'rules', label: 'Rules', glyph: '⚖' },
    { key: 'ledger', label: 'Ledger', glyph: '⛓' },
  ],
};

// Two homes joined by an arc: the HomeBridge mark, drawn with plain views so no SVG dependency is needed.
function Mark() {
  const t = useTheme();
  return (
    <View style={{ width: 32, height: 20, justifyContent: 'flex-end' }}>
      {/* the span */}
      <View
        style={{
          position: 'absolute',
          left: 4,
          right: 4,
          top: 4,
          height: 26,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderWidth: 2,
          borderBottomWidth: 0,
          borderColor: t.accent,
        }}
      />
      {/* the deck */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 5, height: 2, backgroundColor: t.text, opacity: 0.8 }} />
      {/* two homes */}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ width: 7, height: 11, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: t.accent }} />
        <View style={{ width: 7, height: 11, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: t.gold }} />
      </Row>
    </View>
  );
}

type ShellProps = {
  epoch: number;
  provider: string;
  onReset: () => Promise<void>;
  // In side-by-side mode each phone is fixed to one person and the role switch is hidden.
  fixedRole?: Role;
};

function Shell({ epoch, provider, onReset, fixedRole }: ShellProps) {
  const t = useTheme();
  const [chosen, setRole] = useState<Role>('student');
  const role = fixedRole ?? chosen;
  const [tab, setTab] = useState<Record<Role, Tab>>({ student: 'assistant', sponsor: 'approvals' });
  const current = tab[role];
  const roles: Role[] = fixedRole ? [fixedRole] : ['student', 'sponsor'];

  const visible = (r: Role, k: Tab) => role === r && current === k;
  const pane = (r: Role, k: Tab, node: ReactNode) =>
    roles.includes(r) ? (
      <View key={`${r}-${k}`} style={{ flex: 1, display: visible(r, k) ? 'flex' : 'none' }}>
        {node}
      </View>
    ) : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={fixedRole ? [] : ['top', 'bottom']}>
      {!fixedRole && <StatusBar style="auto" />}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        {fixedRole ? (
          <View>
            <Body style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 21 }}>
              {fixedRole === 'student' ? "Aisha's phone" : "Dad's phone"}
            </Body>
            <Mono style={{ fontSize: 10, color: t.faint }}>
              {fixedRole === 'student'
                ? `Vancouver · ${cityTime('America/Vancouver')}`
                : `Kuala Lumpur · ${cityTime('Asia/Kuala_Lumpur')}`}
            </Mono>
          </View>
        ) : (
          <Row style={{ gap: 9 }}>
            <Mark />
            <View>
              <Body style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 22, letterSpacing: -0.3 }}>HomeBridge</Body>
              {provider ? <Mono style={{ fontSize: 9.5, color: t.faint }}>sandbox · {provider}</Mono> : null}
            </View>
          </Row>
        )}
        {fixedRole ? (
          <View style={[styles.dot, { backgroundColor: fixedRole === 'student' ? t.accent : t.gold }]} />
        ) : (
          <Row style={{ gap: 10 }}>
            <View style={[styles.switch, { borderColor: t.border, backgroundColor: t.surface }]}>
              {(['student', 'sponsor'] as Role[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.seg, role === r && { backgroundColor: r === 'student' ? t.accent : t.gold }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: role === r }}
                  accessibilityLabel={r === 'student' ? 'Student view' : 'Sponsor view'}
                >
                  <Body style={{ color: role === r ? t.accentText : t.text, fontFamily: fonts.bodyBold, fontSize: 12.5 }}>
                    {r === 'student' ? 'Aisha' : 'Dad'}
                  </Body>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel="Reset demo" hitSlop={8}>
              <Body style={{ color: t.faint, fontSize: 18 }}>↺</Body>
            </Pressable>
          </Row>
        )}
      </View>

      {/* Every pane stays mounted so the chat and polling survive tab and role switches. */}
      <View style={{ flex: 1 }} key={epoch}>
        {pane('student', 'assistant', <AssistantScreen active={visible('student', 'assistant')} />)}
        {pane('student', 'wallet', <WalletScreen active={visible('student', 'wallet')} />)}
        {pane('student', 'ledger', <LedgerScreen role="student" active={visible('student', 'ledger')} />)}
        {pane('sponsor', 'approvals', <SponsorScreen active={visible('sponsor', 'approvals')} />)}
        {pane('sponsor', 'rules', <RulesScreen active={visible('sponsor', 'rules')} />)}
        {pane('sponsor', 'ledger', <LedgerScreen role="sponsor" active={visible('sponsor', 'ledger')} />)}
      </View>

      <View style={[styles.tabbar, { borderTopColor: t.border, backgroundColor: t.surface }]}>
        {TABS[role].map((x) => {
          const on = current === x.key;
          const color = on ? (role === 'student' ? t.accent : t.gold) : t.faint;
          return (
            <Pressable
              key={x.key}
              onPress={() => setTab((p) => ({ ...p, [role]: x.key }))}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={x.label}
            >
              <Body style={{ fontSize: 17, lineHeight: 20, color }}>{x.glyph}</Body>
              <Body style={{ fontSize: 11, color, fontFamily: on ? fonts.bodyBold : fonts.bodyMedium }}>{x.label}</Body>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// Wide screens (a laptop at the presentation) show both people at once: two phones, one sandbox.
function Stage() {
  const t = useTheme();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const wide = width >= 980;
  const [split, setSplit] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [provider, setProvider] = useState('');

  useEffect(() => {
    api
      .health()
      .then((h) => setProvider(h.provider))
      .catch(() => setProvider(''));
  }, [epoch]);

  const reset = async () => {
    try {
      await api.reset();
      toast('Demo reset', 'Fresh sandbox: balances, payees and drafts are back to the start.', 'info');
    } catch (e) {
      toast('Reset failed', (e as Error).message, 'danger');
    } finally {
      setEpoch((k) => k + 1);
    }
  };

  if (!wide || !split) {
    return (
      <View style={{ flex: 1 }}>
        <Shell epoch={epoch} provider={provider} onReset={reset} />
        {wide && (
          <Pressable onPress={() => setSplit(true)} style={[styles.floating, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold }}>Show both phones</Body>
          </Pressable>
        )}
      </View>
    );
  }

  const phoneH = Math.min(860, height - 110);
  const phoneW = Math.min(410, (width - 140) / 2);
  return (
    <View style={{ flex: 1, backgroundColor: t.sunken }}>
      <View style={[styles.stageBar, { borderBottomColor: t.border, backgroundColor: t.bg }]}>
        <Row style={{ gap: 10 }}>
          <Mark />
          <View>
            <Body style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 23 }}>HomeBridge</Body>
            <Mono style={{ fontSize: 10, color: t.faint }}>
              one sandbox, two phones{provider ? ` · model: ${provider}` : ''}
            </Mono>
          </View>
        </Row>
        <Row style={{ gap: 14 }}>
          <Pressable onPress={() => setSplit(false)} accessibilityRole="button">
            <Body style={{ fontSize: 13, color: t.muted }}>One phone</Body>
          </Pressable>
          <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="Reset demo">
            <Body style={{ fontSize: 13, color: t.muted }}>↺ Reset demo</Body>
          </Pressable>
        </Row>
      </View>
      <View style={styles.stage}>
        {(['student', 'sponsor'] as Role[]).map((r) => (
          <View key={r} style={{ alignItems: 'center', gap: 10 }}>
            <View
              style={[
                styles.phone,
                { width: phoneW, height: phoneH, borderColor: r === 'student' ? t.accent : t.gold, shadowColor: t.shadow },
              ]}
            >
              <ToastProvider>
                <Shell epoch={epoch} provider={provider} onReset={reset} fixedRole={r} />
              </ToastProvider>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const t = useTheme();
  const [loaded] = useFonts({
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });
  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <Stage />
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, overflow: 'hidden', padding: 2 },
  seg: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 999 },
  tabbar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stage: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 48, padding: 20 },
  phone: {
    borderWidth: 6,
    borderRadius: 34,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 8,
  },
  floating: { position: 'absolute', right: 16, bottom: 70, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
