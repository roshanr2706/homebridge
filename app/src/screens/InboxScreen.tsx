// Smart inbox: Aisha's incoming SMS, email and WhatsApp messages, each already checked by HomeBridge when it arrived
// (backend/app/inbox.py). A list with verdict chips; tapping one opens the triage card with the warning signs and the
// suggested next steps. The agent's own actions are safe by construction: it flags, warns and suggests; a bill is
// drafted only when she taps "Draft this payment", and she still confirms it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { api, type Action, type ForecastCard, type InboxFeed, type InboxMessage } from '../api';
import { ActionCard } from '../components/ActionCard';
import { RunwayCard } from '../components/ResultCards';
import { usePoll } from '../hooks';
import { useT, type Key } from '../i18n';
import { cityTime, money, useFontSet, useTheme } from '../theme';
import { useToast } from '../toast';
import { Body, Button, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

type Tone = 'danger' | 'warn' | 'gold' | 'accent' | 'ok' | 'plain';

function verdictChip(m: InboxMessage): { key: Key; tone: Tone } {
  if (m.verdict === 'scam') return m.confidence === 'high' ? { key: 'inbox.v.scam', tone: 'danger' } : { key: 'inbox.v.suspicious', tone: 'warn' };
  if (m.verdict === 'bill') return { key: 'inbox.v.bill', tone: 'gold' };
  if (m.topic === 'tuition') return { key: 'inbox.v.tuition', tone: 'accent' };
  if (m.verdict === 'personal') return { key: 'inbox.v.personal', tone: 'ok' };
  return { key: 'inbox.v.info', tone: 'plain' };
}

const CHANNEL: Record<InboxMessage['channel'], Key> = { sms: 'inbox.ch.sms', email: 'inbox.ch.email', whatsapp: 'inbox.ch.whatsapp' };

const when = (ts: number) => cityTime('America/Vancouver', new Date(ts * 1000));

export function InboxScreen({
  active,
  onBadge,
  onTab,
}: {
  active: boolean;
  onBadge?: (n: number) => void;
  onTab?: (tab: 'wallet' | 'assistant') => void;
}) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [feed, setFeed] = useState<InboxFeed | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const f = await api.inbox();
      setFeed(f);
      setError('');
      onBadge?.(f.counts.unread);
      // New arrivals since the last poll toast on Aisha's phone wherever she is (the first load only sets the baseline).
      const ids = new Set(f.messages.map((m) => m.id));
      if (seen.current) {
        const fresh = f.messages.filter((m) => !seen.current!.has(m.id));
        const first = fresh[0];
        if (first) {
          const scam = first.verdict === 'scam';
          toast(tr(scam ? 'inbox.toastScam' : 'inbox.toast'), first.headline[tr.lang] ?? first.headline.en, scam ? 'danger' : 'info');
        }
      }
      seen.current = ids;
    } catch {
      setError(api.unreachable);
    } finally {
      setLoading(false);
    }
  }, [onBadge, toast, tr]);

  // Polled even while another tab is open (a little slower), so a new message is announced on whatever screen she is on.
  usePoll(refresh, active ? 2000 : 3000, true);

  const open = feed?.messages.find((m) => m.id === openId) ?? null;

  if (open) {
    return <InboxDetail m={open} onBack={() => setOpenId(null)} onChanged={refresh} onTab={onTab} />;
  }

  if (!feed) {
    return (
      <View style={{ padding: 24 }}>
        <Body style={{ color: error ? t.danger : t.muted }}>{error || tr('loading')}</Body>
      </View>
    );
  }

  const shown = feed.messages.filter((m) => m.status !== 'dismissed');
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      <View style={{ gap: 4 }}>
        <Eyebrow>{tr('inbox.title')}</Eyebrow>
        <Body style={{ fontSize: 13, lineHeight: 19, color: t.muted }}>{tr('inbox.sub')}</Body>
        <Row style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {feed.counts.unread > 0 && <Pill label={tr('inbox.unread', { n: feed.counts.unread })} tone="accent" />}
          {feed.counts.scam > 0 && <Pill label={tr('inbox.scams', { n: feed.counts.scam })} tone="danger" />}
          {feed.counts.bills > 0 && <Pill label={tr('inbox.bills', { n: feed.counts.bills })} tone="gold" />}
        </Row>
      </View>
      {shown.length === 0 ? (
        <Surface>
          <Body style={{ color: t.muted, fontSize: 14 }}>{tr('inbox.empty')}</Body>
        </Surface>
      ) : (
        <Surface style={{ padding: 0, overflow: 'hidden' }}>
          {shown.map((m, i) => (
            <InboxRow key={m.id} m={m} first={i === 0} onPress={() => setOpenId(m.id)} />
          ))}
        </Surface>
      )}
    </ScrollView>
  );
}

function InboxRow({ m, first, onPress }: { m: InboxMessage; first: boolean; onPress: () => void }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const chip = verdictChip(m);
  const unread = m.status === 'new';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.sender}. ${tr(chip.key)}. ${m.headline[tr.lang] ?? m.headline.en}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderColor: t.border,
        backgroundColor: pressed ? t.sunken : 'transparent',
      })}
    >
      <View style={{ width: 8, paddingTop: 7 }}>
        {unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.badge }} />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row style={{ justifyContent: 'space-between', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 14, fontFamily: unread ? fonts.bodyBold : fonts.bodyMedium }} numberOfLines={1}>
            {m.sender}
          </Body>
          <Mono style={{ fontSize: 11, color: t.faint }}>
            {tr(CHANNEL[m.channel])} · {when(m.received_at)}
          </Mono>
        </Row>
        <Row style={{ gap: 8, alignItems: 'flex-start' }}>
          <Pill label={tr(chip.key)} tone={chip.tone} />
          <Body style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: t.muted }} numberOfLines={2}>
            {m.headline[tr.lang] ?? m.headline.en}
          </Body>
        </Row>
      </View>
    </Pressable>
  );
}

function InboxDetail({
  m,
  onBack,
  onChanged,
  onTab,
}: {
  m: InboxMessage;
  onBack: () => void;
  onChanged: () => void;
  onTab?: (tab: 'wallet' | 'assistant') => void;
}) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [runway, setRunway] = useState<ForecastCard | null>(null);
  const chip = verdictChip(m);
  const tone = chip.tone === 'danger' ? 'danger' : chip.tone === 'warn' || chip.tone === 'gold' ? 'warn' : chip.tone === 'ok' ? 'ok' : 'accent';

  // Opening a message marks it read; a draft made earlier is shown again with its live status.
  useEffect(() => {
    if (m.status === 'new') api.inboxMark(m.id, 'read').then(onChanged).catch(() => {});
    if (m.draft_action_id) {
      api
        .actions()
        .then((r) => setAction(r.actions.find((a) => a.action_id === m.draft_action_id) ?? null))
        .catch(() => {});
    }
    // Run once per message opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(tr('inbox.cant'), (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const lock = () =>
    run('lock', async () => {
      await api.freeze();
      toast(tr('inbox.locked'), tr('inbox.lockedBody'), 'danger');
    });
  const draft = () =>
    run('draft', async () => {
      const r = await api.inboxDraft(m.id);
      setAction(r.action);
      toast(tr('inbox.drafted'), tr.summary(r.action.summary), 'info');
      onChanged();
    });
  const dismiss = () =>
    run('dismiss', async () => {
      await api.inboxMark(m.id, 'dismiss');
      onChanged();
      onBack();
    });
  const openRunway = () =>
    run('tuition', async () => {
      setRunway(await api.forecast());
    });
  const onConfirm = async (a: Action) => {
    try {
      const r = await api.confirm(a.action_id, a.confirm_token ?? '');
      setAction({ ...a, ...r });
      if (r.status === 'executed') toast(tr('toast.done'), tr.summary(a.summary), 'ok');
      if (r.status === 'failed') toast(tr('toast.paymentFailed'), String(r.result?.error ?? ''), 'danger');
    } catch (e) {
      toast(tr('toast.cantConfirm'), (e as Error).message, 'danger');
    }
  };
  const onCancel = async (a: Action) => {
    try {
      const r = await api.cancel(a.action_id);
      setAction({ ...a, ...r });
    } catch (e) {
      toast(tr('toast.cantCancel'), (e as Error).message, 'danger');
    }
  };

  const signals = m.signals.filter((s) => s.category !== 'model').concat(m.signals.filter((s) => s.category === 'model'));
  const b = m.bill;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}
    >
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8}>
        <Body style={{ color: t.accent, fontSize: 14, fontFamily: fonts.bodyBold }}>{tr('inbox.back')}</Body>
      </Pressable>

      <View style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 15, fontFamily: fonts.bodyBold }} numberOfLines={2}>
            {m.sender}
          </Body>
          <Mono style={{ fontSize: 11, color: t.faint }}>
            {tr(CHANNEL[m.channel])} · {when(m.received_at)}
          </Mono>
        </Row>
        <Eyebrow style={{ fontSize: 10 }}>{tr('inbox.message')}</Eyebrow>
        <View style={{ backgroundColor: t.sunken, borderRadius: t.radiusSm, padding: 12 }}>
          <Body selectable style={{ fontSize: 13.5, lineHeight: 20 }}>
            {m.text}
          </Body>
        </View>
      </View>

      <Surface tone={tone}>
        <Row style={{ justifyContent: 'space-between', gap: 8 }}>
          <Eyebrow>{tr('inbox.checked')}</Eyebrow>
          <Pill label={tr(chip.key)} tone={chip.tone} />
        </Row>
        <Body style={{ fontSize: 15, lineHeight: 21, fontFamily: fonts.bodyBold, marginTop: 8, color: m.verdict === 'scam' ? t.danger : t.text }}>
          {m.headline[tr.lang] ?? m.headline.en}
        </Body>

        {signals.length > 0 && (
          <View style={{ marginTop: 10, gap: 4 }}>
            <Eyebrow style={{ fontSize: 10 }}>{tr('inbox.signs')}</Eyebrow>
            {signals.map((s) => (
              <Row key={s.name} style={{ gap: 8, alignItems: 'flex-start' }}>
                <Body style={{ color: t.danger, fontSize: 13, lineHeight: 19 }}>⚠</Body>
                <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{tr.d(s.name)}</Body>
              </Row>
            ))}
            {m.quote ? <Body style={{ fontSize: 12, color: t.muted, fontStyle: 'italic' }}>“{m.quote}”</Body> : null}
          </View>
        )}

        {m.claims_payee && m.claims_payee.message_last4 && m.claims_payee.message_last4 !== m.claims_payee.saved_last4 && (
          <Body style={{ fontSize: 12.5, lineHeight: 18, color: t.danger, marginTop: 8 }}>
            {tr('inbox.accountMismatch', { msg: m.claims_payee.message_last4, payee: m.claims_payee.name, saved: m.claims_payee.saved_last4 })}
          </Body>
        )}

        {b && (
          <View style={{ marginTop: 10, gap: 6 }}>
            <Field label={tr('inbox.payee')} value={`${b.payee_name} · ${tr('inbox.savedAccount', { last4: b.saved_last4 })}${m.account_match ? ' ✓' : ''}`} />
            <Field label={tr('inbox.amount')} value={money(b.amount, b.currency)} mono />
            {b.due ? <Field label={tr('inbox.due')} value={tr.date(b.due)} mono /> : null}
            {b.source === 'model' && <Body style={{ fontSize: 11, color: t.faint }}>{tr('inbox.fromModel')}</Body>}
          </View>
        )}

        {m.advice.length > 0 && (
          <View style={{ marginTop: 10, gap: 4 }}>
            <Eyebrow style={{ fontSize: 10 }}>{tr('inbox.advice')}</Eyebrow>
            {m.advice.map((a, i) => (
              <Row key={i} style={{ gap: 8, alignItems: 'flex-start' }}>
                <Body style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>•</Body>
                <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{a[tr.lang] ?? a.en}</Body>
              </Row>
            ))}
          </View>
        )}

        {m.alerted && <Body style={{ fontSize: 12, lineHeight: 17, color: t.muted, marginTop: 8 }}>{tr('inbox.alerted')}</Body>}

        <Row style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {m.actions.includes('lock') && <Button label={tr('inbox.lock')} kind="danger" busy={busy === 'lock'} onPress={lock} />}
          {m.actions.includes('draft') && !action && <Button label={tr('inbox.draft')} busy={busy === 'draft'} onPress={draft} />}
          {m.actions.includes('autopay') && <Button label={tr('inbox.autopay')} kind="ghost" onPress={() => onTab?.('wallet')} />}
          {m.actions.includes('tuition') && !runway && <Button label={tr('inbox.tuition')} busy={busy === 'tuition'} onPress={openRunway} />}
          {m.actions.includes('dismiss') && <Button label={tr('inbox.dismiss')} kind="ghost" busy={busy === 'dismiss'} onPress={dismiss} />}
        </Row>
      </Surface>

      {action && <ActionCard action={action} mode="student" onConfirm={onConfirm} onCancel={onCancel} />}
      {runway && <RunwayCard c={runway} />}
    </ScrollView>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', gap: 12 }}>
      <Body style={{ fontSize: 12.5, color: t.muted }}>{label}</Body>
      {mono ? (
        <Mono style={{ fontSize: 13.5, flexShrink: 1, textAlign: 'right' }}>{value}</Mono>
      ) : (
        <Body style={{ fontSize: 13, flexShrink: 1, textAlign: 'right' }}>{value}</Body>
      )}
    </Row>
  );
}
