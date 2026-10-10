// Cards built by the server from tool results. The figures here come from the
// sandbox bank and FX engine, not from the language model's text.
import { View } from 'react-native';

import type { Card, CreditCardData, CreditProfile } from '../api';
import { amount, fonts, money, useTheme } from '../theme';
import { Bar, Body, Divider, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

function Provenance() {
  const t = useTheme();
  return (
    <Row style={{ marginTop: 10, gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent }} />
      <Body style={{ fontSize: 11, color: t.faint }}>From your HomeBridge ledger, not written by the AI</Body>
    </Row>
  );
}

function FxQuotes({ c }: { c: Extract<Card, { type: 'fx_quotes' }> }) {
  const t = useTheme();
  const max = Math.max(...c.quotes.map((q) => q.you_receive));
  const ideal = c.quotes[0] ? c.amount * c.quotes[0].mid_rate : max;
  return (
    <Surface>
      <Row style={{ justifyContent: 'space-between', marginBottom: 2 }}>
        <Eyebrow>True cost comparison</Eyebrow>
        {c.cached && <Pill label="CACHED QUOTES" tone="warn" />}
      </Row>
      <Body style={{ color: t.muted, fontSize: 13 }}>
        Sending {money(c.amount, c.from_currency)} · mid-market would give {money(ideal, c.to_currency)}
      </Body>
      <View style={{ gap: 12, marginTop: 12 }}>
        {c.quotes.map((q, i) => {
          const best = i === 0;
          return (
            <View key={q.provider_key}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <Row style={{ gap: 6, flex: 1 }}>
                  <Body style={{ fontFamily: best ? fonts.bodyBold : fonts.body, fontSize: 14 }} numberOfLines={1}>
                    {q.provider}
                  </Body>
                  {best && <Pill label="BEST" tone="gold" />}
                </Row>
                <Mono style={{ fontFamily: best ? fonts.monoBold : fonts.mono, fontSize: 13 }}>{money(q.you_receive, q.receive_currency)}</Mono>
              </Row>
              <Bar value={q.you_receive} max={max} color={best ? t.gold : t.faint} />
              <Row style={{ justifyContent: 'space-between', marginTop: 3 }}>
                <Body style={{ fontSize: 11, color: t.muted }}>
                  fee {money(q.fee, q.fee_currency)} · rate {q.rate} · {q.speed}
                </Body>
                <Mono style={{ fontSize: 11, color: q.true_cost_pct > 3 ? t.danger : t.muted }}>{q.true_cost_pct}% lost</Mono>
              </Row>
            </View>
          );
        })}
      </View>
      <Divider />
      <Body style={{ fontSize: 13 }}>
        Best option keeps <Mono style={{ fontFamily: fonts.monoBold, color: t.gold, fontSize: 13 }}>{money(c.saving_vs_worst, c.to_currency)}</Mono> more than the worst.
      </Body>
      {c.note ? <Body style={{ fontSize: 12, color: t.warn, marginTop: 4 }}>{c.note}</Body> : null}
      <Provenance />
    </Surface>
  );
}

function Balances({ c }: { c: Extract<Card, { type: 'balances' }> }) {
  const t = useTheme();
  return (
    <Surface>
      <Eyebrow>Balances</Eyebrow>
      <Mono style={{ fontFamily: fonts.monoBold, fontSize: 24, marginTop: 4 }}>{money(c.total, c.total_currency)}</Mono>
      <Body style={{ fontSize: 12, color: t.muted }}>total at mid-market rate</Body>
      <Divider />
      {c.accounts.map((a) => (
        <Row key={a.label} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: 14 }}>{a.label}</Body>
            <Mono style={{ fontSize: 11, color: t.faint }}>
              {a.number}
              {a.sponsor_funded ? '  · sponsor-funded' : ''}
            </Mono>
          </View>
          <Mono style={{ fontSize: 14 }}>{money(a.balance, a.currency)}</Mono>
        </Row>
      ))}
      <Provenance />
    </Surface>
  );
}

function FxHistory({ c }: { c: Extract<Card, { type: 'fx_history' }> }) {
  const t = useTheme();
  const series = c.series ?? [];
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  return (
    <Surface>
      <Eyebrow>{c.pair} · last {c.days} days</Eyebrow>
      <Row style={{ alignItems: 'flex-end', gap: 2, height: 64, marginTop: 12 }}>
        {series.map((v, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: `${hi > lo ? 18 + ((v - lo) / (hi - lo)) * 82 : 50}%`,
              backgroundColor: i === series.length - 1 ? t.gold : t.accentSoft,
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
            }}
          />
        ))}
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <Mono style={{ fontSize: 12, color: t.muted }}>low {c.low}</Mono>
        <Mono style={{ fontSize: 12, color: t.gold }}>today {c.today}</Mono>
        <Mono style={{ fontSize: 12, color: t.muted }}>high {c.high}</Mono>
      </Row>
      <Body style={{ fontSize: 12, color: t.muted, marginTop: 6 }}>A range, not a forecast. Nobody can reliably predict tomorrow’s rate.</Body>
      <Provenance />
    </Surface>
  );
}

export function TuitionCard({ c, bare }: { c: Extract<Card, { type: 'tuition' }>; bare?: boolean }) {
  const t = useTheme();
  const next = c.installments[0];
  if (!next) return null;
  const covered = Math.min(c.tuition_fund_cad, next.amount);
  const inner = (
    <>
      <Eyebrow>Next tuition</Eyebrow>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fonts.bodyBold }}>{next.term}</Body>
          <Body style={{ fontSize: 13, color: t.muted }}>due {next.due}</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono style={{ fontFamily: fonts.monoBold, fontSize: 26, color: next.days_until_due < 21 ? t.danger : t.text }}>{next.days_until_due}</Mono>
          <Body style={{ fontSize: 11, color: t.muted }}>days left</Body>
        </View>
      </Row>
      <View style={{ marginTop: 12 }}>
        <Bar value={covered} max={next.amount} color={c.next_shortfall_cad > 0 ? t.gold : t.ok} height={10} />
      </View>
      <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <Mono style={{ fontSize: 12, color: t.muted }}>fund {money(c.tuition_fund_cad, 'CAD', 0)}</Mono>
        <Mono style={{ fontSize: 12, color: t.muted }}>needed {money(next.amount, 'CAD', 0)}</Mono>
      </Row>
      {c.next_shortfall_cad > 0 ? (
        <Body style={{ fontSize: 13, marginTop: 8 }}>
          Short by <Mono style={{ color: t.danger, fontFamily: fonts.monoBold, fontSize: 13 }}>{money(c.next_shortfall_cad, 'CAD')}</Mono>. Your MYR wallet is worth about{' '}
          {money(c.myr_wallet_value_cad, 'CAD', 0)}.
        </Body>
      ) : (
        <Body style={{ fontSize: 13, marginTop: 8, color: t.ok }}>Fully covered.</Body>
      )}
      {!bare && <Provenance />}
    </>
  );
  return bare ? <View>{inner}</View> : <Surface>{inner}</Surface>;
}

export function BudgetCard({ c, bare }: { c: Extract<Card, { type: 'budget' }>; bare?: boolean }) {
  const t = useTheme();
  const max = Math.max(...c.categories.map((x) => Math.max(x.spent_cad, x.budget_cad ?? 0)), 1);
  const inner = (
    <>
      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>Spending · last {c.period_days} days</Eyebrow>
        <Mono style={{ fontSize: 13 }}>{money(c.total_spent_cad, 'CAD', 0)}</Mono>
      </Row>
      <View style={{ gap: 10, marginTop: 12 }}>
        {c.categories.slice(0, 7).map((x) => (
          <View key={x.category}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 3 }}>
              <Row style={{ gap: 6 }}>
                <Body style={{ fontSize: 13, textTransform: 'capitalize' }}>{x.category}</Body>
                {x.over_budget && <Pill label="OVER" tone="danger" />}
              </Row>
              <Mono style={{ fontSize: 12, color: t.muted }}>
                {amount(x.spent_cad, 0)}
                {x.budget_cad ? ` / ${amount(x.budget_cad, 0)}` : ''}
              </Mono>
            </Row>
            <Bar value={x.spent_cad} max={max} color={x.over_budget ? t.danger : t.accent} marker={x.budget_cad ?? undefined} />
          </View>
        ))}
      </View>
      {c.possible_duplicate_charges.length > 0 && (
        <Body style={{ fontSize: 13, color: t.warn, marginTop: 10 }}>
          Possible duplicate charge: {c.possible_duplicate_charges.join(', ')}
        </Body>
      )}
      {!bare && <Provenance />}
    </>
  );
  return bare ? <View>{inner}</View> : <Surface>{inner}</Surface>;
}

function Scam({ c }: { c: Extract<Card, { type: 'scam_check' }> }) {
  const t = useTheme();
  const verdict = {
    likely_scam: { label: 'Likely scam', tone: 'danger' as const, color: t.danger, bg: t.dangerBg },
    suspicious: { label: 'Suspicious', tone: 'warn' as const, color: t.warn, bg: t.warnBg },
    no_known_pattern: { label: 'No known scam pattern', tone: 'ok' as const, color: t.ok, bg: t.okBg },
  }[c.verdict];
  const signals = Object.entries(c.signals ?? {});
  return (
    <Surface tone={verdict.tone} style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ backgroundColor: verdict.bg, padding: 14 }}>
        <Eyebrow style={{ color: verdict.color }}>Scam shield</Eyebrow>
        <Body style={{ fontFamily: fonts.display, fontSize: 22, color: verdict.color, marginTop: 2 }}>{verdict.label}</Body>
      </View>
      <View style={{ padding: 14, gap: 8 }}>
        {signals.length > 0 && (
          <View style={{ gap: 6 }}>
            <Body style={{ fontSize: 12, color: t.muted }}>Rule matches</Body>
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {signals.flatMap(([cat, hits]) => hits.map((h) => <Pill key={cat + h} label={`${cat}: ${h}`} tone={cat === 'scam' ? 'danger' : 'warn'} />))}
            </Row>
          </View>
        )}
        {c.model_label && (
          <Body style={{ fontSize: 12, color: t.muted }}>
            Our classifier: <Mono style={{ fontSize: 12 }}>{c.model_label}</Mono> ({Math.round((c.model_confidence ?? 0) * 100)}%)
            {c.model_keywords.length > 0 ? ` · driven by "${c.model_keywords.slice(0, 4).join('", "')}"` : ''}
          </Body>
        )}
        {c.advice.map((a) => (
          <Body key={a} style={{ fontSize: 13 }}>
            — {a}
          </Body>
        ))}
      </View>
    </Surface>
  );
}

function Transactions({ c }: { c: Extract<Card, { type: 'transactions' }> }) {
  const t = useTheme();
  return (
    <Surface>
      <Eyebrow>Recent transactions</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {c.rows.map((r, i) => (
          <Row key={i} style={{ paddingVertical: 6, borderBottomWidth: i < c.rows.length - 1 ? 1 : 0, borderColor: t.border, gap: 10 }}>
            <Mono style={{ fontSize: 11, color: t.faint, width: 44 }}>{r.date.slice(5)}</Mono>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 13 }} numberOfLines={1}>
                {r.counterparty}
              </Body>
              <Body style={{ fontSize: 11, color: t.muted }}>{r.category}</Body>
            </View>
            <Mono style={{ fontSize: 13, color: r.amount > 0 ? t.ok : t.text }}>
              {r.amount > 0 ? '+' : ''}
              {amount(r.amount)} {r.currency}
            </Mono>
          </Row>
        ))}
      </View>
      <Provenance />
    </Surface>
  );
}

function Checklist({ c }: { c: Extract<Card, { type: 'checklist' }> }) {
  const t = useTheme();
  return (
    <Surface>
      <Eyebrow>{c.title}</Eyebrow>
      <View style={{ gap: 8, marginTop: 8 }}>
        {c.items.map((s, i) => (
          <Row key={i} style={{ alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Mono style={{ fontSize: 11, color: t.accent, fontFamily: fonts.monoBold }}>{i + 1}</Mono>
            </View>
            <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{s}</Body>
          </Row>
        ))}
      </View>
      {c.footnote ? <Body style={{ fontSize: 11, color: t.faint, marginTop: 10 }}>{c.footnote}</Body> : null}
    </Surface>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

// Runway: the spending balance over time as bars around a zero line. Days below zero sit in a red
// "shortfall zone"; gold lines mark tuition due dates; the first bar is today and the gold bar the low point.
export function RunwayCard({ c, bare, compact }: { c: Extract<Card, { type: 'forecast' }>; bare?: boolean; compact?: boolean }) {
  const t = useTheme();
  const H = compact ? 64 : 96;
  const n = c.series.length;
  const hi = Math.max(0, ...c.series);
  const lo = Math.min(0, ...c.series);
  const range = hi - lo || 1;
  const zero = (-lo / range) * H;
  const gaps = c.tuition.filter((x) => x.gap > 0);
  const short = c.first_shortfall_date !== null;
  const verdict = short
    ? { label: 'RUNS SHORT', tone: 'danger' as const }
    : gaps.length
      ? { label: 'TUITION GAP', tone: 'warn' as const }
      : { label: 'ON TRACK', tone: 'ok' as const };
  const inner = (
    <>
      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>Runway · to {shortDate(c.end_date)}</Eyebrow>
        <Pill label={verdict.label} tone={verdict.tone} />
      </Row>
      <Body style={{ fontFamily: fonts.bodyBold, marginTop: 4, color: short ? t.danger : t.text }}>
        {short ? `Runs short on ${shortDate(c.first_shortfall_date as string)}` : `Lasts to ${shortDate(c.end_date)}`}
      </Body>
      <Body style={{ fontSize: 12, color: t.muted }}>
        {c.account} · lowest {money(c.lowest.balance, 'CAD')} on {shortDate(c.lowest.date)}
      </Body>
      <View style={{ height: H, marginTop: 10 }}>
        {lo < 0 && (
          <>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: zero, backgroundColor: t.dangerBg, borderRadius: 3 }} />
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: zero, height: 1, backgroundColor: t.danger, opacity: 0.5 }} />
          </>
        )}
        <Row style={{ height: H, alignItems: 'stretch', gap: n > 60 ? 1 : 2 }}>
          {c.series.map((v, i) => {
            const h = Math.max(1, (Math.abs(v) / range) * H);
            const color = v < 0 ? t.danger : i === c.lowest.index ? t.gold : t.accent;
            const strong = v < 0 || i === 0 || i === c.lowest.index;
            return (
              <View key={i} style={{ flex: 1 }}>
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: v >= 0 ? zero : zero - h, height: h, backgroundColor: color, opacity: strong ? 1 : 0.45, borderRadius: 1 }} />
              </View>
            );
          })}
        </Row>
        {c.tuition.map((x) => (
          <View
            key={x.due}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${((x.index + 0.5) / n) * 100}%`, width: 2, marginLeft: -1, backgroundColor: x.gap > 0 ? t.danger : t.gold }}
          />
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <Mono style={{ fontSize: 11, color: t.muted }}>today {amount(c.starting_balance, 0)}</Mono>
        <Mono style={{ fontSize: 11, color: c.ending_balance < 0 ? t.danger : t.muted }}>
          {shortDate(c.end_date)} {amount(c.ending_balance, 0)}
        </Mono>
      </Row>
      {c.tuition.map((x) => (
        <Row key={x.due} style={{ gap: 8, marginTop: 6 }}>
          <View style={{ width: 10, height: 2, backgroundColor: x.gap > 0 ? t.danger : t.gold }} />
          <Body style={{ fontSize: 12, flex: 1 }}>
            Tuition due {shortDate(x.due)} ({money(x.amount, 'CAD', 0)}):{' '}
            {x.gap > 0 ? (
              <Mono style={{ fontSize: 12, color: t.danger, fontFamily: fonts.monoBold }}>fund short {money(x.gap, 'CAD')}</Mono>
            ) : (
              <Body style={{ fontSize: 12, color: t.ok }}>covered</Body>
            )}
          </Body>
        </Row>
      ))}
      {!compact && c.suggestions.length > 0 && (
        <>
          <Divider />
          <Eyebrow>What would help</Eyebrow>
          <View style={{ gap: 6, marginTop: 6 }}>
            {c.suggestions.map((s, i) => (
              <Row key={i} style={{ alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Mono style={{ fontSize: 11, color: t.accent, fontFamily: fonts.monoBold }}>{i + 1}</Mono>
                </View>
                <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{s}</Body>
              </Row>
            ))}
          </View>
        </>
      )}
      {!compact && (
        <Body style={{ fontSize: 11, color: t.faint, marginTop: 10 }}>
          Assumes spending of about {money(c.weekly_spending_cad, 'CAD', 0)} a week
          {c.pending_included.length > 0 ? ` and counts ${c.pending_included.length} pending draft(s) as confirmed` : ''}. {c.disclosure}
        </Body>
      )}
      {!bare && <Provenance />}
    </>
  );
  return bare ? <View>{inner}</View> : <Surface tone={short ? 'danger' : gaps.length ? 'warn' : 'plain'}>{inner}</Surface>;
}

// ---------------------------------------------------------------- Credit Builder
const HEALTH_TONE = { needs_attention: 'danger', fair: 'warn', on_track: 'ok', strong: 'ok' } as const;

/** The wallet overview carries the full get_credit_profile result; this narrows it to the card shape. */
export function creditCardFromProfile(p: CreditProfile | undefined): CreditCardData | null {
  if (!p || !p.has_card) return null;
  return {
    type: 'credit',
    card: p.card,
    utilization_pct: p.utilization_pct,
    utilization_reported_pct: p.utilization_reported_pct,
    utilization_projected_at_close_pct: p.utilization_projected_at_close_pct,
    target_pct: p.target_pct,
    next_statement_date: p.next_statement_date,
    days_until_statement: p.days_until_statement,
    statement: p.statement,
    on_time_streak: p.on_time_streak,
    months_of_history: p.months_of_history,
    payment_history: p.payment_history.map((h) => h.status),
    health: p.credit_health,
    recommended_payment: p.recommended_payment,
    next_actions: p.next_actions,
    footnote: p.disclosure,
  };
}

function UtilizationGauge({ pct, target }: { pct: number; target: number }) {
  const t = useTheme();
  const color = pct < 10 ? t.ok : pct < target ? t.accent : pct < 50 ? t.gold : t.danger;
  return (
    <View>
      <Bar value={Math.min(pct, 100)} max={100} color={color} marker={target} height={12} />
      <View style={{ height: 16, marginTop: 3 }}>
        <Mono style={{ position: 'absolute', left: 0, fontSize: 10, color: t.faint }}>0%</Mono>
        <Mono style={{ position: 'absolute', left: `${target}%`, marginLeft: -14, fontSize: 10, color: t.text }}>{target}% ▲</Mono>
        <Mono style={{ position: 'absolute', right: 0, fontSize: 10, color: t.faint }}>100%</Mono>
      </View>
    </View>
  );
}

function StreakDots({ history }: { history: CreditCardData['payment_history'] }) {
  const t = useTheme();
  return (
    <Row style={{ gap: 6 }}>
      {history.map((s, i) => (
        <View
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: s === 'on_time' ? t.ok : s === 'late' ? t.danger : t.gold,
            backgroundColor: s === 'on_time' ? t.ok : s === 'late' ? t.danger : 'transparent',
          }}
        />
      ))}
    </Row>
  );
}

export function CreditCard({ c, compact }: { c: CreditCardData; compact?: boolean }) {
  const t = useTheme();
  const st = c.statement;
  const steps = c.next_actions.slice(0, compact ? 1 : 4);
  return (
    <Surface>
      <Row style={{ justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow style={{ flex: 1 }}>Credit builder · {c.card.label}</Eyebrow>
        <Pill label={`${c.health.label.toUpperCase()} · SIMULATED`} tone={HEALTH_TONE[c.health.key]} />
      </Row>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
        <View>
          <Mono style={{ fontFamily: fonts.monoBold, fontSize: 30, letterSpacing: -1, color: c.utilization_pct >= c.target_pct ? t.danger : t.text }}>
            {c.utilization_pct}%
          </Mono>
          <Body style={{ fontSize: 12, color: t.muted }}>of your limit used now</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono style={{ fontSize: 14 }}>{money(c.card.balance, c.card.currency)}</Mono>
          <Mono style={{ fontSize: 11, color: t.faint }}>
            of {money(c.card.credit_limit, c.card.currency, 0)} · {c.card.number}
          </Mono>
        </View>
      </Row>
      <View style={{ marginTop: 10 }}>
        <UtilizationGauge pct={c.utilization_pct} target={c.target_pct} />
      </View>
      <Body style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>
        Last statement reported {c.utilization_reported_pct}%. Next one closes {c.next_statement_date} ({c.days_until_statement} days)
        {c.utilization_projected_at_close_pct > c.utilization_pct ? `; at this pace it would report ${c.utilization_projected_at_close_pct}%` : ''}.
      </Body>
      <Divider />
      <Row style={{ justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <StreakDots history={c.payment_history} />
          <Body style={{ fontSize: 12, color: t.muted }}>
            {c.on_time_streak} on time in a row · {c.months_of_history} months of history
          </Body>
        </View>
        {st && st.status === 'due' && st.remaining > 0 ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Mono style={{ fontSize: 13, fontFamily: fonts.monoBold, color: st.days_until_due <= 7 ? t.danger : t.text }}>
              {money(st.remaining, c.card.currency)}
            </Mono>
            <Body style={{ fontSize: 11, color: t.muted }}>
              due {st.due_date} · min {money(st.minimum_due, c.card.currency)}
            </Body>
          </View>
        ) : st ? (
          <Pill label="STATEMENT PAID" tone="ok" />
        ) : null}
      </Row>
      {steps.length > 0 && (
        <View style={{ gap: 8, marginTop: 12 }}>
          {!compact && <Body style={{ fontSize: 12, color: t.muted }}>Next steps</Body>}
          {steps.map((s, i) => (
            <Row key={s.key} style={{ alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Mono style={{ fontSize: 11, color: t.accent, fontFamily: fonts.monoBold }}>{i + 1}</Mono>
              </View>
              <Body style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>{s.text}</Body>
            </Row>
          ))}
        </View>
      )}
      <Body style={{ fontSize: 11, color: t.faint, marginTop: 10 }}>
        {compact ? 'Simulated from your sandbox card. Not a credit score, not financial advice.' : c.footnote}
      </Body>
      {!compact && <Provenance />}
    </Surface>
  );
}

export function ResultCard({ card }: { card: Card }) {
  switch (card.type) {
    case 'fx_quotes':
      return <FxQuotes c={card} />;
    case 'balances':
      return <Balances c={card} />;
    case 'fx_history':
      return <FxHistory c={card} />;
    case 'tuition':
      return <TuitionCard c={card} />;
    case 'budget':
      return <BudgetCard c={card} />;
    case 'scam_check':
      return <Scam c={card} />;
    case 'transactions':
      return <Transactions c={card} />;
    case 'checklist':
      return <Checklist c={card} />;
    case 'forecast':
      return <RunwayCard c={card} />;
    case 'credit':
      return <CreditCard c={card} />;
    default:
      return null;
  }
}
