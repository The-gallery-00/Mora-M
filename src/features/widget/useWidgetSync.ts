/**
 * useWidgetSync — 위젯 JSON 을 앱 상태와 맞춰 주는 루트 훅.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  설계 원칙: **읽기만 한다. 새 네트워크 요청을 만들지 않는다.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 이 훅이 `useCalendarSource()` / `useDashboard()` 를 호출하면 안 된다. 그러면 루트에
 * 옵저버가 하나 더 붙어서 **앱 실행마다 티켓 100건 + 포스터 100건을 추가로 받는다** —
 * 위젯은 순수 추가여야 한다는 규칙(기존 앱 동작 불변)을 위반하고, 로그아웃 상태에서도
 * 요청이 나간다. 그래서 React Query 캐시를 **수동적으로 들여다보기만** 한다:
 *
 *   ['dashboard','calendar','source']  ← app/calendar.tsx 가 채운다 (기간 정보 O → monthMarks 정확)
 *   ['dashboard','summary',…]          ← app/(tabs)/index.tsx 가 채운다 (홈은 거의 항상 열린다)
 *
 * 둘 다 비어 있으면 **아무것도 쓰지 않고 기존 파일을 남긴다.** 캐시가 아직 안 찼다는 이유로
 * 위젯을 빈 상태로 덮어쓰면 사용자에게는 "일정이 사라졌다"로 보인다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  갱신 트리거
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. 마운트 직후 1회 — 콜드 스타트 때 캐시에 남아 있던 값으로 즉시 최신화.
 *  2. `['dashboard', …]` 쿼리 캐시가 갱신될 때. **문서 저장·삭제가 여기에 포함된다** —
 *     `features/documents/queries.ts` 가 뮤테이션 `onSettled` 에서 `['dashboard']` 를
 *     무효화하고, 그 재요청이 성공하면 이 리스너가 발화한다. 별도 배선이 필요 없다.
 *  3. 앱 포그라운드 복귀(`AppState` → `active`).
 *
 * 트리거가 몰릴 수 있어(무효화 1회 → 여러 쿼리 갱신) 디바운스로 묶는다.
 *
 * ⚠ **한계 — 위젯에 반영되기까지 최대 30분 걸린다.** 이 훅은 JSON 파일까지만 책임진다.
 *   런처에 "지금 다시 그려라"를 알리려면 `AppWidgetManager.notifyAppWidgetViewDataChanged`
 *   를 부르는 네이티브 모듈이 필요하고 v1 에서는 만들지 않았다. 위젯은
 *   `updatePeriodMillis = 1800000`(30분, 안드로이드 최소값) · 위젯 탭 · 부팅 후에 갱신된다.
 *   일정과 날짜는 분 단위로 바뀌지 않으므로 수용 가능한 지연이다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  로그아웃 시 삭제
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `registerSessionCleanup()` 으로 `clearWidgetData()` 를 등록한다. auth 파일을 건드리지 않고
 * 붙일 수 있는 지점이라 여기서 처리한다. 이 경로가 커버하는 것은 `authStore.signOut()` 과
 * `expireSession()` 두 곳(= 로그아웃 버튼, 세션 만료·401)이다.
 * **완전한 커버리지는 `signOutLocal()` 에 한 줄 넣는 것이다** — 근거와 미커버 경로는 반환 보고 참조.
 */

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import type { Dashboard } from '@/features/dashboard/api';
import type { CalendarEvent } from '@/features/dashboard/calendar';
import { dashboardKeys } from '@/features/dashboard/queries';
import { registerSessionCleanup } from '@/store/authStore';

import { buildWidgetPayload, clearWidgetData, writeWidgetData } from './data';

/**
 * 디바운스 창. 문서 1건 저장이 `['dashboard']` 무효화 → summary·calendarSource 2개 재요청을
 * 일으키므로, 응답이 다 도착할 시간을 준 뒤 한 번만 쓴다.
 */
const SYNC_DEBOUNCE_MS = 1_200;

/**
 * 캐시에 있는 것만으로 페이로드를 만들어 파일에 쓴다.
 *
 * 실패는 전부 삼킨다 — 이 함수가 던지면 `setTimeout` 콜백에서 처리되지 않은 예외가 되어
 * 개발 빌드에서 레드박스가 뜬다. 위젯 갱신 실패는 앱에 보이지 않아야 한다.
 */
function syncFromCache(queryClient: QueryClient): void {
  try {
    const events = queryClient.getQueryData<CalendarEvent[]>(dashboardKeys.calendarSource());

    // summary 키는 params 객체를 포함해(deadlineDays·date) 정확한 키를 알 수 없다.
    // 접두사로 긁어 값이 있는 첫 항목을 쓴다.
    const summaries = queryClient.getQueriesData<Dashboard>({ queryKey: ['dashboard', 'summary'] });
    let dashboard: Dashboard | undefined;
    for (const [, data] of summaries) {
      if (data !== undefined) {
        dashboard = data;
        break;
      }
    }

    // 캐시가 완전히 비었으면 기존 파일을 보존한다(위 헤더 주석 참조).
    if (events === undefined && dashboard === undefined) return;

    writeWidgetData(buildWidgetPayload({ events, dashboard }));
  } catch {
    // 조용히 무시.
  }
}

/** `['dashboard', …]` 접두사인가 — 대시보드·캘린더 원천 둘 다 이 아래에 있다. */
function isDashboardKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'dashboard';
}

/**
 * 루트에서 **1회만** 마운트한다. UI 를 그리지 않는다.
 * 여러 화면에서 부르면 파일 쓰기가 중복된다(치명적이지는 않지만 의미 없는 I/O 다).
 */
export function useWidgetSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // 위젯은 안드로이드 전용이다. 다른 플랫폼에서는 리스너조차 붙이지 않는다.
    if (Platform.OS !== 'android') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const schedule = (): void => {
      if (disposed || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        syncFromCache(queryClient);
      }, SYNC_DEBOUNCE_MS);
    };

    // 1. 마운트 직후
    schedule();

    // 2. 대시보드 계열 쿼리 갱신 (문서 저장·삭제의 무효화도 결국 여기로 온다)
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (!isDashboardKey(event.query.queryKey)) return;
      schedule();
    });

    // 3. 포그라운드 복귀
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule();
    });

    // 로그아웃·세션만료 → 개인정보가 홈 화면에 남지 않게 파일 삭제
    const unregisterCleanup = registerSessionCleanup(() => {
      clearWidgetData();
    });

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribeCache();
      appStateSubscription.remove();
      unregisterCleanup();
    };
  }, [queryClient]);
}
