// The body of a drafted action: amount, payee, tier and risk chips, why it needs the sponsor, the
// Drafted → You confirm → Dad approves → Done stepper. Shared by the student's review sheet and the
// sponsor's approval cards.
import { useState, type ReactElement } from 'react';
import { Alert, AlertTitle, Box, ButtonBase, Collapse, LinearProgress, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import PolicyRoundedIcon from '@mui/icons-material/PolicyRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import FamilyRestroomRoundedIcon from '@mui/icons-material/FamilyRestroomRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';

import { cap, headline, isMove, money } from '../format';
import type { Action, Compliance, ComplianceCheck } from '../types';
import { KeyValue, ToneChip } from './ui';

type StepState = 'done' | 'current' | 'todo' | 'bad';
export type Mode = 'student' | 'sponsor';

export function actionSteps(a: Action, mode: Mode): { label: string; state: StepState }[] {
  const bad = ['rejected', 'cancelled', 'expired', 'failed', 'blocked'].includes(a.status);
  const out: { label: string; state: StepState }[] = [{ label: 'Drafted', state: 'done' }];
  if (a.kind !== 'topup') {
    out.push({
      label: mode === 'sponsor' ? 'Aisha confirms' : 'You confirm',
      state: a.user_confirmed ? 'done' : a.status === 'awaiting_user' ? 'current' : bad ? 'bad' : 'todo',
    });
  }
  if (a.needs_sponsor_approval) {
    out.push({
      label: mode === 'sponsor' ? 'You approve' : 'Dad approves',
      state:
        a.sponsor_decision === 'approved'
          ? 'done'
          : a.sponsor_decision === 'rejected'
            ? 'bad'
            : a.status === 'awaiting_sponsor'
              ? 'current'
              : bad && a.user_confirmed
                ? 'bad'
                : 'todo',
    });
  }
  out.push({
    label: a.status === 'failed' ? 'Failed' : 'Done',
    state: a.status === 'executed' ? 'done' : a.status === 'failed' ? 'bad' : 'todo',
  });
  return out;
}

export function ActionStepper({ a, mode }: { a: Action; mode: Mode }) {
  const steps = actionSteps(a, mode);
  const active = steps.findIndex((s) => s.state !== 'done');
  return (
    <Stepper activeStep={active === -1 ? steps.length : active} alternativeLabel sx={{ mx: -1 }}>
      {steps.map((s) => (
        <Step key={s.label} completed={s.state === 'done'}>
          <StepLabel error={s.state === 'bad'}>{s.label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}

export const TIER_LABEL: Record<string, { label: string; icon: ReactElement }> = {
  T2: { label: 'T2 · You confirm', icon: <PersonRoundedIcon /> },
  T3: { label: 'T3 · You + Dad', icon: <FamilyRestroomRoundedIcon /> },
  T1: { label: 'T1 · Sponsor decides', icon: <FamilyRestroomRoundedIcon /> },
};

export function TierChip({ tier, mode }: { tier: string; mode: Mode }) {
  const t = TIER_LABEL[tier] ?? { label: tier, icon: <ShieldRoundedIcon /> };
  const label = mode === 'sponsor' && tier === 'T3' ? 'T3 · Needs you' : t.label;
  return <ToneChip tone={tier === 'T3' ? 'tertiary' : 'secondary'} icon={t.icon} label={label} />;
}

function details(a: Action): [string, string][] {
  const p = a.params;
  if (a.kind === 'transfer') {
    const rows: [string, string][] = [
      ['To', p.payee_name],
      ['From', p.from_account],
    ];
    if (p.memo) rows.push(['Memo', p.memo]);
    return rows;
  }
  if (isMove(a)) return [['Fee', 'None, between your own accounts']];
  if (a.kind === 'conversion')
    return [
      ['From', p.from_account ?? p.from_currency],
      ['Rate', `${p.rate} ${p.to_currency} per ${p.from_currency}`],
      ['You receive', money(p.expected_receive, p.to_currency)],
    ];
  return [];
}

const CHECK_ICON: Record<ComplianceCheck['status'], { icon: ReactElement; color: string }> = {
  pass: { icon: <CheckCircleRoundedIcon />, color: 'success.main' },
  flag: { icon: <FlagRoundedIcon />, color: 'warning.main' },
  block: { icon: <BlockRoundedIcon />, color: 'error.main' },
  report: { icon: <DescriptionRoundedIcon />, color: 'info.main' },
  na: { icon: <RemoveCircleOutlineRoundedIcon />, color: 'text.disabled' },
};

/** Sanctions, KYC, structuring, FINTRAC/BNM reporting: one line per check from backend/app/compliance.py. */
function ComplianceBlock({ c }: { c: Compliance }) {
  const t = useTheme();
  const [open, setOpen] = useState(c.outcome !== 'clear');
  const tone = c.outcome === 'blocked' ? 'error' : c.outcome === 'review' ? 'warning' : 'success';
  const passed = c.checks.filter((k) => k.status === 'pass').length;
  return (
    <Box sx={{ border: `1px solid ${t.m3.outlineVariant}`, borderRadius: '16px', overflow: 'hidden' }}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 2, py: 1.25, fontFamily: 'inherit', textAlign: 'left' }}
      >
        <PolicyRoundedIcon sx={{ color: t.m3.onSurfaceVariant }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2">Compliance checks</Typography>
          <Typography variant="caption" color="text.secondary">
            {passed} of {c.checks.length} passed{c.purpose_code ? ` · purpose ${c.purpose_code.code}` : ''}
            {c.cross_border ? ' · cross-border' : ''}
          </Typography>
        </Box>
        <ToneChip tone={tone} label={c.outcome === 'clear' ? 'Clear' : c.outcome === 'review' ? 'Review' : 'Blocked'} />
        <ExpandMoreRoundedIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'text.secondary' }} />
      </ButtonBase>
      <Collapse in={open}>
        <Stack spacing={1} sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
          {c.block_reason && (
            <Typography variant="body2" color="error" sx={{ fontWeight: 650 }}>
              {c.block_reason}
            </Typography>
          )}
          {c.checks.map((k) => (
            <Stack key={k.id} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ color: CHECK_ICON[k.status]?.color, '& svg': { fontSize: 18 }, mt: '1px' }}>{CHECK_ICON[k.status]?.icon}</Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {k.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {k.detail}
                </Typography>
              </Box>
            </Stack>
          ))}
          {c.reports.map((r) => (
            <Typography key={r} variant="caption" color="text.secondary">
              Report: {r}
            </Typography>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export function ActionDetails({ a, mode }: { a: Action; mode: Mode }) {
  const t = useTheme();
  const h = headline(a);
  const sponsorWhy = a.sponsor_reasons ?? [];
  const signals = a.risk_signals ?? a.risk_reasons.filter((r) => !sponsorWhy.includes(r));
  const risky = a.risk_score >= 40;
  const untrusted = Object.entries(a.provenance ?? {})
    .filter(([, v]) => v === 'untrusted')
    .map(([k]) => k);
  const frozen = a.frozen && ['awaiting_user', 'awaiting_sponsor'].includes(a.status) ? a.frozen : null;
  const warnings = a.warnings.filter((w) => !w.startsWith('Payments are locked'));

  return (
    <Stack spacing={2}>
      <Box>
        <Typography sx={{ fontSize: a.kind === 'add_payee' ? 26 : 36, fontWeight: 750, letterSpacing: '-0.02em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
          {h.big}
        </Typography>
        {h.sub && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.25 }}>
            {h.sub}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <TierChip tier={a.tier} mode={mode} />
          <ToneChip
            tone={risky ? 'error' : a.risk_score > 0 ? 'warning' : 'success'}
            icon={risky ? <GppMaybeRoundedIcon /> : <ShieldRoundedIcon />}
            label={`Risk ${a.risk_score}/100`}
          />
          {frozen && <ToneChip tone="error" icon={<LockRoundedIcon />} label="Locked" />}
        </Stack>
      </Box>

      {details(a).length > 0 && (
        <Box sx={{ bgcolor: t.m3.surfaceContainerLowest, borderRadius: '16px', px: 2, py: 1 }}>
          {details(a).map(([k, v]) => (
            <KeyValue key={k} k={k} v={v} />
          ))}
        </Box>
      )}

      {a.compliance && <ComplianceBlock c={a.compliance} />}

      {untrusted.length > 0 && (
        <Alert severity="error" icon={<GppMaybeRoundedIcon />}>
          <AlertTitle sx={{ fontWeight: 750 }}>Check this against an official source</AlertTitle>
          The {untrusted.join(' and ')} came from a message you pasted or quoted, not from you.
        </Alert>
      )}

      {sponsorWhy.length > 0 && (
        <Alert severity="info" icon={<FamilyRestroomRoundedIcon />}>
          <AlertTitle sx={{ fontWeight: 750 }}>{mode === 'sponsor' ? 'Why this came to you' : 'Why Dad approves this too'}</AlertTitle>
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {sponsorWhy.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </Box>
        </Alert>
      )}

      {signals.length > 0 && (
        <Alert severity={risky ? 'error' : 'warning'} icon={<GppMaybeRoundedIcon />}>
          <AlertTitle sx={{ fontWeight: 750 }}>Risk signals</AlertTitle>
          <LinearProgress variant="determinate" value={a.risk_score} color={risky ? 'error' : 'warning'} sx={{ my: 1, bgcolor: 'rgba(0,0,0,.08)' }} />
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {signals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </Box>
        </Alert>
      )}

      {frozen && (
        <Alert severity="error" icon={<LockRoundedIcon />}>
          <AlertTitle sx={{ fontWeight: 750 }}>Payments are locked</AlertTitle>
          {cap(frozen)}. Nothing can be confirmed or approved while payments are locked.
        </Alert>
      )}

      {warnings.map((w) => (
        <Alert key={w} severity="warning">
          {w}
        </Alert>
      ))}

      <Box sx={{ pt: 0.5 }}>
        <ActionStepper a={a} mode={mode} />
      </Box>

      {a.sponsor_note ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Dad’s note: “{a.sponsor_note}”
        </Typography>
      ) : null}
      {a.status === 'failed' && a.result?.error ? (
        <Alert severity="error">{String(a.result.error)}</Alert>
      ) : null}
      {a.status === 'executed' && a.result?.new_balance !== undefined ? (
        <Alert severity="success">Done. New balance {money(Number(a.result.new_balance), a.params.currency ?? a.params.from_currency ?? 'CAD')}.</Alert>
      ) : null}
    </Stack>
  );
}
