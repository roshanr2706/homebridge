import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  text: '#15181D',
  muted: '#5B6470',
  border: '#E1E5EA',
  accent: '#0F6E5C',
  accentText: '#FFFFFF',
  user: '#0F6E5C',
  userText: '#FFFFFF',
  bot: '#FFFFFF',
  warnBg: '#FFF6E5',
  warn: '#8A5A00',
  dangerBg: '#FDECEC',
  danger: '#B42318',
  okBg: '#E8F5EF',
  ok: '#106B45',
};

const dark: typeof light = {
  bg: '#0E1114',
  surface: '#171B20',
  text: '#ECEFF3',
  muted: '#9AA4B1',
  border: '#2A3038',
  accent: '#3DBB9C',
  accentText: '#062019',
  user: '#1E6B5B',
  userText: '#F2FBF8',
  bot: '#171B20',
  warnBg: '#2E2410',
  warn: '#F2C46D',
  dangerBg: '#341615',
  danger: '#FF8A80',
  okBg: '#10291F',
  ok: '#7BD8AE',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const money = (v: number, cur: string) =>
  `${cur} ${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
