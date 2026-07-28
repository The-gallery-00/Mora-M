/**
 * 알림 React Query 계층 (SCR-08 · SCR-06 헤더 배지).
 *
 * 정본: wiki/design/Screen Specs.md SCR-08 데이터 표 · SCR-06 데이터 표(API-33)
 *       wiki/tech/Offline and State.md §11(낙관적 업데이트 규칙 R1~R7)
 *
 * ─────────────────────────────── 쿼리 키 컨벤션 ───────────────────────────────
 *
 *   ['notifications']                 ← 목록 루트 (무한 쿼리)
 *   ['notifications', 'list', size]   ← 실제 무한 목록
 *   ['notif', 'unread']               ← 미읽음 개수 배지 (SCR-06 데이터 표가 지정한 키 그대로)
 *
 * 배지 키를 목록과 **일부러 분리**했다. 홈 헤더는 목록을 받지 않고 개수만 60초 폴링하는데,
 * 같은 접두사에 두면 홈에서의 폴링이 알림 화면의 무한 목록까지 무효화해 스크롤이 리셋된다.
 *
 * ─────────────────────────────── 폴링 근거 ───────────────────────────────
 *
 * 백엔드에 FCM/APNs 토큰 저장 컬럼이 없고 WebSocket/SSE 도 없다. 알림은 DB row +
 * 클라이언트 폴링이 유일한 경로다 (SCR-06 데이터 표 각주). 실시간 푸시는 Risks 의 후속 과제다.
 * 서버 `DeadlineNotificationScheduler` 는 **매일 09:00 KST 한 번** 도는 배치라
 * 60초 폴링도 사실 과하다 — 그래도 위키가 정한 값이라 그대로 따른다.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { NETWORK_COPY, offlineWriteBlock } from '@/features/network';
import type { AppError } from '@/services/http';

import {
  deleteAllNotifications,
  deleteNotification,
  fetchUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_COPY,
  NOTIFICATION_PAGE_SIZE,
  type Notification,
  type NotificationPage,
} from './api';

// ───────────────────────────────────────────────────────────── 쿼리 키

export const notificationKeys = {
  all: () => ['notifications'] as const,
  lists: () => ['notifications', 'list'] as const,
  list: (size: number) => ['notifications', 'list', size] as const,
  /** SCR-06 데이터 표가 지정한 키. 홈 헤더 배지 전용. */
  unread: () => ['notif', 'unread'] as const,
} as const;

// ───────────────────────────────────────────────────────────── 에러

export type NotificationOperation = 'list' | 'unread' | 'read' | 'readAll' | 'delete' | 'deleteAll';

export class NotificationError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: NotificationOperation;

  constructor(message: string, error: AppError, operation: NotificationOperation) {
    super(message);
    this.name = 'NotificationError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function notificationErrorMessage(operation: NotificationOperation, error: AppError): string {
  if (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'unauthorized') {
    return error.message;
  }
  if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

  switch (operation) {
    case 'list':
    case 'unread':
      return NOTIFICATION_COPY.listFailed;
    case 'read':
    case 'readAll':
      return NOTIFICATION_COPY.readFailed;
    case 'delete':
    case 'deleteAll':
      return NOTIFICATION_COPY.deleteFailed;
  }
}

export function toNotificationError(
  operation: NotificationOperation,
  error: AppError,
): NotificationError {
  return new NotificationError(notificationErrorMessage(operation, error), error, operation);
}

// ───────────────────────────────────────────────────────────── 캐시 헬퍼

type NotificationInfinite = InfiniteData<NotificationPage, number>;

/** 전 페이지에서 항목 1건을 교체한다. */
function replaceInPages(
  data: NotificationInfinite | undefined,
  id: string,
  patch: Partial<Notification>,
): NotificationInfinite | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  };
}

/** 전 페이지에서 항목 1건을 제거한다. `totalElements` 도 함께 줄인다. */
function removeFromPages(
  data: NotificationInfinite | undefined,
  id: string,
): NotificationInfinite | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => {
      const items = page.items.filter((item) => item.id !== id);
      if (items.length === page.items.length) return page;
      return { ...page, items, totalElements: Math.max(0, page.totalElements - 1) };
    }),
  };
}

/** 전 페이지를 읽음으로 표시한다. */
function markAllInPages(data: NotificationInfinite | undefined): NotificationInfinite | undefined {
  if (!data) return data;
  const now = new Date().toISOString();
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.read ? item : { ...item, read: true, readAt: now })),
    })),
  };
}

// ───────────────────────────────────────────────────────────── 미읽음 배지

/** SCR-06 데이터 표: `staleTime: 30초`, 60초 폴링. */
export const UNREAD_STALE_TIME_MS = 30_000;
export const UNREAD_POLL_INTERVAL_MS = 60_000;

/**
 * API-33 미읽음 개수 (FR-086).
 *
 * `refetchIntervalInBackground` 를 **켜지 않는다** — 앱이 백그라운드일 때 폴링하면
 * 배터리만 쓰고 볼 사람이 없다. 포그라운드 복귀 시 `refetchOnWindowFocus` 가 즉시 갱신한다.
 *
 * 실패해도 화면을 깨뜨리면 안 된다. 배지는 장식에 가까우므로 호출부는 `count ?? 0` 으로 받는다.
 */
export function useUnreadCount(options: { enabled?: boolean } = {}) {
  const query = useQuery<number, NotificationError>({
    queryKey: notificationKeys.unread(),
    queryFn: async () => {
      const res = await fetchUnreadCount();
      if (!res.ok) throw toNotificationError('unread', res.error);
      return res.data;
    },
    staleTime: UNREAD_STALE_TIME_MS,
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });

  return {
    ...query,
    /** 배지에 그대로 넣는 값. 실패·로딩 중에는 0 이다. */
    count: query.data ?? 0,
  };
}

// ───────────────────────────────────────────────────────────── 무한 목록

/**
 * API-32 무한 목록 (FR-085).
 *
 * **종료 판정은 `last` 플래그만 본다.** `totalPages` 로 계산하면 서버가 값을 빠뜨렸을 때
 * 마지막 페이지를 무한 재요청한다 (documents 계층과 같은 규칙).
 */
export function useInfiniteNotifications(
  options: { size?: number; enabled?: boolean } = {},
) {
  const size = options.size ?? NOTIFICATION_PAGE_SIZE;

  const query = useInfiniteQuery<
    NotificationPage,
    NotificationError,
    NotificationInfinite,
    readonly unknown[],
    number
  >({
    queryKey: notificationKeys.list(size),
    queryFn: async ({ pageParam }) => {
      const res = await listNotifications({ page: pageParam, size });
      if (!res.ok) throw toNotificationError('list', res.error);
      return res.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.last ? undefined : lastPage.number + 1),
    staleTime: 30_000,
    // gcTime 은 전역 30분(Offline and State §2). SCR-08 오프라인 행이 "캐시 목록 표시"다.
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });

  const notifications = useMemo<Notification[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  return {
    ...query,
    notifications,
    total: query.data?.pages[0]?.totalElements ?? 0,
    isEmpty: !query.isPending && notifications.length === 0,
    /** 헤더 `모두 읽음` 활성 판정. 로드된 범위 안에 미읽음이 하나라도 있는가. */
    hasUnread: notifications.some((item) => !item.read),
  };
}

// ───────────────────────────────────────────────────────────── 단건 읽음

/**
 * API-35 단건 읽음 — 낙관적 갱신 (FR-087).
 *
 * SCR-08 인터랙션: **"읽음 실패해도 이동은 진행, 배지 롤백"**. 그래서 화면은 이 뮤테이션을
 * `await` 하지 말고 `mutate()` 로 쏜 뒤 곧바로 라우팅해야 한다. 여기서 라우팅을 하지 않는 이유는
 * 데이터 계층이 네비게이션을 알면 테스트도 재사용도 불가능해지기 때문이다.
 *
 * 이미 읽은 항목은 뮤테이션 자체를 건너뛴다 — 서버 왕복과 배지 깜빡임을 둘 다 없앤다.
 */
export function useMarkNotificationRead(): UseMutationResult<
  Notification | null,
  NotificationError,
  { id: string; alreadyRead?: boolean },
  { snapshot: [readonly unknown[], unknown][]; previousCount: number | undefined; skipped: boolean }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, alreadyRead }) => {
      if (alreadyRead) return null;
      // SCR-08 오프라인 — 읽음/삭제는 연결 후에만. 큐잉하지 않는다 (Offline and State §5-1).
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toNotificationError('read', blocked);
      const res = await markNotificationRead(id);
      if (!res.ok) throw toNotificationError('read', res.error);
      return res.data;
    },

    onMutate: async ({ id, alreadyRead }) => {
      // 오프라인이면 낙관적 반영을 건너뛴다 — 배지가 줄었다가 되돌아오는 것이 더 혼란스럽다.
      const skipped = alreadyRead === true || offlineWriteBlock() !== null;
      if (skipped) return { snapshot: [], previousCount: undefined, skipped };

      // ① 진행 중 refetch 를 먼저 끊는다. 안 끊으면 그 응답이 낙관적 상태를 덮어쓴다 (R1).
      await queryClient.cancelQueries({ queryKey: notificationKeys.all() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread() });

      // ② 스냅샷은 복수형으로 뜬다 — size 별로 캐시가 여럿일 수 있다 (R2).
      const snapshot = queryClient.getQueriesData({
        queryKey: notificationKeys.lists(),
      }) as [readonly unknown[], unknown][];
      const previousCount = queryClient.getQueryData<number>(notificationKeys.unread());

      queryClient.setQueriesData<NotificationInfinite>({ queryKey: notificationKeys.lists() }, (old) =>
        replaceInPages(old, id, { read: true, readAt: new Date().toISOString() }),
      );
      queryClient.setQueryData<number>(notificationKeys.unread(), (old) =>
        typeof old === 'number' ? Math.max(0, old - 1) : old,
      );

      return { snapshot, previousCount, skipped };
    },

    onError: (_error, _vars, context) => {
      if (!context || context.skipped) return;
      // ③ 부분 복원은 페이지 경계가 어긋난다. 스냅샷 전량 복원이 원칙이다 (R3).
      context.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context.previousCount !== undefined) {
        queryClient.setQueryData(notificationKeys.unread(), context.previousCount);
      }
    },

    onSuccess: (saved) => {
      // 서버가 돌려준 값이 정본이다(정규화된 message 포함).
      if (!saved) return;
      queryClient.setQueriesData<NotificationInfinite>({ queryKey: notificationKeys.lists() }, (old) =>
        replaceInPages(old, saved.id, saved),
      );
    },

    onSettled: (_saved, _error, _vars, context) => {
      if (context?.skipped) return;
      // ④ 성공·실패 무관하게 배지만 정합화한다 (R5).
      // **목록은 무효화하지 않는다** — 무한 목록을 무효화하면 첫 페이지부터 다시 받아 오면서
      // 스크롤 위치와 이미 로드한 페이지가 날아간다. 읽음 표시는 위에서 이미 정확히 반영됐다.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });
}

// ───────────────────────────────────────────────────────────── 전체 읽음

/**
 * API-36 전체 읽음 (FR-087).
 * 성공하면 `updatedCount` 를 돌려준다 → 화면이 `markAllReadMessage(n)` 로 토스트를 만든다.
 */
export function useMarkAllNotificationsRead(): UseMutationResult<
  number,
  NotificationError,
  void,
  { snapshot: [readonly unknown[], unknown][]; previousCount: number | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toNotificationError('readAll', blocked);
      const res = await markAllNotificationsRead();
      if (!res.ok) throw toNotificationError('readAll', res.error);
      return res.data;
    },

    onMutate: async () => {
      if (offlineWriteBlock()) return { snapshot: [], previousCount: undefined };

      await queryClient.cancelQueries({ queryKey: notificationKeys.all() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread() });

      const snapshot = queryClient.getQueriesData({
        queryKey: notificationKeys.lists(),
      }) as [readonly unknown[], unknown][];
      const previousCount = queryClient.getQueryData<number>(notificationKeys.unread());

      queryClient.setQueriesData<NotificationInfinite>(
        { queryKey: notificationKeys.lists() },
        (old) => markAllInPages(old),
      );
      queryClient.setQueryData<number>(notificationKeys.unread(), 0);

      return { snapshot, previousCount };
    },

    onError: (_error, _vars, context) => {
      if (!context) return;
      context.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context.previousCount !== undefined) {
        queryClient.setQueryData(notificationKeys.unread(), context.previousCount);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });
}

// ───────────────────────────────────────────────────────────── 삭제

/**
 * API-37 단건 삭제 — 낙관적 제거 (FR-088).
 *
 * 미읽음 항목을 지우면 배지도 함께 줄여야 한다. 서버는 `deleteAll` 과 달리 삭제된 항목이
 * 읽음이었는지 알려주지 않으므로 **호출부가 `wasUnread` 를 넘긴다** — 행이 이미 그 정보를 안다.
 *
 * 연속 삭제 시 A 만 실패하면 A 의 스냅샷이 B 가 지운 항목까지 되살린다. 이 잔상은
 * `onSettled` 의 배지 무효화로는 지워지지 않으므로, **실패한 경우에만** 목록을 무효화해
 * 서버 값으로 정정한다 (documents 계층이 택한 전량 복원 + 무효화와 같은 절충).
 */
export function useDeleteNotification(): UseMutationResult<
  void,
  NotificationError,
  { id: string; wasUnread?: boolean },
  { snapshot: [readonly unknown[], unknown][]; previousCount: number | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toNotificationError('delete', blocked);
      const res = await deleteNotification(id);
      if (!res.ok) throw toNotificationError('delete', res.error);
    },

    onMutate: async ({ id, wasUnread }) => {
      if (offlineWriteBlock()) return { snapshot: [], previousCount: undefined };

      await queryClient.cancelQueries({ queryKey: notificationKeys.all() });
      await queryClient.cancelQueries({ queryKey: notificationKeys.unread() });

      const snapshot = queryClient.getQueriesData({
        queryKey: notificationKeys.lists(),
      }) as [readonly unknown[], unknown][];
      const previousCount = queryClient.getQueryData<number>(notificationKeys.unread());

      queryClient.setQueriesData<NotificationInfinite>({ queryKey: notificationKeys.lists() }, (old) =>
        removeFromPages(old, id),
      );
      if (wasUnread) {
        queryClient.setQueryData<number>(notificationKeys.unread(), (old) =>
          typeof old === 'number' ? Math.max(0, old - 1) : old,
        );
      }

      return { snapshot, previousCount };
    },

    onError: (_error, _vars, context) => {
      if (!context) return;
      context.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context.previousCount !== undefined) {
        queryClient.setQueryData(notificationKeys.unread(), context.previousCount);
      }
      // 롤백이 다른 삭제의 결과까지 되살렸을 수 있다. 여기서만 목록을 서버 값으로 정정한다.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });
}

/**
 * API-38 전체 삭제 (FR-088).
 * 응답 `data` 가 **스칼라 숫자**(삭제 건수)다. 목록은 통째로 비워지므로 낙관적 조작 없이
 * 성공 후 무효화한다 — 되돌릴 수 없는 액션이라 낙관적 표시의 이득이 없다.
 */
export function useDeleteAllNotifications(): UseMutationResult<number, NotificationError, void> {
  const queryClient = useQueryClient();

  return useMutation<number, NotificationError, void>({
    mutationFn: async () => {
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toNotificationError('deleteAll', blocked);
      const res = await deleteAllNotifications();
      if (!res.ok) throw toNotificationError('deleteAll', res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.setQueryData<number>(notificationKeys.unread(), 0);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all() });
      void queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });
}
