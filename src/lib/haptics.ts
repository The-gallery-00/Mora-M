// src/lib/haptics.ts
//
// 앱 전체의 유일한 `expo-haptics` 진입점. 정본: wiki/design/Mobile UX Guide.md §9 (HAP-01 ~ HAP-07).
//
// 화면마다 `import * as Haptics from 'expo-haptics'` 를 흩뿌려 두면 두 가지가 반드시 무너진다.
//  1) 같은 사건에 서로 다른 세기가 붙는다(어떤 화면은 Light, 어떤 화면은 Medium).
//  2) 규칙(§9 금지 2 — 1초 내 2회 초과 금지)을 걸 자리가 없다.
// 그래서 노출하는 것은 아래 다섯 개뿐이고, `ImpactFeedbackStyle` / `NotificationFeedbackType`
// 같은 원시 열거형은 이 파일 밖으로 나가지 않는다.
//
// ── 어디에 무엇을 쓰는가 (§9 표) ─────────────────────────────────────────────
//  selection()        HAP-01 칩·세그먼트·탭 전환, 필터/정렬 변경, 캘린더 날짜 선택, 문서 유형 선택
//  success()          HAP-02 저장 성공, 스캔 완료, 삭제 완료, 그룹 생성
//  warning()          HAP-03 폼 검증 실패, 세션 만료, 권한 거부 + Screen Specs G-6(파괴적 확인 다이얼로그)
//  error()            HAP-04 저장/삭제 실패, 네트워크 실패
//  impact('light')    HAP-05 바텀시트 스냅, pull-to-refresh 임계 도달, 스와이프-삭제 임계 도달
//  impact('medium')   HAP-06 카메라 셔터, 롱프레스 메뉴 열림
//  impact('heavy')    HAP-07 파괴적 액션 실행 직전(탈퇴/전체 삭제 확인 탭) — 1회만
//
// ── 쓰지 않는 곳 ────────────────────────────────────────────────────────────
// 스크롤·타이핑·애니메이션 진행 중, 그리고 위 표에 없는 **일반 버튼**(§9 금지 1).
// 토스트는 tone 에 맞는 햅틱을 `ToastHost` 가 이미 울린다 → 토스트를 띄우는 자리에서
// success()/error()/warning() 을 또 부르면 같은 순간에 두 번 진동한다. 그럴 땐 둘 중 하나만 남기고,
// 굳이 제스처 햅틱을 유지해야 하면 토스트 쪽을 `{ haptic: false }` 로 끈다.
import * as Haptics from 'expo-haptics';

export type ImpactStyle = 'light' | 'medium' | 'heavy';

const IMPACT_STYLE: Record<ImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

/**
 * §9 금지 2 — 연속 칩 탭은 120ms 디바운스.
 * selection 만 대상이다. 저장 성공 같은 결과 햅틱은 사용자가 기다린 사건이라 삼키면 안 된다.
 */
const SELECTION_DEBOUNCE_MS = 120;
let lastSelectionAt = 0;

/**
 * 햅틱은 **보조 피드백**이다. 실패해도 화면 흐름이 멈추면 안 된다.
 * 진동 하드웨어가 없거나(에뮬레이터·일부 태블릿) OS 가 거부하면 expo-haptics 는 reject 하는데,
 * 호출부의 `void` 는 그 reject 를 잡아주지 않아 unhandled rejection 경고가 남는다 → 여기서 삼킨다.
 */
const fire = (run: () => Promise<void>): void => {
  void run().catch(() => undefined);
};

export const haptics = {
  /** HAP-01 — 선택이 바뀌었다(칩·세그먼트·탭·날짜·유형). 120ms 디바운스. */
  selection(): void {
    const now = Date.now();
    if (now - lastSelectionAt < SELECTION_DEBOUNCE_MS) return;
    lastSelectionAt = now;
    fire(() => Haptics.selectionAsync());
  },

  /** HAP-02 — 저장 성공 / 스캔 완료 / 삭제 완료 / 그룹 생성. */
  success(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },

  /** HAP-03 — 폼 검증 실패 / 세션 만료 / 권한 거부, G-6 파괴적 확인 다이얼로그. */
  warning(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },

  /** HAP-04 — 저장·삭제 실패 / 네트워크 실패. */
  error(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },

  /** HAP-05/06/07 — 제스처 임계 도달(light) / 셔터·롱프레스(medium) / 파괴 확정(heavy). */
  impact(style: ImpactStyle = 'light'): void {
    fire(() => Haptics.impactAsync(IMPACT_STYLE[style]));
  },
};
