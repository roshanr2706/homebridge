import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { api, type Role } from './src/api';
import { SponsorScreen } from './src/screens/SponsorScreen';
import { StudentScreen } from './src/screens/StudentScreen';
import { useTheme } from './src/theme';

// The role switch exists for the demo only. In production each person signs in on
// their own phone and the server decides the role from their credentials.
export default function App() {
  const t = useTheme();
  const [role, setRole] = useState<Role>('student');
  const [key, setKey] = useState(0);

  const reset = async () => {
    try {
      await api.reset();
    } finally {
      setKey((k) => k + 1);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Text style={[styles.brand, { color: t.text }]}>HomeBridge</Text>
          <View style={[styles.switch, { borderColor: t.border }]}>
            {(['student', 'sponsor'] as Role[]).map((r) => (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[styles.seg, role === r && { backgroundColor: t.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: role === r }}
              >
                <Text style={{ color: role === r ? t.accentText : t.text, fontWeight: '600', fontSize: 13 }}>
                  {r === 'student' ? 'Aisha' : 'Sponsor'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={reset} accessibilityRole="button">
            <Text style={{ color: t.muted, fontSize: 12 }}>Reset demo</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }} key={key}>
          {/* Both screens stay mounted so switching roles keeps the chat. */}
          <View style={{ flex: 1, display: role === 'student' ? 'flex' : 'none' }}>
            <StudentScreen />
          </View>
          <View style={{ flex: 1, display: role === 'sponsor' ? 'flex' : 'none' }}>
            <SponsorScreen />
          </View>
        </View>
      </SafeAreaView>
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
  brand: { fontSize: 18, fontWeight: '800' },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  seg: { paddingVertical: 6, paddingHorizontal: 14 },
});
