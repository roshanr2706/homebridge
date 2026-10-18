// Super-app skin structure (Alipay / WeChat Pay / WeBank): a blue header with a search box that asks the assistant,
// four big actions, the total-assets card, a rotating notice bar from real overview data, and a 5×2 service grid
// with bilingual labels and red badges. Every tile sends a prompt to the assistant or opens a tab.
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { api, type ForecastCard, type Overview } from '../api';
import { useT } from '../i18n';
import { amount, money, useFontSet, useTheme } from '../theme';
import { Body, Mono, Row } from '../ui';

export type Tab = 'assistant' | 'wallet' | 'ledger' | 'approvals' | 'rules';
type Bi = { en: string; zh: string };
type Go = { ask?: Bi; fill?: Bi; tab?: Tab };

const BIG: { glyph: string; label: Bi; go: Go }[] = [
  { glyph: '↗', label: { en: 'Pay', zh: '转账' }, go: { ask: { en: 'Pay my rent', zh: '帮我交房租' } } },
  { glyph: '⇄', label: { en: 'Convert', zh: '换汇' }, go: { ask: { en: 'Cheapest way to change 5,000 MYR to CAD?', zh: '最便宜的马币换加币' } } },
  { glyph: '✉', label: { en: 'Ask Dad', zh: '找爸爸' }, go: { ask: { en: 'Ask my dad for 800 for textbooks', zh: '问爸爸要800加币买课本' } } },
  { glyph: '▭', label: { en: 'Cards', zh: '卡包' }, go: { tab: 'wallet' } },
];

type Tile = { key: string; icon: string; color: string; label: Bi; go: Go };
const TILES: Tile[] = [
  { key: 'tuition', icon: '学', color: '#FF7A00', label: { en: 'Tuition', zh: '学费' }, go: { ask: { en: 'When is my next tuition due and can I cover it?', zh: '学费够吗？' } } },
  { key: 'credit', icon: '信', color: '#1677FF', label: { en: 'Credit', zh: '信用' }, go: { ask: { en: "How's my credit?", zh: '我的信用怎么样' } } },
  { key: 'scam', icon: '防', color: '#FF3141', label: { en: 'Scam check', zh: '防骗' }, go: { fill: { en: 'Is this a scam? ', zh: '' }, ask: { en: '', zh: '帮我查一下这条信息是不是诈骗' } } },
  { key: 'bills', icon: '账', color: '#0EA5E9', label: { en: 'Bills', zh: '账单' }, go: { ask: { en: 'Show my recent transactions', zh: '我的账单' } } },
  { key: 'budget', icon: '预', color: '#00B578', label: { en: 'Budget', zh: '预算' }, go: { ask: { en: 'Where did my money go this month?', zh: '我这个月花了多少？' } } },
  { key: 'lock', icon: '锁', color: '#5B6475', label: { en: 'Lock', zh: '冻结' }, go: { tab: 'wallet' } },
  { key: 'sponsor', icon: '爸', color: '#7A5AF8', label: { en: 'Sponsor', zh: '爸爸' }, go: { ask: { en: 'Did dad send the money?', zh: '爸爸的钱到了吗？' } } },
  { key: 'ledger', icon: '明', color: '#1677FF', label: { en: 'Ledger', zh: '明细' }, go: { tab: 'ledger' } },
  { key: 'runway', icon: '跑', color: '#FF7A00', label: { en: 'Runway', zh: '跑道' }, go: { ask: { en: 'Will I run out of money before tuition?', zh: '我的钱够用到学期末吗？' } } },
  { key: 'fx', icon: '汇', color: '#13A8A8', label: { en: 'FX rates', zh: '汇率' }, go: { ask: { en: 'Is now a good time to convert MYR?', zh: '马币汇率最近怎么样' } } },
];

type Notice = { key: string; text: string; go: Go };

function notices(o: Overview, fc: ForecastCard | null, tr: ReturnType<typeof useT>): Notice[] {
  const out: Notice[] = [];
  const next = o.tuition.installments[0];
  if (next && o.tuition.next_shortfall_cad > 0)
    out.push({ key: 'tuition', text: tr('sa.noticeTuition', { n: amount(o.tuition.next_shortfall_cad, 0), date: tr.date(next.due) }), go: TILES[0].go });
  if (fc?.first_shortfall_date)
    out.push({ key: 'runway', text: tr('sa.noticeRunway', { date: tr.date(fc.first_shortfall_date) }), go: TILES[8].go });
  const credit = o.credit && o.credit.has_card ? o.credit : null;
  if (credit?.statement && credit.statement.remaining > 0)
    out.push({ key: 'card', text: tr('sa.noticeCard', { n: money(credit.statement.remaining, 'CAD'), days: credit.statement.days_until_due }), go: TILES[1].go });
  const dad = o.pending.filter((a) => a.status === 'awaiting_sponsor').length;
  if (dad) out.push({ key: 'dad', text: tr('sa.noticeDad', { n: dad }), go: TILES[6].go });
  const mine = o.pending.filter((a) => a.status === 'awaiting_user').length;
  if (mine) out.push({ key: 'mine', text: tr('sa.noticeMine', { n: mine }), go: { tab: 'wallet' } });
  if (!out.length) out.push({ key: 'ok', text: tr('sa.noticeOk'), go: { ask: { en: 'How much money do I have?', zh: '我还有多少钱？' } } });
  return out;
}

/** The two labels of a bilingual tile: the UI language first, the other one small underneath. */
function biLabel(b: Bi, lang: 'en' | 'zh'): [string, string] {
  return lang === 'zh' ? [b.zh, b.en] : [b.en, b.zh];
}

export function SuperStudentHome({
  o,
  onAsk,
  onFill,
  onTab,
}: {
  o: Overview;
  onAsk: (s: string) => void;
  onFill: (s: string) => void;
  onTab?: (tab: Tab) => void;
}) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const [q, setQ] = useState('');
  const [fc, setFc] = useState<ForecastCard | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .forecast()
      .then((f) => live && setFc(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [o]);
  const list = notices(o, fc, tr);
  useEffect(() => {
    const id = setInterval(() => setN((k) => k + 1), 3500);
    return () => clearInterval(id);
  }, []);
  const notice = list[n % list.length];

  const go = (g: Go) => {
    if (g.tab) onTab?.(g.tab);
    else if (g.fill && g.fill[tr.lang]) onFill(g.fill[tr.lang]);
    else if (g.ask && g.ask[tr.lang]) onAsk(g.ask[tr.lang]);
  };
  const search = () => {
    const s = q.trim();
    if (!s) return;
    setQ('');
    onAsk(s);
  };

  const pendingMine = o.pending.filter((a) => a.status === 'awaiting_user').length;
  const pendingDad = o.pending.filter((a) => a.status === 'awaiting_sponsor').length;
  const next = o.tuition.installments[0];
  const credit = o.credit && o.credit.has_card ? o.credit : null;
  const badge: Record<string, string | true | undefined> = {
    tuition: next && o.tuition.next_shortfall_cad > 0 ? tr('sa.days', { n: next.days_until_due }) : undefined,
    credit: credit?.statement && credit.statement.remaining > 0 ? true : undefined,
    bills: pendingMine ? String(pendingMine) : undefined,
    budget: o.budget.categories.some((c) => c.over_budget) ? true : undefined,
    sponsor: pendingDad ? String(pendingDad) : undefined,
    runway: fc && fc.verdict !== 'on_track' ? true : undefined,
  };

  return (
    <View style={{ marginHorizontal: -16, marginTop: -16, marginBottom: 14 }}>
      {/* blue header: search that asks the assistant, then four big actions */}
      <View style={{ backgroundColor: t.headerBg, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 46 }}>
        <Row style={{ gap: 10 }}>
          <Body style={{ color: t.headerText, fontFamily: fonts.bodyBold, fontSize: 14 }}>{tr('sa.city')} ▾</Body>
          <Row style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 999, paddingLeft: 12, paddingRight: 3, height: 34 }}>
            <Body style={{ color: '#8C8C8C', fontSize: 13, marginRight: 6 }}>⌕</Body>
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={search}
              returnKeyType="search"
              placeholder={tr('sa.search')}
              placeholderTextColor="#A6A6A6"
              accessibilityLabel={tr('sa.searchLabel')}
              style={{ flex: 1, fontSize: 13, color: '#1A1A1A', fontFamily: fonts.body, paddingVertical: 0, minWidth: 0 }}
            />
            <Pressable onPress={search} accessibilityRole="button" style={{ backgroundColor: t.headerBg, borderRadius: 999, paddingHorizontal: 12, height: 28, justifyContent: 'center' }}>
              <Body style={{ color: t.headerText, fontSize: 12.5, fontFamily: fonts.bodyBold }}>{tr('sa.go')}</Body>
            </Pressable>
          </Row>
        </Row>
        <Row style={{ justifyContent: 'space-around', marginTop: 16 }}>
          {BIG.map((b) => {
            const [main, sub] = biLabel(b.label, tr.lang);
            return (
              <Pressable key={b.label.en} onPress={() => go(b.go)} accessibilityRole="button" accessibilityLabel={main} style={({ pressed }) => ({ alignItems: 'center', width: '24%', opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 38, height: 38, borderRadius: 9, borderWidth: 2, borderColor: t.headerText, alignItems: 'center', justifyContent: 'center' }}>
                  <Body style={{ color: t.headerText, fontSize: 18, lineHeight: 22, fontFamily: fonts.bodyBold }}>{b.glyph}</Body>
                </View>
                <Body style={{ color: t.headerText, fontSize: 13.5, lineHeight: 18, fontFamily: fonts.bodyBold, marginTop: 6 }}>{main}</Body>
                <Body style={{ color: t.headerMuted, fontSize: 10, lineHeight: 13 }}>{sub}</Body>
              </Pressable>
            );
          })}
        </Row>
      </View>

      <View style={{ paddingHorizontal: 10, marginTop: -34, gap: 8 }}>
        {/* total assets */}
        <View style={{ backgroundColor: t.surface, borderRadius: t.radius, padding: 14 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body style={{ fontSize: 12.5, color: t.muted }}>{tr('sa.total')}</Body>
            <Pressable onPress={() => onTab?.('wallet')} accessibilityRole="button" hitSlop={8}>
              <Body style={{ fontSize: 12.5, color: t.faint }}>{tr('sa.details')} ›</Body>
            </Pressable>
          </Row>
          <Mono style={{ fontFamily: fonts.monoBold, fontSize: 28, color: t.text, marginTop: 2, letterSpacing: -0.5 }}>{amount(o.total_cad)}</Mono>
          <View style={{ height: 1, backgroundColor: t.border, marginVertical: 10 }} />
          <Row style={{ alignItems: 'flex-start' }}>
            {o.accounts.map((a) => (
              <View key={a.id} style={{ flex: 1 }}>
                <Row style={{ gap: 4 }}>
                  <Body style={{ fontSize: 11, lineHeight: 15, color: t.muted }} numberOfLines={1}>
                    {tr.d(a.label)}
                  </Body>
                  {a.sponsor_funded && (
                    <View style={{ backgroundColor: t.accentSoft, borderRadius: 3, paddingHorizontal: 3 }}>
                      <Body style={{ fontSize: 9, lineHeight: 13, color: t.accent }}>{tr('sa.funded')}</Body>
                    </View>
                  )}
                </Row>
                <Mono style={{ fontFamily: fonts.monoBold, fontSize: 14.5, color: t.text, marginTop: 2 }} numberOfLines={1}>
                  <Mono style={{ fontSize: 10.5, color: t.faint }}>{a.currency === 'MYR' ? 'RM ' : '$ '}</Mono>
                  {amount(a.balance, 0)}
                </Mono>
              </View>
            ))}
          </Row>
        </View>

        {/* rotating notice bar */}
        <Pressable
          onPress={() => go(notice.go)}
          accessibilityRole="button"
          accessibilityLabel={notice.text}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface, borderRadius: t.radius, paddingHorizontal: 12, paddingVertical: 10 }}
        >
          <Body style={{ fontSize: 12.5, color: t.danger, fontFamily: fonts.bodyBold }}>📢 {tr('sa.notice')}</Body>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.badge }} />
          <Body style={{ flex: 1, fontSize: 12.5, lineHeight: 17 }} numberOfLines={1}>
            {notice.text}
          </Body>
          <Mono style={{ fontSize: 10.5, color: t.faint }}>
            {(n % list.length) + 1}/{list.length}
          </Mono>
          <Body style={{ color: t.faint, fontSize: 14 }}>›</Body>
        </Pressable>

        {/* 5×2 service grid */}
        <View style={{ backgroundColor: t.surface, borderRadius: t.radius, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
          {TILES.map((x) => {
            const [main, sub] = biLabel(x.label, tr.lang);
            const b = badge[x.key];
            return (
              <Pressable key={x.key} onPress={() => go(x.go)} accessibilityRole="button" accessibilityLabel={main} style={({ pressed }) => ({ width: '20%', alignItems: 'center', opacity: pressed ? 0.65 : 1 })}>
                <View>
                  <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: x.color, alignItems: 'center', justifyContent: 'center' }}>
                    <Body style={{ color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontFamily: fonts.bodyBold }}>{x.icon}</Body>
                  </View>
                  {b === true ? (
                    <View style={{ position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: t.badge, borderWidth: 1.5, borderColor: t.surface }} />
                  ) : b ? (
                    <View style={{ position: 'absolute', top: -7, right: -12, minWidth: 18, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: t.badge, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: t.surface }}>
                      <Body style={{ color: '#FFFFFF', fontSize: 9.5, lineHeight: 12, fontFamily: fonts.bodyBold }}>{b}</Body>
                    </View>
                  ) : null}
                </View>
                <Body style={{ fontSize: 12, lineHeight: 16, marginTop: 6 }} numberOfLines={1}>
                  {main}
                </Body>
                <Body style={{ fontSize: 9.5, lineHeight: 12, color: t.faint }} numberOfLines={1}>
                  {sub}
                </Body>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** Wallet in the super-app skin: the blue band with the total and each account. */
export function SuperWalletBand({ o }: { o: Overview }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  return (
    <View style={{ marginHorizontal: -16, marginTop: -16, backgroundColor: t.headerBg, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 18 }}>
      <Body style={{ color: t.headerMuted, fontSize: 12.5 }}>{tr('sa.total')}</Body>
      <Mono style={{ fontFamily: fonts.monoBold, fontSize: 32, color: t.headerText, letterSpacing: -0.5, marginTop: 2 }}>{amount(o.total_cad)}</Mono>
      <Body style={{ color: t.headerMuted, fontSize: 12 }}>
        1 CAD = {(o.rates['CAD/MYR'] ?? 0).toFixed(4)} MYR
      </Body>
    </View>
  );
}
