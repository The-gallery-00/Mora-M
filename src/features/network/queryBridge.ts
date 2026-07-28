// src/features/network/queryBridge.ts
//
// React Query ↔ 플랫폼 이벤트 배선 (Offline and State §8-1 RVL).
//
// RN 에는 브라우저의 `online`/`offline` 이벤트도 `visibilitychange` 도 없다. 배선하지 않으면
// `refetchOnReconnect` / `refetchOnWindowFocus` 는 **영원히 발화하지 않는 죽은 옵션**이다.
// 두 매니저는 전역 싱글턴이라 앱 수명 동안 1회만 연결하고 해제하지 않는다.
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { startNetworkWatch } from './status';

let installed = false;

/**
 * 앱 부팅 시 1회. `app/_layout.tsx` 의 QueryClient 선언 바로 옆에서 부른다.
 *
 *  1. `onlineManager` ← NetInfo
 *     - `queries.networkMode: 'online'` 과 짝을 이룬다. 오프라인이면 쿼리를 `paused` 로 두어
 *       **마지막 데이터를 계속 노출**하고(FR-101 오프라인 열람), 복귀하면 활성 쿼리만 재개한다.
 *     - 판정은 `isConnected` 만 본다 — 근거는 `status.ts` 상단 주석(LAN 직결 프로파일).
 *  2. `focusManager` ← AppState
 *     - 포그라운드 복귀 시 stale 한 활성 쿼리만 재검증한다(RVL-01~07). 실제 재요청 여부는
 *       키별 `staleTime` 이 결정하므로 30초 안에 돌아오면 요청이 나가지 않는다.
 *     - 백그라운드에서 `focused: false` 가 되면 `refetchInterval`(알림 배지 60초 폴링)도 멈춘다.
 *       배선 전에는 화면을 보는 사람이 없는데도 폴링이 계속 돌고 있었다.
 *
 * **전체 `invalidateQueries()` 는 절대 부르지 않는다** — 서버 Hikari pool 이 3이라 요청 폭주가
 * 곧 장애다 (Offline and State §8-2).
 */
export function installQueryNetworkBridge(): void {
  if (installed) return;
  installed = true;

  startNetworkWatch();

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );

  AppState.addEventListener('change', (status) => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(status === 'active');
  });
}
