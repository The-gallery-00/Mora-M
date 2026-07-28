# Design Tokens

원본 웹 `globals.css`와 tsx 실측 HEX를 Expo/NativeWind 토큰으로 1:1 이식한 단일 출처 — 색·타이포·간격·반경·elevation·터치타겟의 정본. **라이트/다크 두 벌**을 모두 담는다(§10, §13).

상위: [[Home]]
관련: [[Mobile UX Guide]] · [[Component Library]] · [[Screen Specs]] · [[Conventions]] · [[ADR-004 Styling]] · [[Offline and State]] · [[Data Model]] · [[Phases]] · [[QA Checklist]]

---

## 0. 정본 규칙 (먼저 읽을 것)

1. **정본은 코드다.** 구 위키(`MORA_wiki/Design Tokens.md`)는 다크/그레이 테마 기준이라 낡았다. 값 충돌 시 `globals.css` + tsx 실측값이 이긴다. 원본: `C:/Users/user/Desktop/프로젝트/MORA/Mora/frontend/app/globals.css`
2. **이 문서 = `constants/theme.ts` = `tailwind.config.js`.** 셋이 어긋나면 이 문서를 기준으로 코드를 고친다. 색 HEX 변경 PR은 두 파일을 함께 수정해야 통과 ([[Conventions]] 체크리스트 항목).
3. **화면 코드에 HEX 리터럴 금지.** NativeWind 클래스(`bg-point`) 또는 `theme.colors.*`만 사용. 예외 없음 — 원본 웹이 페이지마다 로컬 `const C = {...}` 팔레트를 5벌 만들어 파편화된 것이 이번 이식의 최대 부채다. 원본: `app/page.tsx:25`, `app/dashboard/search/page.tsx:35`, `app/dashboard/settings/page.tsx:109`, `app/dashboard/storage/receipts/page.tsx:48`
4. 원본에 없어 새로 정하는 값은 `결정:` 으로 표시하고 이유를 한 줄 남긴다.
5. **레거시 오렌지 `#FF8A3D`(17회)는 이식 대상이 아니다.** 미사용 `components/landing/*` 6종 + `StorageCard`에만 남은 구 테마 잔재. 근거: 03-design.md §0-4 죽은 코드 목록.
6. **다크 팔레트는 원본이 존재하지 않는다.** §1~§9는 "원본 이식" 문서지만 §10 다크 값은 **이 문서가 최초이자 유일한 출처**다. 대조할 원본이 없으므로 근거는 대비비 계산값과 §10-2 설계 원칙(DK-##)뿐이다. 값을 바꾸려면 대비비를 다시 계산해 표를 갱신해야 한다.

---

## 1. 원본 CSS 변수 → RN 토큰 1:1 매핑

원본: `frontend/app/globals.css` `:root` 블록 전문.

| 원본 토큰명 | HEX | RN 토큰명 (`theme.colors.*`) | NativeWind 클래스 | 용도 |
|---|---|---|---|---|
| `--color-primary` | `#15293D` | `brand` | `bg-brand` `text-brand` | 브랜드 네이비. 로고·화면 타이틀·아바타·제출 버튼·챗봇 헤더 (54회) |
| `--color-point` | `#0077B6` | `point` | `bg-point` `text-point` | 액션 블루. 주요 CTA·활성 탭·저장/수정 버튼·OCR bbox (42회) |
| `--color-bg` | `#FFFFFF` | `bg` | `bg-bg` | 화면/카드 배경 (80회) |
| `--color-text` | `#111111` | `text` | `text-text` | 본문 최진함. 입력 값 텍스트 |
| `--color-subtitle` | `#505050` | `textSubtitle` | `text-subtitle` | 보조 텍스트·설명문 (27회) |
| `--color-disabled` | `#999999` | `textDisabled` | `text-disabled` | 플레이스홀더·캡션 (54회) ※ 대비 미달, §11 참조 |
| `--color-border` | `#CBD5E1` | `border` | `border-border` | 표준 1px 보더 (69회, 최다) |
| `--color-card-shadow` | `0px 4px 4px rgba(0,0,0,0.25)` | `elevation.raised` | — | RN엔 box-shadow 없음 → §8 대응표 |
| `--color-poster` / `-bg` | `#0077B6` / `#E8EDF3` | `doc.POSTER.fg/.bg` | `text-poster` `bg-poster-bg` | 포스터 배지 |
| `--color-ticket` / `-bg` | `#6746AF` / `#E9E5FA` | `doc.TICKET.fg/.bg` | `text-ticket` `bg-ticket-bg` | 티켓 배지 |
| `--color-receipt` / `-bg` | `#4FB048` / `#CFE5D0` | `doc.RECEIPT.fg/.bg` | `text-receipt` `bg-receipt-bg` | 영수증 배지 |
| `--color-deadline` / `-bg` | `#DC8540` / `#F7EADF` | `doc.DEADLINE.fg/.bg` | `text-deadline` `bg-deadline-bg` | 마감 D-day |
| `--radius-button` | `10px` | `radius.button` | `rounded-btn` | 버튼 표준 (29회) |
| `--radius-card` | `12px` | `radius.card` | `rounded-card` | 카드 표준 (40회) |

**변수 없이 tsx에만 하드코딩되어 있던 값 → 토큰화 (빈도순, 03-design.md §1-D)**

| HEX | 빈도 | RN 토큰명 | 클래스 | 용도 |
|---|---|---|---|---|
| `#333333` | 30 | `textStrong` | `text-strong` | 드로어 필드 값, 드롭다운 옵션 |
| `#F1F5F9` | 23 | `surfaceAlt` | `bg-surface-alt` | 세그먼트 배경, 구분선, 썸네일 플레이스홀더 |
| `#F8FAFC` | 20 | `surface` | `bg-surface` | 입력 배경, 패널 배경, 리스트 헤더 |
| `#E2E8F0` | 20 | `borderSoft` | `border-soft` | 연한 보더, 카드 프레임 |
| `#DC2626` | 18 | `danger` | `text-danger` | 에러·삭제·지출·일요일 |
| `#F0F9FF` | 13 | `surfaceActive` | `bg-surface-active` | 활성 내비 배경 → 모바일에선 선택 행/활성 칩 |
| `#2563EB` | 12 | `info` | `text-info` | 정보 배지 전경, 토요일 |
| `#EFF6FF` | 11 | `infoSoft` | `bg-info-soft` | 정보 배지 배경 |
| `#DBEAFE` | 12 | `infoBorder` | `border-info` | 정보 배지 보더, 챗봇 말풍선 보더 |
| `#FAFBFC` | 10 | `surfaceInput` | `bg-surface-input` | 편집 모드 입력 배경 |
| `#0F172A` | 10 | `ink` | `text-ink` | 그림자 색, 토스트 배경 |
| `#64748B` | 8 | `textMuted` | `text-muted` | 보조 캡션 (대비 4.76:1 통과) |
| `#334155` | 6 | `textBody` | `text-body` | 본문 slate-700 |
| `#94A3B8` | 6 | `textFaint` | `text-faint` | 최약 캡션 ※ 대비 미달, §11 |
| `#FEE2E2` / `#FEF2F2` / `#FECACA` / `#B91C1C` | 8/6/6/5 | `dangerSoft` / `dangerFaint` / `dangerBorder` / `dangerStrong` | `bg-danger-soft` 등 | 에러 박스 3종 세트 |
| `#16A34A` / `#DCFCE7` | 2/6 | `success` / `successSoft` | `text-success` `bg-success-soft` | 성공·수입 |
| `#FFFBEB` / `#FDE68A` / `#92400E` | 1/1/1 | `warnSoft` / `warnBorder` / `warn` | `bg-warn-soft` 등 | 저장 완료 안내 박스 |
| `#FEF3E2` | 2 | `doc.DEADLINE.bg` | `bg-deadline-bg` | **실사용 마감 배경** |
| `#767676` / `#3C4045` | 1/1 | `dividerLine` / `dividerText` | — | "또는" 구분선 (`Divider.tsx`) |
| `rgba(0,0,0,0.3)` | 4 | `scrim` | `bg-scrim` | 시트/모달 딤 (`StorageDrawer.tsx:134`) |

**결정: `--color-deadline-bg: #F7EADF`는 폐기하고 `#FEF3E2`를 채택.** 이유: CSS 변수는 tsx에서 한 번도 쓰이지 않았고 실제 마감 배지·아이콘 배경은 전부 `#FEF3E2`다(`dashboard/page.tsx:642,713`).

---

## 2. 두 개의 블루 시스템 정리 (가장 중요한 통합 결정)

원본에는 액션 컬러가 **두 벌** 공존한다.

| 계열 | 값 | 사용처 | 빈도 |
|---|---|---|---|
| A. `--color-point` | `#0077B6` | 대시보드 코어 — 활성 nav, 저장/수정 버튼, 업로드 스캔 버튼, OCR bbox | 42 |
| B. 로컬 `C.primary` | `#3B82F6` / `#1D4ED8` / `#2563EB` | 랜딩 CTA, 설정 토글 ON, 검색 배지, 가계부 등록 버튼 | 3 / 4 / 12 |

**결정: A(`#0077B6`)를 유일한 액션 컬러로 통일한다.**
이유 — (1) 실제 기능 화면(업로드·보관함·상세)에서 압도적 다수(42회)이고, (2) 브랜드 네이비 `#15293D`와 같은 한색 계열이라 하단 탭·FAB에서 톤이 붙으며, (3) `#3B82F6`는 흰 배경 대비 3.68:1로 본문 대비 기준을 못 넘긴다.

예외로 살리는 것:
- `info` 세트(`#2563EB` on `#EFF6FF`) — **정보성 배지 전용**으로 존치. 액션(누를 수 있는 것)에는 금지. 원본 검색 결과 타입 배지·"OCR" 배지가 이 조합이다.
- `#1D4ED8`, `#3B82F6` — 폐기. 랜딩 PrimaryCTA와 설정 토글 ON은 `point`로 교체.

**결정: 눌림(pressed) 색 2개 신설** — RN에는 hover가 없어 press 피드백 색이 반드시 필요한데 원본에 없다. 각 색을 12% 어둡게 한 값을 쓴다.
- `pointPressed: #0069A0`, `brandPressed: #122436`, `dangerPressed: #C22121`

---

## 3. `tailwind.config.js` (라이트 값의 원천 — 다크 포함 최종형은 §13-1)

> **읽는 순서** — 아래 블록은 라이트 HEX가 어떤 클래스명에 붙는지 보여주는 **원천 정의**다. 다크모드가 v1 In scope가 된 뒤 실제 `tailwind.config.js`는 HEX 대신 CSS 변수를 참조하며, **그 완성형이 §13-1**이다. 색 블록이 충돌하면 §13-1이 이긴다. `spacing`/`borderRadius`/`fontSize`/`fontFamily`는 테마와 무관하므로 아래 값이 그대로 정본이다.

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ── 브랜드 / 액션
        brand: { DEFAULT: '#15293D', pressed: '#122436' },
        point: { DEFAULT: '#0077B6', pressed: '#0069A0' },
        ink: '#0F172A',

        // ── 표면
        bg: '#FFFFFF',
        surface: { DEFAULT: '#F8FAFC', alt: '#F1F5F9', active: '#F0F9FF', input: '#FAFBFC' },
        scrim: 'rgba(0,0,0,0.3)',

        // ── 텍스트 (text-* 유틸로 사용)
        text: '#111111',
        strong: '#333333',
        subtitle: '#505050',
        body: '#334155',
        muted: '#64748B',
        faint: '#94A3B8',
        disabled: '#999999',
        invert: '#FFFFFF',

        // ── 보더 (border-* 유틸로 사용)
        border: { DEFAULT: '#CBD5E1', soft: '#E2E8F0', faint: '#F1F5F9' },

        // ── 상태
        danger: { DEFAULT: '#DC2626', strong: '#B91C1C', soft: '#FEE2E2', faint: '#FEF2F2', border: '#FECACA', pressed: '#C22121' },
        success: { DEFAULT: '#16A34A', soft: '#DCFCE7' },
        warn: { DEFAULT: '#92400E', soft: '#FFFBEB', border: '#FDE68A' },
        info: { DEFAULT: '#2563EB', soft: '#EFF6FF', border: '#DBEAFE' },

        // ── 문서 4종 + 마감 (배지 fg는 대비 보정값, §9 참조)
        card: { DEFAULT: '#15293D', bg: '#E8EDF3' },
        ticket: { DEFAULT: '#6746AF', bg: '#E9E5FA' },
        poster: { DEFAULT: '#0069A0', bg: '#E8EDF3' },
        receipt: { DEFAULT: '#166534', bg: '#CFE5D0' },
        deadline: { DEFAULT: '#B45309', bg: '#FEF3E2' },

        // ── 캘린더
        sunday: '#DC2626',
        saturday: '#2563EB',
        daySelected: '#E8EDF3',

        // ── 소셜 (브랜드 고정, 테마 무관)
        kakao: { DEFAULT: '#FEE500', fg: '#3C1E1E' },
        naver: { DEFAULT: '#2DB400', btn: '#54CF48' },
      },

      spacing: {
        // 4배수 기본 스케일은 Tailwind 기본값(1=4px)을 그대로 쓰고, 원본에만 있던 홀수 값만 추가
        '4.5': '18px',  // 소셜 아이콘 gap
        '5.5': '22px',  // 랜딩 CTA 좌우 패딩
        '7.5': '30px',
        screen: '16px', // 화면 좌우 거터 (원본 40px → 모바일 16px)
        sheet: '20px',  // 바텀시트 내부 패딩
      },

      borderRadius: {
        xs: '4px',    // 마이크로 배지, bbox
        sm: '6px',    // 소형 버튼, 편집 input (원본 40회)
        md: '8px',    // 드롭다운, 세그먼트 (원본 30회)
        btn: '10px',  // --radius-button
        card: '12px', // --radius-card
        field: '14px',// 인증 폼 입력/버튼
        xl: '16px',   // 큰 패널
        sheet: '20px',// 바텀시트 상단
      },

      fontSize: {
        micro:    ['10px', { lineHeight: '14px' }],
        caption:  ['11px', { lineHeight: '16px' }],
        label:    ['12px', { lineHeight: '16px' }],
        'body-sm':['13px', { lineHeight: '20px' }],
        base:     ['14px', { lineHeight: '22px' }],
        button:   ['15px', { lineHeight: '20px' }],
        input:    ['16px', { lineHeight: '24px' }],
        h3:       ['17px', { lineHeight: '24px' }],
        h2:       ['20px', { lineHeight: '28px' }],
        h1:       ['22px', { lineHeight: '30px' }],
        stat:     ['24px', { lineHeight: '30px' }],
        display:  ['32px', { lineHeight: '38px' }],
      },

      // 커스텀 폰트는 weight 유틸(font-bold)로 선택되지 않는다. 반드시 패밀리 클래스를 쓴다.
      fontFamily: {
        sans: ['Pretendard-Regular'],
        w500: ['Pretendard-Medium'],
        w600: ['Pretendard-SemiBold'],
        w700: ['Pretendard-Bold'],
        w800: ['Pretendard-ExtraBold'],
        logo: ['PatuaOne-Regular'],
        mono: ['SpaceMono-Regular'],
      },
    },
  },
  plugins: [],
};
```

---

## 4. 런타임 토큰 객체 (StyleSheet/로직에서 쓰는 정본)

> **경로/구조 정합** — 이 파일의 정본 경로는 **`src/theme/tokens.ts`**이며(§13-0), 색 부분은 다크모드 편입에 따라 **light/dark 두 객체 + `useTheme()`** 구조로 대체되었다 — 완성형은 §13-3이다. 아래 블록은 여전히 유효한 부분(팔레트 원시값, `docType`, `spacing`, `radius`, `fontFamily`, `typography`, `touch`, `layout`, `motion`, `zIndex`)의 정본이고, **`colors` / `elevation` 두 export만 §13-3이 대체**한다. 화면 코드는 어느 쪽이든 직접 import하지 않고 `useTheme()`을 통과한다.

```ts
// src/theme/tokens.ts (색 외 부분) — 구 표기 `constants/theme.ts`
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/* 1) 원시 팔레트 — 화면 코드에서 직접 import 금지. semantic 토큰을 통해서만 접근한다. */
export const palette = {
  navy: '#15293D',      navyPressed: '#122436',
  point: '#0077B6',     pointPressed: '#0069A0',
  ink: '#0F172A',       white: '#FFFFFF',
  slate50: '#F8FAFC',   slate100: '#F1F5F9',  slate200: '#E2E8F0',
  slate300: '#CBD5E1',  slate400: '#94A3B8',  slate500: '#64748B',
  slate700: '#334155',  sky50: '#F0F9FF',
  gray111: '#111111',   gray333: '#333333',   gray505: '#505050',  gray999: '#999999',
  red600: '#DC2626',    red700: '#B91C1C',    red100: '#FEE2E2',   red50: '#FEF2F2',  red200: '#FECACA',
  redPressed: '#C22121',
  green600: '#16A34A',  green100: '#DCFCE7',  green800: '#166534',
  amber50: '#FFFBEB',   amber200: '#FDE68A',  amber700: '#B45309', amber800: '#92400E', amber100: '#FEF3E2',
  blue600: '#2563EB',   blue50: '#EFF6FF',    blue100: '#DBEAFE',
  violet: '#6746AF',    violetBg: '#E9E5FA',
  paleBlueBg: '#E8EDF3', paleGreenBg: '#CFE5D0',
  pointDark: '#0069A0',
} as const;

/* 2) semantic 색 토큰 — 컴포넌트가 쓰는 유일한 색 출처 */
export const colors = {
  brand: palette.navy,
  brandPressed: palette.navyPressed,
  point: palette.point,
  pointPressed: palette.pointPressed,
  ink: palette.ink,

  bg: palette.white,
  surface: palette.slate50,
  surfaceAlt: palette.slate100,
  surfaceActive: palette.sky50,
  surfaceInput: '#FAFBFC',
  scrim: 'rgba(0,0,0,0.3)',

  text: palette.gray111,
  textStrong: palette.gray333,
  textSubtitle: palette.gray505,
  textBody: palette.slate700,
  textMuted: palette.slate500,
  textFaint: palette.slate400,
  textDisabled: palette.gray999,
  textInvert: palette.white,

  border: palette.slate300,
  borderSoft: palette.slate200,
  borderFaint: palette.slate100,

  danger: palette.red600,
  dangerStrong: palette.red700,
  dangerSoft: palette.red100,
  dangerFaint: palette.red50,
  dangerBorder: palette.red200,
  dangerPressed: palette.redPressed,

  success: palette.green600,
  successSoft: palette.green100,

  warn: palette.amber800,
  warnSoft: palette.amber50,
  warnBorder: palette.amber200,

  info: palette.blue600,
  infoSoft: palette.blue50,
  infoBorder: palette.blue100,

  sunday: palette.red600,
  saturday: palette.blue600,
  daySelected: palette.paleBlueBg,
} as const;

/* 3) 문서 4종 + 마감 — 라벨/라우트/색을 한 곳에 묶는다 (원본 dashboard/page.tsx TYPE_COLORS 확장) */
export const docType = {
  BUSINESS_CARD: { label: '명함',   fg: palette.navy,      bg: palette.paleBlueBg,  route: 'card',    icon: 'FileText' },
  TICKET:        { label: '티켓',   fg: palette.violet,    bg: palette.violetBg,    route: 'ticket',  icon: 'Calendar' },
  POSTER:        { label: '포스터', fg: palette.pointDark, bg: palette.paleBlueBg,  route: 'poster',  icon: 'FolderTree' },
  RECEIPT:       { label: '영수증', fg: palette.green800,  bg: palette.paleGreenBg, route: 'receipt', icon: 'ScanText' },
  DEADLINE:      { label: '마감',   fg: palette.amber700,  bg: palette.amber100,    route: null,      icon: 'AlarmClock' },
} as const;
export type DocTypeKey = keyof typeof docType;

/* 4) 간격 — 4배수 그리드 */
export const spacing = {
  none: 0, xxs: 4, xs: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40, giant: 48,
} as const;

/* 5) 반경 */
export const radius = {
  xs: 4, sm: 6, md: 8, button: 10, card: 12, field: 14, xl: 16, sheet: 20, pill: 999,
} as const;

/* 6) 폰트 패밀리 — Android는 fontWeight로 굵기를 못 고른다. 반드시 패밀리로 지정. */
export const fontFamily = {
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semibold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
  extrabold: 'Pretendard-ExtraBold',
  logo: 'PatuaOne-Regular',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })!,
} as const;

/* 7) 타이포 역할 */
export const typography = {
  display:    { fontFamily: fontFamily.extrabold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  h1:         { fontFamily: fontFamily.bold,      fontSize: 22, lineHeight: 30, letterSpacing: -0.2 },
  h2:         { fontFamily: fontFamily.bold,      fontSize: 20, lineHeight: 28, letterSpacing: -0.2 },
  h3:         { fontFamily: fontFamily.bold,      fontSize: 17, lineHeight: 24 },
  section:    { fontFamily: fontFamily.semibold,  fontSize: 16, lineHeight: 22 },
  stat:       { fontFamily: fontFamily.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  input:      { fontFamily: fontFamily.medium,    fontSize: 16, lineHeight: 24 },
  button:     { fontFamily: fontFamily.bold,      fontSize: 15, lineHeight: 20 },
  body:       { fontFamily: fontFamily.regular,   fontSize: 14, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.semibold,  fontSize: 14, lineHeight: 22 },
  bodySm:     { fontFamily: fontFamily.regular,   fontSize: 13, lineHeight: 20 },
  label:      { fontFamily: fontFamily.semibold,  fontSize: 12, lineHeight: 16 },
  caption:    { fontFamily: fontFamily.regular,   fontSize: 11, lineHeight: 16 },
  micro:      { fontFamily: fontFamily.bold,      fontSize: 10, lineHeight: 14, letterSpacing: 0.2 },
  logo:       { fontFamily: fontFamily.logo,      fontSize: 24, lineHeight: 28, letterSpacing: 3 },
  mono:       { fontFamily: fontFamily.mono,      fontSize: 12, lineHeight: 18 },
} satisfies Record<string, TextStyle>;

/* 8) elevation — RN에는 box-shadow가 없다. iOS shadow* / Android elevation 분기. */
const shadow = (offsetY: number, blur: number, opacity: number, androidElevation: number): ViewStyle =>
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: palette.ink,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: blur,
    },
    android: { elevation: androidElevation, shadowColor: palette.ink },
    default: {},
  })!;

export const elevation = {
  flat: {} as ViewStyle,
  raised:   shadow(2, 8, 0.06, 2),   // 카드
  dropdown: shadow(4, 12, 0.10, 4),  // 메뉴/토스트/스낵바
  sheet:    shadow(8, 16, 0.12, 8),  // 바텀시트/FAB
  overlay:  shadow(22, 40, 0.25, 16),// 풀스크린 모달 헤더, 드래그 중 카드
} as const;

/* 9) 터치 타겟 */
export const touch = {
  min: 44,          // iOS HIG 최소
  comfortable: 48,  // Material 권장 (기본값)
  hitSlop: {
    sm: { top: 6, bottom: 6, left: 6, right: 6 },   // 36dp 요소 → 48dp
    md: { top: 8, bottom: 8, left: 8, right: 8 },   // 32dp 요소 → 48dp
    lg: { top: 10, bottom: 10, left: 10, right: 10 },// 28dp 요소 → 48dp
  },
} as const;

/* 10) 레이아웃 상수 */
export const layout = {
  screenPaddingX: 16,
  listGap: 12,
  headerHeight: 56,     // 원본 웹 64 → 모바일 56
  tabBarHeight: 56,     // + useSafeAreaInsets().bottom
  fabSize: 56,
  fabMargin: 16,
  sheetSnapPoints: ['55%', '92%'] as const,
  maxContentWidth: 520, // 태블릿/폴더블에서 본문 폭 제한
} as const;

/* 11) 모션 — 수치의 단일 출처. 상세 규칙은 [[Mobile UX Guide]] §8 */
export const motion = {
  duration: { instant: 0, fast: 120, base: 200, slow: 320, sheetIn: 280, sheetOut: 220, toastIn: 200, toastOut: 160, shimmer: 1200 },
  easing: {
    standard: [0.2, 0, 0, 1] as const,      // 일반 진입/퇴장
    decelerate: [0.16, 1, 0.3, 1] as const, // 원본 랜딩 진입 이징 그대로
    accelerate: [0.4, 0, 1, 1] as const,    // 퇴장
  },
  spring: { damping: 50, stiffness: 400, mass: 1 }, // 바텀시트 스냅
} as const;

/* 12) z-layer — RN은 형제 간 zIndex만 유효. 화면 루트에서 이 순서를 지킨다. */
export const zIndex = { content: 0, stickyHeader: 10, fab: 20, tabBar: 30, sheet: 40, toast: 50, modal: 60 } as const;

export const theme = { colors, docType, spacing, radius, fontFamily, typography, elevation, touch, layout, motion, zIndex } as const;
export type Theme = typeof theme;
```

---

## 5. 타이포 스케일

| role | size | weight (패밀리) | lineHeight | letterSpacing | 용도 | 원본 근거 |
|---|---|---|---|---|---|---|
| `display` | 32 | 800 ExtraBold | 38 | -0.6 | 온보딩·랜딩 히어로 | 웹 `clamp(36px,5.6vw,64px)` → **결정: 32.** 360dp에서 "복잡한 기록 정리," 가 한 줄에 들어가는 최대치 |
| `h1` | 22 | 700 Bold | 30 | -0.2 | 화면 타이틀 | `upload/page.tsx:214` "문서 업로드" 22/700 |
| `h2` | 20 | 700 Bold | 28 | -0.2 | 시트 타이틀, 저장 완료 | `ChatbotWidget` "AI 모라냥" 20/700 |
| `h3` | 17 | 700 Bold | 24 | 0 | 상세 시트 헤더, 카드 제목 | `StorageDrawer.tsx:168` 17/700 |
| `section` | 16 | 600 SemiBold | 22 | 0 | 섹션 헤더 | `dashboard/page.tsx:702` "마감 임박" 16/600 |
| `stat` | 24 | 800 ExtraBold | 30 | -0.3 | 숫자 강조 | `dashboard/page.tsx:617` (단위 "건"은 `body`) |
| `input` | 16 | 500 Medium | 24 | 0 | 텍스트 입력 값 | `TextInput.tsx:31` 16/500/24px. **16 미만이면 iOS가 폼 포커스 시 확대**하므로 하한선 |
| `button` | 15 | 700 Bold | 20 | 0 | 모든 버튼 라벨 | 웹 13~16 혼재 → **결정: 15로 통일.** 터치 가독성 |
| `body` | 14 | 400 Regular | 22 | 0 | 본문, 필드 값 | `StorageDrawer` 값 14/`#333`/22px |
| `bodyStrong` | 14 | 600 SemiBold | 22 | 0 | 리스트 1차 정보(이름 등) | `storage/cards` 행 이름 14/600 |
| `bodySm` | 13 | 400 Regular | 20 | 0 | 부가 설명, 메타 | 원본 최다 사용 크기(85회) |
| `label` | 12 | 600 SemiBold | 16 | 0 | 배지, 폼 라벨 | 마감 배지 12/600 |
| `caption` | 11 | 400 Regular | 16 | 0 | 필드 라벨, 캡션 | `StorageDrawer.tsx:47` 11/`#999` |
| `micro` | 10 | 700 Bold | 14 | 0.2 | 미니 배지 | 웹 9px → **결정: 10.** 9px는 모바일 가독 한계 미만 |
| `logo` | 24 | Patua One 400 | 28 | 3 | MORA 워드마크 | `Nav.tsx:70`, `dashboard/layout.tsx:398` |
| `mono` | 12 | monospace | 18 | 0 | OCR 블록 칩, 신뢰도 | `upload/page.tsx` `fontFamily:'monospace'` |

### 5-1. Pretendard 적용 (expo-font)

원본은 `body { font-family: 'Pretendard', ... }`로 1순위 선언만 하고 **어디에서도 로드하지 않는다**(03-design.md §2-1). 즉 웹은 Noto Sans KR로 렌더된다. 앱에서 실제로 번들해 의도대로 구현한다.

**번들 파일 (5웨이트 + 로고 1)** — `assets/fonts/`
| 파일 | fontFamily 이름 | 대응 웹 weight |
|---|---|---|
| `Pretendard-Regular.ttf` | `Pretendard-Regular` | 400 (8회) |
| `Pretendard-Medium.ttf` | `Pretendard-Medium` | 500 (8회) |
| `Pretendard-SemiBold.ttf` | `Pretendard-SemiBold` | 600 (82회, 최다) |
| `Pretendard-Bold.ttf` | `Pretendard-Bold` | 700 (73회) |
| `Pretendard-ExtraBold.ttf` | `Pretendard-ExtraBold` | 800 (29회) |
| `PatuaOne-Regular.ttf` | `PatuaOne-Regular` | 로고 전용 |

- **결정: `.ttf`만 번들한다.** `.otf`도 Expo에서 동작하지만 구형 Android에서 렌더 실패 사례가 있어 `.ttf`가 안전하다.
- **결정: 가변 폰트(Pretendard Variable) 미사용.** RN이 `fontVariationSettings`를 지원하지 않아 웨이트별 정적 파일이 유일한 방법이다.
- 라이선스: Pretendard = SIL OFL 1.1, Patua One = SIL OFL 1.1 → 앱 번들 배포 가능. 오픈소스 고지는 설정 > 앱 정보에 표기 ([[Screen Specs]] 설정 화면).
- Patua One은 **latin subset만** 있다. 한글이 들어가면 시스템 폰트로 폴백되므로 `MORA` 워드마크에만 쓴다.

```tsx
// app/_layout.tsx (발췌)
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.ttf'),
    'Pretendard-Medium': require('../assets/fonts/Pretendard-Medium.ttf'),
    'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.ttf'),
    'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.ttf'),
    'Pretendard-ExtraBold': require('../assets/fonts/Pretendard-ExtraBold.ttf'),
    'PatuaOne-Regular': require('../assets/fonts/PatuaOne-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;
  return /* ... Providers + Stack ... */;
}
```

**함정 (반드시 지킬 것)**
1. `fontWeight: '700'` 또는 `font-bold` 클래스는 **Android에서 커스텀 폰트 굵기를 바꾸지 못한다.** 항상 `fontFamily`(또는 `font-w700` 클래스)로 지정한다. `typography.*`를 쓰면 자동으로 지켜진다.
2. RN `<Text>`는 기본 폰트가 시스템 폰트다. 앱 전역 기본값을 위해 `components/ui/Text.tsx` 래퍼를 만들고 **raw `<Text>` import를 ESLint로 금지**한다 ([[Conventions]]).
3. 한글 행간: Pretendard는 라틴 기준 행간이 좁다. 위 표의 `lineHeight`는 전부 한글 기준으로 1.4~1.6배로 재계산한 값이다. 임의로 줄이지 말 것.

---

## 6. 간격 스케일 (4배수)

| 토큰 | px | 용도 | 원본 근거 |
|---|---|---|---|
| `xxs` | 4 | 아이콘-텍스트 최소 간격, 배지 내부 세로 | gap 4 (7회) |
| `xs` | 6 | 아이콘-라벨 간격 | gap 6 (16회) |
| `sm` | 8 | **기본 단위.** 인접 요소 간격 | gap 8 (39회, 최다) |
| `md` | 12 | 리스트 항목 간격, 카드 내부 행 간격 | gap 12 (13회) |
| `lg` | 16 | **화면 좌우 거터.** 카드 내부 패딩 | 원본 40px → 모바일 16 |
| `xl` | 20 | 시트 내부 패딩, 섹션 내부 여백 | gap 20 (11회) |
| `xxl` | 24 | 섹션 간 간격 | gap 24 (8회) |
| `xxxl` | 32 | 큰 섹션 분리 | 원본 marginBottom 32 |
| `huge` | 40 | 빈 상태 상하 여백 | |
| `giant` | 48 | 온보딩 블록 분리 | |

**결정: 화면 좌우 패딩은 16 고정.** 원본 대시보드 표준은 `padding: '32px 40px'`인데, 360dp 기기에서 좌우 40은 콘텐츠 폭을 280dp로 깎는다. 상하는 `20`(헤더 아래 첫 요소)을 기본으로 한다.

**리스트 행 최소 높이 56.** 원본 `padding:'16px 12px'` 2줄 행을 모바일 터치 타겟(48) + 여유로 환산한 값.

---

## 7. 반경 스케일

| 토큰 | px | 용도 | 원본 빈도 |
|---|---|---|---|
| `xs` | 4 | 마이크로 배지, OCR bbox | 18 |
| `sm` | 6 | 편집 input, 소형 버튼 | 40 |
| `md` | 8 | 세그먼트, 드롭다운, 검색바 | 30 |
| `button` | 10 | **버튼 표준** (`--radius-button`) | 29 |
| `card` | 12 | **카드 표준** (`--radius-card`) | 40 |
| `field` | 14 | 인증 폼 입력/제출 버튼 | 9 |
| `xl` | 16 | 큰 패널, 이미지 프레임 | 14 |
| `sheet` | 20 | 바텀시트 상단 모서리 | 2 (챗봇 패널) |
| `pill` | 999 | 칩, 토글, 배지 | 7 |

**비대칭 반경(원본 유지)**: 챗봇 말풍선 — 사용자 `14/14/4/14`, 어시스턴트 `14/14/14/4`. RN에서는 `borderTopLeftRadius` 등 4개를 개별 지정한다.

---

## 8. Elevation — RN에는 box-shadow가 없다

웹 13종 그림자를 **4단계**로 축약한다. **아래는 라이트 기준이며, 다크에서는 그림자가 아니라 표면 밝기로 같은 위계를 만든다 — 대응표는 §10-6.**

| 토큰 | 원본 웹 값 | iOS (`shadowColor` = `#0F172A`) | Android | 적용 대상 |
|---|---|---|---|---|
| `flat` | `none` | — | `elevation: 0` | 기본 카드(보더만 사용) |
| `raised` | `0 2px 8px rgba(0,0,0,0.06)` | `offset {0,2}` `opacity .06` `radius 8` | `elevation: 2` | 마감 임박 카드, 리스트 카드 |
| `dropdown` | `0 4px 12px rgba(0,0,0,0.10)` | `offset {0,4}` `opacity .10` `radius 12` | `elevation: 4` | 액션시트, 토스트, 스낵바 |
| `sheet` | `0 8px 16px rgba(15,23,42,0.12)` | `offset {0,8}` `opacity .12` `radius 16` | `elevation: 8` | 바텀시트, FAB, 하단 탭바 상단 |
| `overlay` | `0 22px 40px rgba(15,23,42,0.25)` | `offset {0,22}` `opacity .25` `radius 40` | `elevation: 16` | 풀스크린 모달 헤더, 드래그 중 카드 |

**규칙**
1. **`boxShadow` prop 금지.** RN 0.76+에 존재하지만 New Architecture 한정 + Android 렌더 편차가 커서 v1에서는 쓰지 않는다. `elevation.*` 토큰만 사용.
2. **Android elevation은 부모의 `overflow: 'hidden'`에 잘린다.** 그림자 있는 카드는 `overflow: hidden`을 카드 내부 이미지 래퍼에만 건다.
3. **Android elevation은 배경색이 투명하면 그려지지 않는다.** 반드시 `backgroundColor`를 함께 지정.
4. **inset shadow는 RN에 없다.** 원본 `TextInput`의 `shadow-[inset_0px_4px_4px_0px_rgba(0,0,0,0.25)]`은 **삭제**한다. 이유: 시각 기여도가 낮고, 대체 구현(상단 그라디언트 오버레이)이 입력 레이어를 하나 더 늘려 커서/선택 동작을 방해한다.
5. `filter: drop-shadow(...)`(챗봇 FAB 로고)는 SVG가 아니라 **컨테이너 View의 `elevation.sheet`**로 대체한다.
6. 그림자 대신 **보더 우선.** 원본이 `1px solid #CBD5E1`를 69회 쓴 이유가 그것이다. 겹침이 없는 평면 카드는 `borderWidth: 1 / borderColor: border` + `flat`.

---

## 9. 문서 4종 색상 체계 (라이트)

> 다크 대응값은 **§10-4**에 있다. 두 표의 판정 기준(배지 텍스트가 자기 배경 위에서 4.5:1 이상)은 동일하다.

원본에는 **세 벌의 서로 다른 매핑**이 있다(globals.css / `dashboard/page.tsx TYPE_COLORS` / `app/page.tsx` 랜딩 목업). 랜딩 목업은 영수증=빨강, 포스터=앰버로 정반대다.

**결정: `dashboard/page.tsx:111` `TYPE_COLORS`를 정본으로 채택한다** (globals.css와 일치 + 명함이 유일하게 정의되어 있음). 랜딩 목업 팔레트는 폐기.

여기에 **배지 텍스트 대비 보정**을 적용한 최종안:

| 유형 | 배경(bg) | 원본 fg | 대비 | 최종 fg (배지 텍스트) | 대비 | 비고 |
|---|---|---|---|---|---|---|
| 명함 `BUSINESS_CARD` | `#E8EDF3` | `#15293D` | 12.6:1 ✅ | `#15293D` 유지 | 12.6:1 | |
| 티켓 `TICKET` | `#E9E5FA` | `#6746AF` | 5.6:1 ✅ | `#6746AF` 유지 | 5.6:1 | |
| 포스터 `POSTER` | `#E8EDF3` | `#0077B6` | 4.1:1 ❌ | **`#0069A0`** | 5.1:1 | 결정: point-pressed 재사용 |
| 영수증 `RECEIPT` | `#CFE5D0` | `#4FB048` | 2.1:1 ❌ | **`#166534`** | 5.4:1 | 결정: green-800(원본에 존재하는 값) |
| 마감 `DEADLINE` | `#FEF3E2` | `#DC8540` | 2.6:1 ❌ | **`#B45309`** | 4.6:1 | 결정: amber-700(원본에 존재) |

- 대비는 WCAG 2.1 상대휘도 공식 계산값. 12px 배지 텍스트는 "일반 텍스트"이므로 4.5:1이 기준이다.
- 원본 fg(`#4FB048`, `#DC8540`, `#0077B6`)는 **비텍스트 용도**(아이콘, 프로그레스, 그래프, 좌측 컬러바)로는 그대로 쓴다. 3:1만 넘기면 되기 때문.
- D-day 색 규칙(원본 `dashboard/page.tsx:815`)은 유지: `dDay <= 3 ? deadline : point`.

**타입 배지 규격 (전 화면 공통)** — `padding: 2px 8px`(마이크로) / `4px 10px`(기본), `radius: pill`, `typography.label`, fg/bg는 위 표.

**유형 코드 ↔ 라벨 ↔ 모바일 라우트** (`theme.docType`이 단일 출처)

| DocumentType | 한글 | 모바일 세그먼트/라우트 |
|---|---|---|
| `BUSINESS_CARD` | 명함 | `/(tabs)/archive?type=BUSINESS_CARD`, 상세 `/doc/card/[id]` |
| `TICKET` | 티켓 | `type=TICKET`, `/doc/ticket/[id]` |
| `POSTER` | 포스터 | `type=POSTER`, `/doc/poster/[id]` |
| `RECEIPT` | 영수증 | `type=RECEIPT`, `/doc/receipt/[id]` |
| `ETC` | 기타 | 저장 불가 (서버가 `'지원하지 않는 문서 유형입니다.'`로 거부) |

칩 노출 순서는 원본 헤더 드롭다운 순서를 그대로 따른다: **명함 → 티켓 → 포스터 → 영수증** (`dashboard/layout.tsx:7-19`).

---

## 10. 다크모드 — v1 In scope

### 10-1. 결정과 근거

**결정: 다크모드는 v1 필수 기능이다.** 2026-07-27 사용자 결정으로 종전의 "v1 라이트 고정" 결정은 **폐기**되었다. 개정 경위와 대안 재평가는 [[ADR-004 Styling]] §개정 이력.

| 항목 | v1 확정 내용 |
|---|---|
| 테마 선택 | **3택** — `시스템 따름`(기본값) / `라이트` / `다크`. 변경 지점은 설정 화면(SCR-25)의 세그먼트 하나 (CMP-12 `SegmentedControl`) |
| 영속 | MMKV `theme.mode` ([[Offline and State]] §1-4). MMKV는 **동기** 읽기라 부팅 첫 프레임에 복원되어 흰 화면 깜빡임이 없다 |
| 시스템 따름 | `useColorScheme()` 추종. 앱 실행 중 OS 테마가 바뀌면 즉시 반영 ([[Mobile UX Guide]] §14 UX-25) |
| 네이티브 | `app.config.ts` `userInterfaceStyle: "automatic"` — 구 결정의 `"light"` 고정은 폐기. 액션시트·날짜 피커·키보드가 앱 테마와 함께 움직여야 한다 |
| 팔레트 출처 | **원본 웹에 다크 팔레트가 없다.** §10-3 / §10-4 가 유일한 정본이며, 이 작업은 "이식"이 아니라 **신규 설계**다 |

**"원본이 없다"의 의미** — 원본 `globals.css`에는 `:root` 라이트 변수만 있고, 설정 화면의 `라이트`/`다크` 세그먼트는 `document.documentElement.dataset.theme`만 세팅하고 대응 스타일이 존재하지 않는다(03-design.md §7-9). 대조할 원본이 0이므로 아래 값은 **브랜드 두 색의 색상(hue)을 보존한다**는 제약 하나만 두고 새로 정했다 — `#15293D` H210 / `#0077B6` H201 → 다크 변형 H209 / H203. 검증 가능한 유일한 객관 기준이 대비비이므로 **모든 조합에 WCAG 2.1 상대휘도 계산값을 병기**한다. 값 변경 PR은 대비비를 다시 계산해 표를 갱신해야 통과한다.

### 10-2. 다크 설계 원칙 (DK-##)

| ID | 원칙 | 이유 / 구체 규칙 |
|---|---|---|
| DK-01 | **순수 검정 `#000000` 금지. 베이스는 `#0F1621`** | (a) OLED에서 완전 소등 픽셀은 전환 지연(스미어링)과 밝은 텍스트 주변 헤일로가 눈에 띈다. (b) 검정 위에서는 그림자가 보이지 않아 고도 표현 수단이 전부 사라진다 — 표면을 밝혀 올릴 여지(`#0F1621` → `#2B3849`, 5단)를 남겨야 한다. (c) `#0F1621`은 브랜드 네이비와 같은 H210 계열이라 라이트/다크가 같은 앱으로 읽힌다 |
| DK-02 | **고도는 그림자가 아니라 표면 밝기** | 다크에서 `shadowOpacity`를 올려도 검정 위 검정이라 시각 변화가 없다. elevation 5단계를 표면 휘도 5단계로 치환한다 (§10-6). iOS `shadow*`는 다크에서 값을 0으로 내리고 Android `elevation`은 유지한다(Android는 elevation이 곧 오버레이 틴트 근거이나, 우리는 배경색으로 직접 표현하므로 그림자 색만 무력화한다) |
| DK-03 | **대면적은 채도↓ 명도↑** | 브랜드 `#15293D`(H210 S49 L16) → `#AEC4D8`(H209 **S35** L**76**), 액션 `#0077B6`(H201 S100 L36) → `#4BA3DB`(H203 **S67** L**58**). 고채도 밝은 색은 어두운 배경에서 경계가 번지고(할레이션) 장시간 응시 피로가 크다. 소면적 상태색은 명도만 올리고 채도는 20% 안쪽으로만 낮춘다 |
| DK-04 | **모든 텍스트 조합 WCAG AA 4.5:1 이상** | 대형 텍스트(18pt 이상 또는 14pt Bold 이상 = `h1`/`h2`/`stat`/`display`)와 비텍스트 경계는 3:1. §10-3 대비비 열이 그 검증 기록이며, 표에 ❌가 있는 토큰은 정보 전달 금지 토큰이다 |
| DK-05 | **채움 버튼 라벨은 흰색이 아니라 `text.inverse`** | 다크 `action #4BA3DB`(L58) 위 흰 글자는 **2.78:1**로 무너진다. 밝은 컨테이너 + 어두운 라벨(`#0F1621`, **6.53:1**)만 AA를 넘긴다. 라이트의 "짙은 채움 + 흰 라벨"과 정반대이므로 `Button` 구현에서 라벨 색을 테마 토큰으로 받아야 한다 (CMP-01) |
| DK-06 | **pressed는 어둡게가 아니라 밝게** | 라이트는 12% 어둡게(§2), 다크는 12% 밝게. 다크에서 어둡게 하면 배경으로 가라앉아 눌림이 보이지 않는다. `action.pressed` 라이트 `#0069A0` / 다크 `#6FB8E4` |
| DK-07 | **보더를 두 역할로 분리** | 장식용 `border.subtle`(구분선·카드 프레임)과 경계 필수 `border.strong`(입력 외곽선·포커스 링·선택된 칩). WCAG 1.4.11(비텍스트 3:1)은 **후자에만** 적용한다. `border.strong #64748B`는 **라이트/다크 공용**이다 — 흰 배경 4.76:1, 다크 `surface` 3.21:1로 양쪽 다 통과하는 유일한 값이었다 |
| DK-08 | **비활성·장식 토큰은 다크에서도 AA를 넘기지 않는다** | `text.disabled` 다크 3.48:1(라이트 2.85:1)로 둘 다 미달이며, 이는 의도다. 대비를 억지로 올리면 비활성이 활성처럼 보인다. **읽어야 하는 정보에 사용 금지**는 양 테마 동일 |
| DK-09 | **새 HEX 최소화 — 라이트 값의 역할 전환 우선** | `#E8EDF3`(라이트 명함 배지 배경) → 다크 `text.primary`(15.42:1). `#94A3B8`(라이트 `textFaint`, 2.56:1 미달 장식) → 다크 `text.muted`(5.95:1 통과). `#64748B`(라이트 캡션) → 양 테마 `border.strong`. 이유: 팔레트가 두 벌이 되면 §0 규칙 2(문서=코드 일치)의 검수 비용도 두 배가 되므로, 재사용 가능한 값은 끝까지 재사용한다 |
| DK-10 | **소셜 브랜드색은 테마 무관 고정** | `kakao #FEE500`/`#3C1E1E`, `naver #2DB400`, 구글 4색은 다크에서도 그대로. 플랫폼 브랜드 가이드 위반은 스토어 심사 리스크다. 다크에서는 버튼 컨테이너에 `border.subtle` 1px만 덧대 배경과 붙는 것을 막는다 |
| DK-11 | **scrim은 다크에서 더 진하게** | 라이트 `rgba(0,0,0,0.3)` / 다크 `rgba(0,0,0,0.6)`. 이유: 이미 어두운 배경에 0.3을 얹으면 시트와 뒷배경이 분리되지 않는다. 시트 표면은 `surface.alt`(베이스 대비 1.32)를 써서 위아래로 벌린다 |

### 10-3. 라이트 / 다크 의미론적 토큰 대응표 (정본)

기준 배경 — **라이트 `#FFFFFF`**, **다크 `#0F1621`**. 표면 토큰의 대비비는 *베이스로부터의 분리도*(1.00 = 구분 불가)이고, 그 외는 *기준 배경 위 대비*다. 판정: ✅ AA 본문(4.5:1) / ▲ 대형·비텍스트 전용(3:1) / ❌ 정보 전달 금지.

**표면 (bg / surface)**

| 토큰 | 라이트 HEX | 다크 HEX | 용도 | 대비비(베이스 분리도) |
|---|---|---|---|---|
| `bg.base` | `#FFFFFF` | `#0F1621` | 화면 최하단 배경. 탭바·헤더 배경 | 기준면 |
| `bg.elevated` | `#FFFFFF` | `#17202D` | 카드·리스트 행처럼 베이스보다 한 단 위 표면 | 1.00 / **1.11** |
| `bg.sunken` | `#F1F5F9` | `#0A0F17` | 카드가 놓이는 바닥, 이미지 뷰어 배경 | 1.10 / 1.06 |
| `surface` | `#F8FAFC` | `#1C2634` | 입력 배경, 패널, 리스트 헤더 | 1.05 / 1.19 |
| `surface.alt` | `#F1F5F9` | `#232E3E` | 세그먼트 트랙, 썸네일 플레이스홀더, 스켈레톤 베이스, 바텀시트 표면 | 1.10 / 1.32 |
| `surface.active` | `#F0F9FF` | `#14324A` | 선택된 행, 활성 칩 배경, 캘린더 선택일 | 1.07 / 1.37 |
| `surface.input` | `#FAFBFC` | `#151E2A` | 편집 모드 입력 배경 | 1.04 / 1.08 |
| `surface.overlay` | `#FFFFFF` | `#2B3849` | 풀스크린 모달 헤더, 드래그 중 카드 (최상단 고도) | 1.00 / 1.53 |

> 라이트에서 `bg.base`와 `bg.elevated`가 같은 값인 것은 결함이 아니다 — 라이트는 고도를 **그림자+보더**로, 다크는 **표면 밝기**로 표현한다(DK-02). 컴포넌트는 두 토큰을 항상 구분해서 참조해야 다크에서 자동으로 갈라진다.

**보더**

| 토큰 | 라이트 HEX | 다크 HEX | 용도 | 대비비 |
|---|---|---|---|---|
| `border.subtle` | `#CBD5E1` | `#2A3646` | 표준 1px 구분선·카드 프레임 (원본 69회 최다) | 1.48 / 1.48 (인접 `surface` 대비 1.42 / 1.25) — 장식용, 1.4.11 비적용 |
| `border.strong` | `#64748B` | `#64748B` | **입력 필드 외곽선·포커스 링·선택된 칩 경계** | 4.76 / 3.81 (인접 `surface` 대비 4.55 / **3.21** ▲) |

**텍스트**

| 토큰 | 라이트 HEX | 다크 HEX | 용도 | 대비비(베이스 위) |
|---|---|---|---|---|
| `text.primary` | `#111111` | `#E8EDF3` | 본문 최진함, 입력 값, 리스트 1차 정보 | 18.88 ✅ / 15.42 ✅ |
| `text.secondary` | `#505050` | `#A8B6C8` | 보조 텍스트·설명문 (원본 27회) | 8.06 ✅ / 8.81 ✅ |
| `text.muted` | `#64748B` | `#94A3B8` | **캡션 기본값**, 필드 라벨, 메타 | 4.76 ✅ / 7.08 ✅ (`surface` 위 4.55 / 5.95 ✅) |
| `text.disabled` | `#999999` | `#6B7A8D` | 플레이스홀더·비활성 라벨 **전용** | 2.85 ❌ / 4.14 ▲ (`surface` 위 3.48) — DK-08 |
| `text.inverse` | `#FFFFFF` | `#0F1621` | 채움 버튼/배지 위 라벨 (DK-05) | `brand` 위 14.83 ✅ / 10.10 ✅ |

**브랜드 · 액션**

| 토큰 | 라이트 HEX | 다크 HEX | 용도 | 대비비(베이스 위) |
|---|---|---|---|---|
| `brand` | `#15293D` | `#AEC4D8` | 로고·화면 타이틀·아바타·챗봇 헤더 전경 (원본 54회) | 14.83 ✅ / **10.10** ✅ |
| `brand.pressed` | `#122436` | `#C6D8E7` | 브랜드 채움 요소 눌림 (DK-06) | 15.77 ✅ / 12.43 ✅ |
| `brand.container` | `#E8EDF3` | `#1B2A3C` | 브랜드 톤 배경 — 아바타 배경, 챗봇 헤더, 명함 배지 배경 | 1.18 / 1.25 (그 위 `text.primary` 12.59 / 12.36 ✅) |
| `action` | `#0077B6` | `#4BA3DB` | 주요 CTA·활성 탭·저장/수정 버튼·OCR bbox (원본 42회) | 4.87 ✅ / **6.53** ✅ |
| `action.pressed` | `#0069A0` | `#6FB8E4` | 위의 눌림 상태 | 5.95 ✅ / 8.34 ✅ |

**`#15293D`를 다크에서 그대로 쓸 수 없는 이유** — 브랜드 네이비의 휘도는 `#0F1621` 베이스와 사실상 같은 대역이다. `#15293D` on `#0F1621` = **1.22:1**로, 텍스트는 물론 3:1 비텍스트 기준도 못 넘어 배경과 완전히 붙어 사라진다. 그래서 **다크 전용 브랜드 변형 `#AEC4D8`**을 정의한다: hue 210→209로 유지(브랜드 인지 보존), 채도 49%→35%(DK-03), 명도 16%→76%. 짙은 네이비 면(챗봇 헤더처럼 "브랜드 색 판"이 필요한 곳)은 색을 뒤집지 않고 `brand.container #1B2A3C`로 대체한다 — 어두운 네이비 판이라는 원본의 의도를 유지하면서 그 위 텍스트를 12.36:1로 확보한다.

**상태색**

| 토큰 | 라이트 HEX | 다크 HEX | 용도 | 대비비(베이스 위 / 자기 container 위) |
|---|---|---|---|---|
| `success` | `#16A34A` | `#7BD69A` | 성공·수입 | 3.30 ▲ / 10.31 ✅ |
| `success.container` | `#DCFCE7` | `#12291B` | 성공 배지·박스 배경 | 그 위 fg 3.00 ❌ / **8.78** ✅ |
| `warn` | `#92400E` | `#EFB964` | 경고·안내 박스 텍스트, 오프라인 배너 | 7.09 ✅ / 10.19 ✅ |
| `warn.container` | `#FFFBEB` | `#2E2308` | 경고 박스 배경 | 그 위 fg 6.84 ✅ / 8.67 ✅ |
| `warn.border` | `#FDE68A` | `#4A3A12` | 경고 박스 보더 | 장식 |
| `danger` | `#DC2626` | `#F0908C` | 에러·삭제·지출·일요일 | 4.83 ✅ / 7.84 ✅ |
| `danger.strong` | `#B91C1C` | `#F5A5A1` | **에러 박스 본문 텍스트** | 6.47 ✅ / 9.32 ✅ |
| `danger.container` | `#FEE2E2` | `#2E1516` | 에러 박스 배경 | 그 위 `danger` 3.95 ❌ → `danger.strong` **5.30** ✅ / `danger` 7.35 ✅ · `danger.strong` 8.73 ✅ |
| `danger.border` | `#FECACA` | `#5A2422` | 에러 박스 보더 | 장식 |
| `danger.pressed` | `#C22121` | `#F5A5A1` | 삭제 버튼 눌림 (DK-06) | 5.94 ✅ / 9.32 ✅ |
| `info` | `#2563EB` | `#7FB0EF` | 정보 배지 전경, 토요일 | 5.17 ✅ / 8.09 ✅ |
| `info.container` | `#EFF6FF` | `#14243D` | 정보 배지·챗봇 말풍선 배경 | 그 위 fg 4.75 ✅ / 6.94 ✅ |
| `info.border` | `#DBEAFE` | `#26436E` | 정보 배지·말풍선 보더 | 장식 |

**결정: `success`는 양 테마에서 "텍스트 금지, 아이콘·수치 강조 전용"이다.** 라이트 `#16A34A`는 흰 배경 3.30:1, `success.container` 위 3.00:1로 본문 기준 미달이다(원본에서 이미 그랬고 이번에 처음 계산했다). 성공 문구를 **텍스트로** 써야 하는 곳(가계부 수입 금액, 저장 완료 안내 본문)은 `#166534`(7.13:1 — 이미 `doc.RECEIPT.fg`로 존재하는 값)를 쓴다. 다크는 `#7BD69A`가 10.31:1이라 제약이 없다.

**오버레이 / 스크림**

| 토큰 | 라이트 | 다크 | 용도 | 근거 |
|---|---|---|---|---|
| `scrim` | `rgba(0,0,0,0.30)` | `rgba(0,0,0,0.60)` | 바텀시트·모달 backdrop (원본 `StorageDrawer.tsx:134`) | DK-11. MOT-05의 최대 opacity 값을 테마별로 분기 |
| `overlay.image` | `rgba(15,23,42,0.55)` | `rgba(0,0,0,0.72)` | 이미지 위 컨트롤 바(카메라·뷰어 상하단), 썸네일 위 배지 | 이미지가 밝든 어둡든 흰 아이콘이 4.5:1을 넘도록 최소 두께를 보장 |
| `overlay.tint` | 사용 안 함 | `rgba(174,196,216,0.08)` | 다크에서 표면 위 브랜드 틴트가 필요한 경우(선택 상태 강조) | `surface.active`로 해결되지 않는 겹침 상황 한정. 남용 금지 |

### 10-4. 문서 4종 + 마감 — 다크 대응값

라이트 값은 §9에서 **배지 텍스트 대비 4.5:1**을 기준으로 보정한 것이다. 다크도 **같은 기준**을 적용한다: fg는 자기 배지 배경 위에서 4.5:1 이상, 배지 배경은 `bg.base`로부터 1.15 이상 분리.

| 유형 | 라이트 fg / bg | 대비 | 다크 fg / bg | 대비 | 결정 근거 |
|---|---|---|---|---|---|
| 명함 `BUSINESS_CARD` | `#15293D` / `#E8EDF3` | 12.6:1 | **`#AEC4D8` / `#1B2A3C`** | **8.10:1** | `brand` / `brand.container`를 그대로 재사용. 라이트에서 명함 fg=브랜드 네이비였던 관계를 다크에서도 유지 |
| 티켓 `TICKET` | `#6746AF` / `#E9E5FA` | 5.6:1 | **`#C2B3E6` / `#2A2340`** | **7.70:1** | 원본 바이올렛 H259 유지, 채도 43→50·명도 48→80. 배경은 같은 hue의 저명도 판 |
| 포스터 `POSTER` | `#0069A0` / `#E8EDF3` | 5.1:1 | **`#73B5DE` / `#12283A`** | **6.76:1** | 라이트 포스터 fg는 `action`을 **어둡게** 한 값(`#0069A0`)이었다. 다크에서는 대칭으로 `action`을 **밝게** 한 값을 쓴다(H203 유지) |
| 영수증 `RECEIPT` | `#166534` / `#CFE5D0` | 5.4:1 | **`#7BD69A` / `#16301F`** | **8.08:1** | 라이트가 green-800을 쓴 것과 대칭으로 다크는 `success`(=`#7BD69A`)를 공유. 배지와 상태색이 같은 값인 관계도 라이트와 동일 |
| 마감 `DEADLINE` | `#B45309` / `#FEF3E2` | 4.6:1 | **`#E8B172` / `#33240F`** | **7.83:1** | 앰버 H32 유지. 라이트에서 가장 아슬아슬했던(4.6:1) 조합이라 다크는 여유를 크게 잡았다 |

- 배지 배경의 베이스 분리도: 명함 1.25 / 티켓 1.22 / 포스터 1.20 / 영수증 1.28 / 마감 1.21 — 전부 1.15 이상.
- **비텍스트 용도의 원본 fg**(`#4FB048`, `#DC8540`, `#0077B6`/`#0069A0` — 아이콘·프로그레스·좌측 컬러바)는 다크에서 위 표의 다크 fg로 **함께 교체**한다. 라이트처럼 "원본값을 비텍스트에 남기는" 예외를 두지 않는다. 이유: 원본값은 다크에서 통과 여부가 값마다 갈린다 — 베이스 위 `#4FB048` 6.60 ✅ / `#DC8540` 6.46 ✅ / `#0069A0` **3.05**(카드 표면 `#1C2634` 위에서는 **2.56 ❌**). 예외 목록을 관리하는 비용이 단일 규칙보다 크다.
- D-day 색 규칙은 그대로: `dDay <= 3 ? deadline : action`. 테마별 값만 갈린다.
- 캘린더 `sunday`/`saturday`는 `danger`/`info`를 따라간다 → 다크 `#F0908C` / `#7FB0EF`.

### 10-5. 이미지 · 스켈레톤 · 로고 에셋의 다크 규칙

| 대상 | 규칙 | 이유 |
|---|---|---|
| 문서 썸네일 (리스트/그리드) | 이미지 자체에 **필터를 걸지 않는다.** 대신 셀 컨테이너를 `surface.alt` + `border.subtle` 1px + `radius.card`로 감싸고 이미지 사방 4dp 매트를 준다 | 스캔 이미지의 흰 종이가 다크 배경에 직접 닿으면 경계가 칼처럼 눈부시다. 매트가 중간 휘도 완충층이 된다. 밝기를 낮추는 필터는 **문서 판독성을 훼손**하므로 금지 |
| 문서 상세 이미지 / 이미지 뷰어 | 배경은 `bg.sunken`(다크 `#0A0F17`), 이미지 컨테이너는 `surface.alt` 프레임. 컨트롤 바는 `overlay.image` | 뷰어는 이미지를 판단하는 화면이므로 이미지를 건드리지 않고 주변만 어둡게 한다 |
| 스캔 리뷰 화면(SCR-12) 이미지 영역 | 다크에서도 **이미지 영역만 라이트 표면**(`#F8FAFC`)을 유지한다 — 화면 절반이 흰 문서 이미지이므로 그 컨테이너를 다크로 만들면 대비 충격이 최대가 된다. bbox 오버레이 색은 `action`의 다크 값 | 구 §10 이유 3(다크 + 흰 이미지 눈부심)에 대한 실제 해답. 테마 전환으로 사라지지 않는 문제라 국소 예외로 처리한다 |
| 이미지 폴백 (UX-23 / CP-16) | `surface.alt` 배경 + `text.muted` 아이콘 + `이미지가 없습니다` | 양 테마 동일 구조, 토큰만 교체 |
| 스켈레톤 | 베이스 `surface.alt`(라이트 `#F1F5F9` / 다크 `#232E3E`), shimmer 하이라이트 라이트 `#FFFFFF` / 다크 `#2E3B4D`(1.21:1) | 다크에서 하이라이트를 흰색으로 두면 번쩍여서 로딩이 더 느리게 느껴진다. 대비 1.2 근방이 "움직이는 것은 보이지만 시선을 빼앗지 않는" 구간 |
| 앱 로고 `mora-logo-lg.svg` | `fill`을 prop으로 받으므로 `brand` 토큰 주입 → 다크에서 `#AEC4D8`. 원본의 `filter: brightness(0) invert(1)` 반전 트릭은 계속 사용 금지 | §12 에셋 결정과 동일. 테마 대응이 색 prop 하나로 끝나는 이유 |
| 챗봇 로고 (PNG 3장) | **반전·틴트 금지.** 다크에서는 `brand.container` 원형 배경 위에 올린다 | 내부가 컬러 래스터라 반전하면 색이 망가진다 |
| 로그인 일러스트 `illust.png` | **다크에서는 렌더하지 않는다**(라이트 전용 흰 배경 합성 이미지). 다크는 로고 + 타이틀만 노출 | 흰 사각형이 인증 화면 절반을 차지한다. 다크 버전 에셋을 새로 그리는 비용은 v1 범위 밖이며, UX-24가 이미 "키보드 등장 시 숨김"을 규정하므로 숨김 경로가 이미 구현돼 있다 |
| 앱 아이콘 / 적응형 아이콘 | 테마 무관 고정 | OS가 관리하는 영역 |
| `expo-image` | `accessibilityIgnoresInvertColors` 유지 | OS의 "색상 반전" 접근성 기능이 문서 이미지를 뒤집는 것을 막는다 (테마와 무관한 별개 기능) |

### 10-6. Elevation 대응표 — 라이트=그림자 / 다크=표면 밝기

| 토큰 | 라이트 (iOS `shadow*` / Android `elevation`) | 다크 배경색 | 다크 그림자 | 적용 대상 |
|---|---|---|---|---|
| `flat` | 없음 + `border.subtle` 1px | `bg.base` `#0F1621` | 없음 | 기본 카드(보더만) |
| `raised` | `offset{0,2} opacity .06 radius 8` / `2` | `bg.elevated` `#17202D` (1.11) | 없음 + `border.subtle` 1px | 마감 임박 카드, 리스트 카드 |
| `dropdown` | `offset{0,4} opacity .10 radius 12` / `4` | `surface` `#1C2634` (1.19) | Android `elevation: 4` 유지, iOS opacity 0 | 액션시트, 토스트, 스낵바 |
| `sheet` | `offset{0,8} opacity .12 radius 16` / `8` | `surface.alt` `#232E3E` (1.32) | Android `elevation: 8` 유지, iOS opacity 0 | 바텀시트, FAB, 탭바 상단 |
| `overlay` | `offset{0,22} opacity .25 radius 40` / `16` | `surface.overlay` `#2B3849` (1.53) | Android `elevation: 16` 유지, iOS opacity 0 | 풀스크린 모달 헤더, 드래그 중 카드 |

**규칙**
1. 컴포넌트는 `elevation.raised`와 **배경 토큰을 항상 함께** 지정한다(`bg-elevated` + `elevation.raised`). 배경 없이 그림자만 주면 다크에서 고도가 사라진다 — Android는 이미 §8 규칙 3(투명 배경에 elevation 안 그려짐)으로 같은 제약이 있다.
2. 다크에서 iOS 그림자를 완전히 지우지 않고 `shadowOpacity: 0`으로 남긴다. 값이 0이면 렌더 비용이 없고, 조건 분기가 스타일 객체 형태를 바꾸지 않아 리렌더 시 diff가 안정적이다.
3. 다크에서 **표면 밝기와 그림자를 동시에 쓰지 않는다.** 둘을 겹치면 카드 테두리가 검게 번져 더 지저분해진다. Android `elevation`을 남기는 것은 리플·터치 피드백의 z-순서 때문이며 시각 그림자를 기대해서가 아니다.

### 10-7. 작업량 영향 (정직한 기록)

| 영향 | 규모 | 상세 |
|---|---|---|
| Phase 1 토큰·컴포넌트 | **≈1.5배** | 토큰 2벌 정의 + CSS 변수 배선(§13-1/13-2) + `useTheme()` 배선, **Phase 1 산출 CMP 21종 + Phase 0 소급 2종 = 23종** 각각을 두 테마에서 갤러리 화면으로 눈으로 확인. 색이 하드코딩된 컴포넌트를 하나라도 놓치면 다크에서 즉시 드러난다. 나머지 29종은 산출 페이즈(2~6)에서 같은 방식으로 검수하고, 누적 **52종** 완료 확인은 Phase 7 게이트다([[Requirements]] FR-128 · FR-112) |
| Phase 7 QA 매트릭스 | **2배** | 화면 31개 × 2테마. 기기 매트릭스와 곱하지는 않는다(테마는 OS 버전과 독립) — 상세 케이스는 [[QA Checklist]] |
| 디자인 리스크 | **중** | 다크 팔레트는 원본 참조 없이 신규 설계다. 대비비는 계산으로 보증되지만 **"브랜드처럼 보이는가"는 실기기 확인 전까지 미검증**이다. Phase 1 갤러리 화면에서 OLED 실기기로 1회 검수하고, 어긋나면 이 문서를 고쳐 한 곳에서 반영한다 |
| 완화 | — | 새 HEX를 DK-09로 최소화했고, 문서 4종·상태색·브랜드가 서로 값을 공유하므로 조정 시 손댈 지점이 적다 |

---

## 11. 터치 타겟 / 히트슬롭 / 대비

### 11-1. 터치 타겟 규격

**결정: 최소 44dp, 기본 48dp.** iOS HIG 44pt와 Material 48dp 중 큰 쪽을 기본값으로 삼되, 밀도 높은 리스트에서는 44dp까지 허용한다.

| 요소 | 원본 웹 크기 | 모바일 시각 크기 | hitSlop | 실효 타겟 |
|---|---|---|---|---|
| 리스트 행 삭제 `✕` | 28×28 | 28×28 | `lg` (10) | 48×48 |
| 상세 시트 닫기 `×` | 32×32 원형 | 32×32 | `md` (8) | 48×48 |
| 챗봇 헤더 액션(도움말/초기화/닫기) | 30×30 | 32×32 | `md` (8) | 48×48 |
| 문서 타입 칩 | h34 | h36, minWidth 64 | `xs` 상하 6 | 48 높이 |
| 하단 탭 아이템 | — | h56 (아이콘 24 + 라벨 10) | — | 56 |
| FAB (챗봇) | 64×64 | 56×56 | — | 56 |
| 카메라 셔터 | — | 72×72 | — | 72 |
| 캘린더 날짜 셀 | 가변 | 44×44 최소 | — | 44 |
| 토글 스위치 | 40×22 | 51×31 (`Switch` 기본) | — | 48 높이 |
| 텍스트 링크(`회원가입` 등) | inline | inline | `md` (8) | 최소 44 높이 |

**규칙**
1. 인접한 두 터치 타겟 사이 **간격 최소 8dp.** 삭제 버튼이 다른 액션에 붙지 않게 한다.
2. `hitSlop`은 시각 크기를 키우지 않고 판정 영역만 넓힌다. 원본 `StorageCard`의 32×32 삭제 버튼처럼 작은 요소는 hitSlop 필수.
3. **파괴적 액션(삭제)은 리스트 행에 노출하지 않는다.** 스와이프 또는 롱프레스 메뉴로 옮긴다 ([[Mobile UX Guide]] UX-07/UX-12). 오조작 방지.
4. 스크롤 영역 가장자리 12dp 이내에는 터치 타겟을 배치하지 않는다(제스처 내비게이션 충돌).

### 11-2. 색 대비 판정 (라이트 = 흰 배경 기준, WCAG 2.1)

> 다크 배경(`#0F1621`) 기준 대비 판정은 **§10-3 대응표의 대비비 열**이 정본이다. 두 표를 합치지 않는 이유: 기준면이 다르면 같은 토큰의 판정이 뒤집히기 때문이다(`#94A3B8`은 라이트 2.56 ❌ / 다크 7.08 ✅).

| 토큰 | HEX | 대비 | 판정 | 사용 규칙 |
|---|---|---|---|---|
| `text` | `#111111` | 18.9:1 | ✅ | 제한 없음 |
| `brand` | `#15293D` | 14.8:1 | ✅ | 제한 없음 |
| `textStrong` | `#333333` | 12.6:1 | ✅ | 제한 없음 |
| `textBody` | `#334155` | 10.4:1 | ✅ | 제한 없음 |
| `textSubtitle` | `#505050` | 8.1:1 | ✅ | 제한 없음 |
| `point` | `#0077B6` | 4.9:1 | ✅ | 흰 배경 위 텍스트/아이콘 가능 |
| `textMuted` | `#64748B` | 4.8:1 | ✅ | **캡션 기본값은 이것** |
| `textDisabled` | `#999999` | 2.9:1 | ❌ | **비활성 상태·플레이스홀더 전용.** 읽어야 하는 정보에 금지 |
| `textFaint` | `#94A3B8` | 2.6:1 | ❌ | 장식(구분자, 비활성 아이콘) 전용 |

**결정: 원본에서 `#999`(54회)로 되어 있던 "필드 라벨·캡션"은 전부 `textMuted #64748B`로 교체한다.** `#999`는 플레이스홀더와 비활성 상태에만 남긴다. 이유: 원본 상세 드로어의 필드 라벨(11px `#999`)은 2.9:1로 야외 시인성이 사실상 0이고, 모바일은 야외 사용 빈도가 웹보다 압도적으로 높다.

---

## 12. 아이콘 토큰

- 라이브러리: **`lucide-react-native`** + `react-native-svg`. 원본이 쓰던 18개 아이콘 이름이 그대로 존재한다.
- **`Astroid`는 lucide에 없는 이름이다**(원본 `app/page.tsx:12`의 오타). **결정: `Sparkles`로 대체.** "AI 정보 구조화" 의미에 가장 근접.
- 소셜 로그인 아이콘은 `lib/svgPaths.ts`의 path 문자열을 `react-native-svg`의 `<Path d={...}>`로 **그대로 재사용**한다(03-design.md §5-D). 구글 4색, 카카오 `#3C1E1E`, 네이버 `#2DB400`.

| 크기 토큰 | px | 용도 | strokeWidth |
|---|---|---|---|
| `xs` | 14 | 인라인 칩/배지 안 | 1.8 |
| `sm` | 16 | 리스트 행 보조 | 1.8 |
| `md` | 20 | 입력 필드, 헤더 액션 | 2.0 |
| `lg` | 24 | 탭바, 기본 아이콘 | 2.0 |
| `xl` | 28 | FAB, 빈 상태 | 2.0 |
| `hero` | 48 | 빈 상태 일러스트 대체 | 1.5 |

**에셋 결정**
- `mora-logo-lg.svg`(36×36, fill `#15293D`) → `react-native-svg`로 인라인화하고 `fill`을 prop으로 받는다. 원본의 `filter: brightness(0) invert(1)` 흰색 반전 트릭은 RN에 없으므로 색 prop으로 해결.
- `chatbot_logo.svg`(540KB, 내부가 base64 PNG를 감싼 가짜 벡터) → **결정: PNG로 재추출해 `@1x/@2x/@3x` 3장으로 교체.** SVG 파서에 540KB 문자열을 태우면 FAB 첫 렌더가 눈에 띄게 지연된다.
- `illust.png`(1.2MB, 로그인 일러스트) → **결정: WebP 변환 + 최대 폭 720px로 리사이즈.** APK 용량 예산([[QA Checklist]])에 직접 영향.
- 이모지 아이콘(`📅` `⏰` `📄` `🎫`)은 **결정: 전부 lucide 아이콘으로 교체.** 이모지는 OS/버전마다 모양이 달라 브랜드 일관성이 깨지고 TalkBack이 이름을 그대로 읽는다. 매핑: `📅`→`CalendarDays`, `⏰`→`AlarmClock`, `📄`→`Files`, `🎫`→`Ticket`, `✓`→`Check`, `▾`→`ChevronDown`, `›`→`ChevronRight`, `×`→`X`.

---

## 13. 테마 전환 구현 규격 (다크모드 배선)

§10이 "무슨 색인가", 이 절은 "어떻게 갈아끼우는가"다. 아래 코드는 그대로 복사해 쓰는 완성형이다.

### 13-0. 파일 배치와 경로 정본

| 파일 | 역할 | HEX 등장 |
|---|---|---|
| `src/theme/tokens.ts` | light/dark 두 객체 + `ThemeTokens` 타입 + elevation 생성기 | **O (유일한 정본)** |
| `global.css` | CSS 변수 2벌(`:root` / `.dark:root`) — NativeWind가 읽는 값 | O (생성물) |
| `tailwind.config.js` | 변수 참조만. HEX 0개 | X |
| `src/theme/ThemeProvider.tsx` | OS 테마 리스너 + `useTheme()` 제공 | X |
| `src/store/themeStore.ts` | `theme.mode` 3택 소유 + MMKV 영속 + NativeWind 동기화 | X |
| `scripts/gen-theme-css.ts` | `tokens.ts` → `global.css` 생성. `npm run theme:css`, CI에서 diff 검사 | X |

- **경로 정본은 `src/theme/tokens.ts`다.** §4의 `constants/theme.ts` 표기는 같은 파일의 구 표기이며, [[Phases]] Phase 1 산출물 목록과 이 절에 맞춰 Phase 1 착수 시 `src/theme/`로 통일한다.
- **`global.css`는 손으로 고치지 않는다.** HEX가 두 곳에 존재하면 반드시 어긋난다(§0 규칙 2). 생성 스크립트 diff가 나면 CI 실패로 취급한다.

### 13-1. `tailwind.config.js` — 다크 지원 완성형

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],

  // 'media'(기본)면 OS 테마만 따르고 3택 오버라이드가 불가능하다.
  // 'class' 로 두면 NativeWind 가 colorScheme.set() 값에 따라 루트에 dark 클래스를 붙인다.
  darkMode: 'class',

  theme: {
    extend: {
      // 색은 전부 CSS 변수 참조다. HEX 리터럴을 이 파일에 되돌려 놓는 PR 은 반려.
      // 변수는 "R G B" 채널 3개(콤마 없음)를 담고, <alpha-value> 로 bg-action/40 같은 투명도 유틸이 살아난다.
      colors: {
        bg: {
          base:     'rgb(var(--bg-base) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elev) / <alpha-value>)',
          sunken:   'rgb(var(--bg-sunken) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          alt:     'rgb(var(--surface-alt) / <alpha-value>)',
          active:  'rgb(var(--surface-active) / <alpha-value>)',
          input:   'rgb(var(--surface-input) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
        },
        border: {
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--text-muted) / <alpha-value>)',
          disabled:  'rgb(var(--text-disabled) / <alpha-value>)',
          inverse:   'rgb(var(--text-inverse) / <alpha-value>)',
        },
        brand: {
          DEFAULT:   'rgb(var(--brand) / <alpha-value>)',
          pressed:   'rgb(var(--brand-pressed) / <alpha-value>)',
          container: 'rgb(var(--brand-container) / <alpha-value>)',
        },
        action:  { DEFAULT: 'rgb(var(--action) / <alpha-value>)', pressed: 'rgb(var(--action-pressed) / <alpha-value>)' },
        success: { DEFAULT: 'rgb(var(--success) / <alpha-value>)', text: 'rgb(var(--success-text) / <alpha-value>)', container: 'rgb(var(--success-container) / <alpha-value>)' },
        warn:    { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', container: 'rgb(var(--warn-container) / <alpha-value>)', border: 'rgb(var(--warn-border) / <alpha-value>)' },
        danger:  { DEFAULT: 'rgb(var(--danger) / <alpha-value>)', strong: 'rgb(var(--danger-strong) / <alpha-value>)', pressed: 'rgb(var(--danger-pressed) / <alpha-value>)', container: 'rgb(var(--danger-container) / <alpha-value>)', border: 'rgb(var(--danger-border) / <alpha-value>)' },
        info:    { DEFAULT: 'rgb(var(--info) / <alpha-value>)', container: 'rgb(var(--info-container) / <alpha-value>)', border: 'rgb(var(--info-border) / <alpha-value>)' },

        // 문서 4종 + 마감 (§10-4)
        card:     { DEFAULT: 'rgb(var(--doc-card) / <alpha-value>)',     bg: 'rgb(var(--doc-card-bg) / <alpha-value>)' },
        ticket:   { DEFAULT: 'rgb(var(--doc-ticket) / <alpha-value>)',   bg: 'rgb(var(--doc-ticket-bg) / <alpha-value>)' },
        poster:   { DEFAULT: 'rgb(var(--doc-poster) / <alpha-value>)',   bg: 'rgb(var(--doc-poster-bg) / <alpha-value>)' },
        receipt:  { DEFAULT: 'rgb(var(--doc-receipt) / <alpha-value>)',  bg: 'rgb(var(--doc-receipt-bg) / <alpha-value>)' },
        deadline: { DEFAULT: 'rgb(var(--doc-deadline) / <alpha-value>)', bg: 'rgb(var(--doc-deadline-bg) / <alpha-value>)' },

        skeleton: { DEFAULT: 'rgb(var(--skeleton) / <alpha-value>)', hi: 'rgb(var(--skeleton-hi) / <alpha-value>)' },

        // 소셜은 테마 무관 고정 (DK-10) — 변수를 쓰지 않는다
        kakao: { DEFAULT: '#FEE500', fg: '#3C1E1E' },
        naver: { DEFAULT: '#2DB400', btn: '#54CF48' },
      },

      // 색이 아닌 스케일은 테마와 무관하다. 값은 §3 그대로.
      spacing:      require('./src/theme/scale').tailwindSpacing,
      borderRadius: require('./src/theme/scale').tailwindRadius,
      fontSize:     require('./src/theme/scale').tailwindFontSize,
      fontFamily:   require('./src/theme/scale').tailwindFontFamily,
    },
  },
  plugins: [],
};
```

> `scrim` / `overlay.image`는 **알파가 테마마다 다르므로**(0.30 → 0.60) 채널 변수 방식으로 표현할 수 없다. 이 둘은 클래스로 쓰지 않고 `useTheme().scrim`으로만 소비한다(바텀시트 backdrop, 카메라 컨트롤 바). 유일한 예외이며 §0 규칙 3을 위반하지 않는다 — 값은 여전히 `tokens.ts` 한 곳에서 나온다.

### 13-2. `global.css` — CSS 변수 2벌 (생성물)

```css
/* global.css — scripts/gen-theme-css.ts 생성물. 직접 수정 금지. */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --bg-base: 255 255 255;        --bg-elev: 255 255 255;       --bg-sunken: 241 245 249;
    --surface: 248 250 252;        --surface-alt: 241 245 249;   --surface-active: 240 249 255;
    --surface-input: 250 251 252;  --surface-overlay: 255 255 255;
    --border-subtle: 203 213 225;  --border-strong: 100 116 139;
    --text-primary: 17 17 17;      --text-secondary: 80 80 80;   --text-muted: 100 116 139;
    --text-disabled: 153 153 153;  --text-inverse: 255 255 255;
    --brand: 21 41 61;             --brand-pressed: 18 36 54;    --brand-container: 232 237 243;
    --action: 0 119 182;           --action-pressed: 0 105 160;
    --success: 22 163 74;          --success-text: 22 101 52;    --success-container: 220 252 231;
    --warn: 146 64 14;             --warn-container: 255 251 235; --warn-border: 253 230 138;
    --danger: 220 38 38;           --danger-strong: 185 28 28;   --danger-pressed: 194 33 33;
    --danger-container: 254 226 226; --danger-border: 254 202 202;
    --info: 37 99 235;             --info-container: 239 246 255; --info-border: 219 234 254;
    --doc-card: 21 41 61;          --doc-card-bg: 232 237 243;
    --doc-ticket: 103 70 175;      --doc-ticket-bg: 233 229 250;
    --doc-poster: 0 105 160;       --doc-poster-bg: 232 237 243;
    --doc-receipt: 22 101 52;      --doc-receipt-bg: 207 229 208;
    --doc-deadline: 180 83 9;      --doc-deadline-bg: 254 243 226;
    --skeleton: 241 245 249;       --skeleton-hi: 255 255 255;
  }

  .dark:root {
    --bg-base: 15 22 33;           --bg-elev: 23 32 45;          --bg-sunken: 10 15 23;
    --surface: 28 38 52;           --surface-alt: 35 46 62;      --surface-active: 20 50 74;
    --surface-input: 21 30 42;     --surface-overlay: 43 56 73;
    --border-subtle: 42 54 70;     --border-strong: 100 116 139;   /* DK-07 — 양 테마 공용 */
    --text-primary: 232 237 243;   --text-secondary: 168 182 200; --text-muted: 148 163 184;
    --text-disabled: 107 122 141;  --text-inverse: 15 22 33;
    --brand: 174 196 216;          --brand-pressed: 198 216 231; --brand-container: 27 42 60;
    --action: 75 163 219;          --action-pressed: 111 184 228;
    --success: 123 214 154;        --success-text: 123 214 154;  --success-container: 18 41 27;
    --warn: 239 185 100;           --warn-container: 46 35 8;    --warn-border: 74 58 18;
    --danger: 240 144 140;         --danger-strong: 245 165 161; --danger-pressed: 245 165 161;
    --danger-container: 46 21 22;  --danger-border: 90 36 34;
    --info: 127 176 239;           --info-container: 20 36 61;   --info-border: 38 67 110;
    --doc-card: 174 196 216;       --doc-card-bg: 27 42 60;
    --doc-ticket: 194 179 230;     --doc-ticket-bg: 42 35 64;
    --doc-poster: 115 181 222;     --doc-poster-bg: 18 40 58;
    --doc-receipt: 123 214 154;    --doc-receipt-bg: 22 48 31;
    --doc-deadline: 232 177 114;   --doc-deadline-bg: 51 36 15;
    --skeleton: 35 46 62;          --skeleton-hi: 46 59 77;
  }
}
```

### 13-3. `src/theme/tokens.ts` — light/dark 두 객체 + `ThemeTokens`

```ts
// src/theme/tokens.ts
import { Platform, type ViewStyle } from 'react-native';

export type ResolvedScheme = 'light' | 'dark';

/* ── elevation: 라이트=그림자 / 다크=표면 밝기 (§10-6) ───────────────── */
const mkElevation = (scheme: ResolvedScheme, surfaces: { [k in 'raised'|'dropdown'|'sheet'|'overlay']: string }) => {
  const shadow = (offsetY: number, blur: number, opacity: number, androidElevation: number, bg: string): ViewStyle =>
    Platform.select<ViewStyle>({
      ios: scheme === 'light'
        ? { backgroundColor: bg, shadowColor: '#0F172A', shadowOffset: { width: 0, height: offsetY }, shadowOpacity: opacity, shadowRadius: blur }
        // 다크: 검정 위 검정이라 그림자가 보이지 않는다. 형태를 유지하려고 opacity 만 0 으로 둔다 (§10-6 규칙 2)
        : { backgroundColor: bg, shadowColor: '#000000', shadowOffset: { width: 0, height: offsetY }, shadowOpacity: 0, shadowRadius: blur },
      android: { backgroundColor: bg, elevation: androidElevation, shadowColor: '#0F172A' },
      default: { backgroundColor: bg },
    })!;
  return {
    flat: {} as ViewStyle,
    raised:   shadow(2, 8, 0.06, 2, surfaces.raised),
    dropdown: shadow(4, 12, 0.10, 4, surfaces.dropdown),
    sheet:    shadow(8, 16, 0.12, 8, surfaces.sheet),
    overlay:  shadow(22, 40, 0.25, 16, surfaces.overlay),
  } as const;
};

/* ── 라이트 ──────────────────────────────────────────────────────────
   주의: `as const` 를 붙이지 않는다. 붙이면 값이 리터럴 타입('#FFFFFF')으로 좁혀져
   아래 dark 객체가 같은 타입으로 검사되지 못한다. 지금 형태여야 키 누락·오타를 컴파일러가 잡는다. */
const light = {
  scheme: 'light' as ResolvedScheme,
  bg:      { base: '#FFFFFF', elevated: '#FFFFFF', sunken: '#F1F5F9' },
  surface: { base: '#F8FAFC', alt: '#F1F5F9', active: '#F0F9FF', input: '#FAFBFC', overlay: '#FFFFFF' },
  border:  { subtle: '#CBD5E1', strong: '#64748B' },
  text:    { primary: '#111111', secondary: '#505050', muted: '#64748B', disabled: '#999999', inverse: '#FFFFFF' },
  brand:   { base: '#15293D', pressed: '#122436', container: '#E8EDF3' },
  action:  { base: '#0077B6', pressed: '#0069A0' },
  success: { base: '#16A34A', text: '#166534', container: '#DCFCE7' },
  warn:    { base: '#92400E', container: '#FFFBEB', border: '#FDE68A' },
  danger:  { base: '#DC2626', strong: '#B91C1C', pressed: '#C22121', container: '#FEE2E2', border: '#FECACA' },
  info:    { base: '#2563EB', container: '#EFF6FF', border: '#DBEAFE' },
  scrim: 'rgba(0,0,0,0.30)',
  overlayImage: 'rgba(15,23,42,0.55)',
  doc: {
    BUSINESS_CARD: { fg: '#15293D', bg: '#E8EDF3' },
    TICKET:        { fg: '#6746AF', bg: '#E9E5FA' },
    POSTER:        { fg: '#0069A0', bg: '#E8EDF3' },
    RECEIPT:       { fg: '#166534', bg: '#CFE5D0' },
    DEADLINE:      { fg: '#B45309', bg: '#FEF3E2' },
  },
  calendar: { sunday: '#DC2626', saturday: '#2563EB', selected: '#E8EDF3' },
  skeleton: { base: '#F1F5F9', highlight: '#FFFFFF' },
  elevation: mkElevation('light', { raised: '#FFFFFF', dropdown: '#FFFFFF', sheet: '#FFFFFF', overlay: '#FFFFFF' }),
};

export type ThemeTokens = typeof light;

/* ── 다크 (§10-3 / §10-4 정본값) ─────────────────────────────────── */
const dark: ThemeTokens = {
  scheme: 'dark',
  bg:      { base: '#0F1621', elevated: '#17202D', sunken: '#0A0F17' },
  surface: { base: '#1C2634', alt: '#232E3E', active: '#14324A', input: '#151E2A', overlay: '#2B3849' },
  border:  { subtle: '#2A3646', strong: '#64748B' },
  text:    { primary: '#E8EDF3', secondary: '#A8B6C8', muted: '#94A3B8', disabled: '#6B7A8D', inverse: '#0F1621' },
  brand:   { base: '#AEC4D8', pressed: '#C6D8E7', container: '#1B2A3C' },
  action:  { base: '#4BA3DB', pressed: '#6FB8E4' },
  success: { base: '#7BD69A', text: '#7BD69A', container: '#12291B' },
  warn:    { base: '#EFB964', container: '#2E2308', border: '#4A3A12' },
  danger:  { base: '#F0908C', strong: '#F5A5A1', pressed: '#F5A5A1', container: '#2E1516', border: '#5A2422' },
  info:    { base: '#7FB0EF', container: '#14243D', border: '#26436E' },
  scrim: 'rgba(0,0,0,0.60)',
  overlayImage: 'rgba(0,0,0,0.72)',
  doc: {
    BUSINESS_CARD: { fg: '#AEC4D8', bg: '#1B2A3C' },
    TICKET:        { fg: '#C2B3E6', bg: '#2A2340' },
    POSTER:        { fg: '#73B5DE', bg: '#12283A' },
    RECEIPT:       { fg: '#7BD69A', bg: '#16301F' },
    DEADLINE:      { fg: '#E8B172', bg: '#33240F' },
  },
  calendar: { sunday: '#F0908C', saturday: '#7FB0EF', selected: '#1B2A3C' },
  skeleton: { base: '#232E3E', highlight: '#2E3B4D' },
  elevation: mkElevation('dark', { raised: '#17202D', dropdown: '#1C2634', sheet: '#232E3E', overlay: '#2B3849' }),
};

export const themes: Record<ResolvedScheme, ThemeTokens> = { light, dark };
```

### 13-4. `src/store/themeStore.ts` — 3택 상태 (zustand + MMKV)

```ts
// src/store/themeStore.ts
import { create } from 'zustand';
import { Appearance, type ColorSchemeName } from 'react-native';
import { colorScheme as nwColorScheme } from 'nativewind';
import { kv } from '@/services/kv';               // MMKV `default` 인스턴스 ([[Data Model]] §6-2)
import type { ResolvedScheme } from '@/theme/tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

/** MMKV 키 정본. 값은 ThemeMode 문자열 그대로 저장한다 ([[Offline and State]] §1-4) */
const KEY = 'theme.mode';

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';

/** 부팅 시 **동기** 읽기. 미저장/오염된 값은 'system'. */
const readMode = (): ThemeMode => {
  const v = kv.getString(KEY);
  return isMode(v) ? v : 'system';
};

export const resolveScheme = (mode: ThemeMode, os: ColorSchemeName): ResolvedScheme =>
  mode === 'system' ? (os === 'dark' ? 'dark' : 'light') : mode;

type ThemeState = {
  mode: ThemeMode;             // 사용자 선택 (설정 세그먼트가 바인딩하는 값)
  scheme: ResolvedScheme;      // 실제 적용값 (컴포넌트가 읽는 값)
  setMode: (m: ThemeMode) => void;
  syncOS: (os: ColorSchemeName) => void;
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const mode = readMode();
  nwColorScheme.set(mode);     // NativeWind 에 3택을 그대로 넘긴다('system' 지원)
  return {
    mode,
    scheme: resolveScheme(mode, Appearance.getColorScheme()),

    setMode: (m) => {
      kv.set(KEY, m);          // 동기 저장 — 프로세스가 즉시 죽어도 남는다
      nwColorScheme.set(m);
      set({ mode: m, scheme: resolveScheme(m, Appearance.getColorScheme()) });
    },

    // OS 테마 변경 이벤트. 명시 선택(light/dark)은 흔들리지 않는다.
    syncOS: (os) => {
      if (get().mode !== 'system') return;
      const next = resolveScheme('system', os);
      if (next !== get().scheme) set({ scheme: next });
    },
  };
});
```

**결정: `zustand/persist` 미들웨어를 쓰지 않는다.** 이유 — (1) persist는 rehydrate가 한 틱 늦어 첫 프레임이 라이트로 깜빡인다(MMKV의 동기 읽기 장점을 버리는 셈), (2) persist는 값을 `{state:{...},version:n}` JSON으로 감싸므로 키가 `theme.mode` 하나에 문자열 하나라는 계약이 깨진다. 스토어 초기화 함수에서 직접 읽는 위 형태가 더 짧고 정직하다.

### 13-5. `ThemeProvider` + 부팅 배선

```tsx
// src/theme/ThemeProvider.tsx
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import { themes, type ThemeTokens } from './tokens';
import { useThemeStore, type ThemeMode } from '@/store/themeStore';

const ThemeCtx = createContext<ThemeTokens>(themes.light);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useThemeStore((s) => s.scheme);
  const syncOS = useThemeStore((s) => s.syncOS);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => syncOS(colorScheme));
    return () => sub.remove();
  }, [syncOS]);

  const value = useMemo(() => themes[scheme], [scheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/** className 을 못 쓰는 지점의 유일한 색 출처 — Reanimated, 네이티브 헤더 옵션, StatusBar,
 *  expo-image placeholder, BottomSheet backdrop, elevation, SVG fill */
export function useTheme(): ThemeTokens {
  return useContext(ThemeCtx);
}

/** 설정 화면(SCR-25) 세그먼트 전용. 화면 코드가 mode 를 읽는 유일한 경로 */
export function useThemeMode(): { mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  return { mode, setMode };
}
```

마운트 순서 — `ThemeProvider`는 **`SafeAreaProvider` 안, `QueryClientProvider` 밖**에 둔다. 스플래시를 내리기 전에 테마가 확정되어야 하고(§13-6 함정 1), 쿼리 캐시 복원보다 앞서야 로딩 스켈레톤이 올바른 테마로 처음 그려진다.

```tsx
// app/_layout.tsx (발췌)
<SafeAreaProvider>
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <AppChrome />       {/* §13-6 */}
      <Stack />
    </QueryClientProvider>
  </ThemeProvider>
</SafeAreaProvider>
```

### 13-6. StatusBar · NavigationBar · 스플래시

```tsx
// src/theme/AppChrome.tsx — 테마 종속 시스템 크롬. 루트에 1회만 마운트.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { useTheme } from './ThemeProvider';

export function AppChrome() {
  const t = useTheme();
  const dark = t.scheme === 'dark';

  useEffect(() => {
    // 화면 전환 사이에 순간 노출되는 네이티브 루트 배경. 안 맞추면 전환마다 흰 섬광이 보인다.
    SystemUI.setBackgroundColorAsync(t.bg.base);
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(t.bg.base);
      NavigationBar.setButtonStyleAsync(dark ? 'light' : 'dark');
    }
  }, [t, dark]);

  // translucent=false + backgroundColor 로 Android 상태바를 앱 배경과 같은 색으로 채운다.
  return <StatusBar style={dark ? 'light' : 'dark'} backgroundColor={t.bg.base} translucent={false} />;
}
```

```ts
// app.config.ts (발췌)
export default {
  userInterfaceStyle: 'automatic',          // 구 결정의 'light' 고정 폐기 (§10-1)
  plugins: [
    ['expo-splash-screen', {
      image: './assets/images/splash-icon.png',
      imageWidth: 200,
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
      dark: { image: './assets/images/splash-icon-dark.png', backgroundColor: '#0F1621' },
    }],
  ],
  android: { navigationBar: { visible: 'immersive' } },  // 색은 런타임에서 위 코드가 설정
};
```

- 스플래시 로고는 **2장 번들**한다: 라이트용(`brand #15293D` 단색) / 다크용(`brand` 다크 변형 `#AEC4D8` 단색). SVG를 PNG로 뽑을 때 색만 바꿔 내보내면 되므로 에셋 비용은 파일 1개 증가뿐이며 APK 영향은 수 KB다(NFR-028 80MB 예산에 무의미).

### 13-7. 함정 (전부 실제로 밟는 것들)

| # | 함정 | 처리 |
|---|---|---|
| 1 | **스플래시는 `theme.mode`를 읽을 수 없다.** 네이티브 리소스라 OS 테마만 따른다 | OS=다크 + 사용자 선택=라이트인 조합에서 스플래시(다크)→앱(라이트) 점프가 1회 생긴다. **결정: 감수한다.** 스플래시를 라이트로 고정하면 OS 다크 사용자 전원이 매 실행마다 흰 섬광을 본다 — 소수 조합의 점프보다 나쁘다. 완화: `SystemUI.setBackgroundColorAsync`로 첫 프레임 배경을 맞춰 점프 구간을 1프레임으로 줄인다 |
| 2 | RN의 `useColorScheme()`을 화면에서 직접 호출 | **금지.** RN 훅은 `colorScheme.set()` 오버라이드를 모르므로 `시스템 따름`이 아닌 사용자에게 잘못된 값을 준다. 화면은 `useTheme()` 또는 nativewind의 `useColorScheme()`만 쓴다. RN `useColorScheme` import는 ESLint `no-restricted-imports`로 차단 ([[Conventions]]) |
| 3 | `bg-white dark:bg-black` 같은 `dark:` 색 분기 | **금지.** 색은 CSS 변수가 이미 테마별로 갈리므로 `bg-bg-base` 한 개면 끝난다. `dark:`를 색에 쓰는 순간 토큰 단일 출처가 다시 무너진다(§0 규칙 3). `dark:`는 변수로 표현 불가한 것(다크에서 특정 이미지 숨김, `borderWidth` 증감)에만 허용 |
| 4 | elevation을 className으로 표현하려는 시도 | RN에 `box-shadow`가 없으므로 불가(§8 규칙 1). `useTheme().elevation.raised`를 `style`로 넘긴다 — 이것이 §0 규칙 3의 정당한 예외다 |
| 5 | `Appearance.addChangeListener`가 백그라운드에서도 발화 | `syncOS`가 `mode !== 'system'`이면 즉시 반환하고, 값이 같으면 `set`을 건너뛴다(위 코드). 없으면 앱 복귀마다 전체 트리가 리렌더된다 |
| 6 | 테마 전환 시 이미지 캐시 | `expo-image` 캐시 키는 URL이라 테마와 무관하다. 전환 시 재다운로드는 발생하지 않는다 |
| 7 | 개발 중 `global.css`와 `tokens.ts` 드리프트 | `npm run theme:css`로 생성하고 CI에서 `git diff --exit-code global.css` 검사. 손으로 고친 흔적은 빌드 실패 |
