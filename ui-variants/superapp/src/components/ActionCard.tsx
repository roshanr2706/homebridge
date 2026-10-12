// The confirm card for an agent-drafted action: tier + risk badges, the "why" boxes, the four-step
// timeline (Drafted -> You confirm -> Dad approves -> Done) and the buttons for the current role.
import { useState } from 'react';
import { Button, Dialog, Popup, Steps, TextArea } from 'antd-mobile';
import { phone, toast } from '../phone';
import { ExclamationCircleFill, LockFill, CheckShieldOutline } from 'antd-mobile-icons';
import type { Action, Compliance } from '../types';
import { KIND_ZH, STATUS_ZH, amount, money } from '../format';
import { Pill, useNow } from './bits';
import { PinPad } from './PinPad';

type Props = {
  action: Action;
  mode: 'student' | 'sponsor';
  onConfirm?: (a: Action) => Promise<void>;
  onCancel?: (a: Action) => Promise<void>;
  onApprove?: (a: Action, note: string, pin: string) => Promise<void>;
  onReject?: (a: Action, note: string) => Promise<void>;
};

const TIER: Record<string, [string, string]> = {
  T1: ['爸爸决定', 'Sponsor decides'],
  T2: ['您确认', 'You confirm'],
  T3: ['您 + 爸爸', 'You + sponsor'],
};

const isMove = (a: Action) => a.kind === 'conversion' && a.params.from_currency === a.params.to_currency;

function headline(a: Action): { big: string; sub?: string } {
  const p = a.params;
  if (isMove(a)) return { big: money(p.amount, p.from_currency), sub: a.summary.replace(/^Move [^ ]+ [^ ]+ /, '') };
  if (a.kind === 'transfer') return { big: money(p.amount, p.currency), sub: `付给 to ${p.payee_name}` };
  if (a.kind === 'conversion') return { big: money(p.amount, p.from_currency), sub: `→ 约 about ${money(p.expected_receive, p.to_currency)}` };
  if (a.kind === 'topup') return { big: money(p.amount, p.currency), sub: p.reason ? `用途 for ${p.reason}` : undefined };
  if (a.kind === 'add_payee') return { big: p.name, sub: `${p.kind} · ${p.currency} · ${p.number_masked}` };
  return { big: a.summary };
}

function details(a: Action): [string, string][] {
  const p = a.params;
  if (a.kind === 'transfer') {
    const rows: [string, string][] = [
      ['收款方 To', p.payee_name],
      ['付款账户 From', p.from_account],
    ];
    if (p.memo) rows.push(['备注 Memo', p.memo]);
    return rows;
  }
  if (isMove(a)) return [['手续费 Fee', '免费 · own accounts']];
  if (a.kind === 'conversion')
    return [
      ['汇率 Rate', `${p.rate} ${p.to_currency}/${p.from_currency}`],
      ['到账 You receive', money(p.expected_receive, p.to_currency)],
    ];
  return [];
}

function timeline(a: Action, mode: Props['mode']) {
  const bad = ['rejected', 'cancelled', 'expired', 'failed', 'blocked'].includes(a.status);
  const items: { title: string; desc: string; key: string }[] = [{ title: '草拟', desc: 'Drafted', key: 'draft' }];
  if (a.kind !== 'topup') items.push({ title: mode === 'sponsor' ? '已确认' : '您确认', desc: mode === 'sponsor' ? 'Confirmed' : 'You confirm', key: 'user' });
  if (a.needs_sponsor_approval) items.push({ title: mode === 'sponsor' ? '您批准' : '爸爸批准', desc: mode === 'sponsor' ? 'You approve' : 'Dad approves', key: 'sponsor' });
  items.push({ title: a.status === 'failed' ? '失败' : '完成', desc: a.status === 'failed' ? 'Failed' : 'Done', key: 'done' });
  let current = 0;
  if (a.status === 'awaiting_user') current = 1;
  else if (a.status === 'awaiting_sponsor') current = items.findIndex((i) => i.key === 'sponsor');
  else if (a.status === 'executed' || a.status === 'failed') current = items.length - 1;
  else if (bad) current = a.user_confirmed ? Math.max(1, items.findIndex((i) => i.key === 'sponsor')) : 1;
  const status: 'process' | 'finish' | 'error' = a.status === 'executed' ? 'finish' : bad ? 'error' : 'process';
  return { items, current: Math.max(0, current), status };
}

const OUTCOME: Record<string, [string, 'green' | 'orange' | 'red']> = {
  clear: ['通过 Clear', 'green'],
  review: ['需复核 Review', 'orange'],
  blocked: ['拦截 Blocked', 'red'],
};
const MARK: Record<string, string> = { pass: '✓', flag: '!', block: '✕', report: '↗', na: '–' };

/** Server-side compliance screening (sanctions, KYC, reporting): passes as chips, anything else spelled out. */
function ComplianceBox({ c }: { c: Compliance }) {
  const [label, tone] = OUTCOME[c.outcome] ?? OUTCOME.clear;
  const passes = c.checks.filter((x) => x.status === 'pass' || x.status === 'na');
  const notable = c.checks.filter((x) => x.status !== 'pass' && x.status !== 'na');
  return (
    <div className="comp">
      <div className="comp-h">
        <b>
          合规检查 <small>Compliance</small>
        </b>
        <span className="comp-r">
          {c.purpose_code ? <span className="comp-pc">{c.purpose_code.label}</span> : null}
          <Pill tone={tone}>{label}</Pill>
        </span>
      </div>
      {notable.map((x) => (
        <div key={x.id + x.label} className={`comp-i cs-${x.status}`}>
          <i>{MARK[x.status]}</i>
          <span>
            <b>{x.label}</b> · {x.detail}
          </span>
        </div>
      ))}
      {passes.length > 0 && (
        <div className="comp-pass">
          {passes.map((x) => (
            <span key={x.id + x.label} title={x.detail} className={x.status === 'na' ? 'na' : ''}>
              {MARK[x.status]} {x.label}
            </span>
          ))}
        </div>
      )}
      {c.block_reason ? <div className="comp-i cs-block">{c.block_reason}</div> : null}
    </div>
  );
}

export function ActionCard({ action: a, mode, onConfirm, onCancel, onApprove, onReject }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [pin, setPin] = useState(false);
  const now = useNow(a.status === 'awaiting_user');
  const risky = a.risk_score >= 40;
  const h = headline(a);
  const left = Math.max(0, Math.round(a.expires_at - now / 1000));
  const sponsorWhy = a.sponsor_reasons ?? [];
  const signals = a.risk_signals ?? a.risk_reasons.filter((r) => !sponsorWhy.includes(r));
  const untrusted = Object.entries(a.provenance ?? {})
    .filter(([, v]) => v === 'untrusted')
    .map(([k]) => k);
  const frozen = a.frozen && ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? a.frozen : null;
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));
  const [kzh, ken] = isMove(a) ? ['账户间划转', 'Move'] : KIND_ZH[a.kind] ?? [a.kind, a.kind];
  const [tzh] = TIER[a.tier] ?? [a.tier, ''];
  const [szh, stone] = STATUS_ZH[a.status] ?? [a.status, 'default'];
  const tl = timeline(a, mode);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.fail((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reject = () => {
    let note = '';
    Dialog.confirm({
      getContainer: phone,
      title: '拒绝这笔请求？ Reject?',
      content: (
        <div>
          <div className="dlg-sub">{a.summary}</div>
          <TextArea placeholder="给 Aisha 留言（可选）Note for Aisha" maxLength={200} rows={2} onChange={(v) => (note = v)} />
        </div>
      ),
      confirmText: '拒绝 Reject',
      cancelText: '再想想',
      onConfirm: () => run('reject', () => onReject!(a, note)),
    });
  };

  return (
    <div className={`ac ${risky ? 'ac-risk' : ''}`}>
      <div className="ac-h">
        <span className="ac-k">
          {kzh} <small>{ken}</small>
        </span>
        <span className="ac-badges">
          <Pill tone={a.tier === 'T3' ? 'orange' : a.tier === 'T1' ? 'purple' : 'blue'}>
            {a.tier} {tzh}
          </Pill>
          {a.risk_score > 0 ? <Pill tone={risky ? 'red' : 'orange'}>风险 {a.risk_score}</Pill> : <Pill tone="green">低风险</Pill>}
        </span>
      </div>
      <div className="ac-b">
        <div className="ac-amt num">{h.big}</div>
        {h.sub ? <div className="ac-sub">{h.sub}</div> : null}
        {details(a).length > 0 && (
          <div className="ac-rows">
            {details(a).map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        )}

        {a.compliance && a.compliance.checks?.length > 0 && <ComplianceBox c={a.compliance} />}
        {untrusted.length > 0 && (
          <div className="box box-red">
            <b>
              <ExclamationCircleFill /> {untrusted.join(' / ')} 来自您粘贴的消息，不是您本人输入
            </b>
            <div>The {untrusted.join(' and ')} came from a pasted message. Check an official source first.</div>
          </div>
        )}
        {sponsorWhy.length > 0 && (
          <div className="box box-gold">
            <b>{mode === 'sponsor' ? '为什么需要您批准 · Why this came to you' : '为什么要爸爸批准 · Why your sponsor approves'}</b>
            <ul>
              {sponsorWhy.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {signals.length > 0 && (
          <div className={`box ${risky ? 'box-red' : 'box-orange'}`}>
            <b>
              风险信号 Risk signals <span className="num">{a.risk_score}/100</span>
            </b>
            <ul>
              {signals.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {frozen && (
          <div className="box box-red">
            <b>
              <LockFill /> 支付已冻结 Payments locked
            </b>
            <div>{frozen}. 冻结期间无法确认或批准 · Nothing can be confirmed or approved while locked.</div>
          </div>
        )}
        {warnings.map((w) => (
          <div className="warn" key={w}>
            <ExclamationCircleFill /> {w}
          </div>
        ))}

        <Steps current={tl.current} className="ac-steps">
          {tl.items.map((s, i) => (
            <Steps.Step
              key={s.key}
              title={s.title}
              description={s.desc}
              status={i < tl.current ? 'finish' : i === tl.current ? tl.status : 'wait'}
            />
          ))}
        </Steps>

        <div className="ac-foot">
          <Pill tone={stone === 'success' ? 'green' : stone === 'danger' ? 'red' : stone === 'warning' ? 'orange' : stone === 'primary' ? 'blue' : 'default'}>{szh}</Pill>
          {a.status === 'awaiting_user' && mode === 'student' ? (
            <span className={`num ac-ttl ${left < 60 ? 'c-red' : ''}`}>
              一次性确认 · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} 后失效
            </span>
          ) : null}
          {a.status === 'awaiting_sponsor' && mode === 'student' ? <span className="ac-ttl">已发送给爸爸 · Sent to Dad</span> : null}
          {a.status === 'executed' && a.result?.new_balance !== undefined ? (
            <span className="ac-ttl num">新余额 {amount(a.result.new_balance)}</span>
          ) : null}
          {a.status === 'failed' && a.result?.error ? <span className="ac-ttl c-red">{String(a.result.error)}</span> : null}
        </div>
        {a.sponsor_note ? <div className="quote">爸爸留言：“{a.sponsor_note}”</div> : null}

        {mode === 'student' && a.status === 'awaiting_user' && (
          <div className="ac-btns">
            <Button size="middle" fill="outline" loading={busy === 'cancel'} onClick={() => onCancel && run('cancel', () => onCancel(a))}>
              取消 Cancel
            </Button>
            <Button size="middle" color="primary" disabled={!!frozen} onClick={() => setSheet(true)}>
              {frozen ? '已冻结 Locked' : a.needs_sponsor_approval ? '确认并发给爸爸' : '确认支付 Confirm'}
            </Button>
          </div>
        )}
        {mode === 'student' && a.status === 'awaiting_sponsor' && onCancel && (
          <div className="ac-btns">
            <Button size="small" fill="none" loading={busy === 'cancel'} onClick={() => run('cancel', () => onCancel(a))}>
              撤回请求 Withdraw
            </Button>
          </div>
        )}
        {mode === 'sponsor' && a.status === 'awaiting_sponsor' && (
          <div className="ac-btns">
            <Button size="middle" color="danger" fill="outline" loading={busy === 'reject'} onClick={reject}>
              拒绝 Reject
            </Button>
            <Button size="middle" color="primary" disabled={!!frozen} loading={busy === 'approve'} onClick={() => setPin(true)}>
              {frozen ? '已冻结 Locked' : '批准 Approve'}
            </Button>
          </div>
        )}
      </div>

      {/* Cashier sheet: the student's final check before the single-use token is spent. */}
      <Popup visible={sheet} onMaskClick={() => setSheet(false)} bodyClassName="sheet" destroyOnClose getContainer={phone}>
        <div className="sheet-h">
          <span>确认{kzh}</span>
          <small>Confirm {ken.toLowerCase()}</small>
        </div>
        <div className="sheet-amt num">{h.big}</div>
        {h.sub ? <div className="sheet-sub">{h.sub}</div> : null}
        <div className="ac-rows">
          {details(a).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <div>
            <span>审批 Approval</span>
            <b>{a.needs_sponsor_approval ? '确认后需爸爸批准 · Dad approves next' : '您确认即执行 · Runs on confirm'}</b>
          </div>
        </div>
        <div className="sheet-trust">
          <CheckShieldOutline /> 一次性确认码，仅本次有效 · Single-use confirmation, bound to this draft
        </div>
        <Button
          block
          color="primary"
          size="large"
          loading={busy === 'confirm'}
          onClick={() =>
            run('confirm', async () => {
              await onConfirm!(a);
              setSheet(false);
            })
          }
        >
          {a.needs_sponsor_approval ? '确认并发给爸爸 Confirm' : '确认付款 Confirm'}
        </Button>
      </Popup>

      {mode === 'sponsor' && (
        <PinPad
          visible={pin}
          title={`批准 ${h.big}`}
          subtitle={h.sub ?? a.summary}
          onClose={() => setPin(false)}
          onSubmit={async (code) => {
            await onApprove!(a, '', code);
            setPin(false);
          }}
        />
      )}
    </div>
  );
}
