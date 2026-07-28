/**
 * 알림 데이터 레이어 배럴 (Phase 6).
 *
 * 화면(`app/notifications.tsx`, SCR-06 헤더 벨)은 이 파일만 import 한다:
 *   import { useInfiniteNotifications, useUnreadCount, NOTIFICATION_COPY } from '@/features/notifications';
 *
 * 계층 규약: 화면은 **훅과 앱 모델만** 쓴다. `request()` 를 직접 부르거나 서버 DTO 를 만지는
 * 화면 코드는 리뷰 반려 대상이다. 특히 `message` 는 반드시 `Notification.message`(정규화 완료)를
 * 쓰고 `rawMessage` 를 화면에 노출하지 마라 — 서버가 `남았습니다입니다` 를 저장한다.
 */

// ── 타입 ─────────────────────────────────────────────────────────────
export type { Notification, NotificationPage, NotificationType } from './api';

// ── 상수 · 문구 ──────────────────────────────────────────────────────
export {
  markAllReadMessage,
  NOTIFICATION_COPY,
  NOTIFICATION_MAX_PAGE_SIZE,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_TYPES,
} from './api';

// ── 순수 유틸 (화면이 직접 쓴다) ─────────────────────────────────────
export {
  formatRelativeTime,
  normalizeNotificationMessage,
  toAppRoute,
  toNotification,
  toNotificationPage,
} from './api';

// ── 네트워크 (특수한 화면만. 보통은 훅을 쓴다) ───────────────────────
export {
  deleteAllNotifications,
  deleteNotification,
  fetchUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';

// ── React Query ──────────────────────────────────────────────────────
export type { NotificationOperation } from './queries';
export {
  NotificationError,
  notificationKeys,
  toNotificationError,
  UNREAD_POLL_INTERVAL_MS,
  UNREAD_STALE_TIME_MS,
  useDeleteAllNotifications,
  useDeleteNotification,
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadCount,
} from './queries';
