import { Platform, useColorScheme } from 'react-native';

// Same system as the deck: cool white, deep navy ink, steel blue for structure and the student, coral for the
// sponsor and the best option. `gold` keeps its name as the sponsor/highlight role.
// Fonts are bundled with the app (no font CDN), so the web build needs no third-party requests.
const light = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  sunken: '#E9EEF4',
  text: '#0F2747',
  muted: '#5B6B82',
  faint: '#9AA6B7',
  border: '#DCE3EB',
  accent: '#1E4E8C',
  accentSoft: '#E3ECF8',
  accentText: '#FFFFFF',
  gold: '#D9481F',
  goldSoft: '#FDEBE4',
  user: '#1E4E8C',
  userText: '#FFFFFF',
  warnBg: '#FFF4E0',
  warn: '#8A5A00',
  dangerBg: '#FBE3E3',
  danger: '#C62828',
  okBg: '#E3F3EA',
  ok: '#1B7A4B',
  shadow: 'rgba(15, 39, 71, 0.08)',
};

const dark: typeof light = {
  bg: '#0B1628',
  surface: '#12223A',
  sunken: '#081120',
  text: '#E8EEF6',
  muted: '#A6B4C8',
  faint: '#6C7A90',
  border: '#22385A',
  accent: '#8FB3E8',
  accentSoft: '#17305A',
  accentText: '#081120',
  gold: '#FF8A65',
  goldSoft: '#3A1F15',
  user: '#1E4E8C',
  userText: '#F4F7FA',
  warnBg: '#33280F',
  warn: '#F2C46B',
  dangerBg: '#3A1616',
  danger: '#FF8F8F',
  okBg: '#10291D',
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
  display: stack('IBMPlexSans_700Bold', 'sans-serif'),
  displayItalic: stack('IBMPlexSans_400Regular_Italic', 'sans-serif'),
  body: stack('IBMPlexSans_400Regular', 'sans-serif'),
  bodyMedium: stack('IBMPlexSans_500Medium', 'sans-serif'),
  bodyBold: stack('IBMPlexSans_600SemiBold', 'sans-serif'),
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
