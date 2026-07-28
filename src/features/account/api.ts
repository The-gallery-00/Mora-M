/**
 * 계정 · 데이터 · 알림설정 네트워크 계층
 * (API-03~06 · API-39/40 · API-62 · FR-090~094 · FR-089).
 *
 * 정본: wiki/design/Screen Specs.md SCR-25(설정) · SCR-26(프로필) · SCR-27(비밀번호)
 *                                   SCR-28(계정·데이터 삭제) · SCR-29(알림 설정)
 *       원본 서버: backend/controller/AuthController.java + service/AuthService.java
 *                  backend/controller/UserDataController.java + service/UserDataService.java
 *                  backend/controller/NotificationSettingController.java
 *                  backend/security/PasswordChangeRateLimiter.java
 *
 * ────────────────── 실측 (2026-07-28, 192.168.0.2:8080, test1@mora.dev) ──────────────────
 *
 *   GET /auth/me
 *   → {"id":"f070c79e-…","email":"test1@mora.dev","name":"test1","picture":null,
 *      "provider":"local","createdAt":"2026-07-28T05:06:26.192228"}
 *
 *   GET /api/notification-settings
 *   → {"deadlineReminderDays":3,"deadlineReminderEnabled":true,"scheduleReminderEnabled":true,
 *      "createdAt":"2026-07-28T06:29:22.370294","updatedAt":"2026-07-28T06:29:22.370294"}
 *
 *   PATCH /auth/me/password  ×7회 연속 (전부 틀린 현재 비밀번호)
 *   → 1~5회: 400 / 6회부터: **429**            ← 분당 5회 제한이 실제로 동작한다
 *
 * ────────────────────────── 이 파일이 소유하지 않는 것 ──────────────────────────
 *
 * **프로필 조회(API-03)와 닉네임 변경(API-04)은 `features/auth` 가 이미 소유한다.**
 * `fetchMe()` / `changeName()` / `AuthUser` / `nicknameSchema` 가 전부 거기 있고,
 * `authStore.updateName()` 이 SecureStore 스냅샷 갱신까지 책임진다.
 * 여기서 같은 것을 다시 구현하면 **정본이 둘**이 되고 닉네임 규칙이 갈라진다.
 * → 이 파일은 그 둘을 **재수출만** 한다. 새로 만드는 것은 비밀번호 변경·탈퇴·데이터 삭제·알림 설정뿐이다.
 *
 * ────────────────────────── 서버 검증 규칙 (코드로 확인) ──────────────────────────
 *
 * | 대상 | 서버가 실제로 하는 검사 | 근거 |
 * |---|---|---|
 * | 닉네임 | `trim()` 후 **2~20자** + `^[a-zA-Z0-9가-힣_.\-]+$` | `AuthService.changeName` |
 * | 비밀번호 변경 | 소셜 차단 → 현재 비번 일치 → **신규 8자 이상** → 현재와 달라야 함 | `AuthService.changePassword` |
 * | 비밀번호 rate limit | **IP당 분당 5회**, 키 = `IP:토큰뒤8자`. 인메모리 Bucket4j | `AuthController.changePassword` + `resolveClientKey` |
 * | 탈퇴 | 로컬(`provider=local` **그리고** 해시 존재)만 비밀번호 검증. 소셜은 JWT 만으로 삭제 | `AuthService.deleteAccount` |
 * | 알림 설정 일수 | **0~30** 밖이면 400 | `NotificationSettingService.MAX_DEADLINE_REMINDER_DAYS` |
 *
 * ⚠ **`탈퇴` / `전체삭제` 확인 문구는 서버 규칙이 아니다.** 서버는 그런 것을 받지도 검사하지도
 *   않는다(`DeleteAccountRequest` 에는 `password` 필드 하나뿐이다). 파괴적 액션 앞의
 *   **클라이언트 전용 안전장치**이며 SCR-28 이 정한 UX 다. `schema.ts` 가 강제한다.
 */

import { request, type ApiResult } from '@/services/http';

// ═══════════════════════════════════════════ 1. 프로필 (auth 계층 재수출)

export type { AuthProvider, AuthUser } from '@/features/auth/api';
export {
  changeName as changeNickname,
  fetchMe as fetchProfile,
  isSocialAccount,
} from '@/features/auth/api';

// ═══════════════════════════════════════════ 2. 비밀번호 변경 (API-05)

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

/**
 * 비밀번호 변경 실패 사유. 서버 문구는 한/영 혼재라 UI 에 쓰지 않고
 * **상태코드로만 분기**한다 (API Contract §4-5).
 *
 * `rate-limited` 를 별도 사유로 뽑은 이유: SCR-27 이 429 를 다른 실패와 다르게 다루라고 정했다
 * (하단 에러 캡션 + **버튼 60초 disabled**). 400 과 뭉뚱그리면 그 UI 를 만들 수 없다.
 */
export type ChangePasswordFailure = 'rate-limited' | 'rejected' | 'network';

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; failure: ChangePasswordFailure; message: string };

/** SCR-27 원문. 429 문구는 http.ts 의 상태코드 문구와 글자 단위로 같다. */
export const PASSWORD_RATE_LIMIT_MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
export const PASSWORD_CHANGE_FAILED_MESSAGE = '비밀번호 변경에 실패했습니다.';

/** SCR-27: 429 를 받으면 버튼을 이 시간만큼 잠근다. 서버 버킷이 분당 리필이라 60초다. */
export const PASSWORD_RETRY_AFTER_MS = 60_000;

/**
 * API-05 `PATCH /auth/me/password` (FR-092).
 *
 * **rate limit 이 인증보다 먼저 돈다.** `AuthController.changePassword` 는 토큰을 해석하기 전에
 * `passwordChangeRateLimiter.tryConsume()` 을 먼저 호출한다. 즉 429 는 "비밀번호가 틀렸다"와
 * 무관하게 오고, 실패한 시도도 버킷을 소모한다(실측: 틀린 비밀번호 5회 → 6회째 429).
 *
 * 버킷 키가 `IP:토큰뒤8자` 라 **같은 Wi-Fi 의 다른 사람과 카운트를 나눠 쓰지 않는다**(토큰이 다름).
 * 다만 인메모리라 서버를 재시작하면 초기화되고, 인스턴스가 여러 대면 대수만큼 완화된다.
 *
 * 성공 응답은 `{"success":true}` 뿐이다(`ApiResponse.ok(null)` + `@JsonInclude(NON_NULL)`).
 * 반환 타입을 `ApiResult<void>` 가 아니라 전용 유니온으로 둔 것은 429 를 잃지 않기 위해서다.
 */
export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const res = await request<unknown>('/auth/me/password', {
    method: 'PATCH',
    json: { currentPassword: input.currentPassword, newPassword: input.newPassword },
  });

  if (res.ok) return { ok: true };

  if (res.error.status === 429) {
    return { ok: false, failure: 'rate-limited', message: PASSWORD_RATE_LIMIT_MESSAGE };
  }
  // 연결 실패·타임아웃·세션만료는 http.ts 가 만든 정본 문구를 그대로 올린다.
  if (res.error.kind === 'offline' || res.error.kind === 'timeout' || res.error.kind === 'unauthorized') {
    return { ok: false, failure: 'network', message: res.error.message };
  }
  // 400 = 현재 비밀번호 불일치 / 8자 미만 / 현재와 동일 / 소셜 계정.
  // 어느 쪽인지 서버 문구로 구분할 수 없으므로(인코딩 신뢰 불가) 화면은 사전 검증으로 좁힌다.
  return { ok: false, failure: 'rejected', message: PASSWORD_CHANGE_FAILED_MESSAGE };
}

// ═══════════════════════════════════════════ 3. 회원 탈퇴 (API-06)

/**
 * 탈퇴 입력. 계정 종류로 갈린다 (SCR-28 확인 시트 표).
 *  - 로컬: 비밀번호를 **서버가 검증**한다.
 *  - 소셜: 서버는 아무것도 요구하지 않는다. `탈퇴` 문구는 **앱이 만든 안전장치**다.
 */
export type DeleteAccountInput =
  | { kind: 'local'; password: string }
  | { kind: 'social' };

export const DELETE_ACCOUNT_FAILED_MESSAGE = '회원 탈퇴에 실패했습니다.';

/**
 * API-06 `DELETE /auth/me` (FR-093).
 *
 * 바디는 `@RequestBody(required = false)` 라 소셜 계정은 **아예 보내지 않아도 된다.**
 * 그런데 이 프로젝트의 `request()` 는 `json` 이 `undefined` 면 `Content-Type` 도 붙이지 않는다 —
 * 그 조합이 Spring 에서 안전하다(바디 없는 DELETE).
 *
 * 성공 응답은 `{"success":true}` 뿐이다 — **`data` 키 자체가 없다**(SCR-28 데이터 표).
 * 그래서 `res.data` 를 검사하면 안 되고 `res.ok` 만 본다.
 *
 * ⚠ 성공 후처리는 **호출부의 책임이다**: SecureStore 파기 + React Query 전량 clear + SCR-02 이동.
 *   `queries.ts` 의 `useDeleteAccount` 가 `authStore.signOut()` 을 태워 그 일을 한다.
 *   여기서 세션을 건드리지 않는 이유는, 이 함수가 실패해도 세션은 살아 있어야 하기 때문이다.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<ApiResult<void>> {
  const res = await request<unknown>('/auth/me', {
    method: 'DELETE',
    ...(input.kind === 'local' ? { json: { password: input.password } } : {}),
  });
  if (!res.ok) return res;
  return { ok: true, data: undefined };
}

// ═══════════════════════════════════════════ 4. 내 문서 전체 삭제 (API-62)

/** `UserDataDeleteResponse` 그대로. 7개 카운터가 전부 온다. */
export type UserDataDeleteResult = {
  deletedBusinessCards: number;
  deletedTickets: number;
  deletedPosters: number;
  deletedReceipts: number;
  deletedSearchHistories: number;
  deletedGoogleCalendarMappings: number;
  deletedNotifications: number;
  /**
   * SCR-28 토스트 `저장 문서 {n}건을 삭제했습니다.` 의 n.
   * **문서 4종 합계만** 센다 — 검색기록·캘린더 매핑·알림은 "저장 문서"가 아니다(위키 원문 정의).
   */
  totalDocuments: number;
};

export const DELETE_DOCUMENTS_FAILED_MESSAGE = '내 데이터 삭제에 실패했습니다.';

/** SCR-28 성공 토스트 원문. */
export function deletedDocumentsMessage(total: number): string {
  return `저장 문서 ${total}건을 삭제했습니다.`;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const int = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

/**
 * API-62 `DELETE /api/me/documents` (FR-094).
 *
 * 계정은 남기고 문서 데이터만 지운다. 구글 캘린더 **연동 자체는 유지**되고 이벤트 매핑만
 * 지워진다 — SCR-28 카피(`구글 캘린더 연동 자체는 유지됩니다.`)가 이 동작을 설명한 것이다.
 * 알림도 함께 삭제되므로 호출부는 알림 캐시까지 무효화해야 한다.
 */
export async function deleteMyDocuments(): Promise<ApiResult<UserDataDeleteResult>> {
  const res = await request<unknown>('/api/me/documents', { method: 'DELETE' });
  if (!res.ok) return res;

  const d = asRecord(res.data);
  const deletedBusinessCards = int(d.deletedBusinessCards);
  const deletedTickets = int(d.deletedTickets);
  const deletedPosters = int(d.deletedPosters);
  const deletedReceipts = int(d.deletedReceipts);

  return {
    ok: true,
    data: {
      deletedBusinessCards,
      deletedTickets,
      deletedPosters,
      deletedReceipts,
      deletedSearchHistories: int(d.deletedSearchHistories),
      deletedGoogleCalendarMappings: int(d.deletedGoogleCalendarMappings),
      deletedNotifications: int(d.deletedNotifications),
      totalDocuments: deletedBusinessCards + deletedTickets + deletedPosters + deletedReceipts,
    },
  };
}

// ═══════════════════════════════════════════ 5. 알림 설정 (API-39 / API-40)

/** `NotificationSettingResponse`. 서버가 row 를 자동 생성하므로 항상 값이 온다. */
export type NotificationSettings = {
  /** 마감을 **며칠 앞까지 훑을지**의 윈도우. 0~30. 기본 3. */
  deadlineReminderDays: number;
  deadlineReminderEnabled: boolean;
  scheduleReminderEnabled: boolean;
};

/**
 * 부분 업데이트 입력. 세 필드가 전부 **래퍼 타입**(`Integer`/`Boolean`)이라
 * `null`(=키 생략)이면 서버가 그 필드를 건드리지 않는다 (`NotificationSettingService.update`).
 * → 토글 하나만 보내도 나머지가 보존된다.
 */
export type NotificationSettingsInput = Partial<NotificationSettings>;

/** SCR-29 세그먼트 선택지. 서버 허용 범위(0~30)의 부분집합이다. */
export const DEADLINE_REMINDER_DAY_OPTIONS = [1, 3, 5, 7, 14] as const;

/** `NotificationSettingService.MIN/MAX_DEADLINE_REMINDER_DAYS`. */
export const DEADLINE_REMINDER_DAYS_MIN = 0;
export const DEADLINE_REMINDER_DAYS_MAX = 30;

/** 서버 엔티티 기본값 (실측으로 확인: 신규 사용자에게 3/true/true 가 생성된다). */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  deadlineReminderDays: 3,
  deadlineReminderEnabled: true,
  scheduleReminderEnabled: true,
};

const SETTINGS_PATH = '/api/notification-settings';

function toNotificationSettings(raw: unknown): NotificationSettings {
  const d = asRecord(raw);
  return {
    deadlineReminderDays:
      typeof d.deadlineReminderDays === 'number' && Number.isFinite(d.deadlineReminderDays)
        ? Math.trunc(d.deadlineReminderDays)
        : DEFAULT_NOTIFICATION_SETTINGS.deadlineReminderDays,
    deadlineReminderEnabled:
      typeof d.deadlineReminderEnabled === 'boolean'
        ? d.deadlineReminderEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.deadlineReminderEnabled,
    scheduleReminderEnabled:
      typeof d.scheduleReminderEnabled === 'boolean'
        ? d.scheduleReminderEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.scheduleReminderEnabled,
  };
}

/**
 * API-39 `GET /api/notification-settings` (FR-089).
 * row 가 없으면 서버가 **기본값으로 생성해서** 돌려준다(`findOrCreate`) — 빈 상태 분기가 없다.
 */
export async function fetchNotificationSettings(): Promise<ApiResult<NotificationSettings>> {
  const res = await request<unknown>(SETTINGS_PATH);
  if (!res.ok) return res;
  return { ok: true, data: toNotificationSettings(res.data) };
}

/**
 * API-40 `PUT /api/notification-settings` (FR-089).
 *
 * 이름은 PUT 이지만 의미는 **PATCH** 다 — 보내지 않은 필드는 유지된다(래퍼 타입 null 스킵).
 * `undefined` 인 키를 지워서 보내는 이유가 이것이다. 전체 객체를 매번 실어 보내면
 * 두 화면이 동시에 저장할 때 서로의 값을 덮어쓴다.
 *
 * `deadlineReminderDays` 가 0~30 밖이면 **400** 이다. `schema.ts` 가 먼저 막는다.
 */
export async function updateNotificationSettings(
  input: NotificationSettingsInput,
): Promise<ApiResult<NotificationSettings>> {
  const body: Record<string, unknown> = {};
  if (input.deadlineReminderDays !== undefined) body.deadlineReminderDays = input.deadlineReminderDays;
  if (input.deadlineReminderEnabled !== undefined) {
    body.deadlineReminderEnabled = input.deadlineReminderEnabled;
  }
  if (input.scheduleReminderEnabled !== undefined) {
    body.scheduleReminderEnabled = input.scheduleReminderEnabled;
  }

  const res = await request<unknown>(SETTINGS_PATH, { method: 'PUT', json: body });
  if (!res.ok) return res;
  return { ok: true, data: toNotificationSettings(res.data) };
}
