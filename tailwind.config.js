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
      // 변수 실제 값은 src/global.css(생성물), HEX 정본은 src/theme/tokens.ts.
      colors: {
        bg: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elev) / <alpha-value>)',
          sunken: 'rgb(var(--bg-sunken) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          alt: 'rgb(var(--surface-alt) / <alpha-value>)',
          active: 'rgb(var(--surface-active) / <alpha-value>)',
          input: 'rgb(var(--surface-input) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
        },
        border: {
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          disabled: 'rgb(var(--text-disabled) / <alpha-value>)',
          inverse: 'rgb(var(--text-inverse) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          pressed: 'rgb(var(--brand-pressed) / <alpha-value>)',
          container: 'rgb(var(--brand-container) / <alpha-value>)',
        },
        action: { DEFAULT: 'rgb(var(--action) / <alpha-value>)', pressed: 'rgb(var(--action-pressed) / <alpha-value>)' },
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

      // 색이 아닌 스케일은 테마와 무관하다. 값은 §3 그대로이며 정본은 src/theme/scale.cjs 하나다.
      // 위키 §13-1 의 표기는 `require('./src/theme/scale')` 이지만, Node 의 CJS 확장자 탐색은
      // .js/.json/.node 만 보므로 확장자 없는 경로로는 .cjs 가 해석되지 않는다 → 확장자를 명시한다.
      spacing: require('./src/theme/scale.cjs').tailwindSpacing,
      borderRadius: require('./src/theme/scale.cjs').tailwindRadius,
      fontSize: require('./src/theme/scale.cjs').tailwindFontSize,
      fontFamily: require('./src/theme/scale.cjs').tailwindFontFamily,
    },
  },
  plugins: [],
};
