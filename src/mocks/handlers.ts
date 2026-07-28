/**
 * 목 모드 라우팅 테이블 — `(method, path, body) => 응답`.
 *
 * 이 파일이 지키는 계약 (전부 실측 확정값 / 각 `features/*​/api.ts` 파서가 기대하는 모양)
 *  - 모든 응답은 `{ success, data?, error?, message? }` 로 감싼다. `data` 가 없으면 **키 자체가 없다**
 *    (`@JsonInclude(NON_NULL)`).
 *  - 목록은 **평면 Page**(`content`/`last`/`number`/…). `/api/card-groups` 와 `/api/*​/search` 는
 *    `data` 가 **바로 배열**이다.
 *  - `LocalDateTime` 은 ISO 문자열, `LocalDate` 는 `YYYY-MM-DD`, `LocalTime` 은 `HH:MM`.
 *  - 없는 문서 id 는 404 가 아니라 **500** + `{"success":false,"error":"Card not found"}`.
 *    반면 명함그룹·알림은 **400** 이다(컨트롤러가 다르다).
 *  - `/api/notifications/unread-count` 는 `{count:N}`, `read-all` 은 `{updatedCount:N}`,
 *    `DELETE /api/notifications` 와 `DELETE /api/search-histories` 는 **스칼라 숫자**다.
 *
 * 응답 지연 200~600ms 를 **모든 경로에 준다.** 즉시 응답하면 스켈레톤·로딩·취소 버튼을 볼 수 없어
 * 목 모드의 목적(프론트 디버깅)이 절반 사라진다.
 */

import { answerChat, type MockChatDocType } from './chat';
import {
  cardSearchFields,
  filterCardsByGroup,
  matchScore,
  mutate,
  nextIntId,
  paginate,
  posterSearchFields,
  readDb,
  receiptSearchFields,
  resetDb,
  sortByCreatedAtDesc,
  ticketSearchFields,
} from './db';
import {
  nowDateTime,
  todayDate,
  uuid,
  type MockCard,
  type MockCardGroup,
  type MockNotification,
  type MockPoster,
  type MockReceipt,
  type MockReceiptItem,
  type MockTicket,
  type MockUser,
} from './fixtures';

// ───────────────────────────────────────────────────────────── 공개 타입

export type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type MockResponse = {
  /** HTTP 상태코드. `http.ts` 가 401 을 세션 만료로 처리하므로 정확해야 한다. */
  status: number;
  /** 파싱 전 JSON 바디. 네트워크 계층이 그대로 `JSON.stringify` 하면 된다. */
  body: unknown;
};

export type MockRequestOptions = {
  /**
   * `Authorization: Bearer <token>` 에서 뽑은 토큰.
   *
   * - 문자열  : 인증된 요청.
   * - `null`  : 토큰 없음 → 보호된 경로는 401.
   * - 생략    : 네트워크 계층이 토큰을 넘기지 않는 구성. 목 DB 에 발급 이력이 있으면 통과시킨다
   *             (로그인 흐름을 건너뛰지 않으면서, 주입 방식에 따라 전부 401 이 되는 사고를 막는다).
   */
  token?: string | null;
};

export const MOCK_MIN_DELAY_MS = 200;
export const MOCK_MAX_DELAY_MS = 600;

// ───────────────────────────────────────────────────────────── 응답 헬퍼

/** 성공 응답. `data` 가 `undefined` 면 키를 만들지 않는다(서버와 동일). */
function ok(data?: unknown, message?: string): MockResponse {
  const body: Record<string, unknown> = { success: true };
  if (data !== undefined) body.data = data;
  if (message !== undefined) body.message = message;
  return { status: 200, body };
}

/** 실패 응답. 서버는 `error` 에 영문/한글이 섞여 오지만 앱은 상태코드로만 분기한다. */
function fail(status: number, error: string): MockResponse {
  return { status, body: { success: false, error } };
}

const unauthorized = (): MockResponse => fail(401, 'Token required');

// ───────────────────────────────────────────────────────────── 원시값 헬퍼

type Loose = Record<string, unknown>;

const asRecord = (value: unknown): Loose =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};

const strOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const numOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const boolOf = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/** 요청의 `rawText`/`description` 은 배열로 오고 응답은 JOIN 문자열이다 (API Contract §4-7). */
function joinText(value: unknown, separator: string): string | undefined {
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join(separator);
  return strOf(value);
}

const intParam = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

/** `null` 이 아닌 값만 덮어쓴다 — 4개 서비스의 update 가 전부 `if (x != null)` 부분수정이다. */
function assign<T extends object>(target: T, patch: Partial<Record<keyof T, unknown>>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    (target as Loose)[key] = value;
  }
}

// ───────────────────────────────────────────────────────── 목 JWT 발급

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 → base64url. Hermes 의 `btoa`/`Buffer` 존재를 가정하지 않는다. */
function base64Url(text: string): string {
  const escaped = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i += 1) {
    const ch = escaped[i];
    if (ch === undefined) continue;
    if (ch === '%') {
      bytes.push(Number.parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += BASE64[(triplet >> 18) & 63] ?? '';
    out += BASE64[(triplet >> 12) & 63] ?? '';
    out += b1 === undefined ? '' : (BASE64[(triplet >> 6) & 63] ?? '');
    out += b2 === undefined ? '' : (BASE64[triplet & 63] ?? '');
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * 목 토큰.
 *
 * **`mock.<uuid>` 문자열을 그대로 토큰으로 쓸 수 없다.** `features/auth/token.ts` 의
 * `isJwtLike()` 가 점 3분할 + `sub`/`user_id` 클레임을 요구하고, `login()`/`signup()` 이
 * 그 검사를 통과하지 못하면 `tokenMissing` 파스 에러로 떨어진다. 그래서 **JWT 모양**으로 발급하고
 * 목 식별자는 `jti` 클레임(`mock.<uuid>`)에 담는다. 서명 세그먼트는 `mock` 고정이다.
 * `exp` 를 24시간 뒤로 두어 앱의 만료 배너·자동 로그아웃 로직도 실서버와 같게 동작한다.
 */
function issueMockToken(user: MockUser): string {
  const issuedSec = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: user.id,
      user_id: user.id,
      email: user.email,
      jti: `mock.${uuid()}`,
      iat: issuedSec,
      exp: issuedSec + 24 * 60 * 60,
    }),
  );
  return `${header}.${payload}.mock`;
}

// ───────────────────────────────────────────────────────────── 인증

/** 목에서도 로그인 흐름을 건너뛰지 않는다. 판정 규칙은 `MockRequestOptions.token` 주석 참조. */
function isAuthenticated(token: string | null | undefined): boolean {
  if (typeof token === 'string' && token.trim() !== '') return true;
  if (token === undefined) return readDb().session !== null;
  return false;
}

// ───────────────────────────────────────────────────────── 사용자 응답

const userResponse = (user: MockUser): Loose => ({
  id: user.id,
  email: user.email,
  name: user.name,
  picture: user.picture,
  provider: user.provider,
  createdAt: user.createdAt,
});

/** 서버 `AuthService.changeName` 과 같은 규칙. */
const NAME_PATTERN = /^[a-zA-Z0-9가-힣_.\-]+$/;

/** 이메일 로컬파트에서 닉네임을 만든다 (`AuthService.signup` 이 하는 일). */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0];
  return local && local.length >= 2 ? local.slice(0, 20) : '사용자';
}

// ─────────────────────────────────────────────── 비밀번호 변경 rate limit

/** `PasswordChangeRateLimiter` 재현 — 분당 5회. 인메모리라 앱을 껐다 켜면 초기화된다. */
const passwordAttempts: number[] = [];
const PASSWORD_LIMIT = 5;

function consumePasswordBucket(): boolean {
  const now = Date.now();
  while (passwordAttempts.length > 0 && now - (passwordAttempts[0] ?? 0) > 60_000) {
    passwordAttempts.shift();
  }
  if (passwordAttempts.length >= PASSWORD_LIMIT) return false;
  passwordAttempts.push(now);
  return true;
}

// ───────────────────────────────────────────────────────────── 컨텍스트

type Ctx = {
  method: MockMethod;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /** JSON 바디를 객체로. 배열/스칼라 바디는 `{}` 가 된다(이 API 에는 없다). */
  body: Loose;
  rawBody: unknown;
};

function parseQuery(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      out[rawKey] = rawValue;
    }
  }
  return out;
}

/** `/api/cards/:id` 패턴 매칭. 세그먼트 수가 같고 리터럴이 전부 일치해야 한다. */
function matchPattern(pattern: string, segments: readonly string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const expected = parts[i] ?? '';
    const actual = segments[i] ?? '';
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

// ───────────────────────────────────────────────────────────── 문서 공용

type DocKind = 'card' | 'poster' | 'ticket' | 'receipt';

const NOT_FOUND: Record<DocKind, string> = {
  card: 'Card not found',
  poster: 'Poster not found',
  ticket: 'Ticket not found',
  receipt: 'Receipt not found',
};

/** 문서 4종의 "없는 id" 는 404 가 아니라 500 이다(서버가 `RuntimeException` 을 던진다). */
const docNotFound = (kind: DocKind): MockResponse => fail(500, NOT_FOUND[kind]);

const findCard = (id: string): MockCard | undefined => readDb().cards.find((row) => row.id === id);
const findPoster = (id: number): MockPoster | undefined =>
  readDb().posters.find((row) => row.id === id);
const findTicket = (id: number): MockTicket | undefined =>
  readDb().tickets.find((row) => row.id === id);
const findReceipt = (id: number): MockReceipt | undefined =>
  readDb().receipts.find((row) => row.id === id);

const intId = (raw: string | undefined): number | null => {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

// ───────────────────────────────────────────────────────────── 검색 공용

/**
 * 검색 1회 = 서버 `search_histories` 1행. 앱이 끌 수 없는 서버 동작이므로 목도 그대로 재현한다
 * (`전체` 검색 1회가 4행을 만드는 것까지 같다 — 검색기록 화면의 병합 로직을 확인할 수 있다).
 */
function recordSearchHistory(documentType: string, query: string): void {
  mutate(
    (data) => {
      data.searchHistories.unshift({
        id: uuid(),
        documentType,
        query,
        createdAt: nowDateTime(),
      });
      // 무한 증식 방지. 실서버에도 상한은 없지만 목에서 수천 건이 쌓일 이유가 없다.
      if (data.searchHistories.length > 200) data.searchHistories.length = 200;
    },
    { dirty: false },
  );
}

function searchRows<T extends object>(
  rows: readonly T[],
  fieldsOf: (row: T) => string[],
  q: string,
  topK: number,
): Loose[] {
  const trimmed = q.trim();

  // 빈 검색어(`q=`)는 400 이 아니라 **200 + 전체 목록**이다(실측). 앱이 먼저 막지만 그대로 재현한다.
  if (trimmed === '') {
    return rows.slice(0, topK).map((row) => ({ ...row, similarity: 0.6 }));
  }

  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    const score = matchScore(fieldsOf(row), trimmed);
    if (score !== null) scored.push({ row, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => ({ ...item.row, similarity: item.score }));
}

// ───────────────────────────────────────────────────────────── auth 핸들러

function handleLogin(ctx: Ctx): MockResponse {
  const email = (strOf(ctx.body.email) ?? '').trim();
  const password = strOf(ctx.body.password) ?? '';

  // 목은 아무 이메일/비밀번호나 받되 **8자 미만은 400 으로 떨어뜨린다** — 에러 경로도 확인해야 한다.
  if (email === '' || password.length < 8) {
    return fail(400, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  return mutate(
    (data) => {
      // 목 계정은 1개다. 다른 이메일로 로그인하면 그 계정이 되어 프로필 화면과 어긋나지 않는다.
      if (data.user.email !== email) {
        data.user.email = email;
        data.user.name = nameFromEmail(email);
      }
      data.password = password;
      const token = issueMockToken(data.user);
      data.session = { token, userId: data.user.id, issuedAt: nowDateTime() };
      return ok({
        token,
        userId: data.user.id,
        email: data.user.email,
        name: data.user.name,
      });
    },
    { dirty: false },
  );
}

function handleSignup(ctx: Ctx): MockResponse {
  const email = (strOf(ctx.body.email) ?? '').trim();
  const password = strOf(ctx.body.password) ?? '';
  if (email === '' || password.length < 8) {
    return fail(400, '이메일과 비밀번호를 확인해 주세요.');
  }

  return mutate(
    (data) => {
      data.user.email = email;
      // 서버는 `email.split("@")[0]` 로 닉네임을 만든다. 가입 요청에 name 필드가 아예 없다.
      data.user.name = nameFromEmail(email);
      data.user.provider = 'local';
      data.user.createdAt = nowDateTime();
      data.password = password;
      const token = issueMockToken(data.user);
      data.session = { token, userId: data.user.id, issuedAt: nowDateTime() };
      return ok({
        token,
        userId: data.user.id,
        email: data.user.email,
        name: data.user.name,
      });
    },
    { dirty: false },
  );
}

function handleMe(): MockResponse {
  return ok(userResponse(readDb().user));
}

function handleChangeName(ctx: Ctx): MockResponse {
  const name = (strOf(ctx.body.name) ?? '').trim();
  if (name.length < 2 || name.length > 20 || !NAME_PATTERN.test(name)) {
    return fail(400, '닉네임 형식이 올바르지 않습니다.');
  }
  return mutate((data) => {
    data.user.name = name;
    return ok(userResponse(data.user));
  });
}

function handleDeleteAccount(ctx: Ctx): MockResponse {
  const user = readDb().user;
  if (user.provider === 'local') {
    const password = strOf(ctx.body.password) ?? '';
    if (password.length < 8) return fail(400, '비밀번호가 올바르지 않습니다.');
  }
  // 탈퇴하면 계정과 데이터가 사라진다. 목은 씨드로 되돌려 다음 로그인이 깨끗하게 시작되도록 한다.
  resetDb();
  return ok();
}

function handleChangePassword(ctx: Ctx): MockResponse {
  // 서버는 인증보다 rate limit 을 **먼저** 돌린다(실측: 틀린 비밀번호 5회 → 6회째 429).
  if (!consumePasswordBucket()) return fail(429, 'Too many requests');

  const current = strOf(ctx.body.currentPassword) ?? '';
  const next = strOf(ctx.body.newPassword) ?? '';
  if (next.length < 8) return fail(400, '새 비밀번호는 8자 이상이어야 합니다.');
  if (current === next) return fail(400, '현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
  if (current.length < 8) return fail(400, '현재 비밀번호가 올바르지 않습니다.');

  return mutate((data) => {
    data.password = next;
    return ok();
  });
}

// ───────────────────────────────────────────────────────────── 명함

function handleListCards(ctx: Ctx): MockResponse {
  const page = intParam(ctx.query.page, 0);
  const size = intParam(ctx.query.size, 20);
  const rows = filterCardsByGroup(sortByCreatedAtDesc(readDb().cards), {
    groupId: ctx.query.groupId,
    ungrouped: ctx.query.ungrouped === 'true',
  });
  return ok(paginate(rows, page, size));
}

function handleSaveCard(ctx: Ctx): MockResponse {
  const b = ctx.body;
  const groupId = strOf(b.groupId);
  const row: MockCard = {
    id: uuid(),
    name: strOf(b.name) ?? '',
    company: strOf(b.company) ?? '',
    position: strOf(b.position) ?? '',
    phone: strOf(b.phone) ?? '',
    email: strOf(b.email) ?? '',
    rawOcrText: joinText(b.rawOcrText, '\n') ?? '',
    imageUrl: strOf(b.imageUrl) ?? '',
    groupId: groupId && groupId !== '' ? groupId : null,
    createdAt: nowDateTime(),
  };
  mutate((data) => data.cards.unshift(row));
  return ok(row);
}

function handleGetCard(ctx: Ctx): MockResponse {
  const row = findCard(ctx.params.id ?? '');
  return row ? ok(row) : docNotFound('card');
}

function handleUpdateCard(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!findCard(id)) return docNotFound('card');
  return mutate((data) => {
    const row = data.cards.find((card) => card.id === id);
    if (!row) return docNotFound('card');
    assign(row, {
      name: strOf(ctx.body.name),
      company: strOf(ctx.body.company),
      position: strOf(ctx.body.position),
      phone: strOf(ctx.body.phone),
      email: strOf(ctx.body.email),
      rawOcrText: joinText(ctx.body.rawOcrText, '\n'),
      imageUrl: strOf(ctx.body.imageUrl),
    });
    // 서버 `CardService.update` 는 `groupId != null` 일 때만 반영한다(미분류 복귀 불가).
    const groupId = strOf(ctx.body.groupId);
    if (groupId) row.groupId = groupId;
    return ok(row);
  });
}

function handleDeleteCard(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!findCard(id)) return docNotFound('card');
  mutate((data) => {
    data.cards = data.cards.filter((row) => row.id !== id);
  });
  return ok();
}

/** API-18 — `groupId: null` 이 미분류로 되돌리는 **유일한** 경로다. */
function handleMoveCardGroup(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!findCard(id)) return docNotFound('card');

  // `groupId` 가 `null` 로 오면 미분류로 되돌린다 — 그것이 이 엔드포인트의 존재 이유다.
  const groupId = strOf(ctx.body.groupId);
  if (groupId && !readDb().cardGroups.some((group) => group.id === groupId)) {
    return fail(400, 'Card group not found');
  }

  return mutate((data) => {
    const row = data.cards.find((card) => card.id === id);
    if (!row) return docNotFound('card');
    row.groupId = groupId && groupId !== '' ? groupId : null;
    return ok(row);
  });
}

// ───────────────────────────────────────────────────────────── 포스터

function handleListPosters(ctx: Ctx): MockResponse {
  return ok(
    paginate(
      sortByCreatedAtDesc(readDb().posters),
      intParam(ctx.query.page, 0),
      intParam(ctx.query.size, 20),
    ),
  );
}

function handleSavePoster(ctx: Ctx): MockResponse {
  const b = ctx.body;
  const now = nowDateTime();
  const row: MockPoster = {
    id: nextIntId('poster'),
    docType: 'POSTER',
    classificationConfidence: numOf(b.classificationConfidence) ?? 0,
    title: strOf(b.title) ?? '',
    organizerName: strOf(b.organizerName) ?? '',
    eventStartDate: strOf(b.eventStartDate) ?? '',
    eventEndDate: strOf(b.eventEndDate) ?? '',
    contactPhone: strOf(b.contactPhone) ?? '',
    contactEmail: strOf(b.contactEmail) ?? '',
    location: strOf(b.location) ?? '',
    fee: strOf(b.fee) ?? '',
    websiteUrl: strOf(b.websiteUrl) ?? '',
    description: joinText(b.description, ' ') ?? '',
    // 요청은 배열, 응답은 공백 JOIN 문자열이다.
    rawText: joinText(b.rawText, ' ') ?? '',
    parsedJson: strOf(b.parsedJson) ?? '{}',
    rawJson: strOf(b.rawJson) ?? '[]',
    createdAt: now,
    updatedAt: now,
  };
  mutate((data) => data.posters.unshift(row));
  return ok(row);
}

function handleGetPoster(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  const row = id === null ? undefined : findPoster(id);
  return row ? ok(row) : docNotFound('poster');
}

function handleUpdatePoster(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findPoster(id)) return docNotFound('poster');
  return mutate((data) => {
    const row = data.posters.find((poster) => poster.id === id);
    if (!row) return docNotFound('poster');
    assign(row, {
      title: strOf(ctx.body.title),
      organizerName: strOf(ctx.body.organizerName),
      eventStartDate: strOf(ctx.body.eventStartDate),
      eventEndDate: strOf(ctx.body.eventEndDate),
      contactPhone: strOf(ctx.body.contactPhone),
      contactEmail: strOf(ctx.body.contactEmail),
      location: strOf(ctx.body.location),
      fee: strOf(ctx.body.fee),
      websiteUrl: strOf(ctx.body.websiteUrl),
      description: joinText(ctx.body.description, ' '),
      // `parsedJson` 은 앱이 보내지 않는다(보내면 썸네일이 사라진다 — §4-6). 와도 보존한다.
    });
    row.updatedAt = nowDateTime();
    return ok(row);
  });
}

function handleDeletePoster(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findPoster(id)) return docNotFound('poster');
  mutate((data) => {
    data.posters = data.posters.filter((row) => row.id !== id);
  });
  return ok();
}

// ───────────────────────────────────────────────────────────── 티켓

function handleListTickets(ctx: Ctx): MockResponse {
  return ok(
    paginate(
      sortByCreatedAtDesc(readDb().tickets),
      intParam(ctx.query.page, 0),
      intParam(ctx.query.size, 20),
    ),
  );
}

function handleSaveTicket(ctx: Ctx): MockResponse {
  const b = ctx.body;
  const now = nowDateTime();
  const row: MockTicket = {
    id: nextIntId('ticket'),
    docType: 'TICKET',
    classificationConfidence: numOf(b.classificationConfidence) ?? 0,
    transportType: strOf(b.transportType) ?? '',
    departureLocation: strOf(b.departureLocation) ?? '',
    departureDate: strOf(b.departureDate) ?? '',
    departureTime: strOf(b.departureTime) ?? '',
    arrivalLocation: strOf(b.arrivalLocation) ?? '',
    arrivalDate: strOf(b.arrivalDate) ?? '',
    arrivalTime: strOf(b.arrivalTime) ?? '',
    rawText: joinText(b.rawText, ' ') ?? '',
    parsedJson: strOf(b.parsedJson) ?? '{}',
    rawJson: strOf(b.rawJson) ?? '[]',
    createdAt: now,
    updatedAt: now,
  };
  mutate((data) => data.tickets.unshift(row));
  return ok(row);
}

function handleGetTicket(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  const row = id === null ? undefined : findTicket(id);
  return row ? ok(row) : docNotFound('ticket');
}

function handleUpdateTicket(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findTicket(id)) return docNotFound('ticket');
  return mutate((data) => {
    const row = data.tickets.find((ticket) => ticket.id === id);
    if (!row) return docNotFound('ticket');
    assign(row, {
      transportType: strOf(ctx.body.transportType),
      departureLocation: strOf(ctx.body.departureLocation),
      departureDate: strOf(ctx.body.departureDate),
      departureTime: strOf(ctx.body.departureTime),
      arrivalLocation: strOf(ctx.body.arrivalLocation),
      arrivalDate: strOf(ctx.body.arrivalDate),
      arrivalTime: strOf(ctx.body.arrivalTime),
    });
    row.updatedAt = nowDateTime();
    return ok(row);
  });
}

function handleDeleteTicket(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findTicket(id)) return docNotFound('ticket');
  mutate((data) => {
    data.tickets = data.tickets.filter((row) => row.id !== id);
  });
  return ok();
}

// ───────────────────────────────────────────────────────────── 영수증

function handleListReceipts(ctx: Ctx): MockResponse {
  return ok(
    paginate(
      sortByCreatedAtDesc(readDb().receipts),
      intParam(ctx.query.page, 0),
      intParam(ctx.query.size, 20),
    ),
  );
}

/** 요청 `items[]` → 저장 행. `replaceItems` 라 통째 교체다(`[]` 를 보내면 전량 삭제). */
function toReceiptItems(raw: unknown, createdAt: string): MockReceiptItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const item = asRecord(entry);
    return {
      id: nextIntId('receiptItem'),
      itemName: strOf(item.itemName) ?? '',
      quantity: numOf(item.quantity) ?? null,
      unitPrice: numOf(item.unitPrice) ?? null,
      totalPrice: numOf(item.totalPrice) ?? null,
      category: strOf(item.category) ?? null,
      createdAt,
    };
  });
}

function handleSaveReceipt(ctx: Ctx): MockResponse {
  const b = ctx.body;
  const now = nowDateTime();
  const row: MockReceipt = {
    id: nextIntId('receipt'),
    docType: 'RECEIPT',
    classificationConfidence: numOf(b.classificationConfidence) ?? 0,
    merchantName: strOf(b.merchantName) ?? '',
    merchantAddress: strOf(b.merchantAddress) ?? '',
    purchaseDate: strOf(b.purchaseDate) ?? '',
    purchaseTime: strOf(b.purchaseTime) ?? '',
    paymentMethod: strOf(b.paymentMethod) ?? '',
    cardCompany: strOf(b.cardCompany) ?? '',
    totalAmount: numOf(b.totalAmount) ?? null,
    currencyCode: strOf(b.currencyCode) ?? 'KRW',
    items: toReceiptItems(b.items, now),
    rawText: joinText(b.rawText, ' ') ?? '',
    parsedJson: strOf(b.parsedJson) ?? '{}',
    rawJson: strOf(b.rawJson) ?? '[]',
    createdAt: now,
    updatedAt: now,
  };
  mutate((data) => data.receipts.unshift(row));
  return ok(row);
}

function handleGetReceipt(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  const row = id === null ? undefined : findReceipt(id);
  return row ? ok(row) : docNotFound('receipt');
}

function handleUpdateReceipt(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findReceipt(id)) return docNotFound('receipt');
  const now = nowDateTime();

  return mutate((data) => {
    const row = data.receipts.find((receipt) => receipt.id === id);
    if (!row) return docNotFound('receipt');
    assign(row, {
      merchantName: strOf(ctx.body.merchantName),
      merchantAddress: strOf(ctx.body.merchantAddress),
      purchaseDate: strOf(ctx.body.purchaseDate),
      purchaseTime: strOf(ctx.body.purchaseTime),
      paymentMethod: strOf(ctx.body.paymentMethod),
      cardCompany: strOf(ctx.body.cardCompany),
      totalAmount: numOf(ctx.body.totalAmount),
      currencyCode: strOf(ctx.body.currencyCode),
    });
    // `items` 는 키가 있을 때만 통째 교체한다.
    if (Array.isArray(ctx.body.items)) row.items = toReceiptItems(ctx.body.items, now);
    row.updatedAt = now;
    return ok(row);
  });
}

function handleDeleteReceipt(ctx: Ctx): MockResponse {
  const id = intId(ctx.params.id);
  if (id === null || !findReceipt(id)) return docNotFound('receipt');
  mutate((data) => {
    data.receipts = data.receipts.filter((row) => row.id !== id);
  });
  return ok();
}

// ───────────────────────────────────────────────────────────── 검색 4종

function searchHandler(
  documentType: 'BUSINESS_CARD' | 'POSTER' | 'TICKET' | 'RECEIPT',
): (ctx: Ctx) => MockResponse {
  return (ctx) => {
    const q = ctx.query.q;
    // `q` 를 아예 빼면 400 이다(실측). 빈 문자열은 200 + 전체 목록.
    if (q === undefined) return fail(400, "Required request parameter 'q' is not present");

    const topK = Math.max(1, intParam(ctx.query.topK, 5));
    recordSearchHistory(documentType, q);

    const db = readDb();
    switch (documentType) {
      case 'BUSINESS_CARD':
        return ok(searchRows(sortByCreatedAtDesc(db.cards), cardSearchFields, q, topK));
      case 'POSTER':
        return ok(searchRows(sortByCreatedAtDesc(db.posters), posterSearchFields, q, topK));
      case 'TICKET':
        return ok(searchRows(sortByCreatedAtDesc(db.tickets), ticketSearchFields, q, topK));
      case 'RECEIPT':
        return ok(searchRows(sortByCreatedAtDesc(db.receipts), receiptSearchFields, q, topK));
    }
  };
}

// ───────────────────────────────────────────────────────────── 명함 그룹

const GROUP_NAME_MAX = 60;

function validateGroupName(raw: unknown, excludeId?: string): string | MockResponse {
  const name = (strOf(raw) ?? '').trim();
  if (name === '') return fail(400, '그룹명을 입력해 주세요.');
  if (name.length > GROUP_NAME_MAX) return fail(400, `그룹명은 ${GROUP_NAME_MAX}자 이하여야 합니다.`);
  const duplicated = readDb().cardGroups.some(
    (group) => group.name === name && group.id !== excludeId,
  );
  // `UNIQUE(user_id, name)` — 이 컨트롤러만 도메인 실패에 400 을 쓴다.
  if (duplicated) return fail(400, '이미 존재하는 그룹명입니다.');
  return name;
}

function handleListCardGroups(): MockResponse {
  // `data` 가 Page 가 아니라 **바로 배열**이고 정렬은 `createdAt ASC` 다.
  const rows = [...readDb().cardGroups].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return ok(rows);
}

function handleCreateCardGroup(ctx: Ctx): MockResponse {
  const validated = validateGroupName(ctx.body.name);
  if (typeof validated !== 'string') return validated;

  const now = nowDateTime();
  const row: MockCardGroup = { id: uuid(), name: validated, createdAt: now, updatedAt: now };
  mutate((data) => data.cardGroups.push(row));
  return ok(row);
}

function handleRenameCardGroup(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!readDb().cardGroups.some((group) => group.id === id)) {
    return fail(400, 'Card group not found');
  }
  const validated = validateGroupName(ctx.body.name, id);
  if (typeof validated !== 'string') return validated;

  return mutate((data) => {
    const row = data.cardGroups.find((group) => group.id === id);
    if (!row) return fail(400, 'Card group not found');
    row.name = validated;
    row.updatedAt = nowDateTime();
    return ok(row);
  });
}

function handleDeleteCardGroup(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!readDb().cardGroups.some((group) => group.id === id)) {
    return fail(400, 'Card group not found');
  }
  mutate((data) => {
    data.cardGroups = data.cardGroups.filter((group) => group.id !== id);
    // 소속 명함은 미분류로 내려간다(실서버에서는 FK 제약이 하는 일).
    for (const card of data.cards) {
      if (card.groupId === id) card.groupId = null;
    }
  });
  return ok();
}

// ───────────────────────────────────────────────────────────── 대시보드

const DEADLINE_ITEM_LIMIT = 20;

/** `YYYY-MM-DD` 두 개의 일수 차이. */
function diffDays(from: string, to: string): number | null {
  const parse = (iso: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function handleDashboard(ctx: Ctx): MockResponse {
  const db = readDb();
  const date = ctx.query.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date) ? ctx.query.date : todayDate();
  // 서버는 `Math.max(0, deadlineDays)` 로만 정규화한다(상한 없음).
  const deadlineDays = Math.max(0, intParam(ctx.query.deadlineDays, 30));

  const todaySchedules: Loose[] = [];
  for (const ticket of db.tickets) {
    if (ticket.departureDate !== date) continue;
    todaySchedules.push({
      type: 'TICKET',
      // ⚠ `String.valueOf(id)` — 티켓·포스터의 Integer PK 도 **문자열**로 온다.
      id: String(ticket.id),
      title: `${ticket.departureLocation} → ${ticket.arrivalLocation}`,
      time: ticket.departureTime,
      date: ticket.departureDate,
    });
  }
  for (const poster of db.posters) {
    if (poster.eventStartDate !== date) continue;
    todaySchedules.push({
      type: 'POSTER',
      id: String(poster.id),
      title: poster.title,
      time: '', // 포스터는 시각이 없다(서버가 빈 문자열을 보낸다).
      date: poster.eventStartDate,
    });
  }
  todaySchedules.sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99')));

  const deadlines: (Loose & { dDay: number })[] = [];
  for (const ticket of db.tickets) {
    const dDay = diffDays(date, ticket.departureDate);
    if (dDay === null || dDay < 0 || dDay > deadlineDays) continue;
    deadlines.push({
      type: 'TICKET',
      id: String(ticket.id),
      title: `${ticket.departureLocation} → ${ticket.arrivalLocation}`,
      subtitle: ticket.transportType,
      date: ticket.departureDate,
      dDay,
      // `parsedJson` 에서 뽑는데 목에는 이미지가 없으므로 빈 문자열이다(서버도 실패하면 `""`).
      imageUrl: '',
    });
  }
  for (const poster of db.posters) {
    const dDay = diffDays(date, poster.eventStartDate);
    if (dDay === null || dDay < 0 || dDay > deadlineDays) continue;
    deadlines.push({
      type: 'POSTER',
      id: String(poster.id),
      title: poster.title,
      subtitle: poster.organizerName,
      date: poster.eventStartDate,
      dDay,
      imageUrl: '',
    });
  }
  deadlines.sort((a, b) => a.dDay - b.dDay);
  const upcomingDeadlines = deadlines.slice(0, DEADLINE_ITEM_LIMIT);

  return ok({
    date,
    deadlineDays,
    todayScheduleCount: todaySchedules.length,
    upcomingDeadlineCount: upcomingDeadlines.length,
    storedDocumentCount:
      db.cards.length + db.tickets.length + db.posters.length + db.receipts.length,
    upcomingDeadlines,
    todaySchedules,
  });
}

// ───────────────────────────────────────────────────────────── 알림

const NOTIFICATION_MAX_PAGE_SIZE = 50;

const notificationResponse = (row: MockNotification): Loose => ({
  id: row.id,
  type: row.type,
  title: row.title,
  message: row.message,
  linkUrl: row.linkUrl,
  read: row.read,
  readAt: row.readAt,
  createdAt: row.createdAt,
});

function handleListNotifications(ctx: Ctx): MockResponse {
  const page = intParam(ctx.query.page, 0);
  // 서버는 상한을 넘겨도 에러가 아니라 조용히 깎는다: `Math.min(Math.max(size,1), 50)`.
  const size = Math.min(Math.max(intParam(ctx.query.size, 10), 1), NOTIFICATION_MAX_PAGE_SIZE);
  const rows = sortByCreatedAtDesc(readDb().notifications).map(notificationResponse);
  return ok(paginate(rows, page, size));
}

function handleUnreadCount(): MockResponse {
  // `Map<String,Long>` 이라 스칼라가 아니라 `{count:N}` 이다.
  return ok({ count: readDb().notifications.filter((row) => !row.read).length });
}

function handleMarkNotificationRead(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  // 알림은 문서 4종과 달리 **400** 이다.
  if (!readDb().notifications.some((row) => row.id === id)) {
    return fail(400, 'Notification not found');
  }
  return mutate((data) => {
    const row = data.notifications.find((item) => item.id === id);
    if (!row) return fail(400, 'Notification not found');
    // 이미 읽었으면 `readAt` 을 덮어쓰지 않는다 (`if (readAt == null)`).
    if (row.readAt === null) {
      row.readAt = nowDateTime();
      row.read = true;
    }
    return ok(notificationResponse(row));
  });
}

function handleMarkAllNotificationsRead(): MockResponse {
  return mutate((data) => {
    let updatedCount = 0;
    const at = nowDateTime();
    for (const row of data.notifications) {
      if (row.readAt === null) {
        row.readAt = at;
        row.read = true;
        updatedCount += 1;
      }
    }
    return ok({ updatedCount });
  });
}

function handleDeleteNotification(ctx: Ctx): MockResponse {
  const id = ctx.params.id ?? '';
  if (!readDb().notifications.some((row) => row.id === id)) {
    return fail(400, 'Notification not found');
  }
  mutate((data) => {
    data.notifications = data.notifications.filter((row) => row.id !== id);
  });
  return ok();
}

function handleDeleteAllNotifications(): MockResponse {
  return mutate((data) => {
    const deleted = data.notifications.length;
    data.notifications = [];
    // 이 엔드포인트만 `data` 가 **스칼라 숫자**다.
    return ok(deleted);
  });
}

// ───────────────────────────────────────────────────────── 알림 설정

const settingsResponse = (): Loose => {
  const s = readDb().notificationSettings;
  return {
    deadlineReminderDays: s.deadlineReminderDays,
    deadlineReminderEnabled: s.deadlineReminderEnabled,
    scheduleReminderEnabled: s.scheduleReminderEnabled,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
};

function handleGetNotificationSettings(): MockResponse {
  return ok(settingsResponse());
}

function handleUpdateNotificationSettings(ctx: Ctx): MockResponse {
  const days = numOf(ctx.body.deadlineReminderDays);
  if (days !== undefined && (days < 0 || days > 30)) {
    return fail(400, '알림 일수는 0~30 사이여야 합니다.');
  }

  return mutate((data) => {
    // 이름은 PUT 이지만 의미는 PATCH 다 — 보내지 않은 필드(래퍼 타입 null)는 유지된다.
    if (days !== undefined) data.notificationSettings.deadlineReminderDays = Math.trunc(days);
    const deadlineEnabled = boolOf(ctx.body.deadlineReminderEnabled);
    if (deadlineEnabled !== undefined) {
      data.notificationSettings.deadlineReminderEnabled = deadlineEnabled;
    }
    const scheduleEnabled = boolOf(ctx.body.scheduleReminderEnabled);
    if (scheduleEnabled !== undefined) {
      data.notificationSettings.scheduleReminderEnabled = scheduleEnabled;
    }
    data.notificationSettings.updatedAt = nowDateTime();
    return ok(settingsResponse());
  });
}

// ───────────────────────────────────────────────────────── 검색 기록

function handleListSearchHistories(): MockResponse {
  const rows = sortByCreatedAtDesc(readDb().searchHistories).map((row) => ({
    id: row.id,
    documentType: row.documentType,
    query: row.query,
    createdAt: row.createdAt,
  }));
  // `data` 가 바로 배열이다.
  return ok(rows);
}

function handleClearSearchHistories(): MockResponse {
  return mutate((data) => {
    const deleted = data.searchHistories.length;
    data.searchHistories = [];
    // 스칼라 숫자(삭제 건수).
    return ok(deleted);
  });
}

// ───────────────────────────────────────────────────────────── 챗봇

const CHAT_DOC_TYPES: readonly MockChatDocType[] = [
  'BUSINESS_CARD',
  'POSTER',
  'TICKET',
  'RECEIPT',
];

function handleChat(ctx: Ctx): MockResponse {
  const query = strOf(ctx.body.query)?.trim() ?? '';
  // 앱은 **snake_case** 로 보낸다(`@JsonAlias`). camelCase 도 관대하게 받는다.
  const rawType = strOf(ctx.body.document_type) ?? strOf(ctx.body.documentType) ?? '';
  const topK = numOf(ctx.body.top_k) ?? numOf(ctx.body.topK) ?? 5;

  if (query === '') return fail(400, 'query is required');
  if (!CHAT_DOC_TYPES.includes(rawType as MockChatDocType)) {
    // camelCase 로 보내 `documentType` 이 null 이 되면 LLM 이 500 을 던진다(실서버 동작).
    return fail(500, 'document_type is required');
  }

  const result = answerChat(query, rawType as MockChatDocType, Math.trunc(topK));
  // 챗봇의 마지막 홉도 검색 API 다 → 검색기록 1건이 쌓인다.
  recordSearchHistory(rawType, query);
  return ok(result);
}

// ───────────────────────────────────────────────────── 내 문서 전체 삭제

function handleDeleteMyDocuments(): MockResponse {
  return mutate((data) => {
    const result = {
      deletedBusinessCards: data.cards.length,
      deletedTickets: data.tickets.length,
      deletedPosters: data.posters.length,
      deletedReceipts: data.receipts.length,
      deletedSearchHistories: data.searchHistories.length,
      // 계정은 남고 이벤트 매핑만 지워진다 — **연동 자체는 유지**된다(SCR-28 카피).
      deletedGoogleCalendarMappings: data.calendar.connected ? 2 : 0,
      deletedNotifications: data.notifications.length,
    };
    data.cards = [];
    data.tickets = [];
    data.posters = [];
    data.receipts = [];
    data.searchHistories = [];
    data.notifications = [];
    return ok(result);
  });
}

// ───────────────────────────────────────────────────── 구글 캘린더

function handleCalendarConnected(ctx: Ctx): MockResponse {
  return ok({ userId: ctx.params.userId ?? readDb().user.id, connected: readDb().calendar.connected });
}

function handleCalendarTokens(ctx: Ctx): MockResponse {
  const calendar = readDb().calendar;
  // 미연동이면 400 이다. 에러가 아니라 정상 상태이므로 호출부가 조용히 무시한다.
  if (!calendar.connected) return fail(400, '구글 캘린더 연동 정보가 없습니다.');
  return ok({
    userId: ctx.params.userId ?? readDb().user.id,
    googleEmail: calendar.googleEmail,
    expiresAt: calendar.expiresAt,
    scope: calendar.scope,
    connected: true,
  });
}

function handleCalendarConnectUrl(): MockResponse {
  // 실서버도 400 이다(client-id/secret 미설정 — 실측). 목이 가짜 URL 을 주면 인앱 브라우저가
  // 착지하지 못해 90초 타임아웃까지 매달린다. 실패를 그대로 재현하는 편이 정확하다.
  return fail(400, '구글 캘린더 설정이 없습니다.');
}

function handleCalendarDisconnect(ctx: Ctx): MockResponse {
  if (!readDb().calendar.connected) return fail(400, '구글 캘린더 연동 정보가 없습니다.');
  return mutate((data) => {
    data.calendar.connected = false;
    data.calendar.googleEmail = '';
    data.calendar.expiresAt = '';
    return ok({ userId: ctx.params.userId ?? data.user.id, connected: false });
  });
}

function handleCalendarMonth(ctx: Ctx): MockResponse {
  const now = new Date();
  return ok({
    userId: ctx.query.userId ?? readDb().user.id,
    year: intParam(ctx.query.year, now.getFullYear()),
    month: intParam(ctx.query.month, now.getMonth() + 1),
    connected: readDb().calendar.connected,
    // 서버가 채우지 않는다(항상 빈 배열). 화면도 이 값을 쓰지 않는다.
    events: [],
  });
}

// ───────────────────────────────────────────────────────────── 라우팅 표

type Route = {
  method: MockMethod;
  /** `:name` 세그먼트가 `ctx.params` 로 들어온다. */
  pattern: string;
  /** 인증이 필요한가. 로그인·회원가입만 false. */
  auth: boolean;
  handle: (ctx: Ctx) => MockResponse;
};

/**
 * **순서가 의미를 가진다.** 리터럴 경로(`/api/cards/search`, `/api/cards/save`)를
 * 파라미터 경로(`/api/cards/:id`) **앞**에 둬야 `search` 가 id 로 먹히지 않는다.
 */
const ROUTES: readonly Route[] = [
  // auth
  { method: 'POST', pattern: '/auth/login', auth: false, handle: handleLogin },
  { method: 'POST', pattern: '/auth/signup', auth: false, handle: handleSignup },
  { method: 'PATCH', pattern: '/auth/me/password', auth: true, handle: handleChangePassword },
  { method: 'GET', pattern: '/auth/me', auth: true, handle: handleMe },
  { method: 'PATCH', pattern: '/auth/me', auth: true, handle: handleChangeName },
  { method: 'DELETE', pattern: '/auth/me', auth: true, handle: handleDeleteAccount },

  // 명함
  { method: 'GET', pattern: '/api/cards/search', auth: true, handle: searchHandler('BUSINESS_CARD') },
  { method: 'POST', pattern: '/api/cards/save', auth: true, handle: handleSaveCard },
  { method: 'GET', pattern: '/api/cards', auth: true, handle: handleListCards },
  { method: 'PATCH', pattern: '/api/cards/:id/group', auth: true, handle: handleMoveCardGroup },
  { method: 'GET', pattern: '/api/cards/:id', auth: true, handle: handleGetCard },
  { method: 'PUT', pattern: '/api/cards/:id', auth: true, handle: handleUpdateCard },
  { method: 'DELETE', pattern: '/api/cards/:id', auth: true, handle: handleDeleteCard },

  // 포스터
  { method: 'GET', pattern: '/api/posters/search', auth: true, handle: searchHandler('POSTER') },
  { method: 'POST', pattern: '/api/posters/save', auth: true, handle: handleSavePoster },
  { method: 'GET', pattern: '/api/posters', auth: true, handle: handleListPosters },
  { method: 'GET', pattern: '/api/posters/:id', auth: true, handle: handleGetPoster },
  { method: 'PUT', pattern: '/api/posters/:id', auth: true, handle: handleUpdatePoster },
  { method: 'DELETE', pattern: '/api/posters/:id', auth: true, handle: handleDeletePoster },

  // 티켓
  { method: 'GET', pattern: '/api/tickets/search', auth: true, handle: searchHandler('TICKET') },
  { method: 'POST', pattern: '/api/tickets/save', auth: true, handle: handleSaveTicket },
  { method: 'GET', pattern: '/api/tickets', auth: true, handle: handleListTickets },
  { method: 'GET', pattern: '/api/tickets/:id', auth: true, handle: handleGetTicket },
  { method: 'PUT', pattern: '/api/tickets/:id', auth: true, handle: handleUpdateTicket },
  { method: 'DELETE', pattern: '/api/tickets/:id', auth: true, handle: handleDeleteTicket },

  // 영수증
  { method: 'GET', pattern: '/api/receipts/search', auth: true, handle: searchHandler('RECEIPT') },
  { method: 'POST', pattern: '/api/receipts/save', auth: true, handle: handleSaveReceipt },
  { method: 'GET', pattern: '/api/receipts', auth: true, handle: handleListReceipts },
  { method: 'GET', pattern: '/api/receipts/:id', auth: true, handle: handleGetReceipt },
  { method: 'PUT', pattern: '/api/receipts/:id', auth: true, handle: handleUpdateReceipt },
  { method: 'DELETE', pattern: '/api/receipts/:id', auth: true, handle: handleDeleteReceipt },

  // 명함 그룹
  { method: 'GET', pattern: '/api/card-groups', auth: true, handle: handleListCardGroups },
  { method: 'POST', pattern: '/api/card-groups', auth: true, handle: handleCreateCardGroup },
  { method: 'PATCH', pattern: '/api/card-groups/:id', auth: true, handle: handleRenameCardGroup },
  { method: 'DELETE', pattern: '/api/card-groups/:id', auth: true, handle: handleDeleteCardGroup },

  // 대시보드
  { method: 'GET', pattern: '/api/dashboard', auth: true, handle: handleDashboard },

  // 알림
  { method: 'GET', pattern: '/api/notifications/unread-count', auth: true, handle: handleUnreadCount },
  {
    method: 'PATCH',
    pattern: '/api/notifications/read-all',
    auth: true,
    handle: handleMarkAllNotificationsRead,
  },
  {
    method: 'PATCH',
    pattern: '/api/notifications/:id/read',
    auth: true,
    handle: handleMarkNotificationRead,
  },
  { method: 'GET', pattern: '/api/notifications', auth: true, handle: handleListNotifications },
  { method: 'DELETE', pattern: '/api/notifications', auth: true, handle: handleDeleteAllNotifications },
  {
    method: 'DELETE',
    pattern: '/api/notifications/:id',
    auth: true,
    handle: handleDeleteNotification,
  },

  // 알림 설정
  {
    method: 'GET',
    pattern: '/api/notification-settings',
    auth: true,
    handle: handleGetNotificationSettings,
  },
  {
    method: 'PUT',
    pattern: '/api/notification-settings',
    auth: true,
    handle: handleUpdateNotificationSettings,
  },

  // 검색 기록
  { method: 'GET', pattern: '/api/search-histories', auth: true, handle: handleListSearchHistories },
  {
    method: 'DELETE',
    pattern: '/api/search-histories',
    auth: true,
    handle: handleClearSearchHistories,
  },

  // 챗봇
  { method: 'POST', pattern: '/api/chat', auth: true, handle: handleChat },

  // 내 데이터
  { method: 'DELETE', pattern: '/api/me/documents', auth: true, handle: handleDeleteMyDocuments },

  // 구글 캘린더
  {
    method: 'GET',
    pattern: '/api/google-calendar/connect-url',
    auth: true,
    handle: handleCalendarConnectUrl,
  },
  {
    method: 'GET',
    pattern: '/api/google-calendar/connected/:userId',
    auth: true,
    handle: handleCalendarConnected,
  },
  {
    method: 'GET',
    pattern: '/api/google-calendar/tokens/:userId',
    auth: true,
    handle: handleCalendarTokens,
  },
  {
    method: 'DELETE',
    pattern: '/api/google-calendar/tokens/:userId',
    auth: true,
    handle: handleCalendarDisconnect,
  },
  { method: 'GET', pattern: '/api/google-calendar/month', auth: true, handle: handleCalendarMonth },
];

// ───────────────────────────────────────────────────────────── 진입점

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 200~600ms. 즉시 응답하면 스켈레톤·로딩·취소 버튼을 검증할 수 없다. */
const randomDelay = (): number =>
  MOCK_MIN_DELAY_MS + Math.floor(Math.random() * (MOCK_MAX_DELAY_MS - MOCK_MIN_DELAY_MS + 1));

/**
 * 목 응답 1건. 네트워크 계층이 `request()` 안에서 `fetch` 대신 이것을 부른다.
 *
 * @param method HTTP 메서드
 * @param path   `/api/cards?page=0&size=20` 처럼 **쿼리스트링을 포함한** 경로 (base URL 제외)
 * @param body   JSON 바디(있으면). 문자열이면 파싱해서 받는다.
 */
export async function handleMockRequest(
  method: string,
  path: string,
  body?: unknown,
  options: MockRequestOptions = {},
): Promise<MockResponse> {
  await sleep(randomDelay());

  const upper = method.toUpperCase() as MockMethod;
  const [rawPath = '', rawQuery = ''] = path.split('?');
  const segments = rawPath.split('/').filter(Boolean).map(decodeSegment);

  let parsedBody: unknown = body;
  if (typeof body === 'string' && body !== '') {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = body;
    }
  }

  for (const route of ROUTES) {
    if (route.method !== upper) continue;
    const params = matchPattern(route.pattern, segments);
    if (params === null) continue;

    if (route.auth && !isAuthenticated(options.token)) return unauthorized();

    const ctx: Ctx = {
      method: upper,
      path: rawPath,
      params,
      query: parseQuery(rawQuery),
      body: asRecord(parsedBody),
      rawBody: parsedBody,
    };

    try {
      return route.handle(ctx);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // 목 자체의 버그를 서버 장애처럼 보여 준다. 콘솔에 원인을 남겨야 추적이 된다.
      console.warn(`[mock] ${upper} ${rawPath} 처리 중 예외: ${detail}`);
      return fail(500, `Mock handler error: ${detail}`);
    }
  }

  console.warn(`[mock] 처리되지 않은 경로: ${upper} ${path}`);
  return fail(404, `No mock handler for ${upper} ${rawPath}`);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 이 목이 처리할 수 있는 경로인지 (네트워크 계층이 폴백을 고를 때 쓴다). */
export function isMockedPath(method: string, path: string): boolean {
  const upper = method.toUpperCase() as MockMethod;
  const [rawPath = ''] = path.split('?');
  const segments = rawPath.split('/').filter(Boolean).map(decodeSegment);
  return ROUTES.some(
    (route) => route.method === upper && matchPattern(route.pattern, segments) !== null,
  );
}

/** 목이 다루는 경로 목록 (디버그 화면용). */
export const MOCK_ROUTE_TABLE: readonly string[] = ROUTES.map(
  (route) => `${route.method} ${route.pattern}`,
);
