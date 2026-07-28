/**
 * 보관함 문서 4종 React Query 계층.
 *
 * 정본: wiki/tech/API Contract.md §6(키 설계·옵션·무효화)
 *       wiki/tech/Offline and State.md §2(전역 설정) · §3(키별 정책) · §11(낙관적 업데이트)
 *
 * ─────────────────────────────── 쿼리 키 컨벤션 ───────────────────────────────
 *
 *   ['documents']                              ← 문서 전체 루트 (로그아웃/전체삭제 시 한 방에)
 *   ['documents', type]                        ← 종별 루트 (저장/수정/삭제 후 무효화 단위)
 *   ['documents', type, 'list', params]        ← 무한 목록. params = { size, group }
 *   ['documents', type, 'detail', String(id)]  ← 단건
 *
 * 위키 §6-1 은 `['cards','list',p]` 처럼 종별 최상위 키를 쓰지만, 앱은 종류를 **두 번째 세그먼트**로
 * 내려 `['documents', type]` 접두사 하나로 4종을 일관되게 다룬다. 이유 2가지:
 *  1. 목록·상세·수정·삭제 훅을 종류당 하나씩 4벌 만들지 않고 제네릭 1벌로 유지할 수 있다.
 *  2. 무효화가 접두사 매칭 한 줄로 끝난다 — 위키 §6-3 의 대상("해당 종류 목록 + 상세")과
 *     `['documents', type]` 이 정확히 1:1 이다.
 * `id` 를 `String()` 으로 고정하는 이유: 명함은 UUID(string), 나머지는 Integer(number) 라
 * 같은 문서를 숫자/문자로 각각 조회하면 캐시가 두 벌 생긴다.
 *
 * ─────────────────────────────── 무효화 규칙 ───────────────────────────────
 *
 * | 액션          | 무효화 대상                                     | 낙관적 |
 * |---------------|-------------------------------------------------|--------|
 * | 문서 수정     | `['documents', type]` + `['dashboard']`          | O      |
 * | 문서 삭제     | `['documents', type]` + `['dashboard']`          | O      |
 * | 그룹 변경     | `['documents','BUSINESS_CARD']` + `['cardGroups']` | O    | ← groups.ts
 *
 * `['search', ...]` 는 **여기서 건드리지 않는다.** 검색 쿼리를 무효화하면 재요청이 나가고
 * 재요청 1회가 곧 서버 검색기록 1건이다(`전체` 는 4건). 검색 캐시의 정합성보다 기록 오염 방지가
 * 우선이라는 것이 위키의 결정이며(§3-16, ST-05), 무효화가 필요하면 검색 화면 소유자가
 * `refetchType: 'none'` 과 함께 스스로 건다.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { NETWORK_COPY, offlineWriteBlock } from '@/features/network';
import type { AppError } from '@/services/http';

import {
  DOCUMENT_PAGE_SIZE,
  deleteDocument,
  fetchDocument,
  listDocuments,
  updateDocument,
} from './api';
import { toDocumentSummaries } from './mappers';
import {
  type CardGroupFilter,
  type DocumentDeleteInput,
  type DocumentDetail,
  type DocumentDetailFor,
  type DocumentPage,
  type DocumentSummary,
  type DocumentType,
  type DocumentUpdateInput,
} from './types';

// ───────────────────────────────────────────────────────────── 쿼리 키

type ListKeyParams = { size: number; group?: CardGroupFilter };

export const documentKeys = {
  /** 문서 전체 루트. 로그아웃·내 문서 전체 삭제(API-62) 때 이 하나만 지우면 된다. */
  all: () => ['documents'] as const,
  /** 종별 루트. 저장·수정·삭제 후 무효화 단위. */
  ofType: (type: DocumentType) => ['documents', type] as const,
  /** 종별 목록 전체(파라미터 무관). 그룹 필터별로 캐시가 여러 개라 접두사로 묶는다. */
  lists: (type: DocumentType) => ['documents', type, 'list'] as const,
  list: (type: DocumentType, params: ListKeyParams) =>
    ['documents', type, 'list', params] as const,
  detail: (type: DocumentType, id: string | number) =>
    ['documents', type, 'detail', String(id)] as const,
} as const;

/** 대시보드는 다른 담당의 키다. 접두사로만 건드린다 (§6-3 무효화 매트릭스). */
const DASHBOARD_KEY = ['dashboard'] as const;

// ───────────────────────────────────────────────────────────── 에러 · 문구

/** 위키 문구표(Screen Specs SCR-15~SCR-20, 부록 토스트 표)를 그대로 옮긴 것. 새로 짓지 않는다. */
export const DOCUMENT_COPY = {
  listFailed: {
    BUSINESS_CARD: '명함을 불러오지 못했습니다.',
    POSTER: '포스터를 불러오지 못했습니다.',
    RECEIPT: '영수증을 불러오지 못했습니다.',
    TICKET: '티켓을 불러오지 못했습니다.',
  } satisfies Record<DocumentType, string>,
  detailFailed: '문서를 불러오지 못했습니다.',
  updated: '수정했습니다.',
  updateFailed: '수정 실패',
  deleted: {
    BUSINESS_CARD: '명함을 삭제했습니다.',
    POSTER: '포스터를 삭제했습니다.',
    RECEIPT: '영수증을 삭제했습니다.',
    TICKET: '티켓을 삭제했습니다.',
  } satisfies Record<DocumentType, string>,
  deleteFailed: '삭제에 실패했습니다.',
  refreshFailed: '새로고침에 실패했습니다.',
} as const;

export type DocumentOperation = 'list' | 'detail' | 'update' | 'delete';

/**
 * React Query 가 `error` 로 들고 다닐 에러.
 *
 * `message` 는 **이미 완성된 한국어 화면 문구**다. 서버가 준 `error` 문장은 한/영이 혼재하고
 * 인코딩이 깨질 수 있어 UI 에 쓰지 않는다 (API Contract §4-5). 화면은 `error.message` 를
 * 그대로 토스트/에러 카드에 넣으면 된다.
 */
export class DocumentError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: DocumentOperation;

  constructor(message: string, error: AppError, operation: DocumentOperation) {
    super(message);
    this.name = 'DocumentError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function documentErrorMessage(
  operation: DocumentOperation,
  type: DocumentType,
  error: AppError,
): string {
  // 연결/타임아웃/세션만료는 http.ts 가 이미 상태코드 기준 정본 문구를 만들어 둔다.
  if (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'unauthorized') {
    return error.message;
  }
  if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

  switch (operation) {
    case 'list':
      return DOCUMENT_COPY.listFailed[type];
    case 'detail':
      return DOCUMENT_COPY.detailFailed;
    case 'update':
      return DOCUMENT_COPY.updateFailed;
    case 'delete':
      return DOCUMENT_COPY.deleteFailed;
  }
}

export function toDocumentError(
  operation: DocumentOperation,
  type: DocumentType,
  error: AppError,
): DocumentError {
  return new DocumentError(documentErrorMessage(operation, type, error), error, operation);
}

// ───────────────────────────────────────────────────────────── 캐시 조작 헬퍼

type DocumentInfinite = InfiniteData<DocumentPage, number>;

const sameId = (doc: DocumentDetail, id: string | number) => String(doc.id) === String(id);

/** 무한 목록 전 페이지에서 항목 1건을 제거한다. `totalElements` 도 함께 줄인다. */
function removeFromPages(data: DocumentInfinite | undefined, id: string | number) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => {
      const items = page.items.filter((doc) => !sameId(doc, id));
      if (items.length === page.items.length) return page;
      return {
        ...page,
        items,
        page: { ...page.page, totalElements: Math.max(0, page.page.totalElements - 1) },
      };
    }),
  };
}

/** 무한 목록 전 페이지에서 항목 1건을 교체한다. */
function replaceInPages(data: DocumentInfinite | undefined, next: DocumentDetail) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((doc) => (sameId(doc, next.id) ? next : doc)),
    })),
  };
}

/** 목록 캐시(파라미터별로 여러 벌)를 뒤져 상세 초기값을 찾는다. 시트 진입 시 스켈레톤을 없앤다. */
function findInLists(
  queryClient: QueryClient,
  type: DocumentType,
  id: string | number,
): DocumentDetail | undefined {
  const entries = queryClient.getQueriesData<DocumentInfinite>({
    queryKey: documentKeys.lists(type),
  });
  for (const [, data] of entries) {
    for (const page of data?.pages ?? []) {
      const hit = page.items.find((doc) => sameId(doc, id));
      if (hit) return hit;
    }
  }
  return undefined;
}

/** 수정 입력의 `undefined` 를 걷어내고 상세 모델에 얕게 병합한다 (낙관적 반영용). */
function mergePatch(doc: DocumentDetail, input: DocumentUpdateInput): DocumentDetail {
  if (doc.type !== input.type) return doc;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.values as Record<string, unknown>)) {
    if (value !== undefined) patch[key] = value;
  }
  return { ...doc, ...patch } as DocumentDetail;
}

// ───────────────────────────────────────────────────────────── 목록

export type UseInfiniteDocumentsOptions = {
  /** 페이지 크기. 기본 20 (서버 기본은 10 이라 반드시 명시 전송한다). */
  size?: number;
  /** 명함 전용 그룹 필터. `'all'`/`'ungrouped'`/그룹 UUID. */
  group?: CardGroupFilter;
  enabled?: boolean;
};

/**
 * 종별 무한 목록 (API-14 / API-43 / API-49 / API-57).
 *
 * **종료 판정은 Spring `Page.last` 플래그만 본다.** `totalPages` 로 계산하면 서버가 값을
 * 빠뜨렸을 때 마지막 페이지를 무한 재요청한다.
 * `staleTime` 30초 — 보관함은 본인만 쓰는 단일 소유 데이터라 서버에서 몰래 바뀌지 않고,
 * Hikari pool 이 3이라 탭 이동마다 재요청하면 서버를 불필요하게 압박한다.
 */
export function useInfiniteDocuments(type: DocumentType, options: UseInfiniteDocumentsOptions = {}) {
  const size = options.size ?? DOCUMENT_PAGE_SIZE;
  const group = type === 'BUSINESS_CARD' ? (options.group ?? 'all') : undefined;

  const query = useInfiniteQuery<DocumentPage, DocumentError, DocumentInfinite, readonly unknown[], number>({
    queryKey: documentKeys.list(type, group === undefined ? { size } : { size, group }),
    queryFn: async ({ pageParam }) => {
      const res = await listDocuments(type, {
        page: pageParam,
        size,
        ...(group === undefined ? {} : { group }),
      });
      if (!res.ok) throw toDocumentError('list', type, res.error);
      return res.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.page.last ? undefined : lastPage.page.number + 1),
    staleTime: 30_000,
    /* `gcTime` 을 개별 지정하지 않는다 — 전역 기본값 30분(Offline and State §2)을 그대로 쓴다.
       예전의 10분 override 는 오프라인 열람(FR-101)의 실효 시간을 3분의 1로 잘라먹었다:
       보관함을 보고 탭을 몇 번 옮긴 뒤 지하철에 들어가면 캐시가 이미 수거돼 빈 화면이 된다. */
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });

  const documents = useMemo<DocumentDetail[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );
  const summaries = useMemo<DocumentSummary[]>(() => toDocumentSummaries(documents), [documents]);
  const total = query.data?.pages[0]?.page.totalElements ?? 0;

  return {
    ...query,
    /** 평탄화된 상세 모델. 상세 시트가 목록 캐시를 그대로 재사용한다. */
    documents,
    /** 목록 카드가 바로 쓰는 뷰모델. */
    summaries,
    /** 서버가 알려준 전체 건수. 헤더의 `티켓 8` 같은 카운트에 쓴다. */
    total,
    isEmpty: !query.isPending && documents.length === 0,
  };
}

// ───────────────────────────────────────────────────────────── 상세

/**
 * 단건 조회 (API-15 / API-44 / API-50 / API-58).
 * 목록 캐시에 이미 있으면 `initialData` 로 주입해 시트가 즉시 그려지게 한다.
 * `initialDataUpdatedAt: 0` 이라 화면은 캐시로 그리고 검증은 백그라운드로 돈다.
 */
export function useDocument<T extends DocumentType>(
  type: T,
  id: string | number | undefined,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const seed = id === undefined ? undefined : findInLists(queryClient, type, id);

  return useQuery<DocumentDetail, DocumentError, DocumentDetailFor<T>>({
    queryKey: documentKeys.detail(type, id ?? ''),
    queryFn: async () => {
      const res = await fetchDocument(type, id ?? '');
      if (!res.ok) throw toDocumentError('detail', type, res.error);
      return res.data;
    },
    // 어댑터가 `type` 판별자를 반드시 채우므로 런타임에 안전한 좁히기다.
    // 화면이 `doc.type === 'TICKET' ? ... : ...` 분기를 반복하지 않게 여기서 끝낸다.
    select: (doc) => doc as DocumentDetailFor<T>,
    enabled: id !== undefined && options.enabled !== false,
    staleTime: 60_000,
    // gcTime 은 전역 30분(Offline and State §2). 상세도 오프라인에서 열람 대상이다.
    ...(seed ? { initialData: seed, initialDataUpdatedAt: 0 } : {}),
  });
}

// ───────────────────────────────────────────────────────────── 수정

/**
 * 문서 수정 (API-16 / API-45 / API-51 / API-59) — OPT-06 낙관적 병합.
 *
 * 낙관적으로 반영하는 이유: 편집 화면은 사용자가 방금 입력한 값을 알고 있고, 서버 응답이
 * 그 값을 그대로 되돌려 준다. 저장 버튼을 누른 뒤 스피너 동안 옛 값이 보이면 "저장이 안 됐나?"가 된다.
 * 실패 시에는 스냅샷을 **전량 복원**하고 토스트로 알린다 — 조용한 롤백은 버그로 신고된다(R4).
 */
export function useUpdateDocument(): UseMutationResult<
  DocumentDetail,
  DocumentError,
  DocumentUpdateInput,
  { snapshot: [readonly unknown[], unknown][] }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DocumentUpdateInput) => {
      // OFF-05 — 오프라인 쓰기는 큐잉하지 않고 시도 전에 실패시킨다 (Offline and State §5-1/§5-2).
      const blocked = offlineWriteBlock(NETWORK_COPY.editBlocked);
      if (blocked) throw toDocumentError('update', input.type, blocked);

      const res = await updateDocument(input);
      if (!res.ok) throw toDocumentError('update', input.type, res.error);
      return res.data;
    },

    onMutate: async (input) => {
      /* 오프라인이면 낙관적 반영을 **아예 하지 않는다.** 어차피 `mutationFn` 이 즉시 던지므로
         반영했다가 되돌리면 화면이 한 번 깜빡이고 사용자는 "저장됐다가 취소됐다"고 읽는다. */
      if (offlineWriteBlock()) return { snapshot: [] };

      // ① 진행 중 refetch 를 먼저 끊는다. 안 끊으면 그 응답이 낙관적 상태를 덮어쓴다 (R1).
      await queryClient.cancelQueries({ queryKey: documentKeys.ofType(input.type) });
      // ② 스냅샷은 복수형으로 뜬다 — 무한 쿼리는 페이지가 여럿이고 명함은 필터별 캐시가 여럿이다 (R2).
      const snapshot = queryClient.getQueriesData({
        queryKey: documentKeys.ofType(input.type),
      }) as [readonly unknown[], unknown][];

      const detailKey = documentKeys.detail(input.type, input.id);
      queryClient.setQueryData<DocumentDetail>(detailKey, (old) =>
        old ? mergePatch(old, input) : old,
      );
      queryClient.setQueriesData<DocumentInfinite>(
        { queryKey: documentKeys.lists(input.type) },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((doc) =>
                sameId(doc, input.id) ? mergePatch(doc, input) : doc,
              ),
            })),
          };
        },
      );

      return { snapshot };
    },

    onError: (_error, _input, context) => {
      // ③ 부분 복원은 페이지 경계가 어긋난다. 스냅샷 전량 복원이 원칙이다 (R3).
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },

    onSuccess: (saved, input) => {
      // 서버가 돌려준 값이 정본이다. 날짜 파싱 실패로 값이 사라졌을 수도 있어 반드시 덮어쓴다.
      queryClient.setQueryData(documentKeys.detail(input.type, input.id), saved);
      queryClient.setQueriesData<DocumentInfinite>(
        { queryKey: documentKeys.lists(input.type) },
        (old) => replaceInPages(old, saved),
      );
    },

    onSettled: (_saved, _error, input) => {
      // ④ 성공·실패 무관하게 정합화한다 (R5).
      void queryClient.invalidateQueries({ queryKey: documentKeys.ofType(input.type) });
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}

// ───────────────────────────────────────────────────────────── 삭제

/**
 * 문서 삭제 (API-17 / API-46 / API-53 / API-60) — OPT-01 낙관적 제거 + 실패 시 롤백.
 *
 * 연속 삭제(R7) — `mutate()` 호출마다 독립 context(스냅샷)를 갖는다. 다만 A·B 가 겹친 상태에서
 * A 만 실패하면 A 의 스냅샷이 B 가 지운 항목까지 되살린다. 이 잔상은 `onSettled` 의
 * `invalidateQueries` 가 곧바로 서버 값으로 정정한다 — 롤백 정확도보다 스냅샷 전량 복원(R3)의
 * 단순함을 택한 결과이며, 위키가 요구하는 "조용한 롤백 금지"(R4)와 함께 동작한다.
 * 되돌림에 애니메이션을 쓰지 않는다 — 즉시 복원하고 토스트로 설명한다 (R6).
 */
export function useDeleteDocument(): UseMutationResult<
  void,
  DocumentError,
  DocumentDeleteInput,
  { snapshot: [readonly unknown[], unknown][] }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DocumentDeleteInput) => {
      // OFF-05 — 오프라인 삭제는 큐잉하지 않는다. 서버에 멱등키가 없어 재생이 곧 사고다.
      const blocked = offlineWriteBlock(NETWORK_COPY.editBlocked);
      if (blocked) throw toDocumentError('delete', input.type, blocked);

      const res = await deleteDocument(input);
      if (!res.ok) throw toDocumentError('delete', input.type, res.error);
    },

    onMutate: async (input) => {
      // 오프라인이면 낙관적 제거를 하지 않는다 — 사라졌다가 되살아나는 것이 가장 나쁜 피드백이다.
      if (offlineWriteBlock()) return { snapshot: [] };

      await queryClient.cancelQueries({ queryKey: documentKeys.ofType(input.type) });
      const snapshot = queryClient.getQueriesData({
        queryKey: documentKeys.ofType(input.type),
      }) as [readonly unknown[], unknown][];

      queryClient.setQueriesData<DocumentInfinite>(
        { queryKey: documentKeys.lists(input.type) },
        (old) => removeFromPages(old, input.id),
      );
      queryClient.removeQueries({ queryKey: documentKeys.detail(input.type, input.id) });

      return { snapshot };
    },

    onError: (_error, _input, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },

    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: documentKeys.ofType(input.type) });
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}
