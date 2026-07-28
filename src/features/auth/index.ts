/**
 * 인증 코어 배럴 (Phase 2).
 *
 * 화면은 이 파일에서만 가져온다:
 *   import { useLogin, loginSchema, AUTH_COPY } from '@/features/auth';
 *
 * 세션 스토어 자체는 `@/store/authStore` 에 있다 (전역 상태 계층 규약 — Offline and State ST-03).
 */

// API 어댑터와 모델
export {
  changeName,
  fetchMe,
  fromSessionUser,
  isSocialAccount,
  login,
  persistSession,
  signOutLocal,
  signup,
  toAuthUser,
  toSessionUser,
  type AuthCredentials,
  type AuthProvider,
  type AuthUser,
  type EmailCredentialInput,
} from './api';

// 문구 (Mobile UX Guide §7-2 / Screen Specs 원문)
export { AUTH_COPY, socialSuccessMessage } from './messages';

// 폼 스키마와 힌트
export {
  changePasswordSchema,
  loginSchema,
  nicknameSchema,
  NICKNAME_HINT,
  passwordAdvice,
  signupSchema,
  signupWithConfirmSchema,
  SIGNUP_PASSWORD_HINT,
  type ChangePasswordFormValues,
  type LoginFormValues,
  type NicknameFormValues,
  type SignupFormValues,
  type SignupWithConfirmFormValues,
} from './schema';

// 소셜 로그인
export {
  completeAuthSessionIfNeeded,
  isOAuthDeepLink,
  isSocialLoginEnabled,
  maskAuthUrl,
  oauthPayloadToCredentials,
  OAUTH_RETURN_URL,
  OAUTH_TIMEOUT_MS,
  oauthRedirectUri,
  parseOAuthDeepLink,
  socialLoginStartUrl,
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_LABEL,
  startSocialLogin,
  type OAuthOutcome,
  type OAuthPayload,
  type SocialProvider,
} from './oauth';

// 토큰 유틸 (JWT 형식·만료 판정. 서명 검증은 서버 몫)
export {
  decodeJwtClaims,
  EXPIRY_WARNING_MS,
  getTokenExpiryMs,
  getUserIdFromToken,
  isJwtLike,
  isTokenExpired,
  isTokenExpiringSoon,
  TOKEN_LIFETIME_MS,
  type JwtClaims,
} from './token';

// 화면용 훅
export {
  AuthError,
  authErrorMessage,
  authKeys,
  ME_STALE_TIME_MS,
  NAME_CHANGED_MESSAGE,
  SIGNUP_SUCCESS_MESSAGE,
  useAcceptOAuthSession,
  useAuth,
  useAuthBootstrap,
  useLogin,
  useMe,
  useSignup,
  useSocialLogin,
  useUpdateName,
  type AuthOperation,
  type SocialLoginResult,
} from './useAuth';

export { useSessionRevalidate } from './useSessionRevalidate';

// 세션 스토어 재노출 — 가드(`AuthGate`)가 상태만 읽을 때 쓴다.
export {
  registerAuthHttpBridge,
  registerSessionCleanup,
  selectIsAnonymous,
  selectIsAuthenticated,
  selectIsBooting,
  useAuthStore,
  type AuthStatus,
  type SessionExpiryReason,
} from '@/store/authStore';
