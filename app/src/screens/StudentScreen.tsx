import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, type Account, type Action } from '../api';
import { ActionCard } from '../components/ActionCard';
import { money, useTheme } from '../theme';

type Msg = { id: string; from: 'user' | 'bot'; text: string; actionIds?: string[]; flags?: string[]; meta?: string };

const SUGGESTIONS = [
  'How much money do I have?',
  'Cheapest way to change 5,000 MYR to CAD?',
  'When is my next tuition due and can I cover it?',
  'Pay rent to my landlord',
  'Is this a scam? "CRA: you owe $2,000, pay in gift cards or be arrested"',
];

export function StudentScreen() {
  const t = useTheme();
  const [messages, setMessages] = useState<Msg[]>([
    { id: 'hello', from: 'bot', text: "Hi Aisha. I can check balances, compare transfer costs, plan tuition and draft payments. You confirm every payment yourself." },
  ]);
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);

  const refresh = useCallback(async () => {
    try {
      const [acc, act] = await Promise.all([api.accounts(), api.actions()]);
      setAccounts(acc.accounts);
      setActions((prev) => {
        const next = { ...prev };
        for (const a of act.actions) next[a.action_id] = { ...prev[a.action_id], ...a };
        return next;
      });
      setError('');
    } catch (e) {
      setError(`Can't reach the server at ${api.base}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000); // picks up sponsor decisions
    return () => clearInterval(id);
  }, [refresh]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setInput('');
    setMessages((m) => [...m, { id: `u${Date.now()}`, from: 'user', text: msg }]);
    setSending(true);
    try {
      const r = await api.chat(msg);
      setActions((prev) => {
        const next = { ...prev };
        for (const a of r.actions) next[a.action_id] = a;
        return next;
      });
      setMessages((m) => [
        ...m,
        {
          id: `b${Date.now()}`,
          from: 'bot',
          text: r.reply,
          actionIds: r.actions.map((a) => a.action_id),
          flags: r.guard.flags,
          meta: `${r.trace.map((x) => x.tool).join(' → ') || 'no tools'} · ${r.provider}${r.fallback ? ' (fallback)' : ''}`,
        },
      ]);
      refresh();
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, from: 'bot', text: `Something went wrong: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  };

  const update = (a: Action) => setActions((p) => ({ ...p, [a.action_id]: { ...p[a.action_id], ...a } }));
  const onConfirm = async (a: Action) => {
    try {
      update(await api.confirm(a.action_id, a.confirm_token ?? ''));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onCancel = async (a: Action) => {
    try {
      update(await api.cancel(a.action_id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.balances} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {accounts.map((a) => (
          <View key={a.id} style={[styles.balance, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              {a.label} {a.number}
            </Text>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', marginTop: 2 }}>{money(a.balance, a.currency)}</Text>
            {a.sponsor_funded && <Text style={{ color: t.muted, fontSize: 11 }}>sponsor-funded</Text>}
          </View>
        ))}
      </ScrollView>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={{ alignItems: item.from === 'user' ? 'flex-end' : 'flex-start', marginVertical: 4 }}>
            <View
              style={[
                styles.bubble,
                item.from === 'user'
                  ? { backgroundColor: t.user }
                  : { backgroundColor: t.bot, borderColor: t.border, borderWidth: 1 },
              ]}
            >
              <Text style={{ color: item.from === 'user' ? t.userText : t.text, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
            </View>
            {item.flags && item.flags.length > 0 && (
              <Text style={[styles.flag, { color: t.danger, backgroundColor: t.dangerBg }]}>
                Safety check: {item.flags.join(', ')}
              </Text>
            )}
            {item.meta ? <Text style={[styles.meta, { color: t.muted }]}>{item.meta}</Text> : null}
            {item.actionIds?.map((id) =>
              actions[id] ? (
                <View key={id} style={{ alignSelf: 'stretch' }}>
                  <ActionCard action={actions[id]} mode="student" onConfirm={onConfirm} onCancel={onCancel} />
                </View>
              ) : null,
            )}
          </View>
        )}
      />

      {messages.length < 3 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => send(s)} style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}>
              <Text style={{ color: t.text, fontSize: 13 }} numberOfLines={1}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={[styles.inputRow, { borderTopColor: t.border, backgroundColor: t.surface }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything, e.g. pay rent lah"
          placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          multiline
          blurOnSubmit
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => send(input)}
          disabled={sending}
          style={[styles.send, { backgroundColor: t.accent, opacity: sending ? 0.6 : 1 }]}
        >
          {sending ? <ActivityIndicator color={t.accentText} /> : <Text style={{ color: t.accentText, fontWeight: '700' }}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  balances: { flexGrow: 0, paddingVertical: 10 },
  balance: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minWidth: 150 },
  error: { paddingHorizontal: 16, fontSize: 13 },
  bubble: { maxWidth: '86%', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13 },
  flag: { fontSize: 12, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  meta: { fontSize: 11, marginTop: 3 },
  chip: { borderWidth: 1, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12, maxWidth: 280 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, maxHeight: 120 },
  send: { borderRadius: 10, paddingHorizontal: 16, height: 42, alignItems: 'center', justifyContent: 'center' },
});
