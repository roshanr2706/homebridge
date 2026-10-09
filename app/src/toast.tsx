// App-wide banner for things that happen elsewhere (the sponsor decided, a new request arrived).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { fonts, useTheme } from './theme';
import { Body } from './ui';

type Tone = 'ok' | 'danger' | 'info';
type ToastMsg = { id: number; title: string; body?: string; tone: Tone };

const Ctx = createContext<(title: string, body?: string, tone?: Tone) => void>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: false }).start(() => setMsg(null));
  }, [anim]);

  const show = useCallback(
    (title: string, body?: string, tone: Tone = 'info') => {
      setMsg({ id: Date.now(), title, body, tone });
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: false, friction: 8 }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, 6000);
    },
    [anim, hide],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const color = msg?.tone === 'ok' ? t.ok : msg?.tone === 'danger' ? t.danger : t.accent;
  return (
    <Ctx.Provider value={show}>
      {children}
      {msg && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
          ]}
        >
          <Pressable onPress={hide} accessibilityRole="alert" style={[styles.toast, { backgroundColor: t.surface, borderColor: color, shadowColor: t.shadow }]}>
            <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: color, borderRadius: 2 }} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14, color }}>{msg.title}</Body>
              {msg.body ? <Body style={{ fontSize: 13 }}>{msg.body}</Body> : null}
            </View>
          </Pressable>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 64, left: 12, right: 12, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    gap: 10,
    maxWidth: 520,
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 6,
  },
});
