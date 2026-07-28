/**
 * 계정 · 데이터 · 알림설정 데이터 레이어 배럴 (Phase 6).
 *
 * 화면(SCR-25~SCR-29)은 이 파일만 import 한다:
 *   import { useProfile, useChangePassword, useDeleteAccount } from '@/features/account';
 *
 * ⚠ 세 가지를 기억해라:
 *   1. **프로필 조회·닉네임 변경은 `features/auth` 소유**다. 여기서는 이름만 바꿔 재수출한다
 *      (`useProfile` = `useMe`, `useUpdateNickname` = `useUpdateName`).
 *      새 뮤테이션을 만들면 SecureStore 스냅샷 갱신이 빠져 재부팅 시 옛 닉네임이 뜬다.
 *   2. `useChangePassword()` 는 **throw 하지 않는다.** 429 를 잃지 않으려고 결과 유니온을
 *      돌려주고 60초 잠금(`isRateLimited`)을 훅이 직접 관리한다.
 *   3. `탈퇴` / `전체삭제` 확인 문구는 **서버 계약이 아니라 앱의 안전장치**다.
 *      `matchesConfirmText()` 또는 `deleteAccountSocialSchema` / `deleteDocumentsSchema` 로 강제해라.
 */

// ── 타입 ─────────────────────────────────────────────────────────────
export type {
  AuthProvider,
  AuthUser,
  ChangePasswordFailure,
  ChangePasswordInput,
  ChangePasswordResult,
  DeleteAccountInput,
  NotificationSettings,
  NotificationSettingsInput,
  UserDataDeleteResult,
} from './api';

// ── 네트워크 · 상수 · 문구 ───────────────────────────────────────────
export {
  changeNickname,
  changePassword,
  DEADLINE_REMINDER_DAYS_MAX,
  DEADLINE_REMINDER_DAYS_MIN,
  DEADLINE_REMINDER_DAY_OPTIONS,
  DEFAULT_NOTIFICATION_SETTINGS,
  deleteAccount,
  deleteMyDocuments,
  deletedDocumentsMessage,
  DELETE_ACCOUNT_FAILED_MESSAGE,
  DELETE_DOCUMENTS_FAILED_MESSAGE,
  fetchNotificationSettings,
  fetchProfile,
  isSocialAccount,
  PASSWORD_CHANGE_FAILED_MESSAGE,
  PASSWORD_RATE_LIMIT_MESSAGE,
  PASSWORD_RETRY_AFTER_MS,
  updateNotificationSettings,
} from './api';

// ── 폼 스키마 · 화면 문구 ────────────────────────────────────────────
export type {
  ChangePasswordFormSchemaValues,
  ChangePasswordFormValues,
  DeleteAccountLocalFormValues,
  DeleteAccountSocialFormValues,
  DeleteDocumentsFormValues,
  NicknameFormValues,
  NotificationSettingsFormValues,
} from './schema';
export {
  changePasswordFormSchema,
  changePasswordSchema,
  DANGER_ZONE_COPY,
  deadlineDaysCaption,
  deleteAccountLocalSchema,
  deleteAccountSocialSchema,
  deleteDocumentsSchema,
  DELETE_ACCOUNT_CONFIRM_TEXT,
  DELETE_DOCUMENTS_CONFIRM_TEXT,
  matchesConfirmText,
  nicknameSchema,
  NICKNAME_HINT,
  NOTIFICATION_SETTINGS_COPY,
  PASSWORD_FORM_COPY,
} from './schema';

// ── React Query ──────────────────────────────────────────────────────
export type { AccountOperation, UseChangePasswordResult } from './queries';
export {
  AccountError,
  accountKeys,
  authKeys,
  ME_STALE_TIME_MS,
  NAME_CHANGED_MESSAGE,
  NOTIFICATION_SETTINGS_STALE_TIME_MS,
  toAccountError,
  useChangePassword,
  useDeleteAccount,
  useDeleteMyDocuments,
  useNotificationSettings,
  useProfile,
  useUpdateNickname,
  useUpdateNotificationSettings,
} from './queries';
