/**
 * 검색 4종 네트워크 계층 (API-19 명함 / API-61 티켓 / API-47 포스터 / API-52 영수증).
 *
 * 정본: wiki/tech/API Contract.md §3-16(공통 정책) · §4-2(Page 아님) · §4-5(인코딩)
 *       wiki/design/Screen Specs.md SCR-23
 *       wiki/product/Requirements.md FR-070 · FR-071 · FR-072 · FR-073 · FR-130
 *
 * ─────────────────────────── 이 계층이 지키는 사실 5가지 ───────────────────────────
 *
 * 1. **통합 검색 엔드포인트는 없다.** `전체`(ALL)는 서버 기능이 아니라 이 파일이 4콜을
 *    `Promise.allSettled` 로 묶어 만든 클라이언트 합성이다 (FR-130).
 * 2. **쿼리 파라미터는 `q` 다** (`query` 아님 — `@RequestParam("q")`). 실측 확인.
 *    `q` 를 아예 빼면 **400**, 빈 문자열(`q=`)로 보내면 **200 + 전체 목록**이 온다.
 *    빈 검색어로도 결과가 나오고 검색기록까지 1건 쌓이므로 이 파일이 마지막 방어선으로 막는다.
 * 3. **응답 `data` 는 Page 가 아니라 바로 배열**이다 — `{"success":true,"data":[ ... ]}`.
 *    공용 `unwrapList` 가 배열/`content` 양쪽을 흡수하므로 그대로 통과시킨다.
 * 4. **검색 API 호출 1회 = 서버 `search_histories` 1건.** 서버가 검색 실행 **전에**
 *    `searchHistoryService.record()` 를 무조건 부르며 앱이 끌 수단이 없다 (§3-12).
 *    따라서 호출 횟수 자체가 비용이다 — 디바운스 금지(FR-071)·`staleTime` 5분·`retry` 금지는
 *    전부 같은 이유에서 나온 하나의 정책이고, 그 강제는 `queries.ts` 가 한다.
 * 5. **`similarity` 는 하이브리드 점수**(`Fuzzy × 0.6 + Vector × 0.4`)이고 일반 조회에는 없다.
 *    영수증만 `ReceiptService.save()` 가 임베딩을 만들지 않아 **영구히 fuzzy 점수만** 나온다 —
 *    관련도순에서 영수증이 하위로 밀리는 것은 버그가 아니다 (§3-11).
 *
 * 계층 규약은 `features/documents/api.ts` 와 동일하다: 앱 모델만 돌려주고, 실패는 throw 하지 않고
 * `ApiResult` 로 올린다(throw 는 React Query 경계인 `queries.ts` 의 몫).
 */

import {
  DOCUMENT_TYPE_LABELS,
  toDocumentDetail,
  toDocumentSummary,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
} from '@/features/documents';
import { request, unwrapList, type ApiResult, type AppError } from '@/services/http';

// ───────────────────────────────────────────────────────────── 검색 어휘

/**
 * 검색 화면의 문서유형. 보관함 4종 + `ALL`.
 *
 * `ETC` 는 저장 경로 자체가 없어 검색 대상이 될 수 없다 (scan/types.ts `SAVABLE_DOCUMENT_TYPES`).
 * 순서는 SCR-23 와이어프레임의 칩 순서 그대로다 — 화면이 이 배열을 그대로 렌더할 수 있어야 한다.
 */
export const SEARCH_DOC_TYPES = ['ALL', 'BUSINESS_CARD', 'TICKET', 'POSTER', 'RECEIPT'] as const;
export type SearchDocType = (typeof SEARCH_DOC_TYPES)[number];

/** 칩·결과 헤더 라벨. 4종은 문서 계층 라벨을 그대로 파생시켜 값이 갈리지 않게 한다. */
export const SEARCH_DOC_TYPE_LABELS: Record<SearchDocType, string> = {
  ALL: '전체',
  ...DOCUMENT_TYPE_LABELS,
};

/** MMKV 에서 복원한 값처럼 **신뢰할 수 없는 입력**을 좁힌다 (Offline and State §1-4 결정 1). */
export function isSearchDocType(value: unknown): value is SearchDocType {
  return typeof value === 'string' && (SEARCH_DOC_TYPES as readonly string[]).includes(value);
}

/**
 * `전체` 검색이 호출하는 순서. 동점일 때의 표시 순서에도 영향을 준다.
 *
 * 명함이 먼저인 이유는 §3-16 과 같다 — 저장 데이터가 가장 많은 핵심 도메인이다.
 * 4콜을 동시에 던지므로 서버 Hikari pool(3)을 순간적으로 넘긴다. 이 4개를 초과하는
 * 동시 요청을 이 경로에 얹지 마라 (§4-8 #9).
 */
export const SEARCH_PARALLEL_TYPES: readonly DocumentType[] = [
  'BUSINESS_CARD',
  'TICKET',
  'POSTER',
  'RECEIPT',
];

/** 서버 기본값은 `topK=5` 다. 앱은 **항상 50 을 명시 전송**한다 (원본 웹 고정값 계승 — §3-16). */
export const SEARCH_TOP_K = 50;

const SEARCH_PATH: Record<DocumentType, string> = {
  BUSINESS_CARD: '/api/cards/search',
  TICKET: '/api/tickets/search',
  POSTER: '/api/posters/search',
  RECEIPT: '/api/receipts/search',
};

// ───────────────────────────────────────────────────────────── 결과 모델

/**
 * 검색 결과 1건.
 *
 * `DocumentSummary` 를 **그대로 확장**한다 — 목록 카드(`DocumentGridCard`/`DocumentListItem`)가
 * 보관함과 검색에서 같은 뷰모델을 받도록 하기 위해서다. 검색이 추가로 얹는 것은 3가지뿐이다:
 *
 *  - `score`    : 정렬 전용으로 정규화한 유사도. 서버가 `null` 을 줄 수 있어 `?? 0` 을 여기서 끝낸다.
 *  - `preview`  : 결과 카드의 원문 프리뷰 2줄(FR-072).
 *  - `document` : 상세 원본. 검색 응답이 **상세 DTO 전체**라 버릴 이유가 없다 —
 *                 카드의 facts 행(직함·연락처 등)과 탭 시 SCR-19 시딩에 그대로 쓴다.
 */
export type SearchHit = DocumentSummary & {
  score: number;
  preview: string;
  document: DocumentDetail;
};

/** `전체` 병렬 호출에서 한 유형만 실패한 경우. 성공분은 노출하고 이것만 배너로 알린다. */
export type SearchTypeFailure = { type: DocumentType; error: AppError };

export type SearchResults = {
  hits: SearchHit[];
  /** 단일 유형 검색에서는 항상 빈 배열이다. `전체`에서만 채워진다. */
  failed: SearchTypeFailure[];
  /** 서버 부분성공 경고 원문 (`임베딩 생성 실패. Fuzzy 검색만 가능.`). 없으면 키 자체가 없다. */
  warning?: string;
};

export type SearchSortOrder = 'relevance' | 'recent';

// ───────────────────────────────────────────────────────────── 프리뷰 조립

/** 여러 줄 OCR 원문을 한 줄로 눌러 2줄 프리뷰에 담는다. 개행이 남으면 두 줄이 한 단어로 끝난다. */
const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

const joinFacts = (parts: string[]): string =>
  parts.filter((part) => part.trim() !== '').join(' / ');

/**
 * 결과 카드 프리뷰 텍스트 (원본 웹 규칙 그대로 — SCR-23).
 * `rawOcrText`/`rawText` 가 있으면 그것, 없으면 주요 필드를 ` / ` 로 조인한다.
 * 하이라이트(첫 매칭 1회)는 화면이 이 문자열 위에서 수행한다.
 */
function previewText(doc: DocumentDetail): string {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return flatten(
        doc.rawOcrText || joinFacts([doc.name, doc.company, doc.position, doc.phone, doc.email]),
      );
    case 'TICKET':
      return flatten(
        doc.rawText ||
          joinFacts([
            doc.transportType,
            doc.departureLocation,
            doc.departureDate,
            doc.departureTime,
            doc.arrivalLocation,
            doc.arrivalDate,
            doc.arrivalTime,
          ]),
      );
    case 'POSTER':
      return flatten(
        doc.rawText ||
          joinFacts([
            doc.title,
            doc.organizerName,
            doc.eventStartDate,
            doc.eventEndDate,
            doc.location,
            doc.fee,
          ]),
      );
    case 'RECEIPT':
      return flatten(
        doc.rawText ||
          joinFacts([
            doc.merchantName,
            doc.merchantAddress,
            doc.purchaseDate,
            doc.purchaseTime,
            doc.paymentMethod,
            doc.cardCompany,
          ]),
      );
  }
}

/**
 * 서버 검색 DTO 1건 → `SearchHit`.
 *
 * **DTO 파싱을 새로 쓰지 않는다.** 검색 응답은 목록/상세와 완전히 같은 `*Response` 이므로
 * `documents/mappers` 의 어댑터를 그대로 통과시킨다 — 날짜 정규화·`parsedJson` 안의 imageUrl
 * 추출·절대 URL 조립이 전부 거기서 이미 끝난다 (Data Model §5-1 규칙 1: 변환은 한 곳에서만).
 */
export function toSearchHit(type: DocumentType, dto: unknown): SearchHit {
  const document = toDocumentDetail(type, dto);
  const summary = toDocumentSummary(document);
  return {
    ...summary,
    score: summary.similarity ?? 0,
    preview: previewText(document),
    document,
  };
}

// ───────────────────────────────────────────────────────────── 정렬

const createdAtOf = (hit: SearchHit): string => hit.createdAt ?? '';

/**
 * 클라이언트 정렬 (FR-073). **재요청 없이** 정렬만 바꾼다 — 재요청 1회가 검색기록 1건이다.
 *
 * 정렬 기준은 SCR-23 그대로: 관련도순 `(b.similarity ?? 0) - (a.similarity ?? 0)`,
 * 최신순 `createdAt` 내림차순. `createdAt` 은 어댑터가 ISO 문자열로 정규화해 두므로
 * 문자열 비교가 곧 시간 비교다(자리수 고정). 값이 없으면 `''` 라 항상 뒤로 밀린다.
 *
 * 동점 처리를 명시하는 이유: `전체` 는 4종을 섞기 때문에 동점이 흔하고, 타이브레이커가 없으면
 * 정렬 토글을 왕복할 때마다 같은 점수 항목의 순서가 흔들려 목록이 미묘하게 재배치된 것처럼 보인다.
 */
export function sortSearchHits(
  hits: readonly SearchHit[],
  order: SearchSortOrder,
): SearchHit[] {
  const sorted = [...hits];
  if (order === 'recent') {
    sorted.sort(
      (a, b) => createdAtOf(b).localeCompare(createdAtOf(a)) || b.score - a.score,
    );
  } else {
    sorted.sort(
      (a, b) => b.score - a.score || createdAtOf(b).localeCompare(createdAtOf(a)),
    );
  }
  return sorted;
}

// ───────────────────────────────────────────────────────────── 단일 유형 검색

/**
 * 종별 검색 (API-19 / API-61 / API-47 / API-52).
 *
 * 4종 시그니처가 완전히 같아 함수 하나로 처리한다.
 * `encodeURIComponent` 는 필수다 — `server.tomcat.uri-encoding` 설정이 없어 한글 검색어가
 * 그대로 나가면 서버에서 깨진다 (§4-5).
 *
 * **빈 검색어는 요청 자체를 만들지 않는다.** 서버는 `q=` 를 400 이 아니라 200 + 전체 목록으로
 * 처리하고 검색기록까지 1건 남긴다(실측). 화면이 `enabled` 가드를 깜빡해도 여기서 막힌다.
 */
export async function searchDocuments(
  type: DocumentType,
  q: string,
  topK: number = SEARCH_TOP_K,
): Promise<ApiResult<SearchResults>> {
  const trimmed = q.trim();
  if (trimmed === '') return { ok: true, data: { hits: [], failed: [] } };

  const path = `${SEARCH_PATH[type]}?q=${encodeURIComponent(trimmed)}&topK=${topK}`;
  const res = await request<unknown>(path);
  if (!res.ok) return res;

  const hits = unwrapList<unknown>(res.data).map((dto) => toSearchHit(type, dto));
  return {
    ok: true,
    data: { hits, failed: [], ...(res.message ? { warning: res.message } : {}) },
  };
}

// ───────────────────────────────────────────────────────────── `전체` 병렬 검색

/**
 * `전체` 검색 (FR-130) — 4종 병렬 호출 + 클라이언트 머지.
 *
 * `Promise.allSettled` 인 이유: 서버는 **존재하지 않는 리소스에도 500 을 던지므로**(§2-1)
 * 한 종류의 실패로 나머지 3종의 결과를 버릴 수 없다. 실패한 유형만 `failed` 로 올리고
 * 화면이 배너(`{유형} 검색에 실패했습니다.`)를 그린다.
 *
 * 반환은 **정렬하지 않은 합집합**이다. 정렬은 `sortSearchHits` 가 화면의 토글에 맞춰 따로 한다 —
 * 여기서 정렬해 버리면 캐시된 결과가 특정 정렬에 묶여 토글이 재요청을 유발하게 된다.
 *
 * 4종이 **전부** 실패하면 부분 실패가 아니라 검색 자체의 실패로 올린다(첫 에러를 대표로).
 * 이래야 화면이 "결과 0건"이 아니라 에러 박스를 그린다.
 */
export async function searchAllDocuments(
  q: string,
  topK: number = SEARCH_TOP_K,
): Promise<ApiResult<SearchResults>> {
  const trimmed = q.trim();
  if (trimmed === '') return { ok: true, data: { hits: [], failed: [] } };

  const settled = await Promise.allSettled(
    SEARCH_PARALLEL_TYPES.map((type) => searchDocuments(type, trimmed, topK)),
  );

  const hits: SearchHit[] = [];
  const failed: SearchTypeFailure[] = [];
  let warning: string | undefined;

  settled.forEach((outcome, index) => {
    const type = SEARCH_PARALLEL_TYPES[index];
    if (type === undefined) return; // noUncheckedIndexedAccess — 실제로는 도달하지 않는다.

    // `searchDocuments` 는 throw 하지 않지만, 어댑터가 예기치 못한 DTO 에서 던질 여지가 있다.
    // 그 한 건 때문에 나머지 3종을 잃지 않도록 rejected 도 유형 실패로 흡수한다.
    if (outcome.status === 'rejected') {
      failed.push({
        type,
        error: { kind: 'parse', status: null, message: '검색 결과를 해석하지 못했습니다.' },
      });
      return;
    }

    const res = outcome.value;
    if (!res.ok) {
      failed.push({ type, error: res.error });
      return;
    }
    hits.push(...res.data.hits);
    warning ??= res.data.warning;
  });

  if (failed.length === SEARCH_PARALLEL_TYPES.length) {
    const first = failed[0];
    return {
      ok: false,
      error: first?.error ?? { kind: 'server', status: null, message: '검색에 실패했습니다.' },
    };
  }

  return { ok: true, data: { hits, failed, ...(warning ? { warning } : {}) } };
}

/** 유형에 따라 단일/병렬 경로를 고르는 단일 진입점. `queries.ts` 는 이것만 부른다. */
export function runSearch(
  type: SearchDocType,
  q: string,
  topK: number = SEARCH_TOP_K,
): Promise<ApiResult<SearchResults>> {
  return type === 'ALL' ? searchAllDocuments(q, topK) : searchDocuments(type, q, topK);
}
