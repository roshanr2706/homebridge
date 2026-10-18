// "How I handled this": the visible reasoning under each assistant reply. Collapsed it is one quiet line
// ("How I handled this · 6 steps · 1.2 s" plus the model chip); one tap opens a vertical timeline:
// understood → plan → tools → policy decision → safety → model. Everything comes from the server's turn_trace
// (backend/app/turn_trace.py), which is allow-listed and scrubbed there: no account numbers, tokens, pasted text
// or system prompt ever reach this component. Labels are built here from the structured fields, so both
// languages read naturally; the server's English `label` is only a fallback.
import { useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { TraceStep, TurnTrace } from '../api';
import { useT, type Key, type T } from '../i18n';
import { useFontSet, useTheme, type Theme } from '../theme';
import { Body, Mono, Row } from '../ui';

// ------------------------------------------------------------------ "Show reasoning steps" (Settings)
// On by default: the demo is the point. Kept in localStorage on web, for the session on native.
const KEY = 'homebridge.showSteps';
function loadShow(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    return globalThis.localStorage?.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
let showSteps = loadShow();
const listeners = new Set<() => void>();
export function setShowSteps(on: boolean) {
  showSteps = on;
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(KEY, on ? '1' : '0');
    } catch {
      /* blocked storage: lasts for this session */
    }
  }
  listeners.forEach((f) => f());
}
export function useShowSteps(): boolean {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => showSteps,
    () => showSteps,
  );
}

// ------------------------------------------------------------------ the model chip
const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  'deepseek-pro': 'DeepSeek',
  qwen: 'Qwen',
  'qwen-cn': 'Qwen',
  custom: 'Custom model',
};

/** "DeepSeek · live" or "Offline engine" for a provider name from /health or a chat reply. */
export function engineLabel(tr: T, provider: string): string {
  if (!provider || provider === 'offline') return tr('engine.offline');
  const name = PROVIDER_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${name} · ${tr('engine.live')}`;
}

export function ModelChip({ provider, fallback, onDark }: { provider: string; fallback?: boolean; onDark?: boolean }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const live = !!provider && provider !== 'offline' && !fallback;
  const dot = fallback ? t.warn : live ? t.ok : t.faint;
  const text = fallback ? `${tr('engine.offline')} · ${tr('engine.fallback')}` : engineLabel(tr, provider);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
        backgroundColor: onDark ? 'transparent' : fallback ? t.warnBg : t.sunken,
        borderWidth: onDark ? 1 : 0,
        borderColor: t.border,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      <Body style={{ fontSize: 10.5, lineHeight: 14, color: fallback ? t.warn : t.muted, fontFamily: fonts.bodyMedium }}>{text}</Body>
    </View>
  );
}

// ------------------------------------------------------------------ the timeline
// Chinese names for tools and the offline engine's intents (English comes from the server's labels).
const TOOL_ZH: Record<string, string> = {
  get_balances: '查看余额',
  list_transactions: '查询交易',
  list_payees: '查看收款人',
  get_fx_quotes: '比较汇率报价',
  get_fx_history: '查看 30 天汇率区间',
  get_tuition_schedule: '查看学费安排',
  budget_summary: '汇总支出',
  credit_building_plan: '制定信用计划',
  get_credit_profile: '读取信用档案',
  prepare_card_payment: '起草还卡',
  check_message_for_scam: '扫描诈骗信号',
  get_pending_actions: '查看待处理草稿',
  get_limits: '查看限额',
  get_data_sharing: '查看数据共享',
  set_budget: '设置预算',
  create_reminder: '创建提醒',
  request_sponsor_topup: '起草向爸爸的申请',
  get_remittance_status: '跟踪爸爸的汇款',
  prepare_transfer: '起草付款',
  prepare_conversion: '起草兑换',
  add_payee: '申请新收款人',
  cancel_pending_action: '取消草稿',
  forecast_cashflow: '预测现金流',
  freeze_payments: '锁定付款',
  list_mandates: '查看自动驾驶',
  propose_mandate: '提议自动驾驶规则',
};

const INTENT_ZH: Record<string, string> = {
  lock: '锁定付款',
  scam_check: '检查信息是否诈骗',
  pay: '向已保存的收款人付款',
  convert: '兑换或转移资金',
  card_payment: '还信用卡',
  ask_sponsor: '向爸爸要钱',
  new_payee: '添加新收款人',
  change_draft: '修改草稿',
  autopilot: '自动驾驶',
  reminder: '设置提醒',
  budget: '设置预算',
  forecast: '现金流预测',
  fx_compare: '比较汇款方式',
  fx_history: '汇率区间',
  remittance: '跟踪爸爸的汇款',
  credit: '信用问题',
  tuition: '学费检查',
  spending: '支出问题',
  privacy: '隐私问题',
  limits: '限额问题',
  drafts: '待处理草稿',
  balances: '余额',
  payees: '收款人',
  refuse: '操纵企图：拒绝，不调用工具',
  ask: '还缺一个细节：提问',
  answer: '直接回答',
};

const FLAG_KEY: Record<string, Key> = {
  scam: 'flag.scam',
  injection: 'flag.injection',
  extraction: 'flag.extraction',
  escalation: 'flag.escalation',
};

const GLYPH: Record<TraceStep['type'], string> = {
  understood: '◎',
  plan: '↳',
  tool: 'ƒ',
  policy: '§',
  safety: '✓',
  model: '◆',
};

function seconds(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function toolName(tr: T, tool: string, fallback: string): string {
  return tr.lang === 'zh' ? (TOOL_ZH[tool] ?? fallback) : fallback;
}

function flagNames(tr: T, flags: string[]): string {
  return flags.map((f) => (FLAG_KEY[f] ? tr(FLAG_KEY[f]) : f)).join(tr.lang === 'zh' ? '、' : ', ');
}

/** The colour of a step's node: what it means, from the theme tokens. */
function tone(t: Theme, s: TraceStep): string {
  switch (s.type) {
    case 'understood':
      return s.verdict === 'flagged' || s.carried.length ? t.warn : t.accent;
    case 'plan':
      return t.accent;
    case 'tool':
      return s.ok ? t.muted : t.danger;
    case 'policy':
      return s.next === 'blocked' ? t.danger : s.next === 'sponsor' || s.next === 'user_then_sponsor' ? t.gold : t.accent;
    case 'safety':
      return s.kind === 'clear' ? t.ok : s.kind === 'untrusted' ? t.muted : t.warn;
    case 'model':
      return s.fallback ? t.warn : s.live ? t.ok : t.faint;
  }
}

/** Title and detail lines of a step, in the reader's language. */
function describe(tr: T, s: TraceStep): { title: string; lines: string[]; meta?: string } {
  const sep = tr.lang === 'zh' ? '；' : '; ';
  switch (s.type) {
    case 'understood': {
      const langName = (['en', 'ms', 'zh'] as const).includes(s.lang as 'en') ? tr(`trace.lang.${s.lang}` as Key) : s.lang;
      const parts = [tr('trace.read', { lang: langName })];
      parts.push(s.flags.length ? tr('trace.flagged', { flags: flagNames(tr, s.flags) }) : tr('trace.clear'));
      if (s.carried.length) parts.push(tr('trace.carried', { flags: flagNames(tr, s.carried) }));
      const lines = s.signals.map((x) => tr.d(x));
      if (s.classifier && !s.signals.length)
        lines.push(tr('trace.classifier', { label: flagNames(tr, [s.classifier.label]), pct: Math.round(s.classifier.confidence * 100) }));
      return { title: parts.join(sep), lines };
    }
    case 'plan': {
      if (s.source === 'model') {
        const names = s.tools.map((x) => toolName(tr, x, x)).join(' → ');
        const title = !s.tools.length
          ? tr('trace.noTools')
          : tr(s.tools.length === 1 ? 'trace.choseOne' : 'trace.chose', { n: s.tools.length, tools: names });
        return { title, lines: [], meta: s.rounds ? tr('trace.rounds', { n: s.rounds }) : undefined };
      }
      const intent = tr.lang === 'zh' ? (INTENT_ZH[s.intent ?? ''] ?? s.intent_label ?? '') : (s.intent_label ?? s.intent ?? '');
      return { title: tr('trace.intent', { intent }), lines: [] };
    }
    case 'tool':
      return {
        title: toolName(tr, s.tool, s.label),
        lines: s.summary ? [s.summary] : [],
        meta: `${s.tier ? s.tier + ' · ' : ''}${s.ok ? seconds(s.ms) : tr('trace.failed', { code: s.error ?? 'error' })}`,
      };
    case 'policy': {
      const tierWord = ['T1', 'T2', 'T3'].includes(s.tier) ? tr(`trace.tier.${s.tier}` as Key) : '';
      const outcome = ['clear', 'flag', 'block', 'report'].includes(s.compliance.outcome)
        ? tr(`trace.outcome.${s.compliance.outcome}` as Key)
        : s.compliance.outcome;
      return {
        title: tr(`trace.next.${s.next}` as Key),
        lines: [
          tr.summary(s.summary),
          ...s.reasons.map((r) => tr.d(r)),
          tr('trace.compliance', { outcome, n: s.compliance.checks }) +
            (s.compliance.noted.length ? ` · ${s.compliance.noted.map((x) => tr.d(x)).join(', ')}` : ''),
        ].filter(Boolean),
        meta: tr('trace.risk', { tier: tierWord ? `${s.tier} (${tierWord})` : s.tier, risk: s.risk_score }),
      };
    }
    case 'safety': {
      const key = `trace.safety.${s.kind}` as Key;
      const known = ['clear', 'tool_output_scan', 'redaction', 'nudge', 'false_claim', 'fallback', 'circuit_open', 'loop_guard', 'step_limit', 'untrusted'];
      const tool = s.tool ? toolName(tr, s.tool, s.tool) : '';
      return { title: known.includes(s.kind) ? tr(key, { tool, what: s.what ?? '', reason: s.reason ?? '' }) : s.label, lines: [] };
    }
    case 'model': {
      const chip = s.fallback ? `${tr('engine.offline')} · ${tr('engine.fallback')}` : s.live ? `${s.name} · ${s.model}` : tr('engine.offline');
      const meta = [tr('trace.calls', { n: s.model_calls, time: seconds(s.model_ms) })];
      if (s.retries) meta.push(tr('trace.retries', { n: s.retries }));
      if (s.live || s.fallback) meta.push(tr('trace.prompt', { v: s.prompt_version }));
      return { title: chip, lines: [], meta: meta.join(' · ') };
    }
  }
}

const STEP_KEY: Record<TraceStep['type'], Key> = {
  understood: 'trace.step.understood',
  plan: 'trace.step.plan',
  tool: 'trace.step.tool',
  policy: 'trace.step.policy',
  safety: 'trace.step.safety',
  model: 'trace.step.model',
};

function Step({ step, last }: { step: TraceStep; last: boolean }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const c = tone(t, step);
  const d = describe(tr, step);
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ alignItems: 'center', width: 20 }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: c,
            backgroundColor: t.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Body style={{ fontSize: 10.5, lineHeight: 13, color: c, fontFamily: fonts.bodyBold }}>{step.type === 'safety' && step.kind !== 'clear' ? '!' : GLYPH[step.type]}</Body>
        </View>
        {!last && <View style={{ flex: 1, width: 1.5, backgroundColor: t.border, marginVertical: 2 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 12, gap: 2 }}>
        <Row style={{ gap: 6, justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Body style={{ fontSize: 10, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase', color: c, fontFamily: fonts.bodyBold }}>
            {tr(STEP_KEY[step.type])}
          </Body>
          {d.meta ? (
            <Mono style={{ fontSize: 10, color: t.faint, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
              {d.meta}
            </Mono>
          ) : null}
        </Row>
        <Body style={{ fontSize: 13, lineHeight: 18, color: t.text }}>{d.title}</Body>
        {d.lines.map((l, i) => (
          <Body key={i} style={{ fontSize: 12, lineHeight: 17, color: t.muted }}>
            {l}
          </Body>
        ))}
      </View>
    </View>
  );
}

export function TracePanel({ trace }: { trace: TurnTrace }) {
  const t = useTheme();
  const fonts = useFontSet();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const steps = trace.steps ?? [];
  if (!steps.length) return null;
  const e = trace.engine;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={tr(open ? 'trace.collapse' : 'trace.expand')}
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start', maxWidth: '100%' })}
      >
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Body style={{ fontSize: 11.5, lineHeight: 16, color: t.muted, fontFamily: fonts.bodyMedium }}>
            {open ? '▾' : '▸'} {tr('trace.title')}
            <Body style={{ fontSize: 11.5, lineHeight: 16, color: t.faint }}>
              {' · '}
              {tr('trace.steps', { n: trace.step_count || steps.length })} · {seconds(trace.total_ms)}
            </Body>
          </Body>
          <ModelChip provider={e.provider} fallback={e.fallback} />
        </Row>
      </Pressable>
      {open && (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            borderRadius: t.radiusSm,
            padding: 12,
          }}
        >
          {steps.map((s, i) => (
            <Step key={i} step={s} last={i === steps.length - 1} />
          ))}
          <Body style={{ fontSize: 10.5, lineHeight: 15, color: t.faint, marginTop: 10 }}>{tr('trace.never')}</Body>
        </View>
      )}
    </View>
  );
}
