// Offline sandbox used when the backend is not reachable. It starts from fixtures captured from the real
// backend (scripts/capture_fixtures.py) and mimics the server's state changes for confirm / approve /
// reject / freeze so the whole demo can be clicked through without a server.
import type {
  Account,
  Action,
  Alert,
  AuditEntry,
  AuditPage,
  ChatResponse,
  ForecastCard,
  FreezeState,
  Overview,
  Role,
  SponsorOverview,
  Verify,
} from './types';

import overviewFx from './fixtures/overview.json';
import forecastFx from './fixtures/forecast.json';
import actionsFx from './fixtures/actions.json';
import sponsorOverviewFx from './fixtures/sponsor_overview.json';
import auditFx from './fixtures/audit.json';
import chatsFx from './fixtures/chats.json';

type ChatFixture = { key: string; message: string; response: ChatResponse };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const now = () => Date.now() / 1000;
const SANDBOX_PIN = '246810'; // demo sponsor PIN, same as the backend's default
const MYR_CAD = (overviewFx as unknown as Overview).rates['MYR/CAD'] ?? 0.3236;

function fakeHash(s: string): string {
  let out = '';
  for (let seed = 0; seed < 8; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

class Sandbox {
  overview!: Overview;
  actions!: Map<string, Action>;
  audit!: AuditEntry[];
  alerts!: Alert[];
  limits!: Record<string, number>;
  seq = 0;
  pinFailures = 0;
  pinLockedUntil = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.overview = clone(overviewFx as unknown as Overview);
    this.actions = new Map();
    const t = now();
    for (const a of clone((actionsFx as unknown as { actions: Action[] }).actions)) {
      // Fixture timestamps are from capture time; shift them so countdowns read sensibly today.
      a.created_at = t - 120;
      a.expires_at = t + (a.status === 'awaiting_user' ? 540 : 86000);
      if (a.status === 'awaiting_user') a.confirm_token = 'demo-token';
      this.actions.set(a.action_id, a);
    }
    this.audit = clone((auditFx as unknown as { entries: AuditEntry[] }).entries);
    this.alerts = [];
    this.pinFailures = 0;
    this.pinLockedUntil = 0;
    this.limits = clone((sponsorOverviewFx as unknown as SponsorOverview).limits);
    this.overview.freeze = { frozen: false, own: null, sponsor_funded: null, since: null };
  }

  record(event: string, actor: string, data: Record<string, any>) {
    const prev = this.audit.length ? this.audit[this.audit.length - 1].hash : '0'.repeat(64);
    const entry: AuditEntry = { seq: this.audit.length, ts: now(), event, actor, data, prev, hash: '' };
    entry.hash = fakeHash(prev + JSON.stringify({ event, actor, data, seq: entry.seq }));
    this.audit.push(entry);
  }

  account(id: string): Account | undefined {
    return this.overview.accounts.find((a) => a.id === id);
  }

  get freeze(): FreezeState {
    return this.overview.freeze;
  }

  setFreeze(own: FreezeState['own'], funded: FreezeState['sponsor_funded']) {
    const frozen = !!(own || funded);
    this.overview.freeze = { frozen, own, sponsor_funded: funded, since: frozen ? this.freeze.since ?? now() : null };
  }

  frozenReason(a: Action): string | null {
    const s = this.freeze;
    if (!s.frozen || a.kind === 'topup') return null;
    if (a.kind === 'add_payee') return "new payees can't be approved while payments are locked";
    const acc = this.account(a.params.from_account_id);
    if (!acc) return null;
    const key = acc.sponsor_funded ? 'sponsor_funded' : 'own';
    const by = s[key];
    if (!by) return null;
    const who = by === 'sponsor' ? 'the sponsor' : 'Aisha Rahman';
    const unlock = key === 'sponsor_funded' || by === 'sponsor' ? 'only the sponsor can unlock it' : 'Aisha Rahman can unlock it in the app';
    return `${who} locked payments from ${acc.label}; ${unlock}`;
  }

  present(a: Action, withToken = false): Action {
    const out = clone(a);
    if (!withToken) delete out.confirm_token;
    out.frozen = ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? this.frozenReason(a) : null;
    if (['awaiting_user', 'awaiting_sponsor'].includes(a.status) && a.expires_at < now()) {
      a.status = 'expired';
      out.status = 'expired';
    }
    return out;
  }

  list(): Action[] {
    return [...this.actions.values()].sort((x, y) => x.created_at - y.created_at);
  }

  totalCad(): number {
    return Math.round(this.overview.accounts.reduce((s, a) => s + a.balance * (a.currency === 'MYR' ? MYR_CAD : 1), 0) * 100) / 100;
  }

  execute(a: Action) {
    const acc = this.account(a.params.from_account_id);
    const amount = Number(a.params.amount ?? 0);
    if (acc && acc.balance < amount) {
      a.status = 'failed';
      a.result = { error: `Not enough money in ${acc.label} (needs ${a.params.currency ?? acc.currency} ${amount.toFixed(2)}).` };
      this.record('action_failed', 'system', { action_id: a.action_id, reason: 'insufficient funds' });
      return;
    }
    if (acc) acc.balance = Math.round((acc.balance - amount) * 100) / 100;
    if (a.kind === 'conversion' && a.params.to_account_id) {
      const to = this.account(a.params.to_account_id);
      if (to) to.balance = Math.round((to.balance + Number(a.params.expected_receive ?? 0)) * 100) / 100;
    }
    a.status = 'executed';
    a.result = { new_balance: acc?.balance };
    this.overview.total_cad = this.totalCad();
    this.record('action_executed', 'system', { action_id: a.action_id });
  }

  // ---------------------------------------------------------------- endpoints
  getOverview(): Overview {
    const o = clone(this.overview);
    o.total_cad = this.totalCad();
    o.pending = this.list()
      .filter((a) => ['awaiting_user', 'awaiting_sponsor'].includes(a.status))
      .map((a) => this.present(a, true));
    o.limits = { single_cad: this.limits.single_cad, daily_cad: this.limits.daily_cad };
    return o;
  }

  getForecast(): ForecastCard {
    return clone(forecastFx as unknown as ForecastCard);
  }

  getActions(): { actions: Action[] } {
    return { actions: this.list().map((a) => this.present(a, true)) };
  }

  chat(message: string): ChatResponse {
    const fx = chatsFx as unknown as ChatFixture[];
    const key = routeMessage(message, fx);
    this.record('user_message', 'aisha', { chars: message.length, guard: key === 'scam' ? ['scam'] : [] });
    if (!key) {
      return {
        reply:
          "I'm running on saved demo data right now, so I can only answer the questions in the suggestions below. Start the HomeBridge backend on port 8000 for the full assistant.",
        actions: [],
        cards: [],
        guard: { flags: [] },
        provider: 'fixtures',
        fallback: true,
      };
    }
    const res = clone(fx.find((f) => f.key === key)!.response);
    res.actions = res.actions.map((a) => {
      const id = `act_demo${(++this.seq).toString().padStart(3, '0')}`;
      const fresh: Action = { ...a, action_id: id, created_at: now(), expires_at: now() + 600, confirm_token: 'demo-token' };
      this.actions.set(id, fresh);
      this.record('action_drafted', 'aisha', { action_id: id, kind: a.kind, tier: a.tier, risk: a.risk_score });
      return this.present(fresh, true);
    });
    this.record('assistant_reply', 'agent', { tools: (res.trace ?? []).map((t) => t.tool), actions: res.actions.map((a) => a.action_id) });
    return { ...res, provider: 'fixtures' };
  }

  confirm(id: string, token: string): Action {
    const a = this.actions.get(id);
    if (!a) throw new Error('No such action');
    if (a.status !== 'awaiting_user') throw new Error(`This action is ${a.status.replace('_', ' ')}.`);
    if (token !== a.confirm_token) throw new Error('Confirmation token is not valid.');
    const lock = this.frozenReason(a);
    if (lock) throw new Error(`Payments are locked: ${lock}.`);
    a.user_confirmed = true;
    delete a.confirm_token;
    this.record('action_confirmed', 'aisha', { action_id: id });
    if (a.needs_sponsor_approval) {
      a.status = 'awaiting_sponsor';
      a.expires_at = now() + 86400;
      this.record('sponsor_approval_requested', 'system', { action_id: id });
    } else {
      this.execute(a);
    }
    return this.present(a);
  }

  cancel(id: string): Action {
    const a = this.actions.get(id);
    if (!a) throw new Error('No such action');
    a.status = 'cancelled';
    this.record('action_cancelled', 'aisha', { action_id: id });
    return this.present(a);
  }

  /** Mirrors backend/app/authn.py: 5 wrong tries lock PIN approval for a while. */
  checkPin(pin: string | undefined, purpose: string) {
    if (this.pinLockedUntil > now()) {
      throw new Error(`Too many wrong PINs. PIN approval is locked for another ${Math.ceil((this.pinLockedUntil - now()) / 60)} minutes.`);
    }
    if (!pin || !/^\d{6}$/.test(pin)) throw new Error('Enter your 6-digit approval PIN.');
    if (pin === SANDBOX_PIN) {
      this.pinFailures = 0;
      return;
    }
    this.pinFailures += 1;
    this.record('sponsor_pin_failed', 'rahman', { purpose, reason: 'wrong PIN', attempts: this.pinFailures });
    if (this.pinFailures >= 5) {
      this.pinLockedUntil = now() + 300;
      this.pinFailures = 0;
      throw new Error('Wrong PIN. That was 5 wrong tries, so PIN approval is locked for 5 minutes.');
    }
    const left = 5 - this.pinFailures;
    throw new Error(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before PIN approval locks.`);
  }

  /** What the sponsor may see (data minimisation): requests sent to them and money they fund. */
  sponsorSees(a: Action): boolean {
    return a.needs_sponsor_approval || !!this.account(a.params.from_account_id)?.sponsor_funded;
  }

  decide(id: string, approve: boolean, note: string, pin?: string): Action {
    const a = this.actions.get(id);
    if (!a) throw new Error('No such action');
    if (a.status !== 'awaiting_sponsor') throw new Error(`This action is ${a.status.replace('_', ' ')}.`);
    if (approve) {
      this.checkPin(pin, `approve ${id}`);
      const lock = this.frozenReason(a);
      if (lock) throw new Error(`Payments are locked: ${lock}.`);
    }
    a.sponsor_decision = approve ? 'approved' : 'rejected';
    a.sponsor_note = note;
    this.record(approve ? 'sponsor_approved' : 'sponsor_rejected', 'rahman', { action_id: id, note });
    if (approve) this.execute(a);
    else a.status = 'rejected';
    return this.present(a);
  }

  studentFreeze(): FreezeState {
    const s = this.freeze;
    const was = s.frozen;
    this.setFreeze(s.own ?? 'student', s.sponsor_funded ?? 'student');
    this.record('payments_frozen', 'aisha', { by: 'student', scope: 'all' });
    if (!was) {
      this.alerts.unshift({
        id: `al_${Date.now()}`,
        ts: now(),
        kind: 'student_freeze',
        message: 'Aisha Rahman locked all payments, which often means a scam attempt. A call to check in is a good idea.',
        weight: 3,
      });
    }
    return this.freeze;
  }

  studentUnfreeze(): { freeze: FreezeState; note: string } {
    const s = this.freeze;
    if (s.own === 'sponsor') throw new Error('Your sponsor locked your payments, so only they can unlock them.');
    this.setFreeze(null, s.sponsor_funded);
    this.record('payments_unfrozen', 'aisha', { by: 'student', still_locked: s.sponsor_funded ? ['sponsor_funded'] : [] });
    return {
      freeze: this.freeze,
      note: this.freeze.sponsor_funded ? 'Money your sponsor funds stays locked until your sponsor unlocks it.' : '',
    };
  }

  sponsorFreeze(scope: 'sponsor_funded' | 'all'): FreezeState {
    const s = this.freeze;
    this.setFreeze(scope === 'all' ? 'sponsor' : s.own, 'sponsor');
    this.record('payments_frozen', 'rahman', { by: 'sponsor', scope });
    return this.freeze;
  }

  sponsorUnfreeze(pin: string): FreezeState {
    this.checkPin(pin, 'unfreeze');
    this.setFreeze(null, null);
    this.record('payments_unfrozen', 'rahman', { by: 'sponsor', still_locked: [] });
    return this.freeze;
  }

  setLimits(single: number, daily: number, pin: string) {
    this.checkPin(pin, 'limits');
    const before = { single_cad: this.limits.single_cad, daily_cad: this.limits.daily_cad };
    this.limits.single_cad = single;
    this.limits.daily_cad = daily;
    this.record('limits_changed', 'rahman', { before, after: { single_cad: single, daily_cad: daily } });
    return { limits: this.limits };
  }

  sponsorQueue(): { actions: Action[] } {
    return { actions: this.list().filter((a) => a.status === 'awaiting_sponsor').map((a) => this.present(a)) };
  }

  sponsorOverview(): SponsorOverview {
    const base = clone(sponsorOverviewFx as unknown as SponsorOverview);
    const acts = this.list();
    const t = now();
    const day = acts.filter((a) => t - a.created_at < 86400);
    const funded = this.overview.accounts.filter((a) => a.sponsor_funded);
    return {
      ...base,
      accounts: clone(funded),
      total_cad: Math.round(funded.reduce((s, a) => s + a.balance * (a.currency === 'MYR' ? MYR_CAD : 1), 0) * 100) / 100,
      limits: { ...this.limits },
      recent: acts.filter((a) => this.sponsorSees(a)).map((a) => this.present(a)).slice(-10),
      pin: { set: true, locked: this.pinLockedUntil > t, failures: this.pinFailures },
      freeze: { ...this.freeze },
      alerts: [...this.alerts],
      digest: {
        ...base.digest,
        drafted: day.length,
        executed: day.filter((a) => a.status === 'executed').length,
        awaiting_sponsor: day.filter((a) => a.status === 'awaiting_sponsor').length,
        stopped: day.filter((a) => ['rejected', 'cancelled', 'failed'].includes(a.status)).length,
        money_out_scope: 'sponsor_funded',
        money_out_cad: day
          .filter((a) => a.status === 'executed' && a.kind === 'transfer' && this.account(a.params.from_account_id)?.sponsor_funded)
          .reduce((s, a) => s + Number(a.params.amount ?? 0), 0),
        alerts: this.alerts.length,
        frozen: this.freeze.frozen,
      },
    };
  }

  /** Role-scoped view like GET /audit: the sponsor never sees chat or tool calls, nor drafts outside their money. */
  auditEntries(role: Role): AuditPage {
    const visibleIds = new Set(this.list().filter((a) => this.sponsorSees(a)).map((a) => a.action_id));
    const ok = (e: AuditEntry) => {
      const aid = e.data?.action_id as string | undefined;
      if (role === 'student') return !['sponsor_pin_failed', 'sponsor_pin_locked'].includes(e.event);
      if (e.actor === 'rahman') return true;
      if (['user_message', 'tool_call', 'assistant_reply'].includes(e.event)) return false;
      if (aid) return visibleIds.has(aid);
      return ['payments_frozen', 'payments_unfrozen', 'alert_raised', 'limits_changed', 'demo_reset'].includes(e.event);
    };
    const mine = this.audit.filter(ok);
    return { entries: clone(mine).slice(-200), scope: role, visible: mine.length, total: this.audit.length };
  }

  verify(tamperSeq?: number): Verify {
    const head = this.audit[this.audit.length - 1]?.hash;
    if (tamperSeq === undefined) return { ok: true, count: this.audit.length, head };
    return { ok: false, count: this.audit.length, broken_at: tamperSeq, simulated_tamper_seq: tamperSeq };
  }
}

const RULES: [RegExp, string][] = [
  [/scam|gift ?card|\bcra\b|is this real|arrest|police|text message|sms/i, 'scam'],
  [/[一-鿿]/, 'zh_runway'],
  [/run out|runway|last until|enough|forecast|end of (the )?term/i, 'runway'],
  [/credit|utili[sz]ation|secured card/i, 'credit'],
  [/cover|shortfall|top ?up/i, 'cover_gap'],
  [/pay.*tuition|tuition.*pay/i, 'tuition'],
  [/tuition|fees? due/i, 'tuition_due'],
  [/rent|landlord/i, 'rent'],
  [/convert|change|exchange|\bfx\b|rate|myr|ringgit/i, 'fx'],
  [/budget|spend|spent|over budget/i, 'budget'],
  [/transaction|history|recent|statement/i, 'transactions'],
  [/balance|how much|money do i have|account/i, 'balances'],
];

function routeMessage(message: string, fx: ChatFixture[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
  const exact = fx.find((f) => norm(f.message) === norm(message));
  if (exact) return exact.key;
  for (const [re, key] of RULES) if (re.test(message)) return key;
  return null;
}

export const sandbox = new Sandbox();

export const DEMO_PROMPTS = (chatsFx as unknown as ChatFixture[]).map((c) => c.message);
