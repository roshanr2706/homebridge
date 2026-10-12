import { useContext, useEffect, useMemo, useState, type ComponentType } from 'react';
import { ActionSheet, Badge, Dialog, Skeleton, Swiper } from 'antd-mobile';
import {
  BellOutline,
  BillOutline,
  CalendarOutline,
  CheckShieldOutline,
  CollectMoneyOutline,
  CompassOutline,
  DownFill,
  EyeInvisibleOutline,
  EyeOutline,
  GlobalOutline,
  HistogramOutline,
  LockOutline,
  LoopOutline,
  PieOutline,
  RightOutline,
  ScanCodeOutline,
  SearchOutline,
  SendOutline,
  SoundOutline,
  TeamOutline,
  UnlockOutline,
  UnorderedListOutline,
  BankcardOutline,
  CheckShieldFill,
  ExclamationShieldFill,
} from 'antd-mobile-icons';
import type { Nav } from '../App';
import { DemoChip } from '../App';
import { api } from '../api';
import { ACCOUNT_ZH, STATUS_ZH, amount, enDate, money, zhDate } from '../format';
import { Amt, HideCtx, Pill, Section, useLoad } from '../components/bits';
import { RunwayChart } from '../components/charts';
import { phone, toast } from '../phone';

const SCAM_SAMPLE = "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'";

type Tile = {
  zh: string;
  en: string;
  Icon: ComponentType<{ fontSize?: number | string }>;
  color: string;
  badge?: string | typeof Badge.dot;
  onTap: () => void;
};

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid5">
      {tiles.map((t) => (
        <button className="tile" key={t.en} onClick={t.onTap}>
          <Badge content={t.badge} style={{ '--right': '2px', '--top': '2px' }}>
            <span className={`tile-ic ic-${t.color}`}>
              <t.Icon fontSize={22} />
            </span>
          </Badge>
          <span className="tile-zh">{t.zh}</span>
          <span className="tile-en">{t.en}</span>
        </button>
      ))}
    </div>
  );
}

/** Vertical rotating notice bar (Alipay "头条" style). */
function Ticker({ items }: { items: { text: string; en: string; onTap: () => void; tone: string }[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % items.length), 3200);
    return () => clearInterval(id);
  }, [items.length]);
  if (!items.length) return null;
  const cur = items[i % items.length];
  return (
    <button className="ticker" onClick={cur.onTap}>
      <span className="ticker-l">
        <SoundOutline fontSize={14} />
        提醒
      </span>
      <span className="ticker-win">
        <span className="ticker-roll" key={i}>
          <span className={`ticker-dot t-${cur.tone}`} />
          <b>{cur.text}</b>
          <small>{cur.en}</small>
        </span>
      </span>
      <span className="ticker-n num">
        {(i % items.length) + 1}/{items.length}
      </span>
      <RightOutline fontSize={12} />
    </button>
  );
}

export function Home({ nav }: { nav: Nav }) {
  const { hidden, toggle } = useContext(HideCtx);
  const ov = useLoad(() => api.overview(), [nav.rev]);
  const fc = useLoad(() => api.forecast(), [nav.rev]);
  const [q, setQ] = useState('');
  const o = ov.data;
  const f = fc.data;
  const frozen = o?.freeze.frozen ?? false;

  const lock = () => {
    if (frozen) {
      Dialog.confirm({
        getContainer: phone,
        title: '解除冻结？ Unlock payments?',
        content: '只解除您自己设置的锁定。爸爸资助的资金需爸爸解锁。Only your own lock is lifted; sponsor-funded money stays locked until Dad unlocks it.',
        confirmText: '解冻 Unlock',
        cancelText: '取消',
        onConfirm: async () => {
          try {
            const r = await api.unfreeze();
            toast.ok(r.note ? '已部分解冻 Partly unlocked' : '已解冻 Unlocked');
            nav.bump();
          } catch (e) {
            toast.fail((e as Error).message);
          }
        },
      });
      return;
    }
    Dialog.confirm({
      getContainer: phone,
      title: '一键冻结所有支付？',
      content: 'Lock all payments now. 收到可疑电话或短信时使用。爸爸会收到提醒。Dad is alerted; nothing can be confirmed or approved until unlocked.',
      confirmText: '立即冻结 Lock',
      cancelText: '取消',
      onConfirm: async () => {
        try {
          await api.freeze();
          toast.ok('已冻结 Locked');
          nav.bump();
        } catch (e) {
          toast.fail((e as Error).message);
        }
      },
    });
  };

  const payees = () => {
    const handler = ActionSheet.show({
      getContainer: phone,
      extra: '选择收款方 Choose who to pay · 由助手草拟，您确认后才付款',
      cancelText: '取消 Cancel',
      actions: [
        { key: 'rent', text: '房租 Rent · Maple Court Rentals', onClick: () => nav.ask('Pay rent to my landlord') },
        { key: 'card', text: '信用卡 Card · HomeBridge Secured Card', onClick: () => nav.ask('Pay my card') },
        { key: 'tuition', text: '学费 Tuition · UBC Student Financial Services', onClick: () => nav.ask('Pay my spring tuition') },
        { key: 'hydro', text: '水电 BC Hydro', onClick: () => nav.draft('Pay CAD 60 to BC Hydro') },
        { key: 'phone', text: '话费 Northline Mobile', onClick: () => nav.draft('Pay CAD 55 to Northline Mobile') },
      ],
      onAction: () => handler.close(),
    });
  };

  const cred = o?.credit && o.credit.has_card ? o.credit : null;
  const dining = o?.budget.categories.find((c) => c.category === 'dining' && c.over_budget);
  const overBudget = o?.budget.categories.filter((c) => c.over_budget).length ?? 0;
  const next = o?.tuition.installments[0];
  const awaitingDad = o?.pending.filter((a) => a.status === 'awaiting_sponsor').length ?? 0;

  const notices = useMemo(() => {
    const n: { text: string; en: string; onTap: () => void; tone: string }[] = [];
    if (next)
      n.push({
        text: `学费 ${zhDate(next.due)}到期${o && o.tuition.next_shortfall_cad > 0 ? ` · 还差 ${amount(o.tuition.next_shortfall_cad, 0)}` : ''}`,
        en: `Tuition due ${enDate(next.due)}`,
        tone: 'orange',
        onTap: () => nav.ask('When is my tuition due?'),
      });
    if (f?.first_shortfall_date)
      n.push({
        text: `${zhDate(f.first_shortfall_date)} 日常账户或透支`,
        en: `Runs short ${enDate(f.first_shortfall_date)}`,
        tone: 'red',
        onTap: () => nav.ask('Will I run out of money before tuition is due?'),
      });
    if (cred?.statement)
      n.push({
        text: `信用卡 ${zhDate(cred.statement.due_date)}还款 ${amount(cred.statement.remaining)}`,
        en: `Card due ${enDate(cred.statement.due_date)}`,
        tone: 'blue',
        onTap: () => nav.ask("How's my credit?"),
      });
    if (dining && dining.budget_cad)
      n.push({
        text: `餐饮超支 ${Math.round((dining.spent_cad / dining.budget_cad - 1) * 100)}%`,
        en: 'Dining over budget',
        tone: 'orange',
        onTap: () => nav.ask('How is my budget this month?'),
      });
    if (o?.budget.possible_duplicate_charges.length)
      n.push({
        text: `${o.budget.possible_duplicate_charges[0]} 疑似重复扣款`,
        en: 'Possible duplicate charge',
        tone: 'red',
        onTap: () => nav.ask('Show my recent transactions'),
      });
    if (awaitingDad) n.push({ text: `${awaitingDad} 笔待爸爸批准`, en: 'Awaiting Dad', tone: 'blue', onTap: () => nav.go('wallet') });
    return n;
  }, [o, f, cred, dining, next, awaitingDad, nav]);

  const tiles: Tile[] = [
    { zh: '学费', en: 'Tuition', Icon: CalendarOutline, color: 'orange', badge: next ? `${next.days_until_due}天` : undefined, onTap: () => nav.ask('When is my tuition due?') },
    { zh: '信用', en: 'Credit', Icon: CompassOutline, color: 'blue', badge: cred && cred.utilization_pct > cred.target_pct ? Badge.dot : undefined, onTap: () => nav.ask("How's my credit?") },
    { zh: '防骗', en: 'Scam check', Icon: CheckShieldOutline, color: 'red', onTap: () => nav.ask(SCAM_SAMPLE) },
    { zh: '账单', en: 'Bills', Icon: BillOutline, color: 'cyan', badge: cred?.statement ? '1' : undefined, onTap: () => nav.ask('Pay my card') },
    { zh: '预算', en: 'Budget', Icon: PieOutline, color: 'green', badge: overBudget ? Badge.dot : undefined, onTap: () => nav.ask('How is my budget this month?') },
    { zh: frozen ? '解冻' : '冻结', en: frozen ? 'Unlock' : 'Lock', Icon: frozen ? UnlockOutline : LockOutline, color: frozen ? 'red' : 'slate', badge: frozen ? '锁' : undefined, onTap: lock },
    {
      zh: '爸爸',
      en: 'Sponsor',
      Icon: TeamOutline,
      color: 'purple',
      badge: awaitingDad ? String(awaitingDad) : undefined,
      onTap: () =>
        Dialog.confirm({
          getContainer: phone,
          title: '切换到爸爸视角？',
          content: 'Switch to the sponsor (Encik Rahman) view. 演示用：真实应用中爸爸用自己的手机登录。In the real app Dad signs in on his own phone.',
          confirmText: '切换 Switch',
          cancelText: '取消',
          onConfirm: () => nav.setRole('sponsor'),
        }),
    },
    { zh: '明细', en: 'Ledger', Icon: UnorderedListOutline, color: 'blue', onTap: () => nav.ask('Show my recent transactions') },
    { zh: '跑道', en: 'Runway', Icon: HistogramOutline, color: 'orange', badge: f?.first_shortfall_date ? Badge.dot : undefined, onTap: () => nav.ask('Will I run out of money before tuition is due?') },
    { zh: '汇率', en: 'FX rates', Icon: GlobalOutline, color: 'teal', onTap: () => nav.ask('Is now a good time to convert MYR to CAD?') },
  ];

  const banners = [
    {
      cls: 'bn-orange',
      zh: '换汇省 CAD 95',
      en: 'Wallet FX: 0.6% true cost vs 6.5% at the airport (MYR 5,000)',
      cta: '比价 Compare',
      Icon: LoopOutline,
      onTap: () => nav.ask('Cheapest way to change 5,000 MYR to CAD?'),
    },
    {
      cls: 'bn-red',
      zh: '防骗中心 · 粘贴即查',
      en: 'Got a "CRA" text asking for gift cards? Check it first',
      cta: '去检测 Check',
      Icon: ExclamationShieldFill,
      onTap: () => nav.ask(SCAM_SAMPLE),
    },
    {
      cls: 'bn-blue',
      zh: '信用成长计划',
      en: 'Keep reported utilization under 30% before Oct 23',
      cta: '看建议 Tips',
      Icon: CompassOutline,
      onTap: () => nav.ask("How's my credit?"),
    },
  ];

  return (
    <div className="home">
      <header className="hd-blue">
        <div className="hd-row">
          <button className="loc" onClick={() => toast.info('温哥华 Vancouver · UBC')}>
            温哥华 <DownFill fontSize={8} />
          </button>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) nav.ask(q);
            }}
          >
            <SearchOutline fontSize={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="问问助手：交房租 / 换汇 / 学费…" aria-label="Search or ask" />
            <button type="submit" className="search-btn">
              搜索
            </button>
          </form>
          <button className="hd-ic" onClick={() => toast.info('扫一扫（演示未启用）Scan not in demo')} aria-label="Scan">
            <ScanCodeOutline fontSize={22} />
          </button>
          <button className="hd-ic" onClick={() => nav.ask('Will I run out of money before tuition is due?')} aria-label="Alerts">
            <Badge content={notices.length || undefined}>
              <BellOutline fontSize={22} />
            </Badge>
          </button>
        </div>
        <div className="hero4">
          {[
            { zh: '转账', en: 'Pay', Icon: SendOutline, onTap: payees },
            { zh: '换汇', en: 'Convert', Icon: LoopOutline, onTap: () => nav.ask('Cheapest way to change 5,000 MYR to CAD?') },
            { zh: '找爸爸', en: 'Ask Dad', Icon: CollectMoneyOutline, onTap: () => nav.draft('Ask my dad for CAD 300 for textbooks') },
            { zh: '卡包', en: 'Cards', Icon: BankcardOutline, onTap: () => nav.go('wallet') },
          ].map((h) => (
            <button key={h.en} className="hero" onClick={h.onTap}>
              <h.Icon fontSize={30} />
              <span>{h.zh}</span>
              <small>{h.en}</small>
            </button>
          ))}
        </div>
      </header>

      <div className="home-body">
        {frozen && (
          <button className="frozen-bar" onClick={lock}>
            <LockOutline /> 支付已冻结 · Payments locked
            <span>
              解冻 Unlock <RightOutline fontSize={10} />
            </span>
          </button>
        )}

        <div className="bal">
          <div className="bal-top">
            <span className="bal-l">
              总资产 Total (CAD)
              <button onClick={toggle} aria-label={hidden ? 'Show balances' : 'Hide balances'} className="eye">
                {hidden ? <EyeInvisibleOutline /> : <EyeOutline />}
              </button>
            </span>
            <DemoChip />
            <button className="bal-x" onClick={() => nav.ask('How much money do I have?')}>
              明细 <RightOutline fontSize={10} />
            </button>
          </div>
          {o ? (
            <>
              <div className="bal-v">
                <Amt n={o.total_cad} />
              </div>
              <div className="bal-accts">
                {o.accounts.map((a) => (
                  <div key={a.id}>
                    <small>
                      {ACCOUNT_ZH[a.label] ?? a.label}
                      {a.sponsor_funded ? <i className="sf">资</i> : null}
                    </small>
                    <Amt n={a.balance} d={0} cur={a.currency === 'MYR' ? 'RM' : '$'} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Skeleton.Paragraph lineCount={2} animated />
          )}
        </div>

        <Ticker items={notices} />

        <div className="card-grid">
          <TileGrid tiles={tiles} />
        </div>

        {f && (f.first_shortfall_date || f.tuition.some((t) => t.gap > 0)) && (
          <div className="alert-card">
            <div className="alert-h">
              <span className="alert-t">
                <ExclamationShieldFill /> 资金预警 <small>Runway alert</small>
              </span>
              <span className="alert-src">AI 预测 · 不动钱 forecast only</span>
            </div>
            <div className="alert-kv">
              {f.first_shortfall_date ? (
                <div>
                  <b className="num c-red">{zhDate(f.first_shortfall_date)}</b>
                  <small>日常账户见底 Runs short</small>
                </div>
              ) : null}
              {f.tuition
                .filter((t) => t.gap > 0)
                .map((t) => (
                  <div key={t.due}>
                    <b className="num c-orange">{amount(t.gap, 0)}</b>
                    <small>学费缺口 Gap · {enDate(t.due)}</small>
                  </div>
                ))}
              <div>
                <b className="num">{amount(f.weekly_spending_cad, 0)}</b>
                <small>周支出 /week</small>
              </div>
            </div>
            <RunwayChart c={f} height={84} />
            <div className="alert-btns">
              <button onClick={() => nav.ask('Will I run out of money before tuition is due?')}>问助手 Ask why</button>
              <button className="pri" onClick={() => nav.ask('Cover the tuition shortfall from my MYR wallet')}>
                一键补足 Cover gap
              </button>
            </div>
          </div>
        )}

        <Swiper autoplay loop autoplayInterval={4500} className="banners" indicatorProps={{ color: 'white' }}>
          {banners.map((b) => (
            <Swiper.Item key={b.zh}>
              <button className={`banner ${b.cls}`} onClick={b.onTap}>
                <span className="bn-txt">
                  <b>{b.zh}</b>
                  <small>{b.en}</small>
                  <span className="bn-cta">{b.cta}</span>
                </span>
                <b.Icon fontSize={64} />
              </button>
            </Swiper.Item>
          ))}
        </Swiper>

        <Section zh="为你推荐" en="For you · mini-programs">
          <div className="mini4">
            <button className="mini" onClick={() => nav.ask('When is my tuition due?')}>
              <span className="mini-t">
                <i className="ic-orange">
                  <CalendarOutline />
                </i>
                学费倒计时
              </span>
              <b className="num">
                {next?.days_until_due ?? '–'}
                <small>天</small>
              </b>
              <span className="mini-s">{next ? `${zhDate(next.due)} · 差 ${amount(o?.tuition.next_shortfall_cad ?? 0, 0)}` : 'Tuition'}</span>
            </button>
            <button className="mini" onClick={() => nav.ask('Cheapest way to change 5,000 MYR to CAD?')}>
              <span className="mini-t">
                <i className="ic-teal">
                  <GlobalOutline />
                </i>
                MYR→CAD
              </span>
              <b className="num">{o?.rates['MYR/CAD'] ?? '–'}</b>
              <span className="mini-s">中间价 · 钱包换汇损耗 0.6%</span>
            </button>
            <button className="mini" onClick={() => nav.ask("How's my credit?")}>
              <span className="mini-t">
                <i className="ic-blue">
                  <CompassOutline />
                </i>
                信用成长
              </span>
              <b className={`num ${cred && cred.utilization_pct > cred.target_pct ? 'c-red' : ''}`}>
                {cred ? Math.round(cred.utilization_pct) : '–'}
                <small>%</small>
              </b>
              <span className="mini-s">利用率 · 目标 &lt;{cred?.target_pct ?? 30}%</span>
            </button>
            <button className="mini" onClick={() => nav.ask('How is my budget this month?')}>
              <span className="mini-t">
                <i className="ic-green">
                  <PieOutline />
                </i>
                近30天支出
              </span>
              <b className="num">{o ? <Amt n={o.budget.total_spent_cad} d={0} /> : '–'}</b>
              <span className="mini-s">{overBudget ? `${overBudget} 项超支 over budget` : '预算正常'}</span>
            </button>
          </div>
        </Section>

        {o && o.pending.length > 0 && (
          <Section zh="待处理" en={`Pending · ${o.pending.length}`} extra="全部" onExtra={() => nav.go('wallet')}>
            <div className="rows">
              {o.pending.map((a) => {
                const [szh, tone] = STATUS_ZH[a.status] ?? [a.status, 'default'];
                return (
                  <button className="row row-btn" key={a.action_id} onClick={() => nav.go('wallet')}>
                    <div className="row-l">
                      <span className="row-t">{a.summary}</span>
                      <span className="row-s">
                        {a.tier} · {money(a.params.amount ?? 0, a.params.currency ?? a.params.from_currency ?? 'CAD')}
                      </span>
                    </div>
                    <Pill tone={tone === 'primary' ? 'blue' : tone === 'warning' ? 'orange' : 'default'}>{szh}</Pill>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <div className="trust">
          <CheckShieldFill />
          <span>
            AI 只能草拟，每笔付款由您亲自确认 · 大额需爸爸批准 · 审计链防篡改
            <small>The AI drafts; you confirm every payment, Dad approves large ones, every step is hash-chained.</small>
          </span>
        </div>
      </div>
    </div>
  );
}
