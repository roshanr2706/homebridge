import { ActionIcon, Box, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowUp, IconPlus, IconShieldExclamation } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { Action, ChatResponse } from '../api/types';
import { ActionCard } from '../components/ActionCard';
import { AishaAvatar, ChatBuddy, Logo } from '../components/Art';
import { ResultCard } from '../components/ResultCards';
import { Sticker } from '../components/ui';
import { C } from '../theme';
import { QUICK_ASKS, SCAM_SAMPLE } from './Home';

type Msg = { id: number; role: 'me' | 'bot'; text: string; res?: ChatResponse; error?: boolean };

let nextId = 1;

export function Assistant({ incoming }: { incoming: { text: string; nonce: number } | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(api.newSessionId);
  const end = useRef<HTMLDivElement>(null);
  const handled = useRef(0);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setText('');
    setMsgs((m) => [...m, { id: nextId++, role: 'me', text: message }]);
    setBusy(true);
    try {
      const res = await api.chat(message, session);
      setMsgs((m) => [...m, { id: nextId++, role: 'bot', text: res.reply, res }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: nextId++, role: 'bot', text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (incoming && incoming.nonce !== handled.current) {
      handled.current = incoming.nonce;
      void send(incoming.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  const updateAction = (msgId: number, a: Action) =>
    setMsgs((m) =>
      m.map((x) => (x.id === msgId && x.res ? { ...x, res: { ...x.res, actions: x.res.actions.map((y) => (y.action_id === a.action_id ? { ...y, ...a, confirm_token: undefined } : y)) } } : x)),
    );

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Group justify="space-between" px={16} py={10} style={{ borderBottom: `2px solid ${C.ink}`, background: '#fff' }}>
        <Group gap={8}>
          <Logo size={28} />
          <Box>
            <Text className="hb-display" fw={600} fz={17} lh={1}>
              Ask HomeBridge
            </Text>
            <Text fz={11} fw={800} c={C.inkSoft}>
              Drafts only. You always press the button.
            </Text>
          </Box>
        </Group>
        <Button
          size="xs"
          color="sun"
          leftSection={<IconPlus size={14} stroke={3} />}
          onClick={() => {
            setMsgs([]);
            setSession(api.newSessionId());
          }}
          styles={{ label: { color: C.ink } }}
        >
          New chat
        </Button>
      </Group>

      <Box className="hb-scroll" px={14} py={14}>
        {msgs.length === 0 && !busy && (
          <Stack align="center" gap={10} mt={20}>
            <ChatBuddy size={150} />
            <Text className="hb-display" fz={24} fw={600} ta="center" lh={1.15}>
              What's on your money mind?
            </Text>
            <Text fz={14} fw={700} c={C.inkSoft} ta="center" maw={300}>
              Balances, FX, rent, tuition, sketchy texts. I'll draft it; you (and sometimes Dad) say yes.
            </Text>
            <Group gap={8} justify="center" mt={8}>
              {[...QUICK_ASKS, SCAM_SAMPLE, '我的钱够用到学期末吗？'].map((q) => (
                <button key={q} className="hb-chip" onClick={() => send(q)} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {q === SCAM_SAMPLE ? 'Is this CRA text a scam?' : q}
                </button>
              ))}
            </Group>
          </Stack>
        )}
        <Stack gap={12}>
          {msgs.map((m) =>
            m.role === 'me' ? (
              <Group key={m.id} justify="flex-end" gap={8} wrap="nowrap" align="flex-end">
                <Box className="hb-bubble-me">
                  <Text fz={14.5} fw={700} c="#fff">
                    {m.text}
                  </Text>
                </Box>
                <AishaAvatar size={30} />
              </Group>
            ) : (
              <Stack key={m.id} gap={10} className="hb-rise">
                <Group gap={8} wrap="nowrap" align="flex-end">
                  <Box style={{ flexShrink: 0 }}>
                    <Logo size={30} />
                  </Box>
                  <Box className="hb-bubble-bot" style={m.error ? { background: C.tomatoSoft } : undefined}>
                    {m.res?.guard.flags.includes('scam') && (
                      <Group gap={4} mb={4}>
                        <IconShieldExclamation size={16} color={C.tomato} />
                        <Text fz={11.5} fw={900} c="tomato.7">
                          Scam shield flagged this
                        </Text>
                      </Group>
                    )}
                    {m.res?.guard.flags.includes('injection') && (
                      <Box mb={4}>
                        <Sticker bg={C.tomatoSoft} rotate={0}>
                          Ignored instructions hidden in that text
                        </Sticker>
                      </Box>
                    )}
                    <Text fz={14.5} fw={600} style={{ whiteSpace: 'pre-wrap' }}>
                      {m.text}
                    </Text>
                  </Box>
                </Group>
                {m.res?.cards.map((c, i) => (
                  <ResultCard key={i} card={c} />
                ))}
                {m.res?.actions.map((a) => (
                  <ActionCard key={a.action_id} action={a} onChange={(x) => updateAction(m.id, x)} />
                ))}
              </Stack>
            ),
          )}
          {busy && (
            <Group gap={8} wrap="nowrap" align="flex-end">
              <Logo size={30} />
              <Box className="hb-bubble-bot hb-typing" aria-label="Thinking">
                <span />
                <span />
                <span />
              </Box>
            </Group>
          )}
          <div ref={end} />
        </Stack>
      </Box>

      <Box
        component="form"
        px={12}
        py={10}
        style={{ borderTop: `2px solid ${C.ink}`, background: '#fff' }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <Group gap={8} wrap="nowrap">
          <TextInput
            style={{ flex: 1 }}
            placeholder="Ask about money, in any language…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            aria-label="Message"
            maxLength={4000}
            styles={{ input: { border: `2.5px solid ${C.ink}`, fontWeight: 700, background: C.cream } }}
          />
          <ActionIcon type="submit" size={44} color="coral" className="hb-press" loading={busy} disabled={!text.trim()} aria-label="Send">
            <IconArrowUp size={22} stroke={3} />
          </ActionIcon>
        </Group>
      </Box>
    </Box>
  );
}
