// Student insights: cash runway forecast (GET /forecast), credit builder, full budget.
import { Box, Button, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';

import { BudgetView, CreditView, ForecastView, TuitionView } from '../components/ResultCards';
import { M3Card, SectionHeader } from '../components/ui';
import { shortDate } from '../format';
import { useStore } from '../store';
import type { CreditCardData, CreditProfile } from '../types';

function toCreditCard(p: CreditProfile | undefined): Omit<CreditCardData, 'type'> | null {
  if (!p || !p.has_card) return null;
  return {
    ...p,
    health: p.credit_health,
    payment_history: p.payment_history.map((h) => h.status),
    footnote: p.disclosure,
  };
}

export function Insights() {
  const { overview: o, forecast: f, openAssistant } = useStore();
  if (!o || !f) {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '24px' }} />
        <Skeleton variant="rounded" height={260} sx={{ borderRadius: '24px' }} />
      </Stack>
    );
  }
  const credit = toCreditCard(o.credit);
  return (
    <Stack spacing={2} sx={{ px: 2, pb: 3 }}>
      <Box sx={{ px: 0.5, pt: 0.5 }}>
        <Typography variant="h5">Insights</Typography>
        <Typography variant="body2" color="text.secondary">
          Forecasts from your usual spending, scheduled bills and pending drafts.
        </Typography>
      </Box>

      <Box>
        <SectionHeader title={`Runway to ${shortDate(f.end_date)}`} />
        <M3Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              {f.account} · projected daily balance · hover for a day
            </Typography>
            <ForecastView f={f} />
            <Button variant="outlined" fullWidth startIcon={<AutoAwesomeRoundedIcon />} sx={{ mt: 2 }} onClick={() => openAssistant('Cover the tuition shortfall from my MYR wallet')}>
              Fix the tuition gap with the assistant
            </Button>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
              {f.disclosure}
            </Typography>
          </CardContent>
        </M3Card>
      </Box>

      <Box>
        <SectionHeader title="Tuition" />
        <M3Card variant="filled" sx={{ bgcolor: (t) => t.m3.surfaceContainerLow }}>
          <CardContent>
            <TuitionView c={o.tuition} />
          </CardContent>
        </M3Card>
      </Box>

      {credit && (
        <Box>
          <SectionHeader title="Credit builder" />
          <M3Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                {credit.card.label} · {credit.card.number}
              </Typography>
              <CreditView c={credit} />
            </CardContent>
          </M3Card>
        </Box>
      )}

      <Box>
        <SectionHeader title="Budget" />
        <M3Card variant="filled" sx={{ bgcolor: (t) => t.m3.surfaceContainerLow }}>
          <CardContent>
            <BudgetView c={o.budget} />
          </CardContent>
        </M3Card>
      </Box>
    </Stack>
  );
}
