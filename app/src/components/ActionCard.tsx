import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import type { Action } from '../api';
import { stepUp, useStepUpNote } from '../stepUp';
import { amount, cityTime, fonts, klHour, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Bar, Body, Button, DashedRule, Eyebrow, Mono, Pill, Row } from '../ui';

type Props = {
  action: Action;
  mode: 'student' | 'sponsor';
  onConfirm?: (a: Action) => Promise<void>;
  onCancel?: (a: Action) => Promise<void>;
  onApprove?: (a: Action, note: string) => Promise<void>;
  onReject?: (a: Action, note: string) => Promise<void>;
};

const KIND: Record<string, string> = {
  transfer: 'Payment',
  conversion: 'Currency conversion',
  add_payee: 'New payee',
  topup: 'Money request to sponsor',
};

const TIER: Record<string, string> = {
  T1: 'Sponsor decides',
  T2: 'You confirm',
  T3: 'You + sponsor',
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// A same-currency "conversion" is a move between the student's own accounts (e.g. Everyday to Tuition Fund).
const isMove = (a: Action) => a.kind === 'conversion' && a.params.from_currency === a.params.to_currency;

function headline(a: Action): { big: string; sub?: string } {
  const p = a.params;
  if (isMove(a)) return { big: money(p.amount, p.from_currency), sub: a.summary.replace(/^Move [^ ]+ [^ ]+ /, '') };
  if (a.kind === 'transfer') return { big: money(p.amount, p.currency), sub: `to ${p.payee_name}` };
  if (a.kind === 'conversion')
    return { big: money(p.amount, p.from_currency), sub: `→ about ${money(p.expected_receive, p.to_currency)}` };
  if (a.kind === 'topup') return { big: money(p.amount, p.currency), sub: p.reason ? `for ${p.reason}` : undefined };
  if (a.kind === 'add_payee') return { big: p.name, sub: `${p.kind} · ${p.currency} · account ${p.number_masked}` };
  return { big: a.summary };
}

function details(a: Action): [string, string][] {
  const p = a.params;
  if (a.kind === 'transfer') {
    const rows: [string, string][] = [
      ['To', p.payee_name],
      ['From', p.from_account],
    ];
    if (p.memo) rows.push(['Memo', p.memo]);
    return rows;
  }
  if (isMove(a)) return [['Fee', 'None: between your own accounts']];
  if (a.kind === 'conversion')
    return [
      ['Rate', `${p.rate} ${p.to_currency} per ${p.from_currency}`],
      ['You receive', money(p.expected_receive, p.to_currency)],
    ];
  return [];
}

type Step = { label: string; state: 'done' | 'current' | 'todo' | 'bad' };

function steps(a: Action, mode: Props['mode']): Step[] {
  const bad = ['rejected', 'cancelled', 'expired', 'failed'].includes(a.status);
  const out: Step[] = [{ label: 'Drafted', state: 'done' }];
  if (a.kind !== 'topup') {
    out.push({
      label: mode === 'sponsor' ? 'Confirmed' : 'You confirm',
      state: a.user_confirmed ? 'done' : a.status === 'awaiting_user' ? 'current' : bad ? 'bad' : 'todo',
    });
  }
  if (a.needs_sponsor_approval) {
    out.push({
      label: mode === 'sponsor' ? 'You approve' : 'Dad approves',
      state:
        a.sponsor_decision === 'approved'
          ? 'done'
          : a.sponsor_decision === 'rejected'
            ? 'bad'
            : a.status === 'awaiting_sponsor'
              ? 'current'
              : bad && a.user_confirmed
                ? 'bad'
                : 'todo',
    });
  }
  out.push({ label: a.status === 'failed' ? 'Failed' : 'Done', state: a.status === 'executed' ? 'done' : a.status === 'failed' ? 'bad' : 'todo' });
  return out;
}

function Timeline({ items }: { items: Step[] }) {
  const t = useTheme();
  const color = (s: Step['state']) => (s === 'done' ? t.accent : s === 'current' ? t.gold : s === 'bad' ? t.danger : t.border);
  return (
    <View style={{ marginTop: 14 }}>
      <Row>
        {items.map((s, i) => (
          <Row key={s.label} style={{ flex: i < items.length - 1 ? 1 : 0 }}>
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: s.state === 'todo' ? 'transparent' : color(s.state),
                borderWidth: 2,
                borderColor: color(s.state),
              }}
            />
            {i < items.length - 1 && <View style={{ flex: 1, height: 2, backgroundColor: s.state === 'done' ? t.accent : t.border }} />}
          </Row>
        ))}
      </Row>
      <Row style={{ marginTop: 5 }}>
        {items.map((s, i) => (
          <Body
            key={s.label}
            style={{
              flex: 1,
              fontSize: 10.5,
              color: s.state === 'current' ? t.gold : s.state === 'bad' ? t.danger : t.muted,
              fontFamily: s.state === 'current' ? fonts.bodyBold : fonts.body,
              textAlign: i === 0 ? 'left' : i === items.length - 1 ? 'right' : 'center',
            }}
          >
            {s.label}
          </Body>
        ))}
      </Row>
    </View>
  );
}

const STATUS_TEXT: Record<string, string> = {
  executed: 'Done',
  rejected: 'Rejected by sponsor',
  cancelled: 'Cancelled',
  expired: 'Expired: draft again if you still need it',
  failed: 'Failed',
};

export function ActionCard({ action: a, mode, onConfirm, onCancel, onApprove, onReject }: Props) {
  const t = useTheme();
  const toast = useToast();
  const stepUpNote = useStepUpNote();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const now = useNow(a.status === 'awaiting_user');
  const risky = a.risk_score >= 40;
  const untrusted = Object.entries(a.provenance ?? {}).filter(([, v]) => v === 'untrusted').map(([k]) => k);
  const h = headline(a);
  const left = Math.max(0, Math.round(a.expires_at - now / 1000));
  const sponsorWhy = a.sponsor_reasons ?? [];
  const signals = a.risk_signals ?? a.risk_reasons.filter((r) => !sponsorWhy.includes(r));
  const failedMsg = a.status === 'failed' ? (a.result?.error as string | undefined) : undefined;
  // Payments are locked: the server refuses Confirm and Approve, so the buttons say so up front.
  const frozen = a.frozen && ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? a.frozen : null;
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));

  const run = (name: string, fn?: () => Promise<void>) => async () => {
    if (!fn) return;
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  // Confirm and Approve move money, so they need the device owner first (Face ID, fingerprint or
  // passcode). A failed or cancelled check never reaches the API. Cancel, Withdraw and Reject don't ask.
  const guarded = (name: string, prompt: string, fn?: () => Promise<void>) =>
    run(
      name,
      fn &&
        (async () => {
          const check = await stepUp(prompt);
          if (!check.ok) {
            toast(mode === 'sponsor' ? 'Not approved' : 'Not confirmed', `${check.reason} Nothing was sent.`, 'danger');
            return;
          }
          await fn();
        }),
    );
  const what = `${h.big}${h.sub ? ` ${h.sub}` : ''}`;
  const deviceNote = stepUpNote ? (
    <Mono style={{ fontSize: 10.5, color: t.faint, marginTop: mode === 'student' ? 6 : 0, textAlign: 'right' }}>{stepUpNote}</Mono>
  ) : null;

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: risky ? t.danger : t.border, shadowColor: t.shadow }]}>
      {/* perforated top edge, like a cheque stub */}
      <View style={[styles.stub, { backgroundColor: risky ? t.dangerBg : t.accentSoft }]}>
        <Eyebrow style={{ color: risky ? t.danger : t.accent }}>{isMove(a) ? 'Move between your accounts' : KIND[a.kind] ?? a.kind}</Eyebrow>
        <Row style={{ gap: 6 }}>
          <Mono style={{ fontSize: 11, color: risky ? t.danger : t.accent, fontFamily: fonts.monoBold }}>{a.tier}</Mono>
          <Body style={{ fontSize: 11, color: risky ? t.danger : t.accent }}>{TIER[a.tier] ?? ''}</Body>
        </Row>
      </View>
      <DashedRule color={risky ? t.danger : t.accent} />

      <View style={{ padding: 14, paddingTop: 12 }}>
        <Mono style={{ fontFamily: fonts.monoBold, fontSize: a.kind === 'add_payee' ? 18 : 24, letterSpacing: -0.5 }}>{h.big}</Mono>
        {h.sub ? <Body style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{h.sub}</Body> : null}

        {details(a).length > 0 && (
          <View style={styles.details}>
            <DashedRule color={t.border} style={{ marginBottom: 8 }} />
            {details(a).map(([k, v]) => (
              <Row key={k} style={{ justifyContent: 'space-between', paddingVertical: 3, gap: 12 }}>
                <Body style={{ fontSize: 12, color: t.muted }}>{k}</Body>
                <Body style={{ fontSize: 13, flexShrink: 1, textAlign: 'right' }} numberOfLines={2}>
                  {v}
                </Body>
              </Row>
            ))}
          </View>
        )}

        {untrusted.length > 0 && (
          <View style={[styles.box, { backgroundColor: t.dangerBg }]}>
            <Body style={{ fontSize: 13, color: t.danger, fontFamily: fonts.bodyBold }}>
              The {untrusted.join(' and ')} came from a message you pasted or quoted, not from you.
            </Body>
            <Body style={{ fontSize: 12, color: t.danger }}>Check it against an official source before you confirm.</Body>
          </View>
        )}

        {sponsorWhy.length > 0 && (
          <View style={[styles.box, { backgroundColor: t.goldSoft }]}>
            <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold, color: t.gold, marginBottom: 4 }}>
              {mode === 'sponsor' ? 'Why this came to you' : 'Why your sponsor approves this'}
            </Body>
            {sponsorWhy.map((r) => (
              <Body key={r} style={{ fontSize: 12.5, lineHeight: 18, color: t.text }}>
                • {r}
              </Body>
            ))}
          </View>
        )}

        {signals.length > 0 && (
          <View style={[styles.box, { backgroundColor: risky ? t.dangerBg : t.warnBg }]}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold, color: risky ? t.danger : t.warn }}>Risk signals</Body>
              <Mono style={{ fontSize: 11, color: risky ? t.danger : t.warn }}>risk {a.risk_score}/100</Mono>
            </Row>
            <Bar value={a.risk_score} max={100} color={risky ? t.danger : t.gold} height={4} />
            <View style={{ marginTop: 6, gap: 2 }}>
              {signals.map((r) => (
                <Body key={r} style={{ fontSize: 12.5, lineHeight: 18, color: risky ? t.danger : t.warn }}>
                  • {r}
                </Body>
              ))}
            </View>
          </View>
        )}
        {frozen && (
          <View style={[styles.box, { backgroundColor: t.dangerBg }]}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <Body style={{ fontSize: 13, color: t.danger, fontFamily: fonts.bodyBold }}>Payments are locked</Body>
              <Pill label="FROZEN" tone="danger" />
            </Row>
            <Body style={{ fontSize: 12.5, lineHeight: 18, color: t.danger }}>
              {frozen.charAt(0).toUpperCase() + frozen.slice(1)}. Nothing can be confirmed or approved while payments are locked.
            </Body>
          </View>
        )}
        {warnings.map((w) => (
          <Body key={w} style={{ fontSize: 12.5, color: t.warn, marginTop: 8, lineHeight: 18 }}>
            {w}
          </Body>
        ))}

        <Timeline items={steps(a, mode)} />

        {a.status === 'awaiting_user' && mode === 'student' && (
          <Mono style={{ fontSize: 11, color: left < 60 ? t.danger : t.faint, marginTop: 10 }}>
            single-use confirmation · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </Mono>
        )}
        {a.status === 'awaiting_sponsor' && mode === 'student' && (
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 10 }}>
            Sent to your sponsor. It’s {cityTime('Asia/Kuala_Lumpur')} in Kuala Lumpur
            {klHour() >= 23 || klHour() < 7 ? ', so they may be asleep.' : '.'}
          </Body>
        )}
        {STATUS_TEXT[a.status] && (
          <Row style={{ marginTop: 10, gap: 8 }}>
            <Pill label={STATUS_TEXT[a.status].toUpperCase()} tone={a.status === 'executed' ? 'ok' : 'danger'} />
            {a.status === 'executed' && a.result?.new_balance !== undefined && (
              <Mono style={{ fontSize: 11, color: t.muted }}>new balance {amount(a.result.new_balance)}</Mono>
            )}
          </Row>
        )}
        {a.sponsor_note ? (
          <Body style={{ fontSize: 13, marginTop: 8, fontFamily: fonts.displayItalic, color: t.muted }}>“{a.sponsor_note}”</Body>
        ) : null}
        {failedMsg ? <Body style={{ fontSize: 12.5, color: t.danger, marginTop: 6 }}>{failedMsg}</Body> : null}

        {mode === 'student' && a.status === 'awaiting_user' && (
          <>
            <Row style={{ gap: 10, marginTop: 14 }}>
              <Button label="Cancel" kind="ghost" busy={busy === 'cancel'} onPress={run('cancel', onCancel && (() => onCancel(a)))} style={{ flex: 1 }} />
              <Button
                label={frozen ? 'Locked' : a.needs_sponsor_approval ? 'Confirm & send to sponsor' : 'Confirm'}
                busy={busy === 'confirm'}
                disabled={!!frozen}
                onPress={guarded('confirm', `Confirm ${what}`, onConfirm && (() => onConfirm(a)))}
                style={{ flex: 2 }}
              />
            </Row>
            {deviceNote}
          </>
        )}
        {mode === 'student' && a.status === 'awaiting_sponsor' && onCancel && (
          <Button label="Withdraw request" kind="ghost" busy={busy === 'cancel'} onPress={run('cancel', () => onCancel(a))} style={{ marginTop: 12 }} />
        )}
        {mode === 'sponsor' && a.status === 'awaiting_sponsor' && (
          <View style={{ marginTop: 14, gap: 10 }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a note for Aisha (optional)"
              placeholderTextColor={t.faint}
              maxLength={200}
              style={[styles.note, { color: t.text, borderColor: t.border, backgroundColor: t.bg, fontFamily: fonts.body }]}
            />
            <Row style={{ gap: 10 }}>
              <Button label="Reject" kind="danger" busy={busy === 'reject'} onPress={run('reject', onReject && (() => onReject(a, note)))} style={{ flex: 1 }} />
              <Button
                label={frozen ? 'Locked' : 'Approve'}
                busy={busy === 'approve'}
                disabled={!!frozen}
                onPress={guarded('approve', `Approve ${what}`, onApprove && (() => onApprove(a, note)))}
                style={{ flex: 2 }}
              />
            </Row>
            {deviceNote}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    marginVertical: 6,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 2,
  },
  stub: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  details: { marginTop: 12 },
  box: { borderRadius: 10, padding: 10, marginTop: 12 },
  note: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
});
