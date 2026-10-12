// Render smoke test without a browser: server-renders every result card and action card from the
// captured fixtures, plus each screen's first paint, and fails on any render error.
//   node scripts/smoke.mjs
import { createServer } from 'vite';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  // Node can't default-import a few CommonJS deps of antd-mobile; point them at their ES builds.
  // (Only for this SSR check: the browser bundle handles them already.)
  resolve: {
    alias: [
      { find: /^rc-util\/lib\//, replacement: 'rc-util/es/' },
      { find: /^rc-segmented$/, replacement: 'rc-segmented/es/index.js' },
    ],
  },
  ssr: { noExternal: ['antd-mobile', 'antd-mobile-icons', 'rc-util', 'rc-segmented', 'rc-motion'] },
});
let failed = 0;
try {
  const React = await import('react');
  const { renderToString } = await import('react-dom/server');
  const h = React.createElement;
  const { ResultCard, RunwayBody, CreditBody, TuitionBody, BudgetBody, creditFromProfile } = await vite.ssrLoadModule('/src/components/cards.tsx');
  const { ActionCard } = await vite.ssrLoadModule('/src/components/ActionCard.tsx');
  const chat = (await vite.ssrLoadModule('/src/fixtures/chat.json')).default;
  const overview = (await vite.ssrLoadModule('/src/fixtures/overview.json')).default;
  const forecast = (await vite.ssrLoadModule('/src/fixtures/forecast.json')).default;
  const queue = (await vite.ssrLoadModule('/src/fixtures/sponsor_queue.json')).default;

  const check = (name, el) => {
    try {
      const html = renderToString(el);
      if (html.length < 50) throw new Error(`suspiciously short output (${html.length} chars)`);
      console.log(`ok   ${name} (${html.length} chars)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${e.message}`);
      if (process.env.SMOKE_STACK) console.log(e.stack.split('\n').slice(0, 6).join('\n'));
    }
  };

  for (const c of chat) {
    for (const card of c.response.cards) check(`card ${card.type} <- ${c.message.slice(0, 40)}`, h(ResultCard, { c: card }));
    for (const a of c.response.actions) check(`action ${a.kind} ${a.tier} (student)`, h(ActionCard, { action: a, mode: 'student' }));
  }
  for (const a of queue.actions) check(`action ${a.kind} ${a.tier} (sponsor)`, h(ActionCard, { action: a, mode: 'sponsor' }));
  check('runway body', h(RunwayBody, { c: forecast }));
  check('credit body', h(CreditBody, { c: creditFromProfile(overview.credit) }));
  check('tuition body', h(TuitionBody, { c: overview.tuition }));
  check('budget body', h(BudgetBody, { c: overview.budget }));

  // Offline fallback flow: draft -> confirm -> Dad approves (PIN checked), lock/unlock.
  const { offline } = await vite.ssrLoadModule('/src/offline.ts');
  const step = async (name, fn, expect) => {
    try {
      const r = await fn();
      if (expect && !expect(r)) throw new Error(`unexpected result ${JSON.stringify(r).slice(0, 160)}`);
      console.log(`ok   offline ${name}`);
      return r;
    } catch (e) {
      if (expect === 'throws') return console.log(`ok   offline ${name} (refused: ${e.message})`);
      failed++;
      console.log(`FAIL offline ${name}: ${e.message}`);
    }
  };
  const rent = await step('chat rent', () => offline('student', '/chat', 'POST', { message: '交房租' }), (r) => r.actions[0]?.status === 'awaiting_user');
  if (rent) await step('confirm rent', () => offline('student', `/actions/${rent.actions[0].action_id}/confirm`, 'POST', { token: 'x' }), (r) => r.status === 'executed');
  const tu = await step('chat tuition', () => offline('student', '/chat', 'POST', { message: 'Pay my spring tuition' }), (r) => r.actions[0]?.tier === 'T3');
  if (tu) {
    const id = tu.actions[0].action_id;
    await step('confirm tuition', () => offline('student', `/actions/${id}/confirm`, 'POST', { token: 'x' }), (r) => r.status === 'awaiting_sponsor');
    await step('approve wrong PIN', () => offline('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note: '', pin: '111111' }), 'throws');
    await step('approve', () => offline('sponsor', `/sponsor/actions/${id}/approve`, 'POST', { note: '', pin: '246810' }), (r) => ['executed', 'failed'].includes(r.status));
  }
  await step('sponsor lock', () => offline('sponsor', '/sponsor/freeze', 'POST', { scope: 'all' }), (r) => r.freeze.frozen);
  await step('student unlock refused', () => offline('student', '/unfreeze', 'POST'), 'throws');
  await step('sponsor unlock', () => offline('sponsor', '/sponsor/unfreeze', 'POST', { pin: '246810' }), (r) => !r.freeze.frozen);
  await step('unknown prompt', () => offline('student', '/chat', 'POST', { message: 'zzz' }), (r) => r.reply.length > 0);

  const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
  check('app shell', h(App));
  const nav = { go() {}, ask() {}, draft() {}, setRole() {}, rev: 0, bump() {} };
  for (const [file, name, props] of [
    ['/src/screens/Home.tsx', 'Home', { nav }],
    ['/src/screens/Wallet.tsx', 'Wallet', { nav }],
    ['/src/screens/Me.tsx', 'Me', { nav, role: 'student' }],
    ['/src/screens/Sponsor.tsx', 'SponsorHome', { nav }],
    ['/src/screens/Sponsor.tsx', 'SponsorActivity', { nav }],
    ['/src/screens/Assistant.tsx', 'Assistant', { msgs: [], send: async () => {}, draftText: '', clearDraft() {}, onAction() {}, newChat() {} }],
  ]) {
    const mod = await vite.ssrLoadModule(file);
    check(`screen ${name}`, h(mod[name], props));
  }
} finally {
  await vite.close();
}
console.log(failed ? `\n${failed} failed` : '\nall rendered');
process.exit(failed ? 1 : 0);
