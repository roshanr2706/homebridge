import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Action, Compliance, ComplianceCheck, RemitOption, RemitQuote } from '../api';
import { stepUp, useStepUpNote } from '../stepUp';
import { PinEntry } from './PinEntry';
import { useT, type Key, type T } from '../i18n';
import { amount, cityTime, fonts, klHour, money, useTheme } from '../theme';
import { useToast } from '../toast';
import { Bar, Body, Button, DashedRule, Eyebrow, Mono, Pill, Row } from '../ui';

type Props = {
  action: Action;
  mode: 'student' | 'sponsor';
  onConfirm?: (a: Action) => Promise<void>;
  onCancel?: (a: Action) => Promise<void>;
  // Called after the device check and the sponsor's PIN; the server checks the PIN. For a money request,
  // `provider` is the transfer service the sponsor picked.
  onApprove?: (a: Action, note: string, pin: string, provider?: string) => Promise<void>;
  onReject?: (a: Action, note: string) => Promise<void>;
};

const KIND: Record<string, Key> = {
  transfer: 'kind.transfer',
  conversion: 'kind.conversion',
  add_payee: 'kind.add_payee',
  topup: 'kind.topup',
};

const TIER: Record<string, Key> = {
  T1: 'tier.T1',
  T2: 'tier.T2',
  T3: 'tier.T3',
};

// Fields the policy engine marks as coming from pasted or quoted text.
const FIELD: Record<string, Key> = { amount: 'field.amount', payee: 'field.payee', memo: 'field.memo' };

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

function headline(a: Action, tr: T): { big: string; sub?: string } {
  const p = a.params;
  if (isMove(a)) {
    const m = /^Move \S+ \S+ from (.+) to (.+)$/.exec(a.summary);
    return { big: money(p.amount, p.from_currency), sub: m ? tr('act.move', { from: tr.d(m[1]), to: tr.d(m[2]) }) : a.summary };
  }
  if (a.kind === 'transfer') return { big: money(p.amount, p.currency), sub: tr('act.to', { payee: p.payee_name }) };
  if (a.kind === 'conversion')
    return { big: money(p.amount, p.from_currency), sub: tr('act.about', { v: money(p.expected_receive, p.to_currency) }) };
  if (a.kind === 'topup') return { big: money(p.amount, p.currency), sub: p.reason ? tr('act.for', { reason: p.reason }) : undefined };
  if (a.kind === 'add_payee') return { big: p.name, sub: tr('act.payee', { kind: tr.d(p.kind), currency: p.currency, number: p.number_masked }) };
  return { big: tr.summary(a.summary) };
}

// Seconds until an in-transit remittance arrives, from the server's settle time.
function etaText(a: Action, now: number, tr: T): string {
  const at = a.remittance?.settle_after;
  if (!at) return '';
  const s = Math.max(0, Math.round(at - now / 1000));
  if (s < 3600) return tr('det.etaSoon', { s });
  const d = new Date(at * 1000);
  return `${tr.date(d.toISOString().slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function remitDetails(a: Action, mode: Props['mode'], tr: T, now: number): [string, string][] {
  const p = a.params;
  const q = p.quote as RemitQuote | undefined;
  const rows: [string, string][] = [];
  if (q) {
    rows.push([tr('det.via'), `${tr.d(q.provider)} · ${tr.d(q.speed)}`]);
    rows.push([tr(mode === 'sponsor' ? 'det.youSend' : 'det.dadSends'), `${money(q.send_amount, q.send_currency)} (${tr('rm.fee', { v: money(q.fee, q.fee_currency) })})`]);
    if (q.receive_currency !== q.send_currency) rows.push([tr('det.rate'), tr('det.rateValue', { rate: q.rate, to: q.receive_currency, from: q.send_currency })]);
    rows.push([tr(mode === 'sponsor' ? 'det.aishaGets' : 'det.receive'), money(q.receive_amount, q.receive_currency)]);
  }
  if (p.to_account) rows.push([tr('det.into'), tr.d(p.to_account)]);
  if (a.status === 'in_transit') rows.push([tr('det.eta'), etaText(a, now, tr)]);
  if (a.remittance?.reference) rows.push([tr('det.ref'), a.remittance.reference]);
  return rows;
}

function details(a: Action, tr: T, mode: Props['mode'] = 'student', now = Date.now()): [string, string][] {
  const p = a.params;
  if (a.kind === 'topup') return remitDetails(a, mode, tr, now);
  if (a.kind === 'transfer') {
    const rows: [string, string][] = [
      [tr('det.to'), p.payee_name],
      [tr('det.from'), tr.d(p.from_account)],
    ];
    if (p.memo) rows.push([tr('det.memo'), tr.d(p.memo)]);
    return rows;
  }
  if (isMove(a)) return [[tr('det.fee'), tr('det.noFee')]];
  if (a.kind === 'conversion')
    return [
      [tr('det.rate'), tr('det.rateValue', { rate: p.rate, to: p.to_currency, from: p.from_currency })],
      [tr('det.receive'), money(p.expected_receive, p.to_currency)],
    ];
  return [];
}

type Step = { label: string; state: 'done' | 'current' | 'todo' | 'bad' };

// A money request: asked → the sponsor approves → sent (quote locked, his account debited) → compliance checks →
// in transit → credited. Each step's time comes from the server (remittance.timeline).
function remitSteps(a: Action, mode: Props['mode'], tr: T): Step[] {
  const tl = a.remittance?.timeline ?? {};
  const bad = ['rejected', 'cancelled', 'expired', 'failed', 'blocked'].includes(a.status);
  const state = (done: boolean, current: boolean, failed: boolean): Step['state'] =>
    done ? 'done' : failed ? 'bad' : current ? 'current' : 'todo';
  // Declined, withdrawn or expired before the sponsor sent anything.
  const stopped = bad && a.sponsor_decision !== 'approved';
  return [
    { label: tr('step.asked'), state: 'done' },
    {
      label: tr(mode === 'sponsor' ? 'step.youApprove' : 'step.dadApproves'),
      state: state(a.sponsor_decision === 'approved', a.status === 'awaiting_sponsor', stopped),
    },
    { label: tr('step.sent'), state: state(!!tl.initiated, false, false) },
    { label: tr('step.checked'), state: state(!!tl.compliance_checked && a.status !== 'blocked', false, a.status === 'blocked') },
    { label: tr('step.inTransit'), state: state(!!tl.credited, a.status === 'in_transit', a.status === 'failed' && !!tl.initiated) },
    { label: tr('step.credited'), state: state(!!tl.credited, false, a.status === 'failed' && !!tl.in_transit) },
  ];
}

function steps(a: Action, mode: Props['mode'], tr: T): Step[] {
  if (a.kind === 'topup') return remitSteps(a, mode, tr);
  const bad = ['rejected', 'cancelled', 'expired', 'failed', 'blocked'].includes(a.status);
  const out: Step[] = [{ label: tr('step.drafted'), state: 'done' }];
  out.push({
    label: tr(mode === 'sponsor' ? 'step.confirmed' : 'step.youConfirm'),
    state: a.user_confirmed ? 'done' : a.status === 'awaiting_user' ? 'current' : bad ? 'bad' : 'todo',
  });
  if (a.needs_sponsor_approval) {
    out.push({
      label: tr(mode === 'sponsor' ? 'step.youApprove' : 'step.dadApproves'),
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
  out.push({ label: tr(a.status === 'failed' ? 'step.failed' : 'step.done'), state: a.status === 'executed' ? 'done' : a.status === 'failed' ? 'bad' : 'todo' });
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

// The sponsor's choice of transfer service for a money request: a compact true-cost list from the server,
// cheapest first and preselected. What Aisha gets, what he sends (fee included), the margin and the speed.
function RemitPicker({ a, value, onChange }: { a: Action; value: string; onChange: (key: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const opts: RemitOption[] = a.remit_options ?? [];
  const src = a.sponsor_source;
  return (
    <View style={[styles.box, { backgroundColor: t.sunken, gap: 6 }]}>
      <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold }}>{tr('rm.choose')}</Body>
      {src ? (
        <Mono style={{ fontSize: 10.5, color: t.faint }}>
          {tr('rm.from', { account: `${tr.d(src.label)} ${src.number}`, balance: src.balance !== undefined ? money(src.balance, src.currency) : '—' })}
        </Mono>
      ) : null}
      {opts.map((o) => {
        const on = o.provider_key === value;
        return (
          <Pressable
            key={o.provider_key}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.provider_key)}
            style={{ borderWidth: 1, borderColor: on ? t.accent : t.border, borderRadius: 10, padding: 8, backgroundColor: on ? t.accentSoft : t.surface }}
          >
            <Row style={{ gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : 'transparent' }} />
              <Body style={{ fontSize: 12.5, fontFamily: on ? fonts.bodyBold : fonts.body, flexShrink: 1 }} numberOfLines={2}>
                {tr.d(o.provider)}
              </Body>
              {o.cheapest ? <Pill label={tr('rm.cheapest')} tone="ok" /> : null}
            </Row>
            <Mono style={{ fontSize: 12, fontFamily: fonts.monoBold, marginTop: 4 }}>{tr('rm.gets', { v: money(o.receive_amount, o.receive_currency) })}</Mono>
            <Mono style={{ fontSize: 10.5, color: t.muted, marginTop: 3 }} numberOfLines={3}>
              {[
                tr('rm.youSend', { v: money(o.send_amount, o.send_currency) }),
                tr('rm.fee', { v: money(o.fee, o.fee_currency) }),
                o.receive_currency !== o.send_currency ? tr('rm.margin', { v: o.spread_pct }) : null,
                tr.d(o.speed),
                o.cheapest ? null : tr('rm.more', { v: money(o.extra_vs_cheapest, o.send_currency) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Mono>
          </Pressable>
        );
      })}
      <Body style={{ fontSize: 11, color: t.faint }}>{tr('rm.lockNote')}</Body>
    </View>
  );
}

const STATUS_KEY: Record<string, Key> = {
  in_transit: 'status.in_transit',
  executed: 'status.executed',
  rejected: 'status.rejected',
  cancelled: 'status.cancelled',
  expired: 'status.expired',
  failed: 'status.failed',
  blocked: 'status.blocked',
};

// Compliance checks run on the server for every draft (backend/app/compliance.py): sanctions screening, KYC,
// structuring, FINTRAC EFTR and cross-border records, BNM purpose codes.
const CHECK_MARK: Record<ComplianceCheck['status'], string> = { pass: '✓', flag: '!', block: '✕', report: '◆', na: '–' };
const OUTCOME: Record<Compliance['outcome'], { label: Key; tone: 'ok' | 'warn' | 'danger' }> = {
  clear: { label: 'comp.clear', tone: 'ok' },
  review: { label: 'comp.review', tone: 'warn' },
  blocked: { label: 'comp.blocked', tone: 'danger' },
};

function ComplianceBlock({ c }: { c: Compliance }) {
  const t = useTheme();
  const tr = useT();
  const color = (s: ComplianceCheck['status']) =>
    s === 'pass' ? t.ok : s === 'flag' ? t.warn : s === 'block' ? t.danger : s === 'report' ? t.gold : t.faint;
  const rec = c.record;
  const party = (x?: Record<string, string>) => (x ? `${x.name.split(' ')[0]} (${x.country}${x.account ? ` ${x.account}` : ''})` : '?');
  const o = OUTCOME[c.outcome] ?? OUTCOME.clear;
  return (
    <View style={[styles.box, { backgroundColor: t.sunken }]}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold, color: t.text }}>{tr('comp.title')}</Body>
        <Pill label={tr(o.label)} tone={o.tone} />
      </Row>
      {c.checks.map((ch) => (
        <Row key={ch.id + ch.label} style={{ gap: 6, alignItems: 'flex-start', paddingVertical: 1.5 }}>
          <Mono style={{ fontSize: 12, width: 12, color: color(ch.status), fontFamily: fonts.monoBold }}>{CHECK_MARK[ch.status]}</Mono>
          <Body style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: ch.status === 'pass' ? t.muted : color(ch.status) }} numberOfLines={3}>
            <Body style={{ fontSize: 11.5, fontFamily: fonts.bodyBold, color: ch.status === 'pass' ? t.text : color(ch.status) }}>{tr.d(ch.label)}</Body>
            {' · '}
            {ch.detail}
          </Body>
        </Row>
      ))}
      {rec ? (
        <Mono style={{ fontSize: 10, color: t.faint, marginTop: 4 }} numberOfLines={2}>
          {tr('comp.record', { from: party(rec.originator), to: party(rec.beneficiary), source: rec.source_of_funds })}
        </Mono>
      ) : null}
    </View>
  );
}

export function ActionCard({ action: a, mode, onConfirm, onCancel, onApprove, onReject }: Props) {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const stepUpNote = useStepUpNote();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // After the device check, the sponsor enters their PIN, which the server checks.
  const [askPin, setAskPin] = useState(false);
  // A money request: the transfer service the sponsor picks (the cheapest is preselected).
  const options = a.remit_options ?? [];
  const [provider, setProvider] = useState(options[0]?.provider_key ?? '');
  const picked = options.find((o) => o.provider_key === provider);
  const now = useNow(a.status === 'awaiting_user' || a.status === 'in_transit');
  const risky = a.risk_score >= 40;
  const untrusted = Object.entries(a.provenance ?? {}).filter(([, v]) => v === 'untrusted').map(([k]) => k);
  const h = headline(a, tr);
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
            toast(tr(mode === 'sponsor' ? 'act.notApproved' : 'act.notConfirmed'), tr('act.nothingSent', { reason: check.reason }), 'danger');
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
        <Eyebrow style={{ color: risky ? t.danger : t.accent }}>{isMove(a) ? tr('kind.move') : KIND[a.kind] ? tr(KIND[a.kind]) : a.kind}</Eyebrow>
        <Row style={{ gap: 6 }}>
          <Mono style={{ fontSize: 11, color: risky ? t.danger : t.accent, fontFamily: fonts.monoBold }}>{a.tier}</Mono>
          <Body style={{ fontSize: 11, color: risky ? t.danger : t.accent }}>{TIER[a.tier] ? tr(TIER[a.tier]) : ''}</Body>
        </Row>
      </View>
      <DashedRule color={risky ? t.danger : t.accent} />

      <View style={{ padding: 14, paddingTop: 12 }}>
        <Mono style={{ fontFamily: fonts.monoBold, fontSize: a.kind === 'add_payee' ? 18 : 24, letterSpacing: -0.5 }}>{h.big}</Mono>
        {h.sub ? <Body style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{h.sub}</Body> : null}

        {details(a, tr, mode, now).length > 0 && (
          <View style={styles.details}>
            <DashedRule color={t.border} style={{ marginBottom: 8 }} />
            {details(a, tr, mode, now).map(([k, v]) => (
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
              {tr('act.untrusted', { fields: untrusted.map((f) => (FIELD[f] ? tr(FIELD[f]) : f)).join(tr('act.untrustedAnd')) })}
            </Body>
            <Body style={{ fontSize: 12, color: t.danger }}>{tr('act.untrustedCheck')}</Body>
          </View>
        )}

        {sponsorWhy.length > 0 && (
          <View style={[styles.box, { backgroundColor: t.goldSoft }]}>
            <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold, color: t.gold, marginBottom: 4 }}>
              {tr(mode === 'sponsor' ? 'act.whySponsor' : 'act.whyStudent')}
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
              <Body style={{ fontSize: 12, fontFamily: fonts.bodyBold, color: risky ? t.danger : t.warn }}>{tr('act.risk')}</Body>
              <Mono style={{ fontSize: 11, color: risky ? t.danger : t.warn }}>{tr('act.riskScore', { n: a.risk_score })}</Mono>
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
              <Body style={{ fontSize: 13, color: t.danger, fontFamily: fonts.bodyBold }}>{tr('act.locked')}</Body>
              <Pill label={tr('act.frozen')} tone="danger" />
            </Row>
            <Body style={{ fontSize: 12.5, lineHeight: 18, color: t.danger }}>
              {frozen.charAt(0).toUpperCase() + frozen.slice(1)}. {tr('act.lockedNote')}
            </Body>
          </View>
        )}
        {a.compliance && a.compliance.checks?.length > 0 && <ComplianceBlock c={a.compliance} />}
        {warnings.map((w) => (
          <Body key={w} style={{ fontSize: 12.5, color: t.warn, marginTop: 8, lineHeight: 18 }}>
            {tr.d(w)}
          </Body>
        ))}

        <Timeline items={steps(a, mode, tr)} />

        {a.status === 'awaiting_user' && mode === 'student' && (
          <Mono style={{ fontSize: 11, color: left < 60 ? t.danger : t.faint, marginTop: 10 }}>
            {tr('act.expires', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') })}
          </Mono>
        )}
        {a.status === 'awaiting_sponsor' && mode === 'student' && (
          <Body style={{ fontSize: 12, color: t.muted, marginTop: 10 }}>
            {tr('act.sent', { time: cityTime('Asia/Kuala_Lumpur') })}
            {tr(klHour() >= 23 || klHour() < 7 ? 'act.asleep' : 'act.awake')}
          </Body>
        )}
        {STATUS_KEY[a.status] && (
          <Row style={{ marginTop: 10, gap: 8 }}>
            <Pill label={tr(STATUS_KEY[a.status]).toUpperCase()} tone={a.status === 'executed' ? 'ok' : a.status === 'in_transit' ? 'gold' : 'danger'} />
            {a.status === 'executed' && a.result?.new_balance !== undefined && (
              <Mono style={{ fontSize: 11, color: t.muted }}>{tr('act.newBalance', { v: amount(a.result.new_balance) })}</Mono>
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
              <Button label={tr('btn.cancel')} kind="ghost" busy={busy === 'cancel'} onPress={run('cancel', onCancel && (() => onCancel(a)))} style={{ flex: 1 }} />
              <Button
                label={tr(frozen ? 'btn.locked' : a.needs_sponsor_approval ? 'btn.confirmSponsor' : 'btn.confirm')}
                busy={busy === 'confirm'}
                disabled={!!frozen}
                onPress={guarded('confirm', tr('act.promptConfirm', { what }), onConfirm && (() => onConfirm(a)))}
                style={{ flex: 2 }}
              />
            </Row>
            {deviceNote}
          </>
        )}
        {mode === 'student' && a.status === 'awaiting_sponsor' && onCancel && (
          <Button label={tr('btn.withdraw')} kind="ghost" busy={busy === 'cancel'} onPress={run('cancel', () => onCancel(a))} style={{ marginTop: 12 }} />
        )}
        {mode === 'sponsor' && a.status === 'awaiting_sponsor' && (
          <View style={{ marginTop: 14, gap: 10 }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={tr('act.notePlaceholder')}
              placeholderTextColor={t.faint}
              maxLength={200}
              style={[styles.note, { color: t.text, borderColor: t.border, backgroundColor: t.bg, fontFamily: fonts.body }]}
            />
            {/* A money request: pick the transfer service before the PIN step. */}
            {a.kind === 'topup' && options.length > 0 && !askPin && <RemitPicker a={a} value={provider} onChange={setProvider} />}
            {askPin && onApprove ? (
              <PinEntry
                title={picked ? tr('act.pinApproveVia', { what, provider: tr.d(picked.provider) }) : tr('act.pinApprove', { what })}
                submitLabel={tr('btn.approve')}
                busy={busy === 'approve'}
                onCancel={() => setAskPin(false)}
                onSubmit={(pin) => {
                  setAskPin(false);
                  run('approve', () => onApprove(a, note, pin, a.kind === 'topup' ? provider : ''))();
                }}
              />
            ) : (
              <Row style={{ gap: 10 }}>
                <Button label={tr('btn.reject')} kind="danger" busy={busy === 'reject'} onPress={run('reject', onReject && (() => onReject(a, note)))} style={{ flex: 1 }} />
                <Button
                  label={tr(frozen ? 'btn.locked' : 'btn.approve')}
                  busy={busy === 'approve'}
                  disabled={!!frozen}
                  onPress={guarded('approve', tr('act.promptApprove', { what }), onApprove && (async () => setAskPin(true)))}
                  style={{ flex: 2 }}
                />
              </Row>
            )}
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
