import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { api, type Action, type Card, type Overview } from '../api';
import { usePoll } from '../hooks';
import { ActionCard } from '../components/ActionCard';
import { ResultCard } from '../components/ResultCards';
import { RichText } from '../components/RichText';
import { amount, cityTime, fonts, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Display, Eyebrow, Mono, Pill, Row } from '../ui';

type Msg = {
  id: string;
  from: 'user' | 'bot';
  text: string;
  actionIds?: string[];
  cards?: Card[];
  flags?: string[];
  tools?: string[];
  provider?: string;
  fallback?: boolean;
};

const SUGGESTIONS: { label: string; text: string; fill?: boolean }[] = [
  { label: 'My balances', text: 'How much money do I have?' },
  { label: 'Cheapest MYR → CAD', text: 'Cheapest way to change 5,000 MYR to CAD?' },
  { label: 'Tuition check', text: 'When is my next tuition due and can I cover it?' },
  { label: 'Pay rent lah', text: 'eh rent how much ah, can pay landlord or not' },
  { label: 'Pay spring tuition', text: 'Pay my spring tuition' },
  { label: 'Check a message for scams', text: 'Is this a scam? ', fill: true },
  { label: 'Ask Dad for money', text: 'Ask my dad for 800 for textbooks' },
  { label: 'Where did my money go?', text: 'Where did my money go this month?' },
  { label: 'Build credit', text: 'How do I build credit in Canada? I have nothing' },
  { label: "How's my credit?", text: "How's my credit?" },
  { label: 'Card under 30%', text: 'Pay my card down to under 30%' },
];

const FLAG_LABEL: Record<string, string> = {
  scam: 'scam pattern',
  injection: 'instruction override',
  extraction: 'data extraction attempt',
  escalation: 'permission claim',
};

const TOOL_LABEL: Record<string, string> = {
  get_balances: 'balances',
  list_transactions: 'transactions',
  list_payees: 'payees',
  get_fx_quotes: 'FX quotes',
  get_fx_history: 'FX history',
  get_tuition_schedule: 'tuition',
  budget_summary: 'budget',
  credit_building_plan: 'credit guide',
  get_credit_profile: 'credit profile',
  prepare_card_payment: 'draft card payment',
  check_message_for_scam: 'scam shield',
  get_pending_actions: 'drafts',
  set_budget: 'set budget',
  create_reminder: 'reminder',
  request_sponsor_topup: 'sponsor request',
  prepare_transfer: 'draft payment',
  prepare_conversion: 'draft conversion',
  add_payee: 'new payee',
  cancel_pending_action: 'cancel draft',
};

function Thinking() {
  const t = useTheme();
  const [dots] = useState(() => [new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]);
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: false }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);
  return (
    <Row style={{ gap: 8, paddingVertical: 6 }}>
      <Row style={{ gap: 4 }}>
        {dots.map((d, i) => (
          <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent, opacity: d }} />
        ))}
      </Row>
      <Body style={{ fontSize: 13, color: t.muted }}>checking your accounts…</Body>
    </Row>
  );
}

function Snapshot({ o }: { o: Overview }) {
  const t = useTheme();
  const next = o.tuition.installments[0];
  const over = o.budget.categories.filter((c) => c.over_budget);
  const tiles: { k: string; v: string; sub: string; tone?: string }[] = [
    { k: 'Total', v: `${amount(o.total_cad, 0)}`, sub: 'CAD, all wallets' },
    next
      ? { k: 'Tuition', v: `${next.days_until_due}d`, sub: o.tuition.next_shortfall_cad > 0 ? `short ${amount(o.tuition.next_shortfall_cad, 0)}` : 'covered', tone: o.tuition.next_shortfall_cad > 0 ? t.gold : t.ok }
      : { k: 'Tuition', v: '—', sub: 'nothing due' },
    { k: 'Budget', v: over.length ? `${over.length} over` : 'on track', sub: over.map((c) => c.category).join(', ') || 'this month', tone: over.length ? t.danger : t.ok },
  ];
  return (
    <View style={{ marginBottom: 14 }}>
      <Eyebrow>Vancouver {cityTime('America/Vancouver')} · Kuala Lumpur {cityTime('Asia/Kuala_Lumpur')}</Eyebrow>
      <Display style={{ fontSize: 26, marginTop: 2, marginBottom: 10 }}>Two homes, one plan.</Display>
      <Row style={{ gap: 8 }}>
        {tiles.map((x) => (
          <View key={x.k} style={[styles.tile, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Body style={{ fontSize: 11, color: t.muted }}>{x.k}</Body>
            <Mono style={{ fontFamily: fonts.monoBold, fontSize: 17, color: x.tone ?? t.text, marginTop: 2 }} numberOfLines={1}>
              {x.v}
            </Mono>
            <Body style={{ fontSize: 11, color: t.muted }} numberOfLines={1}>
              {x.sub}
            </Body>
          </View>
        ))}
      </Row>
    </View>
  );
}

export function AssistantScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 'hello',
      from: 'bot',
      text: "Hi Aisha! I can check balances, compare transfer costs, plan tuition and draft payments. I can't move money on my own: you confirm every payment, and big ones also go to your dad.",
    },
  ]);
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [snap, setSnap] = useState<Overview | null>(null);
  const loadSnap = useCallback(() => {
    api.overview().then(setSnap).catch(() => {});
  }, []);
  usePoll(loadSnap, 60000);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);
  const inputRef = useRef<TextInput>(null);
  // KeyboardAvoidingView compares its own frame (relative to its parent) with the keyboard's screen
  // position, so it needs to know how far down the screen it starts (status bar + app header).
  const rootRef = useRef<View>(null);
  const [kbOffset, setKbOffset] = useState(0);
  const known = useRef<Record<string, string>>({});

  const merge = useCallback(
    (list: Action[], announce: boolean) => {
      setActions((prev) => {
        const next = { ...prev };
        for (const a of list) next[a.action_id] = { ...prev[a.action_id], ...a };
        return next;
      });
      for (const a of list) {
        const before = known.current[a.action_id];
        if (announce && before === 'awaiting_sponsor' && a.status !== before) {
          if (a.status === 'executed') toast('Your sponsor approved', a.summary + (a.sponsor_note ? ` · “${a.sponsor_note}”` : ''), 'ok');
          if (a.status === 'rejected') toast('Your sponsor declined', a.summary + (a.sponsor_note ? ` · “${a.sponsor_note}”` : ''), 'danger');
          if (a.status === 'failed') toast('Approved, but it failed', String(a.result?.error ?? a.summary), 'danger');
        }
        known.current[a.action_id] = a.status;
      }
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    try {
      const act = await api.actions();
      merge(act.actions, true);
      setError('');
    } catch {
      setError(api.unreachable);
    }
  }, [merge]);

  usePoll(refresh, 3000); // picks up sponsor decisions

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setInput('');
    setMessages((m) => [...m, { id: `u${Date.now()}`, from: 'user', text: msg }]);
    setSending(true);
    try {
      const r = await api.chat(msg);
      merge(r.actions, false);
      setMessages((m) => [
        ...m,
        {
          id: `b${Date.now()}`,
          from: 'bot',
          text: r.reply,
          actionIds: r.actions.map((a) => a.action_id),
          cards: r.cards ?? [],
          flags: r.guard.flags,
          tools: r.trace.map((x) => x.tool),
          provider: r.provider,
          fallback: r.fallback,
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, from: 'bot', text: `Something went wrong: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
      loadSnap();
    }
  };

  const update = (a: Action) => {
    known.current[a.action_id] = a.status;
    setActions((p) => ({ ...p, [a.action_id]: { ...p[a.action_id], ...a } }));
  };
  const onConfirm = async (a: Action) => {
    try {
      const r = await api.confirm(a.action_id, a.confirm_token ?? '');
      update(r);
      if (r.status === 'executed') toast('Done', a.summary, 'ok');
      if (r.status === 'failed') toast('That payment failed', String(r.result?.error ?? ''), 'danger');
    } catch (e) {
      toast("Couldn't confirm", (e as Error).message, 'danger');
      refresh();
    }
  };
  const onCancel = async (a: Action) => {
    try {
      update(await api.cancel(a.action_id));
    } catch (e) {
      toast("Couldn't cancel", (e as Error).message, 'danger');
    }
  };

  const pick = (s: (typeof SUGGESTIONS)[number]) => {
    if (s.fill) {
      setInput(s.text);
      inputRef.current?.focus();
    } else send(s.text);
  };

  return (
    // Android is edge-to-edge since SDK 54, so the window no longer resizes for the keyboard and the
    // view has to pad itself, as on iOS. Keyboard events never fire on web, so this is inert there.
    <View
      ref={rootRef}
      style={{ flex: 1 }}
      onLayout={() => rootRef.current?.measureInWindow((_x, y) => setKbOffset(y))}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={kbOffset}>
        {error ? (
          <View style={[styles.offline, { backgroundColor: t.dangerBg }]}>
            <Body style={{ fontSize: 12, color: t.danger }}>{error}</Body>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 8, maxWidth: 720, width: '100%', alignSelf: 'center' }}
          onContentSizeChange={() => active && listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={snap ? <Snapshot o={snap} /> : null}
          ListFooterComponent={sending ? <Thinking /> : null}
          renderItem={({ item }) =>
            item.from === 'user' ? (
              <View style={{ alignItems: 'flex-end', marginVertical: 6 }}>
                <View style={[styles.userBubble, { backgroundColor: t.user }]}>
                  <Body style={{ color: t.userText }}>{item.text}</Body>
                </View>
              </View>
            ) : (
              <View style={{ marginVertical: 8, gap: 8 }}>
                {item.flags && item.flags.length > 0 && (
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Pill label="SAFETY CHECK" tone="danger" />
                    {item.flags.map((f) => (
                      <Pill key={f} label={FLAG_LABEL[f] ?? f} tone="warn" />
                    ))}
                  </Row>
                )}
                <View style={[styles.botBubble, { borderColor: t.border }]}>
                  <RichText text={item.text} />
                </View>
                {item.cards?.map((c, i) => <ResultCard key={i} card={c} />)}
                {item.actionIds?.map((id) =>
                  actions[id] ? <ActionCard key={id} action={actions[id]} mode="student" onConfirm={onConfirm} onCancel={onCancel} /> : null,
                )}
                {item.tools !== undefined && (
                  <Mono style={{ fontSize: 10.5, color: t.faint }}>
                    {item.tools.length ? item.tools.map((x) => TOOL_LABEL[x] ?? x).join(' → ') : 'no tools'} · {item.provider}
                    {item.fallback ? ' (offline fallback)' : ''}
                  </Mono>
                )}
              </View>
            )
          }
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => pick(s)}
              disabled={sending}
              style={({ pressed }) => [styles.chip, { borderColor: s.fill ? t.gold : t.border, backgroundColor: pressed ? t.sunken : t.surface }]}
            >
              <Body style={{ fontSize: 13, color: s.fill ? t.gold : t.text, fontFamily: fonts.bodyMedium }}>{s.label}</Body>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: t.border, backgroundColor: t.surface }]}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything, e.g. can pay rent or not?"
            placeholderTextColor={t.faint}
            style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg, fontFamily: fonts.body }]}
            onSubmitEditing={() => send(input)}
            // A multiline input inserts a newline on Return by default; on phones the Send key should send
            // and keep the keyboard up. react-native-web ignores this prop, so web uses onKeyPress below.
            submitBehavior={Platform.OS === 'web' ? undefined : 'submit'}
            onKeyPress={(e) => {
              // Enter sends on web; Shift+Enter keeps a newline for pasted messages.
              const ne = e.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
              const composing = ne.isComposing || ne.keyCode === 229; // IME candidate selection, e.g. pinyin
              if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey && !composing) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                send(input);
              }
            }}
            returnKeyType="send"
            multiline
            accessibilityLabel="Message"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => send(input)}
            disabled={sending || !input.trim()}
            style={[styles.send, { backgroundColor: t.accent, opacity: sending || !input.trim() ? 0.45 : 1 }]}
          >
            <Body style={{ color: t.accentText, fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 20 }}>↑</Body>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10 },
  offline: { paddingHorizontal: 16, paddingVertical: 6 },
  userBubble: { maxWidth: '86%', borderRadius: 18, borderBottomRightRadius: 4, paddingVertical: 9, paddingHorizontal: 14 },
  botBubble: { paddingLeft: 12, borderLeftWidth: 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140, minHeight: 42 },
  send: { borderRadius: 21, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
});
