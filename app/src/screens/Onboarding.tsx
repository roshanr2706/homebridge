// First-run setup, per person (each demo phone runs its own): Welcome → Your details → Language → Look → Privacy
// and consent (student) or PIN and your view (sponsor) → Done. Language and look apply live as they are picked;
// nothing is saved until Done, which posts everything to /me/onboarding with this person's own token.
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { Person } from '../account';
import { DEMO_PIN_HINT, type ModelRoute } from '../api';
import { SkinChoice } from '../components/SkinPreview';
import { useDemoMode } from '../hooks';
import { useT, type Key, type T } from '../i18n';
import { SKINS, useFontSet, useTheme } from '../theme';
import { Body, Button, Display, Eyebrow, Mono, Row, Surface } from '../ui';

type Step = 'welcome' | 'details' | 'language' | 'look' | 'privacy' | 'pin' | 'done';

const STEPS: Record<Person['role'], Step[]> = {
  student: ['welcome', 'details', 'language', 'look', 'privacy', 'done'],
  sponsor: ['welcome', 'details', 'language', 'look', 'pin', 'done'],
};

const REGION: Record<string, Key> = { cn: 'ob.region.cn', sg: 'ob.region.sg', server: 'ob.region.server', self: 'ob.region.self' };

/** Where chat text goes, in one sentence, from the server's configured provider (/me model_route). */
export function routeSentence(tr: T, route: ModelRoute | undefined): string {
  if (!route || !route.leaves_server) return tr('ob.aiOffline');
  return tr('ob.aiCloud', { label: route.label, region: tr(REGION[route.region] ?? 'ob.region.self') });
}

export function CheckRow({ checked, onToggle, title, body }: { checked: boolean; onToggle: () => void; title: string; body?: string }) {
  const t = useTheme();
  const fonts = useFontSet();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10, opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19 }}>{title}</Body>
        {body ? <Body style={{ fontSize: 12, lineHeight: 17, color: t.muted, marginTop: 1 }}>{body}</Body> : null}
      </View>
      <View style={{ width: 44, height: 26, borderRadius: 13, padding: 3, backgroundColor: checked ? t.accent : t.sunken, borderWidth: 1, borderColor: checked ? t.accent : t.border, alignItems: checked ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: checked ? t.accentText : t.faint }} />
      </View>
    </Pressable>
  );
}

function Bullet({ ok, children }: { ok: boolean; children: ReactNode }) {
  const t = useTheme();
  return (
    <Row style={{ gap: 8, alignItems: 'flex-start', paddingVertical: 2 }}>
      <Body style={{ width: 16, fontSize: 13, lineHeight: 19, color: ok ? t.ok : t.danger, textAlign: 'center' }}>{ok ? '✓' : '✕'}</Body>
      <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{children}</Body>
    </Row>
  );
}

/** What the sponsor sees and never sees (privacy.SHARING), from either side. */
export function SharingList({ viewer }: { viewer: 'student' | 'sponsor' }) {
  const t = useTheme();
  const tr = useT();
  const s = viewer === 'student' ? '' : 'Sp';
  return (
    <View>
      <Eyebrow style={{ color: t.ok, marginTop: 4 }}>{tr(viewer === 'student' ? 'ob.dadSees' : 'ob.youSee')}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        {(['ob.sees1', 'ob.sees2', 'ob.sees3', 'ob.sees4'] as const).map((k) => (
          <Bullet key={k} ok>
            {tr((k + s) as Key)}
          </Bullet>
        ))}
      </View>
      <Eyebrow style={{ color: t.danger, marginTop: 10 }}>{tr(viewer === 'student' ? 'ob.dadNever' : 'ob.youNever')}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Bullet ok={false}>{tr(viewer === 'student' ? 'ob.never' : 'ob.neverSp')}</Bullet>
      </View>
    </View>
  );
}

function Choice({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const fonts = useFontSet();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: t.radius,
        borderWidth: 2,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: selected ? t.accentSoft : t.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 22 }}>{label}</Body>
        <Body style={{ fontSize: 12.5, lineHeight: 17, color: t.muted }}>{sub}</Body>
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? t.accent : t.faint, alignItems: 'center', justifyContent: 'center' }}>
        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }} />}
      </View>
    </Pressable>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: t.border }}>
      <Body style={{ fontSize: 13, color: t.muted }}>{label}</Body>
      <Body style={{ fontSize: 13, flexShrink: 1, textAlign: 'right' }}>{value}</Body>
    </Row>
  );
}

export function Onboarding({ person }: { person: Person }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const demo = useDemoMode();
  const me = person.me;
  const role = person.role;
  const steps = STEPS[role];
  const [i, setI] = useState(0);
  const [name, setName] = useState(person.name);
  const [sharing, setSharing] = useState(false);
  const [ai, setAi] = useState(false);
  const [offline, setOffline] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const step = steps[i];
  const route = me?.model_route;
  const student = role === 'student';

  const canNext =
    step === 'privacy' ? sharing && (ai || offline) : step === 'pin' ? terms : step === 'details' ? name.trim().length > 0 : true;

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await person.finish({
        display_name: name,
        language: person.lang,
        skin: person.skin,
        consents: student ? { sponsor_sharing: sharing, ai_processing: ai, offline_only: offline } : { sponsor_terms: terms },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title: Record<Step, Key> = {
    welcome: 'ob.welcomeTitle',
    details: 'ob.detailsTitle',
    language: 'ob.langTitle',
    look: 'ob.lookTitle',
    privacy: 'ob.privacyTitle',
    pin: 'ob.pinTitle',
    done: 'ob.doneTitle',
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, paddingBottom: 24, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 5 }}>
            {steps.map((s, k) => (
              <View key={s} style={{ height: 4, width: k === i ? 22 : 10, borderRadius: 2, backgroundColor: k <= i ? t.accent : t.sunken }} />
            ))}
          </Row>
          <Mono style={{ fontSize: 11, color: t.faint }}>{tr('ob.step', { n: i + 1, total: steps.length })}</Mono>
        </Row>
        {person.replaying && (
          <Pressable onPress={person.cancelReplay} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Body style={{ fontSize: 12.5, color: t.accent, fontFamily: fonts.bodyBold }}>{tr('ob.exitReplay')}</Body>
          </Pressable>
        )}

        <View>
          <Eyebrow>{tr(student ? 'ob.forStudent' : 'ob.forSponsor')}</Eyebrow>
          <Display style={{ fontSize: 26, lineHeight: 32, marginTop: 4 }}>{tr(title[step])}</Display>
        </View>

        {step === 'welcome' && (
          <>
            <Body style={{ color: t.muted, fontSize: 14.5 }}>{tr(student ? 'ob.welcomeBody' : 'ob.welcomeBodySp')}</Body>
            <Surface style={{ gap: 12 }}>
              {(['1', '2', '3'] as const).map((n) => (
                <Row key={n} style={{ gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: n === '3' ? t.goldSoft : t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Mono style={{ fontFamily: fonts.monoBold, fontSize: 13, color: n === '3' ? t.gold : t.accent }}>{n}</Mono>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14.5, lineHeight: 19 }}>{tr(`ob.flow${n}${student ? '' : 'Sp'}` as Key)}</Body>
                    <Body style={{ fontSize: 12.5, lineHeight: 17, color: t.muted }}>{tr(`ob.flow${n}${student ? '' : 'Sp'}Body` as Key)}</Body>
                  </View>
                </Row>
              ))}
            </Surface>
          </>
        )}

        {step === 'details' && (
          <>
            <Body style={{ color: t.muted, fontSize: 14 }}>{tr('ob.detailsBody')}</Body>
            <Surface>
              <Body style={{ fontSize: 12, color: t.muted, fontFamily: fonts.bodyBold }}>{tr('ob.displayName')}</Body>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={40}
                autoCapitalize="words"
                accessibilityLabel={tr('ob.displayName')}
                placeholder={me?.name}
                placeholderTextColor={t.faint}
                style={{ marginTop: 6, marginBottom: 10, borderWidth: 1, borderColor: t.border, borderRadius: t.radiusSm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: t.text, backgroundColor: t.bg, fontFamily: fonts.body }}
              />
              <Field label={tr('ob.legalName')} value={me?.name ?? ''} />
              <Field label={tr('ob.home')} value={tr(student ? 'ob.homeStudent' : 'ob.homeSponsor')} />
              <Field label={tr('ob.linked')} value={tr(student ? 'ob.linkedStudent' : 'ob.linkedSponsor')} />
              <Field label={tr('ob.identity')} value={tr('ob.identityValue')} />
            </Surface>
            <Body style={{ fontSize: 11.5, color: t.faint }}>{tr('ob.demoProfile')}</Body>
          </>
        )}

        {step === 'language' && (
          <View style={{ gap: 10 }}>
            <Body style={{ color: t.muted, fontSize: 14 }}>{tr('ob.langBody')}</Body>
            <Choice label="English" sub={tr('ob.langEnSub')} selected={person.lang === 'en'} onPress={() => person.preview({ language: 'en' })} />
            <Choice label="中文（简体）" sub={tr('ob.langZhSub')} selected={person.lang === 'zh'} onPress={() => person.preview({ language: 'zh' })} />
          </View>
        )}

        {step === 'look' && (
          <>
            <Body style={{ color: t.muted, fontSize: 14 }}>{tr('ob.lookBody')}</Body>
            <Row style={{ gap: 10, alignItems: 'stretch' }}>
              {SKINS.map((s) => (
                <SkinChoice key={s} skin={s} selected={person.skin === s} onPress={() => person.preview({ skin: s })} />
              ))}
            </Row>
            <Body style={{ fontSize: 11.5, color: t.faint }}>{tr('ob.lookLater')}</Body>
          </>
        )}

        {step === 'privacy' && (
          <>
            <Body style={{ color: t.muted, fontSize: 14 }}>{tr('ob.privacyBody')}</Body>
            <Surface>
              <Eyebrow>{tr('ob.sharingTitle')}</Eyebrow>
              <SharingList viewer="student" />
              <View style={{ height: 1, backgroundColor: t.border, marginTop: 10 }} />
              <CheckRow checked={sharing} onToggle={() => setSharing((v) => !v)} title={tr('ob.agreeSharing')} />
            </Surface>
            <Surface>
              <Eyebrow>{tr('ob.aiTitle')}</Eyebrow>
              <Body style={{ fontSize: 13.5, lineHeight: 19, marginTop: 6 }}>{routeSentence(tr, route)}</Body>
              <Body style={{ fontSize: 12, lineHeight: 17, color: t.muted, marginTop: 6 }}>{tr('ob.aiNever')}</Body>
              <View style={{ height: 1, backgroundColor: t.border, marginTop: 10 }} />
              <CheckRow
                checked={ai}
                onToggle={() => setAi((v) => !v)}
                title={tr(route?.leaves_server ? 'ob.agreeAi' : 'ob.agreeAiOffline')}
              />
              <CheckRow
                checked={offline}
                onToggle={() => setOffline((v) => !v)}
                title={tr('ob.offlineOnly')}
                body={tr('ob.offlineOnlyBody')}
              />
            </Surface>
          </>
        )}

        {step === 'pin' && (
          <>
            <Surface>
              <Eyebrow>{tr('ob.pinEyebrow')}</Eyebrow>
              <Body style={{ fontSize: 13.5, lineHeight: 19, marginTop: 6 }}>{tr('ob.pinBody')}</Body>
              {demo ? (
                <View style={{ marginTop: 10, padding: 10, borderRadius: t.radiusSm, backgroundColor: t.goldSoft }}>
                  <Body style={{ fontSize: 12, color: t.gold, fontFamily: fonts.bodyBold }}>{tr('ob.pinDemo')}</Body>
                  <Mono style={{ fontFamily: fonts.monoBold, fontSize: 22, letterSpacing: 6, color: t.text, marginTop: 2 }}>{DEMO_PIN_HINT}</Mono>
                </View>
              ) : null}
            </Surface>
            <Surface>
              <SharingList viewer="sponsor" />
              <View style={{ height: 1, backgroundColor: t.border, marginTop: 10 }} />
              <CheckRow checked={terms} onToggle={() => setTerms((v) => !v)} title={tr('ob.agreeTerms')} />
            </Surface>
          </>
        )}

        {step === 'done' && (
          <>
            <Body style={{ color: t.muted, fontSize: 14 }}>{tr('ob.doneBody')}</Body>
            <Surface>
              <Field label={tr('ob.displayName')} value={name.trim() || person.name} />
              <Field label={tr('ob.langTitle')} value={person.lang === 'zh' ? '中文' : 'English'} />
              <Field label={tr('ob.lookTitle')} value={tr(person.skin === 'neo' ? 'skin.neo' : 'skin.superapp')} />
              {student ? (
                <>
                  <Field label={tr('ob.sharingShort')} value={tr('ob.agreed')} />
                  <Field label={tr('ob.aiShort')} value={offline ? tr('ob.offlineChosen') : route?.leaves_server ? route.label : tr('ob.offlineEngine')} />
                </>
              ) : (
                <Field label={tr('ob.pinEyebrow')} value={tr('ob.agreed')} />
              )}
            </Surface>
            <Body style={{ fontSize: 11.5, color: t.faint }}>{tr('ob.doneLater')}</Body>
            {error ? <Body style={{ color: t.danger, fontSize: 13 }}>{error}</Body> : null}
          </>
        )}
      </ScrollView>

      <Row style={{ gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
        {i > 0 && <Button label={tr('ob.back')} kind="ghost" onPress={() => setI(i - 1)} style={{ flex: 1 }} />}
        {step === 'done' ? (
          <Button label={tr('ob.start')} busy={busy} onPress={finish} style={{ flex: 2 }} />
        ) : (
          <Button label={tr(i === 0 ? 'ob.begin' : 'ob.next')} disabled={!canNext} onPress={() => setI(i + 1)} style={{ flex: 2 }} />
        )}
      </Row>
    </View>
  );
}
