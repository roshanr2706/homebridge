import { ActionIcon, Badge, Button, createTheme, Modal, Paper, Textarea, TextInput, type MantineColorsTuple } from '@mantine/core';

// Playful palette: a Monzo-ish coral for "do this", sunshine for "heads up", mint for "you're good",
// grape for Dad / sponsor things, sky for info. Ink is the chunky outline colour.
const coral: MantineColorsTuple = ['#FFF1EC', '#FFE0D6', '#FFC2AE', '#FFA184', '#FF8462', '#FF6B4A', '#F0532F', '#D04021', '#A83218', '#7F2511'];
const sun: MantineColorsTuple = ['#FFFAE6', '#FFF2BF', '#FFE78F', '#FFDA5C', '#FFCF40', '#FFC93C', '#F0B21A', '#C98F0C', '#9C6E06', '#6E4D03'];
const mint: MantineColorsTuple = ['#E8FBF2', '#C8F5E0', '#9BECC7', '#6BE1AC', '#47D896', '#2BC48A', '#1FA572', '#17845B', '#106443', '#09452E'];
const grape: MantineColorsTuple = ['#F2F0FF', '#E1DCFF', '#C7BEFF', '#AB9EFF', '#9787FF', '#8B7CFF', '#7461F0', '#5C4AD0', '#4637A6', '#31277A'];
const sky: MantineColorsTuple = ['#E8F6FF', '#C9EAFF', '#9DD8FF', '#70C6FF', '#5BC0FF', '#3AAEF5', '#2391D6', '#1A73AD', '#145784', '#0E3D5D'];
const ink: MantineColorsTuple = ['#F4F3F7', '#E4E2EB', '#C9C5D6', '#A8A2BD', '#857EA0', '#5F5878', '#45405A', '#332F45', '#1F1B2E', '#14111F'];
const tomato: MantineColorsTuple = ['#FFECEC', '#FFD2D3', '#FFA9AB', '#FF7C80', '#F7575C', '#E5383B', '#C92A2E', '#A41F22', '#7E1618', '#590E10'];

export const C = {
  ink: '#1F1B2E',
  inkSoft: '#5F5878',
  cream: '#FFF6EC',
  paper: '#FFFFFF',
  coral: '#FF6B4A',
  coralSoft: '#FFE0D6',
  sun: '#FFC93C',
  sunSoft: '#FFF2BF',
  mint: '#2BC48A',
  mintSoft: '#C8F5E0',
  grape: '#8B7CFF',
  grapeSoft: '#E1DCFF',
  grapeDeep: '#6A56E8',
  sky: '#5BC0FF',
  skySoft: '#C9EAFF',
  tomato: '#E5383B',
  tomatoSoft: '#FFD2D3',
};

export const theme = createTheme({
  primaryColor: 'coral',
  primaryShade: 5,
  colors: { coral, sun, mint, grape, sky, ink, tomato },
  black: C.ink,
  white: '#FFFFFF',
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: '"Nunito Variable", "Nunito", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  headings: {
    fontFamily: '"Fredoka Variable", "Fredoka", "Nunito Variable", system-ui, "PingFang SC", sans-serif',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '34px', lineHeight: '1.1' },
      h2: { fontSize: '26px', lineHeight: '1.15' },
      h3: { fontSize: '21px', lineHeight: '1.2' },
      h4: { fontSize: '18px', lineHeight: '1.25' },
    },
  },
  defaultRadius: 'lg',
  radius: { xs: '8px', sm: '12px', md: '16px', lg: '22px', xl: '28px' },
  spacing: { xs: '6px', sm: '10px', md: '14px', lg: '20px', xl: '28px' },
  shadows: {
    xs: `0 2px 0 ${C.ink}`,
    sm: `0 3px 0 ${C.ink}`,
    md: `0 4px 0 ${C.ink}`,
    lg: `0 6px 0 ${C.ink}`,
    xl: `0 8px 0 ${C.ink}`,
  },
  cursorType: 'pointer',
  components: {
    Button: Button.extend({
      defaultProps: { radius: 'xl', size: 'md' },
      classNames: { root: 'hb-press' },
      styles: { root: { fontFamily: '"Fredoka Variable", system-ui, sans-serif', fontWeight: 600, letterSpacing: 0.2 } },
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'xl' } }),
    Badge: Badge.extend({
      defaultProps: { radius: 'xl' },
      styles: { root: { textTransform: 'none', fontWeight: 800, letterSpacing: 0.1 } },
    }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    Modal: Modal.extend({
      defaultProps: { radius: 'xl', centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 2 } },
      styles: { content: { border: `2.5px solid ${C.ink}`, boxShadow: `0 6px 0 ${C.ink}` }, title: { fontFamily: '"Fredoka Variable", system-ui', fontWeight: 600, fontSize: 20 } },
    }),
    TextInput: TextInput.extend({ defaultProps: { radius: 'xl', size: 'md' } }),
    Textarea: Textarea.extend({ defaultProps: { radius: 'lg' } }),
  },
});

export const money = (n: number, cur = 'CAD', digits = 2) =>
  `${cur} ${Number(n).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const shortMoney = (n: number, cur = 'CAD') =>
  `${cur} ${Math.round(n).toLocaleString('en-CA')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
export const monthName = (iso: string) => LONG_MONTHS[Number(iso.split('-')[1]) - 1];
export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
