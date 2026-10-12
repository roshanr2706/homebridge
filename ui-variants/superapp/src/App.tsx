import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, TabBar } from 'antd-mobile';
import { AppOutline, MessageOutline, MessageFill, UserOutline, BankcardOutline, CheckShieldOutline, BellOutline } from 'antd-mobile-icons';
import { api, checkLive, newSessionId, useSource } from './api';
import type { Action, Card, Role } from './types';
import { HideCtx } from './components/bits';
import { Home } from './screens/Home';
import { Assistant } from './screens/Assistant';
import { Wallet } from './screens/Wallet';
import { Me } from './screens/Me';
import { SponsorHome, SponsorActivity } from './screens/Sponsor';
import { toast } from './phone';

export type Tab = 'home' | 'assistant' | 'wallet' | 'me';
export type SponsorTab = 'home' | 'activity' | 'me';

export type Msg = {
  id: string;
  from: 'me' | 'bot';
  text: string;
  cards?: Card[];
  actions?: Action[];
  flags?: string[];
  pending?: boolean;
  error?: boolean;
};

export type Nav = {
  go: (t: Tab) => void;
  ask: (prompt: string) => void;
  draft: (prompt: string) => void;
  setRole: (r: Role) => void;
  rev: number;
  bump: () => void;
};

let msgSeq = 0;
const mid = () => `m${++msgSeq}`;

function StatusBar({ tone }: { tone: 'blue' | 'orange' | 'light' }) {
  return (
    <div className={`statusbar sb-${tone}`} aria-hidden>
      <span className="num">9:41</span>
      <span className="sb-r">
        <svg width="17" height="11" viewBox="0 0 17 11">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11">
          <path d="M7.5 2.2c2.1 0 4 .8 5.4 2.1l1.1-1.1C12.3 1.6 10 .6 7.5.6S2.7 1.6 1 3.2l1.1 1.1C3.5 3 5.4 2.2 7.5 2.2zm0 3.1c1.2 0 2.3.5 3.2 1.2l1.1-1.1c-1.2-1-2.7-1.7-4.3-1.7S4.4 4.4 3.2 5.4l1.1 1.1c.9-.7 2-1.2 3.2-1.2zm0 3.1c-.6 0-1.1.2-1.5.6l1.5 1.5L9 8.9c-.4-.3-.9-.5-1.5-.5z" />
        </svg>
        <span className="batt">
          <i />
        </span>
      </span>
    </div>
  );
}

export function DemoChip() {
  const source = useSource();
  if (source !== 'demo') return null;
  return (
    <button
      className="demo-chip"
      onClick={async () => {
        const ok = await checkLive();
        if (ok) toast.ok('已连接服务器 Live');
        else toast.info('服务器未连接，使用演示数据 Server offline');
      }}
    >
      演示数据 demo data · 重试
    </button>
  );
}

export default function App() {
  const [role, setRoleState] = useState<Role>('student');
  const [tab, setTab] = useState<Tab>('home');
  const [sTab, setSTab] = useState<SponsorTab>('home');
  const [hidden, setHidden] = useState(false);
  const [rev, setRev] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [draftText, setDraftText] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    checkLive();
  }, []);

  // Badge counts for the tab bars.
  useEffect(() => {
    api.sponsorQueue().then((q) => setQueueCount(q.actions.length), () => {});
    api.actions().then((r) => setPendingCount(r.actions.filter((a) => a.status === 'awaiting_user').length), () => {});
  }, [rev, role]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      const botId = mid();
      setMsgs((m) => [...m, { id: mid(), from: 'me', text: t }, { id: botId, from: 'bot', text: '', pending: true }]);
      try {
        const r = await api.chat(t, sessionId);
        setMsgs((m) =>
          m.map((x) => (x.id === botId ? { id: botId, from: 'bot', text: r.reply, cards: r.cards, actions: r.actions, flags: r.guard?.flags ?? [] } : x)),
        );
        if (r.actions.length) bump();
      } catch (e) {
        setMsgs((m) => m.map((x) => (x.id === botId ? { id: botId, from: 'bot', text: (e as Error).message, error: true } : x)));
      }
    },
    [sessionId, bump],
  );

  const updateAction = useCallback(
    (a: Action) => {
      setMsgs((m) => m.map((x) => (x.actions ? { ...x, actions: x.actions.map((y) => (y.action_id === a.action_id ? { ...y, ...a, confirm_token: y.confirm_token } : y)) } : x)));
      bump();
    },
    [bump],
  );

  const nav: Nav = useMemo(
    () => ({
      go: setTab,
      ask: (p: string) => {
        setTab('assistant');
        send(p);
      },
      draft: (p: string) => {
        setTab('assistant');
        setDraftText(p);
      },
      setRole: (r: Role) => {
        setRoleState(r);
        setSTab('home');
        setTab('home');
      },
      rev,
      bump,
    }),
    [send, rev, bump],
  );

  const tone: 'blue' | 'orange' | 'light' =
    role === 'sponsor' ? (sTab === 'home' ? 'orange' : 'light') : tab === 'home' || tab === 'wallet' ? 'blue' : 'light';

  return (
    <HideCtx.Provider value={{ hidden, toggle: () => setHidden((h) => !h) }}>
      <div className="stage">
        <aside className="stage-note">
          <b>HomeBridge 家桥</b>
          <span>超级应用版 · Super-app variant</span>
          <span>antd-mobile · 390×844</span>
        </aside>
        <div className="phone" id="phone">
          <StatusBar tone={tone} />
          <div className="screen" key={`${role}-${role === 'student' ? tab : sTab}`}>
            {role === 'student' ? (
              <>
                {tab === 'home' && <Home nav={nav} />}
                {tab === 'assistant' && (
                  <Assistant
                    msgs={msgs}
                    send={send}
                    draftText={draftText}
                    clearDraft={() => setDraftText('')}
                    onAction={updateAction}
                    newChat={() => {
                      setMsgs([]);
                      setSessionId(newSessionId());
                    }}
                  />
                )}
                {tab === 'wallet' && <Wallet nav={nav} />}
                {tab === 'me' && <Me nav={nav} role={role} />}
              </>
            ) : (
              <>
                {sTab === 'home' && <SponsorHome nav={nav} />}
                {sTab === 'activity' && <SponsorActivity nav={nav} />}
                {sTab === 'me' && <Me nav={nav} role={role} />}
              </>
            )}
          </div>
          {role === 'student' ? (
            <TabBar activeKey={tab} onChange={(k) => setTab(k as Tab)} className="tabbar" safeArea>
              <TabBar.Item key="home" icon={<AppOutline />} title={<TabTitle zh="首页" en="Home" />} />
              <TabBar.Item
                key="assistant"
                icon={(active: boolean) => (active ? <MessageFill /> : <MessageOutline />)}
                title={<TabTitle zh="助手" en="Assistant" />}
                badge={pendingCount ? pendingCount : undefined}
              />
              <TabBar.Item key="wallet" icon={<BankcardOutline />} title={<TabTitle zh="钱包" en="Wallet" />} />
              <TabBar.Item key="me" icon={<UserOutline />} title={<TabTitle zh="我的" en="Me" />} />
            </TabBar>
          ) : (
            <TabBar activeKey={sTab} onChange={(k) => setSTab(k as SponsorTab)} className="tabbar tabbar-sponsor" safeArea>
              <TabBar.Item key="home" icon={<CheckShieldOutline />} title={<TabTitle zh="审批" en="Approve" />} badge={queueCount || undefined} />
              <TabBar.Item key="activity" icon={<BellOutline />} title={<TabTitle zh="动态" en="Activity" />} badge={Badge.dot} />
              <TabBar.Item key="me" icon={<UserOutline />} title={<TabTitle zh="我的" en="Me" />} />
            </TabBar>
          )}
        </div>
      </div>
    </HideCtx.Provider>
  );
}

function TabTitle({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="tab-t">
      {zh}
      <small>{en}</small>
    </span>
  );
}
