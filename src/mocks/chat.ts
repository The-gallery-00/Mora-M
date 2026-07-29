/**
 * LLM 없이 답하는 규칙 기반 챗봇 (`POST /api/chat` 목).
 *
 * 실서버 경로는 앱 → Spring → LLM → 검색 API 3홉이고, 마지막 홉이 돌려준
 * **검색 DTO 배열이 그대로 `sources` 가 된다**(`features/chat/api.ts` 상단 실측 주석).
 * 그래서 여기서도 `sources` 에 목 DB 의 **실제 행**을 넣는다 — 출처 카드를 누르면
 * `/doc/{type}/{id}` 로 이동하므로 **실존 id** 가 아니면 상세 화면이 깨진다.
 *
 * 답변 전략 3단계
 *  1. 질문에서 의도(연락처·이메일·일정·금액·장소)를 뽑는다.
 *  2. 목 DB 를 문자열 부분일치로 조회한다(`matchScore`).
 *  3. 키워드가 하나도 안 걸려도 **시간·금액 의도**면 가장 가까운 일정 / 전체 합계로 답한다.
 *     그래야 "다음 출장 언제야?" 같은 자연스러운 질문이 빈손으로 끝나지 않는다.
 */

import {
  matchScore,
  posterSearchFields,
  readDb,
  receiptSearchFields,
  ticketSearchFields,
  cardSearchFields,
} from './db';
import {
  todayDate,
  type MockCard,
  type MockPoster,
  type MockReceipt,
  type MockTicket,
} from './fixtures';

export type MockChatDocType = 'BUSINESS_CARD' | 'POSTER' | 'TICKET' | 'RECEIPT';

export type MockChatResult = {
  answer: string;
  /** 검색 응답 DTO 배열 그대로. 앱이 `toDocumentDetail(documentType, dto)` 로 파싱한다. */
  sources: unknown[];
  query: string;
};

/** 결과 0건 문구. SCR-24 의 폴백 문구와 계열을 맞춘 목 전용 답변이다. */
export const CHAT_NOT_FOUND = '관련 문서를 찾지 못했어요. 다른 이름이나 키워드로 다시 물어봐 주세요.';

// ───────────────────────────────────────────────────────────── 의도 추출

type Intent = 'phone' | 'email' | 'when' | 'where' | 'amount' | 'general';

const has = (text: string, words: readonly string[]): boolean =>
  words.some((word) => text.includes(word));

function detectIntent(query: string): Intent {
  const q = query.toLowerCase();
  if (has(q, ['연락처', '전화', '번호', '핸드폰', '휴대폰', '연락'])) return 'phone';
  if (has(q, ['이메일', '메일', '주소록', 'email'])) return 'email';
  if (has(q, ['언제', '일정', '날짜', '며칠', '몇일', '기간', '마감', '출발', '다음'])) return 'when';
  if (has(q, ['어디', '장소', '위치', '어느'])) return 'where';
  if (has(q, ['얼마', '금액', '가격', '합계', '총', '비용', '결제'])) return 'amount';
  return 'general';
}

// ───────────────────────────────────────────────────────────── 표시 유틸

/** `2026-07-31` → `7월 31일`. 값이 없으면 빈 문자열. */
function korDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

function korMoney(amount: number | null): string {
  return amount === null ? '금액 미상' : `${amount.toLocaleString('ko-KR')}원`;
}

/**
 * 받침 유무에 따라 조사를 고른다 (`은/는`, `이/가`, `을/를`).
 *
 * 목이라고 `«컨퍼런스»은` 같은 문장을 내보내면 그것만으로 가짜 티가 난다. 문서 제목은
 * 사용자 데이터라 하드코딩할 수 없으므로 마지막 한글 음절의 종성을 직접 판정한다.
 * 한글이 아닌 문자로 끝나면(영문·숫자) 받침 없음으로 본다 — 목에서 그 이상은 과하다.
 */
function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  for (let i = word.length - 1; i >= 0; i -= 1) {
    const code = word.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      return (code - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim;
    }
  }
  return withoutBatchim;
}

/** 오늘 기준 남은 일수. 문자열 비교가 아니라 날짜 차이로 계산한다. */
function daysUntil(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

function dDayLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days === null) return '';
  if (days === 0) return '오늘';
  if (days > 0) return `${days}일 뒤`;
  return `${Math.abs(days)}일 전`;
}

// ───────────────────────────────────────────────────────────── 랭킹

type Ranked<T> = { row: T; score: number };

function rank<T>(rows: readonly T[], fieldsOf: (row: T) => string[], query: string): Ranked<T>[] {
  const scored: Ranked<T>[] = [];
  for (const row of rows) {
    const score = matchScore(fieldsOf(row), query);
    if (score !== null) scored.push({ row, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * DTO 에 `similarity` 를 얹어 검색 응답과 같은 모양으로 만든다.
 * 출처 카드는 답변 아래 가로 스크롤 2~3장이 적당하므로 `top_k` 와 무관하게 3장으로 자른다.
 */
const withSimilarity = <T extends object>(ranked: Ranked<T>[], topK: number): unknown[] =>
  ranked
    .slice(0, Math.min(Math.max(1, topK), 3))
    .map((item) => ({ ...item.row, similarity: item.score }));

// ───────────────────────────────────────────────────────────── 종별 답변

function answerCards(query: string, intent: Intent, topK: number): MockChatResult {
  const ranked = rank(readDb().cards, cardSearchFields, query);
  const top = ranked[0];
  if (!top) return { answer: CHAT_NOT_FOUND, sources: [], query };

  const card: MockCard = top.row;
  const rest = ranked.length - 1;
  const tail = rest > 0 ? ` 조건에 맞는 명함이 ${rest}건 더 있어요.` : '';

  let answer: string;
  if (intent === 'phone') {
    answer = `${card.name}님의 연락처는 ${card.phone}입니다. (${card.company} · ${card.position})`;
  } else if (intent === 'email') {
    answer = `${card.name}님의 이메일은 ${card.email}입니다. (${card.company} · ${card.position})`;
  } else {
    answer =
      `${card.name}님은 ${card.company} ${card.position}입니다. ` +
      `연락처는 ${card.phone}, 이메일은 ${card.email}입니다.`;
  }

  return { answer: answer + tail, sources: withSimilarity(ranked, topK), query };
}

function ticketLine(ticket: MockTicket): string {
  return (
    `${korDate(ticket.departureDate)} ${ticket.departureTime} ` +
    `${ticket.departureLocation} → ${ticket.arrivalLocation} (${ticket.transportType})`
  );
}

function answerTickets(query: string, intent: Intent, topK: number): MockChatResult {
  const tickets = readDb().tickets;
  let ranked = rank(tickets, ticketSearchFields, query);

  // 키워드가 안 걸려도 시간 의도면 다가오는 일정으로 답한다.
  if (ranked.length === 0 && (intent === 'when' || intent === 'general')) {
    const today = todayDate();
    const upcoming = tickets
      .filter((ticket) => ticket.departureDate >= today)
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
    ranked = upcoming.map((row, index) => ({ row, score: 0.72 - index * 0.03 }));
  }

  const top = ranked[0];
  if (!top) return { answer: CHAT_NOT_FOUND, sources: [], query };

  const ticket = top.row;
  const label = dDayLabel(ticket.departureDate);
  const rest = ranked.length - 1;
  const tail = rest > 0 ? ` 다른 티켓 ${rest}건도 함께 찾았어요.` : '';

  const answer =
    intent === 'where'
      ? `${ticket.departureLocation}에서 출발해 ${ticket.arrivalLocation}에 도착하는 일정입니다. ` +
        `${korDate(ticket.departureDate)} ${ticket.departureTime} 출발이에요.`
      : `가장 가까운 일정은 ${ticketLine(ticket)}입니다. ${label} 출발이고 ` +
        `${ticket.arrivalTime}에 도착해요.`;

  return { answer: answer + tail, sources: withSimilarity(ranked, topK), query };
}

function answerPosters(query: string, intent: Intent, topK: number): MockChatResult {
  const posters = readDb().posters;
  let ranked = rank(posters, posterSearchFields, query);

  if (ranked.length === 0 && (intent === 'when' || intent === 'general')) {
    const today = todayDate();
    const upcoming = posters
      .filter((poster) => poster.eventEndDate >= today)
      .sort((a, b) => a.eventStartDate.localeCompare(b.eventStartDate));
    ranked = upcoming.map((row, index) => ({ row, score: 0.7 - index * 0.03 }));
  }

  const top = ranked[0];
  if (!top) return { answer: CHAT_NOT_FOUND, sources: [], query };

  const poster: MockPoster = top.row;
  const period =
    poster.eventStartDate === poster.eventEndDate
      ? korDate(poster.eventStartDate)
      : `${korDate(poster.eventStartDate)}부터 ${korDate(poster.eventEndDate)}까지`;
  const remaining = daysUntil(poster.eventStartDate);
  const deadline =
    remaining !== null && remaining >= 0 && remaining <= 7
      ? ` 마감이 ${remaining === 0 ? '오늘' : `${remaining}일`} 남았으니 서둘러 주세요.`
      : '';
  const rest = ranked.length - 1;
  const tail = rest > 0 ? ` 관련 포스터 ${rest}건이 더 있어요.` : '';

  const topic = josa(poster.title, '은', '는');
  const answer =
    intent === 'where'
      ? `«${poster.title}»${topic} ${poster.location}에서 열립니다. ${period} 진행돼요.`
      : intent === 'amount'
        ? `«${poster.title}» 참가비는 ${poster.fee || '별도 안내'}입니다. ${period} 진행돼요.`
        : `«${poster.title}»${topic} ${period} ${poster.location}에서 열립니다. ` +
          `주최는 ${poster.organizerName}, 문의는 ${poster.contactPhone}입니다.${deadline}`;

  return { answer: answer + tail, sources: withSimilarity(ranked, topK), query };
}

function answerReceipts(query: string, intent: Intent, topK: number): MockChatResult {
  const receipts = readDb().receipts;
  let ranked = rank(receipts, receiptSearchFields, query);

  if (ranked.length === 0 && intent === 'amount') {
    ranked = [...receipts]
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
      .map((row, index) => ({ row, score: 0.68 - index * 0.02 }));
  }

  const top = ranked[0];
  if (!top) return { answer: CHAT_NOT_FOUND, sources: [], query };

  const receipt: MockReceipt = top.row;
  const total = ranked.reduce((sum, item) => sum + (item.row.totalAmount ?? 0), 0);
  const rest = ranked.length - 1;

  const answer =
    intent === 'amount' && ranked.length > 1
      ? `찾은 영수증 ${ranked.length}건의 합계는 ${korMoney(total)}입니다. ` +
        `가장 최근은 ${receipt.merchantName} ${korMoney(receipt.totalAmount)}이에요.`
      : `${receipt.merchantName}에서 ${korDate(receipt.purchaseDate)} ${receipt.purchaseTime}에 ` +
        `${korMoney(receipt.totalAmount)}을 ${receipt.cardCompany}로 결제했어요.` +
        (rest > 0 ? ` 비슷한 영수증이 ${rest}건 더 있어요.` : '');

  return { answer, sources: withSimilarity(ranked, topK), query };
}

// ───────────────────────────────────────────────────────────── 진입점

/**
 * 목 챗봇 응답 1건.
 * 반환 객체는 그대로 `{success:true,data:{answer,sources,query}}` 의 `data` 가 된다.
 */
export function answerChat(
  query: string,
  documentType: MockChatDocType,
  topK: number,
): MockChatResult {
  const trimmed = query.trim();
  if (trimmed === '') return { answer: CHAT_NOT_FOUND, sources: [], query };

  const intent = detectIntent(trimmed);
  switch (documentType) {
    case 'BUSINESS_CARD':
      return answerCards(trimmed, intent, topK);
    case 'TICKET':
      return answerTickets(trimmed, intent, topK);
    case 'POSTER':
      return answerPosters(trimmed, intent, topK);
    case 'RECEIPT':
      return answerReceipts(trimmed, intent, topK);
  }
}
