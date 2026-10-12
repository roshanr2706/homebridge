const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `${min}-${max}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-CA', { minimumFractionDigits: min, maximumFractionDigits: max });
    fmtCache.set(k, f);
  }
  return f;
}

export const SYMBOL: Record<string, string> = { CAD: '$', MYR: 'RM' };

/** "CAD 1,150.00" */
export function money(amount: number, currency = 'CAD', decimals = 2) {
  return `${currency} ${nf(decimals, decimals).format(amount)}`;
}

/** "$1,150.00" / "RM 18,200" — compact symbol form for hero numerals and charts. */
export function sym(amount: number, currency = 'CAD', decimals = 2) {
  const s = SYMBOL[currency] ?? `${currency} `;
  const sign = amount < 0 ? '−' : '';
  return `${sign}${s}${currency === 'MYR' ? ' ' : ''}${nf(decimals, decimals).format(Math.abs(amount))}`;
}

/** Splits a value into whole and cents parts for the two-weight hero numeral. */
export function splitMoney(amount: number) {
  const s = nf(2, 2).format(Math.abs(amount));
  const [whole, cents] = s.split('.');
  return { whole, cents, negative: amount < 0 };
}

export function compact(n: number) {
  return new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2027-01-06" → "Jan 6" */
export function shortDate(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function timeAgo(ts: number) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function clockTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
