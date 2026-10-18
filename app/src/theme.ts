import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { Platform, type TextStyle } from 'react-native';

// Two skins, one feature set. Each person picks one at onboarding and can switch in Settings (prefs on the server).
// * neo: a premium dark neo-bank. Near-black surfaces, one signal-lime accent, Geist and Geist Mono, big tabular
//   numerals, glassy cards, a pill tab bar (modelled on ui-variants/neobank).
// * superapp: a dense Chinese super-app (Alipay / WeChat Pay / WeBank). Light grey page, white cards, Alipay blue,
//   orange for the sponsor and highlights, red badges, the system's CJK font (modelled on ui-variants/superapp).
// Every component reads colours from useTheme() and fonts from useFontSet(), so both skins share every screen.
// Token names are the same in both; `gold` keeps its name as the sponsor/highlight role.
// Fonts are bundled with the app (no font CDN), so the web build needs no third-party requests.
export type Skin = 'neo' | 'superapp';
export const SKINS: Skin[] = ['neo', 'superapp'];

const neo = {
  dark: true,
  bg: '#0A0B0D',
  surface: '#141619',
  sunken: '#1C1F23',
  text: '#F4F5F6',
  muted: '#A3A8B0',
  faint: '#7A808A',
  border: 'rgba(255, 255, 255, 0.09)',
  accent: '#C6F94A',
  accentSoft: 'rgba(198, 249, 74, 0.13)',
  accentText: '#0A0B0D',
  gold: '#FFB648',
  goldSoft: 'rgba(255, 182, 72, 0.13)',
  user: '#25282D',
  userText: '#F4F5F6',
  warnBg: 'rgba(255, 182, 72, 0.12)',
  warn: '#FFC46B',
  dangerBg: 'rgba(255, 95, 87, 0.13)',
  danger: '#FF6B63',
  okBg: 'rgba(198, 249, 74, 0.12)',
  ok: '#C6F94A',
  shadow: 'rgba(0, 0, 0, 0.5)',
  // structure
  radius: 22,
  radiusSm: 14,
  headerBg: '#0A0B0D',
  headerText: '#F4F5F6',
  headerMuted: '#7A808A',
  sponsorHeaderBg: '#0A0B0D',
  tabbarBg: '#17191C',
  badge: '#FF5F57',
  // the hero account card (CAD Everyday)
  heroCard: '#C6F94A',
  heroCardText: '#0A0B0D',
  // the backdrop behind the two demo phones
  stage: '#040505',
};

export type Theme = typeof neo;

const superapp: Theme = {
  dark: false,
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  sunken: '#F2F3F5',
  text: '#1A1A1A',
  muted: '#595959',
  faint: '#8C8C8C',
  border: '#EBEDF0',
  accent: '#1677FF',
  accentSoft: '#E8F1FF',
  accentText: '#FFFFFF',
  gold: '#E8590C',
  goldSoft: '#FFF2E8',
  user: '#1677FF',
  userText: '#FFFFFF',
  warnBg: '#FFF7E6',
  warn: '#AD5A00',
  dangerBg: '#FFF1F0',
  danger: '#E5202F',
  okBg: '#E6F9F1',
  ok: '#00875A',
  shadow: 'rgba(0, 0, 0, 0.06)',
  radius: 12,
  radiusSm: 8,
  headerBg: '#1677FF',
  headerText: '#FFFFFF',
  headerMuted: 'rgba(255, 255, 255, 0.85)',
  sponsorHeaderBg: '#F26A1B',
  tabbarBg: '#FFFFFF',
  badge: '#FF3141',
  heroCard: '#1677FF',
  heroCardText: '#FFFFFF',
  stage: '#E6E8ED',
};

const THEMES: Record<Skin, Theme> = { neo, superapp };
// The sponsor's phone in the super-app skin runs in orange (as Alipay's family / elder modes do), so the two phones
// read as two people at a glance. Neo keeps one lime accent for both.
const SPONSOR_THEMES: Record<Skin, Theme> = {
  neo,
  superapp: { ...superapp, accent: '#E8590C', accentSoft: '#FFF2E8', user: '#E8590C', heroCard: '#F26A1B' },
};

export function themeFor(skin: Skin, sponsor = false): Theme {
  return (sponsor ? SPONSOR_THEMES : THEMES)[skin];
}

// The bundled Latin fonts have no Chinese glyphs. On web (the presentation build) each family is a CSS stack
// that falls back to the system's CJK fonts (macOS, Windows, Linux/Android), so 中文 renders in a proper Chinese
// face instead of whatever the browser picks; no font is downloaded. Native takes a single family name and
// already falls back to the system CJK font per glyph.
const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC"';
const stack = (family: string, generic: 'serif' | 'sans-serif' | 'monospace') =>
  Platform.OS === 'web' ? `${family}, ${CJK}, ${generic}` : family;

export type FontSet = {
  display: string;
  displayItalic: string;
  body: string;
  bodyMedium: string;
  bodyBold: string;
  mono: string;
  monoBold: string;
};

const neoFonts: FontSet = {
  display: stack('Geist_700Bold', 'sans-serif'),
  displayItalic: stack('Geist_400Regular_Italic', 'sans-serif'),
  body: stack('Geist_400Regular', 'sans-serif'),
  bodyMedium: stack('Geist_500Medium', 'sans-serif'),
  bodyBold: stack('Geist_600SemiBold', 'sans-serif'),
  mono: stack('GeistMono_400Regular', 'monospace'),
  monoBold: stack('GeistMono_600SemiBold', 'monospace'),
};

// Super-app: the system's own CJK face, as Alipay and WeChat use. A system stack can't carry a weight, so on web
// each entry starts with a marker family ("hb-600") that no browser has; the text primitives read it and set
// fontWeight (fontWeightOf). iOS has PingFang SC's weights under their own names; Android's Roboto families carry
// theirs and fall back to Noto Sans CJK for Chinese.
// Latin letters come from the platform UI face where PingFang SC isn't installed (Segoe UI on Windows, whose
// punctuation spaces properly); Chinese falls through to PingFang SC / Microsoft YaHei / Noto Sans SC.
const SYS = '-apple-system, "PingFang SC", "Segoe UI", "Microsoft YaHei", system-ui, Roboto, "Noto Sans SC", sans-serif';
const MONO_SYS = 'ui-monospace, "SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace';
const IOS_WEIGHT = { 400: 'PingFangSC-Regular', 500: 'PingFangSC-Medium', 600: 'PingFangSC-Semibold', 700: 'PingFangSC-Semibold' };
const sys = (w: 400 | 500 | 600 | 700, mono = false): string =>
  Platform.select({
    web: `"hb-${w}", ${mono ? MONO_SYS : SYS}`,
    ios: mono ? (w >= 600 ? 'Menlo-Bold' : 'Menlo-Regular') : IOS_WEIGHT[w],
    default: mono ? 'monospace' : w >= 500 ? 'sans-serif-medium' : 'sans-serif',
  });

const superFonts: FontSet = {
  display: sys(700),
  displayItalic: sys(400),
  body: sys(400),
  bodyMedium: sys(500),
  bodyBold: sys(600),
  mono: sys(400, true),
  monoBold: sys(700, true),
};

const FONTS: Record<Skin, FontSet> = { neo: neoFonts, superapp: superFonts };

export function fontsFor(skin: Skin): FontSet {
  return FONTS[skin];
}

/** The weight a web super-app font stack asks for ("hb-600"), or undefined for fonts whose name carries it. */
export function fontWeightOf(family: unknown): TextStyle['fontWeight'] | undefined {
  if (typeof family !== 'string') return undefined;
  const m = /"hb-(\d00)"/.exec(family);
  return m ? (m[1] as TextStyle['fontWeight']) : undefined;
}

// ------------------------------------------------------------------ skin context
type SkinState = { skin: Skin; setSkin: (s: Skin) => void; sponsor: boolean };
const noop = () => {};
const SkinCtx = createContext<SkinState>({ skin: 'neo', setSkin: noop, sponsor: false });

/** The skin for everything under it. Each demo phone has its own, so two people can use two looks at once. */
export function SkinProvider({
  skin,
  setSkin,
  sponsor = false,
  children,
}: {
  skin: Skin;
  setSkin?: (s: Skin) => void;
  sponsor?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ skin, setSkin: setSkin ?? noop, sponsor }), [skin, setSkin, sponsor]);
  return createElement(SkinCtx.Provider, { value }, children);
}

export function useSkin(): SkinState {
  return useContext(SkinCtx);
}

export function useTheme(): Theme {
  const c = useContext(SkinCtx);
  return (c.sponsor ? SPONSOR_THEMES : THEMES)[c.skin];
}

/** Font families for the active skin (use as `const fonts = useFontSet()`). */
export function useFontSet(): FontSet {
  return FONTS[useContext(SkinCtx).skin];
}

export const money = (v: number, cur: string, digits = 2) =>
  `${cur} ${Number(v).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const amount = (v: number, digits = 2) =>
  Number(v).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "14,230.07" as ["14,230", ".07"], so heroes can draw the cents small and dim. */
export function splitAmount(v: number, digits = 2): [string, string] {
  const s = amount(v, digits);
  const i = s.lastIndexOf('.');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)];
}

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
