/**
 * 알림 네트워크 계층 (API-32 ~ API-38 · FR-085~088).
 *
 * 정본: wiki/design/Screen Specs.md SCR-08
 *       wiki/product/Requirements.md FR-085 · FR-086 · FR-087 · FR-088
 *       원본 서버: backend/controller/NotificationController.java
 *                  backend/service/NotificationService.java
 *                  backend/service/DeadlineNotificationService.java
 *                  backend/dto/notification/NotificationResponse.java
 *
 * ────────────────── 실측 (2026-07-28, 192.168.0.2:8080, test1@mora.dev) ──────────────────
 *
 *   GET /api/notifications?page=0&size=5
 *   {"success":true,"data":{
 *      "content":[{"id":"7ab7f322-…","type":"DEADLINE","title":"일정 임박",
 *                  "message":"서울 -> 부산 일정이 3일 남았습니다입니다.",
 *                  "linkUrl":"/dashboard/storage/tickets","read":false,"readAt":null,
 *                  "createdAt":"2026-07-28T10:51:57.846162"}],
 *      "pageable":{…},"last":true,"totalElements":1,"totalPages":1,"size":5,"number":0,
 *      "first":true,"numberOfElements":1,"empty":false}}
 *
 *   GET  /api/notifications/unread-count → data = {"count":0}       ← Map, 스칼라가 아니다
 *   PATCH /api/notifications/read-all    → data = {"updatedCount":1} ← Map
 *   DELETE /api/notifications/{id}       → {"success":true}          ← data 키 자체가 없다
 *
 * 확인된 사실 5가지
 *  1. **Page 는 평면이다.** `data.content` / `data.last` / `data.number` / `data.totalElements`.
 *     무한 스크롤 종료 판정은 `last` 플래그만 본다 (totalPages 계산은 서버가 값을 빠뜨리면 무한 루프).
 *  2. `id` 는 **UUID 문자열**이다. 문서 4종처럼 Integer 인 것이 아니다.
 *  3. `createdAt` 은 **ISO 문자열**이다 (`"2026-07-28T10:51:57.846162"`). 숫자 배열이 아니다.
 *     소수점 이하 6자리 마이크로초가 붙는다 — `new Date()` 가 그대로 파싱한다.
 *  4. `read` 는 **파생 필드**다. `NotificationResponse.from()` 이 `readAt != null` 로 계산한다.
 *     즉 `read: true` 인데 `readAt: null` 인 조합은 서버가 만들지 않는다.
 *  5. `size` 상한은 **50** 이다 (`NotificationService.MAX_PAGE_SIZE`). 넘겨도 에러가 아니라
 *     조용히 50 으로 깎인다 — `Math.min(Math.max(size,1), 50)`.
 *
 * ────────────────────────── ⚠ 서버 문구 결함 (우회 필수) ──────────────────────────
 *
 * `DeadlineNotificationService` 가 만드는 알림 본문이 깨져 있다:
 *
 *     private String formatDDay(long dDay) {
 *         if (dDay == 0) return "오늘";
 *         return dDay + "일 남았습니다";          // ← 이미 종결어미가 붙어 있는데
 *     }
 *     return title + " 마감이 " + formatDDay(dDay) + "입니다.";   // ← 또 붙인다
 *
 * 결과: `"AI 해커톤 2026 마감이 3일 남았습니다입니다."` 가 **DB 에 그대로 저장된다.**
 * (`dDay == 0` 인 날은 `"… 마감이 오늘입니다."` 로 멀쩡하다. 깨지는 것은 1일 이상일 때뿐이다.)
 *
 * 결정(SCR-08 모바일 변경점 3): **백엔드를 고치지 않고 앱이 표시 직전에 정규화한다.**
 * 규칙은 `normalizeNotificationMessage()` 한 곳에만 둔다. 화면이 `message` 를 날것으로
 * 읽는 코드는 리뷰 반려 대상이다 — `toNotification()` 이 이미 정규화한 값을 담아 준다.
 */

import { request, type ApiResult } from '@/services/http';

// ───────────────────────────────────────────────────────────── 어휘

/**
 * 알림 종류. 서버는 자유 문자열이지만 실제로 생성되는 값은 3종이다
 * (`DeadlineNotificationService` 가 `DEADLINE`/`SCHEDULE`, 수동 생성 기본값이 `GENERAL`).
 * 모르는 값은 `GENERAL` 로 떨어뜨린다 — 아이콘이 없어 행이 깨지는 것보다 낫다.
 */
export const NOTIFICATION_TYPES = ['DEADLINE', 'SCHEDULE', 'GENERAL'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

function toNotificationType(raw: unknown): NotificationType {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  return value === 'DEADLINE' || value === 'SCHEDULE' ? value : 'GENERAL';
}

// ───────────────────────────────────────────────────────────── 앱 모델

export type Notification = {
  /** UUID. */
  id: string;
  type: NotificationType;
  title: string;
  /** **정규화를 마친** 본문. 서버 원본이 필요하면 `rawMessage` 를 봐라. */
  message: string;
  /** 서버가 저장한 그대로. 디버깅·버그 재현용이며 화면에 쓰지 않는다. */
  rawMessage: string;
  /** 서버가 저장한 웹 경로. 앱 라우트로 쓰려면 `toAppRoute()` 를 통과시켜야 한다. */
  linkUrl: string;
  read: boolean;
  /** ISO 문자열. 안 읽었으면 빈 문자열. */
  readAt: string;
  /** ISO 문자열. 상대시각 계산의 기준. */
  createdAt: string;
};

/** Spring `Page<>` 한 장. documents 계층의 `PageMeta` 와 같은 규약이다. */
export type NotificationPage = {
  items: Notification[];
  number: number;
  size: number;
  totalElements: number;
  /** 무한 스크롤 종료 판정. **이 플래그만 본다.** */
  last: boolean;
};

// ───────────────────────────────────────────────────── 서버 문구 정규화

/**
 * 서버가 저장한 `남았습니다입니다` 를 `남았습니다` 로 되돌린다.
 *
 * 위키(SCR-08)가 확정한 규칙은 문장 끝 고정이다:
 *     message.replace(/남았습니다입니다\.$/, '남았습니다.')
 * 여기서는 그 규칙의 **초집합**을 쓴다 — 마침표가 없는 변형(`…남았습니다입니다`)과, 서버가
 * 나중에 문장을 이어 붙였을 때(`…남았습니다입니다. 확인해 주세요.`)도 잡기 위해서다.
 * 두 규칙은 위키가 명시한 케이스에서 **글자 단위로 같은 결과**를 낸다.
 *
 * 멱등이다 — 이미 고쳐진 문자열에 다시 적용해도 변하지 않는다(캐시된 값에 두 번 적용되는
 * 경로가 실제로 생긴다: 낙관적 갱신 후 서버 응답으로 덮어쓸 때).
 */
export function normalizeNotificationMessage(message: string): string {
  return message.replace(/남았습니다입니다/g, '남았습니다');
}

// ───────────────────────────────────────────────────── linkUrl → 앱 라우트

/**
 * 서버가 저장한 `linkUrl` 은 **웹 경로**다 (`/dashboard/storage/tickets`).
 * 앱에는 그런 라우트가 없으므로 매핑한다 (SCR-08 모바일 변경점 2 의 표 그대로).
 *
 * | 서버 저장값                     | 앱 라우트                    |
 * |---------------------------------|------------------------------|
 * | `/dashboard/storage/posters`    | `/(tabs)/archive/posters`    |
 * | `/dashboard/storage/tickets`    | `/(tabs)/archive/tickets`    |
 * | 그 외 / 없음                    | `/(tabs)`                    |
 *
 * `sourceType`+`sourceId` 로 문서 상세까지 바로 열 수 있으면 좋겠지만 **그 두 필드는
 * `NotificationResponse` 에 없다**(엔티티에만 있고 DTO 가 노출하지 않는다). 그래서 목록까지만
 * 보낸다 — 위키가 "`linkUrl` 문자열을 파싱해 라우트 매핑한다"고 못박은 이유다.
 */
export function toAppRoute(linkUrl: string): string {
  if (linkUrl.includes('/storage/posters')) return '/(tabs)/archive/posters';
  if (linkUrl.includes('/storage/tickets')) return '/(tabs)/archive/tickets';
  return '/(tabs)';
}

// ───────────────────────────────────────────────────────────── 상대시각

const MINUTE_MS = 60_000;

/**
 * SCR-08 상대시각 포맷 (결정 원문):
 *   `< 1분` → `방금 전` / `< 60분` → `N분 전` / 오늘 → `오늘` / 어제 → `어제` / 그 외 → `M월 D일`
 *
 * "오늘/어제" 는 경과 시간이 아니라 **달력 날짜**로 판정한다. 어제 23:50 은 12시간 전이지만
 * `어제` 로 읽혀야 한다. `Date` 비교는 기기 로컬 타임존 기준이고, 서버가 준 ISO 문자열에
 * 타임존 표기가 없어(`LocalDateTime`) JS 가 로컬로 해석한다 — 서버와 앱이 같은 타임존일 때만
 * 정확하다. LAN 개발/국내 서비스 전제이므로 허용한다.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return '';

  const diffMs = now.getTime() - created.getTime();
  if (diffMs < MINUTE_MS) return '방금 전';
  if (diffMs < 60 * MINUTE_MS) return `${Math.floor(diffMs / MINUTE_MS)}분 전`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(created)) / 86_400_000);
  if (dayDiff <= 0) return '오늘';
  if (dayDiff === 1) return '어제';

  return `${created.getMonth() + 1}월 ${created.getDate()}일`;
}

// ───────────────────────────────────────────────────────────── 어댑터

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

/**
 * 서버 `NotificationResponse` → 앱 모델.
 * `id` 가 없으면 `null` 을 돌려 목록에서 제외한다 — 키 없는 행은 FlashList 를 깨뜨린다.
 */
export function toNotification(raw: unknown): Notification | null {
  const d = asRecord(raw);
  const id = str(d.id);
  if (!id) return null;

  const rawMessage = str(d.message);
  const readAt = str(d.readAt);

  return {
    id,
    type: toNotificationType(d.type),
    title: str(d.title),
    message: normalizeNotificationMessage(rawMessage),
    rawMessage,
    linkUrl: str(d.linkUrl),
    // `read` 를 신뢰하되, 빠져 있으면 `readAt` 존재로 되살린다(서버 파생 규칙과 동일).
    read: typeof d.read === 'boolean' ? d.read : readAt !== '',
    readAt,
    createdAt: str(d.createdAt),
  };
}

/** 평면 Page 를 앱 모델로. `last` 가 없으면 "받아온 수 < 요청한 수" 로 폴백한다. */
export function toNotificationPage(
  data: unknown,
  requested: { page: number; size: number },
): NotificationPage {
  const d = asRecord(data);
  const items = (Array.isArray(d.content) ? d.content : [])
    .map(toNotification)
    .filter((item): item is Notification => item !== null);

  return {
    items,
    number: int(d.number, requested.page),
    size: int(d.size, requested.size),
    totalElements: int(d.totalElements, items.length),
    last: typeof d.last === 'boolean' ? d.last : items.length < requested.size,
  };
}

// ───────────────────────────────────────────────────────────── 상수

const NOTIFICATION_PATH = '/api/notifications';

/** SCR-08 데이터 표: `size=20`. 서버 상한 50 을 넘기지 않는다. */
export const NOTIFICATION_PAGE_SIZE = 20;

/** `NotificationService.MAX_PAGE_SIZE`. 넘기면 조용히 깎인다. */
export const NOTIFICATION_MAX_PAGE_SIZE = 50;

const itemPath = (id: string): string => `${NOTIFICATION_PATH}/${encodeURIComponent(id)}`;

// ───────────────────────────────────────────────────────────── 요청

/**
 * API-32 `GET /api/notifications` — 목록 (FR-085).
 * 서버 기본 `size=10` 과 다르므로 **항상 명시 전송**한다(프로젝트 규약).
 * 정렬은 서버가 `createdAt DESC` 로 고정한다 — 정렬 파라미터가 없다.
 */
export async function listNotifications(params: {
  page: number;
  size?: number;
}): Promise<ApiResult<NotificationPage>> {
  const size = Math.min(params.size ?? NOTIFICATION_PAGE_SIZE, NOTIFICATION_MAX_PAGE_SIZE);
  const res = await request<unknown>(`${NOTIFICATION_PATH}?page=${params.page}&size=${size}`);
  if (!res.ok) return res;
  return { ok: true, data: toNotificationPage(res.data, { page: params.page, size }) };
}

/**
 * API-33 `GET /api/notifications/unread-count` — 미읽음 배지 (FR-086).
 * 응답이 `Map<String,Long>` 이라 **`data.count` 로 뜯는다**. 스칼라가 아니다.
 */
export async function fetchUnreadCount(): Promise<ApiResult<number>> {
  const res = await request<unknown>(`${NOTIFICATION_PATH}/unread-count`);
  if (!res.ok) return res;
  return { ok: true, data: int(asRecord(res.data).count, 0) };
}

/**
 * API-35 `PATCH /api/notifications/{id}/read` — 단건 읽음 (FR-087).
 * 이미 읽은 알림에 다시 보내도 서버가 `readAt` 을 덮어쓰지 않는다(`if (readAt == null)`).
 * 없는 id 는 **400** 이다(`Notification not found` — 문서 4종의 500 과 다르다).
 */
export async function markNotificationRead(id: string): Promise<ApiResult<Notification>> {
  const res = await request<unknown>(`${itemPath(id)}/read`, { method: 'PATCH' });
  if (!res.ok) return res;

  const notification = toNotification(res.data);
  return notification
    ? { ok: true, data: notification }
    : { ok: false, error: { kind: 'parse', status: null, message: NOTIFICATION_COPY.readFailed } };
}

/**
 * API-36 `PATCH /api/notifications/read-all` — 전체 읽음 (FR-087).
 * 응답 `data.updatedCount` 를 그대로 토스트 문구에 넣는다
 * (`알림 {n}건을 읽음으로 표시했습니다.`).
 */
export async function markAllNotificationsRead(): Promise<ApiResult<number>> {
  const res = await request<unknown>(`${NOTIFICATION_PATH}/read-all`, { method: 'PATCH' });
  if (!res.ok) return res;
  return { ok: true, data: int(asRecord(res.data).updatedCount, 0) };
}

/**
 * API-37 `DELETE /api/notifications/{id}` — 단건 삭제 (FR-088).
 * 성공 응답은 `{"success":true}` 뿐이다 — `@JsonInclude(NON_NULL)` 이라 `data` 키가 없다(실측).
 */
export async function deleteNotification(id: string): Promise<ApiResult<void>> {
  const res = await request<unknown>(itemPath(id), { method: 'DELETE' });
  if (!res.ok) return res;
  return { ok: true, data: undefined };
}

/**
 * API-38 `DELETE /api/notifications` — 전체 삭제 (FR-088).
 * 응답 `data` 가 **스칼라 숫자**다(삭제 건수). 다른 엔드포인트들이 Map 으로 감싸는 것과 다르다.
 */
export async function deleteAllNotifications(): Promise<ApiResult<number>> {
  const res = await request<unknown>(NOTIFICATION_PATH, { method: 'DELETE' });
  if (!res.ok) return res;
  return { ok: true, data: typeof res.data === 'number' ? res.data : 0 };
}

// ───────────────────────────────────────────────────────────── 문구

/** SCR-08 원문. 새로 짓지 않는다. */
export const NOTIFICATION_COPY = {
  screenTitle: '알림',
  markAllAction: '모두 읽음',
  listFailed: '알림을 불러오지 못했습니다.',
  retry: '다시 시도',
  emptyTitle: '알림이 없습니다',
  emptyCaption: '마감이 다가오면 알려드릴게요.',
  readFailed: '읽음 처리에 실패했습니다.',
  deleteFailed: '삭제에 실패했습니다.',
  refreshFailed: '새로고침에 실패했습니다.',
  typeLabel: {
    DEADLINE: '마감예정 일정',
    SCHEDULE: '진행 중 종료',
    GENERAL: '알림',
  } satisfies Record<NotificationType, string>,
} as const;

/** SCR-08 인터랙션 표 원문: `알림 {n}건을 읽음으로 표시했습니다.` */
export function markAllReadMessage(count: number): string {
  return `알림 ${count}건을 읽음으로 표시했습니다.`;
}
