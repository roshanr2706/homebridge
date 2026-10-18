import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { api, type AuditEntry, type Role, type Verify } from '../api';
import { usePoll } from '../hooks';
import { useT } from '../i18n';
import { useTheme } from '../theme';
import { Body, Button, Display, Eyebrow, Mono, Pill, Row, Surface } from '../ui';

const EVENT_TONE: Record<string, 'ok' | 'danger' | 'warn' | 'accent' | 'plain' | 'gold'> = {
  action_executed: 'ok',
  sponsor_approved: 'ok',
  action_confirmed: 'accent',
  action_drafted: 'gold',
  sponsor_rejected: 'danger',
  confirm_denied: 'danger',
  sponsor_denied: 'danger',
  tool_denied: 'danger',
  action_failed: 'danger',
  rate_limited: 'warn',
  limits_changed: 'warn',
  llm_error: 'warn',
  payments_frozen: 'danger',
  payments_unfrozen: 'warn',
  unfreeze_denied: 'danger',
  alert_raised: 'warn',
  compliance_check: 'accent',
  sanctions_hit: 'danger',
  sanctions_review: 'warn',
  kyc_denied: 'danger',
  sponsor_pin_failed: 'danger',
  sponsor_pin_locked: 'danger',
  reset_denied: 'danger',
};

function summary(e: AuditEntry): string {
  const d = e.data ?? {};
  if (e.event === 'tool_call') return `${d.tool} (${d.tier})${d.ok === false ? ' · refused' : ''}`;
  if (e.event === 'user_message') return `${d.chars} chars${d.guard?.length ? ` · flagged: ${d.guard.join(', ')}` : ''}`;
  if (e.event === 'assistant_reply') return d.tools?.length ? `used ${d.tools.join(', ')}` : 'no tools';
  if (e.event === 'action_drafted') return `${d.kind} ${d.tier} · risk ${d.risk}`;
  if (e.event === 'limits_changed') return `single ${d.before?.single_cad} → ${d.after?.single_cad}, daily ${d.before?.daily_cad} → ${d.after?.daily_cad}`;
  if (e.event === 'payments_frozen') return `by ${d.by} · ${d.scope === 'all' ? 'everything' : 'sponsor-funded money'}`;
  if (e.event === 'payments_unfrozen') return `by ${d.by} · still locked: ${d.still_locked?.length ? d.still_locked.join(', ') : 'nothing'}`;
  if (e.event === 'alert_raised') return d.kind + (d.count ? ` · ${d.count}` : '');
  if (e.event === 'compliance_check')
    return `${d.kind} · ${d.outcome}${d.reports?.length ? ` · ${d.reports.join(', ')}` : ''}${d.purpose_code ? ` · ${d.purpose_code}` : ''}`;
  if (e.event === 'sanctions_hit' || e.event === 'sanctions_review') return `${d.match} (${d.list}, ${Math.round(d.score * 100)}%)`;
  if (e.event === 'sponsor_pin_failed') return `${d.purpose} · ${d.reason}${d.attempts ? ` · attempt ${d.attempts}` : ''}`;
  if (d.action_id) return d.action_id + (d.reason ? ` · ${d.reason}` : '') + (d.note ? ` · “${d.note}”` : '');
  return '';
}

export function LedgerScreen({ active, role }: { active: boolean; role: Role }) {
  const t = useTheme();
  const tr = useT();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [tamper, setTamper] = useState<Verify | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<{ visible: number; total: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([api.audit(role), api.auditVerify(role)]);
      setEntries(a.entries.slice().reverse());
      setScope({ visible: a.visible, total: a.total });
      setVerify(v);
      setError('');
    } catch {
      setError(api.unreachable);
    }
  }, [role]);

  usePoll(refresh, 4000, active);

  const simulate = async (seq: number) => {
    try {
      setTamper(await api.auditVerify(role, seq));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View style={{ paddingVertical: 6 }}>
        <Display style={{ fontSize: 24 }}>{tr('le.title')}</Display>
        <Body style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
          {tr('le.intro')}
        </Body>
        {scope ? (
          <Body style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
            {tr(role === 'sponsor' ? 'le.scopeSponsor' : 'le.scopeStudent', { v: scope.visible, t: scope.total })}{' '}
            {tr('le.scopeChain', { t: scope.total })}
          </Body>
        ) : null}
      </View>
      {error ? <Body style={{ color: t.danger }}>{error}</Body> : null}
      {verify && (
        <Surface tone={verify.ok ? 'ok' : 'danger'}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Eyebrow style={{ color: verify.ok ? t.ok : t.danger }}>{tr(verify.ok ? 'le.verified' : 'le.broken')}</Eyebrow>
              <Body style={{ fontSize: 14, marginTop: 2 }}>
                {verify.ok ? tr('le.okCount', { n: verify.count }) : tr('le.brokenCount', { n: verify.count, at: verify.broken_at ?? '?' })}
              </Body>
              {verify.head ? <Mono style={{ fontSize: 11, color: t.faint, marginTop: 4 }}>{tr('le.head', { h: verify.head.slice(0, 24) })}</Mono> : null}
            </View>
            <Button label={tr('le.reverify')} kind="ghost" onPress={refresh} />
          </Row>
        </Surface>
      )}
      <Surface style={{ backgroundColor: t.sunken }}>
        <Eyebrow>{tr('le.tryTitle')}</Eyebrow>
        <Body style={{ fontSize: 13, marginTop: 4 }}>
          {tr('le.tryBody')}
        </Body>
        {tamper && (
          <Row style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Pill label={tr('le.edited', { n: tamper.simulated_tamper_seq ?? '?' })} tone="warn" />
            <Pill label={tamper.ok ? tr('le.notDetected') : tr('le.detected', { n: tamper.broken_at ?? '?' })} tone={tamper.ok ? 'danger' : 'ok'} />
          </Row>
        )}
      </Surface>
    </View>
  );

  return (
    <FlatList
      showsVerticalScrollIndicator={false}
      data={entries}
      keyExtractor={(e) => String(e.seq)}
      ListHeaderComponent={header}
      contentContainerStyle={{ padding: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      renderItem={({ item: e }) => {
        const hit = tamper && !tamper.ok && tamper.broken_at === e.seq;
        return (
          <Pressable
            onPress={() => simulate(e.seq)}
            accessibilityRole="button"
            accessibilityLabel={tr('le.simulate', { n: e.seq })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: 10,
              paddingVertical: 8,
              paddingHorizontal: 8,
              borderRadius: 8,
              backgroundColor: hit ? t.dangerBg : pressed ? t.sunken : 'transparent',
            })}
          >
            <View style={{ alignItems: 'center', width: 36 }}>
              <Mono style={{ fontSize: 11, color: t.faint }}>#{e.seq}</Mono>
              <View style={{ flex: 1, width: 1, backgroundColor: t.border, marginTop: 4 }} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                <Pill label={e.event.replace(/_/g, ' ')} tone={EVENT_TONE[e.event] ?? 'plain'} />
                <Body style={{ fontSize: 11, color: t.muted }}>
                  {e.actor} · {new Date(e.ts * 1000).toLocaleTimeString('en-GB')}
                </Body>
              </Row>
              {summary(e) ? (
                <Body style={{ fontSize: 12.5 }} numberOfLines={2}>
                  {summary(e)}
                </Body>
              ) : null}
              <Mono style={{ fontSize: 10, color: hit ? t.danger : t.faint }}>
                prev {e.prev.slice(0, 10)}… → {e.hash.slice(0, 10)}…{hit ? tr('le.mismatch') : ''}
              </Mono>
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={<Body style={{ color: t.muted }}>{tr('le.empty')}</Body>}
      ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
      extraData={[tamper, tr]}
    />
  );
}

