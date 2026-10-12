import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';

import { api, type Role } from './src/api';
import { setLang, useT, type Key } from './src/i18n';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { LedgerScreen } from './src/screens/LedgerScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { SponsorScreen } from './src/screens/SponsorScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { cityTime, fonts, useTheme } from './src/theme';
import { ToastProvider, useToast } from './src/toast';
import { Body, Mono, Row } from './src/ui';

type Tab = 'assistant' | 'wallet' | 'ledger' | 'approvals' | 'rules';

const TABS: Record<Role, { key: Tab; label: Key; glyph: string }[]> = {
  student: [
    { key: 'assistant', label: 'tab.assistant', glyph: '◐' },
    { key: 'wallet', label: 'tab.wallet', glyph: '▤' },
    { key: 'ledger', label: 'tab.ledger', glyph: '⛓' },
  ],
  sponsor: [
    { key: 'approvals', label: 'tab.approvals', glyph: '✓' },
    { key: 'rules', label: 'tab.rules', glyph: '⚖' },
    { key: 'ledger', label: 'tab.ledger', glyph: '⛓' },
  ],
};

// EN / 中文 switch. The label names the language you switch to, so a Chinese-speaking viewer sees "中文" on an
// English screen. Both demo phones share the choice.
function LangToggle() {
  const t = useTheme();
  const tr = useT();
  const zh = tr.lang === 'zh';
  return (
    <Pressable
      onPress={() => setLang(zh ? 'en' : 'zh')}
      accessibilityRole="button"
      accessibilityLabel={tr('lang.switch')}
      hitSlop={6}
      style={({ pressed }) => [styles.lang, { borderColor: t.border, backgroundColor: pressed ? t.sunken : t.surface }]}
    >
      <Body style={{ fontSize: 12, lineHeight: 16, fontFamily: fonts.bodyBold, color: t.accent }}>{zh ? 'EN' : '中文'}</Body>
    </Pressable>
  );
}

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
  const tr = useT();
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
    // The mock phones on the stage sit inside the stage's own safe area, so they take no insets.
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={fixedRole ? [] : ['top', 'bottom', 'left', 'right']}>
      {!fixedRole && <StatusBar style="auto" />}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        {fixedRole ? (
          <View>
            <Body style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 21 }}>
              {tr(fixedRole === 'student' ? 'phone.student' : 'phone.sponsor')}
            </Body>
            <Mono style={{ fontSize: 10, color: t.faint }}>
              {fixedRole === 'student'
                ? `${tr('city.vancouver')} · ${cityTime('America/Vancouver')}`
                : `${tr('city.kl')} · ${cityTime('Asia/Kuala_Lumpur')}`}
            </Mono>
          </View>
        ) : (
          <Row style={{ gap: 9, flexShrink: 1 }}>
            <Mark />
            <View style={{ flexShrink: 1 }}>
              <Body style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 22, letterSpacing: -0.3 }}>HomeBridge</Body>
              {provider ? (
                <Mono style={{ fontSize: 9.5, color: t.faint }} numberOfLines={1}>
                  {tr('sandbox', { provider })}
                </Mono>
              ) : null}
            </View>
          </Row>
        )}
        {fixedRole ? (
          <Row style={{ gap: 10 }}>
            <LangToggle />
            <View style={[styles.dot, { backgroundColor: fixedRole === 'student' ? t.accent : t.gold }]} />
          </Row>
        ) : (
          <Row style={{ gap: 8 }}>
            <LangToggle />
            <View style={[styles.switch, { borderColor: t.border, backgroundColor: t.surface }]}>
              {(['student', 'sponsor'] as Role[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.seg, role === r && { backgroundColor: r === 'student' ? t.accent : t.gold }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: role === r }}
                  accessibilityLabel={tr(r === 'student' ? 'role.studentView' : 'role.sponsorView')}
                >
                  <Body style={{ color: role === r ? t.accentText : t.text, fontFamily: fonts.bodyBold, fontSize: 12.5 }}>
                    {tr(r === 'student' ? 'role.student' : 'role.sponsor')}
                  </Body>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel={tr('reset.label')} hitSlop={8}>
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
              accessibilityLabel={tr(x.label)}
            >
              <Body style={{ fontSize: 17, lineHeight: 20, color }}>{x.glyph}</Body>
              <Body style={{ fontSize: 11, color, fontFamily: on ? fonts.bodyBold : fonts.bodyMedium }} numberOfLines={1}>
                {tr(x.label)}
              </Body>
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
  const tr = useT();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
      toast(tr('reset.done'), tr('reset.doneBody'), 'info');
    } catch (e) {
      toast(tr('reset.failed'), (e as Error).message, 'danger');
    } finally {
      setEpoch((k) => k + 1);
    }
  };

  if (!wide || !split) {
    return (
      <View style={{ flex: 1 }}>
        <Shell epoch={epoch} provider={provider} onReset={reset} />
        {wide && (
          <Pressable
            onPress={() => setSplit(true)}
            style={[styles.floating, { bottom: 70 + insets.bottom, right: 16 + insets.right, backgroundColor: t.surface, borderColor: t.border }]}
          >
            <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold }}>{tr('stage.bothPhones')}</Body>
          </Pressable>
        )}
      </View>
    );
  }

  // The stage only appears on wide windows: a laptop browser, or a large tablet, where it needs the
  // device's safe area (status bar, home indicator) like the single-phone shell does.
  const phoneH = Math.min(860, height - insets.top - insets.bottom - 110);
  const phoneW = Math.min(410, (width - insets.left - insets.right - 140) / 2);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.sunken }} edges={['bottom', 'left', 'right']}>
      <StatusBar style="auto" />
      <View style={[styles.stageBar, { borderBottomColor: t.border, backgroundColor: t.bg, paddingTop: 10 + insets.top }]}>
        <Row style={{ gap: 10 }}>
          <Mark />
          <View>
            <Body style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 23 }}>HomeBridge</Body>
            <Mono style={{ fontSize: 10, color: t.faint }}>
              {tr('stage.sub')}
              {provider ? tr('stage.model', { provider }) : ''}
            </Mono>
          </View>
        </Row>
        <Row style={{ gap: 14 }}>
          <LangToggle />
          <Pressable onPress={() => setSplit(false)} accessibilityRole="button">
            <Body style={{ fontSize: 13, color: t.muted }}>{tr('stage.onePhone')}</Body>
          </Pressable>
          <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel={tr('reset.label')}>
            <Body style={{ fontSize: 13, color: t.muted }}>{tr('reset.button')}</Body>
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
  seg: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999 },
  tabbar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lang: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, minWidth: 40, alignItems: 'center' },
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
  floating: { position: 'absolute', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
