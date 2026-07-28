/// <reference types="node" />
/**
 * scripts/gen-theme-css.ts — `src/theme/tokens.ts`(HEX 유일 정본) → `src/global.css` 생성기.
 *
 *   node scripts/gen-theme-css.ts          # 생성/갱신          (npm run theme:css)
 *   node scripts/gen-theme-css.ts --check  # 커밋된 파일과 다르면 종료코드 1 (npm run theme:css:check)
 *
 * Node 24 는 .ts 를 타입 스트리핑으로 직접 실행하므로 별도 런너(tsx/ts-node)를 쓰지 않는다.
 * 다만 `tokens.ts` 는 elevation 때문에 `react-native` 를 import 하는데 Node 는 그 패키지(Flow 문법)를
 * 파싱할 수 없다. 그래서 module hook 으로 `react-native` 를 Platform 스텁으로 갈아끼운 뒤 import 한다.
 * 색 값은 스텁과 무관하므로(elevation 만 Platform 을 쓴다) 생성 결과에는 영향이 없다.
 *
 * 이 파일이 아는 것은 "어떤 변수가 어느 토큰인지 + 어떤 줄에 놓이는지"뿐이고, 값은 전부 tokens.ts 에서 온다.
 *
 * 주의: 값 로딩은 `require` 로 받는다. 루트 package.json 에 `"type": "module"` 이 없으므로
 * 이 파일에 top-level `import` 문을 두면 Node 가 CJS 로 파싱 실패 → ESM 으로 재파싱하며
 * MODULE_TYPELESS_PACKAGE_JSON 경고를 뱉는다. 타입은 `typeof import(...)` 로 그대로 받는다.
 */
import type { ResolvedScheme, ThemeTokens } from '../src/theme/tokens';

const { existsSync, readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
const { registerHooks } = require('node:module') as typeof import('node:module');
const { join } = require('node:path') as typeof import('node:path');
const { pathToFileURL } = require('node:url') as typeof import('node:url');

/* ── 1) react-native 스텁 주입 ─────────────────────────────────────── */

// tokens.ts 는 ESM 인데 루트 package.json 에는 "type" 이 없어(tailwind/metro 설정이 CJS 다)
// Node 가 매번 MODULE_TYPELESS_PACKAGE_JSON 경고를 찍는다. 무해한 성능 경고이고 CI 로그만
// 더럽히므로 이 경고만 걸러낸다 — 나머지 경고는 그대로 출력한다.
process.removeAllListeners('warning');
process.on('warning', (warning: Error & { code?: string }) => {
  if (warning.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(warning);
});

const RN_STUB = `data:text/javascript,${encodeURIComponent(
  "export const Platform = { OS: 'ios', select: (spec) => spec.ios ?? spec.native ?? spec.default };",
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return { url: RN_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/* ── 2) CSS 변수 ↔ 토큰 경로 (§13-1 변수명 / §13-3 토큰 구조) ───────── */

const VAR_PATH: Record<string, string> = {
  'bg-base': 'bg.base',
  'bg-elev': 'bg.elevated',
  'bg-sunken': 'bg.sunken',
  surface: 'surface.base',
  'surface-alt': 'surface.alt',
  'surface-active': 'surface.active',
  'surface-input': 'surface.input',
  'surface-overlay': 'surface.overlay',
  'border-subtle': 'border.subtle',
  'border-strong': 'border.strong',
  'text-primary': 'text.primary',
  'text-secondary': 'text.secondary',
  'text-muted': 'text.muted',
  'text-disabled': 'text.disabled',
  'text-inverse': 'text.inverse',
  brand: 'brand.base',
  'brand-pressed': 'brand.pressed',
  'brand-container': 'brand.container',
  action: 'action.base',
  'action-pressed': 'action.pressed',
  success: 'success.base',
  'success-text': 'success.text',
  'success-container': 'success.container',
  warn: 'warn.base',
  'warn-container': 'warn.container',
  'warn-border': 'warn.border',
  danger: 'danger.base',
  'danger-strong': 'danger.strong',
  'danger-pressed': 'danger.pressed',
  'danger-container': 'danger.container',
  'danger-border': 'danger.border',
  info: 'info.base',
  'info-container': 'info.container',
  'info-border': 'info.border',
  'doc-card': 'doc.BUSINESS_CARD.fg',
  'doc-card-bg': 'doc.BUSINESS_CARD.bg',
  'doc-ticket': 'doc.TICKET.fg',
  'doc-ticket-bg': 'doc.TICKET.bg',
  'doc-poster': 'doc.POSTER.fg',
  'doc-poster-bg': 'doc.POSTER.bg',
  'doc-receipt': 'doc.RECEIPT.fg',
  'doc-receipt-bg': 'doc.RECEIPT.bg',
  'doc-deadline': 'doc.DEADLINE.fg',
  'doc-deadline-bg': 'doc.DEADLINE.bg',
  skeleton: 'skeleton.base',
  'skeleton-hi': 'skeleton.highlight',
};

/**
 * 줄 배치 — 한 줄에 놓을 변수들. §13-2 의 줄 나눔을 그대로 유지한다.
 * `darkTrail` 은 다크 블록에만 붙는 주석이다.
 */
const LAYOUT: readonly { readonly vars: readonly string[]; readonly darkTrail?: string }[] = [
  { vars: ['bg-base', 'bg-elev', 'bg-sunken'] },
  { vars: ['surface', 'surface-alt', 'surface-active'] },
  { vars: ['surface-input', 'surface-overlay'] },
  { vars: ['border-subtle', 'border-strong'], darkTrail: '/* DK-07 — 양 테마 공용 */' },
  { vars: ['text-primary', 'text-secondary', 'text-muted'] },
  { vars: ['text-disabled', 'text-inverse'] },
  { vars: ['brand', 'brand-pressed', 'brand-container'] },
  { vars: ['action', 'action-pressed'] },
  { vars: ['success', 'success-text', 'success-container'] },
  { vars: ['warn', 'warn-container', 'warn-border'] },
  { vars: ['danger', 'danger-strong', 'danger-pressed'] },
  { vars: ['danger-container', 'danger-border'] },
  { vars: ['info', 'info-container', 'info-border'] },
  { vars: ['doc-card', 'doc-card-bg'] },
  { vars: ['doc-ticket', 'doc-ticket-bg'] },
  { vars: ['doc-poster', 'doc-poster-bg'] },
  { vars: ['doc-receipt', 'doc-receipt-bg'] },
  { vars: ['doc-deadline', 'doc-deadline-bg'] },
  { vars: ['skeleton', 'skeleton-hi'] },
];

/** 각 칸이 시작하는 열. 넘치면 공백 1개만 둔다. */
const COLS = [4, 35, 65] as const;
const TRAIL_COL = 67;

const HEADER =
  '/* global.css — scripts/gen-theme-css.ts 생성물 — 직접 수정 금지, `npm run theme:css` 로 재생성. */';

/* ── 3) 렌더링 ─────────────────────────────────────────────────────── */

/** `#RRGGBB` → NativeWind 가 읽는 "R G B" 채널 문자열 */
const toChannels = (hex: string): string => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`HEX(#RRGGBB) 형식이 아니다: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

/** 'doc.TICKET.fg' 같은 경로로 토큰 값을 꺼낸다 */
const pick = (tokens: ThemeTokens, path: string): string => {
  const value = path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      tokens,
    );
  if (typeof value !== 'string') throw new Error(`tokens.ts 에 없는 토큰 경로다: ${path}`);
  return value;
};

const padTo = (line: string, col: number): string => line + ' '.repeat(Math.max(1, col - line.length));

const renderBlock = (selector: string, tokens: ThemeTokens, isDark: boolean): string => {
  const rows = LAYOUT.map(({ vars, darkTrail }) => {
    let line = '';
    vars.forEach((name, i) => {
      const path = VAR_PATH[name];
      if (!path) throw new Error(`VAR_PATH 에 없는 변수다: --${name}`);
      line = `${padTo(line, COLS[i] ?? line.length + 1)}--${name}: ${toChannels(pick(tokens, path))};`;
    });
    return isDark && darkTrail ? padTo(line, TRAIL_COL) + darkTrail : line;
  });
  return `  ${selector} {\n${rows.join('\n')}\n  }`;
};

const build = (themes: Record<ResolvedScheme, ThemeTokens>): string =>
  [
    HEADER,
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    '@layer base {',
    renderBlock(':root', themes.light, false),
    '',
    renderBlock('.dark:root', themes.dark, true),
    '}',
    '',
  ].join('\n');

/* ── 4) 실행 ───────────────────────────────────────────────────────── */

/** 개발 환경마다 갈리는 개행(CRLF)은 비교에서 제외한다 */
const normalize = (s: string): string => s.replace(/\r\n/g, '\n');

const firstDiffLine = (a: string, b: string): number => {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if (x[i] !== y[i]) return i + 1;
  return 0;
};

async function main(): Promise<void> {
  const tokensUrl = pathToFileURL(join(__dirname, '../src/theme/tokens.ts')).href;
  const { themes } = (await import(tokensUrl)) as typeof import('../src/theme/tokens');

  const out = join(__dirname, '../src/global.css');
  const next = build(themes);
  const current = existsSync(out) ? normalize(readFileSync(out, 'utf8')) : null;
  const same = current === normalize(next);

  if (process.argv.includes('--check')) {
    if (same) {
      console.log('✓ src/global.css 가 src/theme/tokens.ts 와 일치한다.');
      return;
    }
    const where = current === null ? '파일 없음' : `첫 불일치 줄 ${firstDiffLine(current, normalize(next))}`;
    console.error(`✗ src/global.css 가 src/theme/tokens.ts 와 다르다 (${where}).`);
    console.error('  → `npm run theme:css` 로 재생성한 뒤 커밋해라. global.css 를 손으로 고치면 안 된다.');
    process.exitCode = 1;
    return;
  }

  if (same) {
    console.log('= 변경 없음: src/global.css');
    return;
  }
  writeFileSync(out, next, 'utf8');
  console.log('→ 생성: src/global.css');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
