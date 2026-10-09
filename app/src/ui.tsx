// Small shared primitives so every screen uses the same type scale and surfaces.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { fonts, useTheme } from './theme';

type TextProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean };

export function Display({ children, style, numberOfLines }: TextProps) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: fonts.display, color: t.text, fontSize: 22, letterSpacing: -0.3 }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines, selectable }: TextProps) {
  const t = useTheme();
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[{ fontFamily: fonts.body, color: t.text, fontSize: 15, lineHeight: 22 }, style]}
    >
      {children}
    </Text>
  );
}

export function Mono({ children, style, numberOfLines }: TextProps) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: fonts.mono, color: t.text, fontSize: 14 }, style]}>
      {children}
    </Text>
  );
}

// Small caps label used above sections and inside cards.
export function Eyebrow({ children, style }: TextProps) {
  const t = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.bodyBold, color: t.muted, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

export function Surface({ children, style, tone = 'plain' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'plain' | 'danger' | 'warn' | 'ok' | 'accent' }) {
  const t = useTheme();
  const border = { plain: t.border, danger: t.danger, warn: t.gold, ok: t.ok, accent: t.accent }[tone];
  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: t.surface, borderColor: border, shadowColor: t.shadow },
        tone !== 'plain' && { borderLeftWidth: 3 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'danger' | 'warn' | 'ok' | 'accent' | 'gold' }) {
  const t = useTheme();
  const map = {
    plain: [t.sunken, t.muted],
    danger: [t.dangerBg, t.danger],
    warn: [t.warnBg, t.warn],
    ok: [t.okBg, t.ok],
    accent: [t.accentSoft, t.accent],
    gold: [t.goldSoft, t.gold],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : 'transparent';
  const border = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : t.border;
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={{ color: fg, fontFamily: fonts.bodyBold, fontSize: 14 }}>{label}</Text>
      )}
    </Pressable>
  );
}

// Horizontal bar; `marker` draws a thin line (e.g. the budget) on top of the fill.
export function Bar({ value, max, color, marker, height = 8 }: { value: number; max: number; color: string; marker?: number; height?: number }) {
  const t = useTheme();
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const m = marker !== undefined && max > 0 ? Math.max(0, Math.min(1, marker / max)) : undefined;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
      {m !== undefined && (
        <View style={{ position: 'absolute', left: `${m * 100}%`, top: 0, bottom: 0, width: 2, backgroundColor: t.text, opacity: 0.55 }} />
      )}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: 10 }} />;
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
});
