// Result cards built by the server from tool results (figures come from the sandbox ledger, not the model).
import type { ReactNode } from 'react';
import { CheckShieldFill, ExclamationShieldFill, InformationCircleFill } from 'antd-mobile-icons';
import type { BudgetData, Card, CreditCardData, CreditProfile, ForecastCard, TuitionData } from '../types';
import { ACCOUNT_ZH, CATEGORY_ZH, amount, enDate, money, zhDate } from '../format';
import { Amt, Meter, Pill, Provenance } from './bits';
import { RunwayChart, Sparkline, UtilGauge } from './charts';

const PROVIDER_ZH: Record<string, string> = {
  inapp: '钱包换汇',
  lowcost: '低价汇款',
  bank: '银行电汇',
  kiosk: '机场换汇',
};

function Head({ zh, en, right }: { zh: string; en: string; right?: ReactNode }) {
  return (
    <div className="rc-h">
      <span className="rc-t">
        {zh}
        <small>{en}</small>
      </span>
      {right}
    </div>
  );
}

function Balances({ c }: { c: Extract<Card, { type: 'balances' }> }) {
  return (
    <div className="rc">
      <Head zh="账户余额" en="Balances" right={<span className="rc-sub">按中间价 at mid-market</span>} />
      <div className="big-amt">
        <Amt n={c.total} cur={c.total_currency} />
      </div>
      <div className="rows">
        {c.accounts.map((a) => (
          <div className="row" key={a.label}>
            <div className="row-l">
              <span className="row-t">
                {ACCOUNT_ZH[a.label] ?? a.label} <small>{a.label}</small>
              </span>
              <span className="row-s num">
                {a.number}
                {a.sponsor_funded ? ' · 爸爸资助 sponsor-funded' : ''}
              </span>
            </div>
            <Amt n={a.balance} cur={a.currency} className="row-v" />
          </div>
        ))}
      </div>
      <Provenance />
    </div>
  );
}

function FxQuotes({ c }: { c: Extract<Card, { type: 'fx_quotes' }> }) {
  const ideal = c.quotes[0] ? c.amount * c.quotes[0].mid_rate : 0;
  const maxCost = Math.max(...c.quotes.map((q) => q.true_cost_pct), 1);
  return (
    <div className="rc">
      <Head zh="换汇比价 · 真实成本" en="True-cost ranking" right={c.cached ? <Pill tone="orange">缓存报价 cached</Pill> : undefined} />
      <div className="rc-sub">
        换 {money(c.amount, c.from_currency, 0)} · 中间价可得 {money(ideal, c.to_currency)}
      </div>
      <div className="fxq">
        {c.quotes.map((q, i) => (
          <div className={`fxq-r ${i === 0 ? 'best' : ''}`} key={q.provider_key}>
            <span className={`rank r${i + 1}`}>{i + 1}</span>
            <div className="fxq-m">
              <div className="fxq-t">
                {PROVIDER_ZH[q.provider_key] ?? q.provider}
                <small>{q.provider}</small>
                {i === 0 ? <Pill tone="gold">最省 BEST</Pill> : null}
              </div>
              <div className="fxq-s">
                手续费 {money(q.fee, q.fee_currency, 0)} · 汇率 {q.rate} · {q.speed}
              </div>
              <div className="fxq-bar">
                <div style={{ width: `${(q.true_cost_pct / maxCost) * 100}%` }} className={q.true_cost_pct > 3 ? 't-red' : 't-gold'} />
              </div>
            </div>
            <div className="fxq-v">
              <span className="num">{money(q.you_receive, q.receive_currency)}</span>
              <small className={q.true_cost_pct > 3 ? 'c-red' : ''}>损耗 {q.true_cost_pct}%</small>
            </div>
          </div>
        ))}
      </div>
      <div className="callout c-gold">
        选最优比最差多得 <b className="num">{money(c.saving_vs_worst, c.to_currency)}</b> · Best keeps {money(c.saving_vs_worst, c.to_currency)} more than worst
      </div>
      {c.note ? <div className="rc-note c-orange">{c.note}</div> : null}
      <Provenance />
    </div>
  );
}

function FxHistory({ c }: { c: Extract<Card, { type: 'fx_history' }> }) {
  return (
    <div className="rc">
      <Head zh={`${c.pair} 近${c.days}天`} en={`${c.days}-day range`} right={<span className="num rc-big2">{c.today}</span>} />
      <Sparkline series={c.series} />
      <div className="kv3">
        <div>
          <small>最低 Low</small>
          <b className="num">{c.low}</b>
        </div>
        <div>
          <small>均值 Avg</small>
          <b className="num">{c.average}</b>
        </div>
        <div>
          <small>最高 High</small>
          <b className="num">{c.high}</b>
        </div>
      </div>
      <div className="rc-note">这是区间，不是预测 · A range, not a forecast.</div>
      <Provenance />
    </div>
  );
}

export function TuitionBody({ c }: { c: TuitionData }) {
  const next = c.installments[0];
  if (!next) return null;
  const covered = Math.min(c.tuition_fund_cad, next.amount);
  return (
    <>
      <div className="tu">
        <div>
          <div className="tu-term">{next.term}</div>
          <div className="rc-sub">
            {zhDate(next.due)}到期 · due {enDate(next.due)} · <Amt n={next.amount} d={0} cur="CAD" />
          </div>
        </div>
        <div className="tu-days">
          <b className={`num ${next.days_until_due < 21 ? 'c-red' : ''}`}>{next.days_until_due}</b>
          <small>天 days</small>
        </div>
      </div>
      <Meter value={covered} max={next.amount} tone={c.next_shortfall_cad > 0 ? 'orange' : 'green'} />
      <div className="kv2">
        <span>
          学费金 Fund <Amt n={c.tuition_fund_cad} d={0} />
        </span>
        <span>
          需要 Need <Amt n={next.amount} d={0} />
        </span>
      </div>
      {c.next_shortfall_cad > 0 ? (
        <div className="callout c-orange">
          还差 <b className="num">{money(c.next_shortfall_cad, 'CAD')}</b> · 马币钱包约值 {money(c.myr_wallet_value_cad, 'CAD', 0)} · Short by{' '}
          {money(c.next_shortfall_cad, 'CAD')}
        </div>
      ) : (
        <div className="callout c-green">已足额 · Fully covered</div>
      )}
    </>
  );
}

export function BudgetBody({ c, limit = 8 }: { c: BudgetData; limit?: number }) {
  return (
    <>
      <div className="bud">
        {c.categories.slice(0, limit).map((x) => (
          <div className="bud-i" key={x.category}>
            <div className="bud-t">
              <span>
                {CATEGORY_ZH[x.category] ?? x.category}
                <small>{x.category}</small>
              </span>
              {x.over_budget ? <Pill tone="red">超支</Pill> : null}
            </div>
            <div className="bud-v num">
              {amount(x.spent_cad, 0)}
              {x.budget_cad ? <small> / {amount(x.budget_cad, 0)}</small> : null}
            </div>
            <Meter value={x.spent_cad} max={x.budget_cad ?? x.spent_cad} tone={x.over_budget ? 'red' : x.budget_cad ? 'blue' : 'grey'} />
          </div>
        ))}
      </div>
      {c.possible_duplicate_charges.length > 0 && (
        <div className="callout c-orange">
          <InformationCircleFill /> 可能重复扣款 Possible duplicate: {c.possible_duplicate_charges.join(', ')}
        </div>
      )}
    </>
  );
}

function Scam({ c }: { c: Extract<Card, { type: 'scam_check' }> }) {
  const v = {
    likely_scam: { zh: '高度疑似诈骗', en: 'Likely scam', cls: 'red', Icon: ExclamationShieldFill },
    suspicious: { zh: '存在可疑迹象', en: 'Suspicious', cls: 'orange', Icon: ExclamationShieldFill },
    no_known_pattern: { zh: '未发现已知骗局', en: 'No known scam pattern', cls: 'green', Icon: CheckShieldFill },
  }[c.verdict];
  const signals = Array.isArray(c.signals) ? c.signals : [];
  return (
    <div className="rc rc-flush">
      <div className={`scam-h bg-${v.cls}`}>
        <v.Icon fontSize={28} />
        <div>
          <div className="scam-v">{v.zh}</div>
          <div className="scam-e">防骗检测 Scam shield · {v.en}</div>
        </div>
        {c.model_label ? (
          <div className="scam-conf">
            <b className="num">{Math.round((c.model_confidence ?? 0) * 100)}%</b>
            <small>模型置信 model</small>
          </div>
        ) : null}
      </div>
      <div className="rc-in">
        {signals.length > 0 && (
          <div className="tags">
            {signals.map((s) => (
              <Pill key={s.category + s.name} tone={s.category === 'scam' ? 'red' : 'orange'}>
                {s.name}
              </Pill>
            ))}
          </div>
        )}
        {c.quote ? <div className="quote">“{c.quote}”</div> : null}
        <ol className="advice">
          {c.advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Transactions({ c }: { c: Extract<Card, { type: 'transactions' }> }) {
  return (
    <div className="rc">
      <Head zh="最近明细" en={`Recent · ${c.count}`} />
      <div className="rows">
        {c.rows.map((r, i) => (
          <div className="row" key={i}>
            <span className="row-d num">{r.date.slice(5)}</span>
            <div className="row-l">
              <span className="row-t">{r.counterparty}</span>
              <span className="row-s">
                {CATEGORY_ZH[r.category] ?? r.category} · {r.category}
              </span>
            </div>
            <span className={`row-v num ${r.amount > 0 ? 'c-green' : ''}`}>
              {r.amount > 0 ? '+' : ''}
              {amount(r.amount)}
            </span>
          </div>
        ))}
      </div>
      <Provenance />
    </div>
  );
}

function Checklist({ c }: { c: Extract<Card, { type: 'checklist' }> }) {
  return (
    <div className="rc">
      <Head zh={c.title} en="Checklist" />
      <ol className="steps-list">
        {c.items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {c.footnote ? <div className="rc-note">{c.footnote}</div> : null}
    </div>
  );
}

export function RunwayBody({ c, compact }: { c: ForecastCard; compact?: boolean }) {
  const short = c.first_shortfall_date !== null;
  const gap = c.tuition.some((t) => t.gap > 0);
  return (
    <>
      <div className="rw-top">
        <div>
          <div className={`rw-v ${short ? 'c-red' : ''}`}>
            {short ? `${zhDate(c.first_shortfall_date as string)}余额见底` : `可撑到${zhDate(c.end_date)}`}
          </div>
          <div className="rc-sub">
            {short ? `Runs short on ${enDate(c.first_shortfall_date as string)}` : `Lasts to ${enDate(c.end_date)}`} · {c.account}
          </div>
        </div>
        <Pill tone={short ? 'red' : gap ? 'orange' : 'green'}>{short ? '透支风险 SHORT' : gap ? '学费缺口 GAP' : '正常 ON TRACK'}</Pill>
      </div>
      <RunwayChart c={c} height={compact ? 96 : 112} />
      <div className="legend">
        <span>
          <i className="lg-blue" />
          余额 balance
        </span>
        <span>
          <i className="lg-red" />
          透支区 shortfall
        </span>
        <span>
          <i className="lg-orange" />
          学费日 tuition due
        </span>
      </div>
      {c.tuition.map((t) => (
        <div className="kv2" key={t.due}>
          <span>
            学费 {zhDate(t.due)} · {money(t.amount, 'CAD', 0)}
          </span>
          {t.gap > 0 ? <b className="c-red num">缺 {money(t.gap, 'CAD')}</b> : <b className="c-green">已覆盖 covered</b>}
        </div>
      ))}
      {!compact && c.suggestions.length > 0 && (
        <>
          <div className="rc-sub2">建议 What would help</div>
          <ol className="steps-list">
            {c.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {!compact && (
        <div className="rc-note">
          按每周约 {money(c.weekly_spending_cad, 'CAD', 0)} 支出估算 · {c.disclosure}
        </div>
      )}
    </>
  );
}

export function creditFromProfile(p: CreditProfile | undefined): CreditCardData | null {
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

const HEALTH_ZH: Record<string, [string, 'red' | 'orange' | 'green']> = {
  needs_attention: ['需关注', 'red'],
  fair: ['一般', 'orange'],
  on_track: ['良好', 'green'],
  strong: ['优秀', 'green'],
};

export function CreditBody({ c, compact }: { c: CreditCardData; compact?: boolean }) {
  const [hz, tone] = HEALTH_ZH[c.health.key] ?? [c.health.label, 'orange'];
  return (
    <>
      <div className="cr">
        <UtilGauge pct={c.utilization_pct} target={c.target_pct} />
        <div className="cr-r">
          <div className="cr-h">
            <Pill tone={tone}>
              {hz} {c.health.label}
            </Pill>
          </div>
          <div className="kvs">
            <span>已用 Used</span>
            <b className="num">
              <Amt n={c.card.balance} /> / {amount(c.card.credit_limit, 0)}
            </b>
            <span>上期报告 Reported</span>
            <b className="num">{c.utilization_reported_pct}%</b>
            <span>账单日预计 At close</span>
            <b className={`num ${c.utilization_projected_at_close_pct > c.target_pct ? 'c-red' : ''}`}>{c.utilization_projected_at_close_pct}%</b>
            <span>按时还款 Streak</span>
            <b className="num">
              {c.on_time_streak} 期
              <span className="dots">
                {c.payment_history.map((s, i) => (
                  <i key={i} className={`dot-${s}`} />
                ))}
              </span>
            </b>
          </div>
        </div>
      </div>
      {c.statement ? (
        <div className={`callout ${c.statement.days_until_due <= 7 ? 'c-red' : 'c-blue'}`}>
          账单 {money(c.statement.remaining, 'CAD')} · {zhDate(c.statement.due_date)}到期（{c.statement.days_until_due}天）· 最低 {money(c.statement.minimum_due, 'CAD', 0)}
        </div>
      ) : null}
      <div className="callout c-green">
        建议还 <b className="num">{money(c.recommended_payment.amount, 'CAD')}</b> → 利用率降至 {c.recommended_payment.utilization_after_pct}% · Pay this before{' '}
        {enDate(c.next_statement_date)}
      </div>
      {!compact && (
        <>
          <ol className="steps-list">
            {c.next_actions.slice(0, 4).map((a) => (
              <li key={a.key}>{a.text}</li>
            ))}
          </ol>
          <div className="rc-note">{c.footnote}</div>
        </>
      )}
    </>
  );
}

export function ResultCard({ c }: { c: Card }) {
  switch (c.type) {
    case 'balances':
      return <Balances c={c} />;
    case 'fx_quotes':
      return <FxQuotes c={c} />;
    case 'fx_history':
      return <FxHistory c={c} />;
    case 'tuition':
      return (
        <div className="rc">
          <Head zh="学费" en="Next tuition" />
          <TuitionBody c={c} />
          <Provenance />
        </div>
      );
    case 'budget':
      return (
        <div className="rc">
          <Head zh={`近${c.period_days}天支出`} en="Spending" right={<Amt n={c.total_spent_cad} d={0} cur="CAD" className="rc-big2" />} />
          <BudgetBody c={c} />
          <Provenance />
        </div>
      );
    case 'scam_check':
      return <Scam c={c} />;
    case 'transactions':
      return <Transactions c={c} />;
    case 'checklist':
      return <Checklist c={c} />;
    case 'forecast':
      return (
        <div className="rc">
          <Head zh="资金跑道" en={`Runway · to ${enDate(c.end_date)}`} />
          <RunwayBody c={c} />
          <Provenance />
        </div>
      );
    case 'credit':
      return (
        <div className="rc">
          <Head zh="信用成长" en={`Credit builder · ${c.card.number}`} />
          <CreditBody c={c} />
          <Provenance />
        </div>
      );
    default:
      return null;
  }
}
