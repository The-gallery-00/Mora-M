// 앱의 햅틱 호출을 한곳에서 관리한다.
//
// 현재 제품 정책상 버튼, 선택, 제스처 및 결과 피드백에서 진동을 사용하지 않는다.
// 기존 호출부의 동작과 타입은 유지하면서 실제 기기 진동만 차단한다.

export type ImpactStyle = 'light' | 'medium' | 'heavy';

const noop = (): void => undefined;

export const haptics = {
  selection: noop,
  success: noop,
  warning: noop,
  error: noop,
  impact(_style: ImpactStyle = 'light'): void {
    // Intentionally disabled.
  },
};
