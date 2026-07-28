/**
 * src/theme/scale.ts — `scale.cjs` 의 값에 타입을 붙여 앱 코드(TS)로 내보낸다.
 *
 * 값을 여기에 적지 않는다. 정본은 `scale.cjs` 하나이며(§0 규칙 2), 이 파일은 재export + 타입뿐이다.
 * 2파일로 나눈 이유 — `tailwind.config.js` 는 `require()` 로 스케일을 읽어야 하는데
 * `require('./src/theme/scale.ts')` 는 Node 가 해석하지 못한다. 값은 .cjs 에 두고 타입만 여기서 붙인다.
 *
 * 아래 토큰 유니온이 키 누락·오타를 컴파일 타임에 잡는 장치다. .cjs 에 키를 빠뜨리면 tsc 가 실패한다.
 */
import scale from './scale.cjs';

/** §6 간격 토큰 */
export type SpacingToken =
  | 'none'
  | 'xxs'
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | 'xxl'
  | 'xxxl'
  | 'huge'
  | 'giant';

/** §7 반경 토큰 */
export type RadiusToken =
  | 'xs'
  | 'sm'
  | 'md'
  | 'button'
  | 'card'
  | 'field'
  | 'xl'
  | 'sheet'
  | 'pill';

/** §5 타이포 스케일 토큰 = tailwind fontSize 토큰명(§3) */
export type FontSizeToken =
  | 'micro'
  | 'caption'
  | 'label'
  | 'body-sm'
  | 'base'
  | 'button'
  | 'input'
  | 'h3'
  | 'h2'
  | 'h1'
  | 'stat'
  | 'display';

/** §5-1 번들 폰트 패밀리 토큰 */
export type FontFamilyToken = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'logo';

/** 한 타이포 스케일 항목 — px 숫자값 */
export type FontScaleEntry = { readonly size: number; readonly line: number };

/** tailwind fontSize 표기 — [크기, { lineHeight }] */
export type TailwindFontSizeEntry = readonly [string, { readonly lineHeight: string }];

export type TailwindSpacingToken = '4.5' | '5.5' | '7.5' | 'screen' | 'sheet';
export type TailwindRadiusToken = 'xs' | 'sm' | 'md' | 'btn' | 'card' | 'field' | 'xl' | 'sheet';
export type TailwindFontFamilyToken = 'sans' | 'w500' | 'w600' | 'w700' | 'w800' | 'logo' | 'mono';

/** §6 간격 스케일 (dp) */
export const spacing: Readonly<Record<SpacingToken, number>> = scale.spacing;

/** §7 반경 스케일 (dp) */
export const radius: Readonly<Record<RadiusToken, number>> = scale.radius;

/** §5 타이포 스케일 (px) — 역할 토큰은 이 값 + fontFamily 를 조합해 만든다 */
export const fontScale: Readonly<Record<FontSizeToken, FontScaleEntry>> = scale.fontScale;

/** §5-1 폰트 패밀리 이름 */
export const fontFamily: Readonly<Record<FontFamilyToken, string>> = scale.fontFamily;

/* ── 아래 4개는 tailwind.config.js 가 require 로 읽는 것과 같은 객체다(이름 변경 금지) ───── */

export const tailwindSpacing: Readonly<Record<TailwindSpacingToken, string>> = scale.tailwindSpacing;
export const tailwindRadius: Readonly<Record<TailwindRadiusToken, string>> = scale.tailwindRadius;
export const tailwindFontSize: Readonly<Record<FontSizeToken, TailwindFontSizeEntry>> =
  scale.tailwindFontSize;
export const tailwindFontFamily: Readonly<Record<TailwindFontFamilyToken, readonly string[]>> =
  scale.tailwindFontFamily;
