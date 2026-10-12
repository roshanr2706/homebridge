import { useState } from 'react';
import { ActionSheet, Button, Dialog, Popup, Skeleton, Stepper } from 'antd-mobile';
import {
  CheckCircleFill,
  CheckShieldFill,
  CloseCircleFill,
  ExclamationCircleFill,
  LockFill,
  SetOutline,
  UnlockOutline,
  UserCircleOutline,
} from 'antd-mobile-icons';
import type { Nav } from '../App';
import { DemoChip } from '../App';
import { api } from '../api';
import type { Action, Verify } from '../types';
import { ACCOUNT_ZH, STATUS_ZH, ago, amount } from '../format';
import { Amt, Pill, Section, useLoad } from '../components/bits';
import { ActionCard } from '../components/ActionCard';
import { PinPad } from '../components/PinPad';
import { phone, safe, toast } from '../phone';

export function SponsorHome({ nav }: { nav: Nav }) {
  const ov = useLoad(() => api.sponsorOverview(), [nav.rev]);
  const q = useLoad(() => api.sponsorQueue(), [nav.rev]);
  const [limitsOpen, setLimitsOpen] = useState(false);
  // Unlock and limit changes go through the same server-checked PIN step as approvals.
  const [pinReq, setPinReq] = useState<{ title: string; subtitle: string; run: (pin: string) => Promise<void> } | null>(null);
  const o = ov.data;
  const queue = q.data?.actions ?? [];
  const frozen = o?.freeze.frozen ?? false;

  const approve = async (a: Action, note: string, pin: string) => {
    const r = await api.approve(a.action_id, note, pin);
    if (r.status === 'executed') toast.ok('已批准并执行 Approved');
    else if (r.status === 'failed') toast.fail(`已批准但执行失败：${r.result?.error ?? 'failed'}`);
    else toast.ok('已批准 Approved');
    nav.bump();
  };
  const reject = async (a: Action, note: string) => {
    await api.reject(a.action_id, note);
    toast.info('已拒绝 Rejected');
    nav.bump();
  };

  const lock = () => {
    if (frozen) {
      Dialog.confirm({
        getContainer: phone,
        title: '解除冻结？ Unlock?',
        content: '解除您和 Aisha 设置的所有锁定。Lifts every lock on Aisha’s payments.',
        confirmText: '解冻 Unlock',
        cancelText: '取消',
        onConfirm: () =>
          setPinReq({
            title: '解除冻结 Unlock',
            subtitle: 'Aisha 的全部付款 · All of Aisha’s payments',
            run: async (pin) => {
              await api.sponsorUnfreeze(pin);
              toast.ok('已解冻 Unlocked');
              nav.bump();
            },
          }),
      });
      return;
    }
    const h = ActionSheet.show({
      getContainer: phone,
      extra: '冻结后 Aisha 无法确认付款，您也无法批准。Aisha can’t confirm and you can’t approve until you unlock.',
      cancelText: '取消 Cancel',
      actions: [
        {
          key: 'sf',
          text: '冻结资助资金 Lock money I fund',
          description: '马币钱包 + 学费金 · MYR Wallet and Tuition Fund',
          onClick: safe(async () => {
            await api.sponsorFreeze('sponsor_funded');
            toast.ok('已冻结资助资金 Locked');
            nav.bump();
          }),
        },
        {
          key: 'all',
          text: '冻结全部 Lock everything',
          description: '包括 Aisha 自己的日常账户 · incl. her own Everyday account',
          danger: true,
          onClick: safe(async () => {
            await api.sponsorFreeze('all');
            toast.ok('已全部冻结 All locked');
            nav.bump();
          }),
        },
      ],
      onAction: () => h.close(),
    });
  };

  return (
    <div className="sponsor">
      <header className="hd-orange">
        <div className="sp-top">
          <span className="sp-av">R</span>
          <div>
            <b>爸爸守护</b>
            <small>Encik Rahman · 资助 sponsoring {o?.student.name ?? 'Aisha'}</small>
          </div>
          <DemoChip />
        </div>
        <div className="sp-sum">
          <div>
            <small>Aisha 总资产 (CAD)</small>
            <b>{o ? <Amt n={o.total_cad} /> : '–'}</b>
          </div>
          <div>
            <small>24h 支出 Out</small>
            <b>{o ? <Amt n={o.digest.money_out_cad} d={0} /> : '–'}</b>
          </div>
          <div>
            <small>待审批 Queue</small>
            <b className="num">{queue.length}</b>
          </div>
        </div>
      </header>

      <div className="sp-body">
        <div className={`lockcard ${frozen ? 'is-frozen' : ''}`}>
          <button className="lock-btn" onClick={lock} aria-label={frozen ? 'Unlock' : 'Lock'}>
            {frozen ? <UnlockOutline fontSize={26} /> : <LockFill fontSize={26} />}
            <span>{frozen ? '解冻' : '一键冻结'}</span>
          </button>
          <div className="lock-t">
            <b>{frozen ? '支付已冻结 Payments locked' : '资金安全 Payments active'}</b>
            <small>
              {frozen
                ? `资助资金：${o?.freeze.sponsor_funded ?? '—'} 锁定 · 本人资金：${o?.freeze.own ?? '未锁'} · since ${o?.freeze.since ? ago(o.freeze.since) : ''}`
                : '怀疑诈骗？一键冻结 Aisha 的付款。Suspect a scam? Lock her payments in one tap.'}
            </small>
          </div>
        </div>

        <Section zh="待审批" en={`Approvals · ${queue.length}`}>
          {q.loading && !q.data ? <Skeleton.Paragraph lineCount={4} animated /> : null}
          {queue.length === 0 && q.data ? (
            <div className="empty">
              <CheckCircleFill fontSize={36} />
              <b>暂无待审批</b>
              <small>All clear. Requests that need you will show up here.</small>
            </div>
          ) : null}
          {queue.map((a) => (
            <ActionCard key={a.action_id} action={a} mode="sponsor" onApprove={approve} onReject={reject} />
          ))}
        </Section>

        {o && (
          <Section zh="24小时摘要" en="Daily digest">
            <div className="digest">
              {[
                ['草拟', 'Drafted', o.digest.drafted, ''],
                ['已执行', 'Executed', o.digest.executed, 'c-green'],
                ['待批准', 'Awaiting', o.digest.awaiting_sponsor, 'c-blue'],
                ['已拦截', 'Stopped', o.digest.stopped, o.digest.stopped ? 'c-red' : ''],
                ['提醒', 'Alerts', o.digest.alerts, o.digest.alerts ? 'c-orange' : ''],
              ].map(([zh, en, v, cls]) => (
                <div key={String(en)}>
                  <b className={`num ${cls}`}>{v}</b>
                  <span>{zh}</span>
                  <small>{en}</small>
                </div>
              ))}
            </div>
            {o.digest.flagged.length > 0 && (
              <div className="rows">
                {o.digest.flagged.map((f) => (
                  <div className="row" key={f.action_id}>
                    <ExclamationCircleFill className="c-red" />
                    <div className="row-l">
                      <span className="row-t">{f.summary}</span>
                      <span className="row-s">风险 risk {f.risk_score} · {f.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {o && (
          <Section zh="Aisha 的账户" en="Her accounts">
            <div className="rows">
              {o.accounts.map((a) => (
                <div className="row" key={a.id}>
                  <div className="row-l">
                    <span className="row-t">
                      {ACCOUNT_ZH[a.label] ?? a.label} <small>{a.label}</small>
                    </span>
                    <span className="row-s num">
                      {a.number} {a.sponsor_funded ? '· 您资助 you fund this' : '· 她本人 her own'}
                    </span>
                  </div>
                  <Amt n={a.balance} cur={a.currency} className="row-v" />
                </div>
              ))}
            </div>
            <button className="limits limits-btn" onClick={() => setLimitsOpen(true)}>
              <span>
                单笔 <b className="num">CAD {amount(o.limits.single_cad, 0)}</b>
              </span>
              <span>
                24h <b className="num">CAD {amount(o.limits.daily_cad, 0)}</b>
              </span>
              <span className="lim-n">
                <SetOutline /> 调整限额 Limits
              </span>
            </button>
          </Section>
        )}
      </div>

      {o && (
        <LimitsSheet
          visible={limitsOpen}
          single={o.limits.single_cad}
          daily={o.limits.daily_cad}
          onClose={() => setLimitsOpen(false)}
          onSave={async (s, d) => {
            setLimitsOpen(false);
            setPinReq({
              title: `限额 ${amount(s, 0)} / ${amount(d, 0)}`,
              subtitle: '单笔 / 24小时 CAD · Single / daily limit',
              run: async (pin) => {
                await api.setLimits(s, d, pin);
                toast.ok('限额已更新 Limits saved');
                nav.bump();
              },
            });
          }}
        />
      )}
      <PinPad
        visible={!!pinReq}
        title={pinReq?.title ?? ''}
        subtitle={pinReq?.subtitle ?? ''}
        onClose={() => setPinReq(null)}
        onSubmit={async (pin) => {
          await pinReq!.run(pin);
          setPinReq(null);
        }}
      />
    </div>
  );
}

function LimitsSheet({
  visible,
  single,
  daily,
  onClose,
  onSave,
}: {
  visible: boolean;
  single: number;
  daily: number;
  onClose: () => void;
  onSave: (s: number, d: number) => Promise<void>;
}) {
  const [s, setS] = useState(single);
  const [d, setD] = useState(daily);
  return (
    <Popup visible={visible} onMaskClick={onClose} bodyClassName="sheet" getContainer={phone} afterShow={() => (setS(single), setD(daily))}>
      <div className="sheet-h">
        <span>调整限额</span>
        <small>Limits Aisha can confirm alone · only you can change these</small>
      </div>
      <div className="lim-row">
        <span>
          单笔限额 <small>Single payment (CAD)</small>
        </span>
        <Stepper value={s} min={100} max={20000} step={100} onChange={setS} />
      </div>
      <div className="lim-row">
        <span>
          24小时限额 <small>Rolling 24h (CAD)</small>
        </span>
        <Stepper value={d} min={100} max={50000} step={100} onChange={setD} />
      </div>
      {s > d ? <div className="warn">单笔不能高于24小时限额 · Single can’t exceed daily</div> : null}
      <Button block color="primary" size="large" disabled={s > d} onClick={() => onSave(s, d)}>
        保存 Save
      </Button>
    </Popup>
  );
}

export function SponsorActivity({ nav }: { nav: Nav }) {
  const ov = useLoad(() => api.sponsorOverview(), [nav.rev]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const o = ov.data;
  return (
    <div className="plain">
      <header className="plain-h">
        <b>动态</b>
        <small>Activity · alerts & audit</small>
        <DemoChip />
      </header>
      <div className="sp-body">
        <Section zh="安全提醒" en="Alerts">
          {o && o.alerts.length === 0 ? <div className="muted">暂无提醒 No alerts</div> : null}
          <div className="rows">
            {o?.alerts.map((al) => (
              <div className="row" key={al.id}>
                <span className={`alert-ic ${al.weight >= 40 ? 'bg-red' : 'bg-orange'}`}>
                  <ExclamationCircleFill />
                </span>
                <div className="row-l">
                  <span className="row-t">{al.message}</span>
                  <span className="row-s">
                    {al.kind} · {ago(al.ts)}
                  </span>
                </div>
                <Pill tone={al.weight >= 40 ? 'red' : 'orange'}>{al.weight}</Pill>
              </div>
            ))}
          </div>
        </Section>

        <Section zh="最近动态" en="Recent requests">
          <div className="rows">
            {o?.recent
              .slice()
              .reverse()
              .map((a) => {
                const [szh, tone] = STATUS_ZH[a.status] ?? [a.status, 'default'];
                return (
                  <div className="row" key={a.action_id}>
                    {a.status === 'executed' ? (
                      <CheckCircleFill className="c-green" />
                    ) : a.status === 'rejected' || a.status === 'failed' ? (
                      <CloseCircleFill className="c-red" />
                    ) : (
                      <UserCircleOutline className="c-blue" />
                    )}
                    <div className="row-l">
                      <span className="row-t">{a.summary}</span>
                      <span className="row-s">
                        {a.tier} · {ago(a.created_at)}
                        {a.sponsor_note ? ` · “${a.sponsor_note}”` : ''}
                      </span>
                    </div>
                    <Pill tone={tone === 'success' ? 'green' : tone === 'danger' ? 'red' : tone === 'primary' ? 'blue' : tone === 'warning' ? 'orange' : 'default'}>{szh}</Pill>
                  </div>
                );
              })}
          </div>
        </Section>

        <Section zh="审计链" en="Tamper-evident audit log">
          <div className="audit">
            <CheckShieldFill fontSize={28} className={verify ? (verify.ok ? 'c-green' : 'c-red') : 'c-blue'} />
            <div className="row-l">
              <span className="row-t">
                {verify ? (verify.ok ? `链完整 · ${verify.count} 条记录` : `第 ${verify.broken_at} 条被篡改`) : '每一步都写入哈希链'}
              </span>
              <span className="row-s num">{verify?.head ? `head ${String(verify.head).slice(0, 16)}…` : 'Every draft, confirm and approval is hash-chained.'}</span>
            </div>
            <Button
              size="small"
              color="primary"
              fill="outline"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setVerify(await api.auditVerify());
                } catch (e) {
                  toast.fail((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              校验 Verify
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
