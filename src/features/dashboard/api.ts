/**
 * 홈 대시보드 네트워크 계층 (API-24 · FR-081~083).
 *
 * 정본: wiki/product/Requirements.md FR-081~084
 *       wiki/design/Screen Specs.md SCR-06(홈) · SCR-07(캘린더) · SCR-25(설정 통계)
 *       원본 서버: backend/controller/DashboardController.java + service/DashboardService.java
 *                  + dto/dashboard/{DashboardResponse,DashboardDeadlineResponse,DashboardScheduleResponse}.java
 *
 * ────────────────────── 실측 (2026-07-28, 192.168.0.2:8080, test1@mora.dev) ──────────────────────
 *
 *   GET /api/dashboard
 *   {"success":true,"data":{
 *      "date":"2026-07-28","deadlineDays":30,
 *      "todayScheduleCount":0,"upcomingDeadlineCount":0,"storedDocumentCount":3,
 *      "upcomingDeadlines":[],"todaySchedules":[]}}
 *
 *   GET /api/dashboard?deadlineDays=7&date=2026-07-28  → date/deadlineDays 가 그대로 반영된다.
 *
 * 확인된 사실 5가지 — **위키보다 이 관측이 우선이다.**
 *  1. `data` 는 Page 래핑이 **아니다**. 평면 객체 하나이며 `unwrapList` 를 태우면 안 된다.
 *  2. `date` 는 `LocalDate` 이고 **ISO 문자열** `"2026-07-28"` 로 온다 (숫자 배열 아님).
 *  3. 홈 1화면에 필요한 것이 전부 이 1건에 들어 있다 — 원본 웹의 3콜(카드/티켓/포스터 100건씩)을
 *     대체한다. **홈에서 다른 목록 API 를 추가로 부르지 마라** (FR-081 의 핵심).
 *  4. `deadlineDays` 는 서버 기본 30 이지만 앱은 항상 명시 전송한다(프로젝트 규약).
 *     서버는 `Math.max(0, deadlineDays)` 로만 정규화하고 상한이 없다.
 *  5. **`todaySchedules` 는 `date` 하루치뿐이다.** 주간 스트립(SCR-06)·월간 캘린더(SCR-07)를
 *     이 응답으로 그릴 수 없다. 캘린더는 `calendar.ts` 가 티켓·포스터 목록에서 직접 조립한다.
 *
 * ────────────────────── DTO 의 함정 3가지 (DashboardService 코드 확인) ──────────────────────
 *
 *  A. **`id` 가 항상 문자열이다.** `String.valueOf(ticket.getId())` 라 티켓/포스터의 Integer PK 도
 *     `"12"` 로 온다. 그런데 보관함 계층의 PK 타입은 티켓·포스터가 `IntId`(number) 다
 *     (`features/documents/types.ts`). 그대로 넘기면 `/api/tickets/12` 대신 캐시 키가 갈린다.
 *     → 어댑터가 `documentId: number` 로 되돌려 놓는다.
 *  B. **`imageUrl` 이 `""` 일 수 있다.** `parsedJson` 에서 뽑는데 실패하면 빈 문자열이다.
 *     그리고 상대경로(`/uploads/...`)이므로 **OCR(:8000)** 기준으로 절대화해야 한다 —
 *     Spring(:8080) 은 404 다. `resolveImageUrl` 이 그 일을 한다.
 *  C. **`time` 은 `LocalTime.toString()`** 이라 `"09:00"` 또는 `"09:00:30"` 이고, 값이 없으면 `""` 다.
 *     `normalizeDateTime` 을 태우면 `[9,0]` 같은 배열 표현을 날짜로 오해하므로 쓰지 않는다.
 *
 * 계층 규약(documents/api.ts 와 동일)
 *  1. 이 파일은 **앱 모델**을 돌려준다. 서버 DTO 를 화면까지 흘리지 않는다.
 *  2. 실패는 throw 하지 않고 `ApiResult` 로 돌려준다 — throw 는 `queries.ts` 경계에서 한다.
 */

import { resolveImageUrl } from '@/config/env';
import { request, type ApiResult } from '@/services/http';

// ───────────────────────────────────────────────────────────── 어휘

/**
 * 대시보드가 다루는 문서 종류는 **티켓·포스터 2종뿐**이다.
 * 명함·영수증은 날짜 축이 없어 `DashboardService` 가 애초에 스캔하지 않는다
 * (`buildSchedules`/`buildDeadlines` 는 ticketRepository·posterRepository 만 본다).
 * 보관함의 `DocumentType` 과 값을 일부러 일치시켜 두었다 — 상세 시트로 넘길 때 변환이 없다.
 */
export const DASHBOARD_ITEM_TYPES = ['TICKET', 'POSTER'] as const;
export type DashboardItemType = (typeof DASHBOARD_ITEM_TYPES)[number];

export function isDashboardItemType(value: unknown): value is DashboardItemType {
  return value === 'TICKET' || value === 'POSTER';
}

// ───────────────────────────────────────────────────────────── 앱 모델

/** 마감 임박 카드 1장 (SCR-06 가로 캐러셀 · FR-082). */
export type DashboardDeadline = {
  type: DashboardItemType;
  /** 서버 원본 문자열 id. 로그·키 용도로만 남긴다. */
  rawId: string;
  /** 보관함 PK 로 되돌린 값. 티켓·포스터는 Integer 다. 파싱 실패 시 `null`. */
  documentId: number | null;
  /** 혼합 리스트용 안정 키. `${type}:${rawId}`. */
  key: string;
  title: string;
  /** 티켓 = `transportType`, 포스터 = `organizerName`. 없으면 빈 문자열. */
  subtitle: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** 기준일로부터 남은 일수. 0 이면 오늘 마감(`D-DAY` 라벨). 음수는 서버가 만들지 않는다. */
  dDay: number;
  /** 절대 URL. 없으면 `null` → 화면이 종별 폴백을 그린다. */
  thumbnailUrl: string | null;
};

/** 오늘 일정 1행 (SCR-06 하단 리스트 · FR-083). */
export type DashboardSchedule = {
  type: DashboardItemType;
  rawId: string;
  documentId: number | null;
  key: string;
  title: string;
  /** `HH:MM` 로 잘라 둔 값. 포스터는 항상 빈 문자열이다(서버가 `""` 를 보낸다). */
  time: string;
  /** `YYYY-MM-DD`. */
  date: string;
};

/** `GET /api/dashboard` 1건의 앱 모델. 홈 1화면 전체가 여기에 있다. */
export type Dashboard = {
  /** 서버가 해석한 기준일 `YYYY-MM-DD`. 요청에 `date` 를 안 보내면 서버 today 다. */
  date: string;
  /** 서버가 실제로 적용한 마감 윈도우(일). 요청값과 다를 수 있어 응답값을 정본으로 쓴다. */
  deadlineDays: number;
  /** 통계 타일 `오늘 일정`. */
  todayScheduleCount: number;
  /** 통계 타일 `마감 임박`. */
  upcomingDeadlineCount: number;
  /** 통계 타일 `보관 문서` — 4종 합계. SCR-25 설정 화면도 이 값을 재사용한다. */
  storedDocumentCount: number;
  upcomingDeadlines: DashboardDeadline[];
  todaySchedules: DashboardSchedule[];
};

export type DashboardParams = {
  /** `YYYY-MM-DD`. 생략하면 서버 today. */
  date?: string;
  /** 마감 윈도우(일). 기본 30 (SCR-06 빈 상태 문구 `30일 이내 …` 와 짝을 이룬다). */
  deadlineDays?: number;
};

/** SCR-06 통계 타일 `마감 임박` 부제 `30일 내` 와 문구가 묶여 있다. 함부로 바꾸지 마라. */
export const DEFAULT_DEADLINE_DAYS = 30;

// ───────────────────────────────────────────────────────────── 원시 값 헬퍼

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const int = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

/**
 * `LocalDate` → `YYYY-MM-DD`.
 * 이 서버는 ISO 문자열을 주지만(실측), Jackson 설정이 바뀌면 `[2026,7,28]` 로 돌변할 수 있다.
 * 배열까지 흡수해 두는 비용이 0 에 가까우므로 방어한다.
 */
const normDate = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, 10);
  if (Array.isArray(value) && value.length >= 3) {
    const pad = (n: unknown) => String(typeof n === 'number' ? n : 0).padStart(2, '0');
    return `${int(value[0], 0)}-${pad(value[1])}-${pad(value[2])}`;
  }
  return '';
};

/**
 * `LocalTime` → `HH:MM`.
 * **`normalizeDateTime` 을 쓰지 않는다** — 길이 3 배열 `[9,0,30]` 을 `[년,월,일]` 로 오해한다
 * (documents/mappers.ts 의 `normTime` 과 같은 이유).
 */
const normTime = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
  }
  if (Array.isArray(value) && value.length >= 2) {
    const pad = (n: unknown) => String(typeof n === 'number' ? n : 0).padStart(2, '0');
    return `${pad(value[0])}:${pad(value[1])}`;
  }
  return '';
};

/** 문자열 id 를 보관함 PK(Integer)로 되돌린다. UUID 등 숫자가 아니면 `null`. */
function toDocumentId(rawId: string): number | null {
  if (rawId === '' || !/^\d+$/.test(rawId)) return null;
  const parsed = Number(rawId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 알 수 없는 `type` 은 티켓으로 떨어뜨리지 않고 **항목 자체를 버린다**(잘못된 라우팅 방지). */
function itemBase(raw: unknown): { type: DashboardItemType; rawId: string } | null {
  const d = asRecord(raw);
  const type = str(d.type).toUpperCase();
  if (!isDashboardItemType(type)) return null;
  const rawId = str(d.id);
  if (rawId === '') return null;
  return { type, rawId };
}

// ───────────────────────────────────────────────────────────── 어댑터

export function toDashboardDeadline(raw: unknown): DashboardDeadline | null {
  const base = itemBase(raw);
  if (!base) return null;
  const d = asRecord(raw);

  return {
    type: base.type,
    rawId: base.rawId,
    documentId: toDocumentId(base.rawId),
    key: `${base.type}:${base.rawId}`,
    title: str(d.title),
    subtitle: str(d.subtitle),
    date: normDate(d.date),
    // `dDay` 는 서버가 long 으로 준다. 0 = 오늘(`D-DAY` 라벨 — SCR-06 구성요소 표).
    dDay: int(d.dDay, 0),
    // 빈 문자열이면 `resolveImageUrl` 이 null 을 돌려준다(falsy 가드 내장).
    thumbnailUrl: resolveImageUrl(str(d.imageUrl)),
  };
}

export function toDashboardSchedule(raw: unknown): DashboardSchedule | null {
  const base = itemBase(raw);
  if (!base) return null;
  const d = asRecord(raw);

  return {
    type: base.type,
    rawId: base.rawId,
    documentId: toDocumentId(base.rawId),
    key: `${base.type}:${base.rawId}`,
    title: str(d.title),
    time: normTime(d.time),
    date: normDate(d.date),
  };
}

/** 서버 `DashboardResponse` → 앱 모델. 배열 항목 중 해석 불가한 것은 조용히 버린다. */
export function toDashboard(raw: unknown, requested: DashboardParams): Dashboard {
  const d = asRecord(raw);

  const upcomingDeadlines = (Array.isArray(d.upcomingDeadlines) ? d.upcomingDeadlines : [])
    .map(toDashboardDeadline)
    .filter((item): item is DashboardDeadline => item !== null);

  const todaySchedules = (Array.isArray(d.todaySchedules) ? d.todaySchedules : [])
    .map(toDashboardSchedule)
    .filter((item): item is DashboardSchedule => item !== null);

  return {
    date: normDate(d.date) || (requested.date ?? ''),
    deadlineDays: int(d.deadlineDays, requested.deadlineDays ?? DEFAULT_DEADLINE_DAYS),
    // 카운트는 서버가 준 값을 정본으로 쓴다. 서버가 빠뜨렸을 때만 배열 길이로 폴백한다 —
    // 서버는 `todaySchedules.size()` / `upcomingDeadlines.size()` 를 그대로 넣으므로 항상 일치한다.
    todayScheduleCount: int(d.todayScheduleCount, todaySchedules.length),
    upcomingDeadlineCount: int(d.upcomingDeadlineCount, upcomingDeadlines.length),
    storedDocumentCount: int(d.storedDocumentCount, 0),
    upcomingDeadlines,
    todaySchedules,
  };
}

// ───────────────────────────────────────────────────────────── 요청

type QueryValue = string | number | undefined;

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const qs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/**
 * API-24 `GET /api/dashboard` — 홈 전체를 1회 호출로 받는다 (FR-081).
 *
 * 실패는 500 이다. `DashboardController` 가 `RuntimeException` 을 `internalServerError` 로
 * 내리므로(문서 4종과 같은 패턴) 400 을 세션 만료로 오해하는 분기가 필요 없다.
 * 인증 없으면 401 이고 `http.ts` 가 세션을 정리한다.
 */
export async function fetchDashboard(params: DashboardParams = {}): Promise<ApiResult<Dashboard>> {
  const deadlineDays = params.deadlineDays ?? DEFAULT_DEADLINE_DAYS;
  const path = withQuery('/api/dashboard', {
    ...(params.date ? { date: params.date } : {}),
    deadlineDays,
  });

  const res = await request<unknown>(path);
  if (!res.ok) return res;

  return { ok: true, data: toDashboard(res.data, { ...params, deadlineDays }) };
}

// ───────────────────────────────────────────────────────────── 날짜 유틸

/**
 * 기기 로컬 타임존 기준 `YYYY-MM-DD`.
 *
 * **`toISOString().slice(0,10)` 을 쓰면 안 된다** — UTC 로 바뀌면서 KST 오전 9시 이전이
 * 전날로 밀린다. 서버는 `LocalDate.now()`(서버 로컬)로 판정하므로 앱도 로컬 날짜를 보내야
 * "오늘 일정"이 하루 어긋나지 않는다.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 오늘의 `YYYY-MM-DD` (로컬). */
export function todayString(): string {
  return toLocalDateString(new Date());
}
