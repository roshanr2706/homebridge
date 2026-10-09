import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
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
import { fonts, useTheme } from './src/theme';
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

function Shell() {
  const t = useTheme();
  const toast = useToast();
  const [role, setRole] = useState<Role>('student');
  const [tab, setTab] = useState<Record<Role, Tab>>({ student: 'assistant', sponsor: 'approvals' });
  const [epoch, setEpoch] = useState(0);
  const [provider, setProvider] = useState('');
  const current = tab[role];

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

  const visible = (r: Role, k: Tab) => role === r && current === k;
  const pane = (r: Role, k: Tab, node: ReactNode) => (
    <View key={`${r}-${k}`} style={{ flex: 1, display: visible(r, k) ? 'flex' : 'none' }}>
      {node}
    </View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Row style={{ gap: 9 }}>
          <Mark />
          <View>
            <Body style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 22, letterSpacing: -0.3 }}>HomeBridge</Body>
            {provider ? <Mono style={{ fontSize: 9.5, color: t.faint }}>sandbox · {provider}</Mono> : null}
          </View>
        </Row>
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
          <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="Reset demo" hitSlop={8}>
            <Body style={{ color: t.faint, fontSize: 18 }}>↺</Body>
          </Pressable>
        </Row>
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
        <Shell />
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
});
