// Autopilot: the mandates the family set (backend/app/autopilot.py), how much of each cap is used, and a plain-words
// timeline of every decision the autopilot made. Shown on the student's Wallet, on the sponsor's Rules, and as a card
// in the chat when the assistant proposes or lists mandates.
//
// The chat can only propose. Turning a mandate on, resuming it and widening its caps happen here: the sponsor's kinds
// with his PIN (checked on the server), the student's own kinds with her tap. Pausing and revoking are instant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api, type Action, type AutopilotEntry, type AutopilotFeed, type Card, type Mandate, type Role } from '../api';
import { usePoll } from '../hooks';
import { useT, type Key } from '../i18n';
import { money, useFontSet, useTheme } from '../theme';
import { useToast } from '../toast';
import { Bar, Body, Button, Divider, Eyebrow, Mono, Pill, Row, Surface } from '../ui';
import { PinEntry } from './PinEntry';

const STATUS_TONE: Record<string, 'ok' | 'gold' | 'plain' | 'danger' | 'accent'> = {
  proposed: 'gold',
  active: 'ok',
  paused: 'plain',
  revoked: 'danger',
  expired: 'plain',
};
const OUTCOME_TONE: Record<string, 'ok' | 'gold' | 'plain' | 'danger'> = {
  acted: 'ok',
  escalated: 'gold',
  skipped: 'plain',
  failed: 'danger',
};

function hhmm(ts: number) {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Plus/minus control for one cap, in the mandate's own currency. */
function CapStepper({ label, value, onChange, step, max, currency }: { label: string; value: number; onChange: (v: number) => void; step: number; max: number; currency: string }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const btn = (txt: string, d: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(d < 0 ? 'ru.decrease' : 'ru.increase', { label })}
      onPress={() => onChange(Math.min(max, Math.max(step, Math.round((value + d) / step) * step)))}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: t.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.sunken : t.surface,
      })}
    >
      <Body style={{ fontSize: 18, lineHeight: 20 }}>{txt}</Body>
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Body style={{ flex: 1, fontSize: 13 }}>{label}</Body>
      <Row style={{ gap: 8 }}>
        {btn('−', -step)}
        <Mono style={{ fontFamily: fonts.monoBold, fontSize: 14, minWidth: 92, textAlign: 'center' }}>{money(value, currency, 0)}</Mono>
        {btn('+', step)}
      </Row>
    </Row>
  );
}

type Pending = { verb: 'approve' | 'resume' | 'caps'; caps?: { a: number; p: number } } | null;

export function MandateRow({ m, role, onChanged }: { m: Mandate; role: Role; onChanged: () => void }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [askPin, setAskPin] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);
  const [capA, setCapA] = useState(m.caps.per_action);
  const [capP, setCapP] = useState(m.caps.per_period);
  const zh = tr.lang === 'zh';
  const mine = (role === 'sponsor' && m.granted_by === 'sponsor') || (role === 'student' && m.granted_by === 'student');
  const cur = m.caps.currency;
  const period = tr(m.period === 'week' ? 'ap.period.week' : 'ap.period.month');

  const run = async (label: string, fn: () => Promise<unknown>, done: Key = 'ap.updated') => {
    setBusy(label);
    try {
      await fn();
      toast(tr(done), zh ? m.label_zh : m.label, label === 'revoke' ? 'danger' : 'ok');
      onChanged();
    } catch (e) {
      toast(tr('ap.cantUpdate'), (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  const verb = (v: 'activate' | 'approve' | 'decline' | 'pause' | 'resume' | 'revoke', pin = '', done?: Key) =>
    run(v, () => api.mandate(role, m.id, v, pin), done);
  const widening = capA > m.caps.per_action || capP > m.caps.per_period;
  const saveCaps = (pin = '') =>
    run('caps', async () => {
      await api.mandateCaps(role, m.id, capA, Math.max(capA, capP), pin);
      setEditing(false);
    });
  const onPin = (pin: string) => {
    const p = askPin;
    setAskPin(null);
    if (p?.verb === 'approve') verb('approve', pin, 'ap.approved');
    else if (p?.verb === 'resume') verb('resume', pin);
    else if (p?.verb === 'caps') saveCaps(pin);
  };
  const step = cur === 'MYR' ? 500 : 10;

  return (
    <View style={{ gap: 6, opacity: m.status === 'revoked' || m.status === 'expired' ? 0.55 : 1 }}>
      <Row style={{ justifyContent: 'space-between', gap: 8 }}>
        <Row style={{ gap: 8, flexShrink: 1 }}>
          <Body style={{ fontFamily: fonts.bodyBold, fontSize: 15 }}>{zh ? m.label_zh : m.label}</Body>
          <Pill label={tr(m.granted_by === 'sponsor' ? (role === 'sponsor' ? 'ap.byYou' : 'ap.byDad') : 'ap.byYou')} tone={m.granted_by === 'sponsor' ? 'gold' : 'accent'} />
        </Row>
        <Pill label={tr(`ap.status.${m.status}` as Key)} tone={STATUS_TONE[m.status] ?? 'plain'} />
      </Row>
      <Body style={{ fontSize: 13, lineHeight: 19, color: t.text }}>{zh ? m.text.zh : m.text.en}</Body>
      {(m.status === 'active' || m.status === 'paused') && (
        <View style={{ gap: 4 }}>
          <Bar value={m.used} max={m.caps.per_period} color={m.remaining <= 0 ? t.gold : t.accent} />
          <Mono style={{ fontSize: 11.5, color: t.muted }}>
            {tr('ap.used', { used: money(m.used, cur, 0), cap: money(m.caps.per_period, cur, 0), period })}
          </Mono>
          {m.watch && m.status === 'active' && <Mono style={{ fontSize: 11.5, color: t.accent }}>{zh ? m.watch.zh : m.watch.en}</Mono>}
        </View>
      )}
      {m.status === 'proposed' && !mine && <Body style={{ fontSize: 12, color: t.muted }}>{tr('ap.waitingDad')}</Body>}

      {editing && (
        <View style={{ marginTop: 4 }}>
          <CapStepper label={tr('ap.perActionLabel')} value={capA} onChange={setCapA} step={step} max={m.ceiling.per_action} currency={cur} />
          <CapStepper
            label={tr('ap.perPeriodLabel', { period })}
            value={Math.max(capA, capP)}
            onChange={setCapP}
            step={step}
            max={m.ceiling.per_period}
            currency={cur}
          />
          <Body style={{ fontSize: 11, color: t.faint }}>
            {tr('ap.ceiling', { a: money(m.ceiling.per_action, cur, 0), p: money(m.ceiling.per_period, cur, 0), period })}
          </Body>
        </View>
      )}

      {askPin ? (
        <PinEntry
          title={tr(askPin.verb === 'approve' ? 'ap.pinApprove' : askPin.verb === 'resume' ? 'ap.pinResume' : 'ap.pinWiden')}
          submitLabel={tr(askPin.verb === 'approve' ? 'ap.approve' : askPin.verb === 'resume' ? 'ap.resume' : 'ap.saveCaps')}
          busy={!!busy}
          onSubmit={onPin}
          onCancel={() => setAskPin(null)}
        />
      ) : (
        <Row style={{ gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          {m.status === 'proposed' && mine && role === 'sponsor' && (
            <Button label={tr('ap.approve')} busy={busy === 'approve'} onPress={() => setAskPin({ verb: 'approve' })} style={{ flexGrow: 1 }} />
          )}
          {m.status === 'proposed' && mine && role === 'student' && (
            <Button label={tr('ap.activate')} busy={busy === 'activate'} onPress={() => verb('activate', '', 'ap.activated')} style={{ flexGrow: 1 }} />
          )}
          {m.status === 'proposed' && (mine || role === 'student') && (
            <Button
              label={tr(role === 'student' ? 'ap.withdraw' : 'ap.decline')}
              kind="ghost"
              busy={busy === 'decline'}
              onPress={() => verb('decline', '', 'ap.declined')}
              style={{ flexGrow: 1 }}
            />
          )}
          {mine && m.status === 'active' && (
            <Button label={tr('ap.pause')} kind="ghost" busy={busy === 'pause'} onPress={() => verb('pause')} style={{ flexGrow: 1 }} />
          )}
          {mine && m.status === 'paused' && (
            <Button
              label={tr('ap.resume')}
              busy={busy === 'resume'}
              onPress={() => (role === 'sponsor' ? setAskPin({ verb: 'resume' }) : verb('resume'))}
              style={{ flexGrow: 1 }}
            />
          )}
          {mine && (m.status === 'active' || m.status === 'paused') && !editing && (
            <Button label={tr('ap.widen')} kind="ghost" onPress={() => setEditing(true)} style={{ flexGrow: 1 }} />
          )}
          {editing && (
            <>
              <Button
                label={tr('ap.saveCaps')}
                busy={busy === 'caps'}
                disabled={capA === m.caps.per_action && Math.max(capA, capP) === m.caps.per_period}
                onPress={() => (role === 'sponsor' && widening ? setAskPin({ verb: 'caps' }) : saveCaps())}
                style={{ flexGrow: 1 }}
              />
              <Button label={tr('ap.cancel')} kind="ghost" onPress={() => setEditing(false)} style={{ flexGrow: 1 }} />
            </>
          )}
          {mine && (m.status === 'active' || m.status === 'paused') && (
            <Button label={tr('ap.revoke')} kind="danger" busy={busy === 'revoke'} onPress={() => verb('revoke', '', 'ap.revoked')} style={{ flexGrow: 1 }} />
          )}
        </Row>
      )}
    </View>
  );
}

function Timeline({ items }: { items: AutopilotEntry[] }) {
  const t = useTheme();
  const tr = useT();
  const zh = tr.lang === 'zh';
  if (!items.length) return <Body style={{ fontSize: 12.5, color: t.muted }}>{tr('ap.noActivity')}</Body>;
  const dot = { ok: t.ok, gold: t.gold, plain: t.faint, danger: t.danger };
  return (
    <View style={{ gap: 10 }}>
      {items.map((e) => (
        <Row key={e.id} style={{ gap: 10, alignItems: 'flex-start' }}>
          <View style={{ alignItems: 'center', paddingTop: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot[OUTCOME_TONE[e.outcome] ?? 'plain'] }} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Row style={{ gap: 8 }}>
              <Pill label={tr(`ap.outcome.${e.outcome}` as Key)} tone={OUTCOME_TONE[e.outcome] ?? 'plain'} />
              <Mono style={{ fontSize: 11, color: t.faint }}>
                {tr.date(e.date)} · {hhmm(e.ts)}
              </Mono>
            </Row>
            <Body style={{ fontSize: 12.5, lineHeight: 18 }}>{zh ? e.text.zh : e.text.en}</Body>
          </View>
        </Row>
      ))}
    </View>
  );
}

/** Escalated autopilot drafts waiting for the student: a normal Confirm, like any other draft. */
function PendingDrafts({ items, onChanged }: { items: Action[]; onChanged: () => void }) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  const act = (a: Action, confirm: boolean) => async () => {
    setBusy(a.action_id);
    try {
      const r = confirm && a.confirm_token ? await api.confirm(a.action_id, a.confirm_token) : await api.cancel(a.action_id);
      toast(tr(confirm ? 'ap.confirmed' : 'ap.cancelled'), tr.summary(r.summary), confirm ? 'ok' : 'info');
      onChanged();
    } catch (e) {
      toast(tr('ap.cantUpdate'), (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Surface tone="warn" style={{ gap: 8 }}>
      <Eyebrow>{tr('ap.pendingTitle')}</Eyebrow>
      {items.map((a) => (
        <View key={a.action_id} style={{ gap: 6 }}>
          <Row style={{ justifyContent: 'space-between', gap: 8 }}>
            <Body style={{ flex: 1, fontSize: 13 }}>{tr.summary(a.summary)}</Body>
            <Pill label={a.tier} tone={a.tier === 'T3' ? 'gold' : 'accent'} />
          </Row>
          {a.frozen ? <Body style={{ fontSize: 12, color: t.danger }}>{a.frozen}</Body> : null}
          {a.status === 'awaiting_user' ? (
            <Row style={{ gap: 8 }}>
              <Button label={tr('ap.confirm')} busy={busy === a.action_id} disabled={!a.confirm_token || !!a.frozen} onPress={act(a, true)} style={{ flex: 1 }} />
              <Button label={tr('ap.cancel')} kind="ghost" onPress={act(a, false)} style={{ flex: 1 }} />
            </Row>
          ) : (
            <Body style={{ fontSize: 12, color: t.muted }}>{tr('wal.withSponsor')}</Body>
          )}
        </View>
      ))}
    </Surface>
  );
}

/** Polls the feed (also while the tab is hidden, more slowly) and announces new decisions on this phone, and on the
 * sponsor's phone new proposals waiting for his PIN. */
export function useAutopilotFeed(role: Role, active: boolean, enabled = true) {
  const tr = useT();
  const toast = useToast();
  const [feed, setFeed] = useState<AutopilotFeed | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const f = await api.autopilot(role);
      const proposals = f.mandates.filter((m) => m.status === 'proposed' && m.granted_by === role);
      if (seen.current) {
        const fresh = f.activity.filter((e) => !seen.current!.has(e.id) && (e.outcome === 'acted' || e.outcome === 'escalated'));
        const e = fresh[0]; // newest first
        const asked = proposals.find((m) => !seen.current!.has(m.id));
        if (e) toast(tr(e.outcome === 'acted' ? 'ap.toastActed' : 'ap.toastEscalated'), tr.lang === 'zh' ? e.text.zh : e.text.en, e.outcome === 'acted' ? 'ok' : 'info');
        else if (asked && role === 'sponsor') toast(tr('ap.toastProposal'), tr.lang === 'zh' ? asked.text.zh : asked.text.en, 'info');
      }
      seen.current = new Set([...f.activity.map((e) => e.id), ...proposals.map((m) => m.id)]);
      setFeed(f);
    } catch {
      /* the screen around this panel already reports connection errors */
    }
  }, [role, toast, tr]);
  usePoll(load, active ? 3000 : 6000, enabled);
  return { feed, load };
}

type PanelProps = { role: Role; active: boolean; feed?: AutopilotFeed | null; reload?: () => void };

/** The Autopilot section. A screen that already polls the feed (to toast while hidden) passes it in. */
export function AutopilotPanel({ role, active, feed: given, reload }: PanelProps) {
  const t = useTheme();
  const tr = useT();
  const own = useAutopilotFeed(role, active, given === undefined);
  const feed = given === undefined ? own.feed : given;
  const load = reload ?? own.load;
  const [showAll, setShowAll] = useState(false);
  if (!feed) return null;
  const live = feed.mandates.filter((m) => m.status !== 'revoked');
  const ended = feed.mandates.filter((m) => m.status === 'revoked');
  const activity = showAll ? feed.activity : feed.activity.slice(0, 5);
  return (
    <View style={{ gap: 10 }}>
      {role === 'student' && <PendingDrafts items={feed.pending ?? []} onChanged={load} />}
      <Surface tone={live.some((m) => m.status === 'proposed') && role === 'sponsor' ? 'warn' : 'plain'} style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>{tr('ap.title')}</Eyebrow>
          <Mono style={{ fontSize: 11, color: feed.rate.moved ? t.gold : t.faint }}>
            {tr('ap.rate', { mid: feed.rate.mid.toFixed(4) })}
            {feed.rate.moved ? ` · ${tr('ap.rateMoved')}` : ''}
          </Mono>
        </Row>
        <Body style={{ fontSize: 12.5, color: t.muted, lineHeight: 18 }}>{tr(role === 'student' ? 'ap.introStudent' : 'ap.introSponsor')}</Body>
        {live.length === 0 && (
          <Body style={{ fontSize: 13 }}>{tr(ended.length ? 'ap.noneActive' : role === 'student' ? 'ap.empty' : 'ap.emptySponsor')}</Body>
        )}
        {live.map((m, i) => (
          <View key={m.id}>
            {i > 0 && <Divider />}
            <MandateRow m={m} role={role} onChanged={load} />
          </View>
        ))}
        {ended.length > 0 && <Body style={{ fontSize: 11.5, color: t.faint }}>{tr('ap.ended', { n: ended.length })}</Body>}
      </Surface>
      <Surface style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>{tr('ap.activity')}</Eyebrow>
          {feed.activity.length > 5 && (
            <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" hitSlop={6}>
              <Body style={{ fontSize: 12, color: t.accent }}>{tr(showAll ? 'ap.showLess' : 'ap.showAll')}</Body>
            </Pressable>
          )}
        </Row>
        <Timeline items={activity} />
      </Surface>
    </View>
  );
}

/** The chat card under a proposal or a "what did autopilot do?" answer: the same rows, fetched live. */
export function AutopilotCard({ c }: { c: Extract<Card, { type: 'autopilot' }> }) {
  const t = useTheme();
  const tr = useT();
  const [feed, setFeed] = useState<AutopilotFeed | null>(null);
  const load = useCallback(async () => {
    try {
      setFeed(await api.autopilot('student'));
    } catch {
      /* the chat shows the reply either way */
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);
  usePoll(load, 5000);
  if (!feed) return null;
  const ms = feed.mandates.filter((m) => c.mandate_ids.includes(m.id));
  return (
    <Surface style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>{tr(c.proposal ? 'ap.chatProposal' : 'ap.title')}</Eyebrow>
        <Mono style={{ fontSize: 11, color: t.faint }}>{tr('ap.rate', { mid: feed.rate.mid.toFixed(4) })}</Mono>
      </Row>
      {ms.map((m, i) => (
        <View key={m.id}>
          {i > 0 && <Divider />}
          <MandateRow m={m} role="student" onChanged={load} />
        </View>
      ))}
      {!c.proposal && (
        <>
          <Divider />
          <Timeline items={feed.activity.slice(0, 3)} />
        </>
      )}
      <Body style={{ fontSize: 11, color: t.faint }}>{tr('ap.chatNote')}</Body>
    </Surface>
  );
}
