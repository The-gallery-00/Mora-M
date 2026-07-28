/**
 * 대시보드 · 캘린더 데이터 레이어 배럴 (Phase 6).
 *
 * 화면(`app/(tabs)/index.tsx`, `app/calendar.tsx`, `app/(tabs)/settings/index.tsx`)은
 * 이 파일만 import 한다:
 *   import { useDashboard, useCalendarMonth, useCalendarLink } from '@/features/dashboard';
 *
 * 계층 규약: 화면은 **훅과 앱 모델만** 쓴다. `request()`·`resolveImageUrl()` 을 직접 부르는
 * 화면 코드는 리뷰 반려 대상이다 — 썸네일은 이미 절대 URL 로 변환돼 있다.
 *
 * ⚠ 두 가지를 기억해라 (근거는 `calendar.ts` 상단 주석):
 *   1. 월간 캘린더는 서버가 아니라 **앱이 티켓·포스터에서 조립**한다.
 *      `GET /api/google-calendar/month` 는 항상 빈 배열이다.
 *   2. 구글 캘린더 연동은 기본 설정에서 **콜백이 앱으로 착지하지 못한다.**
 *      `useCalendarLink().available` 이 false 면 토글을 비활성으로 두고
 *      `CALENDAR_COPY.unavailable`(`이 기기에서는 준비 중입니다.`)를 안내해라.
 */

// ── 대시보드 타입 ────────────────────────────────────────────────────
export type {
  Dashboard,
  DashboardDeadline,
  DashboardItemType,
  DashboardParams,
  DashboardSchedule,
} from './api';

// ── 대시보드 네트워크 · 유틸 ─────────────────────────────────────────
export {
  DASHBOARD_ITEM_TYPES,
  DEFAULT_DEADLINE_DAYS,
  fetchDashboard,
  isDashboardItemType,
  toDashboard,
  toDashboardDeadline,
  toDashboardSchedule,
  toLocalDateString,
  todayString,
} from './api';

// ── 캘린더 타입 ──────────────────────────────────────────────────────
export type {
  CalendarConnectOutcome,
  CalendarConnection,
  CalendarDay,
  CalendarEvent,
  CalendarEventType,
  CalendarMonth,
  CalendarTokenInfo,
  GoogleCalendarMonth,
} from './calendar';

// ── 캘린더 순수 유틸 (그리드 · 이벤트 조립) ──────────────────────────
export {
  addMonths,
  buildEventIndex,
  buildMonthMatrix,
  buildWeekStrip,
  eventsInMonth,
  monthLabel,
  ticketRouteLabel,
  toCalendarEvents,
  WEEKDAY_LABELS,
} from './calendar';

// ── 구글 캘린더 연동 ─────────────────────────────────────────────────
export {
  CALENDAR_COPY,
  CALENDAR_RETURN_URL,
  CALENDAR_TIMEOUT_MS,
  disconnectCalendar,
  fetchCalendarConnection,
  fetchCalendarConnectUrl,
  fetchCalendarTokenInfo,
  fetchGoogleCalendarMonth,
  isCalendarConnectEnabled,
  isCalendarDeepLink,
  parseCalendarDeepLink,
  startCalendarConnect,
} from './calendar';

// ── React Query ──────────────────────────────────────────────────────
export type { DashboardOperation, UseCalendarMonthResult, UseDashboardOptions, UseWeekStripResult } from './queries';
export {
  CALENDAR_SOURCE_SIZE,
  CALENDAR_STALE_TIME_MS,
  calendarLinkKeys,
  DASHBOARD_COPY,
  DASHBOARD_STALE_TIME_MS,
  DashboardError,
  dashboardKeys,
  toDashboardError,
  useCalendarConnection,
  useCalendarLink,
  useCalendarMonth,
  useCalendarSource,
  useCalendarTokenInfo,
  useConnectCalendar,
  useDashboard,
  useDisconnectCalendar,
  useWeekStrip,
} from './queries';
