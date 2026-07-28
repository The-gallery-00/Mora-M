/**
 * src/theme/scale.cjs — 색이 아닌 스케일의 값 정본.
 * 위키 `wiki/design/Design Tokens.md` §5(타이포) · §6(간격) · §7(반경) 값을 그대로 옮긴 것이다.
 * 테마(라이트/다크)와 무관하므로 CSS 변수를 거치지 않는다.
 *
 * CommonJS 인 이유 — `tailwind.config.js` 가 `require()` 로 이 파일을 읽는다(§13-1).
 * tailwind config 는 Node 가 그대로 실행하므로 여기서는 `react-native` 를 import 하지 않는다.
 * 타입은 같은 폴더 `scale.ts` 가 붙인다. 값은 이 파일에만 적는다(두 곳에 적으면 반드시 어긋난다, §0 규칙 2).
 */

/** §6 간격 스케일 — 4배수 그리드. RN `style` 에 넣는 숫자값(dp). */
const spacing = {
  none: 0,
  xxs: 4, //   아이콘-텍스트 최소 간격, 배지 내부 세로
  xs: 6, //    아이콘-라벨 간격
  sm: 8, //    기본 단위. 인접 요소 간격 (원본 최다)
  md: 12, //   리스트 항목 간격, 카드 내부 행 간격
  lg: 16, //   화면 좌우 거터. 카드 내부 패딩
  xl: 20, //   시트 내부 패딩, 섹션 내부 여백
  xxl: 24, //  섹션 간 간격
  xxxl: 32, // 큰 섹션 분리
  huge: 40, // 빈 상태 상하 여백
  giant: 48, // 온보딩 블록 분리
};

/** §7 반경 스케일 — RN `style` 에 넣는 숫자값(dp). */
const radius = {
  xs: 4, //      마이크로 배지, OCR bbox
  sm: 6, //      편집 input, 소형 버튼
  md: 8, //      세그먼트, 드롭다운, 검색바
  button: 10, // 버튼 표준 (--radius-button)
  card: 12, //   카드 표준 (--radius-card)
  field: 14, //  인증 폼 입력/제출 버튼
  xl: 16, //     큰 패널, 이미지 프레임
  sheet: 20, //  바텀시트 상단 모서리
  pill: 999, //  칩, 토글, 배지
};

/**
 * §5 타이포 스케일 — 키는 tailwind `fontSize` 토큰명(§3)이고 단위는 px 다.
 * §5 의 역할 토큰(display/h1/section/bodyStrong …)은 패밀리·letterSpacing 을 함께 묶어야 하므로
 * 이 스케일을 조합해 typography 쪽에서 정의한다. 여기서는 크기/행간만 다룬다.
 * @type {Record<'micro'|'caption'|'label'|'body-sm'|'base'|'button'|'input'|'h3'|'h2'|'h1'|'stat'|'display', { size: number, line: number }>}
 */
const fontScale = {
  micro: { size: 10, line: 14 },
  caption: { size: 11, line: 16 },
  label: { size: 12, line: 16 },
  'body-sm': { size: 13, line: 20 },
  base: { size: 14, line: 22 },
  button: { size: 15, line: 20 },
  input: { size: 16, line: 24 }, // 16 미만이면 iOS 가 폼 포커스 시 확대한다 — 하한선
  h3: { size: 17, line: 24 },
  h2: { size: 20, line: 28 },
  h1: { size: 22, line: 30 },
  stat: { size: 24, line: 30 },
  display: { size: 32, line: 38 },
};

/**
 * §5-1 번들 폰트의 fontFamily 이름 — `assets/fonts/` 의 .ttf 5웨이트 + 로고.
 * Android 는 fontWeight 로 커스텀 폰트 굵기를 못 고른다. 반드시 패밀리로 지정한다.
 */
const fontFamily = {
  regular: 'Pretendard-Regular', //     400
  medium: 'Pretendard-Medium', //       500
  semibold: 'Pretendard-SemiBold', //   600 (원본 최다)
  bold: 'Pretendard-Bold', //           700
  extrabold: 'Pretendard-ExtraBold', // 800
  logo: 'PatuaOne-Regular', //          MORA 워드마크 전용 (latin subset)
};

/**
 * tailwind `spacing` — 4배수 기본 스케일(1=4px)은 tailwind 기본값을 그대로 쓰고,
 * 원본에만 있던 홀수 값과 이름 있는 거터만 더한다(§3).
 */
const tailwindSpacing = {
  '4.5': '18px', // 소셜 아이콘 gap
  '5.5': '22px', // 랜딩 CTA 좌우 패딩
  '7.5': '30px',
  screen: `${spacing.lg}px`, // 화면 좌우 거터 (원본 40px → 모바일 16px)
  sheet: `${spacing.xl}px`, //  바텀시트 내부 패딩
};

/** tailwind `borderRadius` — 키 `btn` 은 클래스명 `rounded-btn` 을 위한 것이다(§3). */
const tailwindRadius = {
  xs: `${radius.xs}px`,
  sm: `${radius.sm}px`,
  md: `${radius.md}px`,
  btn: `${radius.button}px`,
  card: `${radius.card}px`,
  field: `${radius.field}px`,
  xl: `${radius.xl}px`,
  sheet: `${radius.sheet}px`,
};

/**
 * fontScale 항목을 tailwind `fontSize` 표기로 바꾼다.
 * @param {{ size: number, line: number }} t
 * @returns {[string, { lineHeight: string }]}
 */
const twSize = (t) => [`${t.size}px`, { lineHeight: `${t.line}px` }];

/** tailwind `fontSize` — 값은 위 fontScale 에서 파생시켜 드리프트를 원천 차단한다. */
const tailwindFontSize = {
  micro: twSize(fontScale.micro),
  caption: twSize(fontScale.caption),
  label: twSize(fontScale.label),
  'body-sm': twSize(fontScale['body-sm']),
  base: twSize(fontScale.base),
  button: twSize(fontScale.button),
  input: twSize(fontScale.input),
  h3: twSize(fontScale.h3),
  h2: twSize(fontScale.h2),
  h1: twSize(fontScale.h1),
  stat: twSize(fontScale.stat),
  display: twSize(fontScale.display),
};

/**
 * tailwind `fontFamily` — 커스텀 폰트는 weight 유틸(`font-bold`)로 선택되지 않는다.
 * 반드시 패밀리 클래스(`font-w700`)를 쓴다(§3).
 */
const tailwindFontFamily = {
  sans: [fontFamily.regular],
  w500: [fontFamily.medium],
  w600: [fontFamily.semibold],
  w700: [fontFamily.bold],
  w800: [fontFamily.extrabold],
  logo: [fontFamily.logo],
  mono: ['SpaceMono-Regular'],
};

module.exports = {
  spacing,
  radius,
  fontScale,
  fontFamily,
  tailwindSpacing,
  tailwindRadius,
  tailwindFontSize,
  tailwindFontFamily,
};
