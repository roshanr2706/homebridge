import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { api, type Action, type Card, type Overview } from '../api';
import { usePoll } from '../hooks';
import { ActionCard } from '../components/ActionCard';
import { ResultCard } from '../components/ResultCards';
import { RichText } from '../components/RichText';
import { useT, type Key, type Lang } from '../i18n';
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

type Suggestion = { label: string; text: string; fill?: boolean };

const SUGGESTIONS: Record<Lang, Suggestion[]> = {
  en: [
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
  ],
  // Each prompt is one the offline engine routes in Chinese (backend/tests/test_i18n.py), and it answers in Chinese.
  zh: [
    { label: '我的余额', text: '我还有多少钱？' },
    { label: '马币换加币最便宜', text: '最便宜的马币换加币' },
    { label: '学费够吗', text: '学费够吗？' },
    { label: '钱够用到学期末吗', text: '我的钱够用到学期末吗？' },
    { label: '交房租', text: '帮我交房租' },
    { label: '查诈骗信息', text: '帮我查一下这条信息是不是诈骗' },
    { label: '问爸爸要钱', text: '问爸爸要800加币买课本' },
    { label: '这个月花了多少', text: '我这个月花了多少？' },
    { label: '建立信用', text: '怎么在加拿大建立信用' },
    { label: '我的信用', text: '我的信用怎么样' },
  ],
};

const FLAG_KEY: Record<string, Key> = {
  scam: 'flag.scam',
  injection: 'flag.injection',
  extraction: 'flag.extraction',
  escalation: 'flag.escalation',
};

const TOOL_LABEL_ZH: Record<string, string> = {
  get_balances: '余额',
  list_transactions: '交易',
  list_payees: '收款人',
  get_fx_quotes: '汇率报价',
  get_fx_history: '汇率走势',
  get_tuition_schedule: '学费',
  budget_summary: '预算',
  credit_building_plan: '信用指南',
  get_credit_profile: '信用档案',
  prepare_card_payment: '起草还卡',
  check_message_for_scam: '防诈骗',
  get_pending_actions: '草稿',
  set_budget: '设预算',
  create_reminder: '提醒',
  request_sponsor_topup: '向担保人申请',
  get_remittance_status: '汇款进度',
  prepare_transfer: '起草付款',
  prepare_conversion: '起草兑换',
  add_payee: '新收款人',
  cancel_pending_action: '取消草稿',
  forecast_cashflow: '现金流预测',
  get_limits: '限额',
  freeze_payments: '锁定付款',
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
  get_remittance_status: 'remittance status',
  prepare_transfer: 'draft payment',
  prepare_conversion: 'draft conversion',
  add_payee: 'new payee',
  cancel_pending_action: 'cancel draft',
};

function Thinking() {
  const t = useTheme();
  const tr = useT();
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
      <Body style={{ fontSize: 13, color: t.muted }}>{tr('thinking')}</Body>
    </Row>
  );
}

function Snapshot({ o }: { o: Overview }) {
  const t = useTheme();
  const tr = useT();
  const next = o.tuition.installments[0];
  const over = o.budget.categories.filter((c) => c.over_budget);
  const short = o.tuition.next_shortfall_cad > 0;
  const tiles: { k: string; v: string; sub: string; tone?: string }[] = [
    { k: tr('snap.total'), v: `${amount(o.total_cad, 0)}`, sub: tr('snap.totalSub') },
    next
      ? {
          k: tr('snap.tuition'),
          v: tr('snap.days', { n: next.days_until_due }),
          sub: short ? tr('snap.short', { n: amount(o.tuition.next_shortfall_cad, 0) }) : tr('snap.covered'),
          tone: short ? t.gold : t.ok,
        }
      : { k: tr('snap.tuition'), v: '—', sub: tr('snap.nothingDue') },
    {
      k: tr('snap.budget'),
      v: over.length ? tr('snap.over', { n: over.length }) : tr('snap.onTrack'),
      sub: over.map((c) => tr.d(c.category)).join(tr.lang === 'zh' ? '、' : ', ') || tr('snap.thisMonth'),
      tone: over.length ? t.danger : t.ok,
    },
  ];
  return (
    <View style={{ marginBottom: 14 }}>
      <Eyebrow>
        {tr('city.vancouver')} {cityTime('America/Vancouver')} · {tr('city.kl')} {cityTime('Asia/Kuala_Lumpur')}
      </Eyebrow>
      <Display style={{ fontSize: 26, marginTop: 2, marginBottom: 10 }}>{tr('snap.title')}</Display>
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

// The greeting is rendered in the current UI language (see renderItem), so it follows the EN / 中文 switch.
const HELLO: Msg = { id: 'hello', from: 'bot', text: '' };

export function AssistantScreen({ active }: { active: boolean }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [messages, setMessages] = useState<Msg[]>([HELLO]);
  // One server-side chat per id. "New chat" starts a fresh one, which also drops any safety flag the old chat
  // carried; the limits, sponsor approval and cooling periods never depended on that flag.
  const [sessionId, setSessionId] = useState(api.newSessionId);
  const [chatFlags, setChatFlags] = useState<string[]>([]);
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
        // A money request: Dad sent it (in transit), then it arrived.
        if (announce && a.kind === 'topup' && before && a.status !== before) {
          if (a.status === 'in_transit') toast(tr('toast.remitSent'), tr.summary(a.summary) + (a.sponsor_note ? ` · “${a.sponsor_note}”` : ''), 'ok');
          if (a.status === 'executed') toast(tr('toast.remitArrived'), tr.summary(a.summary), 'ok');
        }
        if (announce && before === 'awaiting_sponsor' && a.status !== before && a.status !== 'in_transit' && !(a.kind === 'topup' && a.status === 'executed')) {
          if (a.status === 'executed') toast(tr('toast.sponsorApproved'), tr.summary(a.summary) + (a.sponsor_note ? ` · “${a.sponsor_note}”` : ''), 'ok');
          if (a.status === 'rejected') toast(tr('toast.sponsorDeclined'), tr.summary(a.summary) + (a.sponsor_note ? ` · “${a.sponsor_note}”` : ''), 'danger');
          if (a.status === 'failed') toast(tr('toast.approvedFailed'), String(a.result?.error ?? tr.summary(a.summary)), 'danger');
        }
        known.current[a.action_id] = a.status;
      }
    },
    [toast, tr],
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
      const r = await api.chat(msg, sessionId);
      merge(r.actions, false);
      setChatFlags(r.guard.session_flags ?? []);
      // "Did dad send the money?": the money requests show as their own action cards, with the live timeline.
      const remitIds = (r.cards ?? []).flatMap((c) => (c.type === 'remittance' ? c.action_ids : []));
      if (remitIds.length) refresh();
      setMessages((m) => [
        ...m,
        {
          id: `b${Date.now()}`,
          from: 'bot',
          text: r.reply,
          actionIds: [...new Set([...r.actions.map((a) => a.action_id), ...remitIds])],
          cards: r.cards ?? [],
          flags: r.guard.flags,
          tools: r.trace.map((x) => x.tool),
          provider: r.provider,
          fallback: r.fallback,
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, from: 'bot', text: tr('chat.error', { msg: (e as Error).message }) }]);
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
      if (r.status === 'executed') toast(tr('toast.done'), tr.summary(a.summary), 'ok');
      if (r.status === 'failed') toast(tr('toast.paymentFailed'), String(r.result?.error ?? ''), 'danger');
    } catch (e) {
      toast(tr('toast.cantConfirm'), (e as Error).message, 'danger');
      refresh();
    }
  };
  const onCancel = async (a: Action) => {
    try {
      update(await api.cancel(a.action_id));
    } catch (e) {
      toast(tr('toast.cantCancel'), (e as Error).message, 'danger');
    }
  };

  const newChat = () => {
    if (sending) return;
    setSessionId(api.newSessionId());
    setMessages([HELLO]);
    setChatFlags([]);
    setInput('');
  };

  const toolLabel = (x: string) => (tr.lang === 'zh' ? TOOL_LABEL_ZH[x] : TOOL_LABEL[x]) ?? x;

  const pick = (s: Suggestion) => {
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
          extraData={tr}
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
                    <Pill label={tr('chat.safety')} tone="danger" />
                    {item.flags.map((f) => (
                      <Pill key={f} label={FLAG_KEY[f] ? tr(FLAG_KEY[f]) : f} tone="warn" />
                    ))}
                  </Row>
                )}
                <View style={[styles.botBubble, { borderColor: t.border }]}>
                  <RichText text={item.id === HELLO.id ? tr('hello') : item.text} />
                </View>
                {item.cards?.map((c, i) => <ResultCard key={i} card={c} />)}
                {item.actionIds?.map((id) =>
                  actions[id] ? <ActionCard key={id} action={actions[id]} mode="student" onConfirm={onConfirm} onCancel={onCancel} /> : null,
                )}
                {item.tools !== undefined && (
                  <Mono style={{ fontSize: 10.5, color: t.faint }}>
                    {item.tools.length ? item.tools.map((x) => toolLabel(x)).join(' → ') : tr('chat.noTools')} · {item.provider}
                    {item.fallback ? tr('chat.fallback') : ''}
                  </Mono>
                )}
              </View>
            )
          }
        />

        {chatFlags.length > 0 && (
          <View style={[styles.flagBar, { backgroundColor: t.warnBg }]}>
            <Body style={{ flex: 1, fontSize: 12, color: t.warn }}>
              {tr('chat.flagged', { flags: chatFlags.map((f) => (FLAG_KEY[f] ? tr(FLAG_KEY[f]) : f)).join(tr.lang === 'zh' ? '、' : ', ') })}
            </Body>
            <Pressable accessibilityRole="button" onPress={newChat} disabled={sending} hitSlop={8}>
              <Body style={{ fontSize: 12, color: t.warn, fontFamily: fonts.bodyBold, textDecorationLine: 'underline' }}>
                {tr('chat.newChatLink')}
              </Body>
            </Pressable>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          {messages.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('chat.newChatLabel')}
              onPress={newChat}
              disabled={sending}
              style={({ pressed }) => [styles.chip, { borderColor: t.accent, backgroundColor: pressed ? t.sunken : t.surface }]}
            >
              <Body style={{ fontSize: 13, color: t.accent, fontFamily: fonts.bodyMedium }}>{tr('chat.newChat')}</Body>
            </Pressable>
          )}
          {SUGGESTIONS[tr.lang].map((s) => (
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
            placeholder={tr('chat.placeholder')}
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
            accessibilityLabel={tr('chat.message')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('chat.send')}
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
  flagBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 7 },
  userBubble: { maxWidth: '86%', borderRadius: 18, borderBottomRightRadius: 4, paddingVertical: 9, paddingHorizontal: 14 },
  botBubble: { paddingLeft: 12, borderLeftWidth: 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 140, minHeight: 42 },
  send: { borderRadius: 21, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
});
