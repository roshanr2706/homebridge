// Full-screen assistant (opened from the FAB). Chat with result cards; drafted payments open the review sheet.
import { forwardRef, useEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { Avatar, Box, Button, Chip, Dialog, IconButton, InputBase, Slide, Stack, Tooltip, Typography } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import { keyframes, useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';

import { api, newSessionId } from '../api';
import { TierChip } from '../components/ActionDetails';
import { ResultCard } from '../components/ResultCards';
import { IconBadge, ToneChip } from '../components/ui';
import { headline, STATUS } from '../format';
import { useStore } from '../store';
import type { Action, Card } from '../types';

const SlideUp = forwardRef(function SlideUp(props: TransitionProps & { children: ReactElement }, ref: Ref<unknown>) {
  return <Slide direction="up" ref={ref} {...props} />;
});

type Msg = { id: number; role: 'user' | 'assistant'; text: string; cards?: Card[]; actions?: Action[]; flags?: string[]; error?: boolean };

const SCAM_TEXT =
  'I got a text: "This is the CRA. You owe $1,850 in back taxes. Pay today with Apple gift cards or police will arrest you." Is this real?';

export const SUGGESTIONS: { label: string; message: string }[] = [
  { label: 'How much money do I have?', message: 'How much money do I have?' },
  { label: 'Cheapest MYR → CAD', message: 'Cheapest way to change 5,000 MYR to CAD?' },
  { label: 'Will I run out before tuition?', message: 'Will I run out of money before tuition is due?' },
  { label: 'How’s my credit?', message: 'How’s my credit?' },
  { label: 'Pay rent', message: 'Pay rent to my landlord' },
  { label: 'Pay spring tuition', message: 'Pay my spring tuition' },
  { label: 'Is this CRA text a scam?', message: SCAM_TEXT },
  { label: '我的钱够用到学期末吗？', message: '我的钱够用到学期末吗？' },
];

const bounce = keyframes`0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}`;

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function DraftChip({ a }: { a: Action }) {
  const { actions, openReview } = useStore();
  const t = useTheme();
  const live = actions.find((x) => x.action_id === a.action_id);
  const cur = live ? { ...live, confirm_token: live.confirm_token ?? a.confirm_token } : a;
  const h = headline(cur);
  const st = STATUS[cur.status] ?? { label: cur.status, tone: 'neutral' as const };
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => openReview(cur)}
      onKeyDown={(e) => e.key === 'Enter' && openReview(cur)}
      sx={{
        borderRadius: '20px',
        bgcolor: t.m3.surfaceContainerLowest,
        border: `1px solid ${t.m3.primary}`,
        p: 2,
        cursor: 'pointer',
        '&:hover': { bgcolor: t.m3.surfaceContainerLow },
      }}
    >
      <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1.5}>
        <IconBadge tone="primary" size={36}>
          <ReceiptLongRoundedIcon />
        </IconBadge>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Drafted for you
          </Typography>
          <Typography variant="subtitle1" sx={{ lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
            {h.big}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {h.sub}
          </Typography>
        </Box>
        <ChevronRightRoundedIcon color="action" />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <TierChip tier={cur.tier} mode="student" />
        <ToneChip tone={st.tone === 'neutral' ? 'neutral' : st.tone} label={st.label} />
      </Stack>
      {cur.status === 'awaiting_user' && (
        <Button variant="contained" fullWidth sx={{ mt: 1.5 }} onClick={(e) => (e.stopPropagation(), openReview(cur))}>
          Review & confirm
        </Button>
      )}
    </Box>
  );
}

export function Assistant() {
  const { assistant, closeAssistant, frame, refresh, openReview, source } = useStore();
  const t = useTheme();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(newSessionId);
  const scroller = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setMsgs((m) => [...m, { id: ++seq.current, role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await api.chat(message, session);
      setMsgs((m) => [
        ...m,
        { id: ++seq.current, role: 'assistant', text: res.reply, cards: res.cards, actions: res.actions, flags: res.guard?.flags ?? [] },
      ]);
      const draft = res.actions.find((a) => a.status === 'awaiting_user');
      void refresh();
      if (draft) setTimeout(() => openReview(draft), 450);
    } catch (e) {
      setMsgs((m) => [...m, { id: ++seq.current, role: 'assistant', text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  // Opened with a prefilled question (quick-action chips on Home).
  useEffect(() => {
    if (assistant.open && assistant.prefill) void send(assistant.prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.key]);

  const newChat = () => {
    setMsgs([]);
    setSession(newSessionId());
  };

  return (
    <Dialog
      fullScreen
      open={assistant.open}
      onClose={closeAssistant}
      container={frame}
      slots={{ transition: SlideUp }}
      slotProps={{ paper: { sx: { bgcolor: t.m3.surface, borderRadius: 0 } } }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Small top app bar */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 1, minHeight: 64, bgcolor: t.m3.surface }}>
          <IconButton onClick={closeAssistant} aria-label="Close assistant">
            <ArrowBackRoundedIcon />
          </IconButton>
          <Avatar sx={{ bgcolor: t.m3.primaryContainer, color: t.m3.onPrimaryContainer, width: 36, height: 36 }}>
            <AutoAwesomeRoundedIcon sx={{ fontSize: 20 }} />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ lineHeight: 1.2 }}>
              Assistant
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {source === 'fixtures' ? 'Demo data · set questions' : 'Drafts only · you confirm every payment'}
            </Typography>
          </Box>
          <Tooltip title="New chat">
            <IconButton onClick={newChat} aria-label="New chat">
              <EditNoteRoundedIcon />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box ref={scroller} sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2 }}>
          {msgs.length === 0 && (
            <Box sx={{ pt: 3 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '18px',
                  bgcolor: t.m3.primaryContainer,
                  color: t.m3.onPrimaryContainer,
                  display: 'grid',
                  placeItems: 'center',
                  mb: 2,
                }}
              >
                <AutoAwesomeRoundedIcon />
              </Box>
              <Typography variant="h5">Hi Aisha, how can I help?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
                Ask about balances, rates, your runway or tuition. I can draft payments, but only you can confirm them, and big ones also need Dad.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, color: 'text.secondary' }}>
                <ShieldRoundedIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption">Every message is screened for scams and prompt injection.</Typography>
              </Stack>
            </Box>
          )}

          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {msgs.map((m) =>
              m.role === 'user' ? (
                <Box
                  key={m.id}
                  sx={{
                    alignSelf: 'flex-end',
                    maxWidth: '82%',
                    bgcolor: t.m3.primary,
                    color: t.m3.onPrimary,
                    px: 2,
                    py: 1.25,
                    borderRadius: '20px 20px 6px 20px',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {m.text}
                  </Typography>
                </Box>
              ) : (
                <Stack key={m.id} spacing={1.25} sx={{ alignSelf: 'stretch' }}>
                  {m.flags && m.flags.length > 0 && (
                    <ToneChip
                      tone="error"
                      icon={<GppMaybeRoundedIcon />}
                      label={`Safety check: ${m.flags.join(', ').replace(/_/g, ' ')}`}
                      sx={{ alignSelf: 'flex-start' }}
                    />
                  )}
                  <Box
                    sx={{
                      alignSelf: 'flex-start',
                      maxWidth: '92%',
                      bgcolor: m.error ? t.m3.errorContainer : t.m3.surfaceContainerHigh,
                      color: m.error ? t.m3.onErrorContainer : t.m3.onSurface,
                      px: 2,
                      py: 1.25,
                      borderRadius: '20px 20px 20px 6px',
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      <RichText text={m.text} />
                    </Typography>
                  </Box>
                  {m.cards?.map((c, i) => <ResultCard key={i} card={c} />)}
                  {m.actions?.map((a) => <DraftChip key={a.action_id} a={a} />)}
                </Stack>
              ),
            )}
            {busy && (
              <Stack direction="row" spacing={0.6} sx={{ alignSelf: 'flex-start', bgcolor: t.m3.surfaceContainerHigh, px: 2, py: 1.6, borderRadius: '20px 20px 20px 6px' }}>
                {[0, 1, 2].map((i) => (
                  <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: t.m3.onSurfaceVariant, animation: `${bounce} 1.2s ${i * 0.15}s infinite` }} />
                ))}
              </Stack>
            )}
          </Stack>
        </Box>

        {/* Suggestion chips + composer */}
        <Box sx={{ bgcolor: t.m3.surfaceContainer, pt: 1.25, pb: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', px: 2, pb: 1.25 }}>
            {SUGGESTIONS.map((s) => (
              <Chip
                key={s.label}
                label={s.label}
                variant="outlined"
                onClick={() => void send(s.message)}
                disabled={busy}
                sx={{ flexShrink: 0, bgcolor: t.m3.surfaceContainerLow }}
              />
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2 }}>
            <InputBase
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about your money…"
              inputProps={{ 'aria-label': 'Message', maxLength: 4000 }}
              sx={{ flex: 1, bgcolor: t.m3.surfaceContainerHighest, borderRadius: '28px', px: 2.5, height: 52, fontSize: 15 }}
            />
            <IconButton
              aria-label="Send"
              onClick={() => void send(input)}
              disabled={!input.trim() || busy}
              sx={{
                width: 52,
                height: 52,
                borderRadius: '16px',
                bgcolor: t.m3.primary,
                color: t.m3.onPrimary,
                '&:hover': { bgcolor: '#005858' },
                '&.Mui-disabled': { bgcolor: t.m3.surfaceContainerHighest, color: t.m3.outline },
              }}
            >
              <SendRoundedIcon />
            </IconButton>
          </Stack>
        </Box>
      </Stack>
    </Dialog>
  );
}
