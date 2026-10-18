import { useState, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono/600SemiBold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_400Regular_Italic } from '@expo-google-fonts/geist/400Regular_Italic';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';

import { PersonScope, usePerson, type Person } from './src/account';
import { api, type Role } from './src/api';
import { LangScope, setLang, useT, type Key, type Lang } from './src/i18n';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { LedgerScreen } from './src/screens/LedgerScreen';
import { Onboarding } from './src/screens/Onboarding';
import { RulesScreen } from './src/screens/RulesScreen';
import { Settings } from './src/screens/Settings';
import { SponsorScreen } from './src/screens/SponsorScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { cityTime, SkinProvider, themeFor, useFontSet, useSkin, useTheme } from './src/theme';
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

// Colours for controls drawn on the header, which is the page colour in neo and a solid blue/orange in super-app.
type HeaderInk = { fg: string; muted: string; line: string; chip: string; colored: boolean };

function useHeaderInk(role: Role): HeaderInk & { bg: string } {
  const t = useTheme();
  const { skin } = useSkin();
  const colored = skin === 'superapp';
  return {
    bg: role === 'sponsor' ? t.sponsorHeaderBg : t.headerBg,
    fg: t.headerText,
    muted: t.headerMuted,
    line: colored ? 'rgba(255,255,255,0.45)' : t.border,
    chip: colored ? 'rgba(255,255,255,0.16)' : t.surface,
    colored,
  };
}

// EN / 中文 switch. The label names the language you switch to, so a Chinese-speaking viewer sees "中文" on an
// English screen. On a phone it changes that person's saved language; on the stage bar, both people's.
function LangToggle({ lang, onSwitch, ink }: { lang: Lang; onSwitch: (l: Lang) => void; ink?: HeaderInk }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const zh = lang === 'zh';
  return (
    <Pressable
      onPress={() => onSwitch(zh ? 'en' : 'zh')}
      accessibilityRole="button"
      accessibilityLabel={tr('lang.switch')}
      hitSlop={6}
      style={({ pressed }) => [styles.lang, { borderColor: ink?.line ?? t.border, backgroundColor: pressed ? t.sunken : (ink?.chip ?? t.surface) }]}
    >
      <Body style={{ fontSize: 12, lineHeight: 16, fontFamily: fonts.bodyBold, color: ink?.colored ? ink.fg : t.accent }}>{zh ? 'EN' : '中文'}</Body>
    </Pressable>
  );
}

function Gear({ onPress, ink }: { onPress: () => void; ink: HeaderInk }) {
  const tr = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={tr('set.open')} hitSlop={8}>
      <Body style={{ fontSize: 19, lineHeight: 22, color: ink.colored ? ink.fg : ink.muted }}>{'⚙︎'}</Body>
    </Pressable>
  );
}

// Two homes joined by an arc: the HomeBridge mark, drawn with plain views so no SVG dependency is needed.
function Mark({ light }: { light?: boolean }) {
  const t = useTheme();
  const arc = light ? '#FFFFFF' : t.accent;
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
          borderColor: arc,
        }}
      />
      {/* the deck */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 5, height: 2, backgroundColor: light ? '#FFFFFF' : t.text, opacity: 0.8 }} />
      {/* two homes */}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ width: 7, height: 11, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: arc }} />
        <View style={{ width: 7, height: 11, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: light ? '#FFD591' : t.gold }} />
      </Row>
    </View>
  );
}

/** Everything one person sees takes their look, language and name. */
function Phone({ person, children }: { person: Person; children: ReactNode }) {
  return (
    <SkinProvider skin={person.skin} setSkin={person.setSkin} sponsor={person.role === 'sponsor'}>
      <LangScope value={person.lang}>
        <PersonScope value={person}>{children}</PersonScope>
      </LangScope>
    </SkinProvider>
  );
}

function TabBar({ role, current, onTab, bottomInset }: { role: Role; current: Tab; onTab: (k: Tab) => void; bottomInset: number }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const { skin } = useSkin();
  const roleColor = role === 'student' ? t.accent : t.gold;

  if (skin === 'neo') {
    // A floating pill: the active tab is a lime (sponsor: amber) capsule with its label, the rest are icons.
    return (
      <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 10 + bottomInset, backgroundColor: t.bg }}>
        <Row style={{ backgroundColor: t.tabbarBg, borderRadius: 999, padding: 5, gap: 4, borderWidth: 1, borderColor: t.border }}>
          {TABS[role].map((x) => {
            const on = current === x.key;
            return (
              <Pressable
                key={x.key}
                onPress={() => onTab(x.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={tr(x.label)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: on ? 18 : 16, borderRadius: 999, backgroundColor: on ? roleColor : 'transparent' }}
              >
                <Body style={{ fontSize: 16, lineHeight: 20, color: on ? t.accentText : t.muted }}>{x.glyph}</Body>
                {on && <Body style={{ fontSize: 13.5, lineHeight: 18, fontFamily: fonts.bodyBold, color: t.accentText }}>{tr(x.label)}</Body>}
              </Pressable>
            );
          })}
        </Row>
      </View>
    );
  }

  // Super-app: a plain white bar, icon over label, the active tab in blue (sponsor: orange).
  const active = role === 'student' ? t.accent : t.sponsorHeaderBg;
  return (
    <View style={[styles.tabbar, { borderTopColor: t.border, backgroundColor: t.tabbarBg, paddingBottom: 4 + bottomInset }]}>
      {TABS[role].map((x) => {
        const on = current === x.key;
        const color = on ? active : t.faint;
        return (
          <Pressable
            key={x.key}
            onPress={() => onTab(x.key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={tr(x.label)}
          >
            <Body style={{ fontSize: 18, lineHeight: 21, color }}>{x.glyph}</Body>
            <Body style={{ fontSize: 11, lineHeight: 14, color, fontFamily: on ? fonts.bodyBold : fonts.bodyMedium }} numberOfLines={1}>
              {tr(x.label)}
            </Body>
          </Pressable>
        );
      })}
    </View>
  );
}

type ShellProps = {
  epoch: number;
  provider: string;
  onReset: () => Promise<void>;
  people: Record<Role, Person>;
  role: Role;
  onRole?: (r: Role) => void;
  // In side-by-side mode each phone is fixed to one person and the role switch is hidden.
  fixed?: boolean;
};

function Shell({ epoch, provider, onReset, people, role, onRole, fixed }: ShellProps) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const ink = useHeaderInk(role);
  const person = people[role];
  const [tab, setTab] = useState<Record<Role, Tab>>({ student: 'assistant', sponsor: 'approvals' });
  const [settings, setSettings] = useState(false);
  const current = tab[role];
  const roles: Role[] = fixed ? [role] : ['student', 'sponsor'];
  // The mock phones on the stage sit inside the stage's own safe area, so they take no insets.
  const inset = fixed ? { top: 0, bottom: 0, left: 0, right: 0 } : insets;
  const onboarding = person.onboarding;
  const loading = person.status === 'loading';

  const visible = (r: Role, k: Tab) => role === r && current === k;
  const pane = (r: Role, k: Tab, node: ReactNode) =>
    roles.includes(r) ? (
      <View key={`${r}-${k}`} style={{ flex: 1, display: visible(r, k) && !onboarding && !loading ? 'flex' : 'none' }}>
        {node}
      </View>
    ) : null;

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingLeft: inset.left, paddingRight: inset.right }]}>
      {!fixed && <StatusBar style={t.dark || ink.colored ? 'light' : 'dark'} />}
      <View
        style={[
          styles.header,
          { backgroundColor: ink.bg, paddingTop: 10 + inset.top, borderBottomColor: ink.colored ? ink.bg : t.border },
        ]}
      >
        {fixed ? (
          <View style={{ flexShrink: 1 }}>
            <Body style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: ink.fg }} numberOfLines={1}>
              {tr(role === 'student' ? 'phone.student' : 'phone.sponsor')}
            </Body>
            <Mono style={{ fontSize: 10, color: ink.muted }}>
              {role === 'student'
                ? `${tr('city.vancouver')} · ${cityTime('America/Vancouver')}`
                : `${tr('city.kl')} · ${cityTime('Asia/Kuala_Lumpur')}`}
            </Mono>
          </View>
        ) : (
          <Row style={{ gap: 9, flexShrink: 1 }}>
            <Mark light={ink.colored} />
            <View style={{ flexShrink: 1 }}>
              <Body style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 22, letterSpacing: -0.3, color: ink.fg }}>HomeBridge</Body>
              {provider ? (
                <Mono style={{ fontSize: 9.5, color: ink.muted }} numberOfLines={1}>
                  {tr('sandbox', { provider })}
                </Mono>
              ) : null}
            </View>
          </Row>
        )}
        <Row style={{ gap: fixed ? 12 : 8 }}>
          <LangToggle lang={person.lang} onSwitch={person.setLanguage} ink={ink} />
          {!fixed && (
            <View style={[styles.switch, { borderColor: ink.line, backgroundColor: ink.chip }]}>
              {(['student', 'sponsor'] as Role[]).map((r) => {
                const on = role === r;
                const bg = ink.colored ? '#FFFFFF' : r === 'student' ? t.accent : t.gold;
                const fg = on ? (ink.colored ? ink.bg : t.accentText) : ink.colored ? ink.fg : t.text;
                return (
                  <Pressable
                    key={r}
                    onPress={() => onRole?.(r)}
                    style={[styles.seg, on && { backgroundColor: bg }]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={tr(r === 'student' ? 'role.studentView' : 'role.sponsorView')}
                  >
                    <Body style={{ color: fg, fontFamily: fonts.bodyBold, fontSize: 12.5, lineHeight: 17 }}>
                      {tr(r === 'student' ? 'role.student' : 'role.sponsor')}
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          )}
          {!onboarding && person.status === 'ready' && <Gear onPress={() => setSettings((v) => !v)} ink={ink} />}
          {fixed ? (
            <View style={[styles.dot, { backgroundColor: ink.colored ? '#FFFFFF' : role === 'student' ? t.accent : t.gold }]} />
          ) : (
            <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel={tr('reset.label')} hitSlop={8}>
              <Body style={{ color: ink.colored ? ink.fg : t.faint, fontSize: 18 }}>↺</Body>
            </Pressable>
          )}
        </Row>
      </View>

      <View style={{ flex: 1 }}>
        {/* Every pane stays mounted so the chat and polling survive tab and role switches (and a replayed onboarding). */}
        <View style={{ flex: 1 }} key={epoch}>
          {pane('student', 'assistant', <AssistantScreen active={visible('student', 'assistant')} onTab={(k) => setTab((p) => ({ ...p, student: k }))} />)}
          {pane('student', 'wallet', <WalletScreen active={visible('student', 'wallet')} />)}
          {pane('student', 'ledger', <LedgerScreen role="student" active={visible('student', 'ledger')} />)}
          {pane('sponsor', 'approvals', <SponsorScreen active={visible('sponsor', 'approvals')} />)}
          {pane('sponsor', 'rules', <RulesScreen active={visible('sponsor', 'rules')} />)}
          {pane('sponsor', 'ledger', <LedgerScreen role="sponsor" active={visible('sponsor', 'ledger')} />)}
          {loading && (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={t.accent} />
            </View>
          )}
          {onboarding && <Onboarding key={`${role}-${epoch}`} person={person} />}
        </View>
        {!onboarding && !loading && (
          <TabBar role={role} current={current} onTab={(k) => setTab((p) => ({ ...p, [role]: k }))} bottomInset={inset.bottom} />
        )}
        {settings && !onboarding && <Settings person={person} onClose={() => setSettings(false)} />}
      </View>
    </View>
  );
}

// Wide screens (a laptop at the presentation) show both people at once: two phones, one sandbox.
function Stage() {
  const tr = useT();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 980;
  const [split, setSplit] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [provider, setProvider] = useState('');
  const [role, setRole] = useState<Role>('student');
  const student = usePerson('student', epoch);
  const sponsor = usePerson('sponsor', epoch);
  const people: Record<Role, Person> = { student, sponsor };

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
    const person = people[role];
    const t = themeFor(person.skin);
    return (
      <View style={{ flex: 1 }}>
        <Phone person={person}>
          <ToastProvider>
            <Shell epoch={epoch} provider={provider} onReset={reset} people={people} role={role} onRole={setRole} />
          </ToastProvider>
        </Phone>
        {wide && (
          <Pressable
            onPress={() => setSplit(true)}
            style={[styles.floating, { bottom: 76 + insets.bottom, right: 16 + insets.right, backgroundColor: t.surface, borderColor: t.border }]}
          >
            <Body style={{ fontSize: 12, color: t.text }}>{tr('stage.bothPhones')}</Body>
          </Pressable>
        )}
      </View>
    );
  }

  // The stage only appears on wide windows: a laptop browser, or a large tablet, where it needs the
  // device's safe area (status bar, home indicator) like the single-phone shell does.
  const phoneH = Math.min(860, height - insets.top - insets.bottom - 110);
  const phoneW = Math.min(410, (width - insets.left - insets.right - 140) / 2);
  const switchBoth = (l: Lang) => {
    setLang(l);
    student.setLanguage(l);
    sponsor.setLanguage(l);
  };
  return (
    // The stage chrome follows the student's look.
    <SkinProvider skin={student.skin}>
      <StageChrome provider={provider} onReset={reset} onOnePhone={() => setSplit(false)} onLang={switchBoth} lang={student.lang}>
        {(['student', 'sponsor'] as Role[]).map((r) => {
          const pt = themeFor(people[r].skin, r === 'sponsor');
          return (
            <View key={r} style={{ alignItems: 'center', gap: 10 }}>
              <View
                style={[
                  styles.phone,
                  { width: phoneW, height: phoneH, borderColor: r === 'student' ? pt.accent : pt.gold, shadowColor: pt.shadow, backgroundColor: pt.bg },
                ]}
              >
                <Phone person={people[r]}>
                  <ToastProvider>
                    <Shell epoch={epoch} provider={provider} onReset={reset} people={people} role={r} fixed />
                  </ToastProvider>
                </Phone>
              </View>
            </View>
          );
        })}
      </StageChrome>
    </SkinProvider>
  );
}

function StageChrome({
  provider,
  onReset,
  onOnePhone,
  onLang,
  lang,
  children,
}: {
  provider: string;
  onReset: () => void;
  onOnePhone: () => void;
  onLang: (l: Lang) => void;
  lang: Lang;
  children: ReactNode;
}) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.stage, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
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
          <LangToggle lang={lang} onSwitch={onLang} />
          <Pressable onPress={onOnePhone} accessibilityRole="button">
            <Body style={{ fontSize: 13, color: t.muted }}>{tr('stage.onePhone')}</Body>
          </Pressable>
          <Pressable onPress={onReset} accessibilityRole="button" accessibilityLabel={tr('reset.label')}>
            <Body style={{ fontSize: 13, color: t.muted }}>{tr('reset.button')}</Body>
          </Pressable>
        </Row>
      </View>
      <View style={styles.stage}>{children}</View>
    </View>
  );
}

export default function App() {
  const [loaded] = useFonts({
    Geist_400Regular,
    Geist_400Regular_Italic,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_600SemiBold,
  });
  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeFor('neo').bg }}>
        <ActivityIndicator color={themeFor('neo').accent} />
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
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, overflow: 'hidden', padding: 2 },
  seg: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999 },
  tabbar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lang: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, minWidth: 40, alignItems: 'center' },
  stageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 10,
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
