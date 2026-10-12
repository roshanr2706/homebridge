// Sponsor PIN step (Alipay-style 6-digit passcode sheet) for Approve, Unlock and limit changes. The
// server checks the PIN; the demo PIN (246810) is shown as a hint, never prefilled.
import { useEffect, useRef, useState } from 'react';
import { NumberKeyboard, PasscodeInput, Popup, SpinLoading, type PasscodeInputRef } from 'antd-mobile';
import { phone, toast } from '../phone';
import { CloseOutline, LockOutline } from 'antd-mobile-icons';

export const DEMO_PIN = '246810';

export function PinPad({
  visible,
  title,
  subtitle,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<PasscodeInputRef>(null);

  useEffect(() => {
    if (visible) {
      setValue('');
      setError(false);
      const t = setTimeout(() => ref.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // The PIN goes to the server, which checks it (and locks after repeated failures).
  const fill = async (v: string) => {
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (e) {
      setError(true);
      toast.fail((e as Error).message || 'PIN 错误 Wrong PIN');
      setTimeout(() => setValue(''), 300);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyClassName="sheet pin-sheet" destroyOnClose getContainer={phone}>
      <button className="sheet-close" onClick={onClose} aria-label="Close">
        <CloseOutline />
      </button>
      <div className="sheet-h">
        <span>输入支付密码</span>
        <small>Enter sponsor PIN</small>
      </div>
      <div className="pin-what">
        <b className="num">{title}</b>
        <span>{subtitle}</span>
      </div>
      <div className="pin-box">
        {busy ? (
          <div className="pin-busy">
            <SpinLoading color="primary" style={{ '--size': '28px' }} />
            <span>验证中 Checking…</span>
          </div>
        ) : (
          <PasscodeInput
            length={6}
            value={value}
            error={error}
            onChange={(v) => {
              setValue(v);
              setError(false);
            }}
            onFill={fill}
            keyboard={<NumberKeyboard getContainer={phone} />}
            ref={ref}
          />
        )}
      </div>
      <div className="pin-hint">
        <LockOutline /> 演示 PIN Demo PIN: <b className="num">{DEMO_PIN}</b>
      </div>
    </Popup>
  );
}
