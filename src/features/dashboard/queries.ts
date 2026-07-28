/**
 * 대시보드 · 캘린더 React Query 계층 (Phase 6).
 *
 * 정본: wiki/design/Screen Specs.md SCR-06 데이터 표 · SCR-07 데이터 표 · SCR-25 데이터 표
 *       wiki/tech/Offline and State.md §2(전역 설정) · §3(키별 정책)
 *
 * ─────────────────────────────── 쿼리 키 컨벤션 ───────────────────────────────
 *
 *   ['dashboard']                          ← 루트. **문서 수정/삭제가 이 접두사를 무효화한다**
 *   ['dashboard', 'summary', params]       ← API-24 홈 조립 응답
 *   ['dashboard', 'calendar', 'source']    ← 캘린더 원천(티켓 100 + 포스터 100)
 *   ['gcal', userId]                       ← 구글 캘린더 연동 상태
 *   ['gcal', userId, 'token']              ← 연동 계정 정보(미연동이면 400)
 *
 * `['dashboard']` 를 루트로 고른 것은 우연이 아니다. `features/documents/queries.ts` 가
 * 문서 수정·삭제 `onSettled` 에서 `invalidateQueries({ queryKey: ['dashboard'] })` 를 이미
 * 호출하고 있다(그쪽 파일의 무효화 매트릭스). 홈 통계와 캘린더가 **같은 접두사 아래** 있으면
 * 문서를 고치거나 지웠을 때 둘 다 자동으로 정합화된다 — 이 파일이 추가 배선을 하지 않아도 된다.
 *
 * ─────────────────────────── 캘린더를 왜 여기서 조립하는가 ───────────────────────────
 *
 * `GET /api/google-calendar/month` 가 **항상 `events: []`** 를 돌려주기 때문이다(서버 구현이 없다 —
 * `calendar.ts` 상단 ① 참조). SCR-07 데이터 표가 지정한 대로 `GET /api/tickets` +
 * `GET /api/posters`(각 `page=0&size=100`)를 받아 앱이 만든다.
 *
 * **월별로 재요청하지 않는다.** 원천을 한 번만 받아(`['dashboard','calendar','source']`)
 * 월 파생은 전부 `useMemo` 로 처리한다. 근거 2가지:
 *  1. 서버에 기간 필터 파라미터가 없다 — 어차피 전건을 받아야 한다. 월마다 부르면 같은 응답을
 *     12번 받는 셈이다.
 *  2. SCR-07 의 좌우 스와이프는 즉시 반응해야 한다. 월 전환마다 네트워크가 끼면 체감이 무너진다.
 *
 * ⚠ 100건 상한은 서버 한계가 아니라 위키가 정한 값이다. 티켓·포스터 합이 100건을 넘는
 *   사용자는 캘린더에서 오래된 항목이 누락된다. 정렬이 `createdAt DESC` 이므로 최신은 안전하다.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { listDocuments } from '@/features/documents/api';
import type { DocumentDetail } from '@/features/documents/types';
import { NETWORK_COPY, offlineWriteBlock } from '@/features/network';
import type { AppError } from '@/services/http';

import {
  DEFAULT_DEADLINE_DAYS,
  fetchDashboard,
  todayString,
  type Dashboard,
  type DashboardParams,
} from './api';
import {
  buildEventIndex,
  buildMonthMatrix,
  buildWeekStrip,
  CALENDAR_COPY,
  disconnectCalendar,
  eventsInMonth,
  fetchCalendarConnection,
  fetchCalendarTokenInfo,
  isCalendarConnectEnabled,
  startCalendarConnect,
  toCalendarEvents,
  type CalendarConnection,
  type CalendarConnectOutcome,
  type CalendarDay,
  type CalendarEvent,
  type CalendarMonth,
  type CalendarTokenInfo,
} from './calendar';

// ───────────────────────────────────────────────────────────── 쿼리 키

export const dashboardKeys = {
  /** 루트. 문서 변경 시 documents/queries.ts 가 이 접두사를 무효화한다. */
  all: () => ['dashboard'] as const,
  summary: (params: { date?: string; deadlineDays: number }) =>
    ['dashboard', 'summary', params] as const,
  /** 캘린더 원천(티켓+포스터). 월과 무관하게 1벌만 존재한다. */
  calendarSource: () => ['dashboard', 'calendar', 'source'] as const,
} as const;

export const calendarLinkKeys = {
  connection: (userId: string) => ['gcal', userId] as const,
  token: (userId: string) => ['gcal', userId, 'token'] as const,
} as const;

// ───────────────────────────────────────────────────────────── 문구 · 에러

/** SCR-06 / SCR-07 / SCR-25 원문. 새로 짓지 않는다. */
export const DASHBOARD_COPY = {
  loadFailed: '대시보드를 불러오지 못했습니다.',
  refreshFailed: '새로고침에 실패했습니다.',
  calendarLoadFailed: CALENDAR_COPY.loadFailed,
  emptyDeadlines: '30일 이내 마감되는 일정이 없습니다',
  emptySchedules: '일정이 없습니다',
  emptyMonth: '이번 달 등록된 일정이 없습니다.',
  emptyMonthCaption: '티켓과 포스터를 스캔하면 자동으로 표시됩니다.',
  documentMissing: '문서를 찾을 수 없습니다.',
} as const;

export type DashboardOperation = 'summary' | 'calendar' | 'connection' | 'connect' | 'disconnect';

/**
 * `message` 는 이미 완성된 한국어 화면 문구다. 서버 `error` 문장은 한/영 혼재 + 인코딩 파손
 * 가능성이 있어 UI 에 쓰지 않는다 (API Contract §4-5). documents 계층과 같은 규약이다.
 */
export class DashboardError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: DashboardOperation;

  constructor(message: string, error: AppError, operation: DashboardOperation) {
    super(message);
    this.name = 'DashboardError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function dashboardErrorMessage(operation: DashboardOperation, error: AppError): string {
  if (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'unauthorized') {
    return error.message;
  }
  if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

  switch (operation) {
    case 'summary':
      return DASHBOARD_COPY.loadFailed;
    case 'calendar':
      return DASHBOARD_COPY.calendarLoadFailed;
    case 'connection':
      return CALENDAR_COPY.connectUrlFailed;
    case 'connect':
      return CALENDAR_COPY.connectFailed;
    case 'disconnect':
      return CALENDAR_COPY.disconnectFailed;
  }
}

export function toDashboardError(operation: DashboardOperation, error: AppError): DashboardError {
  return new DashboardError(dashboardErrorMessage(operation, error), error, operation);
}

// ───────────────────────────────────────────────────────────── 홈 대시보드

/** SCR-06 데이터 표: `staleTime: 2분`, `gcTime: 30분`. */
export const DASHBOARD_STALE_TIME_MS = 2 * 60_000;
const DASHBOARD_GC_TIME_MS = 30 * 60_000;

export type UseDashboardOptions = DashboardParams & { enabled?: boolean };

/**
 * API-24 — 홈 전체를 1회 호출로 (FR-081).
 *
 * `date` 를 **생략하는 것이 기본**이다. 서버가 자기 `LocalDate.now()` 로 판정하게 두면
 * 기기 시계가 틀어져 있어도 "오늘"의 정의가 서버와 어긋나지 않는다. 캘린더에서 특정 날짜를
 * 눌러 들어온 경우에만 `date` 를 실어 보낸다.
 *
 * `refetchOnWindowFocus` 는 전역 설정을 따르고, 화면은 `useFocusEffect` + `refetch()` 로
 * 포커스 갱신을 건다 (SCR-06 데이터 표).
 */
export function useDashboard(options: UseDashboardOptions = {}) {
  const deadlineDays = options.deadlineDays ?? DEFAULT_DEADLINE_DAYS;
  const params = options.date === undefined ? { deadlineDays } : { date: options.date, deadlineDays };

  const query = useQuery<Dashboard, DashboardError>({
    queryKey: dashboardKeys.summary(params),
    queryFn: async () => {
      const res = await fetchDashboard(params);
      if (!res.ok) throw toDashboardError('summary', res.error);
      return res.data;
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });

  const data = query.data;

  return {
    ...query,
    /**
     * SCR-06 "빈(전체 신규 유저)" 분기 — 통계가 전부 0 이면 히어로 EmptyState 를 그린다.
     * 로딩 중에는 false 여야 스켈레톤 대신 빈 화면이 번쩍이지 않는다.
     */
    isBrandNew:
      !query.isPending &&
      data !== undefined &&
      data.storedDocumentCount === 0 &&
      data.todayScheduleCount === 0 &&
      data.upcomingDeadlineCount === 0,
  };
}

// ───────────────────────────────────────────────────────────── 캘린더 원천

/** SCR-07 데이터 표: 티켓·포스터 각 `page=0, size=100`, staleTime 5분. */
export const CALENDAR_SOURCE_SIZE = 100;
export const CALENDAR_STALE_TIME_MS = 5 * 60_000;

/**
 * 캘린더 원천 조회. 티켓·포스터를 **병렬로** 받아 이벤트 배열로 변환한다.
 *
 * 한쪽만 실패하면 전체를 실패로 본다 — 반쪽짜리 캘린더는 "일정이 사라졌다"는 오해를 만든다.
 * (SCR-07 에러 상태: 캘린더 자리에 에러 카드 + `다시 시도`)
 */
export function useCalendarSource(options: { enabled?: boolean } = {}) {
  return useQuery<CalendarEvent[], DashboardError>({
    queryKey: dashboardKeys.calendarSource(),
    queryFn: async () => {
      const [tickets, posters] = await Promise.all([
        listDocuments('TICKET', { page: 0, size: CALENDAR_SOURCE_SIZE }),
        listDocuments('POSTER', { page: 0, size: CALENDAR_SOURCE_SIZE }),
      ]);
      if (!tickets.ok) throw toDashboardError('calendar', tickets.error);
      if (!posters.ok) throw toDashboardError('calendar', posters.error);

      const documents: DocumentDetail[] = [...tickets.data.items, ...posters.data.items];
      return toCalendarEvents(documents);
    },
    staleTime: CALENDAR_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

export type UseCalendarMonthResult = {
  /** 7×6 그리드. 월이 바뀌면 새로 만들어진다(네트워크 없음). */
  matrix: CalendarMonth;
  /** `YYYY-MM-DD` → 그 날 걸치는 이벤트. dot 렌더링에 바로 쓴다. */
  eventsByDate: Record<string, CalendarEvent[]>;
  /** 이 달에 하루라도 걸치는 이벤트 전체. "이번 달 일정 없음" 판정용. */
  monthEvents: CalendarEvent[];
  isPending: boolean;
  isError: boolean;
  error: DashboardError | null;
  refetch: () => void;
};

/**
 * SCR-07 월간 캘린더 (FR-084).
 * 원천은 `useCalendarSource` 1벌이고, 월 파생은 전부 메모이즈된 순수 계산이다.
 */
export function useCalendarMonth(
  year: number,
  month: number,
  options: { enabled?: boolean } = {},
): UseCalendarMonthResult {
  const source = useCalendarSource(options);
  const events = source.data;

  const matrix = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const monthEvents = useMemo(() => eventsInMonth(events ?? [], year, month), [events, year, month]);
  const eventsByDate = useMemo(() => buildEventIndex(monthEvents), [monthEvents]);

  return {
    matrix,
    eventsByDate,
    monthEvents,
    isPending: source.isPending,
    isError: source.isError,
    error: source.error,
    refetch: () => {
      void source.refetch();
    },
  };
}

export type UseWeekStripResult = {
  days: CalendarDay[];
  eventsByDate: Record<string, CalendarEvent[]>;
};

/**
 * SCR-06 홈의 "이번 주 7일 스트립".
 *
 * **주의: 홈은 이 훅을 쓰지 않아도 된다.** 오늘 하루치 일정은 이미 API-24 응답의
 * `todaySchedules` 에 있다(FR-081: 홈은 1콜). 이 훅은 스트립에 **다른 날짜의 dot** 을
 * 찍고 싶을 때만 쓰는 선택지이며, 그 순간 홈이 2콜이 된다는 것을 알고 써라.
 */
export function useWeekStrip(anchorDate: string, options: { enabled?: boolean } = {}): UseWeekStripResult {
  const source = useCalendarSource(options);
  const events = source.data;

  const anchor = useMemo(() => {
    const [y, m, d] = anchorDate.split('-').map(Number);
    return y === undefined || m === undefined || d === undefined || Number.isNaN(y)
      ? new Date()
      : new Date(y, m - 1, d);
  }, [anchorDate]);

  const days = useMemo(() => buildWeekStrip(anchor), [anchor]);
  const eventsByDate = useMemo(() => buildEventIndex(events ?? []), [events]);

  return { days, eventsByDate };
}

// ───────────────────────────────────────────────────── 구글 캘린더 연동

/** SCR-25 데이터 표: `['gcal', userId]`, staleTime 5분. */
const GCAL_STALE_TIME_MS = 5 * 60_000;

/**
 * API-27 연동 상태. `userId` 가 없으면(부팅 중) 쿼리를 돌리지 않는다.
 *
 * ⚠ 이 엔드포인트는 **인증 검사가 없다**(SCR-25 보안 경고). 앱은 자기 id 만 넘기지만
 *   서버가 남의 id 도 받아 준다는 사실 자체는 Risks 에 남아 있다.
 */
export function useCalendarConnection(userId: string | undefined) {
  return useQuery<CalendarConnection, DashboardError>({
    queryKey: calendarLinkKeys.connection(userId ?? ''),
    queryFn: async () => {
      const res = await fetchCalendarConnection(userId ?? '');
      if (!res.ok) throw toDashboardError('connection', res.error);
      return res.data;
    },
    enabled: Boolean(userId),
    staleTime: GCAL_STALE_TIME_MS,
  });
}

/**
 * API-28 연동 계정 정보 (`googleEmail` 표시용).
 *
 * **미연동이면 400 이 정상이다.** 재시도하지 않고, 연동됐다고 확인된 뒤에만 부른다.
 * 화면은 실패를 에러로 취급하지 말고 그냥 이메일을 감춰야 한다.
 */
export function useCalendarTokenInfo(userId: string | undefined, connected: boolean) {
  return useQuery<CalendarTokenInfo, DashboardError>({
    queryKey: calendarLinkKeys.token(userId ?? ''),
    queryFn: async () => {
      const res = await fetchCalendarTokenInfo(userId ?? '');
      if (!res.ok) throw toDashboardError('connection', res.error);
      return res.data;
    },
    enabled: Boolean(userId) && connected,
    retry: false,
    staleTime: GCAL_STALE_TIME_MS,
  });
}

/**
 * FR-095 연동 시작.
 *
 * **낙관적 갱신을 하지 않는다.** 연동 성공의 정본은 서버 DB 이고, 딥링크의 `calendar=connected`
 * 는 그 자체로 증거가 아니다(서버가 302 를 그리는 시점과 토큰 저장 시점이 다를 수 있다).
 * 그래서 성공 신호를 받으면 상태 쿼리를 **무효화해 재조회**한다. 토글이 잠깐 늦게 켜지는 쪽이
 * 켜졌다가 되돌아가는 것보다 낫다.
 *
 * 반환값은 `CalendarConnectOutcome` 그대로다 — 화면이 `unavailable`/`canceled`/`failed` 를
 * 서로 다르게 처리해야 하기 때문이다(취소는 에러가 아니다).
 */
export function useConnectCalendar(
  userId: string | undefined,
): UseMutationResult<CalendarConnectOutcome, DashboardError, void> {
  const queryClient = useQueryClient();

  return useMutation<CalendarConnectOutcome, DashboardError, void>({
    mutationFn: () => startCalendarConnect(),
    onSettled: (outcome) => {
      if (!userId || outcome?.status !== 'success') return;
      void queryClient.invalidateQueries({ queryKey: calendarLinkKeys.connection(userId) });
      void queryClient.invalidateQueries({ queryKey: calendarLinkKeys.token(userId) });
    },
  });
}

/**
 * FR-096 연동 해제.
 * 여기서는 낙관적으로 끈다 — DELETE 는 결과가 단일하고, 실패 시 스냅샷 복원이 정확하다.
 * SCR-25: 중복 탭 방지는 화면의 `calendarBusy` 가 담당하고 여기서는 `isPending` 을 노출한다.
 */
export function useDisconnectCalendar(
  userId: string | undefined,
): UseMutationResult<CalendarConnection, DashboardError, void, { previous: CalendarConnection | undefined }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // 오프라인 쓰기 차단 (Offline and State OFF-05). 외부 OAuth 상태라 큐잉은 더더욱 위험하다.
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toDashboardError('disconnect', blocked);
      const res = await disconnectCalendar(userId ?? '');
      if (!res.ok) throw toDashboardError('disconnect', res.error);
      return res.data;
    },

    onMutate: async () => {
      if (offlineWriteBlock()) return { previous: undefined };

      const key = calendarLinkKeys.connection(userId ?? '');
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CalendarConnection>(key);
      queryClient.setQueryData<CalendarConnection>(key, {
        userId: userId ?? '',
        connected: false,
      });
      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (!context) return;
      queryClient.setQueryData(calendarLinkKeys.connection(userId ?? ''), context.previous);
    },

    onSettled: () => {
      if (!userId) return;
      void queryClient.invalidateQueries({ queryKey: calendarLinkKeys.connection(userId) });
      // 연동이 끊기면 계정 정보 캐시는 의미가 없다. 무효화가 아니라 제거다(재조회하면 400).
      queryClient.removeQueries({ queryKey: calendarLinkKeys.token(userId) });
    },
  });
}

/**
 * 설정 화면 토글이 필요한 것을 한 번에 준다.
 * `available === false` 면 토글을 **비활성**으로 두고 `CALENDAR_COPY.unavailable` 을 안내한다
 * (되는 척 만들지 않는다 — `calendar.ts` 상단 ② 결정).
 */
export function useCalendarLink(userId: string | undefined) {
  const connection = useCalendarConnection(userId);
  const connected = connection.data?.connected ?? false;
  const tokenInfo = useCalendarTokenInfo(userId, connected);
  const connect = useConnectCalendar(userId);
  const disconnect = useDisconnectCalendar(userId);

  return {
    available: isCalendarConnectEnabled(),
    connected,
    googleEmail: tokenInfo.data?.googleEmail ?? '',
    isPending: connection.isPending,
    isBusy: connect.isPending || disconnect.isPending,
    connect,
    disconnect,
    refetch: connection.refetch,
  };
}

/** 오늘 날짜 문자열. 화면이 `new Date()` 를 직접 다루지 않게 재수출한다. */
export { todayString };
