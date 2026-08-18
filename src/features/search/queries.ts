/**
 * 검색 React Query 계층.
 *
 * 정본: wiki/tech/API Contract.md §6-1(키) · §6-2(옵션) · §6-3(무효화) · §3-16(공통 정책)
 *       wiki/tech/Offline and State.md §10 ST-05~ST-07 · §10-1 ST-09~ST-14
 *       wiki/design/Screen Specs.md SCR-23 (문구·상태·인터랙션)
 *
 * ─────────────────────────── 쿼리 키 ───────────────────────────
 *
 *   ['search']                       ← 루트 (로그아웃 시 한 방에)
 *   ['search', type, q, topK]        ← 검색 1회. `type` 은 `'ALL'` 포함 5종
 *
 * 키에 `type` 이 반드시 들어간다 — 같은 `q` 라도 유형이 다르면 전혀 다른 결과다.
 * `topK` 도 넣는다: 앱은 항상 50 을 보내지만 키를 파라미터와 1:1 로 유지해야 값이 바뀔 때
 * 캐시가 저절로 갈린다.
 *
 * **`'ALL'` 은 4개 키가 아니라 1개 키다** (ST-14). 4개로 쪼개면 로딩·에러·무효화가 4벌이 되어
 * 화면이 4번 흔들리고, 검색기록 억제(캐시 히트 1회 = 기록 4건 회피)의 단위도 무너진다.
 * **`'ALL'` 결과를 유형별 키에 씨딩하지 마라** — 4종을 머지한 목록이라 유형별 원본과
 * 순서·건수가 달라, 잘못된 캐시가 정상 결과처럼 보인다 (§6-1 주석).
 *
 * ─────────────────── 이 파일이 존재하는 진짜 이유: 호출 억제 ───────────────────
 *
 * 서버는 검색 API 호출 **전에** `searchHistoryService.record()` 를 무조건 부른다.
 * 즉 **호출 1회 = 서버 검색기록 1건**(`전체` 는 4건)이고 앱이 끌 수단이 없다. 그래서
 * 이 훅은 다음 3가지를 정책으로 강제한다 — 셋 다 성능이 아니라 데이터 오염 방지책이다.
 *
 *  1. **디바운스 자동검색 금지 (FR-071).** `useSearch` 는 입력값이 아니라 **제출된 검색어**를 받는다.
 *     키가 제출 시점에만 바뀌므로 구조적으로 타이핑 중 실행이 불가능하다.
 *  2. **`staleTime` 5분 (ST-05).** 뒤로가기 후 재진입·같은 조건 재검색이 캐시로 응답된다.
 *  3. **`retry: false`.** 전역 기본값은 네트워크 실패·502/503/504 를 최대 2회 재시도한다
 *     (`features/network/retryPolicy.ts`). 그 정책이 검색에 적용되면 실패 1회가 서버에
 *     **3건**(`전체` 는 12건)의 검색기록을 남긴다. 검색 경로에서만 끈다.
 *
 * ─────────────────────────── 무효화 ───────────────────────────
 *
 * | 액션 | 무효화 대상 |
 * |---|---|
 * | 검색 실행 | **없음.** 자기 키(`['search',…]`)를 무효화하면 재요청 = 검색기록 1건이라 억제 장치를 스스로 깬다 |
 * | 검색기록 전체삭제 | 검색 결과 캐시는 유지하고 로컬 최근 검색어만 비운다 |
 * | 문서 수정/삭제 | 문서 계층이 `['documents',…]` 만 건드린다. 검색 캐시는 **일부러** 손대지 않는다 |
 */

import {
  useMutation,
  useQuery,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { NETWORK_COPY, offlineWriteBlock } from '@/features/network';
import type { AppError } from '@/services/http';

import {
  SEARCH_DOC_TYPE_LABELS,
  SEARCH_TOP_K,
  runSearch,
  sortSearchHits,
  type SearchDocType,
  type SearchHit,
  type SearchResults,
  type SearchSortOrder,
  type SearchTypeFailure,
} from './api';
import {
  addRecentSearch,
  clearRecentSearches,
  clearSearchHistories,
  getRecentSearches,
  removeRecentSearch,
  subscribeRecentSearches,
  writeLastSearchDocType,
  type RecentSearch,
} from './recent';

// ───────────────────────────────────────────────────────────── 쿼리 키

export const searchKeys = {
  /** 검색 루트. 로그아웃 시 이 하나만 지우면 된다. */
  all: () => ['search'] as const,
  query: (type: SearchDocType, q: string, topK: number) =>
    ['search', type, q, topK] as const,
} as const;

// ───────────────────────────────────────────────────────────── 문구

/**
 * SCR-23 상태/인터랙션 표의 문구를 그대로 옮긴 것. **여기서 새로 짓지 않는다.**
 * 서버가 준 `error` 문장은 한/영이 혼재하고 인코딩이 깨질 수 있어 UI 에 쓰지 않는다 (§4-5).
 * 원본 웹의 `runSearch` 도 유일하게 서버 `json.error` 를 완전히 무시하는 함수였다.
 */
export const SEARCH_COPY = {
  placeholder: '검색어를 입력하세요',
  guideTitle: '이렇게 찾아보세요',
  guideBody: '이름 일부, 회사명, 직책 등 기억나는 것만으로 찾을 수 있습니다.',
  loadingSlow: '검색 중...',
  emptyTitle: '조건에 맞는 결과가 없습니다.',
  emptyBody: '다른 키워드나 문서 유형으로 검색해 보세요.',
  failed: '검색에 실패했습니다.',
  offline: '오프라인입니다. 검색은 연결 후 가능합니다.',
  recentTitle: '최근 검색어',
  clearAll: '전체 삭제',
  historyClearFailed: '검색 기록 삭제에 실패했습니다.',
  sortRelevance: '관련도순',
  sortRecent: '최신순',
} as const;

/** 결과 헤더 — `명함 3건` / `전체 12건`. */
export const searchResultCountLabel = (type: SearchDocType, n: number): string =>
  `${SEARCH_DOC_TYPE_LABELS[type]} ${n}건`;

/** `전체` 부분 실패 배너 — 실패 유형이 2개 이상이면 쉼표로 합친다 (Screen Specs 부록 C). */
export const searchPartialFailureNotice = (failed: readonly SearchTypeFailure[]): string | null =>
  failed.length === 0
    ? null
    : `${failed.map((f) => SEARCH_DOC_TYPE_LABELS[f.type]).join(', ')} 검색에 실패했습니다.`;

/** 전체 삭제 성공 토스트 — `검색 기록 12건을 삭제했습니다.` */
export const searchHistoryClearedMessage = (n: number): string =>
  `검색 기록 ${n}건을 삭제했습니다.`;

// ───────────────────────────────────────────────────────────── 에러

export type SearchOperation = 'search' | 'clearHistory';

/** `message` 는 이미 완성된 한국어 화면 문구다. 화면은 그대로 에러 박스/토스트에 넣으면 된다. */
export class SearchError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: SearchOperation;

  constructor(message: string, error: AppError, operation: SearchOperation) {
    super(message);
    this.name = 'SearchError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function searchErrorMessage(operation: SearchOperation, error: AppError): string {
  // 연결/타임아웃/세션만료는 http.ts 가 이미 상태코드 기준 정본 문구를 만들어 둔다.
  if (error.kind === 'offline') {
    return operation === 'search' ? SEARCH_COPY.offline : error.message;
  }
  if (error.kind === 'timeout' || error.kind === 'unauthorized') return error.message;

  switch (operation) {
    case 'search':
      return SEARCH_COPY.failed;
    case 'clearHistory':
      return SEARCH_COPY.historyClearFailed;
  }
}

export function toSearchError(operation: SearchOperation, error: AppError): SearchError {
  return new SearchError(searchErrorMessage(operation, error), error, operation);
}

// ───────────────────────────────────────────────────────────── 검색 실행

export type UseSearchOptions = {
  /** 기본 50. 서버 기본은 5 라 항상 명시 전송한다. */
  topK?: number;
  /** 정렬 토글. **재요청 없이** 클라이언트에서만 다시 정렬한다 (FR-073). */
  order?: SearchSortOrder;
  /** 오프라인 등으로 실행 자체를 막을 때만 `false`. 빈 검색어 가드는 훅이 이미 갖고 있다. */
  enabled?: boolean;
};

const EMPTY_HITS: SearchHit[] = [];
const EMPTY_FAILURES: SearchTypeFailure[] = [];

/**
 * 검색 실행 (API-19/47/52/61, `'ALL'` 이면 4종 병렬 — FR-070 · FR-130).
 *
 * **`submittedQuery` 에 입력창 값을 그대로 넘기면 안 된다.** 이 인자는 사용자가 명시적으로 제출한
 * (키보드 `검색` / 검색 버튼 / 검색어가 있는 상태의 칩 탭) 검색어여야 한다. 화면은 입력 상태와
 * 제출 상태를 분리해 들고, 제출 시에만 이 값을 갱신한다 — 그것이 FR-071 의 구현 방식이다.
 *
 * 성공 시 부수효과 2가지 (ST-10 · ST-12):
 *  - `search.lastDocType` 갱신 — **칩 탭이 아니라 실행 성공 시점**이다.
 *  - 로컬 최근 검색어 1건 적립 — `'ALL'` 도 4건이 아니라 **1건**이다.
 * 캐시 히트로 응답된 경우에도 기록한다. 사용자 입장에서는 검색을 실행한 것이고, 최근 검색어의
 * 순서가 최신 사용 순으로 유지되는 편이 옳다(네트워크 요청은 나가지 않으므로 서버 기록은 늘지 않는다).
 */
export function useSearch(
  type: SearchDocType,
  submittedQuery: string,
  options: UseSearchOptions = {},
) {
  const q = submittedQuery.trim();
  const topK = options.topK ?? SEARCH_TOP_K;
  const order = options.order ?? 'relevance';
  const enabled = q.length > 0 && options.enabled !== false;

  const query = useQuery<SearchResults, SearchError>({
    queryKey: searchKeys.query(type, q, topK),
    queryFn: async () => {
      const res = await runSearch(type, q, topK);
      if (!res.ok) throw toSearchError('search', res.error);
      return res.data;
    },
    enabled,
    // ST-05. 이 값이 0 이면 뒤로가기 후 재진입마다 서버 기록이 1건(`전체` 4건)씩 늘어난다.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    // 전역 기본은 네트워크 실패를 2회 재시도한다. 검색에서만 끈다 — 재시도 1회가 곧 검색기록 1건이다.
    retry: false,
    // RVL-06: 포그라운드 복귀·재연결로 검색을 다시 실행하지 않는다. 같은 이유(기록 적립)다.
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 같은 (type,q,topK) 로 여러 번 렌더돼도 적립은 1회. 키가 바뀔 때만 다시 기록한다.
  const recordedRef = useRef<string | null>(null);
  // 구분자는 NUL 이다(검색어에 절대 들어올 수 없는 바이트라 `a|b` 와 `a`+`|b` 가 섞이지 않는다).
  // **이스케이프로 적는다** — 소스에 생 NUL 바이트를 넣으면 git/ripgrep 이 이 파일을 binary 로
  // 판정해 diff 와 코드리뷰가 통째로 막힌다(실제로 막혀 있었다). 런타임 값은 완전히 동일하다.
  // 구분자는 NUL 이다 — 검색어에 들어올 수 없는 바이트라 `a|b` 와 `a`+`|b` 가 같은 stamp 가 되지 않는다.
  // **이스케이프로 적는다.** 소스에 생 NUL 바이트를 박으면 git·ripgrep 이 이 파일을 binary 로 판정해
  // diff 와 코드리뷰가 통째로 막힌다(실제로 막혀 있었다). 런타임 문자열 값은 완전히 동일하다.
  const stamp = `${type}\u0000${q}\u0000${topK}`;
  const isSuccess = query.isSuccess;

  useEffect(() => {
    if (!isSuccess || q.length === 0) return;
    if (recordedRef.current === stamp) return;
    recordedRef.current = stamp;
    writeLastSearchDocType(type);
    addRecentSearch(q, type);
  }, [isSuccess, stamp, type, q]);

  const hits = useMemo(
    () => sortSearchHits(query.data?.hits ?? EMPTY_HITS, order),
    [query.data, order],
  );
  const failed = query.data?.failed ?? EMPTY_FAILURES;

  return {
    ...query,
    /** 정렬까지 끝난 결과. 화면은 이걸 그대로 FlashList 에 넣는다. */
    hits,
    /** `전체` 에서 실패한 유형들. 단일 유형 검색에서는 항상 빈 배열이다. */
    failed,
    /** 부분 실패 배너 문구. 실패가 없으면 `null`. */
    failureNotice: searchPartialFailureNotice(failed),
    /** 서버 부분성공 경고 원문(`임베딩 생성 실패. Fuzzy 검색만 가능.`). */
    warning: query.data?.warning,
    total: hits.length,
    /** 결과 헤더 문구 — `명함 3건` / `전체 12건`. */
    countLabel: searchResultCountLabel(type, hits.length),
    /** 검색을 실행했고 결과가 0건인 상태. 검색 전(`q` 없음)과 구분된다. */
    isEmpty: enabled && query.isSuccess && hits.length === 0,
  };
}

// ───────────────────────────────────────────────────────── 최근 검색어(로컬)

export type UseRecentSearchesResult = {
  items: RecentSearch[];
  /** 단건 제거 — 로컬만. 서버에는 단건 삭제 API 가 없다. */
  remove: (q: string, docType: SearchDocType) => void;
  /** 로컬만 비운다. 서버까지 지우려면 `useClearSearchHistory` 를 쓴다. */
  clear: () => void;
};

/**
 * 화면의 최근 검색어 (FR-074 · ST-06). **1차 소스는 로컬 MMKV** 다.
 *
 * React Query 를 쓰지 않는 이유: 서버 상태가 아니라 기기 로컬 상태이고, MMKV 는 동기 읽기라
 * 첫 프레임에 이미 값이 있다. `useSyncExternalStore` 로 붙여 두면 검색 성공 시 적립·삭제가
 * 화면 여러 곳에 동시에 반영된다.
 */
export function useRecentSearches(): UseRecentSearchesResult {
  const items = useSyncExternalStore(
    subscribeRecentSearches,
    getRecentSearches,
    getRecentSearches,
  );

  return {
    items,
    remove: removeRecentSearch,
    clear: clearRecentSearches,
  };
}

// ──────────────────────────────────────────── 검색기록 전체삭제 (API-55)

/**
 * 검색기록 전체 삭제 (API-55 — FR-075). SCR-23 `전체 삭제` · SCR-25 설정 · SCR-28 계정삭제 공용.
 *
 * **성공 시 로컬 `search.recent` 도 함께 비운다** (ST-07). 두 소스가 어긋나면
 * "삭제했는데 남아 보인다"가 된다 — 그래서 두 삭제를 호출자에게 맡기지 않고 여기서 묶는다.
 * 낙관적 업데이트는 하지 않는다: 서버가 돌려준 삭제 건수를 토스트 문구에 그대로 써야 하고,
 * 되돌릴 수 없는 파괴적 동작이라 확인 다이얼로그 뒤의 실제 성공을 기다리는 편이 옳다.
 *
 * `['search',…]` 는 **무효화하지 않는다.** 기록을 지웠다고 진행 중인 검색 결과를 다시 받아 올
 * 이유가 없고, 그 재요청이 곧 새 기록 1건이다.
 */
export function useClearSearchHistory(): UseMutationResult<number, SearchError, void> {
  return useMutation<number, SearchError, void>({
    mutationFn: async () => {
      // 오프라인 쓰기 차단. 서버 삭제 건수를 토스트에 써야 하므로 낙관적 처리도 불가능하다.
      const blocked = offlineWriteBlock(NETWORK_COPY.banner);
      if (blocked) throw toSearchError('clearHistory', blocked);
      const res = await clearSearchHistories();
      if (!res.ok) throw toSearchError('clearHistory', res.error);
      return res.data;
    },
    onSuccess: () => {
      clearRecentSearches();
    },
  });
}
