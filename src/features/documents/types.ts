/**
 * 보관함 문서 4종(명함·티켓·포스터·영수증) 데이터 계층 타입.
 *
 * 정본:
 *  - wiki/tech/API Contract.md §3-2/3-3/3-10/3-11/3-13 (엔드포인트) · §4-2(Page 언랩) ·
 *    §4-3(LocalDateTime 배열) · §4-6(parsedJson 안의 imageUrl) · §4-7(요청/응답 비대칭)
 *  - wiki/tech/Data Model.md §1(엔티티) · §3(앱 모델) · §5(매핑 규칙)
 *  - 원본 DTO 를 직접 열어 확인했다:
 *    backend/dto/{card,poster,ticket,receipt}/*.java
 *
 * 계층 규약 (Data Model §5-1)
 *  1. `*Dto` 는 **서버 원본**이다. 어댑터(mappers.ts)의 인자로만 등장하고 화면에 노출하지 않는다.
 *  2. `*Detail` / `DocumentSummary` 는 **앱 모델**이다. 날짜는 정규화되어 있고 이미지 URL 은 절대경로다.
 *  3. 서버 PK 타입이 리소스마다 다르므로 **통일하지 않는다** — 명함만 UUID(string),
 *     티켓·포스터·영수증은 Integer(number). 잘못 보내면 `ApiResponse` 포맷이 아닌
 *     Spring 기본 에러 바디가 온다 (API Contract §4-8 #3).
 */

import {
  SAVABLE_DOCUMENT_TYPES,
  TYPE_LABELS,
  type SavableDocumentType,
} from '@/features/scan/types';

// ───────────────────────────────────────────────────────────── 문서 어휘

/**
 * 보관함이 다루는 문서 종류.
 *
 * 스캔 계층의 `SavableDocumentType` 과 **같은 어휘를 재사용**한다 (타입 전용 import 라 런타임 비용 0).
 * `ETC` 는 저장 경로 자체가 없으므로 보관함에도 존재할 수 없다.
 */
export type DocumentType = SavableDocumentType;

export const DOCUMENT_TYPES: readonly DocumentType[] = SAVABLE_DOCUMENT_TYPES;

/** 화면 문구용 한국어 라벨. 스캔 계층 `TYPE_LABELS` 와 값이 갈리지 않도록 그대로 파생시킨다. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  BUSINESS_CARD: TYPE_LABELS.BUSINESS_CARD,
  POSTER: TYPE_LABELS.POSTER,
  RECEIPT: TYPE_LABELS.RECEIPT,
  TICKET: TYPE_LABELS.TICKET,
};

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

// ──────────────────────────────────────────────────── 라우트 세그먼트 어휘

/**
 * `/doc/[type]/[id]` 의 `type` 세그먼트 값.
 *
 * **`DocumentType`(대문자)과 다른 어휘다.** Navigation Map §7 파라미터 표가 정본이며
 * `card|ticket|poster|receipt` **소문자 단수형**으로 고정되어 있다. 딥링크 DL-03~05
 * (`mora://doc/poster/{id}`)도 같은 어휘를 쓰므로 URL 에 대문자가 들어가면 안 된다.
 *
 * 보관함 허브 `/(tabs)/archive?type=` 은 **또 다른 어휘**(`ALL` + 대문자 `DocumentType`)를
 * 쓴다. 두 라우트를 섞지 마라 — 이 상수는 `/doc/*` 전용이다.
 */
export type DocumentRouteSegment = 'card' | 'ticket' | 'poster' | 'receipt';

/** `DocumentType` → URL 세그먼트. 링크를 만들 때는 **반드시** 이걸 통과시킨다. */
export const DOC_ROUTE_SEGMENT: Record<DocumentType, DocumentRouteSegment> = {
  BUSINESS_CARD: 'card',
  TICKET: 'ticket',
  POSTER: 'poster',
  RECEIPT: 'receipt',
};

const SEGMENT_TO_DOCUMENT_TYPE: Record<DocumentRouteSegment, DocumentType> = {
  card: 'BUSINESS_CARD',
  ticket: 'TICKET',
  poster: 'POSTER',
  receipt: 'RECEIPT',
};

/**
 * URL 세그먼트 → `DocumentType`. 해석 불가면 `null` 이고 화면은 "잘못된 주소" 분기를 탄다.
 *
 * 대문자 `DocumentType` 도 받아 준다 — 외부에서 들어오는 딥링크는 통제할 수 없고,
 * 관대하게 받되 **내보낼 때는 항상 소문자**로 통일한다(Postel's law).
 */
export function documentTypeFromSegment(value: unknown): DocumentType | null {
  if (typeof value !== 'string' || value === '') return null;
  const lower = value.toLowerCase();
  if (lower in SEGMENT_TO_DOCUMENT_TYPE) {
    return SEGMENT_TO_DOCUMENT_TYPE[lower as DocumentRouteSegment];
  }
  return isDocumentType(value) ? value : null;
}

// ───────────────────────────────────────────────────────────── 식별자

/** 명함·명함그룹 PK. */
export type Uuid = string;
/** 티켓·포스터·영수증 PK (`IDENTITY`). */
export type IntId = number;
/** 혼합 목록에서만 쓰는 느슨한 식별자. API 호출에는 종별 정확한 타입을 쓴다. */
export type DocumentId = Uuid | IntId;

/** 종류로부터 정확한 PK 타입을 끌어낸다. `deleteDocument` 등에서 오타를 컴파일 타임에 잡는다. */
export type DocumentIdFor<T extends DocumentType> = T extends 'BUSINESS_CARD' ? Uuid : IntId;

// ───────────────────────────────────────────────────────────── 공통 뷰모델

/**
 * 보관함 목록·검색 결과·홈 카드가 공유하는 최소 형태.
 *
 * 종별 규칙 (Screen Specs SCR-15~SCR-18 행 데이터 매핑):
 *  - 명함   : title=`name`,          subtitle=`company · position`
 *  - 티켓   : title=`출발 → 도착`,   subtitle=`출발일 출발시각`
 *  - 포스터 : title=`title`,         subtitle=`시작일 ~ 종료일` (없으면 `organizerName`)
 *  - 영수증 : title=`merchantName`,  subtitle=금액(`12,500원`)
 */
export type DocumentSummary = {
  type: DocumentType;
  id: DocumentId;
  /** `${type}:${id}` — 혼합 리스트에서도 충돌하지 않는 안정 키. FlashList `keyExtractor` 용. */
  key: string;
  title: string;
  /** 보조 한 줄. 만들 재료가 없으면 빈 문자열이며 화면은 이때 행을 생략한다. */
  subtitle: string;
  /** 절대 URL 로 변환된 썸네일. 없으면 `null` → 화면이 종별 폴백 아이콘을 그린다. */
  thumbnailUrl: string | null;
  createdAt?: string;
  /** 검색 응답에만 존재한다 (0~1). 목록 조회에서는 항상 `undefined`. */
  similarity?: number;
};

// ───────────────────────────────────────────────────────────── 종별 상세 모델

export type CardDetail = {
  type: 'BUSINESS_CARD';
  id: Uuid;
  name: string;
  company: string;
  position: string;
  phone: string;
  email: string;
  /** OCR 원문 전체 (개행 JOIN). 편집 화면에서 읽기 전용으로 노출한다. */
  rawOcrText: string;
  /** 4종 중 **명함만 정식 컬럼**이다. 절대 URL. */
  imageUrl: string | null;
  /** `null` = 미분류. */
  groupId: Uuid | null;
  createdAt?: string;
  similarity?: number;
};

export type PosterDetail = {
  type: 'POSTER';
  id: IntId;
  title: string;
  organizerName: string;
  eventStartDate: string;
  eventEndDate: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  fee: string;
  websiteUrl: string;
  /** 응답은 공백 JOIN 문자열이다 (요청은 배열 — API Contract §4-7). */
  description: string;
  rawText: string;
  /** `parsedJson` 안에서 꺼내 절대 URL 로 만든 값. */
  imageUrl: string | null;
  /** 분류 신뢰도 0~1. 서버는 `BigDecimal` 이라 문자열로 올 수 있다. */
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
  similarity?: number;
};

export type TicketDetail = {
  type: 'TICKET';
  id: IntId;
  /** `KTX`/`SRT`/`ITX`/`무궁화`/`고속버스`/`비행기` 로 정규화되어 온다. */
  transportType: string;
  departureLocation: string;
  departureDate: string;
  departureTime: string;
  arrivalLocation: string;
  arrivalDate: string;
  arrivalTime: string;
  rawText: string;
  imageUrl: string | null;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
  similarity?: number;
};

/** 영수증 품목 1행. OCR 파서가 미구현이라 서버에서 오는 값은 사실상 항상 빈 배열이다. */
export type ReceiptItem = {
  id?: IntId;
  itemName: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  category: string;
};

export type ReceiptDetail = {
  type: 'RECEIPT';
  id: IntId;
  merchantName: string;
  merchantAddress: string;
  purchaseDate: string;
  purchaseTime: string;
  paymentMethod: string;
  cardCompany: string;
  /** `BigDecimal` → number. 값이 없으면 `null`. */
  totalAmount: number | null;
  currencyCode: string;
  items: ReceiptItem[];
  rawText: string;
  imageUrl: string | null;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
  similarity?: number;
};

export type DocumentDetail = CardDetail | PosterDetail | TicketDetail | ReceiptDetail;

/** 종류로 상세 모델을 좁힌다. `useDocument('TICKET', id)` 가 `TicketDetail` 을 돌려주게 하는 장치. */
export type DocumentDetailFor<T extends DocumentType> = Extract<DocumentDetail, { type: T }>;

// ───────────────────────────────────────────────────────────── 명함 그룹

export type CardGroup = {
  id: Uuid;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * 명함 목록 그룹 필터.
 * 고정 항목 2개(`all` / `ungrouped`)는 서버 파라미터가 서로 다르다 —
 * `all` 은 파라미터 없음, `ungrouped` 는 `ungrouped=true`, 나머지는 `groupId=<uuid>`.
 */
export type CardGroupFilter = 'all' | 'ungrouped' | (string & {});

// ───────────────────────────────────────────────────────────── 페이지네이션

/** Spring `Page<>` 메타. 무한 스크롤 종료 판정은 **`last` 플래그**만 본다. */
export type PageMeta = {
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
};

export type DocumentPage = {
  items: DocumentDetail[];
  page: PageMeta;
};

export type DocumentListParams = {
  page: number;
  size?: number;
  /** 명함 전용. `undefined` = 전체, `'ungrouped'` = 미분류. */
  group?: CardGroupFilter;
};

// ───────────────────────────────────────────────────────────── 수정 입력

/**
 * 편집 화면(SCR-20)이 보내는 값. **편집 가능 필드만** 담는다.
 *
 * `undefined` 인 키는 요청 바디에서 제외되고, 서버의 4개 update 서비스가 전부
 * `if (request.getX() != null)` 로 **부분 수정**이라 기존 값이 그대로 유지된다
 * (backend/service/{Card,Poster,Ticket,Receipt}Service.update 직접 확인).
 */
export type CardUpdateInput = {
  name?: string;
  company?: string;
  position?: string;
  phone?: string;
  email?: string;
};

export type PosterUpdateInput = {
  title?: string;
  organizerName?: string;
  /** `YYYY-MM-DD` 고정. 서버는 파싱 실패 시 예외가 아니라 **조용히 null 저장**한다. */
  eventStartDate?: string;
  eventEndDate?: string;
  contactPhone?: string;
  contactEmail?: string;
  location?: string;
  fee?: string;
  websiteUrl?: string;
  description?: string;
};

export type TicketUpdateInput = {
  transportType?: string;
  departureLocation?: string;
  departureDate?: string;
  departureTime?: string;
  arrivalLocation?: string;
  arrivalDate?: string;
  arrivalTime?: string;
};

export type ReceiptUpdateInput = {
  merchantName?: string;
  merchantAddress?: string;
  purchaseDate?: string;
  purchaseTime?: string;
  paymentMethod?: string;
  cardCompany?: string;
  totalAmount?: number | null;
  currencyCode?: string;
  /** 수기 품목. `undefined` 면 서버가 기존 품목을 유지하고, `[]` 를 보내면 **전량 삭제**된다. */
  items?: ReceiptItem[];
};

/** 종류별 수정 입력을 하나로 묶은 판별 유니온. */
export type DocumentUpdateInput =
  | { type: 'BUSINESS_CARD'; id: Uuid; values: CardUpdateInput }
  | { type: 'POSTER'; id: IntId; values: PosterUpdateInput }
  | { type: 'TICKET'; id: IntId; values: TicketUpdateInput }
  | { type: 'RECEIPT'; id: IntId; values: ReceiptUpdateInput };

/** 삭제 입력. id 타입이 종류에 종속된다. */
export type DocumentDeleteInput =
  | { type: 'BUSINESS_CARD'; id: Uuid }
  | { type: 'POSTER'; id: IntId }
  | { type: 'TICKET'; id: IntId }
  | { type: 'RECEIPT'; id: IntId };

// ───────────────────────────────────────────────────────────── 서버 DTO

/**
 * 서버 원본 응답. **날짜 필드가 `unknown` 인 이유**: Jackson 설정이 없어
 * `[2026,7,27,14,30,15]` 같은 숫자 배열로 직렬화될 수 있다 (API Contract §4-3).
 * 숫자 필드가 `number | string` 인 이유: `BigDecimal` 이 문자열로 직렬화될 수 있다.
 */
export type CardDto = {
  id?: unknown;
  name?: unknown;
  company?: unknown;
  position?: unknown;
  phone?: unknown;
  email?: unknown;
  rawOcrText?: unknown;
  imageUrl?: unknown;
  groupId?: unknown;
  createdAt?: unknown;
  similarity?: unknown;
};

export type PosterDto = {
  id?: unknown;
  docType?: unknown;
  classificationConfidence?: unknown;
  title?: unknown;
  organizerName?: unknown;
  eventStartDate?: unknown;
  eventEndDate?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
  location?: unknown;
  fee?: unknown;
  websiteUrl?: unknown;
  description?: unknown;
  rawText?: unknown;
  /** JSON 문자열. **이 안에 `imageUrl` 이 들어 있다** (§4-6). */
  parsedJson?: unknown;
  rawJson?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  similarity?: unknown;
};

export type TicketDto = {
  id?: unknown;
  docType?: unknown;
  classificationConfidence?: unknown;
  transportType?: unknown;
  departureLocation?: unknown;
  departureDate?: unknown;
  departureTime?: unknown;
  arrivalLocation?: unknown;
  arrivalDate?: unknown;
  arrivalTime?: unknown;
  rawText?: unknown;
  parsedJson?: unknown;
  rawJson?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  similarity?: unknown;
};

export type ReceiptItemDto = {
  id?: unknown;
  itemName?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  totalPrice?: unknown;
  category?: unknown;
  createdAt?: unknown;
};

export type ReceiptDto = {
  id?: unknown;
  docType?: unknown;
  classificationConfidence?: unknown;
  merchantName?: unknown;
  merchantAddress?: unknown;
  purchaseDate?: unknown;
  purchaseTime?: unknown;
  paymentMethod?: unknown;
  cardCompany?: unknown;
  totalAmount?: unknown;
  currencyCode?: unknown;
  rawText?: unknown;
  parsedJson?: unknown;
  rawJson?: unknown;
  items?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  similarity?: unknown;
};

export type CardGroupDto = {
  id?: unknown;
  name?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};
