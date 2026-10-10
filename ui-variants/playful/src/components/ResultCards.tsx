import { Box, Button, Group, Progress, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconBus,
  IconCash,
  IconChecklist,
  IconDeviceGamepad2,
  IconDeviceMobile,
  IconHome,
  IconShoppingCart,
  IconToolsKitchen2,
  IconUsers,
  IconWallet,
  type Icon,
} from '@tabler/icons-react';

import type { BudgetCard, Card, CreditCardData, ForecastCard, TuitionCard } from '../api/types';
import { C, money, shortDate, shortMoney } from '../theme';
import { GradCap, ShieldArt } from './Art';
import { FxRace, runwayHeadline, RunwayChart, Sparkline, StreakDots, UtilGauge } from './Charts';
import { Big, Eyebrow, IconBadge, Row, Sticker, Tile, useApp } from './ui';

const CAT: Record<string, [Icon, string]> = {
  rent: [IconHome, C.grapeSoft],
  groceries: [IconShoppingCart, C.mintSoft],
  dining: [IconToolsKitchen2, C.coralSoft],
  family: [IconUsers, C.skySoft],
  transport: [IconBus, C.sunSoft],
  phone: [IconDeviceMobile, C.skySoft],
  entertainment: [IconDeviceGamepad2, C.grapeSoft],
  utilities: [IconBolt, C.sunSoft],
};
export function CategoryBadge({ category, size = 34 }: { category: string; size?: number }) {
  const [I, bg] = CAT[category] ?? [IconCash, '#F4F3F7'];
  return (
    <IconBadge bg={bg} size={size}>
      <I size={size * 0.55} stroke={2.2} color={C.ink} />
    </IconBadge>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Head({ title, sub, bg, art }: { title: string; sub?: string; bg: string; art?: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" mb={12} gap={8}>
      <Box>
        <Eyebrow>{sub}</Eyebrow>
        <Text className="hb-display" fz={19} fw={600}>
          {title}
        </Text>
      </Box>
      {art ?? <Box style={{ width: 14, height: 14, borderRadius: 5, background: bg, border: `2px solid ${C.ink}` }} />}
    </Group>
  );
}

export function BudgetBars({ b, limit }: { b: Omit<BudgetCard, 'type'>; limit?: number }) {
  const cats = limit ? b.categories.slice(0, limit) : b.categories;
  return (
    <Stack gap={12}>
      {cats.map((c) => {
        const pct = c.budget_cad ? Math.min(100, (c.spent_cad / c.budget_cad) * 100) : 100;
        const color = c.budget_cad === null ? 'ink.2' : c.over_budget ? 'tomato.5' : pct > 85 ? 'sun.5' : 'mint.5';
        return (
          <Group key={c.category} wrap="nowrap" gap={10}>
            <CategoryBadge category={c.category} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" gap={4} wrap="nowrap">
                <Text fz={13.5} fw={800}>
                  {cap(c.category)}
                  {c.over_budget && (
                    <Text span fz={11} fw={900} c="tomato.6" ml={6}>
                      over by {shortMoney(c.spent_cad - (c.budget_cad ?? 0))}
                    </Text>
                  )}
                </Text>
                <Text fz={12.5} fw={800} c={C.inkSoft} style={{ whiteSpace: 'nowrap' }}>
                  {shortMoney(c.spent_cad, '$')}
                  {c.budget_cad ? ` / ${shortMoney(c.budget_cad, '$')}` : ' · fixed'}
                </Text>
              </Group>
              <Progress value={pct} color={color} size={12} radius="xl" mt={4} style={{ border: `2px solid ${C.ink}` }} bg="#fff" />
            </Box>
          </Group>
        );
      })}
    </Stack>
  );
}

export function ForecastBlock({ f, showFix = true }: { f: ForecastCard; showFix?: boolean }) {
  const { ask } = useApp();
  const h = runwayHeadline(f);
  return (
    <Stack gap={10}>
      <Box className="hb-chunk-sm" p={12} style={{ background: h.tone === 'ok' ? C.mintSoft : h.tone === 'bad' ? C.coralSoft : C.sunSoft }}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <IconAlertTriangle size={20} stroke={2.4} color={C.ink} style={{ flexShrink: 0, marginTop: 2, display: h.tone === 'ok' ? 'none' : undefined }} />
          <Box>
            <Text fw={900} fz={15}>
              {h.title}
            </Text>
            <Text fz={13} fw={700} c={C.inkSoft}>
              {h.body}
            </Text>
          </Box>
        </Group>
      </Box>
      <RunwayChart f={f} />
      <Group gap={6}>
        <Sticker bg={C.mintSoft} rotate={0}>Start {shortMoney(f.starting_balance)}</Sticker>
        <Sticker bg={f.lowest.balance < 0 ? C.tomatoSoft : C.sunSoft} rotate={0}>
          Lowest {shortMoney(f.lowest.balance)} · {shortDate(f.lowest.date)}
        </Sticker>
        <Sticker bg="#fff" rotate={0}>~{shortMoney(f.weekly_spending_cad)}/week</Sticker>
      </Group>
      {showFix && f.suggestions.length > 0 && (
        <Stack gap={8}>
          <Eyebrow>The cheapest fixes</Eyebrow>
          {f.suggestions.map((s, i) => (
            <Group key={i} gap={10} wrap="nowrap" align="flex-start">
              <Box
                className="hb-display"
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 9, background: i === 0 ? C.sun : '#fff', border: `2px solid ${C.ink}`, display: 'grid', placeItems: 'center', fontWeight: 600 }}
              >
                {i + 1}
              </Box>
              <Text fz={13} fw={700}>
                {s}
              </Text>
            </Group>
          ))}
          {f.tuition.some((t) => t.gap > 0) && (
            <Button color="coral" rightSection={<IconArrowRight size={18} />} onClick={() => ask('Cover the tuition shortfall from my MYR wallet')}>
              Draft fix #1 for me
            </Button>
          )}
        </Stack>
      )}
      <Text fz={11} fw={700} c={C.inkSoft}>
        {f.disclosure}
      </Text>
    </Stack>
  );
}

export function CreditBlock({ c }: { c: CreditCardData }) {
  const util = c.utilization_pct;
  return (
    <Stack gap={10}>
      <Group justify="space-between" wrap="nowrap" align="flex-end">
        <Box>
          <UtilGauge pct={util} target={c.target_pct} size={170} />
          <Text ta="center" fz={12} fw={800} c={C.inkSoft} mt={-4}>
            {util}% used now · aim under {c.target_pct}%
          </Text>
        </Box>
        <Stack gap={2} align="flex-end">
          <Big size={40}>{c.on_time_streak}</Big>
          <Text fz={12} fw={900} ta="right">
            on-time
            <br />
            streak
          </Text>
        </Stack>
      </Group>
      <StreakDots history={c.payment_history} />
      {c.statement && (
        <Box className="hb-chunk-sm" p={12} style={{ background: C.sunSoft }}>
          <Text fw={900} fz={14.5}>
            {money(c.statement.remaining, c.card.currency)} due {shortDate(c.statement.due_date)} ({c.statement.days_until_due} days)
          </Text>
          <Text fz={13} fw={700} c={C.inkSoft}>
            Pay {money(c.recommended_payment.amount)} now and it reports at {c.recommended_payment.utilization_after_pct}% instead. Streak stays alive.
          </Text>
        </Box>
      )}
      <Group gap={6}>
        <Sticker bg={c.health.key === 'needs_attention' ? C.tomatoSoft : c.health.key === 'fair' ? C.sunSoft : C.mintSoft} rotate={0}>
          Simulated health: {c.health.label}
        </Sticker>
        <Sticker bg="#fff" rotate={0}>Last reported {c.utilization_reported_pct}%</Sticker>
      </Group>
      <Text fz={11} fw={700} c={C.inkSoft}>
        {c.footnote}
      </Text>
    </Stack>
  );
}

export function TuitionBlock({ t }: { t: Omit<TuitionCard, 'type'> }) {
  return (
    <Stack gap={8}>
      {t.installments.map((i, idx) => {
        const covered = idx === 0 ? Math.min(100, (t.tuition_fund_cad / i.amount) * 100) : 0;
        return (
          <Box key={i.term} className="hb-chunk-sm" p={12} style={{ background: idx === 0 ? C.grapeSoft : '#fff' }}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={900} fz={14}>
                {i.term}
              </Text>
              <Text fw={900} fz={14} className="hb-display">
                {money(i.amount, i.currency)}
              </Text>
            </Group>
            <Text fz={12.5} fw={700} c={C.inkSoft}>
              Due {shortDate(i.due)} · in {i.days_until_due} days
            </Text>
            {idx === 0 && <Progress value={covered} color="grape.5" size={12} radius="xl" mt={8} style={{ border: `2px solid ${C.ink}` }} bg="#fff" />}
          </Box>
        );
      })}
      <Row label="Tuition fund" value={money(t.tuition_fund_cad)} />
      <Row label="Still needed for the next one" value={money(t.next_shortfall_cad)} strong />
      <Row label="MYR wallet is worth about" value={money(t.myr_wallet_value_cad)} />
    </Stack>
  );
}

export function ResultCard({ card }: { card: Card }) {
  switch (card.type) {
    case 'balances':
      return (
        <Tile bg="#fff">
          <Head title={money(card.total, card.total_currency)} sub="All your money, in CAD" bg={C.sun} art={<IconWallet size={28} stroke={2.2} />} />
          <Stack gap={8}>
            {card.accounts.map((a) => (
              <Group key={a.label} justify="space-between" className="hb-chunk-sm" p={10} style={{ background: a.sponsor_funded ? C.grapeSoft : C.sunSoft }} wrap="nowrap">
                <Box>
                  <Text fw={900} fz={14}>
                    {a.label}
                  </Text>
                  <Text fz={11.5} fw={700} c={C.inkSoft}>
                    {a.number} {a.sponsor_funded ? '· funded by Dad' : '· yours'}
                  </Text>
                </Box>
                <Text fw={600} fz={16} className="hb-display">
                  {money(a.balance, a.currency)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Tile>
      );
    case 'fx_quotes':
      return (
        <Tile bg="#fff">
          <Head title={`${card.from_currency} → ${card.to_currency} race`} sub="True cost, side by side" bg={C.mint} />
          <FxRace quotes={card.quotes} from={card.from_currency} amount={card.amount} />
          <Box mt={12} className="hb-chunk-sm" p={10} style={{ background: C.mintSoft }}>
            <Text fw={900} fz={14}>
              {card.best} saves you {money(card.saving_vs_worst, card.to_currency)} vs the worst option.
            </Text>
            <Text fz={11.5} fw={700} c={C.inkSoft}>
              Sandbox rate snapshot, not advice.{card.note ? ` ${card.note}` : ''}
            </Text>
          </Box>
        </Tile>
      );
    case 'fx_history':
      return (
        <Tile bg="#fff">
          <Head title={`${card.pair} · last ${card.days} days`} sub="Rate check" bg={C.sky} />
          <Sparkline series={card.series} height={60} />
          <Group gap={6} mt={8}>
            <Sticker bg={C.skySoft} rotate={0}>Today {card.today}</Sticker>
            <Sticker bg="#fff" rotate={0}>Low {card.low}</Sticker>
            <Sticker bg="#fff" rotate={0}>High {card.high}</Sticker>
            <Sticker bg="#fff" rotate={0}>Avg {card.average}</Sticker>
          </Group>
        </Tile>
      );
    case 'tuition':
      return (
        <Tile bg="#fff">
          <Head title="Tuition plan" sub="UBC installments" bg={C.grape} art={<GradCap size={40} />} />
          <TuitionBlock t={card} />
        </Tile>
      );
    case 'budget':
      return (
        <Tile bg="#fff">
          <Head title={`${shortMoney(card.total_spent_cad)} spent`} sub={`Last ${card.period_days} days`} bg={C.coral} />
          <BudgetBars b={card} />
          {card.possible_duplicate_charges.length > 0 && (
            <Text mt={10} fz={12.5} fw={800} c="tomato.7">
              Looks charged twice: {card.possible_duplicate_charges.join(', ')}. Worth a look.
            </Text>
          )}
        </Tile>
      );
    case 'scam_check': {
      const tone = card.verdict === 'likely_scam' ? 'bad' : card.verdict === 'suspicious' ? 'meh' : 'ok';
      const title = card.verdict === 'likely_scam' ? 'Nope. That is a scam.' : card.verdict === 'suspicious' ? 'Hmm, smells a bit off.' : 'No known scam pattern';
      return (
        <Tile bg={tone === 'bad' ? C.tomatoSoft : tone === 'meh' ? C.sunSoft : C.mintSoft}>
          <Group wrap="nowrap" gap={12} mb={10}>
            <ShieldArt size={62} tone={tone} />
            <Box>
              <Eyebrow>Scam shield</Eyebrow>
              <Text className="hb-display" fz={21} fw={600} lh={1.1}>
                {title}
              </Text>
              {card.model_confidence !== undefined && (
                <Text fz={11.5} fw={800} c={C.inkSoft}>
                  Pattern rules + on-device model ({Math.round(card.model_confidence * 100)}% sure)
                </Text>
              )}
            </Box>
          </Group>
          {card.signals.length > 0 && (
            <Group gap={6} mb={10}>
              {card.signals.map((s) => (
                <Sticker key={s.name} bg="#fff" rotate={0}>
                  {s.name}
                </Sticker>
              ))}
            </Group>
          )}
          {card.quote && (
            <Text fz={13} fw={800} fs="italic" mb={8}>
              “{card.quote}”
            </Text>
          )}
          <Stack gap={6}>
            {card.advice.map((a) => (
              <Group key={a} gap={8} wrap="nowrap" align="flex-start">
                <IconChecklist size={18} stroke={2.4} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text fz={13} fw={700}>
                  {a}
                </Text>
              </Group>
            ))}
          </Stack>
        </Tile>
      );
    }
    case 'transactions':
      return (
        <Tile bg="#fff">
          <Head title="Recent spending" sub={`${card.count} transactions`} bg={C.sky} />
          <Stack gap={8}>
            {card.rows.slice(0, 8).map((r, i) => (
              <Group key={i} gap={10} wrap="nowrap">
                <CategoryBadge category={r.category} size={30} />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fz={13.5} fw={800} truncate>
                    {r.counterparty}
                  </Text>
                  <Text fz={11.5} fw={700} c={C.inkSoft}>
                    {shortDate(r.date)} · {r.category}
                  </Text>
                </Box>
                <Text fz={14} fw={600} className="hb-display" c={r.amount < 0 ? C.ink : 'mint.7'}>
                  {r.amount < 0 ? '−' : '+'}
                  {money(Math.abs(r.amount), r.currency)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Tile>
      );
    case 'checklist':
      return (
        <Tile bg="#fff">
          <Head title={card.title} sub="Checklist" bg={C.mint} />
          <Stack gap={6}>
            {card.items.map((it) => (
              <Group key={it} gap={8} wrap="nowrap" align="flex-start">
                <IconChecklist size={18} stroke={2.4} style={{ flexShrink: 0 }} />
                <Text fz={13} fw={700}>
                  {it}
                </Text>
              </Group>
            ))}
          </Stack>
          {card.footnote && (
            <Text fz={11} fw={700} c={C.inkSoft} mt={8}>
              {card.footnote}
            </Text>
          )}
        </Tile>
      );
    case 'forecast':
      return (
        <Tile bg="#fff">
          <Head title={`Runway to ${card.horizon}`} sub={card.account} bg={C.mint} />
          <ForecastBlock f={card} />
        </Tile>
      );
    case 'credit':
      return (
        <Tile bg="#fff">
          <Head title={card.card.label} sub={`Credit builder · ${card.card.number}`} bg={C.coral} />
          <CreditBlock c={card} />
        </Tile>
      );
    default:
      return null;
  }
}
