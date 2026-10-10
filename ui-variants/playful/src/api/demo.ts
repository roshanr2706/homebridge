// Offline demo store. Built from fixtures captured from the real backend (scripts/capture_fixtures.py),
// with just enough state to walk the confirm -> Dad approves -> done flow without a server.
import auditJson from '../fixtures/audit.json';
import auditVerifyJson from '../fixtures/audit_verify.json';
import chatsJson from '../fixtures/chats.json';
import forecastJson from '../fixtures/forecast.json';
import overviewJson from '../fixtures/overview.json';
import sponsorOverviewJson from '../fixtures/sponsor_overview.json';
import sponsorQueueJson from '../fixtures/sponsor_queue.json';
import transactionsJson from '../fixtures/transactions.json';
import type { Action, AuditEntry, ChatResponse, ForecastCard, FreezeState, Overview, SponsorOverview, TransactionsCard, Verify } from './types';

export const DEMO_PIN = '246810';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const chats = chatsJson as unknown as { message: string; response: ChatResponse }[];
const now = () => Date.now() / 1000;

type Store = { actions: Action[]; freeze: FreezeState; log: AuditEntry[] };
let store: Store = fresh();

function fresh(): Store {
  // The captured sponsor queue holds the tuition payment Aisha already confirmed.
  const queued = clone((sponsorQueueJson as unknown as { actions: Action[] }).actions).map((a) => ({
    ...a,
    created_at: now() - 60 * 7,
    expires_at: now() + 60 * 60 * 24,
  }));
  return { actions: queued, freeze: clone((overviewJson as unknown as Overview).freeze), log: clone((auditJson as unknown as { entries: AuditEntry[] }).entries) };
}

function record(event: string, actor: string, data: Record<string, unknown>) {
  const last = store.log[store.log.length - 1];
  const seq = (last?.seq ?? -1) + 1;
  store.log.push({ seq, ts: now(), event, actor, data, prev: last?.hash ?? '', hash: Math.random().toString(16).slice(2).padEnd(64, '0') });
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

function find(id: string) {
  return store.actions.find((a) => a.action_id === id) ?? fail('No such action');
}

function pickChat(message: string): ChatResponse | null {
  const m = message.toLowerCase();
  const by = (i: number) => clone(chats[i].response);
  const exact = chats.findIndex((c) => c.message.toLowerCase() === m);
  if (exact >= 0) return by(exact);
  if (/[一-鿿]/.test(message)) return by(7);
  if (/scam|gift card|arrest|cra|suspicious|legit/.test(m)) return by(6);
  if (/tuition/.test(m) && /pay/.test(m)) return by(5);
  if (/rent|landlord/.test(m)) return by(4);
  if (/credit|card|streak|utili/.test(m)) return by(3);
  if (/run out|runway|forecast|last|enough|short|cheapest fix|gap|tuition/.test(m)) return by(2);
  if (/myr|cad|convert|change|exchange|rate|fx/.test(m)) return by(1);
  if (/balance|how much|money|total|have/.test(m)) return by(0);
  return null;
}

export const demo = {
  reset() {
    store = fresh();
    return { ok: true };
  },
  overview(): Overview {
    const o = clone(overviewJson as unknown as Overview);
    o.pending = store.actions.filter((a) => ['awaiting_user', 'awaiting_sponsor'].includes(a.status));
    o.freeze = clone(store.freeze);
    return o;
  },
  forecast: () => clone(forecastJson as unknown as ForecastCard),
  transactions: () => clone(transactionsJson as unknown as TransactionsCard),
  chat(message: string): ChatResponse {
    const r = pickChat(message);
    if (!r) {
      return {
        reply:
          "I'm running on saved demo data right now, so I can only replay a few questions. Try one of the quick asks below, or start the backend on :8000 for the real assistant.",
        cards: [],
        actions: [],
        guard: { flags: [] },
      };
    }
    r.actions = r.actions.map((a) => {
      const fresh: Action = {
        ...a,
        action_id: `demo_${Math.random().toString(36).slice(2, 10)}`,
        created_at: now(),
        expires_at: now() + 600,
        confirm_token: 'demo-token',
        frozen: store.freeze.frozen ? 'Payments are locked right now.' : null,
      };
      store.actions.push(fresh);
      record('action_drafted', 'agent', { action_id: fresh.action_id, summary: fresh.summary });
      return clone(fresh);
    });
    return r;
  },
  confirm(id: string): Action {
    const a = find(id);
    if (store.freeze.frozen) fail('Payments are locked. Unlock them first.');
    if (a.status !== 'awaiting_user') fail(`Action is ${a.status}, not awaiting confirmation.`);
    a.user_confirmed = true;
    delete a.confirm_token;
    if (a.needs_sponsor_approval) {
      a.status = 'awaiting_sponsor';
      a.expires_at = now() + 60 * 60 * 24;
    } else {
      a.status = 'executed';
      a.result = { ok: true };
    }
    record('action_confirmed', 'aisha', { action_id: id });
    return clone(a);
  },
  cancel(id: string): Action {
    const a = find(id);
    a.status = 'cancelled';
    record('action_cancelled', 'aisha', { action_id: id });
    return clone(a);
  },
  actions: () => ({ actions: clone(store.actions) }),
  freeze() {
    store.freeze = { frozen: true, own: 'student', sponsor_funded: store.freeze.sponsor_funded ?? 'student', since: now() };
    record('payments_frozen', 'aisha', { scope: 'all' });
    return { freeze: clone(store.freeze) };
  },
  unfreeze() {
    const sponsorHeld = store.freeze.sponsor_funded === 'sponsor' ? 'sponsor' : null;
    store.freeze = { frozen: !!sponsorHeld, own: null, sponsor_funded: sponsorHeld, since: sponsorHeld ? store.freeze.since : null };
    record('payments_unfrozen', 'aisha', {});
    return { freeze: clone(store.freeze), note: sponsorHeld ? 'Money your sponsor funds stays locked until your sponsor unlocks it.' : '' };
  },
  sponsorFreeze(scope: 'sponsor_funded' | 'all') {
    store.freeze = { frozen: true, own: scope === 'all' ? 'sponsor' : store.freeze.own, sponsor_funded: 'sponsor', since: now() };
    record('payments_frozen', 'rahman', { scope });
    return { freeze: clone(store.freeze) };
  },
  sponsorUnfreeze() {
    store.freeze = { frozen: false, own: null, sponsor_funded: null, since: null };
    record('payments_unfrozen', 'rahman', {});
    return { freeze: clone(store.freeze) };
  },
  sponsorQueue: () => ({ actions: clone(store.actions.filter((a) => a.status === 'awaiting_sponsor')) }),
  sponsorOverview(): SponsorOverview {
    const o = clone(sponsorOverviewJson as unknown as SponsorOverview);
    o.freeze = clone(store.freeze);
    o.recent = clone(store.actions).slice(-10);
    o.digest = {
      ...o.digest,
      drafted: store.actions.length + 1,
      executed: store.actions.filter((a) => a.status === 'executed').length,
      awaiting_sponsor: store.actions.filter((a) => a.status === 'awaiting_sponsor').length,
      stopped: store.actions.filter((a) => ['rejected', 'cancelled'].includes(a.status)).length,
      frozen: store.freeze.frozen,
    };
    return o;
  },
  decide(id: string, approve: boolean, note: string, pin?: string): Action {
    const a = find(id);
    if (store.freeze.frozen) fail('Payments are locked. Unlock them first.');
    if (a.status !== 'awaiting_sponsor') fail(`Action is ${a.status}, not awaiting sponsor approval.`);
    if (approve && pin !== DEMO_PIN) fail("That PIN didn't match. Nothing was sent.");
    a.sponsor_decision = approve ? 'approved' : 'rejected';
    a.sponsor_note = note;
    if (!approve) a.status = 'rejected';
    else if (a.warnings.some((w) => w.startsWith('Balance in'))) {
      // Mirror the real backend: an approved payment still fails if the account can't cover it.
      a.status = 'failed';
      a.result = { error: `Not enough money in ${a.params.from_account} yet. Top it up, then draft it again.` };
    } else {
      a.status = 'executed';
      a.result = { ok: true };
    }
    record(approve ? 'sponsor_approved' : 'sponsor_rejected', 'rahman', { action_id: id, note });
    return clone(a);
  },
  audit: () => ({ entries: clone(store.log) }),
  auditVerify: (): Verify => ({ ...(auditVerifyJson as Verify), count: store.log.length }),
};
