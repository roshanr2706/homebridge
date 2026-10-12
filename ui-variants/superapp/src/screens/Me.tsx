import { useState } from 'react';
import { Dialog, List, Segmented, Switch } from 'antd-mobile';
import { PinPad } from '../components/PinPad';
import {
  CheckShieldOutline,
  FileOutline,
  GlobalOutline,
  InformationCircleOutline,
  LockOutline,
  RedoOutline,
  SetOutline,
  TeamOutline,
} from 'antd-mobile-icons';
import type { Nav } from '../App';
import { DemoChip } from '../App';
import { api, checkLive, getProvider, useSource } from '../api';
import type { FreezeState, Role } from '../types';
import { amount } from '../format';
import { Pill, useLoad } from '../components/bits';
import { phone, toast } from '../phone';

export function Me({ nav, role }: { nav: Nav; role: Role }) {
  const source = useSource();
  const student = role === 'student';
  const ov = useLoad<{ freeze: FreezeState; limits: Record<string, number>; kyc?: Record<string, any> }>(
    () => (student ? api.overview() : api.sponsorOverview()),
    [nav.rev, role],
  );
  const freeze = ov.data?.freeze;
  const limits = ov.data?.limits;
  const kyc: string | undefined = student ? ov.data?.kyc?.label : ov.data?.kyc?.sponsor?.label;
  const [pinOpen, setPinOpen] = useState(false);

  const toggleLock = async (on: boolean) => {
    try {
      if (student) {
        if (on) await api.freeze();
        else {
          const r = await api.unfreeze();
          if (r.note) toast.info('爸爸资助的资金仍锁定 Sponsor-funded money stays locked');
        }
      } else if (on) await api.sponsorFreeze('sponsor_funded');
      else {
        setPinOpen(true); // the sponsor's unlock needs the PIN
        return;
      }
      nav.bump();
    } catch (e) {
      toast.fail((e as Error).message);
    }
  };

  return (
    <div className="me">
      <header className={student ? 'me-h' : 'me-h me-h-sp'}>
        <span className="me-av">{student ? 'A' : 'R'}</span>
        <div>
          <b>{student ? 'Aisha Rahman' : 'Encik Rahman'}</b>
          <small>{student ? 'UBC 国际学生 · International student · Vancouver' : '资助人 Sponsor · Kuala Lumpur'}</small>
          {kyc ? <span><Pill tone="green">实名认证 KYC · {kyc}</Pill></span> : null}
        </div>
        <DemoChip />
      </header>

      <div className="me-body">
        <div className="role-card">
          <div className="role-t">
            <b>演示角色</b>
            <small>Demo role · each person signs in on their own phone in the real app</small>
          </div>
          <Segmented
            block
            value={role}
            onChange={(v) => nav.setRole(v as Role)}
            options={[
              { label: '学生 Aisha', value: 'student' },
              { label: '爸爸 Sponsor', value: 'sponsor' },
            ]}
          />
        </div>

        <List header="安全 Security" mode="card">
          <List.Item
            prefix={<LockOutline />}
            description={student ? '冻结后所有付款暂停，爸爸会收到提醒 Lock all payments; Dad is alerted' : '冻结 Aisha 用您资助的资金 Lock money you fund'}
            extra={<Switch checked={!!freeze?.frozen} onChange={toggleLock} />}
          >
            一键冻结 Lock
          </List.Item>
          <List.Item
            prefix={<SetOutline />}
            extra={limits ? `${amount(limits.single_cad, 0)} / ${amount(limits.daily_cad, 0)}` : '–'}
            description="单笔 / 24小时 · CAD · 只有爸爸能修改 only the sponsor can change"
          >
            付款限额 Limits
          </List.Item>
          <List.Item
            prefix={<CheckShieldOutline />}
            onClick={async () => {
              try {
                const v = await api.auditVerify();
                toast[v.ok ? 'ok' : 'fail'](v.ok ? `审计链完整 · ${v.count} 条 Chain intact` : `审计链断裂于 #${v.broken_at}`);
              } catch (e) {
                toast.fail((e as Error).message);
              }
            }}
            description="哈希链记录每一次草拟、确认和批准 Hash-chained log"
          >
            校验审计链 Verify audit log
          </List.Item>
        </List>

        <List header="服务 Services" mode="card">
          {student ? (
            <List.Item prefix={<TeamOutline />} onClick={() => nav.draft('Ask my dad for CAD 300 for textbooks')} description="向爸爸申请生活费 Request money from your sponsor">
              找爸爸要钱 Ask Dad
            </List.Item>
          ) : null}
          <List.Item
            prefix={<GlobalOutline />}
            extra={source === 'live' ? <span className="c-green">在线 live</span> : source === 'demo' ? <span className="c-orange">演示 demo</span> : '…'}
            description={source === 'live' ? `后端 :8000 · 引擎 ${getProvider() || '?'}` : '无法连接 :8000，使用离线数据 Using offline fixtures'}
            onClick={async () => toast.info((await checkLive()) ? '已连接 Live' : '仍离线 Still offline')}
          >
            数据来源 Data source
          </List.Item>
          <List.Item
            prefix={<RedoOutline />}
            description="恢复初始余额与草稿 Reset balances, drafts and locks"
            onClick={() =>
              Dialog.confirm({
                getContainer: phone,
                title: '重置演示？ Reset demo?',
                content: '所有余额、草稿和冻结状态恢复初始。',
                confirmText: '重置 Reset',
                cancelText: '取消',
                onConfirm: async () => {
                  try {
                    await api.reset();
                    toast.ok('已重置 Reset');
                    nav.bump();
                  } catch (e) {
                    toast.fail((e as Error).message);
                  }
                },
              })
            }
          >
            重置演示 Demo reset
          </List.Item>
        </List>

        <List header="关于 About" mode="card">
          <List.Item prefix={<FileOutline />} description="AI 只读取数据和草拟操作；转账需要本人确认，大额需爸爸批准">
            工作原理 How it works
          </List.Item>
          <List.Item prefix={<InformationCircleOutline />} description="FinTechathon 2026 · 超级应用 UI 方案 · Super-app UI variant">
            HomeBridge 家桥
          </List.Item>
        </List>
      </div>
      {!student && (
        <PinPad
          visible={pinOpen}
          title="解除冻结 Unlock"
          subtitle="Aisha 的全部付款 · All of Aisha’s payments"
          onClose={() => setPinOpen(false)}
          onSubmit={async (pin) => {
            await api.sponsorUnfreeze(pin);
            setPinOpen(false);
            toast.ok('已解冻 Unlocked');
            nav.bump();
          }}
        />
      )}
    </div>
  );
}
