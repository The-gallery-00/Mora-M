/**
 * 챗봇 네트워크 계층 (API-31 `POST /api/chat`).
 *
 * 정본: wiki/tech/API Contract.md §3-6 · §7(타임아웃 표)
 *       wiki/design/Screen Specs.md SCR-24
 *       wiki/product/Requirements.md FR-077 · FR-078 · FR-079 · NFR-006
 *
 * ───────────────── 실제 서버를 호출해 확인한 사실 (위키보다 우선) ─────────────────
 *
 * 요청  : `POST /api/chat` body `{"query","document_type","top_k"}` — **snake_case 필수**.
 *         Spring DTO 는 camelCase 지만 `@JsonAlias("document_type")`/`@JsonAlias("top_k")` 로 받는다.
 *         camelCase 로 보내면 `documentType` 이 null 이 되어 LLM 이 500 을 던진다.
 * 응답  : `{"success":true,"data":{"answer":"…","sources":[…],"query":"…"}}`
 * sources: **검색 API 응답 DTO 배열 그대로다.** 실측 응답 원문(명함) —
 *         `{"id":"f6f6…","name":"김민우","company":"모라테크","position":"개발팀 이사",
 *           "phone":"010-…","email":"…","rawOcrText":"…","imageUrl":"","groupId":null,
 *           "createdAt":"2026-07-28T06:43:08.239074","similarity":0.548…}`
 *         `LlmService` 가 `List<Map<String,Object>>` 로 받아 **가공 없이** 그대로 흘리고,
 *         LLM 쪽 `HybridRetriever` 는 Spring `/api/{cards|tickets|posters|receipts}/search` 의
 *         `data` 를 그대로 돌려주기 때문이다. 즉 `document_type` 만 알면 어떤 DTO 인지 확정된다
 *         → `documents/mappers` 의 어댑터를 그대로 재사용한다. 전용 파서를 새로 쓰지 마라.
 *
 * ───────────────────────────── 구조상의 함정 3가지 ─────────────────────────────
 *
 * 1. **3홉 순환 호출**: 앱 → Spring `/api/chat` → LLM `:8001/api/chat` → Spring 검색 API → DB.
 *    JWT 하나가 3홉을 관통한다(`LlmController` 가 `Authorization` 헤더를 그대로 전달).
 *    중간 httpx 타임아웃이 10초라 실패가 늦게 드러난다 → **취소 버튼이 필수**이고,
 *    이 파일은 `signal` 을 받는다.
 * 2. **챗봇 1회 = 서버 검색기록 1건.** 마지막 홉이 검색 API 이므로 검색 화면과 똑같이 기록이 쌓인다.
 *    앱이 막을 수 없다. 재시도를 자동화하지 않는 이유이기도 하다(재시도 = 기록 1건 추가).
 * 3. **크로스 도메인 질의 불가.** `SEARCH_ENDPOINTS` 가 타입별 단일 엔드포인트라 한 요청에
 *    문서 유형 1종만 된다. 유형 칩이 필수 선택인 이유가 이것이다 (FR-077).
 *
 * 계층 규약: 이 파일은 **네트워크만** 한다. 사용자에게 보일 문구(빈 답변 폴백·에러 문구)는
 * `store.ts` 의 `CHAT_COPY` 가 소유한다 — 대화 내용은 UI 상태이지 네트워크 관심사가 아니다.
 */

import {
  toDocumentDetail,
  toDocumentSummary,
  type DocumentSummary,
  type DocumentType,
} from '@/features/documents';
import { request, type ApiResult } from '@/services/http';

/**
 * 챗봇이 다루는 문서 유형. **`ETC` 제외 4종.**
 * 보관함 `DocumentType` 이 이미 저장 가능한 4종이라 그대로 재사용한다 —
 * 어휘를 하나 더 만들면 `document_type` 에 `ETC` 가 실릴 여지가 생긴다.
 */
export type ChatDocType = DocumentType;

/**
 * `top_k`. 서버·웹 원본 기본값 5 를 그대로 쓴다 (SCR-24 데이터 표).
 *
 * 검색 화면의 50 과 다른 값인 것은 의도된 것이다 — 여기서 온 문서는 목록이 아니라
 * LLM 프롬프트의 컨텍스트로 들어간다. 늘리면 토큰과 지연만 커지고 답변 품질은 나아지지 않는다.
 */
export const CHAT_TOP_K = 5;

/**
 * 60초. 전역 기본 15초로는 3홉 왕복이 끝나기 전에 끊긴다 (NFR-006: P90 ≤ 25s, 타임아웃 60s).
 *
 * SCR-24 상태표에는 `에러(타임아웃 30초)` 로 적혀 있으나, FR-078 · NFR-006 · API Contract §3-6/§7 이
 * 모두 60초로 일치하므로 **60초를 채택**한다. 표시 문구는 SCR-24 것을 그대로 쓴다.
 */
export const CHAT_TIMEOUT_MS = 60_000;

export type ChatAnswer = {
  /**
   * 서버 답변 원문(trim 만 적용). **빈 문자열일 수 있다** — 폴백 문구는 `store.ts` 가 씌운다.
   * 검색 0건일 때 서버가 주는 고정 문구(`관련된 데이터를 찾을 수 없어…`)는 빈 값이 아니라
   * 정상 답변으로 그대로 내려온다.
   */
  answer: string;
  /** 서버가 되돌려준 질문. 값이 없으면 요청에 쓴 질문으로 채운다. */
  query: string;
  /**
   * 출처 카드용 뷰모델 (FR-079). 결과 0건이면 빈 배열이다.
   * `DocumentSummary` 면 충분하다 — 카드가 필요한 것은 유형 배지·제목·부제·유사도뿐이고,
   * 탭 시 SCR-19 이동은 `type` + `id` 로 끝난다.
   */
  sources: DocumentSummary[];
};

export type SendChatInput = {
  query: string;
  documentType: ChatDocType;
  topK?: number;
  /** 취소 버튼용. 3홉 구조상 사용자가 기다리다 포기할 수 있어야 한다 (§3-6). */
  signal?: AbortSignal;
};

/**
 * 챗봇 질의 (API-31).
 *
 * 빈 질문 가드는 두지 않는다 — 유형 필수 선택과 함께 `store.ts` 의 `send` 가 막는다.
 * 여기서 막으면 같은 검증이 두 곳에 흩어진다.
 */
export async function sendChatMessage(input: SendChatInput): Promise<ApiResult<ChatAnswer>> {
  const res = await request<unknown>('/api/chat', {
    method: 'POST',
    json: {
      query: input.query,
      // snake_case 로 보내야 한다. camelCase 는 서버에서 null 로 떨어진다.
      document_type: input.documentType,
      top_k: input.topK ?? CHAT_TOP_K,
    },
    timeoutMs: CHAT_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!res.ok) return res;

  const data = (res.data !== null && typeof res.data === 'object' ? res.data : {}) as {
    answer?: unknown;
    sources?: unknown;
    query?: unknown;
  };

  const rawSources = Array.isArray(data.sources) ? data.sources : [];
  const sources = rawSources.map((dto) =>
    toDocumentSummary(toDocumentDetail(input.documentType, dto)),
  );

  return {
    ok: true,
    data: {
      answer: typeof data.answer === 'string' ? data.answer.trim() : '',
      query: typeof data.query === 'string' && data.query !== '' ? data.query : input.query,
      sources,
    },
  };
}
