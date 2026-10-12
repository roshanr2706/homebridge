// Response shapes of the HomeBridge FastAPI backend (mirrors app/src/api.ts in the main app).
export type Role = 'student' | 'sponsor';

// One line per compliance check on an action (backend/app/compliance.py).
export type ComplianceCheck = { id: string; label: string; status: 'pass' | 'flag' | 'block' | 'report' | 'na'; detail: string };
export type Compliance = {
  outcome: 'clear' | 'review' | 'blocked';
  blocked: boolean;
  block_reason: string | null;
  checks: ComplianceCheck[];
  reports: string[];
  record: Record<string, any> | null;
  purpose_code: { code: string; label: string } | null;
  cross_border: boolean;
  amount_cad: number;
};

export type Kyc = { user_id: string; level: string; label: string; moves_money: boolean; max_single_cad: number; max_daily_cad: number; verified_on?: string };
export type Sharing = { scope: string; summary: string; consented_at_onboarding: boolean };

export type Action = {
  action_id: string;
  kind: 'transfer' | 'conversion' | 'add_payee' | 'topup';
  summary: string;
  tier: string;
  status: string;
  needs_sponsor_approval: boolean;
  risk_score: number;
  risk_reasons: string[];
  sponsor_reasons?: string[];
  risk_signals?: string[];
  warnings: string[];
  next_step?: string;
  params: Record<string, any>;
  created_at: number;
  expires_at: number;
  user_confirmed?: boolean;
  sponsor_decision?: string | null;
  sponsor_note?: string;
  confirm_token?: string;
  result?: Record<string, any> | null;
  provenance?: Record<string, string>;
  frozen?: string | null;
  compliance?: Compliance;
};

export type FreezeState = {
  frozen: boolean;
  own: 'student' | 'sponsor' | null;
  sponsor_funded: 'student' | 'sponsor' | null;
  since: number | null;
};

export type Alert = { id: string; ts: number; kind: string; message: string; weight: number };

export type Digest = {
  window_hours: number;
  drafted: number;
  executed: number;
  awaiting_sponsor: number;
  stopped: number;
  money_out_cad: number;
  money_out_scope?: 'sponsor_funded' | 'all';
  flagged: { action_id: string; summary: string; risk_score: number; status: string }[];
  alerts: number;
  frozen: boolean;
};

export type Account = {
  id: string;
  label: string;
  currency: string;
  balance: number;
  number: string;
  sponsor_funded: boolean;
};

export type SponsorOverview = {
  student?: { id: string; name: string };
  accounts: Account[];
  total_cad: number;
  limits: Record<string, number>;
  recent: Action[];
  freeze: FreezeState;
  alerts: Alert[];
  digest: Digest;
  kyc?: { student: Kyc; sponsor: Kyc; limit_ceiling: { single_cad: number; daily_cad: number } };
  pin?: { set: boolean; locked: boolean; failures: number };
  sharing?: Sharing;
};

export type Quote = {
  provider: string;
  provider_key: string;
  you_receive: number;
  receive_currency: string;
  fee: number;
  fee_currency: string;
  rate: number;
  mid_rate: number;
  true_cost: number;
  true_cost_pct: number;
  speed: string;
};

export type BudgetCategory = { category: string; spent_cad: number; budget_cad: number | null; over_budget: boolean };

export type CreditStatus = 'on_time' | 'late' | 'due';
export type CreditHealth = { key: 'needs_attention' | 'fair' | 'on_track' | 'strong'; label: string; basis: string };
export type CreditCardData = {
  type: 'credit';
  card: { label: string; number: string; currency: string; credit_limit: number; balance: number; available: number; deposit: number };
  utilization_pct: number;
  utilization_reported_pct: number;
  utilization_projected_at_close_pct: number;
  target_pct: number;
  next_statement_date: string;
  days_until_statement: number;
  statement: { balance: number; minimum_due: number; remaining: number; due_date: string; days_until_due: number; status: CreditStatus } | null;
  on_time_streak: number;
  months_of_history: number;
  payment_history: CreditStatus[];
  health: CreditHealth;
  recommended_payment: { amount: number; balance_after: number; utilization_after_pct: number };
  next_actions: { key: string; text: string; amount?: number | null }[];
  footnote: string;
};

export type CreditProfile =
  | { has_card: false }
  | (Omit<CreditCardData, 'type' | 'health' | 'payment_history' | 'footnote'> & {
      has_card: true;
      credit_health: CreditHealth;
      payment_history: { closed: string; status: CreditStatus }[];
      disclosure: string;
    });

export type TuitionCard = {
  type: 'tuition';
  installments: { term: string; due: string; amount: number; currency: string; days_until_due: number }[];
  tuition_fund_cad: number;
  next_shortfall_cad: number;
  myr_wallet_value_cad: number;
};

export type BudgetCard = {
  type: 'budget';
  period_days: number;
  categories: BudgetCategory[];
  total_spent_cad: number;
  income_cad: number;
  possible_duplicate_charges: string[];
};

export type ForecastCard = {
  type: 'forecast';
  account: string;
  start_date: string;
  end_date: string;
  horizon: string;
  verdict: 'on_track' | 'tuition_gap' | 'spending_shortfall' | 'both';
  series: number[];
  step_days: number;
  starting_balance: number;
  ending_balance: number;
  lowest: { date: string; balance: number; index: number };
  first_shortfall_date: string | null;
  shortfall_index: number | null;
  tuition: { term: string; due: string; amount: number; gap: number; index: number }[];
  weekly_spending_cad: number;
  pending_included: string[];
  suggestions: string[];
  disclosure: string;
};

export type Card =
  | { type: 'balances'; total: number; total_currency: string; accounts: Omit<Account, 'id'>[] }
  | {
      type: 'fx_quotes';
      from_currency: string;
      to_currency: string;
      amount: number;
      best: string;
      saving_vs_worst: number;
      cached: boolean;
      note: string;
      quotes: Quote[];
    }
  | { type: 'fx_history'; pair: string; today: number; low: number; high: number; average: number; days: number; series: number[] }
  | TuitionCard
  | BudgetCard
  | {
      type: 'scam_check';
      verdict: 'likely_scam' | 'suspicious' | 'no_known_pattern';
      signals: { category: string; name: string }[];
      quote?: string;
      model_label?: string;
      model_confidence?: number;
      model_keywords: string[];
      advice: string[];
    }
  | { type: 'transactions'; count: number; rows: { date: string; counterparty: string; amount: number; currency: string; category: string }[] }
  | { type: 'checklist'; title: string; items: string[]; footnote: string }
  | ForecastCard
  | CreditCardData;

export type ChatResponse = {
  reply: string;
  actions: Action[];
  cards: Card[];
  guard: { flags: string[]; carried?: string[]; session_flags?: string[] };
  trace?: { tool: string; ok: boolean; ms: number }[];
  provider: string;
  fallback: boolean;
};

export type Overview = {
  accounts: Account[];
  total_cad: number;
  tuition: Omit<TuitionCard, 'type'>;
  budget: Omit<BudgetCard, 'type'>;
  reminders: { id: string; due: string; text: string }[];
  payees: { id: string; name: string; kind: string; currency: string; number: string; status: string; usable_from: number | null }[];
  pending: Action[];
  credit?: CreditProfile;
  freeze: FreezeState;
  limits: { single_cad: number; daily_cad: number };
  kyc?: Kyc;
  sharing?: Sharing;
  rates: Record<string, number>;
};

export type AuditPage = { entries: AuditEntry[]; scope?: Role; visible?: number; total?: number };

export type AuditEntry = { seq: number; ts: number; event: string; actor: string; data: Record<string, any>; prev: string; hash: string };
export type Verify = { ok: boolean; count: number; head?: string; broken_at?: number; simulated_tamper_seq?: number };
