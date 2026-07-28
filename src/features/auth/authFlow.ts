// src/features/auth/authFlow.ts
//
// `(auth)` 그룹의 역방향 가드를 **일시 유예**하는 홀드 카운터.
//
// 왜 필요한가: `(auth)/_layout` 은 `status === 'authenticated'` 가 되는 순간 `(tabs)` 로
// 리다이렉트한다(Navigation Map §6-3). 그런데 인증 화면 중에는 "세션이 선 뒤에도 잠깐 더 머물러야
// 하는" 구간이 두 곳 있다:
//   1. SCR-04 가입 직후 닉네임 단계(FR-024) — 가입 성공 = 세션 성립이라 즉시 튕긴다
//   2. SCR-05 OAuth 콜백 브리지 — 토큰 저장 직후 `/auth/me` 보정과 성공 토스트가 남아 있다
// 이 구간에서 화면이 통째로 언마운트되면 사용자에게 아무 피드백도 남지 않는다.
//
// 가드를 화면 안에서 우회하지 않고 플래그를 밖에 둔 이유: "인증 가드는 레이아웃 2곳에만 둔다"는
// 규칙(§6-3 규칙 1)을 깨지 않으면서 유예 조건을 한 곳에서 읽고 쓰기 위해서다.
//
// 카운터인 이유: 두 화면이 겹칠 일은 없지만, 불리언이면 한쪽의 해제가 다른 쪽의 홀드를 지운다.
// 영속하지 않는다 — 앱을 재시작하면 홀드는 항상 0 이다.
import { useEffect } from 'react';
import { create } from 'zustand';

type AuthFlowState = {
  /** 리다이렉트를 유예 중인 화면 수. 0 이면 가드가 정상 동작한다. */
  holds: number;
  holdAuthRedirect: () => void;
  releaseAuthRedirect: () => void;
};

export const useAuthFlowStore = create<AuthFlowState>((set) => ({
  holds: 0,
  holdAuthRedirect: () => set((s) => ({ holds: s.holds + 1 })),
  // 0 아래로 내려가면 이후의 정상 홀드가 무력화된다 → 클램프.
  releaseAuthRedirect: () => set((s) => ({ holds: Math.max(0, s.holds - 1) })),
}));

/**
 * `active` 인 동안 `(auth)` 가드의 `(tabs)` 리다이렉트를 붙잡는다.
 * 언마운트·`active` 해제 중 무엇이 먼저 와도 반드시 풀린다.
 */
export function useHoldAuthRedirect(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { holdAuthRedirect, releaseAuthRedirect } = useAuthFlowStore.getState();
    holdAuthRedirect();
    return () => releaseAuthRedirect();
  }, [active]);
}
