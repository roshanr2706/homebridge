import { Box, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconHome2, IconMessageCircle2, IconWallet } from '@tabler/icons-react';
import { useCallback, useMemo, useState } from 'react';

import { api, useSource } from './api/client';
import { AishaAvatar, DadAvatar, Logo, Squiggle } from './components/Art';
import { CelebrationOverlay } from './components/Overlays';
import { App as AppContext, type AppCtx, type Celebration, type Tab } from './components/ui';
import { Assistant } from './screens/Assistant';
import { Home } from './screens/Home';
import { Money } from './screens/Money';
import { Sponsor } from './screens/Sponsor';
import { C } from './theme';

type Role = 'student' | 'sponsor';

const TABS: { key: Tab; label: string; Icon: typeof IconHome2 }[] = [
  { key: 'home', label: 'Home', Icon: IconHome2 },
  { key: 'assistant', label: 'Ask', Icon: IconMessageCircle2 },
  { key: 'money', label: 'Money', Icon: IconWallet },
];

function SourceChip() {
  const source = useSource();
  if (source !== 'demo') return null;
  return (
    <Tooltip label="Backend on :8000 not reachable. Showing saved data captured from it. Tap to retry." multiline w={220} withArrow>
      <button className="hb-chip" style={{ background: C.sun, padding: '3px 9px', fontSize: 11 }} onClick={() => api.retryLive()}>
        demo data
      </button>
    </Tooltip>
  );
}

export default function App() {
  const [role, setRole] = useState<Role>('student');
  const [tab, setTab] = useState<Tab>('home');
  const [incoming, setIncoming] = useState<{ text: string; nonce: number } | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const ctx = useMemo<AppCtx>(
    () => ({
      ask: (text) => {
        setRole('student');
        setTab('assistant');
        setIncoming({ text, nonce: Date.now() + Math.random() });
      },
      setTab,
      celebrate: setCelebration,
      refreshKey,
      bump,
    }),
    [refreshKey, bump],
  );

  const switchRole = (r: Role) => {
    setRole(r);
    bump();
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="hb-stage">
        <aside className="hb-side">
          <Logo size={56} />
          <Text className="hb-display" fz={40} fw={600} lh={1} mt={14}>
            HomeBridge
          </Text>
          <Squiggle width={180} />
          <Text fz={16} fw={700} mt={14} c={C.inkSoft}>
            Money help for international students, with Dad in the loop. Playful variant: bento home, streaks, a scam shield and a sponsor who approves with a PIN.
          </Text>
          <Stack gap={8} mt={20}>
            <Group gap={10}>
              <AishaAvatar size={36} />
              <Text fw={800} fz={14}>
                Aisha · student at UBC, Vancouver
              </Text>
            </Group>
            <Group gap={10}>
              <DadAvatar size={36} />
              <Text fw={800} fz={14}>
                Encik Rahman · sponsor in Kuala Lumpur
              </Text>
            </Group>
          </Stack>
          <Text fz={12} fw={700} mt={20} c={C.inkSoft}>
            Sandbox demo. Not a bank, not financial advice.
          </Text>
        </aside>

        <div className="hb-phone">
          <Group justify="space-between" px={14} pt={14} pb={10} wrap="nowrap" style={{ background: C.cream }}>
            <Group gap={8} wrap="nowrap">
              {role === 'student' ? <AishaAvatar size={34} /> : <DadAvatar size={34} />}
              <SourceChip />
            </Group>
            <SegmentedControl
              value={role}
              onChange={(v) => switchRole(v as Role)}
              radius="xl"
              size="xs"
              color={role === 'student' ? 'coral' : 'grape'}
              data={[
                { value: 'student', label: 'Aisha' },
                { value: 'sponsor', label: 'Dad' },
              ]}
              styles={{ root: { border: `2px solid ${C.ink}`, background: '#fff' }, label: { fontWeight: 900, paddingInline: 14 } }}
              aria-label="Switch between Aisha and Dad"
            />
          </Group>

          <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {role === 'sponsor' ? (
              <div className="hb-scroll">
                <Sponsor />
              </div>
            ) : (
              <>
                <div className="hb-scroll" style={{ display: tab === 'home' ? 'block' : 'none' }}>
                  <Home goSponsor={() => switchRole('sponsor')} />
                </div>
                <div style={{ display: tab === 'assistant' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                  <Assistant incoming={incoming} />
                </div>
                <div className="hb-scroll" style={{ display: tab === 'money' ? 'block' : 'none' }}>
                  <Money />
                </div>
              </>
            )}
          </Box>

          {role === 'student' && (
            <nav className="hb-tabbar" aria-label="Main">
              {TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className="hb-tab"
                  data-active={tab === key}
                  onClick={() => {
                    setTab(key);
                    if (key !== 'assistant') bump();
                  }}
                  aria-current={tab === key ? 'page' : undefined}
                >
                  <span className="hb-tab-icon">
                    <Icon size={22} stroke={2.4} />
                  </span>
                  {label}
                </button>
              ))}
            </nav>
          )}

          {celebration && <CelebrationOverlay c={celebration} onClose={() => setCelebration(null)} />}
        </div>
      </div>
    </AppContext.Provider>
  );
}
