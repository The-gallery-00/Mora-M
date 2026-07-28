/**
 * 계정 · 데이터 · 알림설정 React Query 계층 (SCR-25~SCR-29).
 *
 * 정본: wiki/design/Screen Specs.md SCR-25~SCR-29 데이터 표
 *       wiki/tech/Offline and State.md §11(낙관적 업데이트 R1~R7)
 *
 * ─────────────────────────────── 쿼리 키 컨벤션 ───────────────────────────────
 *
 *   ['auth','me']        ← 프로필. **`features/auth` 가 소유한다.** 여기서 만들지 않는다
 *   ['notifSettings']    ← 알림 설정 (SCR-29 데이터 표가 지정한 키 그대로)
 *
 * 프로필 훅(`useMe`/`useUpdateName`)을 새로 만들지 않고 재수출하는 이유는 `api.ts` 상단과 같다:
 * `authStore` 가 SecureStore 스냅샷 갱신까지 묶어서 처리하고 있어, 여기서 별도 뮤테이션을 두면
 * 닉네임을 바꿔도 재부팅 시 옛 이름이 뜨는 버그가 생긴다.
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppError } from '@/services/http';
import { useAuthStore } from '@/store/authStore';

import {
  changePassword,
  deleteAccount,
  deleteMyDocuments,
  DELETE_ACCOUNT_FAILED_MESSAGE,
  DELETE_DOCUMENTS_FAILED_MESSAGE,
  fetchNotificationSettings,
  PASSWORD_RETRY_AFTER_MS,
  updateNotificationSettings,
  type ChangePasswordInput,
  type ChangePasswordResult,
  type DeleteAccountInput,
  type NotificationSettings,
  type NotificationSettingsInput,
  type UserDataDeleteResult,
} from './api';
import { NOTIFICATION_SETTINGS_COPY } from './schema';

// ═══════════════════════════════════════════ 1. 프로필 (auth 계층 재수출)

export {
  authKeys,
  ME_STALE_TIME_MS,
  NAME_CHANGED_MESSAGE,
  useMe as useProfile,
  useUpdateName as useUpdateNickname,
} from '@/features/auth/useAuth';

// ═══════════════════════════════════════════ 2. 쿼리 키 · 에러

export const accountKeys = {
  /** SCR-29 데이터 표가 지정한 키. */
  notificationSettings: () => ['notifSettings'] as const,
} as const;

export type AccountOperation = 'settings' | 'saveSettings' | 'deleteAccount' | 'deleteDocuments';

export class AccountError extends Error {
  readonly kind: AppError['kind'];
  readonly status: number | null;
  readonly operation: AccountOperation;

  constructor(message: string, error: AppError, operation: AccountOperation) {
    super(message);
    this.name = 'AccountError';
    this.kind = error.kind;
    this.status = error.status;
    this.operation = operation;
  }
}

function accountErrorMessage(operation: AccountOperation, error: AppError): string {
  if (error.kind === 'offline' || error.kind === 'timeout' || error.kind === 'unauthorized') {
    return error.message;
  }
  if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

  switch (operation) {
    case 'settings':
      return NOTIFICATION_SETTINGS_COPY.loadFailed;
    case 'saveSettings':
      return NOTIFICATION_SETTINGS_COPY.saveFailed;
    case 'deleteAccount':
      return DELETE_ACCOUNT_FAILED_MESSAGE;
    case 'deleteDocuments':
      return DELETE_DOCUMENTS_FAILED_MESSAGE;
  }
}

export function toAccountError(operation: AccountOperation, error: AppError): AccountError {
  return new AccountError(accountErrorMessage(operation, error), error, operation);
}

// ═══════════════════════════════════════════ 3. 비밀번호 변경 (SCR-27)

export type UseChangePasswordResult = {
  submit: (input: ChangePasswordInput) => Promise<ChangePasswordResult>;
  isPending: boolean;
  /** 마지막 시도의 실패 문구. 성공하거나 다시 제출하면 비워진다. */
  errorMessage: string;
  /** 429 를 받아 버튼을 잠근 상태인가 (SCR-27: 60초 disabled). */
  isRateLimited: boolean;
  /** 잠금 해제까지 남은 ms. 화면이 카운트다운을 그리고 싶을 때 쓴다. */
  retryAfterMs: number;
  reset: () => void;
};

/**
 * API-05 비밀번호 변경 (FR-092).
 *
 * **뮤테이션이 throw 하지 않는다.** 429 를 "에러"로 던지면 화면이 상태코드를 다시 뜯어야 하고,
 * React Query 의 재시도 정책과 얽혀 잠금 타이머가 어긋난다. 대신 `ChangePasswordResult`
 * 유니온을 그대로 돌려주고, 훅이 **잠금 타이머만** 부수효과로 관리한다.
 *
 * 잠금은 클라이언트 편의 장치일 뿐 보안 경계가 아니다 — 서버 버킷이 진짜 방어선이고,
 * 앱을 재시작하면 이 타이머는 사라진다(그래도 서버는 여전히 429 를 준다).
 *
 * 캐시를 건드리지 않는다. 비밀번호는 어떤 쿼리에도 들어 있지 않고, 서버가 토큰을 무효화하지도
 * 않는다(발급된 JWT 는 만료까지 유효 — Auth.md §4-5). 즉 변경 후 재로그인이 필요 없다.
 */
export function useChangePassword(): UseChangePasswordResult {
  const [errorMessage, setErrorMessage] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 잠금 중일 때만 1초 틱을 돌린다. 잠금이 아니면 타이머가 존재하지 않는다.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [lockedUntil]);

  const retryAfterMs = Math.max(0, lockedUntil - now);
  const isRateLimited = retryAfterMs > 0;

  const mutation = useMutation<ChangePasswordResult, never, ChangePasswordInput>({
    mutationFn: (input) => changePassword(input),
  });

  const submit = useCallback(
    async (input: ChangePasswordInput): Promise<ChangePasswordResult> => {
      if (retryAfterMs > 0) {
        // 잠금 중에는 서버를 때리지 않는다. 어차피 429 를 다시 받고 버킷만 더 소모한다.
        return { ok: false, failure: 'rate-limited', message: errorMessage };
      }
      setErrorMessage('');
      const result = await mutation.mutateAsync(input);

      if (!result.ok) {
        setErrorMessage(result.message);
        if (result.failure === 'rate-limited') {
          setNow(Date.now());
          setLockedUntil(Date.now() + PASSWORD_RETRY_AFTER_MS);
        }
      }
      return result;
    },
    [errorMessage, mutation, retryAfterMs],
  );

  const reset = useCallback(() => {
    setErrorMessage('');
    setLockedUntil(0);
  }, []);

  return {
    submit,
    isPending: mutation.isPending,
    errorMessage,
    isRateLimited,
    retryAfterMs,
    reset,
  };
}

// ═══════════════════════════════════════════ 4. 회원 탈퇴 (SCR-28)

/**
 * API-06 회원 탈퇴 (FR-093).
 *
 * 성공 후처리 순서가 중요하다:
 *   ① 서버 삭제 성공 → ② `authStore.signOut()` (SecureStore 파기 + 등록된 캐시 정리 콜백 실행
 *      + 계정 종속 MMKV 키 삭제 + 이미지 캐시 비우기) → ③ `queryClient.clear()` 보강 → ④ 화면 이동
 *
 * ③ 이 중복처럼 보이지만 아니다. `signOut()` 이 부르는 정리 콜백은 루트에 마운트된 훅이
 * `registerSessionCleanup` 으로 **등록해 뒀을 때만** 존재한다. 등록 전에 탈퇴가 일어나면
 * 남의 문서 캐시가 메모리에 남는다. 방어적으로 한 번 더 지운다 — `clear()` 는 멱등이다.
 *
 * ④ 화면 이동은 여기서 하지 않는다. 데이터 계층이 라우터를 알면 안 된다는 규약
 * (`authStore` 주석: "라우팅을 하지 않는다")과 같은 이유다. 화면이 성공을 받고 replace 한다.
 */
export function useDeleteAccount(): UseMutationResult<void, AccountError, DeleteAccountInput> {
  const queryClient = useQueryClient();

  return useMutation<void, AccountError, DeleteAccountInput>({
    mutationFn: async (input) => {
      const res = await deleteAccount(input);
      if (!res.ok) throw toAccountError('deleteAccount', res.error);
    },
    onSuccess: async () => {
      await useAuthStore.getState().signOut();
      queryClient.clear();
    },
  });
}

// ═══════════════════════════════════════════ 5. 내 문서 전체 삭제 (SCR-28)

/**
 * API-62 내 문서 전체 삭제 (FR-094).
 *
 * 계정은 남고 데이터만 사라진다. **무효화 범위가 넓다** — 서버가 실제로 지우는 것을 따라간다
 * (`UserDataService.deleteAllDocuments`):
 *   문서 4종 → `['documents']` / 대시보드 통계 → `['dashboard']` /
 *   알림 row → `['notifications']` + `['notif','unread']` / 검색 기록 → `['search']`
 *
 * ⚠ 검색 캐시만 `invalidate` 가 아니라 **`remove`** 다. 검색 쿼리를 무효화하면 재요청이 나가고
 *   **재요청 1회가 곧 서버 검색기록 1건**이다(`features/documents/queries.ts` 의 §3-16 주석).
 *   방금 검색 기록을 지운 직후에 그 기록을 다시 만드는 것은 앞뒤가 맞지 않는다.
 *   `remove` 는 마운트되지 않은 쿼리를 조용히 버릴 뿐 요청을 만들지 않는다 —
 *   삭제 화면(SCR-28)에서는 검색 화면이 마운트돼 있지 않으므로 안전하다.
 */
export function useDeleteMyDocuments(): UseMutationResult<UserDataDeleteResult, AccountError, void> {
  const queryClient = useQueryClient();

  return useMutation<UserDataDeleteResult, AccountError, void>({
    mutationFn: async () => {
      const res = await deleteMyDocuments();
      if (!res.ok) throw toAccountError('deleteDocuments', res.error);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['cardGroups'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.setQueryData<number>(['notif', 'unread'], 0);
      void queryClient.invalidateQueries({ queryKey: ['notif', 'unread'] });
      queryClient.removeQueries({ queryKey: ['search'] });
    },
  });
}

// ═══════════════════════════════════════════ 6. 알림 설정 (SCR-29)

/** SCR-29 데이터 표: `staleTime: 10분`. 본인만 바꾸는 값이라 길게 잡아도 어긋나지 않는다. */
export const NOTIFICATION_SETTINGS_STALE_TIME_MS = 10 * 60_000;

/** API-39 알림 설정 조회 (FR-089). row 가 없으면 서버가 기본값으로 만들어 준다. */
export function useNotificationSettings(options: { enabled?: boolean } = {}) {
  return useQuery<NotificationSettings, AccountError>({
    queryKey: accountKeys.notificationSettings(),
    queryFn: async () => {
      const res = await fetchNotificationSettings();
      if (!res.ok) throw toAccountError('settings', res.error);
      return res.data;
    },
    staleTime: NOTIFICATION_SETTINGS_STALE_TIME_MS,
    gcTime: 30 * 60_000,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

/**
 * API-40 알림 설정 저장 — 낙관적 갱신 (FR-089 · SCR-29 인터랙션 표).
 *
 * 토글은 즉시 반응해야 하고 실패하면 **원복 + 토스트**다(조용한 롤백 금지 — R4).
 * 변경된 필드만 보낸다 — 서버가 래퍼 타입 null 스킵으로 부분 업데이트를 지원하므로,
 * 전체 객체를 매번 실으면 두 토글을 빠르게 연타할 때 뒤 요청이 앞 요청의 값을 되돌린다.
 *
 * 서버 응답이 정본이다. `onSuccess` 에서 응답으로 덮어써 낙관적 값과 실제 저장값을 맞춘다
 * (예: 일수가 범위를 벗어나 서버가 거부하면 원래 값이 유지된 응답이 온다).
 */
export function useUpdateNotificationSettings(): UseMutationResult<
  NotificationSettings,
  AccountError,
  NotificationSettingsInput,
  { previous: NotificationSettings | undefined }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const res = await updateNotificationSettings(input);
      if (!res.ok) throw toAccountError('saveSettings', res.error);
      return res.data;
    },

    onMutate: async (input) => {
      const key = accountKeys.notificationSettings();
      // 진행 중 refetch 를 끊지 않으면 그 응답이 낙관적 상태를 덮는다 (R1).
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSettings>(key);

      if (previous) {
        queryClient.setQueryData<NotificationSettings>(key, { ...previous, ...input });
      }
      return { previous };
    },

    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData(accountKeys.notificationSettings(), context.previous);
    },

    onSuccess: (saved) => {
      queryClient.setQueryData(accountKeys.notificationSettings(), saved);
    },
  });
}
