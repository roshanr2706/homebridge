import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Action } from '../api';
import { useTheme } from '../theme';

type Props = {
  action: Action;
  mode: 'student' | 'sponsor';
  onConfirm?: (a: Action) => Promise<void>;
  onCancel?: (a: Action) => Promise<void>;
  onApprove?: (a: Action) => Promise<void>;
  onReject?: (a: Action) => Promise<void>;
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_user: 'Waiting for your confirmation',
  awaiting_sponsor: 'Waiting for sponsor approval',
  executed: 'Done',
  rejected: 'Rejected by sponsor',
  cancelled: 'Cancelled',
  expired: 'Expired',
  failed: 'Failed',
};

export function ActionCard({ action, mode, onConfirm, onCancel, onApprove, onReject }: Props) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const risky = action.risk_score >= 40;
  const run = (fn?: (a: Action) => Promise<void>) => async () => {
    if (!fn) return;
    setBusy(true);
    try {
      await fn(action);
    } finally {
      setBusy(false);
    }
  };
  const failed = action.status === 'failed' && action.result && (action.result as { error?: string }).error;

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: risky ? t.danger : t.border }]}>
      <View style={styles.row}>
        <Text style={[styles.tier, { color: t.muted, borderColor: t.border }]}>{action.tier}</Text>
        <Text style={[styles.status, { color: t.muted }]}>{STATUS_LABEL[action.status] ?? action.status}</Text>
      </View>
      <Text style={[styles.summary, { color: t.text }]}>{action.summary}</Text>

      {action.needs_sponsor_approval && action.status === 'awaiting_user' && (
        <Text style={[styles.note, { color: t.muted }]}>After you confirm, your sponsor also has to approve this.</Text>
      )}

      {action.risk_reasons.length > 0 && (
        <View style={[styles.box, { backgroundColor: risky ? t.dangerBg : t.warnBg }]}>
          <Text style={[styles.boxTitle, { color: risky ? t.danger : t.warn }]}>
            Risk score {action.risk_score}/100
          </Text>
          {action.risk_reasons.map((r) => (
            <Text key={r} style={[styles.boxLine, { color: risky ? t.danger : t.warn }]}>• {r}</Text>
          ))}
        </View>
      )}
      {action.warnings.map((w) => (
        <Text key={w} style={[styles.note, { color: t.warn }]}>{w}</Text>
      ))}
      {failed ? <Text style={[styles.note, { color: t.danger }]}>{String(failed)}</Text> : null}

      {busy ? (
        <ActivityIndicator style={{ marginTop: 10 }} color={t.accent} />
      ) : mode === 'student' && action.status === 'awaiting_user' ? (
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={run(onCancel)}
            style={[styles.btn, { borderColor: t.border }]}
          >
            <Text style={{ color: t.text, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={run(onConfirm)}
            style={[styles.btn, { backgroundColor: t.accent, borderColor: t.accent }]}
          >
            <Text style={{ color: t.accentText, fontWeight: '700' }}>Confirm</Text>
          </Pressable>
        </View>
      ) : mode === 'sponsor' && action.status === 'awaiting_sponsor' ? (
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" onPress={run(onReject)} style={[styles.btn, { borderColor: t.danger }]}>
            <Text style={{ color: t.danger, fontWeight: '600' }}>Reject</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={run(onApprove)}
            style={[styles.btn, { backgroundColor: t.accent, borderColor: t.accent }]}
          >
            <Text style={{ color: t.accentText, fontWeight: '700' }}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  tier: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  status: { fontSize: 12 },
  summary: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  note: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  box: { borderRadius: 8, padding: 10, marginTop: 10 },
  boxTitle: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  boxLine: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { borderWidth: 1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 18 },
});
