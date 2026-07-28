import { normalizeDateTime, request, type ApiResult } from '@/services/http';
import { clearSession, saveSession, type SessionUser } from '@/services/session';

import { AUTH_COPY } from './messages';
import { isJwtLike } from './token';

/**
 * /auth/* 엔드포인트 어댑터 (API-01 ~ API-04).
 *
 * 계약 정본: wiki/tech/API Contract.md §3-1, wiki/tech/Auth.md §2.
 * 서버 DTO 는 원본 backend/dto/auth/*.java 를 직접 확인했다:
 *  - `AuthResponse { token, userId(UUID), email, name }`  ← 로그인·회원가입 공통 응답
 *  - `UserResponse { id, email, name, picture, provider, createdAt }` ← /auth/me
 *  - `SignupRequest { email, password }` — **`name` 필드가 없다.** 서버가 `email.split("@")[0]` 로
 *    닉네임을 자동 생성한다(AuthService.signup:52). 그래서 가입 요청에 name 을 넣어도 무시된다 →
 *    FR-024 는 가입 직후 별도 단계에서 API-04(PATCH /auth/me)를 호출해 닉네임을 반영한다.
 *  - `ChangeNameRequest { name }` — 서버 검증 `trim()` 후 2~20자 + `^[a-zA-Z0-9가-힣_.\-]+$`
 *
 * 응답 래퍼 함정: `ApiResponse` 는 `@JsonInclude(NON_NULL)` 이라 data 가 null 이면 키가 사라진다.
 * `request()` 가 `envelope.data` 유무를 흡수하므로 여기서는 필드 존재만 방어적으로 검사한다.
 */

export type AuthProvider = 'local' | 'google' | 'kakao' | 'naver';

/** 앱 모델. 서버 `UserResponse` 를 정규화한 결과. */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  /** 프로필 사진 URL. 소셜 계정만 값이 있다. */
  picture?: string;
  /** 계정 종류. 설정 화면의 비밀번호 변경/탈퇴 분기에 쓴다. */
  provider: AuthProvider;
  /** ISO 문자열로 정규화된 가입 시각 (서버가 숫자 배열로 줄 수 있다). */
  createdAt?: string;
};

/** 로그인·회원가입·OAuth 가 공통으로 만들어 내는 세션 재료. */
export type AuthCredentials = {
  token: string;
  /**
   * `AuthResponse` 로만 만든 잠정 프로필. `picture` / `provider` / `createdAt` 이 없어서
   * 곧바로 API-03 으로 덮어써야 한다 (Auth.md §2-3).
   */
  user: AuthUser;
};

export type EmailCredentialInput = { email: string; password: string };

/** 서버가 소문자/공백 정규화를 하지 않으므로 앱이 보낸 값이 그대로 저장된다. */
function toProvider(raw: unknown): AuthProvider {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value === 'google' || value === 'kakao' || value === 'naver') return value;
  return 'local';
}

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** 이메일 로컬파트 폴백. 원본 웹(`dashboard/layout.tsx`)의 폴백 규칙을 그대로 옮겼다. */
function fallbackName(email: string): string {
  const local = email.split('@')[0];
  return local && local.length > 0 ? local : '사용자';
}

/** 서버 `UserResponse` → 앱 `AuthUser`. */
export function toAuthUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const id = asString(d.id);
  const email = asString(d.email);
  if (!id) return null;

  const picture = asString(d.picture);
  const name = asString(d.name);

  return {
    id,
    email,
    name: name || fallbackName(email),
    ...(picture ? { picture } : {}),
    provider: toProvider(d.provider),
    ...(() => {
      const createdAt = normalizeDateTime(d.createdAt);
      return createdAt ? { createdAt } : {};
    })(),
  };
}

/**
 * 서버 `AuthResponse` → 토큰 + 잠정 프로필.
 * `provider` 는 응답에 없다. 로그인/가입은 항상 로컬 계정이고(소셜 전용 계정은 서버가 차단한다),
 * OAuth 경로는 사용자가 누른 버튼으로 알 수 있으므로 호출부가 힌트를 넘긴다.
 */
function toCredentials(raw: unknown, providerHint: AuthProvider): AuthCredentials | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const token = asString(d.token);
  if (!isJwtLike(token)) return null;

  const email = asString(d.email);
  const name = asString(d.name);
  const id = asString(d.userId) || asString(d.id);

  return {
    token,
    user: {
      id,
      email,
      name: name || fallbackName(email),
      provider: providerHint,
    },
  };
}

const tokenMissingError = <T>(): ApiResult<T> => ({
  ok: false,
  error: { kind: 'parse', status: null, message: AUTH_COPY.tokenMissing },
});

/**
 * API-02 `POST /auth/login`.
 *
 * 실패는 **401 이 아니라 400** 이다 (`AuthController.login` 이 `RuntimeException` 을
 * `badRequest` 로 내린다). 그래서 자격증명 오류가 세션 만료 처리로 새지 않는다.
 * 토큰을 싣지 않는 요청이므로 `anonymous: true` 로 보낸다 (Auth.md §2-3).
 */
export async function login(input: EmailCredentialInput): Promise<ApiResult<AuthCredentials>> {
  const res = await request<unknown>('/auth/login', {
    method: 'POST',
    json: { email: input.email, password: input.password },
    anonymous: true,
  });
  if (!res.ok) return res;

  const credentials = toCredentials(res.data, 'local');
  return credentials ? { ok: true, data: credentials } : tokenMissingError();
}

/**
 * API-01 `POST /auth/signup`.
 *
 * 서버 검증은 `email`/`password` blank 검사와 이메일 중복(`existsByEmail`)뿐이다. 형식·길이·복잡도
 * 검사가 전혀 없으므로 **앱이 유일한 방어선**이다 → schema.ts 가 선차단한다 (Auth.md §2-2).
 * `name` 은 보내지 않는다 — `SignupRequest` 에 필드가 없다.
 */
export async function signup(input: EmailCredentialInput): Promise<ApiResult<AuthCredentials>> {
  const res = await request<unknown>('/auth/signup', {
    method: 'POST',
    json: { email: input.email, password: input.password },
    anonymous: true,
  });
  if (!res.ok) return res;

  const credentials = toCredentials(res.data, 'local');
  return credentials ? { ok: true, data: credentials } : tokenMissingError();
}

/**
 * API-03 `GET /auth/me` — 프로필 정본.
 *
 * `AuthResponse` 에 없는 `picture`/`provider`/`createdAt` 을 얻는 유일한 경로다.
 * 토큰이 없거나 깨졌으면 **401**(`Token required`/`Invalid token`), 사용자가 삭제됐으면
 * **400**(`User not found`) 이 온다. 두 경우 모두 세션 만료로 취급한다 (Auth.md §5-1).
 */
export async function fetchMe(): Promise<ApiResult<AuthUser>> {
  const res = await request<unknown>('/auth/me');
  if (!res.ok) return res;

  const user = toAuthUser(res.data);
  return user
    ? { ok: true, data: user }
    : { ok: false, error: { kind: 'parse', status: null, message: AUTH_COPY.tokenMissing } };
}

/**
 * API-04 `PATCH /auth/me` — 닉네임 변경 (FR-024 가입 직후 단계 / SCR-26).
 * 서버가 `trim()` 후 2~20자 + 문자 클래스를 재검증하므로 schema.ts 와 규칙을 일치시켜 두었다.
 */
export async function changeName(name: string): Promise<ApiResult<AuthUser>> {
  const res = await request<unknown>('/auth/me', { method: 'PATCH', json: { name } });
  if (!res.ok) return res;

  const user = toAuthUser(res.data);
  return user
    ? { ok: true, data: user }
    : { ok: false, error: { kind: 'parse', status: null, message: AUTH_COPY.nameChangeFailed } };
}

/** `AuthUser` → SecureStore 스냅샷 형태. */
export function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    ...(user.picture ? { picture: user.picture } : {}),
    provider: user.provider,
  };
}

/** SecureStore 스냅샷 → `AuthUser` (부팅 첫 프레임용. provider 가 없으면 local 로 본다). */
export function fromSessionUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || fallbackName(user.email),
    ...(user.picture ? { picture: user.picture } : {}),
    provider: toProvider(user.provider),
  };
}

/** 토큰과 프로필 스냅샷을 SecureStore 에 적는다 (평문 저장 금지 — FR-028 / NFR-013). */
export async function persistSession(credentials: AuthCredentials): Promise<void> {
  await saveSession(credentials.token, toSessionUser(credentials.user));
}

/**
 * 로그아웃 — **서버 엔드포인트가 없다.** 원본 웹에도 `// TODO: wire to /auth/logout endpoint` 주석만
 * 있다. 클라이언트 토큰 폐기가 유일한 수단이며, 발급된 JWT 는 만료(24h)까지 서버에서 계속 유효하다
 * (Auth.md §4-5 · Risks 등재 사항).
 */
export async function signOutLocal(): Promise<void> {
  await clearSession();
}

/** 소셜 계정인가 — 비밀번호 변경(API-05)·탈퇴(API-06) 분기 기준. */
export function isSocialAccount(user: AuthUser | null): boolean {
  return user !== null && user.provider !== 'local';
}
