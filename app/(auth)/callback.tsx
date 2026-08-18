// app/(auth)/callback.tsx — SCR-05 OAuth 콜백 브리지
//
// 사용자가 보는 시간은 1~2초다. 하는 일은 딥링크가 실어 온 토큰을 세션으로 승격시키는 것뿐이다.
//
// 이 화면이 필요한 경우는 **콜드 스타트 딥링크** 하나다. 앱이 살아 있는 상태의 소셜 로그인은
// `WebBrowser.openAuthSessionAsync` 가 반환값으로 URL 을 돌려주므로 SCR-03/04 안에서 끝난다
// (`useSocialLogin`). 그 경우 이 라우트는 아예 지나가지 않는다.
//
// 원본은 이 지점이 `text/html` + 인라인 `<script>` 로 `localStorage` 를 쓰는 브리지 문서였다.
// 앱에는 localStorage 도 opener 도 없으므로 **HTML 을 해석하지 않는다.** 쿼리스트링만 회수한다
// (Screen Specs SCR-05 모바일 변경점).
//
// 보안 (Auth.md §3-2 · NFR-017): 토큰이 URL 쿼리로 온다. 회수 즉시 SecureStore 로 옮기고
// **어떤 로그에도 남기지 않는다.** 딥링크가 준 `userId/email/name` 은 신뢰하지 않고
// `GET /auth/me`(API-03) 응답으로 덮어쓴다 — 그 보정은 `authStore.acceptOAuthSession` 이 한다.
export { default } from '@/features/auth/OAuthCallbackBridge';
