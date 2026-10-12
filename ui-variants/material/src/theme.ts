// Material 3 style theme for MUI. Colour roles come from a deep-teal seed (tonal palette tones
// 10/20/30/40/80/90 etc.), surfaces use the M3 "surface container" ladder instead of shadows,
// and shapes follow the M3 corner scale (XS 4, S 8, M 12, L 16, XL 28, full).
import { alpha, createTheme } from '@mui/material/styles';

export const m3 = {
  primary: '#006A6A',
  onPrimary: '#FFFFFF',
  primaryContainer: '#A6EFEE',
  onPrimaryContainer: '#002020',
  primaryFixedDim: '#82D4D3',
  secondary: '#4A6362',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#CCE8E6',
  onSecondaryContainer: '#051F1F',
  tertiary: '#3E5F8F',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#D5E3FF',
  onTertiaryContainer: '#001B3C',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  warning: '#7C5800',
  warningContainer: '#FFDEA6',
  onWarningContainer: '#271900',
  success: '#1D6C35',
  successContainer: '#A6F5B0',
  onSuccessContainer: '#00210A',
  surface: '#F4FBFA',
  surfaceDim: '#D5DBDA',
  surfaceBright: '#F4FBFA',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#EEF5F4',
  surfaceContainer: '#E9EFEE',
  surfaceContainerHigh: '#E3E9E8',
  surfaceContainerHighest: '#DDE4E3',
  onSurface: '#161D1D',
  onSurfaceVariant: '#3F4948',
  outline: '#6F7979',
  outlineVariant: '#BEC9C8',
  inverseSurface: '#2B3231',
  inverseOnSurface: '#ECF2F1',
  inversePrimary: '#82D4D3',
  scrim: '#000000',
} as const;

export type M3 = typeof m3;

declare module '@mui/material/styles' {
  interface Theme {
    m3: M3;
  }
  interface ThemeOptions {
    m3?: M3;
  }
}

const FONT = '"Manrope Variable", "Manrope", system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

// Elevation in M3 is mostly tonal; shadows are kept soft and used for the few floating things (FAB, sheet).
const shadow1 = '0 1px 2px rgba(0,32,32,.10), 0 1px 3px 1px rgba(0,32,32,.06)';
const shadow3 = '0 4px 8px 3px rgba(0,32,32,.08), 0 1px 3px rgba(0,32,32,.12)';

export const theme = createTheme({
  m3,
  palette: {
    mode: 'light',
    primary: { main: m3.primary, contrastText: m3.onPrimary, light: m3.primaryContainer, dark: '#004F4F' },
    secondary: { main: m3.secondary, contrastText: m3.onSecondary, light: m3.secondaryContainer },
    error: { main: m3.error, contrastText: m3.onError, light: m3.errorContainer },
    warning: { main: m3.warning, contrastText: '#FFFFFF', light: m3.warningContainer },
    success: { main: m3.success, contrastText: '#FFFFFF', light: m3.successContainer },
    info: { main: m3.tertiary, contrastText: m3.onTertiary, light: m3.tertiaryContainer },
    background: { default: m3.surface, paper: m3.surfaceContainerLow },
    text: { primary: m3.onSurface, secondary: m3.onSurfaceVariant, disabled: alpha(m3.onSurface, 0.38) },
    divider: m3.outlineVariant,
    action: { hover: alpha(m3.onSurface, 0.08), selected: alpha(m3.primary, 0.12), focus: alpha(m3.onSurface, 0.12) },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT,
    // M3 type scale mapped onto MUI variants.
    h1: { fontSize: 45, lineHeight: '52px', fontWeight: 600, letterSpacing: '-0.02em' }, // display medium
    h2: { fontSize: 36, lineHeight: '44px', fontWeight: 650, letterSpacing: '-0.02em' }, // display small
    h3: { fontSize: 32, lineHeight: '40px', fontWeight: 650, letterSpacing: '-0.015em' }, // headline large
    h4: { fontSize: 28, lineHeight: '36px', fontWeight: 650, letterSpacing: '-0.01em' }, // headline medium
    h5: { fontSize: 24, lineHeight: '32px', fontWeight: 650, letterSpacing: '-0.01em' }, // headline small
    h6: { fontSize: 20, lineHeight: '28px', fontWeight: 650, letterSpacing: '-0.005em' }, // title large
    subtitle1: { fontSize: 16, lineHeight: '24px', fontWeight: 650, letterSpacing: '0.005em' }, // title medium
    subtitle2: { fontSize: 14, lineHeight: '20px', fontWeight: 650, letterSpacing: '0.006em' }, // title small
    body1: { fontSize: 16, lineHeight: '24px', fontWeight: 450, letterSpacing: '0.01em' },
    body2: { fontSize: 14, lineHeight: '20px', fontWeight: 450, letterSpacing: '0.01em' },
    caption: { fontSize: 12, lineHeight: '16px', fontWeight: 500, letterSpacing: '0.02em' },
    overline: { fontSize: 11, lineHeight: '16px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' },
    button: { fontSize: 14, lineHeight: '20px', fontWeight: 650, letterSpacing: '0.01em', textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#DCE5E4', fontFeatureSettings: '"tnum" 1, "cv11" 1' },
        '*::-webkit-scrollbar': { width: 0, height: 0 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderRadius: 24, backgroundColor: m3.surfaceContainerLow, overflow: 'hidden' },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 } } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, minHeight: 40, paddingInline: 24 },
        sizeLarge: { minHeight: 52, fontSize: 16, paddingInline: 28 },
        sizeSmall: { minHeight: 32, paddingInline: 14 },
        outlined: { borderColor: m3.outline },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { color: m3.onSurfaceVariant } },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 600, height: 32, fontSize: 13 },
        sizeSmall: {
          height: 24,
          fontSize: 12,
          borderRadius: 6,
          '& .MuiChip-label': { paddingInline: 8 },
          '& .MuiChip-icon': { fontSize: 15, marginLeft: 6 },
        },
        outlined: { borderColor: m3.outlineVariant, color: m3.onSurfaceVariant },
        label: { paddingInline: 12 },
        icon: { marginLeft: 8, fontSize: 18 },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: shadow3,
          textTransform: 'none',
          backgroundColor: m3.primaryContainer,
          color: m3.onPrimaryContainer,
          '&:hover': { backgroundColor: '#97E2E1' },
        },
        extended: { height: 56, borderRadius: 16, paddingInline: 20, fontSize: 15, gap: 10 },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 28, backgroundColor: m3.surfaceContainerHigh, boxShadow: shadow3 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: 24, lineHeight: '32px', fontWeight: 650, padding: '24px 24px 12px' } },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: ({ ownerState }) =>
          ownerState.anchor === 'bottom'
            ? {
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                backgroundColor: m3.surfaceContainerLow,
                boxShadow: shadow3,
                maxHeight: '92%',
              }
            : ownerState.anchor === 'left'
              ? { borderTopRightRadius: 16, borderBottomRightRadius: 16, backgroundColor: m3.surfaceContainerLow, width: 300 }
              : {},
      },
    },
    MuiBackdrop: {
      styleOverrides: { root: { backgroundColor: alpha(m3.scrim, 0.32) } },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 6, borderRadius: 999, backgroundColor: m3.surfaceContainerHighest },
        bar: { borderRadius: 999 },
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 16 } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: m3.outlineVariant } },
    },
    MuiFilledInput: {
      defaultProps: { disableUnderline: true },
      styleOverrides: {
        root: {
          borderRadius: 28,
          backgroundColor: m3.surfaceContainerHigh,
          '&:hover': { backgroundColor: m3.surfaceContainerHighest },
          '&.Mui-focused': { backgroundColor: m3.surfaceContainerHighest },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 12 },
        notchedOutline: { borderColor: m3.outline },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: m3.inverseSurface, color: m3.inverseOnSurface, borderRadius: 6, fontSize: 12, padding: '6px 10px' },
      },
    },
    MuiSnackbar: {
      defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: { backgroundColor: m3.inverseSurface, color: m3.inverseOnSurface, borderRadius: 8, boxShadow: shadow3 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: ({ ownerState }) => {
          const tone = {
            error: [m3.errorContainer, m3.onErrorContainer],
            warning: [m3.warningContainer, m3.onWarningContainer],
            success: [m3.successContainer, m3.onSuccessContainer],
            info: [m3.tertiaryContainer, m3.onTertiaryContainer],
          }[(ownerState.severity ?? 'success') as 'error' | 'warning' | 'success' | 'info'];
          return {
            borderRadius: 16,
            alignItems: 'flex-start',
            ...((ownerState.variant ?? 'standard') === 'standard' && tone
              ? { backgroundColor: tone[0], color: tone[1], '& .MuiAlert-icon': { color: tone[1], opacity: 0.9 } }
              : {}),
          };
        },
      },
    },
    MuiStepLabel: {
      styleOverrides: {
        label: {
          fontSize: 12,
          fontWeight: 600,
          '&.MuiStepLabel-alternativeLabel': { marginTop: 6 },
          '&.Mui-active': { color: m3.primary, fontWeight: 700 },
          '&.Mui-completed': { color: m3.onSurface, fontWeight: 600 },
        },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: m3.surfaceContainerHighest,
          '&.Mui-active': { color: m3.primary },
          '&.Mui-completed': { color: m3.primary },
        },
        text: { fill: m3.onSurfaceVariant, fontWeight: 700 },
      },
    },
    MuiStepConnector: {
      styleOverrides: { line: { borderColor: m3.outlineVariant, borderTopWidth: 2 } },
    },
    MuiToggleButtonGroup: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: m3.outline,
          color: m3.onSurface,
          textTransform: 'none',
          fontWeight: 650,
          height: 40,
          paddingInline: 16,
          '&:first-of-type': { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
          '&:last-of-type': { borderTopRightRadius: 999, borderBottomRightRadius: 999 },
          '&.Mui-selected': {
            backgroundColor: m3.secondaryContainer,
            color: m3.onSecondaryContainer,
            '&:hover': { backgroundColor: '#BEDCDA' },
          },
        },
      },
    },
    // M3 switch: 52x32 track, 16dp thumb that grows to 24dp when on.
    MuiSwitch: {
      styleOverrides: {
        root: { width: 52, height: 32, padding: 0, overflow: 'visible' },
        switchBase: {
          padding: 0,
          margin: 4,
          top: 4,
          left: 4,
          transform: 'translateX(0)',
          '&.Mui-checked': {
            transform: 'translateX(20px)',
            margin: 0,
            top: 4,
            left: 4,
            color: m3.onPrimary,
            '& + .MuiSwitch-track': { backgroundColor: m3.primary, opacity: 1, borderColor: m3.primary },
            '& .MuiSwitch-thumb': { width: 24, height: 24, backgroundColor: m3.onPrimary },
          },
          '&.Mui-checked.MuiSwitch-colorError + .MuiSwitch-track': { backgroundColor: m3.error, borderColor: m3.error },
          '&.Mui-checked.MuiSwitch-colorError .MuiSwitch-thumb': { backgroundColor: m3.onError },
        },
        thumb: { width: 16, height: 16, boxShadow: 'none', backgroundColor: m3.outline },
        track: {
          borderRadius: 999,
          backgroundColor: m3.surfaceContainerHighest,
          border: `2px solid ${m3.outline}`,
          opacity: 1,
          boxSizing: 'border-box',
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: { root: { height: 80, backgroundColor: m3.surfaceContainer } },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          paddingTop: 12,
          gap: 4,
          minWidth: 0,
          color: m3.onSurfaceVariant,
          '& .nav-indicator': {
            width: 64,
            height: 32,
            borderRadius: 16,
            display: 'grid',
            placeItems: 'center',
            transition: 'background-color .2s',
          },
          '&.Mui-selected': { color: m3.onSurface },
          '&.Mui-selected .nav-indicator': { backgroundColor: m3.secondaryContainer, color: m3.onSecondaryContainer },
        },
        label: { fontSize: 12, fontWeight: 600, '&.Mui-selected': { fontSize: 12, fontWeight: 750 } },
      },
    },
  },
});

export const elevation = { level1: shadow1, level3: shadow3 };
