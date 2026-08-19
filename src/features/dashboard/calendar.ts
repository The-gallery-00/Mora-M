/**
 * 캘린더 계층 — 월간 그리드(SCR-07 · FR-084) + 구글 캘린더 연동(SCR-25 · FR-095/096).
 *
 * 정본: wiki/design/Screen Specs.md SCR-07 · SCR-25
 *       wiki/product/Requirements.md FR-084 · FR-095 · FR-096
 *       원본 서버: backend/controller/GoogleCalendarController.java
 *                  backend/service/GoogleCalendarService.java
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  결론 먼저 — **이 서버에서 확인된 두 가지 불가 사실**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ① `GET /api/google-calendar/month` 는 **껍데기다. 항상 빈 배열을 돌려준다.**
 *
 *    `GoogleCalendarService.getMonth()` 전문:
 *        return GoogleCalendarMonthResponse.builder()
 *                .userId(userId).year(year).month(month)
 *                .connected(tokenRepository.existsByUserId(userId))
 *                .events(List.of())          ← 하드코딩된 빈 리스트
 *                .build();
 *    구글 API 를 호출하는 코드가 함수 안에 아예 없다. 실측도 일치한다:
 *        GET /api/google-calendar/month?userId=…&year=2026&month=7
 *        → {"success":true,"data":{…,"connected":false,"events":[]}}
 *
 *    → **월간 캘린더를 이 엔드포인트로 그릴 수 없다.** SCR-07 데이터 표가 지정한 대로
 *      `GET /api/tickets` + `GET /api/posters`(각 `page=0&size=100`)에서 앱이 직접 조립한다.
 *      이 파일의 `toCalendarEvents()` / `buildEventIndex()` 가 그 조립기다.
 *      서버 엔드포인트용 어댑터(`fetchGoogleCalendarMonth`)도 남겨 두지만 **화면에서 쓰지 마라.**
 *      서버가 나중에 구현하면 그때 교체하라는 뜻의 자리표시자다.
 *
 * ② **연동 OAuth 콜백이 앱으로 착지하지 못한다 (기본 설정에서).**
 *
 *    `GoogleCalendarController.callback()` 은 JSON 이 아니라 **302** 를 준다:
 *        settingsRedirectUri(status, message)
 *          = {app.frontend-url}/dashboard/settings?calendar={connected|failed}&message=…
 *    `app.frontend-url` 기본값은 `application.yml` 에서 **`http://localhost:3000`** 이다.
 *    즉 브라우저는 웹 대시보드로 가고 앱에는 아무것도 오지 않는다. 앱이 착지 주소를 바꿀 수단은
 *    없다 — 화이트리스트도, `?redirect=` 파라미터도, `state` 에 실어 보낼 통로도 없다.
 *
 *    게다가 이 서버는 **연동 시작 자체가 막혀 있다.** 실측:
 *        GET /api/google-calendar/connect-url  → HTTP 400
 *    `validateCalendarConfig()` 가 `app.calendar.google.client-id/client-secret` 공백을 거부한다.
 *    (`application.yml`: `${GOOGLE_CALENDAR_CLIENT_ID:}` — 기본값이 빈 문자열이다.)
 *    추가로 `redirect-uri` 기본값이 `http://localhost:8080/api/google-calendar/callback` 이라,
 *    구글 콘솔에 LAN IP 로 등록돼 있지 않으면 폰에서 왕복이 성립하지 않는다.
 *
 *    → **결정: 되는 척 만들지 않는다.** `isCalendarConnectEnabled()` 가 거짓이면
 *      `startCalendarConnect()` 는 브라우저를 열지 않고 `{ status: 'unavailable' }` 을 돌려주고,
 *      화면은 `CALENDAR_COPY.unavailable`(`이 기기에서는 준비 중입니다.`)를 띄운다.
 *      `features/auth/oauth.ts` 가 소셜 로그인에 대해 내린 것과 **같은 결정, 같은 모양**이다.
 *
 *    동작시키려면 서버 쪽에서 3가지가 동시에 필요하다(앱만으로는 불가):
 *      1. `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` 설정
 *      2. `GOOGLE_CALENDAR_REDIRECT_URI` 를 구글 콘솔에 등록된 실제 도달 가능 주소로
 *      3. `FRONTEND_URL=mora://auth` 로 기동 (⚠ 소셜 로그인 착지와 **같은 값을 공유**한다.
 *         웹 프론트와 동시 운용이 불가능해진다 — 이건 서버 설계의 제약이지 앱의 선택이 아니다)
 *    그리고 앱 빌드에 `EXPO_PUBLIC_CALENDAR_DEEPLINK=1` 을 넣어야 게이트가 열린다.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 그 밖의 서버 사실
 *  - `connected/{userId}` · `tokens/{userId}` · `month` 는 **인증 검사가 전혀 없다.** userId(UUID)만
 *    알면 남의 상태를 조회·해제할 수 있다 (SCR-25 보안 경고 · Risks 등재). 앱은 자기 id 만 넘긴다.
 *  - 실패는 전부 **400** 이다(`badRequest`). 연동 정보가 없을 때의 `tokens` 조회·해제도 400 이다.
 *    `/auth/me` 400 만 세션 만료로 보는 규칙(Offline and State §9)과 충돌하지 않는다.
 *  - `connect-url` 은 `Authorization` 헤더의 userId 를 우선 쓴다 → 쿼리 파라미터가 필요 없다.
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { oauthRedirectUri } from '@/features/auth/oauth';
import type { DocumentDetail, PosterDetail, TicketDetail } from '@/features/documents/types';
import { request, type ApiResult } from '@/services/http';

import { toLocalDateString } from './api';

// ═══════════════════════════════════════════════════════ 1. 월간 캘린더 그리드
//
// 달력 라이브러리가 없다(설치 금지). 월에 필요한 4~6주 그리드를 직접 만든다.
// `Date` 산술만 쓰고 타임존 변환을 하지 않는다 — 모든 날짜는 **기기 로컬 자정** 기준이다.

/** 요일 헤더 라벨. 일요일 시작 고정 (SCR-07 와이어프레임). */
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 캘린더 셀 1칸. */
export type CalendarDay = {
  /** `YYYY-MM-DD`. 이벤트 인덱스의 키와 같다. */
  date: string;
  /** 1~31. */
  day: number;
  /** 이번 달인가. 아니면 흐린 톤으로 그린다(색은 화면 담당이 tailwind 토큰으로 정한다). */
  inMonth: boolean;
  isToday: boolean;
  /** 0=일 … 6=토. 일요일/토요일 색 분기에 쓴다. */
  weekday: number;
};

/** 한 달치 그리드. `weeks` 는 해당 월에 필요한 4~6주로 구성된다. */
export type CalendarMonth = {
  year: number;
  /** 1~12 (JS `Date` 의 0-based 가 아니다 — 서버 파라미터와 같은 어휘). */
  month: number;
  /** `2026년 7월`. 헤더에 그대로 쓴다. */
  label: string;
  weeks: CalendarDay[][];
};

/** 월 라벨 문구. SCR-06 `2026년 7월 >` · SCR-07 헤더가 공유한다. */
export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

/** 월 이동. 12월 +1 → 다음 해 1월처럼 경계를 넘긴다. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  // 1~12 를 0~11 로 내려 계산한 뒤 되돌린다. 음수 나머지를 피하려고 floor 를 쓴다.
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/**
 * 해당 월에 필요한 4~6주의 월간 그리드를 만든다.
 *
 * 시작 칸 = 1일이 속한 주의 **일요일**. 마지막 칸 = 말일이 속한 주의 **토요일**.
 * 이 범위를 채우는 데 필요한 앞뒤 달 날짜만 포함하고 `inMonth: false` 로 구분한다.
 */
export function buildMonthMatrix(year: number, month: number, today: Date = new Date()): CalendarMonth {
  const todayKey = toLocalDateString(today);
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const daysInMonth = new Date(year, month, 0).getDate();
  const weekCount = Math.ceil((first.getDay() + daysInMonth) / 7);

  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < weekCount; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const date = toLocalDateString(cursor);
      week.push({
        date,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month - 1 && cursor.getFullYear() === year,
        isToday: date === todayKey,
        weekday: cursor.getDay(),
      });
    }
    weeks.push(week);
  }

  return { year, month, label: monthLabel(year, month), weeks };
}

/**
 * 홈(SCR-06)의 "이번 주 7일 스트립". 기준일이 속한 주(일~토) 7칸.
 * 월간 그리드와 셀 타입을 공유해 화면이 렌더러를 한 벌만 갖는다.
 */
export function buildWeekStrip(anchor: Date, today: Date = new Date()): CalendarDay[] {
  const todayKey = toLocalDateString(today);
  const sunday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());

  return Array.from({ length: 7 }, (_, i) => {
    const cursor = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
    const date = toLocalDateString(cursor);
    return {
      date,
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === anchor.getMonth(),
      isToday: date === todayKey,
      weekday: cursor.getDay(),
    };
  });
}

// ═══════════════════════════════════════════════════════ 2. 캘린더 이벤트 조립
//
// 서버 month 엔드포인트가 빈 배열만 주므로(위 ① 참조) 티켓·포스터 목록에서 직접 만든다.

export type CalendarEventType = 'TICKET' | 'POSTER';

/** 캘린더에 찍히는 일정 1건. */
export type CalendarEvent = {
  type: CalendarEventType;
  /** 보관함 PK (티켓·포스터 모두 Integer). 상세 시트로 그대로 넘긴다. */
  id: number;
  /** `${type}:${id}` — 혼합 리스트 키. */
  key: string;
  /** 티켓 = `출발지 → 도착지`, 포스터 = `title`. */
  title: string;
  /** 티켓 = `transportType`, 포스터 = `organizerName`. 없으면 빈 문자열. */
  subtitle: string;
  /** `YYYY-MM-DD`. 티켓은 출발일, 포스터는 시작일. */
  startDate: string;
  /** `YYYY-MM-DD`. 티켓은 출발일과 같고, 포스터는 종료일(없으면 시작일). */
  endDate: string;
  /** `HH:MM`. 포스터는 항상 빈 문자열. */
  time: string;
  /** 포스터 원본에 시작일과 종료일이 모두 있었는지. 홈의 진행 중 판정에서만 사용한다. */
  hasCompletePosterDateRange?: boolean;
  /** 티켓 도착일·시각. 진행 중 티켓 판정에만 사용한다. */
  arrivalDate?: string;
  arrivalTime?: string;
};

/**
 * 티켓 라벨. **`→`(U+2192) 를 쓴다.**
 * 서버(`DashboardService.buildTicketTitle`)와 원본 웹은 ASCII `->` 였고,
 * SCR-07 "가공 로직" 주석이 모바일은 `→` 로 통일한다고 못박았다.
 */
export function ticketRouteLabel(ticket: TicketDetail): string {
  const from = ticket.departureLocation || '출발지';
  const to = ticket.arrivalLocation || '도착지';
  return `${from} → ${to}`;
}

function ticketEvent(ticket: TicketDetail): CalendarEvent | null {
  if (!ticket.departureDate) return null;
  return {
    type: 'TICKET',
    id: ticket.id,
    key: `TICKET:${ticket.id}`,
    title: ticketRouteLabel(ticket),
    subtitle: ticket.transportType,
    startDate: ticket.departureDate,
    endDate: ticket.departureDate,
    time: ticket.departureTime,
    arrivalDate: ticket.arrivalDate,
    arrivalTime: ticket.arrivalTime,
  };
}

function posterEvent(poster: PosterDetail): CalendarEvent | null {
  // 서버 `findDeadlines` 와 같은 판정: 종료일이 없으면 시작일이 곧 마감일이다.
  const start = poster.eventStartDate || poster.eventEndDate;
  if (!start) return null;
  const end = poster.eventEndDate || start;
  return {
    type: 'POSTER',
    id: poster.id,
    key: `POSTER:${poster.id}`,
    title: poster.title || '행사',
    subtitle: poster.organizerName,
    // 서버가 시작>종료로 저장된 데이터를 막지 않으므로 앱이 정렬해 둔다.
    startDate: start <= end ? start : end,
    endDate: start <= end ? end : start,
    time: '',
    hasCompletePosterDateRange: Boolean(poster.eventStartDate && poster.eventEndDate),
  };
}

/**
 * 보관함 상세 모델 목록 → 캘린더 이벤트.
 * 명함·영수증은 날짜 축이 없어 조용히 걸러진다. **id 중복도 제거한다** —
 * SCR-07 가공 로직 주석: "원본에 실제 중복이 있었다".
 */
export function toCalendarEvents(documents: readonly DocumentDetail[]): CalendarEvent[] {
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  for (const doc of documents) {
    const event = doc.type === 'TICKET' ? ticketEvent(doc) : doc.type === 'POSTER' ? posterEvent(doc) : null;
    if (!event || seen.has(event.key)) continue;
    seen.add(event.key);
    events.push(event);
  }

  // 날짜 → 시각 → 제목. 시각 없는 포스터가 같은 날 티켓보다 뒤로 가도록 빈 문자열을 뒤로 민다.
  events.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.title.localeCompare(b.title, 'ko');
  });

  return events;
}

/** 포스터 기간이 비정상적으로 길어도 루프가 폭주하지 않게 하는 상한(1년). */
const MAX_EVENT_SPAN_DAYS = 366;

/**
 * `YYYY-MM-DD` → 그 날의 이벤트 배열.
 *
 * 포스터는 **기간 이벤트**라 시작~종료 사이 모든 날짜에 같은 이벤트가 들어간다
 * (SCR-07: 셀 하단 dot 으로 표시). 티켓은 하루짜리다.
 * 반환 객체는 `Object.create(null)` 이 아니라 일반 객체이므로 조회할 때 `?? []` 로 받아라 —
 * `noUncheckedIndexedAccess` 가 켜져 있어 타입이 이미 강제한다.
 */
export function buildEventIndex(events: readonly CalendarEvent[]): Record<string, CalendarEvent[]> {
  const index: Record<string, CalendarEvent[]> = {};

  for (const event of events) {
    const [sy, sm, sd] = event.startDate.split('-').map(Number);
    if (sy === undefined || sm === undefined || sd === undefined || Number.isNaN(sy)) continue;

    const cursor = new Date(sy, sm - 1, sd);
    for (let i = 0; i < MAX_EVENT_SPAN_DAYS; i += 1) {
      const key = toLocalDateString(cursor);
      (index[key] ??= []).push(event);
      if (key >= event.endDate) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return index;
}

/** 해당 월(1~12)에 하루라도 걸치는 이벤트만. 월 전환 시 리스트를 좁히는 용도. */
export function eventsInMonth(
  events: readonly CalendarEvent[],
  year: number,
  month: number,
): CalendarEvent[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = `${prefix}-01`;
  const monthEnd = `${prefix}-31`;
  // 문자열 비교로 충분하다 — `YYYY-MM-DD` 는 사전순 = 시간순이다.
  return events.filter((event) => event.startDate <= monthEnd && event.endDate >= monthStart);
}

// ═══════════════════════════════════════════════════════ 3. 구글 캘린더 연동 API

const CALENDAR_PATH = '/api/google-calendar';

/** `GET /connected/{userId}` · `DELETE /tokens/{userId}` 공통 응답. */
export type CalendarConnection = {
  userId: string;
  connected: boolean;
};

/** `GET /tokens/{userId}` — **연동돼 있을 때만** 200 이다. 미연동은 400. */
export type CalendarTokenInfo = {
  userId: string;
  /** 연동된 구글 계정 이메일. 서버가 못 받아오면 빈 문자열. */
  googleEmail: string;
  /** 액세스 토큰 만료 시각(ISO). 표시용이며 앱이 갱신에 관여하지 않는다. */
  expiresAt: string;
  scope: string;
  connected: boolean;
};

/** `GET /month` — **항상 `events: []` 다** (위 ① 참조). 자리표시자. */
export type GoogleCalendarMonth = {
  userId: string;
  year: number;
  month: number;
  connected: boolean;
  /** 서버가 채우지 않는다. 형태를 모르므로 `unknown[]` 이다. */
  events: unknown[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const bool = (value: unknown): boolean => value === true;

/** API-27 `GET /api/google-calendar/connected/{userId}` — 설정 화면 토글의 초기 상태. */
export async function fetchCalendarConnection(userId: string): Promise<ApiResult<CalendarConnection>> {
  const res = await request<unknown>(`${CALENDAR_PATH}/connected/${encodeURIComponent(userId)}`);
  if (!res.ok) return res;
  const d = asRecord(res.data);
  return { ok: true, data: { userId: str(d.userId) || userId, connected: bool(d.connected) } };
}

/**
 * API-28 `GET /api/google-calendar/tokens/{userId}` — 연동된 구글 계정 이메일을 보여줄 때만 쓴다.
 * **미연동이면 400 이다**(`구글 캘린더 연동 정보가 없습니다.`). 에러가 아니라 정상 상태이므로
 * 호출부는 실패를 조용히 무시해야 한다 — `useCalendarTokenInfo` 가 `retry:false` 로 감싼다.
 */
export async function fetchCalendarTokenInfo(userId: string): Promise<ApiResult<CalendarTokenInfo>> {
  const res = await request<unknown>(`${CALENDAR_PATH}/tokens/${encodeURIComponent(userId)}`);
  if (!res.ok) return res;
  const d = asRecord(res.data);
  return {
    ok: true,
    data: {
      userId: str(d.userId) || userId,
      googleEmail: str(d.googleEmail),
      expiresAt: str(d.expiresAt),
      scope: str(d.scope),
      connected: bool(d.connected),
    },
  };
}

/**
 * API-25 `GET /api/google-calendar/connect-url` — 구글 인가 URL 취득.
 *
 * **이 서버에서는 400 이 온다** (client-id/secret 미설정 — 실측). 그래서 호출 전에
 * `isCalendarConnectEnabled()` 로 먼저 거른다. `userId` 쿼리는 보내지 않는다 —
 * 컨트롤러가 `Authorization` 헤더를 우선 해석하고, 쿼리로 남의 id 를 넣는 경로를 만들 이유가 없다.
 */
export async function fetchCalendarConnectUrl(): Promise<ApiResult<string>> {
  const res = await request<unknown>(`${CALENDAR_PATH}/connect-url`);
  if (!res.ok) return res;
  const url = str(asRecord(res.data).url);
  if (!url) {
    return {
      ok: false,
      error: { kind: 'parse', status: null, message: CALENDAR_COPY.connectUrlFailed },
    };
  }
  return { ok: true, data: url };
}

/** API-29 `DELETE /api/google-calendar/tokens/{userId}` — 연동 해제. 미연동이면 400. */
export async function disconnectCalendar(userId: string): Promise<ApiResult<CalendarConnection>> {
  const res = await request<unknown>(`${CALENDAR_PATH}/tokens/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) return res;
  const d = asRecord(res.data);
  return { ok: true, data: { userId: str(d.userId) || userId, connected: bool(d.connected) } };
}

/**
 * API-30 `GET /api/google-calendar/month`.
 * **화면에서 쓰지 마라 — `events` 는 항상 비어 있다.** 서버가 구현되면 교체할 자리다.
 */
export async function fetchGoogleCalendarMonth(
  userId: string,
  year: number,
  month: number,
): Promise<ApiResult<GoogleCalendarMonth>> {
  const query = `userId=${encodeURIComponent(userId)}&year=${year}&month=${month}`;
  const res = await request<unknown>(`${CALENDAR_PATH}/month?${query}`);
  if (!res.ok) return res;
  const d = asRecord(res.data);
  return {
    ok: true,
    data: {
      userId: str(d.userId) || userId,
      year: typeof d.year === 'number' ? d.year : year,
      month: typeof d.month === 'number' ? d.month : month,
      connected: bool(d.connected),
      events: Array.isArray(d.events) ? d.events : [],
    },
  };
}

// ═══════════════════════════════════════════════════════ 4. 연동 시작(딥링크 게이트)

/**
 * 서버 `app.frontend-url` 과 **글자 단위로 같아야 하는** 값.
 * 서버가 여기에 `/dashboard/settings?calendar=…&message=…` 를 이어 붙인다.
 * 소셜 로그인(`OAUTH_RETURN_URL`)과 같은 값을 쓸 수밖에 없다 — 서버가 설정 키를 공유하기 때문이다.
 */
export const CALENDAR_RETURN_URL = 'mora://auth';

/** 착지 실패로 영원히 대기하지 않게 하는 상한. 소셜 로그인과 같은 값. */
export const CALENDAR_TIMEOUT_MS = 90_000;

/** SCR-25 원문 문구. 새로 짓지 않는다. */
export const CALENDAR_COPY = {
  rowTitle: 'Google Calendar',
  rowDescription: '추출된 일정을 캘린더로 자동 전송',
  connected: '연동됨',
  disconnected: '미연동',
  connectFailed: '구글 캘린더 연동에 실패했습니다.',
  disconnectFailed: '구글 캘린더 연동 해제에 실패했습니다.',
  connectUrlFailed: '구글 캘린더 연동 URL을 가져오지 못했습니다.',
  disconnected_toast: '연동을 해제했습니다.',
  /**
   * 착지 불가 폴백 (결정 — 위 ② 참조).
   * 소셜 로그인의 `준비 중입니다.` 와 같은 계열의 문구를 쓴다.
   */
  unavailable: '이 기기에서는 준비 중입니다.',
  loadFailed: '일정을 불러오지 못했습니다.',
} as const;

const APP_SCHEME = 'mora';

/**
 * 구글 캘린더 연동을 **이 빌드/기기에서 실제로 완주할 수 있는가.**
 *
 * 두 조건을 모두 만족해야 한다:
 *  1. `EXPO_PUBLIC_CALENDAR_DEEPLINK=1` — 서버가 `FRONTEND_URL=mora://auth` 로 떠 있고
 *     구글 콘솔에 redirect-uri 가 등록돼 있다는 **사람의 선언**. 앱이 자동 판별할 방법이 없다
 *     (서버 설정을 조회하는 API 가 없다).
 *  2. 이 런타임에서 커스텀 스킴이 성립한다 — Expo Go 면 `exp://…` 라 서버 착지 주소와
 *     절대 일치할 수 없다. `oauthRedirectUri` 를 재사용해 판정한다.
 *
 * 거짓이면 UI 는 토글을 **비활성**으로 두고 `CALENDAR_COPY.unavailable` 을 안내한다.
 */
export function isCalendarConnectEnabled(): boolean {
  const flag = (process.env.EXPO_PUBLIC_CALENDAR_DEEPLINK ?? '').trim();
  return flag === '1' && oauthRedirectUri.startsWith(`${APP_SCHEME}://`);
}

export type CalendarConnectOutcome =
  /** 서버가 `calendar=connected` 로 착지시켰다. 성공 여부의 정본은 아니므로 곧바로 재조회한다. */
  | { status: 'success'; message: string }
  /** 사용자가 브라우저를 닫았다. 토스트 없이 조용히 복귀한다. */
  | { status: 'canceled' }
  /** 딥링크 착지가 성립하지 않는 환경 → `이 기기에서는 준비 중입니다.` */
  | { status: 'unavailable' }
  /** 착지는 했는데 `calendar=failed` 이거나, URL 을 얻지 못했거나, 시간이 초과됐다. */
  | { status: 'failed'; reason: 'no-url' | 'denied' | 'timeout' | 'error'; message: string };

function firstParam(params: Linking.QueryParams | null, key: string): string {
  const raw = params?.[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

/**
 * 콜백 딥링크에서 결과를 뽑는다.
 * 서버는 성공/실패 모두 302 이고 **`calendar` 쿼리 파라미터로만 구분**된다
 * (`settingsRedirectUri("connected"|"failed", message)`).
 * `message` 는 서버가 만든 한국어/영어 혼재 문자열이라 **UI 에 그대로 쓰지 않는다** —
 * 로그·디버깅용으로만 통과시킨다 (API Contract §4-5).
 */
export function parseCalendarDeepLink(
  url: string,
): { status: 'connected' | 'failed'; message: string } | null {
  let parsed: Linking.ParsedURL;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  const status = firstParam(parsed.queryParams, 'calendar');
  if (status !== 'connected' && status !== 'failed') return null;
  return { status, message: firstParam(parsed.queryParams, 'message') };
}

/** 이 딥링크가 캘린더 연동 복귀인가 (루트 딥링크 라우터 판정용). */
export function isCalendarDeepLink(url: string): boolean {
  return parseCalendarDeepLink(url) !== null;
}

/**
 * FR-095 — 연동 URL 취득 → 인앱 브라우저 → 딥링크 복귀.
 *
 * 성공 판정을 딥링크에만 맡기지 않는다. 서버가 `calendar=connected` 를 줘도 **정본은 DB** 이므로
 * 호출부(`useConnectCalendar`)가 곧바로 `fetchCalendarConnection` 으로 재확인한다.
 */
export async function startCalendarConnect(): Promise<CalendarConnectOutcome> {
  if (!isCalendarConnectEnabled()) return { status: 'unavailable' };

  const urlResult = await fetchCalendarConnectUrl();
  if (!urlResult.ok) {
    // 이 서버에서 실제로 오는 경로다(400 — client-id/secret 미설정).
    return { status: 'failed', reason: 'no-url', message: CALENDAR_COPY.connectUrlFailed };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = WebBrowser.openAuthSessionAsync(urlResult.data, CALENDAR_RETURN_URL, {
      showInRecents: false,
      preferEphemeralSession: false, // 구글 로그인 세션을 재사용해 재입력을 줄인다.
    });

    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CALENDAR_TIMEOUT_MS);
    });

    const result = await Promise.race([session, timeout]);

    if (result === 'timeout') {
      WebBrowser.dismissAuthSession();
      return { status: 'failed', reason: 'timeout', message: CALENDAR_COPY.connectFailed };
    }
    if (result.type !== 'success') return { status: 'canceled' };

    const parsed = parseCalendarDeepLink(result.url);
    WebBrowser.dismissAuthSession();

    if (!parsed) {
      return { status: 'failed', reason: 'error', message: CALENDAR_COPY.connectFailed };
    }
    if (parsed.status === 'failed') {
      return { status: 'failed', reason: 'denied', message: CALENDAR_COPY.connectFailed };
    }
    return { status: 'success', message: parsed.message };
  } catch {
    return { status: 'failed', reason: 'error', message: CALENDAR_COPY.connectFailed };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
