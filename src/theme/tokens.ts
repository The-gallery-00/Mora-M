// src/theme/tokens.ts
//
// 색 HEX 의 유일한 정본이다(위키 Design Tokens.md §13-0 / §13-3).
// - `src/global.css` 의 CSS 변수 2벌은 이 파일에서 `npm run theme:css` 로 생성한다. 손으로 고치지 않는다.
// - `tailwind.config.js` 는 그 변수만 참조하므로 HEX 가 없다.
// - className 을 못 쓰는 지점(Reanimated·StatusBar·SVG fill·BottomSheet backdrop·elevation)은
//   `useTheme()` 으로 이 객체를 읽는다.
import { Platform, type ViewStyle } from 'react-native';

export type ResolvedScheme = 'light' | 'dark';

/* ── elevation: 라이트=그림자 / 다크=표면 밝기 (§10-6) ───────────────── */
const mkElevation = (
  scheme: ResolvedScheme,
  surfaces: { [k in 'raised' | 'dropdown' | 'sheet' | 'overlay']: string },
) => {
  const shadow = (
    offsetY: number,
    blur: number,
    opacity: number,
    androidElevation: number,
    bg: string,
  ): ViewStyle =>
    Platform.select<ViewStyle>({
      ios:
        scheme === 'light'
          ? {
              backgroundColor: bg,
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: offsetY },
              shadowOpacity: opacity,
              shadowRadius: blur,
            }
          : // 다크: 검정 위 검정이라 그림자가 보이지 않는다. 형태를 유지하려고 opacity 만 0 으로 둔다 (§10-6 규칙 2)
            {
              backgroundColor: bg,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: offsetY },
              shadowOpacity: 0,
              shadowRadius: blur,
            },
      android: { backgroundColor: bg, elevation: androidElevation, shadowColor: '#0F172A' },
      default: { backgroundColor: bg },
    })!;
  return {
    flat: {} as ViewStyle,
    raised: shadow(2, 8, 0.06, 2, surfaces.raised),
    dropdown: shadow(4, 12, 0.1, 4, surfaces.dropdown),
    sheet: shadow(8, 16, 0.12, 8, surfaces.sheet),
    overlay: shadow(22, 40, 0.25, 16, surfaces.overlay),
  } as const;
};

/* ── 라이트 ──────────────────────────────────────────────────────────
   주의: `as const` 를 붙이지 않는다. 붙이면 값이 리터럴 타입('#FFFFFF')으로 좁혀져
   아래 dark 객체가 같은 타입으로 검사되지 못한다. 지금 형태여야 키 누락·오타를 컴파일러가 잡는다. */
const light = {
  scheme: 'light' as ResolvedScheme,
  bg: { base: '#FFFFFF', elevated: '#FFFFFF', sunken: '#F1F5F9' },
  surface: { base: '#F8FAFC', alt: '#F1F5F9', active: '#F0F9FF', input: '#FAFBFC', overlay: '#FFFFFF' },
  border: { subtle: '#CBD5E1', strong: '#64748B' },
  text: { primary: '#111111', secondary: '#505050', muted: '#64748B', disabled: '#999999', inverse: '#FFFFFF' },
  brand: { base: '#15293D', pressed: '#122436', container: '#E8EDF3' },
  action: { base: '#0077B6', pressed: '#0069A0' },
  success: { base: '#16A34A', text: '#166534', container: '#DCFCE7' },
  warn: { base: '#92400E', container: '#FFFBEB', border: '#FDE68A' },
  danger: { base: '#DC2626', strong: '#B91C1C', pressed: '#C22121', container: '#FEE2E2', border: '#FECACA' },
  info: { base: '#2563EB', container: '#EFF6FF', border: '#DBEAFE' },
  // scrim / overlayImage 는 알파가 테마마다 달라(0.30 → 0.60) CSS 채널 변수로 표현할 수 없다.
  // 클래스로 쓰지 않고 `useTheme().scrim` 으로만 소비한다 (§13-1 각주 — 값의 출처는 여전히 이 파일 하나).
  scrim: 'rgba(0,0,0,0.30)',
  overlayImage: 'rgba(15,23,42,0.55)',
  doc: {
    BUSINESS_CARD: { fg: '#15293D', bg: '#E8EDF3' },
    TICKET: { fg: '#6746AF', bg: '#E9E5FA' },
    POSTER: { fg: '#0069A0', bg: '#E8EDF3' },
    RECEIPT: { fg: '#166534', bg: '#CFE5D0' },
    DEADLINE: { fg: '#B45309', bg: '#FEF3E2' },
  },
  calendar: { sunday: '#DC2626', saturday: '#2563EB', selected: '#E8EDF3', poster: '#0D9488' },
  skeleton: { base: '#F1F5F9', highlight: '#FFFFFF' },
  elevation: mkElevation('light', {
    raised: '#FFFFFF',
    dropdown: '#FFFFFF',
    sheet: '#FFFFFF',
    overlay: '#FFFFFF',
  }),
};

export type ThemeTokens = typeof light;

/* ── 다크 (§10-3 / §10-4 정본값) ─────────────────────────────────── */
const dark: ThemeTokens = {
  scheme: 'dark',
  bg: { base: '#0F1621', elevated: '#17202D', sunken: '#0A0F17' },
  surface: { base: '#1C2634', alt: '#232E3E', active: '#14324A', input: '#151E2A', overlay: '#2B3849' },
  border: { subtle: '#2A3646', strong: '#64748B' },
  text: { primary: '#E8EDF3', secondary: '#A8B6C8', muted: '#94A3B8', disabled: '#6B7A8D', inverse: '#0F1621' },
  brand: { base: '#AEC4D8', pressed: '#C6D8E7', container: '#1B2A3C' },
  action: { base: '#4BA3DB', pressed: '#6FB8E4' },
  success: { base: '#7BD69A', text: '#7BD69A', container: '#12291B' },
  warn: { base: '#EFB964', container: '#2E2308', border: '#4A3A12' },
  danger: { base: '#F0908C', strong: '#F5A5A1', pressed: '#F5A5A1', container: '#2E1516', border: '#5A2422' },
  info: { base: '#7FB0EF', container: '#14243D', border: '#26436E' },
  scrim: 'rgba(0,0,0,0.60)',
  overlayImage: 'rgba(0,0,0,0.72)',
  doc: {
    BUSINESS_CARD: { fg: '#AEC4D8', bg: '#1B2A3C' },
    TICKET: { fg: '#C2B3E6', bg: '#2A2340' },
    POSTER: { fg: '#73B5DE', bg: '#12283A' },
    RECEIPT: { fg: '#7BD69A', bg: '#16301F' },
    DEADLINE: { fg: '#E8B172', bg: '#33240F' },
  },
  calendar: { sunday: '#F0908C', saturday: '#7FB0EF', selected: '#1B2A3C', poster: '#5EEAD4' },
  skeleton: { base: '#232E3E', highlight: '#2E3B4D' },
  elevation: mkElevation('dark', {
    raised: '#17202D',
    dropdown: '#1C2634',
    sheet: '#232E3E',
    overlay: '#2B3849',
  }),
};

export const themes: Record<ResolvedScheme, ThemeTokens> = { light, dark };
