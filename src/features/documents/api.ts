/**
 * 보관함 문서 4종 네트워크 계층 (API-14~17 · 43~46 · 49~51/53 · 57~60).
 *
 * 정본: wiki/tech/API Contract.md §3-2/3-10/3-11/3-13 · §4-2 · §4-3 · §4-6 · §4-7
 *       wiki/design/Screen Specs.md SCR-15~SCR-20
 *
 * 규약 (API Contract §5-7)
 *  1. 이 파일의 함수는 **앱 모델**(`DocumentDetail`)을 돌려준다. 서버 DTO 를 화면까지 흘리지 않는다.
 *  2. 실패는 throw 하지 않고 `ApiResult` 로 돌려준다 — throw 는 React Query 경계(queries.ts)에서 한다.
 *     프로젝트의 `features/auth/api.ts` 와 같은 규약이다.
 *  3. 쿼리 파라미터 기본값은 서버 기본값(size=10)과 다르므로 **항상 명시 전송**한다.
 *  4. 한글이 들어갈 수 있는 값은 `encodeURIComponent` 로 명시 인코딩한다
 *     (`server.tomcat.uri-encoding` 설정이 없다 — §4-5).
 */

import { request, unwrapList, type ApiResult } from '@/services/http';

import { toDocumentDetail } from './mappers';
import {
  type DocumentDeleteInput,
  type DocumentDetail,
  type DocumentListParams,
  type DocumentPage,
  type DocumentType,
  type DocumentUpdateInput,
  type PageMeta,
} from './types';

// ───────────────────────────────────────────────────────────── 상수

/**
 * 모든 목록의 페이지 크기. 서버 기본값은 10 이다.
 *
 * 20 인 이유(API Contract §4-2 결정): 모바일 1스크린 + 스크롤 여유 분량이면서,
 * 문서당 `rawText`/`parsedJson`/`rawJson` 이 커서 응답 크기를 억제해야 하기 때문이다.
 * 웹은 항상 첫 페이지만 불러 20건이 넘는 문서가 보관함에서 사라지는 결함이 있었다.
 */
export const DOCUMENT_PAGE_SIZE = 20;

/**
 * 수정(PUT) 타임아웃. 기본 15초보다 길게 잡는다.
 *
 * 근거 — 수정 경로에 **외부 왕복이 얹혀 있다**:
 *  - 명함: `CardService.update` 가 요청 내용과 무관하게 **매번 OpenAI 임베딩을 재생성**한다.
 *  - 포스터/티켓: 저장 후 `syncGoogleCalendar` 로 구글 캘린더에 동기화한다.
 * 게다가 `RestTemplate` 에 타임아웃이 없어 서버가 스스로 끊지 않는다 (§4-8 #9).
 */
export const DOCUMENT_WRITE_TIMEOUT_MS = 20_000;

/** 종별 컬렉션 경로. */
const LIST_PATH: Record<DocumentType, string> = {
  BUSINESS_CARD: '/api/cards',
  POSTER: '/api/posters',
  TICKET: '/api/tickets',
  RECEIPT: '/api/receipts',
};

/** 단건 경로. 명함만 UUID 이고 나머지는 Integer 다 — 타입이 어긋나면 Spring 기본 에러 바디가 온다. */
const itemPath = (type: DocumentType, id: string | number): string =>
  `${LIST_PATH[type]}/${encodeURIComponent(String(id))}`;

// ───────────────────────────────────────────────────────────── 쿼리 조립

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const qs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/**
 * 명함 그룹 필터 → 서버 파라미터.
 * 고정 항목 2개는 파라미터 형태가 서로 다르다: `all` = 없음 / `ungrouped` = `ungrouped=true`.
 */
function groupQuery(group: DocumentListParams['group']): Record<string, QueryValue> {
  if (!group || group === 'all') return {};
  if (group === 'ungrouped') return { ungrouped: true };
  return { groupId: group };
}

// ───────────────────────────────────────────────────────────── 언랩

/**
 * Spring `Page<>` 언랩. 항목 배열은 공용 `unwrapList` 가 `content` 를 흡수하고,
 * 무한 스크롤에 필요한 메타(`number`/`last`)는 여기서 따로 읽는다.
 *
 * **종료 판정은 `last` 플래그만 본다.** `totalPages` 비교는 서버가 값을 빠뜨리면 무한 루프가 된다.
 * `last` 가 아예 없는 응답(검색처럼 data 가 바로 배열)은 "받아온 수 < 요청한 수" 로 폴백한다.
 */
export function unwrapDocumentPage(
  type: DocumentType,
  data: unknown,
  requested: { page: number; size: number },
): DocumentPage {
  const items = unwrapList<unknown>(data).map((dto) => toDocumentDetail(type, dto));
  const raw = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const numberOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const page: PageMeta = {
    number: numberOr(raw.number, requested.page),
    size: numberOr(raw.size, requested.size),
    totalElements: numberOr(raw.totalElements, items.length),
    totalPages: numberOr(raw.totalPages, 1),
    last: typeof raw.last === 'boolean' ? raw.last : items.length < requested.size,
  };

  return { items, page };
}

// ───────────────────────────────────────────────────────────── 목록 · 상세

/**
 * 목록 조회 (API-14 / API-43 / API-49 / API-57).
 *
 * 정렬은 서버가 `createdAt DESC` 로 고정한다 — 정렬 파라미터를 받지 않으므로
 * 화면의 `⇅`(출발일 순 등)은 클라이언트 정렬이다.
 * `group` 은 명함에만 의미가 있고 나머지 3종에서는 서버가 무시한다(파라미터 자체를 보내지 않는다).
 */
export async function listDocuments(
  type: DocumentType,
  params: DocumentListParams,
): Promise<ApiResult<DocumentPage>> {
  const size = params.size ?? DOCUMENT_PAGE_SIZE;
  const path = withQuery(LIST_PATH[type], {
    page: params.page,
    size,
    ...(type === 'BUSINESS_CARD' ? groupQuery(params.group) : {}),
  });

  const res = await request<unknown>(path);
  if (!res.ok) return res;

  return { ok: true, data: unwrapDocumentPage(type, res.data, { page: params.page, size }) };
}

/**
 * 단건 조회 (API-15 / API-44 / API-50 / API-58).
 * 존재하지 않는 id 는 404 가 아니라 **500** 으로 온다 (서버가 `RuntimeException` 을 던진다).
 */
export async function fetchDocument(
  type: DocumentType,
  id: string | number,
): Promise<ApiResult<DocumentDetail>> {
  const res = await request<unknown>(itemPath(type, id));
  if (!res.ok) return res;
  return { ok: true, data: toDocumentDetail(type, res.data) };
}

// ───────────────────────────────────────────────────────────── 수정

/** `undefined` 인 키를 지운 얕은 복사본. 서버의 null-skip 부분 수정과 짝을 이룬다. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 수정 요청 바디 조립 (API-16 / API-45 / API-51 / API-59).
 *
 * **보내지 않는 것 3가지 — 전부 의도적이다.**
 *  1. `parsedJson` : 티켓·포스터·영수증의 **이미지 URL 이 이 문자열 안에** 들어 있다(§4-6).
 *     편집 폼이 만든 값으로 덮어쓰면 썸네일이 통째로 사라진다. 4개 서비스의 update 가 모두
 *     `if (request.getParsedJson() != null)` 이라 **보내지 않으면 기존 값이 그대로 유지**된다.
 *  2. `rawText`    : 값을 실으면 서버가 `rawText` 를 재조립하고 **임베딩까지 재생성**한다
 *     (OpenAI 왕복). OCR 원문은 편집 대상이 아니므로 보낼 이유가 없다 (Screen Specs SCR-20 주의).
 *  3. `rawJson`    : OCR 블록 원본. 편집으로 바뀌지 않는다.
 *
 * `docType`/`classificationConfidence` 도 보내지 않는다 — 분류 신뢰도는 실측값이라
 * 사용자가 필드를 고쳤다고 바뀌어서는 안 된다(학습 데이터 오염 방지).
 */
export function buildUpdateBody(input: DocumentUpdateInput): {
  path: string;
  body: Record<string, unknown>;
} {
  const path = itemPath(input.type, input.id);

  switch (input.type) {
    case 'BUSINESS_CARD': {
      const v = input.values;
      // `imageUrl`/`rawOcrText`/`groupId` 는 편집 대상이 아니라 생략한다. 생략 = 서버가 유지.
      // 그룹 이동은 별도 엔드포인트(API-18)를 쓴다 — PUT 은 groupId null 을 무시해서
      // '미분류로 되돌리기'가 불가능하다 (`CardService.update` 의 null 가드).
      return {
        path,
        body: compact({
          name: v.name,
          company: v.company,
          position: v.position,
          phone: v.phone,
          email: v.email,
        }),
      };
    }

    case 'POSTER': {
      const v = input.values;
      return {
        path,
        body: compact({
          title: v.title,
          organizerName: v.organizerName,
          // 날짜는 반드시 `YYYY-MM-DD`. 서버는 파싱 실패 시 예외가 아니라 **조용히 null 을 저장**한다.
          eventStartDate: v.eventStartDate,
          eventEndDate: v.eventEndDate,
          contactPhone: v.contactPhone,
          contactEmail: v.contactEmail,
          location: v.location,
          fee: v.fee,
          websiteUrl: v.websiteUrl,
          description: v.description,
        }),
      };
    }

    case 'TICKET': {
      const v = input.values;
      return {
        path,
        body: compact({
          transportType: v.transportType,
          departureLocation: v.departureLocation,
          departureDate: v.departureDate,
          departureTime: v.departureTime, // `HH:MM` 고정
          arrivalLocation: v.arrivalLocation,
          arrivalDate: v.arrivalDate,
          arrivalTime: v.arrivalTime,
        }),
      };
    }

    case 'RECEIPT': {
      const v = input.values;
      return {
        path,
        body: compact({
          merchantName: v.merchantName,
          merchantAddress: v.merchantAddress,
          purchaseDate: v.purchaseDate,
          purchaseTime: v.purchaseTime,
          paymentMethod: v.paymentMethod,
          cardCompany: v.cardCompany,
          // null 을 실어도 서버가 null-skip 으로 무시하므로 숫자일 때만 보낸다.
          // 즉 **저장된 금액을 비우는 것은 서버 구조상 불가능**하고 0 으로 덮는 것이 유일한 수단이다.
          totalAmount: typeof v.totalAmount === 'number' ? v.totalAmount : undefined,
          currencyCode: v.currencyCode,
          // `items` 는 통째 교체(`replaceItems`)다. `[]` 를 보내면 품목이 전량 삭제된다.
          items: v.items?.map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            category: item.category || null,
          })),
        }),
      };
    }
  }
}

/**
 * 문서 수정 (API-16 / API-45 / API-51 / API-59).
 * 부분 성공 경고(`message`)는 버리지 않고 올려 보낸다 — 임베딩 실패·캘린더 동기화 실패가 여기로 온다.
 */
export async function updateDocument(
  input: DocumentUpdateInput,
): Promise<ApiResult<DocumentDetail>> {
  const { path, body } = buildUpdateBody(input);
  const res = await request<unknown>(path, {
    method: 'PUT',
    json: body,
    timeoutMs: DOCUMENT_WRITE_TIMEOUT_MS,
  });
  if (!res.ok) return res;

  return {
    ok: true,
    data: toDocumentDetail(input.type, res.data),
    ...(res.message ? { message: res.message } : {}),
  };
}

// ───────────────────────────────────────────────────────────── 삭제

/**
 * 문서 삭제 (API-17 / API-46 / API-53 / API-60).
 * 성공 응답은 `{ success: true }` 뿐이다 — `@JsonInclude(NON_NULL)` 이라 `data` 키 자체가 없다.
 */
export async function deleteDocument(input: DocumentDeleteInput): Promise<ApiResult<void>> {
  const res = await request<unknown>(itemPath(input.type, input.id), {
    method: 'DELETE',
    timeoutMs: DOCUMENT_WRITE_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return { ok: true, data: undefined };
}

// 명함 그룹(API-18~23)은 `groups.ts` 가 소유한다 — 이 파일은 문서 4종의 목록/상세/수정/삭제만 다룬다.
