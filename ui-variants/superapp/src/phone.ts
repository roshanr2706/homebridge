// Overlays (popups, dialogs, toasts, keyboards) render inside the phone frame rather than the desktop
// page: #phone has a transform, so position:fixed children are laid out relative to it.
import { Toast } from 'antd-mobile';

export const phone = () => document.getElementById('phone') ?? document.body;

export const toast = {
  ok: (content: string) => Toast.show({ icon: 'success', content, getContainer: phone }),
  fail: (content: string) => Toast.show({ icon: 'fail', content, getContainer: phone }),
  info: (content: string) => Toast.show({ content, getContainer: phone }),
};

/** Wrap an async handler so a failed API call shows a toast instead of an unhandled rejection. */
export const safe =
  (fn: () => Promise<unknown>) =>
  async (): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      toast.fail((e as Error).message);
    }
  };
