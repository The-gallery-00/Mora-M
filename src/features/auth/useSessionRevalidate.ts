import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerSessionCleanup, useAuthStore } from '@/store/authStore';

import { authKeys, ME_STALE_TIME_MS } from './useAuth';
import { isTokenExpired, isTokenExpiringSoon } from './token';

/**
 * 포그라운드 복귀 시 세션 재검증 (Auth.md §4-4 · Offline and State RVL-05).
 *
 * ## 재검증 대상은 `['auth','me']` 하나다
 * Offline and State §8-2 의 재검증 표에서 이 훅이 책임지는 것은 **RVL-05(`['auth','me']`, 5분 초과 시)**
 * 뿐이다. 나머지(RVL-01 알림 배지, RVL-03 대시보드, RVL-04 보관함)는 `refetchOnWindowFocus` +
 * 키별 `staleTime` 이 알아서 처리하는 항목이고, 그 배선(`focusManager` ↔ `AppState`,
 * `onlineManager` ↔ NetInfo)은 루트 레이아웃의 몫이다 — 이 훅은 거기에 손대지 않는다.
 * **전체 `invalidateQueries()` 를 부르지 않는다**: Hikari pool 이 3이라 요청 폭주가 곧 장애다.
 *
 * ## 하는 일
 *  1. 토큰 `exp` 가 지났으면 네트워크 호출 없이 즉시 세션 파기 (선제 만료)
 *  2. 만료 1시간 안이면 비차단 배너 플래그를 켠다 — 리프레시 토큰이 없어 24시간이면 무조건 끊기고,
 *     스캔 편집 중에 끊기면 작업물을 잃기 때문이다
 *  3. 마지막 검증 후 5분이 지났으면 `GET /auth/me` 로 재검증 (401/400 → 세션 파기는 스토어가 처리)
 *  4. 세션 파기 시 React Query 캐시를 비우도록 정리 훅을 등록한다 (계정 전환 사고 방지)
 *
 * 루트에 **한 번만** 마운트한다. 여러 화면에서 부르면 복귀마다 요청이 중복된다.
 */
export function useSessionRevalidate(): void {
  const queryClient = useQueryClient();

  // 401/만료로 세션이 끊길 때 서버 캐시를 통째로 버린다 (Auth.md §5-2, Offline and State §6).
  useEffect(() => registerSessionCleanup(() => queryClient.clear()), [queryClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;

      const store = useAuthStore.getState();
      if (store.status !== 'authenticated') return;

      const token = store.token;
      if (isTokenExpired(token)) {
        void store.expireSession('exp');
        return;
      }

      store.setExpiryWarning(isTokenExpiringSoon(token));

      if (Date.now() - store.lastCheckedAt < ME_STALE_TIME_MS) return;

      // 요청은 한 번만 보낸다. `invalidateQueries` 로 트리거하면 `useMe` 의 queryFn 이
      // `refreshMe` 를 또 부르게 되어 복귀마다 /auth/me 가 2회 나간다.
      void (async () => {
        const res = await store.refreshMe();
        if (res.ok) queryClient.setQueryData(authKeys.me(), res.data);
      })();
    });

    return () => subscription.remove();
  }, [queryClient]);
}
