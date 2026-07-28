/**
 * 목 모드 인메모리 저장소 + MMKV 영속 (키 `mock.db`).
 *
 * 목이라도 **껐다 켜면 사라지는 데이터는 가짜처럼 느껴진다.** 저장·수정·삭제 결과가 남아야
 * 디자인 검증이 성립하므로 전체 DB 를 JSON 한 덩어리로 MMKV 에 적는다.
 * (토큰은 여기 두지 않는다 — 세션 토큰은 앱이 SecureStore 에 따로 보관한다.)
 *
 * 자동 재씨딩 규칙: `dirty === false` 인 상태로 **날짜가 바뀌면** 씨드를 다시 만든다.
 * 씨드의 날짜가 전부 상대값(오늘/오늘+3일…)이라, 그대로 두면 며칠 뒤에는 `마감 임박`도
 * `오늘 일정`도 비어 버리기 때문이다. 사용자가 한 번이라도 데이터를 고치면(`dirty`) 보존한다.
 */

import { storage } from '@/store/storage';

import {
  createSeed,
  MOCK_DB_VERSION,
  todayDate,
  type MockData,
  type MockPoster,
  type MockReceipt,
  type MockTicket,
} from './fixtures';

/** Offline and State 의 키 표에 없는 목 전용 키다. 실서버 모드에서는 절대 생기지 않는다. */
export const MOCK_DB_KEY = 'mock.db';

let cache: MockData | null = null;

// ───────────────────────────────────────────────────────────── 로드 · 저장

function persist(data: MockData): void {
  try {
    storage.set(MOCK_DB_KEY, JSON.stringify(data));
  } catch {
    // 직렬화 실패(순환 참조 등)는 목 동작을 막을 이유가 되지 않는다. 메모리 상태로 계속 간다.
  }
}

/** 영속된 값이 현재 스키마로 쓸 수 있는 모양인지 최소한만 확인한다. */
function isUsable(value: unknown): value is MockData {
  if (value === null || typeof value !== 'object') return false;
  const d = value as Partial<MockData>;
  return (
    d.version === MOCK_DB_VERSION &&
    Array.isArray(d.cards) &&
    Array.isArray(d.posters) &&
    Array.isArray(d.tickets) &&
    Array.isArray(d.receipts) &&
    Array.isArray(d.cardGroups) &&
    Array.isArray(d.notifications) &&
    Array.isArray(d.searchHistories) &&
    typeof d.user === 'object' &&
    d.user !== null
  );
}

function load(): MockData {
  const raw = storage.getString(MOCK_DB_KEY);
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (isUsable(parsed)) {
      // 손대지 않은 씨드가 하루 지났으면 날짜를 되살린다(위 주석 참조).
      if (!parsed.dirty && parsed.seededOn !== todayDate()) {
        const fresh = createSeed();
        // 세션은 유지한다 — 재씨딩 때문에 로그인이 풀리면 그게 더 이상하다.
        fresh.session = parsed.session;
        fresh.user.email = parsed.user.email;
        fresh.user.name = parsed.user.name;
        persist(fresh);
        return fresh;
      }
      return parsed;
    }
  }

  const seed = createSeed();
  persist(seed);
  return seed;
}

/** 현재 DB. 최초 호출에서 MMKV 를 읽고 이후에는 메모리 캐시를 돌려준다. */
export function readDb(): MockData {
  if (cache === null) cache = load();
  return cache;
}

/**
 * DB 를 고치고 영속한다.
 *
 * `dirty` 는 **도메인 데이터 변경**에서만 세운다. 로그인 세션이나 검색기록 적립처럼
 * 매 실행마다 자동으로 발생하는 쓰기까지 `dirty` 로 치면 자동 재씨딩이 영영 돌지 않는다.
 */
export function mutate<T>(fn: (data: MockData) => T, options: { dirty?: boolean } = {}): T {
  const data = readDb();
  const result = fn(data);
  if (options.dirty !== false) data.dirty = true;
  persist(data);
  return result;
}

/** 씨드 복원. 진단 화면이나 개발자 콘솔에서 호출한다. */
export function resetDb(): MockData {
  const seed = createSeed();
  cache = seed;
  persist(seed);
  return seed;
}

/** 메모리 캐시만 버린다(다음 접근에서 MMKV 재로드). 테스트용. */
export function invalidateDbCache(): void {
  cache = null;
}

// ───────────────────────────────────────────────────────────── 시퀀스

export type IntIdKind = 'poster' | 'ticket' | 'receipt' | 'receiptItem';

/** IDENTITY PK 발급. 포스터·티켓·영수증은 Integer 다(명함·그룹·알림만 UUID). */
export function nextIntId(kind: IntIdKind): number {
  return mutate((data) => {
    data.seq[kind] += 1;
    return data.seq[kind];
  });
}

// ───────────────────────────────────────────────────────────── 정렬 · 페이지

/** 서버는 4종 목록·알림을 전부 `createdAt DESC` 로 고정 정렬한다. */
export function sortByCreatedAtDesc<T extends { createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Spring `Page<>` 평면 직렬화 결과. `pageable` 까지 실측 응답과 같은 키를 채운다. */
export type FlatPage<T> = {
  content: T[];
  pageable: {
    pageNumber: number;
    pageSize: number;
    offset: number;
    paged: boolean;
    unpaged: boolean;
    sort: { sorted: boolean; unsorted: boolean; empty: boolean };
  };
  last: boolean;
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  sort: { sorted: boolean; unsorted: boolean; empty: boolean };
  first: boolean;
  numberOfElements: number;
  empty: boolean;
};

const SORT_META = { sorted: true, unsorted: false, empty: false } as const;

/**
 * 평면 Page 조립. **`last` 를 정확히 계산해야 한다** — 앱의 무한 스크롤 종료 판정이
 * `totalPages` 가 아니라 이 플래그 하나에 걸려 있다(`unwrapDocumentPage`).
 */
export function paginate<T>(rows: readonly T[], page: number, size: number): FlatPage<T> {
  const safeSize = size > 0 ? size : 20;
  const safePage = page > 0 ? page : 0;
  const totalElements = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / safeSize));
  const offset = safePage * safeSize;
  const content = rows.slice(offset, offset + safeSize);

  return {
    content,
    pageable: {
      pageNumber: safePage,
      pageSize: safeSize,
      offset,
      paged: true,
      unpaged: false,
      sort: { ...SORT_META },
    },
    last: offset + content.length >= totalElements,
    totalElements,
    totalPages,
    size: safeSize,
    number: safePage,
    sort: { ...SORT_META },
    first: safePage === 0,
    numberOfElements: content.length,
    empty: content.length === 0,
  };
}

// ───────────────────────────────────────────────────────────── 검색 점수

/** 비교용 정규화 — 소문자 + 연속 공백 1칸. 하이픈은 남긴다(전화번호 검색이 죽는다). */
const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** 한 필드가 한 토큰을 얼마나 잘 담고 있는가 (0 = 불일치, 1 = 완전 일치). */
function fieldScore(field: string, token: string): number {
  const haystack = normalize(field);
  if (haystack === '' || token === '') return 0;
  if (haystack === token) return 1;

  const index = haystack.indexOf(token);
  if (index < 0) return 0;

  // 짧은 검색어가 긴 원문에 우연히 걸린 경우를 낮게 본다. 앞쪽에서 걸리면 가산한다.
  const ratio = Math.min(1, token.length / haystack.length);
  const base = index === 0 ? 0.72 : 0.55;
  return Math.min(0.99, base + 0.28 * ratio);
}

/**
 * 문자열 부분일치 기반 유사도. 실제 임베딩이 없으므로 **0.6~0.98 로 사상**한다 —
 * 실서버의 하이브리드 점수(`Fuzzy × 0.6 + Vector × 0.4`)와 같은 대역이라 화면에서 어색하지 않다.
 *
 * 결정적(deterministic)이다. 같은 질의는 항상 같은 순서를 만들어야 정렬 토글이 흔들리지 않는다.
 * 하나도 걸리지 않으면 `null` → 호출부가 결과에서 제외한다.
 */
export function matchScore(fields: readonly string[], query: string): number | null {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return null;

  let sum = 0;
  let matched = 0;

  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      const score = fieldScore(field, token);
      if (score > best) best = score;
    }
    if (best > 0) {
      matched += 1;
      sum += best;
    }
  }

  if (matched === 0) return null;

  // 토큰 커버리지(몇 개나 걸렸는가)를 곱해 "일부만 걸린 질의"를 아래로 민다.
  const coverage = matched / tokens.length;
  const quality = Math.min(1, (sum / matched) * (0.55 + 0.45 * coverage));
  return Math.round((0.6 + 0.38 * quality) * 10_000) / 10_000;
}

// ───────────────────────────────────────────────────────── 검색 대상 필드

/** 종별 검색 대상 필드. 서버가 임베딩에 넣는 텍스트와 같은 범위로 맞춘다. */
export function cardSearchFields(row: {
  name: string;
  company: string;
  position: string;
  phone: string;
  email: string;
  rawOcrText: string;
}): string[] {
  return [row.name, row.company, row.position, row.phone, row.email, row.rawOcrText];
}

export function posterSearchFields(row: MockPoster): string[] {
  return [
    row.title,
    row.organizerName,
    row.location,
    row.fee,
    row.description,
    row.contactPhone,
    row.contactEmail,
    row.eventStartDate,
    row.eventEndDate,
    row.rawText,
  ];
}

export function ticketSearchFields(row: MockTicket): string[] {
  return [
    row.transportType,
    row.departureLocation,
    row.arrivalLocation,
    row.departureDate,
    row.arrivalDate,
    row.departureTime,
    row.rawText,
  ];
}

export function receiptSearchFields(row: MockReceipt): string[] {
  return [
    row.merchantName,
    row.merchantAddress,
    row.paymentMethod,
    row.cardCompany,
    row.purchaseDate,
    row.rawText,
    ...row.items.map((item) => item.itemName),
  ];
}

// ───────────────────────────────────────────────────────────── 조회 헬퍼

/** 명함 그룹 필터. `ungrouped=true` 와 `groupId=<uuid>` 는 서버에서도 배타적이다. */
export function filterCardsByGroup(
  rows: MockData['cards'],
  query: { groupId?: string | undefined; ungrouped?: boolean },
): MockData['cards'] {
  if (query.ungrouped === true) return rows.filter((row) => row.groupId === null);
  if (query.groupId) return rows.filter((row) => row.groupId === query.groupId);
  return rows;
}
