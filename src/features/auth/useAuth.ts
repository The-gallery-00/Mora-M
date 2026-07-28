import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import type { AppError } from '@/services/http';
import { useAuthStore, type AuthStatus } from '@/store/authStore';

import { isSocialAccount, type AuthUser } from './api';
import { AUTH_COPY, socialSuccessMessage } from './messages';
import {
  isSocialLoginEnabled,
  SOCIAL_PROVIDER_LABEL,
  startSocialLogin,
  type OAuthPayload,
  type SocialProvider,
} from './oauth';
import type { LoginFormValues, SignupFormValues } from './schema';

/**
 * 화면이 쓰는 인증 훅 묶음.
 *
 * 역할 분담:
 *  - 세션 상태·SecureStore·401 처리 → `authStore`
 *  - 서버 왕복의 로딩/에러 상태와 캐시 시딩 → 여기(React Query)
 *  - 사용자에게 보이는 문구 → `messages.ts` (서버 `error` 문자열은 절대 노출하지 않는다)
 *
 * 쿼리 키는 API Contract §6-1 의 `['auth','me']` 를 그대로 쓴다 (staleTime 5분 · RVL-05).
 */

export const authKeys = {
  me: () => ['auth', 'me'] as const,
} as const;

/** `['auth','me']` staleTime — API Contract §6-2. */
export const ME_STALE_TIME_MS = 5 * 60 * 1000;

export type AuthOperation = 'login' | 'signup' | 'me' | 'name';

/** React Query 가 `error` 로 받을 수 있도록 감싼 인증 실패. `message` 는 그대로 화면에 쓴다. */
export class AuthError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;

  constructor(message: string, error: AppError) {
    super(message);
    this.name = 'AuthError';
    this.kind = error.kind;
    this.status = error.status;
  }
}

/**
 * `AppError` → 화면 문구.
 *
 * 서버가 주는 `error` 문장은 한/영이 혼재하고 인코딩이 깨질 수 있어 UI 에 쓰지 않는다
 * (API Contract §4-5). 대신 **HTTP status + 작업 종류**로만 문구를 고른다.
 *
 * 작업별 400 해석 근거 — 클라이언트가 이미 빈 값을 막고 보내므로 서버의 남은 400 경로가 좁혀진다:
 *  - 로그인 400 = `Invalid email or password` 또는 `This account requires social login`
 *    → 둘 다 "자격증명을 다시 확인" 으로 수렴한다 (CP-19).
 *  - 회원가입 400 = 실질적으로 `Email already exists` 하나다(`validateSignupRequest` 의 blank 검사는
 *    스키마가 선차단한다) → CP-20 이 중복 가능성을 직접 언급한다.
 */
export function authErrorMessage(operation: AuthOperation, error: AppError): string {
  if (error.kind === 'offline' || error.kind === 'timeout') return AUTH_COPY.serverUnreachable;
  if (error.kind === 'unauthorized') return AUTH_COPY.sessionExpired;
  if (error.status === 429) return AUTH_COPY.rateLimited;
  if (error.kind === 'parse') {
    return operation === 'name' ? AUTH_COPY.nameChangeFailed : AUTH_COPY.tokenMissing;
  }

  if (error.kind === 'client') {
    if (operation === 'login') return AUTH_COPY.loginFailed;
    if (operation === 'signup') return AUTH_COPY.signupFailed;
    if (operation === 'name') return AUTH_COPY.nameChangeFailed;
  }

  // 5xx 등은 http.ts 가 만든 상태코드 기반 한국어 문구를 그대로 쓴다.
  return error.message;
}

function toAuthError(operation: AuthOperation, error: AppError): AuthError {
  return new AuthError(authErrorMessage(operation, error), error);
}

/** 부팅 게이트(SCR-01)용. 마운트 시 1회 부트스트랩을 돌리고 현재 상태를 돌려준다. */
let bootstrapStarted = false;
export function useAuthBootstrap(): AuthStatus {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (bootstrapStarted) return;
    bootstrapStarted = true;
    void useAuthStore.getState().bootstrap();
  }, []);

  return status;
}

/**
 * 세션 요약 + 로그아웃.
 * 로그아웃은 React Query 캐시까지 함께 비운다 — 계정 전환 시 이전 사용자 문서가 보이면 사고다
 * (Auth.md §4-5 #3, Offline and State §6).
 */
export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const expiryWarning = useAuthStore((s) => s.expiryWarning);
  const expiredNotice = useAuthStore((s) => s.expiredNotice);
  const clearExpiredNotice = useAuthStore((s) => s.clearExpiredNotice);
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    await useAuthStore.getState().signOut();
    queryClient.clear();
  }, [queryClient]);

  return {
    status,
    user,
    isBooting: status === 'booting',
    isAuthenticated: status === 'authenticated',
    isAnonymous: status === 'anonymous',
    /** 소셜 전용 계정인가 — 비밀번호 변경(API-05) 숨김/탈퇴 분기 기준. */
    isSocialAccount: isSocialAccount(user),
    /** 만료 1시간 전 배너 표시 여부와 문구 (Auth.md §4-4). */
    expiryWarning,
    expiryWarningMessage: AUTH_COPY.expiryWarning,
    /** 세션이 끊긴 직후 1회 토스트용. 띄운 뒤 `clearExpiredNotice()` 를 부른다. */
    expiredNotice,
    sessionExpiredMessage: AUTH_COPY.sessionExpired,
    clearExpiredNotice,
    signOut,
  };
}

/** 프로필 정본 (API-03). 설정 화면(SCR-25/26)과 세션 재검증이 공유하는 캐시다. */
export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const cached = useAuthStore((s) => s.user);

  return useQuery<AuthUser, AuthError>({
    queryKey: authKeys.me(),
    queryFn: async () => {
      const res = await useAuthStore.getState().refreshMe();
      if (!res.ok) throw toAuthError('me', res.error);
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: ME_STALE_TIME_MS,
    gcTime: 30 * 60 * 1000,
    // 부팅 시 SecureStore 스냅샷이 있으면 첫 렌더에 프로필이 비지 않게 한다.
    initialData: cached ?? undefined,
    // 스냅샷은 즉시 stale 로 본다 → 화면은 캐시로 그리고 검증은 백그라운드로 돈다 (Auth.md §4-3).
    initialDataUpdatedAt: 0,
    retry: false,
  });
}

/** SCR-03 로그인. 성공하면 `['auth','me']` 캐시를 씨딩해 홈이 곧바로 프로필을 갖고 시작한다. */
export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation<AuthUser, AuthError, LoginFormValues>({
    mutationFn: async (values) => {
      const res = await useAuthStore.getState().signIn({
        email: values.email,
        password: values.password,
      });
      if (!res.ok) throw toAuthError('login', res.error);
      return res.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/**
 * SCR-04 회원가입. 서버가 `name` 을 무시하므로 성공 후 닉네임 단계(FR-024)는 화면이
 * `useUpdateName()` 으로 따로 처리한다. 닉네임 실패는 가입을 되돌리지 않는다.
 */
export function useSignup() {
  const queryClient = useQueryClient();

  return useMutation<AuthUser, AuthError, SignupFormValues>({
    mutationFn: async (values) => {
      const res = await useAuthStore.getState().signUp({
        email: values.email,
        password: values.password,
      });
      if (!res.ok) throw toAuthError('signup', res.error);
      return res.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/** 가입 성공 토스트 문구 (SCR-04). */
export const SIGNUP_SUCCESS_MESSAGE = AUTH_COPY.signupSuccess;

export type SocialLoginResult =
  | { status: 'success'; provider: SocialProvider; user: AuthUser; message: string }
  /** 사용자가 시트를 닫았다 → 토스트 없음 */
  | { status: 'canceled' }
  /** 서버 착지 주소가 앱 스킴이 아니다 → `준비 중입니다.` */
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string };

/**
 * SCR-03/04 소셜 버튼 → SCR-05 흐름.
 *
 * 실패를 throw 하지 않고 결과를 그대로 돌려준다. 취소는 에러가 아니고(토스트 없음),
 * `unavailable` 은 서버 설정 문제라 화면이 다른 문구를 써야 하기 때문이다.
 */
export function useSocialLogin() {
  const queryClient = useQueryClient();

  const mutation = useMutation<SocialLoginResult, never, SocialProvider>({
    mutationFn: async (provider) => {
      const outcome = await startSocialLogin(provider);

      if (outcome.status === 'unavailable') {
        return { status: 'unavailable', message: AUTH_COPY.socialUnavailable };
      }
      if (outcome.status === 'canceled') return { status: 'canceled' };
      if (outcome.status === 'failed') {
        return { status: 'failed', message: AUTH_COPY.socialFailed };
      }

      const res = await useAuthStore.getState().acceptOAuthSession(outcome.payload, outcome.provider);
      if (!res.ok) return { status: 'failed', message: authErrorMessage('me', res.error) };

      queryClient.setQueryData(authKeys.me(), res.data);
      return {
        status: 'success',
        provider: outcome.provider,
        user: res.data,
        message: socialSuccessMessage(SOCIAL_PROVIDER_LABEL[outcome.provider]),
      };
    },
  });

  return {
    ...mutation,
    /** 소셜 버튼을 노출해도 되는가. false 면 화면은 이메일 로그인만 남긴다 (SCR-05 폴백). */
    enabled: isSocialLoginEnabled(),
  };
}

/**
 * 콜드 스타트 딥링크로 들어온 OAuth 결과 처리 (SCR-05).
 * 루트에서 URL 을 파싱한 화면이 payload 를 넘긴다 — provider 는 딥링크에 없으므로
 * 알 수 없으면 `google` 대신 호출부가 아는 값을 넘겨야 한다. 모르면 `/auth/me` 가 정정한다.
 */
export function useAcceptOAuthSession() {
  const queryClient = useQueryClient();

  return useMutation<AuthUser, AuthError, { payload: OAuthPayload; provider: SocialProvider }>({
    mutationFn: async ({ payload, provider }) => {
      const res = await useAuthStore.getState().acceptOAuthSession(payload, provider);
      if (!res.ok) throw toAuthError('me', res.error);
      return res.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/** 닉네임 변경 (API-04). FR-024 가입 직후 단계 · SCR-26 프로필 편집 공용. */
export function useUpdateName() {
  const queryClient = useQueryClient();

  return useMutation<AuthUser, AuthError, string>({
    mutationFn: async (name) => {
      const res = await useAuthStore.getState().updateName(name);
      if (!res.ok) throw toAuthError('name', res.error);
      return res.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/** 닉네임 변경 성공 토스트 (SCR-26). */
export const NAME_CHANGED_MESSAGE = AUTH_COPY.nameChanged;
