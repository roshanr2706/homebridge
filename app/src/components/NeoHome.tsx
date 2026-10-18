// Neo skin structure: a big hero balance (small dim cents, CAD / MYR toggle), round quick actions, a horizontal
// account-card carousel (the CAD Everyday card in lime) and insight chips. Same data as the other skin.
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { usePersonName } from '../account';
import { accountNote, type Account, type Overview } from '../api';
import { useT, type Key } from '../i18n';
import { amount, money, splitAmount, useFontSet, useTheme } from '../theme';
import { Body, Mono, Row } from '../ui';

function greetingKey(d = new Date()): Key {
  let h = 12;
  try {
    h = Number(d.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Vancouver' }));
  } catch {
    /* keep midday */
  }
  return h < 12 ? 'neo.morning' : h < 18 ? 'neo.afternoon' : 'neo.evening';
}

/** The hero: greeting, total balance with small dim cents, and a CAD / MYR toggle. */
export function NeoBalance({ o, size = 54, greet = true }: { o: Overview; size?: number; greet?: boolean }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const name = usePersonName('Aisha').split(' ')[0];
  const [cur, setCur] = useState<'CAD' | 'MYR'>('CAD');
  const rate = o.rates['CAD/MYR'] ?? 1 / (o.rates['MYR/CAD'] || 1);
  const total = cur === 'CAD' ? o.total_cad : o.total_cad * rate;
  const [whole, cents] = splitAmount(total);
  const other = cur === 'CAD' ? `≈ RM ${amount(o.total_cad * rate, 0)}` : `≈ $${amount(o.total_cad, 0)} CAD`;
  return (
    <View>
      {greet && (
        <View style={{ marginBottom: 14 }}>
          <Body style={{ fontSize: 13, color: t.muted, lineHeight: 17 }}>{tr(greetingKey())}</Body>
          <Body style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 }}>{name}</Body>
        </View>
      )}
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ fontSize: 11, letterSpacing: 1.1, color: t.faint, fontFamily: fonts.bodyBold, textTransform: 'uppercase' }}>
          {tr('neo.total')}
        </Body>
        <Row style={{ backgroundColor: t.sunken, borderRadius: 999, padding: 3, borderWidth: 1, borderColor: t.border }}>
          {(['CAD', 'MYR'] as const).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCur(c)}
              accessibilityRole="tab"
              accessibilityState={{ selected: cur === c }}
              style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: cur === c ? t.text : 'transparent' }}
            >
              <Mono style={{ fontSize: 11.5, fontFamily: fonts.monoBold, color: cur === c ? t.bg : t.muted }}>{c}</Mono>
            </Pressable>
          ))}
        </Row>
      </Row>
      <Row style={{ alignItems: 'flex-start', marginTop: 6 }}>
        <Body style={{ fontFamily: fonts.bodyMedium, fontSize: size * 0.42, lineHeight: size * 0.6, color: t.muted, marginRight: 4, marginTop: size * 0.1 }}>
          {cur === 'CAD' ? '$' : 'RM'}
        </Body>
        <Body
          numberOfLines={1}
          style={{ fontFamily: fonts.bodyBold, fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.045, fontVariant: ['tabular-nums'], flexShrink: 1 }}
        >
          {whole}
          <Body style={{ fontFamily: fonts.bodyMedium, fontSize: size * 0.5, color: t.faint, letterSpacing: -0.5 }}>{cents}</Body>
        </Body>
      </Row>
      <Mono style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>
        {other} · 1 CAD = {rate.toFixed(4)} MYR
      </Mono>
    </View>
  );
}

type Quick = { glyph: string; label: Key; ask: Record<'en' | 'zh', string>; fill?: boolean };
const QUICK: Quick[] = [
  { glyph: '⇄', label: 'neo.qConvert', ask: { en: 'Cheapest way to change 5,000 MYR to CAD?', zh: '最便宜的马币换加币' } },
  { glyph: '↗', label: 'neo.qRent', ask: { en: 'Pay my rent', zh: '帮我交房租' } },
  { glyph: '◔', label: 'neo.qRunway', ask: { en: 'Will I run out of money before tuition?', zh: '我的钱够用到学期末吗？' } },
  { glyph: '⚠︎', label: 'neo.qScam', ask: { en: 'Is this a scam? ', zh: '帮我查一下这条信息是不是诈骗' }, fill: true },
];

/** Four round quick actions; each sends its prompt to the assistant (scam check fills the box for pasting). */
export function NeoActions({ onAsk, onFill }: { onAsk: (s: string) => void; onFill: (s: string) => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 18 }}>
      {QUICK.map((q) => (
        <Pressable
          key={q.label}
          onPress={() => (q.fill && tr.lang === 'en' ? onFill(q.ask.en) : onAsk(q.ask[tr.lang]))}
          accessibilityRole="button"
          accessibilityLabel={tr(q.label)}
          style={({ pressed }) => ({ alignItems: 'center', gap: 6, width: '24%', opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: t.sunken, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
            <Body style={{ fontSize: 19, lineHeight: 22, color: t.text }}>{q.glyph}</Body>
          </View>
          <Body style={{ fontSize: 11.5, lineHeight: 14, color: t.muted, textAlign: 'center' }} numberOfLines={1}>
            {tr(q.label)}
          </Body>
        </Pressable>
      ))}
    </Row>
  );
}

const SUB: Record<string, Key> = { CAD: 'neo.cardEveryday', MYR: 'neo.cardMyr' };

/** Horizontal account cards. CAD Everyday is the lime hero card; the rest are glass. */
export function NeoAccountCarousel({ accounts }: { accounts: Account[] }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const [page, setPage] = useState(0);
  const W = 236;
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <Body style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 22 }}>{tr('neo.accounts')}</Body>
        <Row style={{ gap: 4 }}>
          {accounts.map((a, i) => (
            <View key={a.id} style={{ width: i === page ? 16 : 5, height: 5, borderRadius: 3, backgroundColor: i === page ? t.text : t.faint }} />
          ))}
        </Row>
      </Row>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={W + 10}
        decelerationRate="fast"
        onScroll={(e) => setPage(Math.max(0, Math.min(accounts.length - 1, Math.round(e.nativeEvent.contentOffset.x / (W + 10)))))}
        scrollEventThrottle={32}
        contentContainerStyle={{ gap: 10, paddingRight: 16 }}
      >
        {accounts.map((a) => {
          const hero = a.currency === 'CAD' && !a.sponsor_funded;
          const fg = hero ? t.heroCardText : t.text;
          const dim = hero ? 'rgba(10, 11, 13, 0.62)' : t.muted;
          const [whole, cents] = splitAmount(a.balance);
          return (
            <View
              key={a.id}
              style={{
                width: W,
                height: 150,
                borderRadius: t.radius,
                padding: 16,
                justifyContent: 'space-between',
                backgroundColor: hero ? t.heroCard : t.surface,
                borderWidth: 1,
                borderColor: hero ? t.heroCard : t.border,
              }}
            >
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18, color: fg }} numberOfLines={1}>
                    {tr.d(a.label)}
                  </Body>
                  <Mono style={{ fontSize: 11, color: dim, marginTop: 2 }}>{a.number}</Mono>
                </View>
                <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: hero ? 'rgba(10,11,13,0.1)' : t.sunken }}>
                  <Mono style={{ fontSize: 10, fontFamily: fonts.monoBold, color: fg }}>{a.currency}</Mono>
                </View>
              </Row>
              <View>
                <Body numberOfLines={1} style={{ fontFamily: fonts.bodyBold, fontSize: 28, lineHeight: 33, letterSpacing: -1, color: fg, fontVariant: ['tabular-nums'] }}>
                  {a.currency === 'MYR' ? 'RM ' : '$'}
                  {whole}
                  <Body style={{ fontSize: 15, color: dim, fontFamily: fonts.bodyMedium }}>{cents}</Body>
                </Body>
                <Body style={{ fontSize: 11.5, lineHeight: 15, color: dim }} numberOfLines={1}>
                  {a.sponsor_funded ? tr('neo.cardFunded') : accountNote(a) ? tr.d(accountNote(a)) : tr(SUB[a.currency] ?? 'neo.cardEveryday')}
                </Body>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

type Chip = { key: string; text: string; tone: string; ask: string };

/** Short insights from the overview; tapping one asks the assistant about it. */
export function insightChips(o: Overview, tr: ReturnType<typeof useT>, t: ReturnType<typeof useTheme>): Chip[] {
  const zh = tr.lang === 'zh';
  const chips: Chip[] = [];
  const next = o.tuition.installments[0];
  if (o.tuition.next_shortfall_cad > 0 && next)
    chips.push({
      key: 'tuition',
      text: tr('neo.chipTuition', { n: amount(o.tuition.next_shortfall_cad, 0), date: tr.date(next.due) }),
      tone: t.gold,
      ask: zh ? '学费够吗？' : 'When is my next tuition due and can I cover it?',
    });
  const credit = o.credit && o.credit.has_card ? o.credit : null;
  if (credit?.statement && credit.statement.remaining > 0)
    chips.push({
      key: 'card',
      text: tr('neo.chipCard', { n: money(credit.statement.remaining, 'CAD'), days: credit.statement.days_until_due }),
      tone: t.accent,
      ask: zh ? '我的信用怎么样' : "How's my credit?",
    });
  for (const c of o.budget.categories.filter((x) => x.over_budget).slice(0, 2))
    chips.push({
      key: `b-${c.category}`,
      text: tr('neo.chipOver', { cat: cap(tr.d(c.category)), pct: c.budget_cad ? Math.round((c.spent_cad / c.budget_cad) * 100) : 100 }),
      tone: t.danger,
      ask: zh ? '我这个月花了多少？' : 'Where did my money go this month?',
    });
  const dad = o.pending.filter((a) => a.status === 'awaiting_sponsor').length;
  if (dad) chips.push({ key: 'dad', text: tr('neo.chipDad', { n: dad }), tone: t.gold, ask: zh ? '爸爸的钱到了吗？' : 'Did dad send the money?' });
  return chips;
}

export function InsightChips({ o, onAsk }: { o: Overview; onAsk: (s: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const fonts = useFontSet();
  const chips = insightChips(o, tr, t);
  if (!chips.length) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Body style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 22, marginBottom: 10 }}>{tr('neo.forYou')}</Body>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => onAsk(c.ask)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.border,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.tone }} />
            <Body style={{ fontSize: 13, lineHeight: 17 }}>{c.text}</Body>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
