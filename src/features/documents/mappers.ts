/**
 * 서버 DTO → 앱 모델 어댑터. **변환은 오직 여기서만 일어난다** (Data Model §5-1).
 *
 * 규칙 5가지 (Data Model §5-1)
 *  1. 어댑터는 순수 함수다. 네트워크·스토리지·전역 상태에 접근하지 않는다.
 *  2. 방향별로 함수를 나눈다. 요청/응답 타입이 비대칭이라 왕복 함수를 만들지 않는다
 *     (요청 조립은 api.ts 의 `buildUpdateBody`).
 *  3. 날짜/시각 정규화는 **여기서 전 필드에 일괄 적용**한다. 화면에서 `normalizeDateTime` 을
 *     부르는 코드는 리뷰 반려 대상이다. 웹은 `createdAt` 하나만 정규화해서
 *     `updatedAt`/`departureTime` 등이 배열째 깨진 채 남아 있었다.
 *  4. `imageUrl` 절대화도 여기서 끝낸다. 화면은 `resolveImageUrl` 을 모른다.
 *  5. 서버가 준 알 수 없는 필드는 버린다.
 */

import { resolveImageUrl } from '@/config/env';
import { formatMoneyKo } from '@/features/scan/fieldSchema';
import { normalizeDateTime } from '@/services/http';

import {
  type CardDetail,
  type CardDto,
  type CardGroup,
  type CardGroupDto,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
  type PosterDetail,
  type PosterDto,
  type ReceiptDetail,
  type ReceiptDto,
  type ReceiptItem,
  type ReceiptItemDto,
  type TicketDetail,
  type TicketDto,
} from './types';

// ───────────────────────────────────────────────────────────── 원시 값 헬퍼

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : {};

/** 문자열이 아니면 빈 문자열. 화면이 `?? ''` 를 반복하지 않게 여기서 끝낸다. */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `BigDecimal` 이 문자열로 직렬화될 수 있어 숫자 문자열까지 받는다. */
const num = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** 서버 `LocalDate` → `YYYY-MM-DD`. 숫자 배열 `[2026,7,27]` 도 흡수한다. */
const normDate = (value: unknown): string => normalizeDateTime(value)?.slice(0, 10) ?? '';

/**
 * 서버 `LocalTime` → `HH:MM`.
 *
 * **`normalizeDateTime` 을 쓰면 안 된다.** `LocalTime` 은 `[9,30,15]` 처럼 길이 3 배열로도
 * 오는데, 그 함수는 길이 ≥ 3 을 무조건 `[년,월,일]` 로 해석해 `9-30-15T00:00:00` 을 만든다.
 */
const normTime = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.includes('T') ? value.slice(11, 16) : value.slice(0, 5);
  }
  if (Array.isArray(value) && value.length >= 2) {
    const pad = (n: unknown) => String(typeof n === 'number' ? n : 0).padStart(2, '0');
    return `${pad(value[0])}:${pad(value[1])}`;
  }
  return '';
};

/** 값이 있을 때만 키를 만든다. `LocalDateTime` 전용 (문자열·숫자배열 흡수). */
const dateTimeProp = <K extends string>(key: K, value: unknown): Partial<Record<K, string>> => {
  const normalized = normalizeDateTime(value);
  return normalized ? ({ [key]: normalized } as Partial<Record<K, string>>) : {};
};

/** 값이 있을 때만 키를 만든다. 숫자 전용. */
const numProp = <K extends string>(key: K, value: unknown): Partial<Record<K, number>> => {
  const parsed = num(value);
  return parsed === undefined ? {} : ({ [key]: parsed } as Partial<Record<K, number>>);
};

/** `parsedJson` 문자열을 객체로. 파싱 실패는 조용히 빈 객체로 폴백한다 (API Contract §4-6). */
export function parseJsonObject(raw: unknown): LooseRecord {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/**
 * 티켓·포스터·영수증의 썸네일 경로를 찾아 절대 URL 로 만든다.
 *
 * **명함만 `imageUrl` 이 정식 컬럼이고 나머지 3종은 `parsedJson` 문자열 안에 숨어 있다.**
 * 저장 시 `parsedJson: JSON.stringify({ ...fields, imageUrl })` 로 넣기 때문이며
 * (원본 `frontend/lib/api.ts` `saveCard` · 앱 `features/scan/api.ts` `buildSaveBody` 동일),
 * 이 함수는 그 저장 매핑을 그대로 되짚는 역방향이다.
 *
 * 조립은 반드시 **OCR base(:8000)** 로 한다 — 정적 이미지는 Spring 이 서빙하지 않는다.
 */
function imageUrlFromParsedJson(dto: unknown): string | null {
  const record = asRecord(dto);
  const fromParsed = parseJsonObject(record.parsedJson).imageUrl;
  // 서버가 훗날 정식 컬럼을 추가하더라도 깨지지 않도록 top-level 도 폴백으로 본다.
  const raw = typeof fromParsed === 'string' && fromParsed ? fromParsed : record.imageUrl;
  return typeof raw === 'string' && raw ? resolveImageUrl(raw) : null;
}

// ───────────────────────────────────────────────────────────── 종별 어댑터

/** 명함. `imageUrl` 이 정식 컬럼인 유일한 종류이고, `updatedAt` 이 없는 유일한 종류다. */
export function toCardDetail(dto: CardDto): CardDetail {
  return {
    type: 'BUSINESS_CARD',
    id: str(dto.id),
    name: str(dto.name),
    company: str(dto.company),
    position: str(dto.position),
    phone: str(dto.phone),
    email: str(dto.email),
    rawOcrText: str(dto.rawOcrText),
    imageUrl: resolveImageUrl(str(dto.imageUrl)),
    groupId: typeof dto.groupId === 'string' && dto.groupId ? dto.groupId : null,
    ...dateTimeProp('createdAt', dto.createdAt),
    ...numProp('similarity', dto.similarity),
  };
}

export function toPosterDetail(dto: PosterDto): PosterDetail {
  return {
    type: 'POSTER',
    id: num(dto.id) ?? 0,
    title: str(dto.title),
    organizerName: str(dto.organizerName),
    eventStartDate: normDate(dto.eventStartDate),
    eventEndDate: normDate(dto.eventEndDate),
    contactPhone: str(dto.contactPhone),
    contactEmail: str(dto.contactEmail),
    location: str(dto.location),
    fee: str(dto.fee),
    websiteUrl: str(dto.websiteUrl),
    description: str(dto.description),
    rawText: str(dto.rawText),
    imageUrl: imageUrlFromParsedJson(dto),
    ...numProp('confidence', dto.classificationConfidence),
    ...dateTimeProp('createdAt', dto.createdAt),
    ...dateTimeProp('updatedAt', dto.updatedAt),
    ...numProp('similarity', dto.similarity),
  };
}

export function toTicketDetail(dto: TicketDto): TicketDetail {
  return {
    type: 'TICKET',
    id: num(dto.id) ?? 0,
    transportType: str(dto.transportType),
    departureLocation: str(dto.departureLocation),
    departureDate: normDate(dto.departureDate),
    departureTime: normTime(dto.departureTime),
    arrivalLocation: str(dto.arrivalLocation),
    arrivalDate: normDate(dto.arrivalDate),
    arrivalTime: normTime(dto.arrivalTime),
    rawText: str(dto.rawText),
    imageUrl: imageUrlFromParsedJson(dto),
    ...numProp('confidence', dto.classificationConfidence),
    ...dateTimeProp('createdAt', dto.createdAt),
    ...dateTimeProp('updatedAt', dto.updatedAt),
    ...numProp('similarity', dto.similarity),
  };
}

export function toReceiptItem(dto: ReceiptItemDto): ReceiptItem {
  return {
    ...numProp('id', dto.id),
    itemName: str(dto.itemName),
    quantity: num(dto.quantity) ?? null,
    unitPrice: num(dto.unitPrice) ?? null,
    totalPrice: num(dto.totalPrice) ?? null,
    category: str(dto.category),
  };
}

export function toReceiptDetail(dto: ReceiptDto): ReceiptDetail {
  return {
    type: 'RECEIPT',
    id: num(dto.id) ?? 0,
    merchantName: str(dto.merchantName),
    merchantAddress: str(dto.merchantAddress),
    purchaseDate: normDate(dto.purchaseDate),
    purchaseTime: normTime(dto.purchaseTime),
    paymentMethod: str(dto.paymentMethod),
    cardCompany: str(dto.cardCompany),
    totalAmount: num(dto.totalAmount) ?? null,
    // 서버 자바 기본값이 'KRW' 지만 옛 레코드에 null 이 있을 수 있다.
    currencyCode: str(dto.currencyCode) || 'KRW',
    items: Array.isArray(dto.items) ? dto.items.map((item) => toReceiptItem(asRecord(item))) : [],
    rawText: str(dto.rawText),
    imageUrl: imageUrlFromParsedJson(dto),
    ...numProp('confidence', dto.classificationConfidence),
    ...dateTimeProp('createdAt', dto.createdAt),
    ...dateTimeProp('updatedAt', dto.updatedAt),
    ...numProp('similarity', dto.similarity),
  };
}

export function toCardGroup(dto: CardGroupDto): CardGroup {
  return {
    id: str(dto.id),
    name: str(dto.name),
    ...dateTimeProp('createdAt', dto.createdAt),
    ...dateTimeProp('updatedAt', dto.updatedAt),
  };
}

/** 종류를 알 때 쓰는 단일 진입점. 목록·상세·수정 응답이 전부 이 함수를 통과한다. */
export function toDocumentDetail(type: DocumentType, dto: unknown): DocumentDetail {
  const record = asRecord(dto);
  switch (type) {
    case 'BUSINESS_CARD':
      return toCardDetail(record);
    case 'POSTER':
      return toPosterDetail(record);
    case 'TICKET':
      return toTicketDetail(record);
    case 'RECEIPT':
      return toReceiptDetail(record);
  }
}

// ───────────────────────────────────────────────────────── 요약(카드 뷰모델)

/**
 * 종별 제목/부제 폴백 문구. 전부 위키·원본에서 가져온 값이며 여기서 새로 지어내지 않는다.
 *  - 명함 `(이름 없음)`      : Data Model §5-4 `cardToSummary`
 *  - 포스터 `이벤트`         : Screen Specs SCR-17 카드 데이터 매핑 (원본 대시보드 폴백)
 *  - 티켓 `출발지`/`도착지`  : Screen Specs SCR-16 카드 데이터 매핑
 *  - 영수증 `-`              : Screen Specs SCR-18 행 데이터 매핑
 */
export const SUMMARY_FALLBACK = {
  cardTitle: '(이름 없음)',
  posterTitle: '이벤트',
  ticketDeparture: '출발지',
  ticketArrival: '도착지',
  receiptTitle: '-',
} as const;

const joinNonEmpty = (parts: string[], separator: string): string =>
  parts.filter((part) => part.trim() !== '').join(separator);

function summaryTitle(doc: DocumentDetail): string {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return doc.name || doc.company || SUMMARY_FALLBACK.cardTitle;
    case 'TICKET':
      // 티켓의 핵심 정보는 구간이다. 한쪽만 있어도 화살표 형태를 유지해야 읽힌다.
      return `${doc.departureLocation || SUMMARY_FALLBACK.ticketDeparture} → ${
        doc.arrivalLocation || SUMMARY_FALLBACK.ticketArrival
      }`;
    case 'POSTER':
      return doc.title || SUMMARY_FALLBACK.posterTitle;
    case 'RECEIPT':
      return doc.merchantName || SUMMARY_FALLBACK.receiptTitle;
  }
}

function summarySubtitle(doc: DocumentDetail): string {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return joinNonEmpty([doc.company, doc.position], ' · ');
    case 'TICKET':
      return joinNonEmpty([doc.departureDate, doc.departureTime], ' ');
    case 'POSTER': {
      // 원본 규칙: `${시작일 ?? '-'} ~ ${종료일 ?? ''}`. 날짜가 둘 다 없으면 주최자로 대체한다.
      if (!doc.eventStartDate && !doc.eventEndDate) return doc.organizerName;
      return `${doc.eventStartDate || '-'} ~ ${doc.eventEndDate}`.trim();
    }
    case 'RECEIPT':
      return formatMoneyKo(doc.totalAmount);
  }
}

/** 상세 모델 → 목록 카드 뷰모델. 목록·검색·홈이 같은 규칙으로 그려지도록 단일 함수로 둔다. */
export function toDocumentSummary(doc: DocumentDetail): DocumentSummary {
  return {
    type: doc.type,
    id: doc.id,
    key: `${doc.type}:${doc.id}`,
    title: summaryTitle(doc),
    subtitle: summarySubtitle(doc),
    thumbnailUrl: doc.imageUrl,
    ...(doc.createdAt === undefined ? {} : { createdAt: doc.createdAt }),
    ...(doc.similarity === undefined ? {} : { similarity: doc.similarity }),
  };
}

export const toDocumentSummaries = (docs: DocumentDetail[]): DocumentSummary[] =>
  docs.map(toDocumentSummary);
