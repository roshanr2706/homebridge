// Settings (the gear in the header): switch look and language at any time, the student's "offline engine only"
// choice, and "Replay onboarding". Changes save to this person's prefs on the server (/me/prefs).
import { Pressable, ScrollView, View } from 'react-native';

import type { Person } from '../account';
import { SkinChoice } from '../components/SkinPreview';
import { setShowSteps, useShowSteps } from '../components/TracePanel';
import { useT } from '../i18n';
import { SKINS, useFontSet, useTheme } from '../theme';
import { Body, Button, Display, Eyebrow, Row, Surface } from '../ui';
import { CheckRow, routeSentence, SharingList } from './Onboarding';

export function Settings({ person, onClose }: { person: Person; onClose: () => void }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const student = person.role === 'student';
  const offline = !!person.me?.prefs.consents.offline_only?.value;
  const route = person.me?.model_route;
  const showSteps = useShowSteps();

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderColor: t.border }}>
        <Display style={{ fontSize: 20 }}>{tr('set.title')}</Display>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('set.close')} hitSlop={10}>
          <Body style={{ color: t.accent, fontFamily: fonts.bodyBold }}>{tr('set.close')}</Body>
        </Pressable>
      </Row>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View style={{ gap: 8 }}>
          <Eyebrow>{tr('set.look')}</Eyebrow>
          <Row style={{ gap: 10, alignItems: 'stretch' }}>
            {SKINS.map((s) => (
              <SkinChoice key={s} skin={s} selected={person.skin === s} onPress={() => person.setSkin(s)} />
            ))}
          </Row>
        </View>

        <View style={{ gap: 8 }}>
          <Eyebrow>{tr('set.language')}</Eyebrow>
          <Row style={{ gap: 8 }}>
            {(['en', 'zh'] as const).map((l) => {
              const on = person.lang === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => person.setLanguage(l)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 999, borderWidth: 1.5, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }}
                >
                  <Body style={{ fontFamily: fonts.bodyBold, color: on ? t.accent : t.text }}>{l === 'en' ? 'English' : '中文'}</Body>
                </Pressable>
              );
            })}
          </Row>
        </View>

        {student ? (
          <Surface>
            <Eyebrow>{tr('ob.aiTitle')}</Eyebrow>
            {person.me?.consent_stale ? (
              <View style={{ marginTop: 8, padding: 10, borderRadius: t.radiusSm, backgroundColor: t.goldSoft, gap: 6 }}>
                <Body style={{ fontFamily: fonts.bodyBold, color: t.warn }}>{tr('set.providerChanged')}</Body>
                <Body style={{ fontSize: 12.5, lineHeight: 17 }}>{tr('set.providerChangedBody')}</Body>
                <Button label={tr('set.agreeProvider', { provider: route?.label ?? '' })} kind="ghost" onPress={() => person.save({ ai_consent: true })} />
              </View>
            ) : null}
            <Body style={{ fontSize: 13, lineHeight: 18, marginTop: 6 }}>{routeSentence(tr, route)}</Body>
            <CheckRow
              checked={offline}
              onToggle={() => person.save({ offline_only: !offline })}
              title={tr('ob.offlineOnly')}
              body={tr(route?.leaves_server ? 'set.offlineOffNote' : 'ob.offlineOnlyBody')}
            />
            <Body style={{ fontSize: 11.5, color: t.faint }}>
              {tr('set.engineNow', { engine: person.me?.chat_engine === 'offline' || !route?.leaves_server ? tr('ob.offlineEngine') : route.label })}
            </Body>
          </Surface>
        ) : null}

        {student ? (
          <Surface>
            <CheckRow checked={showSteps} onToggle={() => setShowSteps(!showSteps)} title={tr('set.reasoning')} body={tr('set.reasoningBody')} />
          </Surface>
        ) : null}

        <Surface>
          <Eyebrow>{tr('set.privacy')}</Eyebrow>
          <SharingList viewer={student ? 'student' : 'sponsor'} />
        </Surface>

        <Surface>
          <Eyebrow>{tr('set.onboarding')}</Eyebrow>
          <Body style={{ fontSize: 13, color: t.muted, marginTop: 4 }}>{tr('set.replayBody')}</Body>
          <Button
            label={tr('set.replay')}
            kind="ghost"
            onPress={() => {
              person.replay();
              onClose();
            }}
            style={{ marginTop: 10 }}
          />
        </Surface>
      </ScrollView>
    </View>
  );
}
