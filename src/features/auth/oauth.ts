import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { getApiBaseUrl } from '@/config/env';

import type { AuthCredentials, AuthProvider } from './api';
import { isJwtLike, isTokenExpired } from './token';

/**
 * 소셜 로그인 (구글 / 카카오 / 네이버) — API-07~12.
 *
 * ## 서버 흐름의 사실관계 (원본 코드 확인)
 * 1. `GET /auth/{provider}/login` → **302** + `Location: <provider 인가 URL>`.
 *    그 인가 URL 의 `redirect_uri` 는 `app.oauth.{provider}.redirect-uri`, 즉 **Spring 자신의 콜백**이다
 *    (`GoogleOAuthService.getAuthorizationUrl` 등). 앱이 provider 와 직접 통신하는 경로는 없다.
 * 2. 토큰 교환·프로필 조회·회원 매칭을 전부 서버가 한다(`AuthService.loginWithOAuth`).
 * 3. 콜백 응답은 JSON 도 302 도 아니고 **`text/html`** 이다(`produces = TEXT_HTML_VALUE`). 그 인라인
 *    스크립트가 `localStorage` → `window.opener.postMessage` → 마지막으로
 *    `window.location.replace(FRONTEND_URL + '/dashboard?token=…&userId=…&email=…&name=…')` 를 시도한다
 *    (`AuthController.buildOAuthSuccessHtml`). 앱에는 localStorage 도 opener 도 없으므로
 *    **세 번째 경로(리다이렉트)만 유효**하다.
 *
 * ## ⚠ 착지 주소는 서버 환경변수가 정한다 — 앱이 제어할 수 없다
 * `AuthController` 에는 리다이렉트 URI 화이트리스트도, 스킴 검사도, `?client=app` 분기도 없다.
 * 착지 URL 은 `app.frontend-url` 값 하나를 문자열 연결해 만들 뿐이고(`normalizeFrontendUrl` 은
 * 끝 슬래시만 제거한다), 그 기본값은 `application.yml` 에서 **`http://localhost:3000`** 이다.
 * 따라서 서버를 `FRONTEND_URL=mora://auth` 로 띄우지 않으면 브라우저는 웹 대시보드로 이동하고
 * **앱에는 딥링크가 오지 않는다.** 앱은 서버의 이 값을 알아낼 수단이 없다(조회 API 없음).
 *
 * 그래서 이 파일은 **동작 조건을 명시 플래그로 게이트한다**:
 *   `EXPO_PUBLIC_OAUTH_DEEPLINK=1` (+ 서버를 `FRONTEND_URL=mora://auth` 로 기동)
 * 플래그가 없으면 `startSocialLogin()` 은 브라우저를 열지 않고 `'unavailable'` 을 돌려주고,
 * 화면은 `준비 중입니다.` 토스트를 띄운다 — Screen Specs SCR-05 폴백 규정 그대로다.
 * 동작하지 않는 것을 동작하는 것처럼 열어 두지 않는다.
 *
 * ## 보안 (Auth.md §3-2 · NFR-017)
 * 토큰이 URL 쿼리스트링으로 온다. 회수 즉시 SecureStore 로 옮기고 URL 문자열은 어떤 로그에도
 * 남기지 않는다(`maskAuthUrl()` 을 반드시 통과시킨다). 딥링크 파라미터 중 신뢰하는 값은 `token`
 * 하나뿐이고 `userId/email/name` 은 `GET /auth/me` 로 덮어쓴다.
 */

export type SocialProvider = 'google' | 'kakao' | 'naver';

/** 버튼 배치 순서 — 원본 웹 배열 그대로 (SCR-03 구성 요소 표). */
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ['google', 'kakao', 'naver'] as const;

/** 토스트 문구에 넣는 표시명. `Google로 로그인했습니다.` 형태로 쓴다. */
export const SOCIAL_PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Google',
  kakao: '카카오',
  naver: '네이버',
};

/**
 * 서버 `FRONTEND_URL` 과 **글자 단위로 같아야 하는** 값.
 * 서버는 여기에 `/dashboard?token=…` 을 이어 붙이므로 실제 착지 URL 은
 * `mora://auth/dashboard?token=…&userId=…&email=…&name=…` 이 된다.
 */
export const OAUTH_RETURN_URL = 'mora://auth';

/** `app.config.js` 의 `scheme` 값. 바뀌면 서버 `FRONTEND_URL` 도 같이 바뀌어야 한다. */
const APP_SCHEME = 'mora';

/**
 * `app.config.js` 의 `scheme: 'mora'` 가 실제로 살아 있는지 확인하는 용도.
 * 개발 클라이언트/스탠드얼론 빌드에서는 `mora://auth` 를 돌려주고, Expo Go 에서는 `exp://…` 가 나온다.
 * 후자면 서버 착지 주소와 절대 일치할 수 없으므로 소셜 로그인을 비활성으로 판정한다.
 */
export const oauthRedirectUri: string = makeRedirectUri({ scheme: 'mora', path: 'auth' });

/** FR-027 — 콜백이 오지 않는 상태로 방치되지 않게 하는 상한. */
export const OAUTH_TIMEOUT_MS = 90_000;

/**
 * 소셜 로그인을 쓸 수 있는가.
 * 두 조건을 모두 만족해야 한다: (1) 서버가 앱 스킴으로 착지하도록 기동됐다는 명시 플래그,
 * (2) 이 런타임에서 커스텀 스킴 딥링크가 실제로 성립한다.
 */
export function isSocialLoginEnabled(): boolean {
  const flag = (process.env.EXPO_PUBLIC_OAUTH_DEEPLINK ?? '').trim();
  return flag === '1' && oauthRedirectUri.startsWith(`${APP_SCHEME}://`);
}

/** 서버 OAuth 진입점. 302 로 provider 인가 URL 로 넘어간다. */
export function socialLoginStartUrl(provider: SocialProvider): string {
  return `${getApiBaseUrl()}/auth/${provider}/login`;
}

export type OAuthPayload = {
  token: string;
  /** 신뢰하지 않는 값들. `/auth/me` 로 반드시 덮어쓴다. */
  userId: string;
  email: string;
  name: string;
};

export type OAuthOutcome =
  /** 토큰 회수 성공. 곧바로 `authStore.acceptOAuthSession()` 에 넘긴다. */
  | { status: 'success'; provider: SocialProvider; payload: OAuthPayload }
  /** 사용자가 시트를 닫았다. 토스트 없이 조용히 복귀한다 (SCR-05: 취소는 에러가 아니다). */
  | { status: 'canceled' }
  /** 서버 착지 주소가 앱 스킴이 아니어서 시작조차 하지 않았다 → `준비 중입니다.` */
  | { status: 'unavailable' }
  /** 브라우저는 돌아왔는데 토큰이 없거나(state 무효·서버 실패 HTML) 형식이 깨졌다. */
  | { status: 'failed'; reason: 'no-token' | 'timeout' | 'error' };

/** 로그·크래시 리포터에 URL 을 남길 때 반드시 통과시킨다 (Auth.md §3-2 보안 주의). */
export function maskAuthUrl(url: string): string {
  return url.replace(/([?&](?:token|code|state)=)[^&]*/gi, '$1***');
}

function firstParam(params: Linking.QueryParams | null, key: string): string {
  const raw = params?.[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

/**
 * 딥링크 URL 에서 OAuth 결과를 뽑는다. 콜드 스타트(`Linking.getInitialURL`)와
 * 실행 중 수신(`Linking.addEventListener('url')`) 양쪽에서 같은 함수를 쓴다.
 *
 * 경로는 검사하지 않는다 — 서버가 `/dashboard` 를 붙이지만 그 값은 서버 코드에 하드코딩된
 * 문자열이고 앱이 의존할 계약이 아니다. 판정 기준은 **`token` 파라미터의 존재와 형식**이다.
 */
export function parseOAuthDeepLink(url: string): OAuthPayload | null {
  let parsed: Linking.ParsedURL;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  const token = firstParam(parsed.queryParams, 'token');
  // NFR-017 — 조작된 딥링크를 그대로 저장하지 않는다. 형식 + 만료만 본다(서명 검증은 서버 몫).
  if (!isJwtLike(token) || isTokenExpired(token)) return null;

  return {
    token,
    userId: firstParam(parsed.queryParams, 'userId'),
    email: firstParam(parsed.queryParams, 'email'),
    name: firstParam(parsed.queryParams, 'name'),
  };
}

/** 이 딥링크가 OAuth 복귀인가 (루트 레이아웃의 딥링크 라우팅 판정용). */
export function isOAuthDeepLink(url: string): boolean {
  return parseOAuthDeepLink(url) !== null;
}

/**
 * 시스템 브라우저(Custom Tabs / ASWebAuthenticationSession)로 서버 OAuth 진입점을 열고
 * `mora://auth…` 딥링크로 돌아온 토큰을 회수한다.
 *
 * `showInRecents: false` 는 Android 최근앱 목록에 인증 화면을 남기지 않기 위한 값이지만,
 * SDK 57 의 `useProxyActivity`(기본 true)가 켜져 있으면 무시된다. 프록시 액티비티를 끄면
 * 앱이 백그라운드로 갈 때 브라우저가 파괴될 수 있어(OAuth 왕복 중 흔한 상황) 안정성을 택했다.
 */
export async function startSocialLogin(provider: SocialProvider): Promise<OAuthOutcome> {
  if (!isSocialLoginEnabled()) return { status: 'unavailable' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = WebBrowser.openAuthSessionAsync(socialLoginStartUrl(provider), OAUTH_RETURN_URL, {
      showInRecents: false,
      preferEphemeralSession: true, // iOS: 기존 사파리 쿠키와 격리
    });

    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), OAUTH_TIMEOUT_MS);
    });

    const result = await Promise.race([session, timeout]);

    if (result === 'timeout') {
      WebBrowser.dismissAuthSession();
      return { status: 'failed', reason: 'timeout' };
    }

    // cancel / dismiss / locked / opened — 사용자가 닫았거나 서버가 실패 HTML(400)을 그려
    // 딥링크가 오지 않았다. 성공 변형만 `url` 을 갖는다(`WebBrowserRedirectResult`).
    if (result.type !== 'success') {
      return { status: 'canceled' };
    }

    const payload = parseOAuthDeepLink(result.url);
    // 토큰 수신 즉시 인증 세션을 닫는다 (Auth.md §3-2).
    WebBrowser.dismissAuthSession();
    if (!payload) return { status: 'failed', reason: 'no-token' };

    return { status: 'success', provider, payload };
  } catch {
    return { status: 'failed', reason: 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 웹 빌드와 일부 Android 복귀 케이스 대응. 루트 레이아웃 최상단에서 1회 호출한다
 * (Auth.md §3-4). 네이티브에서는 무해한 no-op 이다.
 */
export function completeAuthSessionIfNeeded(): void {
  WebBrowser.maybeCompleteAuthSession();
}

/** 딥링크 payload → 세션 재료. `provider` 는 사용자가 누른 버튼으로만 알 수 있다. */
export function oauthPayloadToCredentials(
  payload: OAuthPayload,
  provider: SocialProvider,
): AuthCredentials {
  const email = payload.email;
  const local = email.split('@')[0];
  return {
    token: payload.token,
    user: {
      id: payload.userId,
      email,
      // 원본 `dashboard/layout.tsx` 폴백 규칙: name || email 로컬파트
      name: payload.name || local || '사용자',
      provider: provider satisfies AuthProvider,
    },
  };
}
