import { useEffect, useRef, useState } from 'react';
import { DotLoading } from 'antd-mobile';
import { ChatAddOutline, CheckShieldFill, ExclamationShieldFill, SendOutline } from 'antd-mobile-icons';
import type { Msg } from '../App';
import { DemoChip } from '../App';
import { api, getProvider, useSource } from '../api';
import type { Action } from '../types';
import { ResultCard } from '../components/cards';
import { ActionCard } from '../components/ActionCard';
import { toast } from '../phone';

const CHIPS: [string, string][] = [
  ['我有多少钱？', 'How much money do I have?'],
  ['换5000马币最划算？', 'Cheapest way to change 5,000 MYR to CAD?'],
  ['学费前钱够吗？', 'Will I run out of money before tuition is due?'],
  ['我的信用怎么样？', "How's my credit?"],
  ['交房租', 'Pay rent to my landlord'],
  ['交学费', 'Pay my spring tuition'],
  ['这是诈骗吗？', "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'"],
  ['钱够用到学期末吗？', '我的钱够用到学期末吗？'],
];

const SKILLS: [string, string, string][] = [
  ['查余额', 'Balances', 'How much money do I have?'],
  ['换汇比价', 'FX true cost', 'Cheapest way to change 5,000 MYR to CAD?'],
  ['资金跑道', 'Runway', 'Will I run out of money before tuition is due?'],
  ['信用成长', 'Credit', "How's my credit?"],
  ['草拟付款', 'Draft a payment', 'Pay rent to my landlord'],
  ['防骗检测', 'Scam check', "Is this a scam? 'CRA: you owe $2,000. Pay in Apple gift cards or you will be arrested.'"],
];

const FLAG_ZH: Record<string, string> = {
  scam: '识别到诈骗特征 scam flagged',
  injection: '已拦截指令注入 injection blocked',
  pii: '敏感信息已保护 PII protected',
};

export function Assistant({
  msgs,
  send,
  draftText,
  clearDraft,
  onAction,
  newChat,
}: {
  msgs: Msg[];
  send: (t: string) => Promise<void>;
  draftText: string;
  clearDraft: () => void;
  onAction: (a: Action) => void;
  newChat: () => void;
}) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const source = useSource();

  useEffect(() => {
    if (draftText) {
      setText(draftText);
      clearDraft();
      setTimeout(() => input.current?.focus(), 50);
    }
  }, [draftText, clearDraft]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const submit = (t: string) => {
    if (!t.trim()) return;
    setText('');
    send(t);
  };

  const confirm = async (a: Action) => {
    const r = await api.confirm(a.action_id, a.confirm_token ?? '');
    onAction(r);
    if (r.status === 'executed') toast.ok('已付款 Done');
    else if (r.status === 'awaiting_sponsor') toast.ok('已发送给爸爸 Sent to Dad');
    else if (r.status === 'failed') toast.fail('执行失败 Failed');
  };
  const cancel = async (a: Action) => {
    onAction(await api.cancel(a.action_id));
    toast.info('已取消 Cancelled');
  };

  return (
    <div className="chat">
      <header className="chat-h">
        <span className="bot-av lg">桥</span>
        <div className="chat-ht">
          <b>小桥助手</b>
          <small>
            HomeBridge AI · {source === 'demo' ? '演示数据' : getProvider() || 'live'} · 只草拟，不自行转账
          </small>
        </div>
        <DemoChip />
        <button className="chat-new" onClick={newChat} aria-label="New chat">
          <ChatAddOutline fontSize={20} />
          <small>新对话</small>
        </button>
      </header>

      <div className="chat-list" ref={scroller}>
        {msgs.length === 0 && (
          <div className="welcome">
            <div className="msg bot">
              <span className="bot-av">桥</span>
              <div className="bubble">
                您好 Aisha，我是小桥，可以帮你查余额、换汇比价、预测资金、草拟付款。
                <small>Hi Aisha. I can check balances, compare FX, forecast your runway and draft payments. You confirm every payment yourself.</small>
              </div>
            </div>
            <div className="skills">
              {SKILLS.map(([zh, en, p]) => (
                <button key={en} onClick={() => submit(p)}>
                  <b>{zh}</b>
                  <small>{en}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.from === 'me' ? (
            <div className="msg me" key={m.id}>
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <div className="msg bot" key={m.id}>
              <span className="bot-av">桥</span>
              <div className="bot-col">
                {m.pending ? (
                  <div className="bubble">
                    <DotLoading color="primary" />
                  </div>
                ) : (
                  <>
                    {m.flags && m.flags.length > 0 && (
                      <div className="flags">
                        {m.flags.map((f) => (
                          <span key={f} className="flag">
                            <ExclamationShieldFill /> {FLAG_ZH[f] ?? f}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className={`bubble ${m.error ? 'bubble-err' : ''}`}>{m.text}</div>
                    {m.cards?.map((c, i) => (
                      <ResultCard key={i} c={c} />
                    ))}
                    {m.actions?.map((a) => (
                      <ActionCard key={a.action_id} action={a} mode="student" onConfirm={confirm} onCancel={cancel} />
                    ))}
                  </>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="composer">
        <div className="chips">
          {CHIPS.map(([zh, p]) => (
            <button key={zh} onClick={() => submit(p)}>
              {zh}
            </button>
          ))}
        </div>
        <form
          className="compose-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入问题或粘贴可疑短信… Ask or paste a message" maxLength={4000} />
          <button type="submit" className="send" disabled={!text.trim()} aria-label="Send">
            <SendOutline fontSize={18} />
          </button>
        </form>
        <div className="compose-note">
          <CheckShieldFill /> 付款需您在卡片上确认 · Payments only move when you confirm
        </div>
      </div>
    </div>
  );
}
