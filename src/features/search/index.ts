/**
 * 검색 데이터 레이어 (Phase 5) 배럴.
 *
 * 화면(`app/(tabs)/search.tsx`)은 이 파일만 import 한다.
 * 계층 규약은 문서 계층과 같다 — 화면은 **훅·앱 모델·문구 상수만** 쓴다.
 * `request()` 나 서버 DTO 에 직접 손대는 화면 코드는 리뷰 반려 대상이다.
 *
 * 화면이 반드시 지켜야 하는 계약 3가지:
 *  1. `useSearch` 에는 입력창 값이 아니라 **제출된 검색어**를 넘긴다 (FR-071 디바운스 금지).
 *  2. 초기 칩은 `readLastSearchDocType()` 으로 복원한다. 저장은 훅이 실행 성공 시 알아서 한다.
 *  3. 정렬 토글은 `useSearch` 의 `order` 옵션으로만 바꾼다 — 재요청이 발생하면 안 된다.
 */

// ── 검색 어휘 · 모델 ─────────────────────────────────────────────────
export type {
  SearchDocType,
  SearchHit,
  SearchResults,
  SearchSortOrder,
  SearchTypeFailure,
} from './api';
export {
  SEARCH_DOC_TYPES,
  SEARCH_DOC_TYPE_LABELS,
  SEARCH_PARALLEL_TYPES,
  SEARCH_TOP_K,
  isSearchDocType,
} from './api';

// ── 네트워크 ─────────────────────────────────────────────────────────
export { runSearch, searchAllDocuments, searchDocuments, sortSearchHits, toSearchHit } from './api';

// ── 최근 검색어 · 검색기록 삭제 ─────────────────────────────────────
export type { RecentSearch } from './recent';
export {
  RECENT_SEARCH_MAX,
  RECENT_SEARCH_TTL_MS,
  addRecentSearch,
  clearRecentSearches,
  clearSearchHistories,
  clearSearchPreferences,
  getRecentSearches,
  readLastSearchDocType,
  removeRecentSearch,
  subscribeRecentSearches,
  writeLastSearchDocType,
} from './recent';

// ── React Query ──────────────────────────────────────────────────────
export type { SearchOperation, UseRecentSearchesResult, UseSearchOptions } from './queries';
export {
  SEARCH_COPY,
  SearchError,
  searchHistoryClearedMessage,
  searchKeys,
  searchPartialFailureNotice,
  searchResultCountLabel,
  toSearchError,
  useClearSearchHistory,
  useRecentSearches,
  useSearch,
} from './queries';
