// src/navigation/shell.ts
//
// 앱 셸(탭 내비게이션) 레이아웃 상수.
//
// 값의 정본은 wiki/design/Design Tokens.md §10 `layout` 이다. 색이 아니라 스케일이므로
// 테마와 무관하다. 현재 `src/theme/scale.cjs` 에는 §10 `layout` 블록이 아직 이식되지 않았고
// 그 파일은 테마 담당 소유이므로, 셸이 쓰는 값만 여기서 들고 있는다.
// scale.cjs 에 layout 이 생기면 이 파일은 그 값을 재export 하는 얇은 층으로 바꾼다.
import { spacing } from '@/theme/scale';

/** 탭바 본체 높이(dp). 실제 점유 높이는 여기에 `insets.bottom` 이 더해진다 (Mobile UX Guide §3 규칙 3). */
export const TAB_BAR_HEIGHT = 56;

/** 커스텀 헤더 높이(dp) — 원본 웹 64 → 모바일 56 (Design Tokens §10). */
export const HEADER_HEIGHT = 56;

/** 중앙 스캔 버튼 지름(dp) — Navigation Map §3. */
export const SCAN_BUTTON_SIZE = 56;

/** 중앙 스캔 버튼이 탭바 상단으로 돌출하는 양(dp) — Navigation Map §3. */
export const SCAN_BUTTON_LIFT = 12;

/**
 * 탭 화면 스크롤 콘텐츠의 하단 패딩 — 탭바 + 제스처바 + 여백.
 * Mobile UX Guide §3 규칙 3: `contentContainerStyle.paddingBottom = tabBarHeight + insets.bottom + 16`.
 */
export function tabScrollBottomPadding(insetBottom: number): number {
  return TAB_BAR_HEIGHT + insetBottom + spacing.lg;
}

/**
 * 탭바가 있는 화면에서 토스트를 띄울 높이 — `tabBarHeight + insets.bottom + 12` (Component Library CMP-16).
 * 탭 밖(모달·인증)에서는 `ToastHost` 기본값(`insets.bottom + 16`)을 쓴다.
 */
export function tabToastBottomOffset(insetBottom: number): number {
  return TAB_BAR_HEIGHT + insetBottom + spacing.md;
}
