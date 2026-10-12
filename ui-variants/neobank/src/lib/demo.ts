// Offline replay of fixtures captured from the real backend (scripts/capture_fixtures.py). It keeps
// a little state so the demo flows still work end to end: confirming a payment moves money, a T3
// payment lands in the sponsor's queue, approving executes it (or fails, exactly as the server would,
// when the account is short), and the locks behave like the server's.
import auditFx from '../fixtures/audit.json';
import auditStudentFx from '../fixtures/audit_student.json';
import verifyFx from '../fixtures/audit_verify.json';
import chatsFx from '../fixtures/chats.json';
import forecastFx from '../fixtures/forecast.json';
import overviewFx from '../fixtures/overview.json';
import sponsorOverviewFx from '../fixtures/sponsor_overview.json';
import sponsorQueueFx from '../fixtures/sponsor_queue.json';
import { DEMO_PIN, type Backend } from './api';
import type { Action, AuditEntry, ChatResponse, ForecastCard, FreezeState, Overview, Role, SponsorOverview } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Date.now() / 1000;

type ChatFixture = { key: string; message: string; response: ChatResponse };
const CHATS = chatsFx as unknown as ChatFixture[];

// Which captured answer a free-typed message maps to. Order matters: the first match wins.
const ROUTES: [RegExp, string][] = [
  [/scam|gift ?card|\bcra\b|arrest|warrant|is this (real|legit)|诈骗/i, 'scam'],
  [/cover|shortfall|top ?up the tuition/i, 'cover'],
  [/[一-鿿]/, 'zh_runway'],
  [/run out|runway|last until|enough|forecast|before tuition/i, 'runway'],
  [/credit|utili[sz]ation|card/i, 'credit'],
  [/rent|landlord/i, 'rent'],
  [/tuition/i, 'tuition'],
  [/cheap|convert|exchange|change .*(myr|cad)|\bfx\b|rate/i, 'fx'],
  [/transaction|spent|spending|history|statement/i, 'transactions'],
  [/balance|how much|money do i have|total/i, 'balance'],
];

const FALLBACK: ChatResponse = {
  reply:
    "I'm running on demo data because the HomeBridge server isn't reachable, so I can only answer the questions shown below. Start the backend on port 8000 for the full assistant.",
  actions: [],
  cards: [],
  guard: { flags: [] },
};

function hex(n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function createDemoBackend(): Backend {
  const overview = clone(overviewFx) as unknown as Overview;
  const forecast = clone(forecastFx) as unknown as ForecastCard;
  const sponsorBase = clone(sponsorOverviewFx) as unknown as SponsorOverview;
  // Each role sees its own slice of the audit log (the sponsor never sees the student's chat).
  const audits: Record<Role, AuditEntry[]> = { sponsor: clone(auditFx.entries) as AuditEntry[], student: clone(auditStudentFx.entries) as AuditEntry[] };
  const actions = new Map<string, Action & { confirm_token?: string }>();
  let counter = 0;

  // The captured overview predates the fixture confirmations; replay the same history here so the
  // student's and the sponsor's views agree: rent was paid, tuition is waiting for Dad.
  for (const a of clone(sponsorQueueFx.actions) as unknown as Action[]) actions.set(a.action_id, a);
  for (const a of clone(sponsorBase.recent)) if (!actions.has(a.action_id)) actions.set(a.action_id, a);
  for (const a of actions.values()) if (a.status === 'executed') applyMoney(a);
  for (const a of actions.values()) if (a.status === 'awaiting_sponsor') a.expires_at = nowS() + 86400;

  const freeze: FreezeState = clone(overview.freeze);

  function account(id: string) {
    return overview.accounts.find((a) => a.id === id);
  }
  function retotal() {
    const r = overview.rates['MYR/CAD'] ?? 0.3236;
    overview.total_cad = Math.round(overview.accounts.reduce((s, a) => s + (a.currency === 'MYR' ? a.balance * r : a.balance), 0) * 100) / 100;
  }
  function applyMoney(a: Action) {
    const p = a.params;
    if (a.kind === 'transfer') {
      const acc = account(p.from_account_id);
      if (acc) acc.balance = Math.round((acc.balance - p.amount) * 100) / 100;
    } else if (a.kind === 'conversion') {
      const from = account(p.from_account_id);
      const to = account(p.to_account_id);
      if (from) from.balance = Math.round((from.balance - p.amount) * 100) / 100;
      if (to) to.balance = Math.round((to.balance + p.expected_receive) * 100) / 100;
      if (to?.id === 'acc_tui') {
        overview.tuition.tuition_fund_cad = to.balance;
        overview.tuition.next_shortfall_cad = Math.max(0, Math.round((overview.tuition.installments[0].amount - to.balance) * 100) / 100);
      }
    }
    retotal();
  }
  function shortOf(a: Action): string | null {
    const acc = account(a.params.from_account_id);
    if (!acc || (a.kind !== 'transfer' && a.kind !== 'conversion')) return null;
    return acc.balance < a.params.amount ? `Insufficient funds in ${acc.label}: balance ${acc.balance} ${acc.currency}` : null;
  }
  function lockFor(a: Action): string | null {
    const acc = account(a.params.from_account_id);
    if (!acc) return null;
    const by = acc.sponsor_funded ? freeze.sponsor_funded : freeze.own;
    if (!by) return null;
    return `Payments are locked: ${by === 'sponsor' ? 'the sponsor' : 'Aisha'} locked payments from ${acc.label}`;
  }
  function present(a: Action): Action {
    const d = clone(a);
    if (['awaiting_user', 'awaiting_sponsor'].includes(d.status)) {
      d.warnings = d.warnings.filter((w) => !w.includes('lower than this amount'));
      const acc = account(d.params.from_account_id);
      if (acc && acc.balance < d.params.amount)
        d.warnings.push(`Balance in ${acc.label} is lower than this amount right now; it will fail unless topped up first.`);
      d.frozen = lockFor(d);
    }
    return d;
  }
  function record(event: string, actor: string, data: Record<string, unknown>, roles: Role[] = ['student', 'sponsor']) {
    for (const r of roles) {
      const log = audits[r];
      const prev = log[log.length - 1];
      log.push({ seq: (prev?.seq ?? -1) + 1, ts: nowS(), event, actor, data, prev: prev?.hash ?? '0'.repeat(64), hash: hex(64) });
    }
  }
  function checkPin(pin: string) {
    if (pin !== DEMO_PIN) throw new Error('Wrong PIN. Nothing was changed.');
  }
  // Data minimisation, as on the server: the sponsor sees what he funds and what is sent to him.
  function sponsorSees(a: Action) {
    return a.needs_sponsor_approval || Boolean(account(a.params.from_account_id)?.sponsor_funded);
  }
  function get(id: string) {
    const a = actions.get(id);
    if (!a) throw new Error('No such action');
    return a;
  }
  function setFreeze(own: FreezeState['own'], funded: FreezeState['sponsor_funded']) {
    freeze.own = own;
    freeze.sponsor_funded = funded;
    freeze.frozen = Boolean(own || funded);
    freeze.since = freeze.frozen ? (freeze.since ?? nowS()) : null;
  }

  return {
    mode: 'demo',
    async overview() {
      await wait(120);
      const pending = [...actions.values()].filter((a) => ['awaiting_user', 'awaiting_sponsor'].includes(a.status)).map(present);
      return clone({ ...overview, pending, freeze });
    },
    async forecast() {
      await wait(80);
      return clone(forecast);
    },
    async actions() {
      return { actions: [...actions.values()].map((a) => ({ ...present(a), confirm_token: a.confirm_token })) };
    },
    async chat(message) {
      const key = ROUTES.find(([re]) => re.test(message))?.[1];
      const fx = CHATS.find((c) => c.key === key);
      await wait(700 + Math.random() * 500);
      record('user_message', 'aisha', { chars: message.length }, ['student']);
      if (!fx) return clone(FALLBACK);
      const res = clone(fx.response);
      res.actions = res.actions.map((a) => {
        const id = `${a.action_id}_${++counter}`;
        const fresh = { ...a, action_id: id, created_at: nowS(), expires_at: nowS() + 600, confirm_token: hex(32) };
        actions.set(id, fresh);
        record('action_drafted', 'aisha', { action_id: id, kind: a.kind, tier: a.tier });
        return present(fresh);
      });
      return res;
    },
    async confirm(id, token) {
      await wait(650);
      const a = get(id);
      if (a.status !== 'awaiting_user') throw new Error(`Action is already ${a.status}.`);
      if (token !== a.confirm_token) throw new Error('Confirmation token is not valid.');
      if (nowS() > a.expires_at) {
        a.status = 'expired';
        throw new Error('This draft expired. Ask again to redraft it.');
      }
      const lock = lockFor(a);
      if (lock) throw new Error(`${lock}. Nothing was sent.`);
      a.user_confirmed = true;
      record('action_confirmed', 'aisha', { action_id: id });
      if (a.needs_sponsor_approval) {
        a.status = 'awaiting_sponsor';
        a.expires_at = nowS() + 86400;
        record('sponsor_approval_requested', 'system', { action_id: id });
      } else {
        const short = shortOf(a);
        if (short) {
          a.status = 'failed';
          a.result = { error: short };
        } else {
          a.status = 'executed';
          a.result = { ok: true };
          applyMoney(a);
          record('action_executed', 'system', { action_id: id, kind: a.kind });
        }
      }
      return present(a);
    },
    async cancel(id) {
      await wait(250);
      const a = get(id);
      a.status = 'cancelled';
      record('action_cancelled', 'aisha', { action_id: id });
      return present(a);
    },
    async freeze() {
      await wait(300);
      setFreeze(freeze.own ?? 'student', freeze.sponsor_funded ?? 'student');
      record('freeze', 'aisha', { scope: 'all' });
      return { freeze: clone(freeze) };
    },
    async unfreeze() {
      await wait(300);
      setFreeze(freeze.own === 'student' ? null : freeze.own, freeze.sponsor_funded === 'student' ? null : freeze.sponsor_funded);
      record('unfreeze', 'aisha', {});
      const note = freeze.sponsor_funded ? 'Money your sponsor funds stays locked until your sponsor unlocks it.' : '';
      return { freeze: clone(freeze), note };
    },
    async sponsorOverview() {
      await wait(120);
      const all = [...actions.values()];
      const recent = all.filter(sponsorSees).map(present).slice(-10);
      const funded = overview.accounts.filter((a) => a.sponsor_funded);
      const r = overview.rates['MYR/CAD'] ?? 0.3236;
      const executed = all.filter((a) => a.status === 'executed');
      return clone({
        ...sponsorBase,
        accounts: funded,
        total_cad: Math.round(funded.reduce((s, a) => s + (a.currency === 'MYR' ? a.balance * r : a.balance), 0) * 100) / 100,
        recent,
        freeze,
        digest: {
          ...sponsorBase.digest,
          drafted: all.length,
          executed: executed.length,
          awaiting_sponsor: all.filter((a) => a.status === 'awaiting_sponsor').length,
          stopped: all.filter((a) => ['rejected', 'cancelled', 'failed', 'expired'].includes(a.status)).length,
          money_out_cad: executed.filter((a) => a.kind === 'transfer' && sponsorSees(a)).reduce((s, a) => s + a.params.amount, 0),
          frozen: freeze.frozen,
        },
      });
    },
    async sponsorQueue() {
      await wait(100);
      return { actions: [...actions.values()].filter((a) => a.status === 'awaiting_sponsor').map(present) };
    },
    async approve(id, _note, pin) {
      checkPin(pin);
      await wait(800);
      const a = get(id);
      if (a.status !== 'awaiting_sponsor') throw new Error(`Action is ${a.status}, not awaiting sponsor approval.`);
      const lock = lockFor(a);
      if (lock) throw new Error(`${lock}. Unlock payments before approving, or reject it.`);
      a.sponsor_decision = 'approved';
      record('sponsor_approved', 'rahman', { action_id: id });
      const short = shortOf(a);
      if (short) {
        a.status = 'failed';
        a.result = { error: short };
        record('action_failed', 'system', { action_id: id, error: short });
      } else {
        a.status = 'executed';
        a.result = { ok: true };
        applyMoney(a);
        record('action_executed', 'system', { action_id: id, kind: a.kind });
      }
      return present(a);
    },
    async reject(id, note) {
      await wait(400);
      const a = get(id);
      a.status = 'rejected';
      a.sponsor_decision = 'rejected';
      a.sponsor_note = note;
      record('sponsor_rejected', 'rahman', { action_id: id, note });
      return present(a);
    },
    async sponsorFreeze(scope) {
      await wait(300);
      setFreeze(scope === 'all' ? 'sponsor' : freeze.own, 'sponsor');
      record('freeze', 'rahman', { scope });
      return { freeze: clone(freeze) };
    },
    async sponsorUnfreeze(pin) {
      await wait(300);
      checkPin(pin);
      setFreeze(null, null);
      record('unfreeze', 'rahman', {});
      return { freeze: clone(freeze) };
    },
    async setLimits(single_cad, daily_cad, pin) {
      await wait(300);
      const ceiling = sponsorBase.kyc?.limit_ceiling;
      if (ceiling && (single_cad > ceiling.single_cad || daily_cad > ceiling.daily_cad))
        throw new Error(`Aisha's identity check allows at most CAD ${ceiling.single_cad.toLocaleString()} per payment and CAD ${ceiling.daily_cad.toLocaleString()} per 24 hours.`);
      checkPin(pin);
      if (single_cad > daily_cad) throw new Error('The single-payment limit cannot be higher than the 24-hour limit.');
      overview.limits = { single_cad, daily_cad };
      sponsorBase.limits = { ...sponsorBase.limits, single_cad, daily_cad };
      record('limits_changed', 'rahman', { single_cad, daily_cad });
      return { limits: sponsorBase.limits };
    },
    async audit(role: Role) {
      await wait(80);
      return { entries: clone(audits[role]) };
    },
    async auditVerify(role: Role, tamperSeq?: number) {
      await wait(350);
      const log = audits[role];
      if (tamperSeq !== undefined) return { ok: false, count: log.length, broken_at: tamperSeq, simulated_tamper_seq: tamperSeq };
      return { ...verifyFx, count: log.length, head: log[log.length - 1]?.hash ?? verifyFx.head };
    },
    async reset() {
      return { ok: true };
    },
  };
}
