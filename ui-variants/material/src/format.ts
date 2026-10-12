import type { Action } from './types';

export function money(n: number | undefined | null, currency = 'CAD', opts: { sign?: boolean; decimals?: number } = {}): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const d = opts.decimals ?? 2;
  const abs = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${currency} ${abs}`;
}

/** Splits an amount for the big-number style: "14,230" + ".07". */
export function splitAmount(n: number): [string, string] {
  const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const i = s.lastIndexOf('.');
  return [(n < 0 ? '−' : '') + s.slice(0, i), s.slice(i)];
}

export function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export function longDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export function clockTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}

export function cityTime(tz: string): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
}

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const isMove = (a: Action) => a.kind === 'conversion' && a.params.from_currency === a.params.to_currency;

export const KIND_LABEL: Record<string, string> = {
  transfer: 'Payment',
  conversion: 'Currency conversion',
  add_payee: 'New payee',
  topup: 'Money request',
};

export function headline(a: Action): { big: string; sub?: string } {
  const p = a.params;
  if (isMove(a)) return { big: money(p.amount, p.from_currency), sub: a.summary.replace(/^Move [^ ]+ [^ ]+ /, '') };
  if (a.kind === 'transfer') return { big: money(p.amount, p.currency), sub: `to ${p.payee_name}` };
  if (a.kind === 'conversion') return { big: money(p.amount, p.from_currency), sub: `→ about ${money(p.expected_receive, p.to_currency)}` };
  if (a.kind === 'topup') return { big: money(p.amount, p.currency), sub: p.reason ? `for ${p.reason}` : 'from your sponsor' };
  if (a.kind === 'add_payee') return { big: p.name, sub: `${p.kind} · ${p.currency} · ${p.number_masked ?? ''}` };
  return { big: a.summary };
}

export const STATUS: Record<string, { label: string; tone: 'primary' | 'warning' | 'success' | 'error' | 'neutral' }> = {
  awaiting_user: { label: 'Needs your confirmation', tone: 'primary' },
  awaiting_sponsor: { label: 'Waiting for Dad', tone: 'warning' },
  executed: { label: 'Done', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'error' },
  blocked: { label: 'Blocked by compliance', tone: 'error' },
};

export const CATEGORY_LABEL = (c: string) => cap(c.replace(/_/g, ' '));
