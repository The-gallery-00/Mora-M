// scripts/gen-icons.mjs
//
// FR-110 — 브랜딩 에셋(앱 아이콘 · Adaptive Icon · 스플래시 · 알림 아이콘)을
// **원본 MORA 로고 SVG 한 장에서** 전부 생성한다. `npm run gen:icons`.
//
// 왜 스크립트인가
//   손으로 내보낸 PNG 7장은 로고가 바뀌는 순간 전부 어긋난다. 여기서는 정본이
//   `assets/brand/mora-logo-lg.svg` 파일 하나이고, 색·여백·안전영역은 아래 상수로만 결정된다.
//   로고를 고치면 이 스크립트를 다시 돌리는 것으로 7장이 동시에 맞춰진다.
//
// 색의 출처
//   `src/theme/tokens.ts` 의 light 팔레트다. 아이콘은 테마 무관 고정이므로
//   (Design Tokens §10-5) 라이트 값을 그대로 박는다. 여기 말고 다른 곳에서 HEX 를 짓지 않는다.
//
// 안전영역 계산이 이 파일의 핵심이다 — §2 참조.

import { Buffer } from 'node:buffer';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGO_SVG = path.join(ROOT, 'assets/brand/mora-logo-lg.svg');
const OUT_DIR = path.join(ROOT, 'assets/images');

// ─────────────────────────────────────────────────────────────── 1. 상수

/** tokens.ts light.brand.base — 런처 배경 · 스플래시 로고 색. app.config 의 backgroundColor 와 같아야 한다. */
const BRAND_NAVY = '#15293D';
/** tokens.ts light.text.inverse — 네이비 판 위 로고 · 알림 아이콘 실루엣. */
const INVERSE_WHITE = '#FFFFFF';

/** SVG 원본에 박혀 있는 색. 이 값을 목표색으로 치환해 색만 바꾼 판을 만든다. */
const SVG_SOURCE_COLOR = '#15293D';

/** 래스터라이즈 기준 해상도. 항상 여기서 뽑아 축소한다(축소가 확대보다 언제나 깨끗하다). */
const RENDER_PX = 2048;

/** 알파가 이 값 이상인 픽셀만 "로고"로 센다. 안티에일리어싱 꼬리를 여백으로 오인하지 않기 위함. */
const ALPHA_MIN = 12;

// ─────────────────────────────────────────── 2. Adaptive Icon 안전영역 산수
//
// Android adaptive icon 캔버스는 108dp 이고 그중 바깥 18dp 는 마스킹·패럴랙스용 여백이다.
//   - 보이는 영역        : 중앙 72dp (= 캔버스의 66.7%)
//   - 모든 마스크 공통 안전 : 중앙 66dp **원** (원형/스퀘어클/사각 3종 교집합)
// FR-110 완료 조건이 "원형/사각/스퀘어클 3종 검증"이므로 기준은 사각형이 아니라 **원**이다.
//
// MORA 마크는 좌상단 책등 꼭짓점과 우하단 페이지 끝이 대각으로 뻗은 모양이라,
// 바운딩박스를 66% 사각형에 맞추면 원형 마스크에서 그 두 꼭짓점이 잘린다.
// 그래서 박스가 아니라 **콘텐츠의 외접 반지름**을 안전원 반지름에 맞춘다(`fitRadius`).
// 결과적으로 마크는 캔버스의 43%쯤이 되는데, 이는 보이는 영역(72dp) 기준 65% 라 눈에는 정상 크기다.
const ADAPTIVE_PX = 432; // 108dp × 4 (xxxhdpi)
// 132px 에서 1px 안쪽. 안티에일리어싱 꼬리까지 포함해 재도 반지름이 132 를 넘지 않게 한다.
const ADAPTIVE_SAFE_RADIUS = (ADAPTIVE_PX * (66 / 108)) / 2 - 1; // = 131px (안전원 132 / 가시원 144)

// ─────────────────────────────────────────────────────────── 3. SVG 유틸

const SVG_SRC = await readFile(LOGO_SVG, 'utf8');

/**
 * 원본 SVG 를 색·크기·선굵기만 바꿔 되돌려준다. path 데이터는 손대지 않는다.
 *
 * @param {{ color: string; px: number; strokeWidth?: number }} o
 *   strokeWidth — 원본은 0.5(viewBox 36 기준). 48~96px 로 줄어드는 알림/파비콘에서는
 *   페이지 선 3줄이 뭉개져 사라지므로 굵혀서 형태를 지킨다(광학 보정, 도형은 그대로).
 */
function markSvg({ color, px, strokeWidth }) {
  return SVG_SRC.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\bwidth="[^"]*"/, `width="${px}"`).replace(/\bheight="[^"]*"/, `height="${px}"`),
  )
    .replaceAll(SVG_SOURCE_COLOR, color)
    .replace(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth ?? 0.5}"`);
}

/** 지정 색의 마크를 RENDER_PX 로 래스터라이즈한다. */
function renderMark(color, strokeWidth) {
  return sharp(Buffer.from(markSvg({ color, px: RENDER_PX, strokeWidth })))
    .png()
    .toBuffer();
}

/**
 * 알파 채널을 훑어 (a) 잉크가 실제로 닿는 바운딩박스와
 * (b) 그 박스 중심에서의 외접 반지름을 잰다. 안전영역 판정의 근거가 이 두 값이다.
 */
async function measure(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + channels - 1] < ALPHA_MIN) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('로고 SVG 를 래스터라이즈했는데 불투명 픽셀이 0개다.');

  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  let far = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (data[(y * width + x) * channels + channels - 1] < ALPHA_MIN) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > far) far = d2;
    }
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    radius: Math.sqrt(far),
  };
}

/** 여백을 전부 잘라낸 마크(= 바운딩박스만 남은 이미지)와 치수를 돌려준다. */
async function tightMark(color, strokeWidth) {
  const rendered = await renderMark(color, strokeWidth);
  const box = await measure(rendered);
  const buf = await sharp(rendered)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png()
    .toBuffer();
  return { buf, box };
}

// ─────────────────────────────────────────────────────────── 4. 합성 유틸

/**
 * 캔버스 한 장을 만들고 마크를 정중앙에 얹는다.
 *
 * @param {object} o
 * @param {number} o.canvas          한 변 px
 * @param {string|null} o.background HEX 면 불투명 단색 판, null 이면 투명
 * @param {{buf: Buffer, box: {width:number, height:number, radius:number}}|null} o.mark
 * @param {{ boxRatio?: number; safeRadius?: number }} o.fit
 *   boxRatio   — 마크 바운딩박스를 캔버스의 몇 %에 맞출지 (사각/모서리만 깎는 마스크용)
 *   safeRadius — 마크 외접원을 이 반지름 안에 넣는다 (adaptive icon 처럼 원형 마스크가 있는 경우)
 */
async function compose({ canvas, background, mark, fit = {} }) {
  const base = sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: background ? 3 : 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  if (!mark) return base.png({ compressionLevel: 9 }).toBuffer();

  const scale =
    fit.safeRadius != null
      ? fit.safeRadius / mark.box.radius
      : (canvas * (fit.boxRatio ?? 0.6)) / Math.max(mark.box.width, mark.box.height);

  const w = Math.max(1, Math.round(mark.box.width * scale));
  const h = Math.max(1, Math.round(mark.box.height * scale));
  const layer = await sharp(mark.buf)
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const composited = await base
    .composite([
      { input: layer, left: Math.round((canvas - w) / 2), top: Math.round((canvas - h) / 2) },
    ])
    .png()
    .toBuffer();

  if (!background) return composited;

  // composite 는 결과에 알파 채널을 붙인다(불투명 판 위에 얹어도 붙는다).
  // iOS 아이콘은 알파가 있으면 심사에서 거부되고 런처도 검은 테두리를 그릴 수 있다.
  // sharp 는 호출 순서가 아니라 고정 파이프라인 순서로 연산해 같은 체인의 flatten 이
  // composite 보다 먼저 돌아버린다 → 채널을 확실히 떨어뜨리려면 두 번째 패스로 분리한다.
  return sharp(composited).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

// ─────────────────────────────────────────────────────────────── 5. 생성

const whiteMark = await tightMark(INVERSE_WHITE); // 네이비 판 위 · 실루엣용
const navyMark = await tightMark(BRAND_NAVY); // 흰 스플래시 배경 위
const whiteMarkBold = await tightMark(INVERSE_WHITE, 1.1); // 48~96px 축소용 굵은 판

/** @type {{ file: string; note: string; make: () => Promise<Buffer> }[]} */
const TARGETS = [
  {
    file: 'icon.png',
    note: 'iOS/웹/폴백 런처 아이콘 · 브랜드 네이비 판 + 흰 로고 · 알파 없음',
    // 모서리만 깎는 마스크(iOS 스퀘어클 반경 22.4%)라 원 기준까지 줄일 필요가 없다. 박스 60%.
    make: () =>
      compose({ canvas: 1024, background: BRAND_NAVY, mark: whiteMark, fit: { boxRatio: 0.6 } }),
  },
  {
    file: 'android-icon-foreground.png',
    note: 'Adaptive Icon 전경 · 투명 배경 · 66dp 안전원 안',
    make: () =>
      compose({
        canvas: ADAPTIVE_PX,
        background: null,
        mark: whiteMark,
        fit: { safeRadius: ADAPTIVE_SAFE_RADIUS },
      }),
  },
  {
    file: 'android-icon-background.png',
    note: 'Adaptive Icon 배경 · 브랜드 네이비 단색',
    make: () => compose({ canvas: ADAPTIVE_PX, background: BRAND_NAVY, mark: null }),
  },
  {
    file: 'android-icon-monochrome.png',
    note: 'Android 13+ 테마 아이콘 · 흰 실루엣(시스템이 tint 한다) · 전경과 동일 배치',
    make: () =>
      compose({
        canvas: ADAPTIVE_PX,
        background: null,
        mark: whiteMark,
        fit: { safeRadius: ADAPTIVE_SAFE_RADIUS },
      }),
  },
  {
    file: 'splash-icon.png',
    note: '스플래시 로고 · 투명 배경 · 네이비 마크(흰 배경 위)',
    // expo-splash-screen 은 imageWidth(dp) 로 **파일 전체**를 축소한다 →
    // 파일에 남은 여백이 그대로 로고 축소로 이어진다. 그래서 거의 꽉 채운다.
    make: () =>
      compose({ canvas: 1024, background: null, mark: navyMark, fit: { boxRatio: 0.96 } }),
  },
  {
    file: 'notification-icon.png',
    note: 'Android 알림 아이콘 · 96×96 · 흰 실루엣만(시스템이 알파만 사용)',
    make: () =>
      compose({ canvas: 96, background: null, mark: whiteMarkBold, fit: { boxRatio: 0.86 } }),
  },
  {
    file: 'favicon.png',
    note: '웹 파비콘 · 네이비 판 + 흰 로고(밝은/어두운 탭 양쪽에서 보이게)',
    make: () =>
      compose({ canvas: 48, background: BRAND_NAVY, mark: whiteMarkBold, fit: { boxRatio: 0.62 } }),
  },
];

const rows = [];
for (const target of TARGETS) {
  const buf = await target.make();
  const out = path.join(OUT_DIR, target.file);
  await writeFile(out, buf);
  const meta = await sharp(out).metadata();
  const { size } = await stat(out);
  rows.push({
    파일: target.file,
    해상도: `${meta.width}×${meta.height}`,
    알파: meta.hasAlpha ? 'O' : '—',
    크기: `${(size / 1024).toFixed(1)} KB`,
    용도: target.note,
  });
}

console.log(`\n원본  : ${path.relative(ROOT, LOGO_SVG)}`);
console.log(`출력  : ${path.relative(ROOT, OUT_DIR)}`);
console.log(
  `안전원: adaptive ${ADAPTIVE_PX}px 캔버스 · 반지름 ${ADAPTIVE_SAFE_RADIUS}px (66dp/108dp)`,
);
console.table(rows);
