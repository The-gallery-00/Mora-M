// src/features/network/retryPolicy.ts
//
// 전역 재시도 정책 (FR-102).
//
// 정본: wiki/tech/Offline and State.md §2 QK-01 (retry / retryDelay 확정값)
//       wiki/tech/Networking.md §5-3 (상태코드별 재시도 표)
//       wiki/tech/API Contract.md §2-2 (500 이 도메인 실패의 기본 코드다)
//
// ─────────────────────────────── 규칙 ───────────────────────────────
//
// | 조건                                   | 재시도 |
// |----------------------------------------|--------|
// | 네트워크 끊김 · 타임아웃 (`status: null`) | 최대 2회 |
// | 502 / 503 / 504                        | 최대 2회 |
// | **500**                                | **안 함** |
// | 4xx (400/401/403/404/413/429 …)        | 안 함 |
// | POST / PUT / PATCH / DELETE            | **안 함** (mutations.retry = 0) |
//
// **500 을 재시도하지 않는 것이 위키 두 문서의 차이점이다.** [[Offline and State]] §2 예시는
// `status >= 500` 을 전부 재시도 대상으로 두지만, [[Networking]] §5-3 표는 500 을 명시적으로
// 제외하고 그 근거를 [[API Contract]] §2-2 에 둔다 — **MORA 서버는 도메인 실패(없는 리소스,
// 검증 실패 등)를 전부 500 으로 내린다.** 그런 500 은 100% 재현되므로 재시도가 서버 부하만
// 3배로 만든다(Hikari pool `maximum-pool-size: 3`). 게이트웨이 계열(502/503/504)만 남긴다.
//
// **뮤테이션은 절대 자동 재시도하지 않는다** — 서버에 멱등키가 없고 `POST /api/commit` 은
// 호출마다 이미지와 NER 라벨을 하나씩 더 만든다. 자동 재시도가 곧 데이터 중복이다
// ([[Offline and State]] §2-1). 재시도는 항상 사용자가 명시적으로 트리거한다.

/** 최대 재시도 횟수 (총 시도는 3회). Offline and State §2 `failureCount < 2`. */
export const QUERY_RETRY_MAX = 2;

/** 재시도 대상 게이트웨이 상태코드. 500 은 여기 없다 — 위 표의 근거를 보라. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * 쿼리 계층이 던지는 에러는 전부 `status: number | null` 을 갖는다
 * (`DocumentError` · `SearchError` · `NotificationError` · `DashboardError` · `AccountError` …).
 * 그 계약을 신뢰하되, 계약 밖의 값(문자열 throw 등)이 와도 안전하게 `null` 로 떨어뜨린다.
 */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * `QueryClient.defaultOptions.queries.retry`.
 *
 * `failureCount` 는 **0부터** 들어온다(query-core `retryer.js` — 증가 전에 판정한다).
 * 따라서 `failureCount < 2` 가 재시도 2회 = 총 3회 시도다.
 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= QUERY_RETRY_MAX) return false;
  const status = statusOf(error);
  if (status === null) return true; // 연결 끊김 · 타임아웃 — 재시도 가치가 있는 유일한 실패
  return RETRYABLE_STATUS.has(status);
}

/**
 * 지수 백오프 1s → 2s (상한 8s). Offline and State §2 확정값 그대로다.
 * 지터를 넣지 않는 이유: 앱 1대가 동시에 던지는 요청이 4개를 넘지 않아 동기화 폭주가 없다.
 */
export function queryRetryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 8000);
}
