import { useContext } from 'react';
import { Button, Skeleton } from 'antd-mobile';
import { EyeInvisibleOutline, EyeOutline, LockFill, RightOutline } from 'antd-mobile-icons';
import type { Nav } from '../App';
import { DemoChip } from '../App';
import { api } from '../api';
import type { Action } from '../types';
import { ACCOUNT_ZH, CATEGORY_ZH, amount, enDate, zhDate } from '../format';
import { Amt, HideCtx, Pill, Section, useLoad } from '../components/bits';
import { BudgetBody, CreditBody, RunwayBody, TuitionBody, creditFromProfile } from '../components/cards';
import { ActionCard } from '../components/ActionCard';
import { toast } from '../phone';

const CARD_TONE: Record<string, string> = { acc_cad: 'bc-blue', acc_myr: 'bc-red', acc_tui: 'bc-purple' };

export function Wallet({ nav }: { nav: Nav }) {
  const { hidden, toggle } = useContext(HideCtx);
  const ov = useLoad(() => api.overview(), [nav.rev]);
  const fc = useLoad(() => api.forecast(), [nav.rev]);
  const acts = useLoad(() => api.actions(), [nav.rev]);
  const o = ov.data;
  const credit = creditFromProfile(o?.credit);
  const pending = (acts.data?.actions ?? []).filter((a) => ['awaiting_user', 'awaiting_sponsor'].includes(a.status));

  const confirm = async (a: Action) => {
    const r = await api.confirm(a.action_id, a.confirm_token ?? '');
    toast.ok(r.status === 'awaiting_sponsor' ? '已发送给爸爸 Sent to Dad' : '已完成 Done');
    nav.bump();
  };
  const cancel = async (a: Action) => {
    await api.cancel(a.action_id);
    toast.info('已撤回 Withdrawn');
    nav.bump();
  };

  return (
    <div className="wallet">
      <header className="hd-blue hd-wallet">
        <div className="w-top">
          <b>钱包</b>
          <small>Wallet</small>
          <DemoChip />
        </div>
        <div className="w-total">
          <span>
            总资产 Total (CAD)
            <button onClick={toggle} className="eye eye-w" aria-label="Toggle balances">
              {hidden ? <EyeInvisibleOutline /> : <EyeOutline />}
            </button>
          </span>
          <b>{o ? <Amt n={o.total_cad} /> : '–'}</b>
          {o ? (
            <small>
              1 MYR = {o.rates['MYR/CAD']} CAD · 1 CAD = {o.rates['CAD/MYR']} MYR
            </small>
          ) : null}
        </div>
      </header>

      <div className="w-body">
        {o?.freeze.frozen && (
          <div className="frozen-bar static">
            <LockFill /> 支付已冻结 · Payments locked{o.freeze.sponsor_funded === 'sponsor' ? '（爸爸设置）' : ''}
          </div>
        )}

        <div className="bankcards">
          {o
            ? o.accounts.map((a) => (
                <div key={a.id} className={`bankcard ${CARD_TONE[a.id] ?? 'bc-blue'}`}>
                  <div className="bk-top">
                    <span>
                      <b>{ACCOUNT_ZH[a.label] ?? a.label}</b>
                      <small>{a.label}</small>
                    </span>
                    {a.sponsor_funded ? <span className="bk-tag">爸爸资助 Sponsor-funded</span> : <span className="bk-tag">本人 Own</span>}
                  </div>
                  <div className="bk-bal">
                    <Amt n={a.balance} cur={a.currency} />
                  </div>
                  <div className="bk-no num">{a.number.replace('••••', '•••• •••• ')}</div>
                </div>
              ))
            : [0, 1].map((i) => <Skeleton key={i} animated className="bankcard-sk" />)}
        </div>

        {pending.length > 0 && (
          <Section zh="待处理" en={`Pending · ${pending.length}`} flush>
            {pending.map((a) => (
              <ActionCard key={a.action_id} action={a} mode="student" onConfirm={confirm} onCancel={cancel} />
            ))}
          </Section>
        )}

        {credit && (
          <Section zh="信用卡" en="Secured card · credit builder" extra="详情" onExtra={() => nav.ask("How's my credit?")}>
            <div className="ccard">
              <div className="cc-top">
                <span>
                  <b>HomeBridge</b> 信用卡
                </span>
                <span className="num">{credit.card.number}</span>
              </div>
              <div className="cc-mid">
                <div>
                  <small>可用额度 Available</small>
                  <Amt n={credit.card.available} cur="CAD" />
                </div>
                <div>
                  <small>账单日 Statement</small>
                  <b className="num">
                    {zhDate(credit.next_statement_date)} · {credit.days_until_statement}天
                  </b>
                </div>
              </div>
            </div>
            <CreditBody c={credit} compact />
            <Button block color="primary" size="middle" className="mt8" onClick={() => nav.ask('Pay my card')}>
              还款 Pay card {credit.statement ? `CAD ${amount(credit.recommended_payment.amount)}` : ''}
            </Button>
          </Section>
        )}

        <Section zh="资金跑道" en="Runway" extra="问助手" onExtra={() => nav.ask('Will I run out of money before tuition is due?')}>
          {fc.data ? <RunwayBody c={fc.data} compact /> : <Skeleton.Paragraph lineCount={4} animated />}
        </Section>

        {o && (
          <Section zh="学费" en="Tuition" extra="补足缺口" onExtra={() => nav.ask('Cover the tuition shortfall from my MYR wallet')}>
            <TuitionBody c={o.tuition} />
            <div className="rows mt8">
              {o.tuition.installments.map((t) => (
                <div className="row" key={t.due}>
                  <div className="row-l">
                    <span className="row-t">{t.term}</span>
                    <span className="row-s">
                      {zhDate(t.due)} · {enDate(t.due)} · {t.days_until_due}天
                    </span>
                  </div>
                  <Amt n={t.amount} d={0} cur="CAD" className="row-v" />
                </div>
              ))}
            </div>
          </Section>
        )}

        {o && (
          <Section zh="近30天预算" en="Budget · 30 days" extra="分析" onExtra={() => nav.ask('How is my budget this month?')}>
            <div className="bud-sum">
              <div>
                <small>支出 Spent</small>
                <Amt n={o.budget.total_spent_cad} d={0} />
              </div>
              <div>
                <small>收入 Income</small>
                <Amt n={o.budget.income_cad} d={0} />
              </div>
              <div>
                <small>结余 Net</small>
                <Amt n={o.budget.income_cad - o.budget.total_spent_cad} d={0} className={o.budget.income_cad < o.budget.total_spent_cad ? 'c-red' : 'c-green'} />
              </div>
            </div>
            <BudgetBody c={o.budget} />
          </Section>
        )}

        {o && (
          <Section zh="常用收款人" en="Payees">
            <div className="rows">
              {o.payees.map((p) => (
                <div className="row" key={p.id}>
                  <span className="payee-av">{p.name.slice(0, 1)}</span>
                  <div className="row-l">
                    <span className="row-t">{p.name}</span>
                    <span className="row-s num">
                      {CATEGORY_ZH[p.kind] ?? p.kind} · {p.currency} {p.number}
                    </span>
                  </div>
                  <Pill tone={p.status === 'active' ? 'green' : 'orange'}>{p.status === 'active' ? '可用' : '冷静期'}</Pill>
                </div>
              ))}
            </div>
          </Section>
        )}

        {o && (
          <div className="limits">
            <span>
              单笔限额 <b className="num">CAD {amount(o.limits.single_cad, 0)}</b>
            </span>
            <span>
              24小时 <b className="num">CAD {amount(o.limits.daily_cad, 0)}</b>
            </span>
            <span className="lim-n">
              爸爸设置 · set by Dad <RightOutline fontSize={9} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
