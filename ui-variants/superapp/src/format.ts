const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const amount = (n: number, d = 2) => nf(d).format(n);
export const money = (n: number, cur = 'CAD', d = 2) => `${cur} ${nf(d).format(n)}`;
export const MASK = '****';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2027-01-06" -> "1月6日" */
export const zhDate = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
/** "2027-01-06" -> "Jan 6" */
export const enDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export const ACCOUNT_ZH: Record<string, string> = {
  'CAD Everyday': '日常账户',
  'MYR Wallet': '马币钱包',
  'CAD Tuition Fund': '学费金',
};

export const CATEGORY_ZH: Record<string, string> = {
  rent: '房租',
  groceries: '买菜',
  dining: '餐饮',
  family: '家人',
  transport: '交通',
  phone: '话费',
  entertainment: '娱乐',
  utilities: '水电',
  income: '收入',
  tuition: '学费',
  transfer: '转账',
  shopping: '购物',
  card_payment: '还款',
};

export const STATUS_ZH: Record<string, [string, 'primary' | 'success' | 'warning' | 'danger' | 'default']> = {
  awaiting_user: ['待您确认', 'warning'],
  awaiting_sponsor: ['待爸爸批准', 'primary'],
  executed: ['已完成', 'success'],
  rejected: ['已拒绝', 'danger'],
  cancelled: ['已取消', 'default'],
  expired: ['已过期', 'default'],
  failed: ['失败', 'danger'],
  blocked: ['合规拦截', 'danger'],
};

export const KIND_ZH: Record<string, [string, string]> = {
  transfer: ['付款', 'Payment'],
  conversion: ['换汇', 'Conversion'],
  add_payee: ['新收款人', 'New payee'],
  topup: ['向爸爸要钱', 'Top-up request'],
};

export const ago = (ts: number) => {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
};
