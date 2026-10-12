// Offline fallback: answers API calls from fixtures captured from the real backend, with a little
// in-memory state so the demo flow (draft -> confirm -> Dad approves, lock/unlock) still works.
import chatFx from './fixtures/chat.json';
import confirmedFx from './fixtures/confirmed.json';
import forecastFx from './fixtures/forecast.json';
import overviewFx from './fixtures/overview.json';
import sponsorOverviewFx from './fixtures/sponsor_overview.json';
import sponsorQueueFx from './fixtures/sponsor_queue.json';
import type { Action, ChatResponse, FreezeState, Overview, Role, SponsorOverview } from './types';

type ChatFixture = { message: string; response: ChatResponse };
const CHATS = chatFx as unknown as ChatFixture[];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const now = () => Date.now() / 1000;

function initial() {
  const queue = clone((sponsorQueueFx as unknown as { actions: Action[] }).actions).map((a) => ({
    ...a,
    created_at: now() - 1800,
    expires_at: now() + 86400,
  }));
  return {
    overview: clone(overviewFx as unknown as Overview),
    actions: queue as Action[],
    freeze: { frozen: false, own: null, sponsor_funded: null, since: null } as FreezeState,
    limits: { single_cad: 1500, daily_cad: 3000 },
    seq: 0,
    audit: 42,
  };
}
let S = initial();

const freezeState = (): FreezeState => {
  const f = S.freeze;
  const frozen = !!(f.own || f.sponsor_funded);
  return { ...f, frozen, since: frozen ? f.since ?? now() : null };
};

function frozenReason(a: Action): string | null {
  const f = freezeState();
  const sponsorMoney = a.params.from_account_id !== 'acc_cad' || a.kind === 'topup';
  if (f.own || (sponsorMoney && f.sponsor_funded)) return `payments were locked by ${f.own ?? f.sponsor_funded}`;
  return null;
}
const present = (a: Action): Action => ({ ...a, frozen: ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? frozenReason(a) : null });

// Keyword routing to the captured conversations (exact text first).
const ROUTES: [RegExp, string][] = [
  [/scam|诈骗|骗|gift card|CRA/i, "Is this a scam?"],
  [/够用|学期末|end of term/i, '我的钱够用到学期末吗？'],
  [/run out|runway|before tuition|跑道|够不够|余额预警/i, 'Will I run out of money before tuition is due?'],
  [/shortfall|cover|补足|缺口/i, 'Cover the tuition shortfall from my MYR wallet'],
  [/dad|sponsor|爸爸|top.?up|要钱/i, 'Ask my dad for CAD 300 for textbooks'],
  [/good time|rate (history|trend)|汇率走势|汇率/i, 'Is now a good time to convert MYR to CAD?'],
  [/cheapest|change|convert|换汇|换钱|MYR.*CAD/i, 'Cheapest way to change 5,000 MYR to CAD?'],
  [/pay (my )?(card|credit)|还款|还信用卡/i, 'Pay my card'],
  [/credit|信用/i, "How's my credit?"],
  [/rent|房租|landlord/i, 'Pay rent to my landlord'],
  [/pay.*tuition|交学费|缴学费/i, 'Pay my spring tuition'],
  [/tuition|学费/i, 'When is my tuition due?'],
  [/budget|预算|spend|支出/i, 'How is my budget this month?'],
  [/transaction|明细|ledger|账单|history/i, 'Show my recent transactions'],
  [/how much|balance|多少钱|余额|总资产/i, 'How much money do I have?'],
];

function findChat(message: string): ChatFixture | undefined {
  const exact = CHATS.find((c) => c.message.trim().toLowerCase() === message.trim().toLowerCase());
  if (exact) return exact;
  for (const [re, key] of ROUTES) if (re.test(message)) return CHATS.find((c) => c.message.startsWith(key));
  return undefined;
}

function chat(message: string): ChatResponse {
  const fx = findChat(message);
  if (!fx)
    return {
      reply:
        '演示模式只能回答示例问题。Demo mode (server offline): try a suggested prompt such as "How much money do I have?" or "Pay rent to my landlord".',
      cards: [],
      actions: [],
      guard: { flags: [] },
      provider: 'fixtures',
      fallback: true,
    };
  const r = clone(fx.response);
  r.actions = r.actions.map((a) => {
    const id = `${a.action_id}-${++S.seq}`;
    const drafted: Action = { ...a, action_id: id, created_at: now(), expires_at: now() + 600, confirm_token: 'offline-token' };
    S.actions.push(drafted);
    return present(drafted);
  });
  return { ...r, provider: 'fixtures' };
}

function find(id: string): Action {
  const a = S.actions.find((x) => x.action_id === id);
  if (!a) throw new Error('No such action.');
  return a;
}

function settle(a: Action) {
  a.status = 'executed';
  const acc = S.overview.accounts.find((x) => x.id === a.params.from_account_id);
  if (a.kind === 'transfer' && acc) {
    if (acc.balance < a.params.amount) {
      a.status = 'failed';
      a.result = { error: `Insufficient funds in ${acc.label}.` };
      return;
    }
    acc.balance = Math.round((acc.balance - a.params.amount) * 100) / 100;
    a.result = { new_balance: acc.balance };
  } else if (a.kind === 'conversion' && acc) {
    const to = S.overview.accounts.find((x) => x.id === a.params.to_account_id);
    acc.balance -= a.params.amount;
    if (to) to.balance = Math.round((to.balance + a.params.expected_receive) * 100) / 100;
    a.result = { new_balance: acc.balance };
  } else if (a.kind === 'topup') {
    const cad = S.overview.accounts.find((x) => x.id === 'acc_cad');
    if (cad) cad.balance += a.params.amount;
  }
}

function confirm(id: string): Action {
  const a = find(id);
  if (a.status !== 'awaiting_user') throw new Error('This action is no longer waiting for you.');
  if (frozenReason(a)) throw new Error('Payments are locked.');
  if (a.expires_at < now()) {
    a.status = 'expired';
    throw new Error('This confirmation expired. Ask again to draft it.');
  }
  a.user_confirmed = true;
  if (a.needs_sponsor_approval) a.status = 'awaiting_sponsor';
  else settle(a);
  const captured = (confirmedFx as Record<string, Action>)[id.replace(/-\d+$/, '')];
  if (captured && a.status === 'awaiting_sponsor') a.next_step = captured.next_step;
  return present(a);
}

function decide(id: string, approve: boolean, note: string): Action {
  const a = find(id);
  if (a.status !== 'awaiting_sponsor') throw new Error('This request is not waiting for you.');
  if (approve && frozenReason(a)) throw new Error('Payments are locked.');
  a.sponsor_decision = approve ? 'approved' : 'rejected';
  a.sponsor_note = note;
  if (approve) settle(a);
  else a.status = 'rejected';
  return present(a);
}

function totalCad() {
  const r = S.overview.rates['MYR/CAD'] ?? 0.3236;
  return Math.round(S.overview.accounts.reduce((s, a) => s + a.balance * (a.currency === 'MYR' ? r : 1), 0) * 100) / 100;
}

export async function offline<T>(_role: Role, path: string, method: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, method === 'POST' && path === '/chat' ? 450 : 120));
  const b = (body ?? {}) as Record<string, any>;
  const m = path.match(/^\/(sponsor\/)?actions\/([^/]+)\/(confirm|cancel|approve|reject)$/);
  // Mirrors the server: Approve, Unlock and limit changes need the sponsor PIN.
  if ((m?.[3] === 'approve' || path === '/sponsor/unfreeze' || path === '/sponsor/limits') && b.pin !== '246810')
    throw new Error('PIN 错误 Wrong PIN');
  let out: unknown;
  if (path === '/health') out = { ok: true, provider: 'fixtures', demo_mode: true };
  else if (path === '/overview') {
    out = {
      ...S.overview,
      total_cad: totalCad(),
      freeze: freezeState(),
      pending: S.actions.filter((a) => ['awaiting_user', 'awaiting_sponsor'].includes(a.status)).map(present),
    };
  } else if (path === '/forecast') out = clone(forecastFx);
  else if (path === '/actions') out = { actions: S.actions.map(present) };
  else if (path === '/chat') out = chat(String(b.message ?? ''));
  else if (m && m[3] === 'confirm') out = confirm(m[2]);
  else if (m && m[3] === 'cancel') {
    const a = find(m[2]);
    a.status = 'cancelled';
    out = present(a);
  } else if (m && m[3] === 'approve') out = decide(m[2], true, b.note ?? '');
  else if (m && m[3] === 'reject') out = decide(m[2], false, b.note ?? '');
  else if (path === '/freeze') {
    S.freeze.own = S.freeze.own ?? 'student';
    S.freeze.sponsor_funded = S.freeze.sponsor_funded ?? 'student';
    S.freeze.since = now();
    out = { freeze: freezeState() };
  } else if (path === '/unfreeze') {
    if (S.freeze.own === 'sponsor') throw new Error('Your sponsor locked your payments, so only they can unlock them.');
    S.freeze.own = null;
    const st = freezeState();
    out = { freeze: st, note: st.sponsor_funded ? 'Money your sponsor funds stays locked until your sponsor unlocks it.' : '' };
  } else if (path === '/sponsor/freeze') {
    S.freeze.sponsor_funded = 'sponsor';
    if (b.scope === 'all') S.freeze.own = 'sponsor';
    S.freeze.since = now();
    out = { freeze: freezeState() };
  } else if (path === '/sponsor/unfreeze') {
    S.freeze.own = S.freeze.sponsor_funded = null;
    out = { freeze: freezeState() };
  } else if (path === '/sponsor/queue') out = { actions: S.actions.filter((a) => a.status === 'awaiting_sponsor').map(present) };
  else if (path === '/sponsor/overview') {
    const base = clone(sponsorOverviewFx as unknown as SponsorOverview);
    const recent = S.actions.slice(-10).map(present);
    out = {
      ...base,
      accounts: S.overview.accounts,
      total_cad: totalCad(),
      limits: { ...base.limits, ...S.limits },
      freeze: freezeState(),
      recent: recent.length ? recent : base.recent,
      digest: {
        ...base.digest,
        awaiting_sponsor: S.actions.filter((a) => a.status === 'awaiting_sponsor').length,
        frozen: freezeState().frozen,
      },
    };
  } else if (path === '/sponsor/limits') {
    S.limits = { single_cad: Number(b.single_cad), daily_cad: Number(b.daily_cad) };
    out = { limits: S.limits };
  } else if (path === '/audit/verify') out = { ok: true, count: S.audit + S.seq * 3, head: 'offline-fixture' };
  else if (path === '/demo/reset') {
    S = initial();
    out = { ok: true };
  } else throw new Error(`Not available offline: ${method} ${path}`);
  return out as T;
}
