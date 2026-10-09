// Device step-up before a money decision: Face ID / fingerprint, or the device passcode as fallback.
// This is a client-side speed bump against someone else tapping Confirm or Approve on an unlocked
// phone; the server does not see it, so it does not replace per-device keys (see R1/R3 in
// docs/security_self_assessment.md). On web, or on a phone with no screen lock, there is nothing to
// prompt with: the action goes ahead and the card says the check was skipped.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export type StepUpResult = { ok: true; checked: boolean } | { ok: false; reason: string };

// Errors that mean "this device cannot prompt", not "the person failed or declined".
const UNAVAILABLE = new Set(['not_enrolled', 'not_available', 'passcode_not_set']);

const REASON: Record<string, string> = {
  user_cancel: 'You cancelled the device check.',
  system_cancel: 'The device check was interrupted.',
  app_cancel: 'The device check was interrupted.',
  authentication_failed: "The device didn't recognise you.",
  lockout: 'Too many attempts. Unlock your phone, then try again.',
  timeout: 'The device check timed out.',
};

// Why the check will be skipped on this device, or null when a prompt will be shown.
export async function stepUpUnavailable(): Promise<string | null> {
  if (Platform.OS === 'web') return 'device check unavailable on web';
  try {
    // SECRET (PIN, pattern, passcode) is enough: authenticateAsync falls back to it.
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'no screen lock set, device check skipped' : null;
  } catch {
    return 'device check unavailable';
  }
}

export async function stepUp(promptMessage: string): Promise<StepUpResult> {
  if (await stepUpUnavailable()) return { ok: true, checked: false };
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel' });
    if (r.success) return { ok: true, checked: true };
    if (UNAVAILABLE.has(r.error)) return { ok: true, checked: false };
    return { ok: false, reason: REASON[r.error] ?? 'The device check did not complete.' };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The device check did not complete.' };
  }
}

// For the note on the card: null while checking or when the device will prompt.
export function useStepUpNote() {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    stepUpUnavailable().then((n) => live && setNote(n));
    return () => {
      live = false;
    };
  }, []);
  return note;
}
