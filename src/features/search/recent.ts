/**
 * 최근 검색어 · 검색기록 (로컬 MMKV + 서버 API-54/55).
 *
 * 정본: wiki/tech/Offline and State.md §1-4(키 정의) · §10 ST-05~ST-07 · §10-1 ST-09~ST-14
 *       wiki/tech/API Contract.md §3-12(SearchHistoryController)
 *       wiki/design/Screen Specs.md SCR-23
 *       wiki/product/Requirements.md FR-069 · FR-074 · FR-075 · FR-130
 *
 * ─────────────────────────── 두 개의 소스, 두 개의 역할 ───────────────────────────
 *
 * | 소스 | 역할 | 쓰는 주체 |
 * |---|---|---|
 * | 로컬 MMKV `search.recent` | 화면의 최근 검색어 **1차 소스** (최대 10건, 30일) | **앱**이 검색 성공 시 적립 |
 * | 서버 `/api/search-histories` | `전체 기록 보기` 에서만 조회 · 설정의 전체 삭제 | **서버**가 검색 API 호출마다 자동 적립 |
 *
 * 이 분리는 성능 최적화가 아니라 **정확성 문제**다. 서버는 검색 API 호출마다 무조건 1건을 남기므로
 * `전체` 검색 1회가 서버에 4행을 만든다(막을 수단이 없다 — ST-13). 로컬은 그 4콜을 `docType:'ALL'`
 * **1건으로** 적립해(ST-12) 최근 검색어 10칸이 한 번의 검색으로 40% 차 버리는 것을 막고,
 * 서버 기록을 보여줄 때는 렌더 단계에서 동일 `query` + 2초 이내를 1건으로 병합한다(`mergeSearchHistories`).
 *
 * ─────────────────────────── MMKV 키에 대한 주의 ───────────────────────────
 *
 * `search.lastDocType` 은 `StorageKey` 에 있지만 **`search.recent` 는 아직 없다.**
 * `store/storage.ts` 는 이 페이즈의 담당 파일이 아니므로 키를 추가하지 않고 여기에 상수로 둔다.
 * 문자열 값은 Offline and State §1-4 표의 키 이름과 **정확히 일치**하며, `StorageKey` 에
 * `searchRecent` 가 추가되면 이 상수를 지우고 그쪽을 import 하면 된다(값은 그대로라 마이그레이션 불필요).
 */

import { request, type ApiResult } from '@/services/http';
import { StorageKey, storage } from '@/store/storage';

import { isSearchDocType, type SearchDocType } from './api';

// ───────────────────────────────────────────────── 로컬 최근 검색어 (MMKV)

/** Offline and State §1-4 의 키 이름 그대로. 위 주석 참조 — `StorageKey` 에 아직 없는 키다. */
const SEARCH_RECENT_KEY = 'search.recent';

/** ST-06 · Conventions 채택값. 11건째부터는 스크롤 없이 보이지 않아 저장 의미가 없다. */
export const RECENT_SEARCH_MAX = 10;

/** 30일 경과 항목은 읽는 시점에 버린다 (§1-4 보존 정책). */
export const RECENT_SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RecentSearch = {
  q: string;
  /** 탭하면 이 유형으로 칩까지 되돌린 뒤 재검색한다. `전체` 검색은 `'ALL'` 로 1건만 남는다. */
  docType: SearchDocType;
  /** 적립 시각(ms). TTL 정리와 정렬에 쓴다. */
  at: number;
};

/**
 * `useSyncExternalStore` 용 스냅샷 캐시.
 *
 * getSnapshot 은 **같은 상태면 같은 참조**를 돌려줘야 한다 — 매번 MMKV 를 파싱해 새 배열을 만들면
 * React 가 무한 렌더로 판단한다. 쓰기(`commit`)에서만 참조를 갈아 끼운다.
 */
let snapshot: RecentSearch[] | null = null;
const listeners = new Set<() => void>();

const isRecentSearch = (value: unknown): value is RecentSearch => {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.q === 'string' &&
    item.q !== '' &&
    isSearchDocType(item.docType) &&
    typeof item.at === 'number' &&
    Number.isFinite(item.at)
  );
};

/**
 * MMKV 원본을 읽어 검증·TTL 정리·상한 적용까지 끝낸다.
 *
 * **정리 결과를 여기서 다시 쓰지 않는다.** 이 함수는 렌더 경로(getSnapshot)에서 불릴 수 있고
 * 렌더 중 저장소 쓰기는 부작용이다. 다음 `commit` 이 정리된 배열을 그대로 영속화한다.
 */
function readRecentSearches(): RecentSearch[] {
  const raw = storage.getString(SEARCH_RECENT_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 앱 버전 간 포맷 변경이나 손상. 조용히 빈 목록으로 되돌린다.
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const cutoff = Date.now() - RECENT_SEARCH_TTL_MS;
  return parsed
    .filter(isRecentSearch)
    .filter((item) => item.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_SEARCH_MAX);
}

function commit(next: RecentSearch[]): RecentSearch[] {
  snapshot = next;
  storage.set(SEARCH_RECENT_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
  return next;
}

/** 현재 최근 검색어. 참조가 안정적이라 `useSyncExternalStore` 의 getSnapshot 으로 바로 쓸 수 있다. */
export function getRecentSearches(): RecentSearch[] {
  if (snapshot === null) snapshot = readRecentSearches();
  return snapshot;
}

export function subscribeRecentSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 검색 **성공 시** 1건 적립 (ST-10 · ST-12).
 *
 * `전체` 검색도 호출은 1회다 — 4콜을 4건으로 적립하지 않는다. 중복 판정은
 * `(q, docType)` 쌍으로 한다: 같은 `김`이라도 `명함`으로 찾은 것과 `티켓`으로 찾은 것은
 * 탭했을 때 복원할 칩이 다르므로 별개 항목이어야 한다.
 */
export function addRecentSearch(q: string, docType: SearchDocType): RecentSearch[] {
  const query = q.trim();
  if (query === '') return getRecentSearches();

  const deduped = getRecentSearches().filter(
    (item) => !(item.q === query && item.docType === docType),
  );
  return commit([{ q: query, docType, at: Date.now() }, ...deduped].slice(0, RECENT_SEARCH_MAX));
}

/** 최근 검색어 `✕` — 로컬은 즉시 지우고, 서버 삭제는 응답을 기다리지 않는다. */
export function removeRecentSearch(q: string, docType: SearchDocType): RecentSearch[] {
  const next = commit(getRecentSearches().filter((item) => !(item.q === q && item.docType === docType)));
  void removeSearchHistoryItem(docType, q);
  return next;
}

export function clearRecentSearches(): RecentSearch[] {
  return commit([]);
}

// ───────────────────────────────────────────── 마지막 사용 유형 (MMKV)

/**
 * 검색 화면 진입 시의 초기 칩 (FR-069 · ST-09).
 *
 * 값이 없거나 열거형 밖이면 **`BUSINESS_CARD`**. `전체`를 기본값으로 두지 않는 이유는
 * 매 진입마다 요청 4배 + 서버 검색기록 4건이기 때문이다. MMKV 는 동기 읽기라
 * 첫 프레임에 이미 올바른 칩이 선택된 상태로 그려진다.
 */
export function readLastSearchDocType(): SearchDocType {
  const stored = storage.getString(StorageKey.searchLastDocType);
  return isSearchDocType(stored) ? stored : 'BUSINESS_CARD';
}

/**
 * **검색 실행 성공 시점**에만 기록한다 (ST-10). 칩을 탭한 시점이 아니다 —
 * 칩만 눌러 보고 나간 사용자의 다음 진입을 바꾸지 않기 위해서다.
 * `'ALL'` 도 그대로 저장한다(ST-11): 명시적으로 전체를 고른 사용자를 명함으로 되돌리면
 * 선택이 무시된 것처럼 느껴진다.
 */
export function writeLastSearchDocType(type: SearchDocType): void {
  storage.set(StorageKey.searchLastDocType, type);
}

/**
 * 로그아웃 정리 (Offline and State §1-4 결정 3).
 * `theme.mode` 는 기기 취향이라 유지하지만 검색 상태는 **계정별 사용 패턴**이므로 전부 지운다 —
 * 다른 계정으로 로그인했을 때 앞 사람의 검색어와 기본 유형이 남아 있으면 안 된다.
 */
export function clearSearchPreferences(): void {
  storage.remove(StorageKey.searchLastDocType);
  clearRecentSearches();
}

// ───────────────────────────────────────────── 서버 검색기록 (API-54/55)

/** `SearchHistoryResponse` — `{id:UUID, documentType, query, createdAt}`. 실측으로 필드명 확인. */
export type SearchHistory = {
  id: string;
  /** 서버가 남긴 유형. 열거형 밖의 값이 오면 `null` 로 두고 화면이 배지를 생략한다. */
  docType: SearchDocType | null;
  query: string;
  /** ISO 문자열. 이 서버의 `LocalDateTime` 은 `"2026-07-28T10:51:57.165603"` 형태다. */
  createdAt: string;
};

/**
 * 검색기록 조회 (API-54).
 *
 * **화면의 최근 검색어 1차 소스가 아니다.** `전체 기록 보기` 에서만 호출한다 (ST-06).
 * 여기서 `staleTime` 을 두지 않는 것은 이 호출이 기록을 **적립하지 않기 때문**이다 —
 * 적립 억제가 필요한 것은 검색 API 4종이지 이 조회가 아니다.
 */
export async function fetchSearchHistories(): Promise<ApiResult<SearchHistory[]>> {
  const res = await request<unknown>('/api/search-histories');
  if (!res.ok) return res;

  const rows = Array.isArray(res.data) ? res.data : [];
  const items: SearchHistory[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    if (typeof item.query !== 'string') continue;
    items.push({
      id: typeof item.id === 'string' ? item.id : '',
      docType: isSearchDocType(item.documentType) ? item.documentType : null,
      query: item.query,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    });
  }
  return { ok: true, data: items };
}

/**
 * 검색기록 전체 삭제 (API-55). 응답 `data` 는 **스칼라 숫자**(삭제 건수)다 — 객체가 아니다.
 *
 * 호출자는 성공 시 **반드시 로컬 `search.recent` 도 비워야 한다**(ST-07). 두 소스가 어긋나면
 * "삭제했는데 남아 보인다"가 된다. `queries.ts` 의 `useClearSearchHistory` 가 그 짝을 강제한다.
 */
export async function clearSearchHistories(): Promise<ApiResult<number>> {
  const res = await request<unknown>('/api/search-histories', { method: 'DELETE' });
  if (!res.ok) return res;

  const deleted = typeof res.data === 'number' ? res.data : Number(res.data);
  return { ok: true, data: Number.isFinite(deleted) ? deleted : 0 };
}

export async function removeSearchHistoryItem(
  docType: SearchDocType,
  q: string,
): Promise<ApiResult<number>> {
  const params = new URLSearchParams({ q: q.trim() });
  if (docType !== 'ALL') params.set('documentType', docType);

  const res = await request<unknown>(`/api/search-histories/item?${params.toString()}`, {
    method: 'DELETE',
  });
  if (!res.ok) return res;

  const deleted = typeof res.data === 'number' ? res.data : Number(res.data);
  return { ok: true, data: Number.isFinite(deleted) ? deleted : 0 };
}

// ───────────────────────────────────────────── 서버 기록 병합 표시 (ST-13)

/** 같은 검색 1회가 서버에 남긴 여러 행으로 인정하는 시간 폭. */
export const SEARCH_HISTORY_MERGE_WINDOW_MS = 2_000;

export type SearchHistoryGroup = {
  /** 대표 행의 id. 리스트 key 로 쓴다. */
  id: string;
  query: string;
  /** 병합된 행들의 유형. `전체` 검색이면 4종이 들어온다. */
  docTypes: SearchDocType[];
  /** 그룹에서 가장 최근 시각(ISO). */
  createdAt: string;
  /** 병합된 서버 행 수. 화면에는 보통 노출하지 않는다(디버깅·검증용). */
  count: number;
};

/**
 * 서버 기록 병합 표시 (ST-13).
 *
 * `전체` 검색 1회는 서버에 **4행**을 남긴다. 앱이 막을 수 없으므로 렌더 단계에서
 * 동일 `query` + `createdAt` 2초 이내를 1건으로 묶어 사용자에게 4줄을 보여주지 않는다.
 *
 * 2초인 이유: 4콜이 병렬로 나가고 서버가 검색 실행 **전에** 기록하므로 4행의 시각차는
 * 실측상 수십 ms 수준이다. 2초는 느린 네트워크까지 감싸면서, 사용자가 같은 검색어를
 * 의도적으로 다시 실행한 경우(수 초 이상 간격)와는 겹치지 않는 폭이다.
 */
export function mergeSearchHistories(list: readonly SearchHistory[]): SearchHistoryGroup[] {
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: SearchHistoryGroup[] = [];
  // 그룹별 "가장 오래된" 시각(ms). 내림차순 순회라 다음 항목과 비교할 기준이 된다.
  const oldestAt: number[] = [];

  for (const item of sorted) {
    const at = Date.parse(item.createdAt);
    const last = groups[groups.length - 1];
    const lastOldest = oldestAt[oldestAt.length - 1];

    const mergeable =
      last !== undefined &&
      lastOldest !== undefined &&
      last.query === item.query &&
      Number.isFinite(at) &&
      Number.isFinite(lastOldest) &&
      lastOldest - at <= SEARCH_HISTORY_MERGE_WINDOW_MS;

    if (mergeable && last !== undefined) {
      if (item.docType !== null && !last.docTypes.includes(item.docType)) {
        last.docTypes.push(item.docType);
      }
      last.count += 1;
      if (Number.isFinite(at)) oldestAt[oldestAt.length - 1] = at;
      continue;
    }

    groups.push({
      id: item.id,
      query: item.query,
      docTypes: item.docType === null ? [] : [item.docType],
      createdAt: item.createdAt,
      count: 1,
    });
    oldestAt.push(Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY);
  }

  return groups;
}
