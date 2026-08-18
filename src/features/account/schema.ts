/**
 * 계정 · 데이터 · 알림설정 폼 검증 스키마 (react-hook-form + zodResolver).
 *
 * 정본: wiki/design/Screen Specs.md SCR-26 · SCR-27 · SCR-28 · SCR-29
 *       서버 규칙은 backend/service/{AuthService,NotificationSettingService}.java 를 직접 확인했다.
 *
 * ────────────────────── 서버 검증 규칙 대조표 (코드로 확인, 추측 아님) ──────────────────────
 *
 * | 항목 | 서버가 실제로 하는 검사 | 앱 스키마 | 근거 |
 * |---|---|---|---|
 * | 닉네임 | `trim()` 후 2~20자 + `^[a-zA-Z0-9가-힣_.\-]+$` | `nicknameSchema` (auth 재수출) | `AuthService.changeName` |
 * | 새 비밀번호 | `length >= 8` | 8자 이상 | `AuthService.changePassword` |
 * | 새 비밀번호 ≠ 현재 | `passwordEncoder.matches` 로 서버가 재검사 | `.refine` 문자열 비교 | 〃 |
 * | 새 비밀번호 확인 | **서버에 없다** (필드 자체가 없음) | `.refine` | SCR-27 3필드 규정 |
 * | 탈퇴(로컬) | 비밀번호 blank 아님 + BCrypt 일치 | 1자 이상 | `AuthService.deleteAccount` |
 * | 탈퇴(소셜) | **서버는 아무것도 요구하지 않는다** | `탈퇴` 문구 정확 일치 | SCR-28 |
 * | 문서 전체 삭제 | **서버는 아무것도 요구하지 않는다** | `전체삭제` 문구 정확 일치 | SCR-28 |
 * | 알림 일수 | 0 ≤ days ≤ 30, 밖이면 400 | 정수 0~30 | `NotificationSettingService` |
 *
 * ⚠ 표의 아래 세 줄이 핵심이다. **확인 문구(`탈퇴`/`전체삭제`)는 서버 계약이 아니다.**
 *   `DeleteAccountRequest` 에는 `password` 필드 하나뿐이고, `DELETE /api/me/documents` 는
 *   바디를 받지도 않는다. 즉 이 검증은 순수하게 **되돌릴 수 없는 액션 앞의 클라이언트 방어벽**이며
 *   SCR-28 이 정한 UX 다. 서버를 믿고 생략하면 오탭 한 번에 데이터가 사라진다.
 *
 * ────────────────────── 중복을 만들지 않는다 ──────────────────────
 *
 * 닉네임(SCR-26)과 비밀번호 2필드(SCR-27) 규칙은 **이미 `features/auth/schema.ts` 에 있다.**
 * 그 파일은 서버 `AuthService` 와 글자 단위로 맞춰져 있고 로그인/가입과 정규식을 공유한다.
 * 여기서 다시 쓰면 규칙이 갈라지므로 **재수출**하고, 이 파일은 SCR-27 의 3번째 필드(확인)와
 * SCR-28/29 의 새 스키마만 만든다.
 */

import { z } from 'zod';

// ═══════════════════════════════════════════ 1. auth 계층 재수출

export {
  changePasswordSchema,
  nicknameSchema,
  NICKNAME_HINT,
  type ChangePasswordFormValues,
  type NicknameFormValues,
} from '@/features/auth/schema';

// ═══════════════════════════════════════════ 2. SCR-27 비밀번호 변경 (3필드)

/** 가입 스키마와 같은 상한. BCrypt 가 72바이트를 넘기면 조용히 자른다. */
const PASSWORD_MAX = 32;

/** SCR-27 필드 스펙 표의 라벨·placeholder·힌트 원문. 화면이 지어내지 않게 여기서 준다. */
export const PASSWORD_FORM_COPY = {
  description: '보안을 위해 현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.',
  currentLabel: '현재 비밀번호',
  currentPlaceholder: '••••••••',
  newLabel: '새로운 비밀번호',
  newPlaceholder: '8자 이상',
  newHint: '8자 이상',
  confirmLabel: '새로운 비밀번호 확인',
  confirmPlaceholder: '한 번 더 입력',
  submit: '변경',
  /** 말줄임표는 `…` 단일 문자다 (SCR-27 원문 주석). */
  submitting: '변경 중…',
  success: '비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.',
  /** 소셜 계정 진입 차단 안내 (SCR-25 인터랙션 표 원문). */
  socialBlocked: '소셜 로그인(구글/카카오/네이버) 계정은 비밀번호를 변경할 수 없습니다.',
} as const;

/**
 * SCR-27 전체 폼. `features/auth` 의 2필드 스키마에 **확인 필드만 얹는다.**
 *
 * 검사 순서가 곧 사용자에게 보이는 첫 에러다: 길이 → 현재와 동일 → 확인 불일치.
 * zod 는 `.refine` 을 선언 순서대로 평가하므로 이 순서가 SCR-27 상태 표의 순서와 일치한다.
 * 문구는 전부 SCR-27 원문이다.
 */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, '비밀번호를 입력해 주세요.'),
    newPassword: z
      .string()
      .min(8, '새 비밀번호는 8자 이상이어야 합니다.')
      .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자 이하로 입력해 주세요.`),
    newPasswordConfirm: z.string().min(1, '비밀번호를 입력해 주세요.'),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    error: '현재 비밀번호와 다르게 설정해주세요.',
    path: ['newPassword'],
  })
  .refine((value) => value.newPassword === value.newPasswordConfirm, {
    error: '새 비밀번호가 일치하지 않습니다.',
    path: ['newPasswordConfirm'],
  });

export type ChangePasswordFormSchemaValues = z.infer<typeof changePasswordFormSchema>;

// ═══════════════════════════════════════════ 3. SCR-28 회원 탈퇴

/**
 * 소셜 계정 탈퇴 시 입력해야 하는 문구. **서버가 아니라 앱이 정한 값이다.**
 * 공백을 trim 한 뒤 정확히 일치해야 한다 — 부분 일치·대소문자 무시를 허용하지 않는다.
 */
export const DELETE_ACCOUNT_CONFIRM_TEXT = '탈퇴';

/** 문서 전체 삭제 확인 문구. 붙여쓰기다 — `전체 삭제`(공백)가 아니다 (SCR-28 원문). */
export const DELETE_DOCUMENTS_CONFIRM_TEXT = '전체삭제';

/** SCR-28 카피 원문 전량. 화면이 문장을 다시 쓰지 않게 여기서 준다. */
export const DANGER_ZONE_COPY = {
  documentsAction: '전체 삭제',
  documentsSheetTitle: '내 데이터를 모두 삭제할까요?',
  documentsSheetBody:
    '저장한 모든 문서와 검색 기록이 삭제되며 복구할 수 없습니다. 구글 캘린더 연동은 유지됩니다.',
  documentsConfirmLabel: '확인 문구',
  documentsConfirmHint: `계속하려면 "${DELETE_DOCUMENTS_CONFIRM_TEXT}"를 정확히 입력하세요.`,

  accountCardTitle: '정말 탈퇴하시겠어요?',
  /** 로컬 계정 확인 시트 본문 (SCR-28 표). */
  accountLocalBody: '이 작업은 되돌릴 수 없습니다. 계속하려면 계정 비밀번호를 입력하세요.',
  /** 소셜 계정 확인 시트 본문 (SCR-28 표). */
  accountSocialBody: '이 작업은 되돌릴 수 없습니다. 저장된 계정과 서비스 데이터가 삭제됩니다.',
  accountConfirmAction: '탈퇴',
  accountSuccess: '회원 탈퇴가 완료되었습니다.',

  cancel: '취소',
  submitting: '삭제 중...',
  passwordInvalid: '비밀번호가 올바르지 않습니다.',
} as const;

/** 로컬 계정 탈퇴 — 서버가 BCrypt 로 검증하므로 앱은 빈 값만 막는다. */
export const deleteAccountLocalSchema = z.object({
  password: z
    .string()
    .min(1, '비밀번호를 입력해 주세요.')
    // 서버는 `isBlank()` 로 판정한다. 공백만 입력한 값은 왕복 없이 앱에서 막는다.
    .refine((value) => value.trim().length > 0, '비밀번호를 입력해 주세요.'),
});

/** 소셜 계정 탈퇴 — 서버 검증이 없으므로 확인 문구가 유일한 방어선이다. */
export const deleteAccountSocialSchema = z.object({
  confirmText: z
    .string()
    .trim()
    .refine(
      (value) => value === DELETE_ACCOUNT_CONFIRM_TEXT,
      `"${DELETE_ACCOUNT_CONFIRM_TEXT}"를 정확히 입력하세요.`,
    ),
});

/** 문서 전체 삭제 — 서버 검증이 없으므로 확인 문구가 유일한 방어선이다. */
export const deleteDocumentsSchema = z.object({
  confirmText: z
    .string()
    .trim()
    .refine(
      (value) => value === DELETE_DOCUMENTS_CONFIRM_TEXT,
      DANGER_ZONE_COPY.documentsConfirmHint,
    ),
});

export type DeleteAccountLocalFormValues = z.infer<typeof deleteAccountLocalSchema>;
export type DeleteAccountSocialFormValues = z.infer<typeof deleteAccountSocialSchema>;
export type DeleteDocumentsFormValues = z.infer<typeof deleteDocumentsSchema>;

/**
 * 확인 문구 일치 판정. 버튼 활성/비활성에 쓰는 **동기 헬퍼**다.
 * 스키마를 매 키 입력마다 돌리는 것보다 싸고, 폼 상태를 만들지 않는 시트에서도 쓸 수 있다.
 */
export function matchesConfirmText(input: string, expected: string): boolean {
  return input.trim() === expected;
}

// ═══════════════════════════════════════════ 4. SCR-29 알림 설정

/** SCR-29 카피 원문. */
export const NOTIFICATION_SETTINGS_COPY = {
  screenTitle: '알림 설정',
  notice: '알림은 앱 안에서 확인할 수 있습니다. 기기 푸시 알림은 준비 중입니다.',
  typeSection: '알림 종류',
  deadlineTitle: '마감예정 일정 알림',
  deadlineCaption: '티켓 출발일과 포스터 시작일이 다가오면 알려드립니다.',
  scheduleTitle: '진행 중 종료 알림',
  scheduleCaption: '진행 중인 티켓과 포스터의 종료가 다가오면 알려드립니다.',
  timingSection: '알림 시점',
  daysTitle: '며칠 전부터 알림 받기',
  footer: '앱에서 확인하며, 매일 오전 9시에도 알림을 생성합니다.',
  loadFailed: '알림 설정을 불러오지 못했습니다.',
  saveFailed: '알림 설정을 저장하지 못했습니다.',
  retry: '다시 시도',
  /** SCR-25 진입 행 설명. */
  entryCaption: '예정 일정·진행 중 종료 알림 수신 방식을 설정합니다.',
} as const;

/** SCR-29 세그먼트 하단 설명. 선택값에 따라 갱신된다. */
export function deadlineDaysCaption(days: number): string {
  return `시작일 또는 종료일 ${days}일 전부터 알림을 받습니다.`;
}

/**
 * 알림 설정 저장 스키마.
 *
 * 상한 30 은 **서버 규칙**이다(`MAX_DEADLINE_REMINDER_DAYS`). 넘기면 400 이므로
 * SCR-29 세그먼트가 1/3/5/7/14 만 노출하더라도 스키마는 서버 범위 전체를 허용한다 —
 * 나중에 선택지가 늘어도 스키마를 고칠 일이 없다.
 * 세 필드가 모두 `optional` 인 것은 서버가 부분 업데이트를 지원하기 때문이다(래퍼 타입 null 스킵).
 */
export const notificationSettingsSchema = z.object({
  deadlineReminderDays: z
    .number()
    .int('일수는 정수여야 합니다.')
    .min(0, '일수는 0일 이상이어야 합니다.')
    .max(30, '일수는 30일 이하여야 합니다.')
    .optional(),
  deadlineReminderEnabled: z.boolean().optional(),
  scheduleReminderEnabled: z.boolean().optional(),
});

export type NotificationSettingsFormValues = z.infer<typeof notificationSettingsSchema>;
