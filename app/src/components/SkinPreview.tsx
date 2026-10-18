// A live miniature of each skin, drawn with that skin's real tokens and fonts (a SkinProvider per preview), so the
// choice in onboarding and Settings shows exactly what the app will look like.
import { Pressable, View } from 'react-native';

import { useT } from '../i18n';
import { SkinProvider, useFontSet, useTheme, type Skin } from '../theme';
import { Body, Mono, Row } from '../ui';

function Mini({ skin }: { skin: Skin }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const neo = skin === 'neo';
  return (
    <View style={{ width: '100%', aspectRatio: 0.62, backgroundColor: t.bg, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}>
      {neo ? (
        <View style={{ padding: 10, gap: 6 }}>
          <Body style={{ fontSize: 8, lineHeight: 10, color: t.muted }}>{tr('ob.previewGreeting')}</Body>
          <Row style={{ alignItems: 'flex-end' }}>
            <Mono style={{ fontFamily: fonts.bodyBold, fontSize: 22, letterSpacing: -1, color: t.text }}>14,230</Mono>
            <Mono style={{ fontSize: 11, color: t.faint, marginBottom: 3 }}>.07</Mono>
          </Row>
          <Row style={{ gap: 5 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: t.sunken }} />
            ))}
          </Row>
          <Row style={{ gap: 6, marginTop: 2 }}>
            <View style={{ flex: 3, height: 50, borderRadius: 10, backgroundColor: t.heroCard, padding: 6, justifyContent: 'flex-end' }}>
              <Mono style={{ fontFamily: fonts.monoBold, fontSize: 9, color: t.heroCardText }}>$2,340</Mono>
            </View>
            <View style={{ flex: 1, height: 50, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }} />
          </Row>
          <View style={{ height: 14, borderRadius: 7, backgroundColor: t.surface, marginTop: 2 }} />
        </View>
      ) : (
        <View>
          <View style={{ backgroundColor: t.headerBg, padding: 8, paddingBottom: 18, gap: 7 }}>
            <View style={{ height: 13, borderRadius: 7, backgroundColor: '#FFFFFF' }} />
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: 2 }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: t.headerText }} />
              ))}
            </Row>
          </View>
          <View style={{ marginHorizontal: 6, marginTop: -10, backgroundColor: t.surface, borderRadius: 6, padding: 6 }}>
            <Body style={{ fontSize: 7, lineHeight: 9, color: t.muted }}>总资产 Total</Body>
            <Mono style={{ fontFamily: fonts.monoBold, fontSize: 14, color: t.text }}>14,230.07</Mono>
          </View>
          <View style={{ marginHorizontal: 6, marginTop: 5, backgroundColor: t.surface, borderRadius: 6, padding: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {['#FF7A00', '#1677FF', '#FF3141', '#0EA5E9', '#00B578', '#5B6475', '#7A5AF8', '#1677FF', '#FF7A00', '#13A8A8'].map((c, i) => (
              <View key={i} style={{ width: '16%', aspectRatio: 1, borderRadius: 4, backgroundColor: c }} />
            ))}
          </View>
        </View>
      )}
      <View style={{ position: 'absolute', left: neo ? 18 : 0, right: neo ? 18 : 0, bottom: neo ? 6 : 0, height: neo ? 14 : 16, borderRadius: neo ? 7 : 0, backgroundColor: t.tabbarBg, borderTopWidth: neo ? 0 : 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: neo ? 22 : 10, height: neo ? 8 : 6, borderRadius: 4, backgroundColor: t.accent }} />
      </View>
    </View>
  );
}

export function SkinChoice({ skin, selected, onPress }: { skin: Skin; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={tr(skin === 'neo' ? 'skin.neo' : 'skin.superapp')}
      style={({ pressed }) => ({
        flex: 1,
        padding: 8,
        borderRadius: t.radius,
        borderWidth: 2,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: t.surface,
        opacity: pressed ? 0.85 : 1,
        gap: 8,
      })}
    >
      <SkinProvider skin={skin}>
        <Mini skin={skin} />
      </SkinProvider>
      <View style={{ paddingHorizontal: 2 }}>
        <Row style={{ justifyContent: 'space-between', gap: 6 }}>
          <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18 }}>{tr(skin === 'neo' ? 'skin.neo' : 'skin.superapp')}</Body>
          <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: selected ? t.accent : t.faint, alignItems: 'center', justifyContent: 'center' }}>
            {selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent }} />}
          </View>
        </Row>
        <Body style={{ fontSize: 11.5, lineHeight: 15, color: t.muted, marginTop: 2 }}>{tr(skin === 'neo' ? 'skin.neoSub' : 'skin.superappSub')}</Body>
      </View>
    </Pressable>
  );
}
