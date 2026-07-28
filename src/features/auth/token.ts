/**
 * JWT 페이로드 해독 (검증 아님).
 *
 * 서버 토큰 사실관계 — 원본: backend/security/JwtUtil.java
 *  - HS256, 클레임은 `sub`(userId) · `email` · `user_id` · `iat` · `exp` 뿐이고 롤/권한 클레임이 없다.
 *  - 만료는 `app.jwt-expiration` 기본 86,400,000ms = 24시간. **리프레시 토큰 경로가 서버에 없다.**
 *
 * 서명은 서버 시크릿이 있어야 검증할 수 있으므로 앱은 검증하지 않는다.
 * 앱이 여기서 하는 일은 두 가지뿐이다:
 *  1. 형식이 JWT 인지 (딥링크로 들어온 문자열을 그대로 저장하지 않기 위한 최소 방어 — NFR-017)
 *  2. `exp` 가 이미 지났는지 (지났으면 네트워크 호출 없이 세션을 정리한다 — Auth.md §4-3 3단계)
 * 최종 유효성 판정은 항상 `GET /auth/me` 의 응답이다.
 *
 * wiki/tech/Auth.md §4-2 는 발급 시각을 SecureStore `tokenIssuedAt` 키에 따로 적으라고 하지만,
 * 토큰 자체가 `exp` 를 들고 있어 별도 키가 필요 없다. 키를 하나 줄이고 두 값이 어긋날 여지도 없앤다.
 */

/** 서버 JWT 클레임. 전부 optional 로 둔다 — 조작된 딥링크가 빈 페이로드를 줄 수 있다. */
export type JwtClaims = {
  sub?: string;
  email?: string;
  user_id?: string;
  /** 초 단위 (JWT 표준) */
  iat?: number;
  /** 초 단위 (JWT 표준) */
  exp?: number;
};

/** 서버 기본 토큰 수명. 원본: application.yml `app.jwt-expiration: 86400000` */
export const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** 만료 몇 분 전부터 비차단 배너를 띄울지 (Auth.md §4-4). */
export const EXPIRY_WARNING_MS = 60 * 60 * 1000;

/** 기기 시계 오차 보정. 만료 직전 토큰으로 요청을 보내 401 을 받는 것보다 미리 끊는 편이 낫다. */
const CLOCK_SKEW_MS = 30_000;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * base64url → UTF-8 문자열.
 *
 * Hermes 의 `atob` / `Buffer` / `TextDecoder` 존재 여부에 의존하지 않기 위해 직접 구현한다.
 * 바이트를 퍼센트 인코딩으로 옮긴 뒤 `decodeURIComponent` 에 맡겨 멀티바이트(한글 이름 등)도 살린다.
 */
function decodeBase64Url(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  let percent = '';
  let buffer = 0;
  let bits = 0;

  for (const ch of padded) {
    if (ch === '=') break;
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) return null; // base64 가 아닌 문자가 섞여 있다 → 토큰으로 취급하지 않는다
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      percent += `%${byte.toString(16).padStart(2, '0')}`;
    }
  }

  try {
    return decodeURIComponent(percent);
  } catch {
    return null;
  }
}

/** JWT 의 페이로드를 해독한다. 형식이 어긋나면 null (서명은 검증하지 않는다). */
export function decodeJwtClaims(token: string | null | undefined): JwtClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (!payload) return null;

  const json = decodeBase64Url(payload);
  if (!json) return null;

  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as JwtClaims;
  } catch {
    return null;
  }
}

/** 딥링크·서버 응답에서 받은 문자열이 JWT 모양인지 본다 (NFR-017 최소 검사). */
export function isJwtLike(token: string | null | undefined): token is string {
  const claims = decodeJwtClaims(token);
  return claims !== null && (typeof claims.sub === 'string' || typeof claims.user_id === 'string');
}

/** 토큰 만료 시각(ms). `exp` 가 없으면 null — 그때는 만료 판정을 서버에 맡긴다. */
export function getTokenExpiryMs(token: string | null | undefined): number | null {
  const exp = decodeJwtClaims(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

/** 이미 만료됐는가. `exp` 를 못 읽으면 `false` — 네트워크 검증 기회를 남긴다. */
export function isTokenExpired(token: string | null | undefined): boolean {
  const expiresAt = getTokenExpiryMs(token);
  if (expiresAt === null) return false;
  return Date.now() + CLOCK_SKEW_MS >= expiresAt;
}

/** 만료가 `EXPIRY_WARNING_MS` 안으로 들어왔는가 (배너 조건). */
export function isTokenExpiringSoon(token: string | null | undefined): boolean {
  const expiresAt = getTokenExpiryMs(token);
  if (expiresAt === null) return false;
  const remaining = expiresAt - Date.now();
  return remaining > 0 && remaining <= EXPIRY_WARNING_MS;
}

/** 토큰에서 userId 를 꺼낸다. `user_id` 우선, 없으면 `sub` — 서버 `JwtUtil.getUserId` 와 같은 순서. */
export function getUserIdFromToken(token: string | null | undefined): string | null {
  const claims = decodeJwtClaims(token);
  const raw = claims?.user_id ?? claims?.sub;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
