import { Platform, useColorScheme } from 'react-native';

// "Family ledger": warm paper, deep jade ink, songket gold for the best option.
// Fonts are bundled with the app (no font CDN), so the web build works from mainland China.
const light = {
  bg: '#F3EEE4',
  surface: '#FFFCF6',
  sunken: '#EAE3D6',
  text: '#1B1F1D',
  muted: '#6E6B62',
  faint: '#A39E91',
  border: '#E0D7C6',
  accent: '#0E5E4E',
  accentSoft: '#DCEBE4',
  accentText: '#FFFFFF',
  gold: '#B9831F',
  goldSoft: '#F6E7C6',
  user: '#0E5E4E',
  userText: '#F7FBF9',
  warnBg: '#FBEFD5',
  warn: '#875A0A',
  dangerBg: '#FBE4E0',
  danger: '#A8261B',
  okBg: '#E1F0E6',
  ok: '#1C6E45',
  shadow: 'rgba(60, 45, 20, 0.08)',
};

const dark: typeof light = {
  bg: '#0F1412',
  surface: '#171E1B',
  sunken: '#0B0F0D',
  text: '#EDE7DB',
  muted: '#A19D91',
  faint: '#6B6C63',
  border: '#2A332F',
  accent: '#55C7A5',
  accentSoft: '#173229',
  accentText: '#06201A',
  gold: '#E2B556',
  goldSoft: '#3A2E14',
  user: '#1D5F4F',
  userText: '#F2FBF8',
  warnBg: '#30260F',
  warn: '#F0C36A',
  dangerBg: '#3A1714',
  danger: '#FF8F80',
  okBg: '#122A1E',
  ok: '#7FD9A9',
  shadow: 'rgba(0, 0, 0, 0.35)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

// The bundled Latin fonts have no Chinese glyphs. On web (the presentation build) each family is a CSS stack
// that falls back to the system's CJK fonts (macOS, Windows, Linux/Android), so 中文 renders in a proper Chinese
// face instead of whatever the browser picks; no font is downloaded. Native takes a single family name and
// already falls back to the system CJK font per glyph.
const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC"';
const stack = (family: string, generic: 'serif' | 'sans-serif' | 'monospace') =>
  Platform.OS === 'web' ? `${family}, ${CJK}, ${generic}` : family;

export const fonts = {
  display: stack('Fraunces_600SemiBold', 'serif'),
  displayItalic: stack('Fraunces_400Regular_Italic', 'serif'),
  body: stack('InstrumentSans_400Regular', 'sans-serif'),
  bodyMedium: stack('InstrumentSans_500Medium', 'sans-serif'),
  bodyBold: stack('InstrumentSans_600SemiBold', 'sans-serif'),
  mono: stack('IBMPlexMono_400Regular', 'monospace'),
  monoBold: stack('IBMPlexMono_600SemiBold', 'monospace'),
};

export const money = (v: number, cur: string, digits = 2) =>
  `${cur} ${Number(v).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const amount = (v: number, digits = 2) =>
  Number(v).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Local time in each home, shown so the student knows whether the sponsor is likely awake.
export function cityTime(tz: string, d = new Date()) {
  try {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return '';
  }
}

export function klHour(d = new Date()) {
  try {
    return Number(d.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }));
  } catch {
    return 12;
  }
}
