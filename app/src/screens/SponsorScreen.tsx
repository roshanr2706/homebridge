import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, type Account, type Action } from '../api';
import { ActionCard } from '../components/ActionCard';
import { money, useTheme } from '../theme';

export function SponsorScreen() {
  const t = useTheme();
  const [queue, setQueue] = useState<Action[]>([]);
  const [recent, setRecent] = useState<Action[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [audit, setAudit] = useState<{ ok: boolean; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [q, o, v] = await Promise.all([api.sponsorQueue(), api.sponsorOverview(), api.auditVerify()]);
      setQueue(q.actions);
      setRecent(o.recent.filter((a) => a.status !== 'awaiting_sponsor').reverse());
      setAccounts(o.accounts);
      setLimits(o.limits);
      setAudit(v);
      setError('');
    } catch (e) {
      setError(`Can't reach the server at ${api.base}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const decide = (approve: boolean) => async (a: Action) => {
    try {
      await (approve ? api.approve(a.action_id) : api.reject(a.action_id));
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 6 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      <Text style={[styles.h1, { color: t.text }]}>Encik Rahman · sponsor view</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        You approve large payments, new payees and spending from the money you send Aisha.
      </Text>
      {error ? <Text style={{ color: t.danger, marginTop: 6 }}>{error}</Text> : null}

      <Text style={[styles.h2, { color: t.text }]}>Waiting for you ({queue.length})</Text>
      {queue.length === 0 ? (
        <Text style={{ color: t.muted }}>Nothing to approve right now.</Text>
      ) : (
        queue.map((a) => (
          <ActionCard key={a.action_id} action={a} mode="sponsor" onApprove={decide(true)} onReject={decide(false)} />
        ))
      )}

      <Text style={[styles.h2, { color: t.text }]}>Aisha's accounts</Text>
      {accounts.map((a) => (
        <View key={a.id} style={[styles.row, { borderColor: t.border }]}>
          <Text style={{ color: t.text }}>
            {a.label} {a.number}
          </Text>
          <Text style={{ color: t.text, fontWeight: '700' }}>{money(a.balance, a.currency)}</Text>
        </View>
      ))}

      <Text style={[styles.h2, { color: t.text }]}>Rules you set</Text>
      <View style={[styles.rules, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Text style={{ color: t.text }}>Single payment Aisha can confirm alone: CAD {limits.single_cad?.toLocaleString()}</Text>
        <Text style={{ color: t.text }}>24-hour limit: CAD {limits.daily_cad?.toLocaleString()}</Text>
        <Text style={{ color: t.text }}>New payee cooling period: {limits.payee_cooling_seconds} s (demo mode)</Text>
      </View>

      <Text style={[styles.h2, { color: t.text }]}>Recent activity</Text>
      {recent.slice(0, 8).map((a) => (
        <View key={a.action_id} style={[styles.row, { borderColor: t.border }]}>
          <Text style={{ color: t.text, flex: 1, paddingRight: 8 }}>{a.summary}</Text>
          <Text style={{ color: a.status === 'executed' ? t.ok : t.muted, fontSize: 12 }}>{a.status}</Text>
        </View>
      ))}

      {audit && (
        <Text style={{ color: audit.ok ? t.ok : t.danger, fontSize: 12, marginTop: 14 }}>
          Audit log: {audit.count} entries, hash chain {audit.ok ? 'verified' : 'BROKEN'}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '700', marginTop: 18, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  rules: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
