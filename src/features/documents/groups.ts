/**
 * 명함 그룹(명함첩) 데이터 계층 — API-18 · API-20~23.
 *
 * 정본: wiki/tech/API Contract.md §3-3 · §6-3
 *       wiki/design/Screen Specs.md SCR-22(명함 그룹 관리) · SCR-15(그룹 칩)
 *       원본 DTO: backend/dto/card/{CardGroupRequest,CardGroupResponse,CardMoveGroupRequest}.java
 *       원본 서비스: backend/service/CardGroupService.java, CardService.moveGroup
 *
 * 이 컨트롤러만 다른 점 2가지
 *  1. **실패가 400 이다.** Card/Ticket/Poster/Receipt 는 도메인 실패도 500 을 쓰는데
 *     `CardGroupController` 만 `badRequest` 를 쓴다. 400 을 세션 만료로 오해하면 안 된다
 *     (세션 만료 400 은 `/auth/me*` 경로에 한정 — Offline and State §9).
 *  2. **이름 유일성 검증이 서버에 있다.** `UNIQUE(user_id, name)` 이고 중복이면
 *     `이미 존재하는 그룹명입니다.` 를 400 으로 던진다. 서버 문구는 UI 에 쓰지 않고
 *     상태코드로만 분기한다 (API Contract §4-5).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

import { request, unwrapList, type ApiResult, type AppError } from '@/services/http';

import { toCardDetail, toCardGroup } from './mappers';
import { documentKeys } from './queries';
import {
  type CardDetail,
  type CardGroup,
  type CardGroupDto,
  type CardGroupFilter,
  type DocumentDetail,
  type DocumentPage,
  type Uuid,
} from './types';

// ───────────────────────────────────────────────────────────── 상수

const GROUP_PATH = '/api/card-groups';

/** DB 컬럼 `String(60)` + 서버 `MAX_GROUP_NAME_LENGTH = 60`. 앱이 먼저 막는다. */
export const CARD_GROUP_NAME_MAX = 60;

/** Screen Specs SCR-22 · Component Library 고정 항목. `전체명함`(붙여쓰기)은 원본 버그라 쓰지 않는다. */
export const CARD_GROUP_FIXED_LABELS = {
  all: '전체 명함',
  ungrouped: '미분류',
} as const;

export const cardGroupKeys = {
  all: () => ['cardGroups'] as const,
} as const;

/** Screen Specs SCR-22 문구를 그대로 옮긴 것. */
export const CARD_GROUP_COPY = {
  listFailed: '명함첩을 불러오지 못했습니다.',
  createFailed: '그룹 추가에 실패했습니다.',
  renameFailed: '그룹 이름 변경에 실패했습니다.',
  deleteFailed: '그룹 삭제에 실패했습니다.',
  moveFailed: '그룹 이동에 실패했습니다.',
  duplicated: '이미 있는 이름입니다.',
  deleted: '명함첩을 삭제했습니다. 명함은 미분류로 이동했습니다.',
} as const;

// ───────────────────────────────────────────────────────────── 네트워크

const groupItemPath = (id: Uuid) => `${GROUP_PATH}/${encodeURIComponent(id)}`;

/** API-20 `GET /api/card-groups` — `data` 가 바로 배열이다(Page 아님). `createdAt ASC` 정렬. */
export async function listCardGroups(): Promise<ApiResult<CardGroup[]>> {
  const res = await request<unknown>(GROUP_PATH);
  if (!res.ok) return res;
  return { ok: true, data: unwrapList<CardGroupDto>(res.data).map(toCardGroup) };
}

/** API-21 `POST /api/card-groups`. 서버가 `trim()` 후 빈 값/60자 초과/중복을 400 으로 막는다. */
export async function createCardGroup(name: string): Promise<ApiResult<CardGroup>> {
  const res = await request<unknown>(GROUP_PATH, { method: 'POST', json: { name: name.trim() } });
  if (!res.ok) return res;
  return { ok: true, data: toCardGroup((res.data ?? {}) as CardGroupDto) };
}

/** API-22 `PATCH /api/card-groups/{groupId}` — 웹에는 없던 앱 신규 기능(FR-064). */
export async function renameCardGroup(id: Uuid, name: string): Promise<ApiResult<CardGroup>> {
  const res = await request<unknown>(groupItemPath(id), {
    method: 'PATCH',
    json: { name: name.trim() },
  });
  if (!res.ok) return res;
  return { ok: true, data: toCardGroup((res.data ?? {}) as CardGroupDto) };
}

/**
 * API-23 `DELETE /api/card-groups/{groupId}`.
 * 소속 명함은 미분류로 이동한다 — 자바 코드는 그룹 행만 지우고 명함을 건드리지 않으므로
 * 실제 이동은 DB FK 제약이 수행한다. **명함 목록 캐시를 반드시 함께 무효화해야 한다.**
 */
export async function deleteCardGroup(id: Uuid): Promise<ApiResult<void>> {
  const res = await request<unknown>(groupItemPath(id), { method: 'DELETE' });
  if (!res.ok) return res;
  return { ok: true, data: undefined };
}

/**
 * API-18 `PATCH /api/cards/{id}/group` — 명함 그룹 이동.
 *
 * **`groupId: null` 이 미분류로 되돌리는 유일한 경로다.** 서버가
 * `body == null ? null : body.getGroupId()` 로 읽어 그대로 `card.setGroupId(...)` 하므로
 * null 이 정상 값이다. 반면 수정(PUT)은 `if (groupId != null)` 가드가 있어 미분류로 되돌릴 수 없다.
 */
export async function moveCardToGroup(
  cardId: Uuid,
  groupId: Uuid | null,
): Promise<ApiResult<CardDetail>> {
  const res = await request<unknown>(`/api/cards/${encodeURIComponent(cardId)}/group`, {
    method: 'PATCH',
    json: { groupId },
  });
  if (!res.ok) return res;
  return { ok: true, data: toCardDetail((res.data ?? {}) as Record<string, unknown>) };
}

// ───────────────────────────────────────────────────────────── 에러

export type CardGroupOperation = 'list' | 'create' | 'rename' | 'delete' | 'move';

export class CardGroupError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: CardGroupOperation;

  constructor(message: string, error: AppError, operation: CardGroupOperation) {
    super(message);
    this.name = 'CardGroupError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function cardGroupErrorMessage(operation: CardGroupOperation, error: AppError): string {
  if (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'unauthorized') {
    return error.message;
  }
  // 이 컨트롤러의 400 은 거의 전부 이름 문제(빈 값·60자 초과·중복)다. 빈 값과 길이는 앱이
  // 선차단하므로 남는 400 은 사실상 중복 하나다 — 사용자에게 그 가능성을 직접 알려 준다.
  if (error.status === 400 && (operation === 'create' || operation === 'rename')) {
    return CARD_GROUP_COPY.duplicated;
  }
  switch (operation) {
    case 'list':
      return CARD_GROUP_COPY.listFailed;
    case 'create':
      return CARD_GROUP_COPY.createFailed;
    case 'rename':
      return CARD_GROUP_COPY.renameFailed;
    case 'delete':
      return CARD_GROUP_COPY.deleteFailed;
    case 'move':
      return CARD_GROUP_COPY.moveFailed;
  }
}

const toCardGroupError = (operation: CardGroupOperation, error: AppError) =>
  new CardGroupError(cardGroupErrorMessage(operation, error), error, operation);

// ───────────────────────────────────────────────────────────── 훅

/** 그룹 목록. 변경 빈도가 매우 낮아 `staleTime` 을 길게 잡는다 (§6-2: 5분, SCR-15 표: 10분). */
export function useCardGroups(options: { enabled?: boolean } = {}) {
  return useQuery<CardGroup[], CardGroupError>({
    queryKey: cardGroupKeys.all(),
    queryFn: async () => {
      const res = await listCardGroups();
      if (!res.ok) throw toCardGroupError('list', res.error);
      return res.data;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

/**
 * 그룹 생성 — **낙관적 업데이트 금지**.
 * 서버가 UUID 를 발급한다. 임시 id 로 만든 그룹에 명함을 이동시키면 되돌릴 수 없다
 * (Offline and State §11-4).
 */
export function useCreateCardGroup() {
  const queryClient = useQueryClient();

  return useMutation<CardGroup, CardGroupError, string>({
    mutationFn: async (name) => {
      const res = await createCardGroup(name);
      if (!res.ok) throw toCardGroupError('create', res.error);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cardGroupKeys.all() });
    },
  });
}

/** 그룹 이름 변경 — 낙관적 반영 후 실패 시 목록 스냅샷 전량 복원. */
export function useRenameCardGroup() {
  const queryClient = useQueryClient();

  return useMutation<CardGroup, CardGroupError, { id: Uuid; name: string }, { snapshot?: CardGroup[] }>({
    mutationFn: async ({ id, name }) => {
      const res = await renameCardGroup(id, name);
      if (!res.ok) throw toCardGroupError('rename', res.error);
      return res.data;
    },
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: cardGroupKeys.all() });
      const snapshot = queryClient.getQueryData<CardGroup[]>(cardGroupKeys.all());
      queryClient.setQueryData<CardGroup[]>(cardGroupKeys.all(), (old) =>
        old?.map((group) => (group.id === id ? { ...group, name: name.trim() } : group)),
      );
      return snapshot ? { snapshot } : {};
    },
    onError: (_error, _vars, context) => {
      if (context?.snapshot) queryClient.setQueryData(cardGroupKeys.all(), context.snapshot);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cardGroupKeys.all() });
    },
  });
}

/**
 * 그룹 삭제 (OPT-07) — 목록에서 즉시 제거하고 실패 시 복원한다.
 * 소속 명함이 미분류로 옮겨가므로 **명함 목록 캐시도 함께 무효화**한다. 안 하면
 * 그룹 필터별 페이지가 전부 어긋난 채로 남는다 (§6-3).
 */
export function useDeleteCardGroup() {
  const queryClient = useQueryClient();

  return useMutation<void, CardGroupError, Uuid, { snapshot?: CardGroup[] }>({
    mutationFn: async (id) => {
      const res = await deleteCardGroup(id);
      if (!res.ok) throw toCardGroupError('delete', res.error);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: cardGroupKeys.all() });
      const snapshot = queryClient.getQueryData<CardGroup[]>(cardGroupKeys.all());
      queryClient.setQueryData<CardGroup[]>(cardGroupKeys.all(), (old) =>
        old?.filter((group) => group.id !== id),
      );
      return snapshot ? { snapshot } : {};
    },
    onError: (_error, _id, context) => {
      if (context?.snapshot) queryClient.setQueryData(cardGroupKeys.all(), context.snapshot);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cardGroupKeys.all() });
      void queryClient.invalidateQueries({ queryKey: documentKeys.ofType('BUSINESS_CARD') });
    },
  });
}

/**
 * 명함 그룹 이동 (OPT-02).
 *
 * 낙관적 조작이 두 단계다: `groupId` 를 바꾸고, **현재 보고 있는 필터와 어긋나면 목록에서 제거**한다.
 * 그러지 않으면 `영업팀` 필터에서 다른 그룹으로 옮긴 명함이 그 자리에 남아 있어 이동이 실패한 것처럼 보인다.
 */
export function useMoveCardToGroup(currentFilter?: CardGroupFilter) {
  const queryClient = useQueryClient();

  return useMutation<
    CardDetail,
    CardGroupError,
    { cardId: Uuid; groupId: Uuid | null },
    { snapshot: [readonly unknown[], unknown][] }
  >({
    mutationFn: async ({ cardId, groupId }) => {
      const res = await moveCardToGroup(cardId, groupId);
      if (!res.ok) throw toCardGroupError('move', res.error);
      return res.data;
    },

    onMutate: async ({ cardId, groupId }) => {
      const cardsKey = documentKeys.ofType('BUSINESS_CARD');
      await queryClient.cancelQueries({ queryKey: cardsKey });
      const snapshot = queryClient.getQueriesData({ queryKey: cardsKey }) as [
        readonly unknown[],
        unknown,
      ][];

      // 필터가 지정된 화면에서만 목록에서 빼낸다. `전체 명함`(all)에서는 계속 보여야 한다.
      const dropsFromList =
        currentFilter !== undefined &&
        currentFilter !== 'all' &&
        (currentFilter === 'ungrouped' ? groupId !== null : currentFilter !== groupId);

      queryClient.setQueriesData<InfiniteData<DocumentPage, number>>(
        { queryKey: documentKeys.lists('BUSINESS_CARD') },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: dropsFromList
                ? page.items.filter((doc) => doc.id !== cardId)
                : page.items.map((doc) =>
                    doc.type === 'BUSINESS_CARD' && doc.id === cardId ? { ...doc, groupId } : doc,
                  ),
            })),
          };
        },
      );
      queryClient.setQueryData<DocumentDetail>(
        documentKeys.detail('BUSINESS_CARD', cardId),
        (old) => (old && old.type === 'BUSINESS_CARD' ? { ...old, groupId } : old),
      );

      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: documentKeys.ofType('BUSINESS_CARD') });
      void queryClient.invalidateQueries({ queryKey: cardGroupKeys.all() });
    },
  });
}
