import { z } from 'zod';

/**
 * 인증 폼 검증 스키마 (react-hook-form + zodResolver 용).
 *
 * ## 서버 검증 규칙 — 원본 코드로 직접 확인한 사실
 * `backend/service/AuthService.java` 기준이며 추측이 아니다.
 *
 * | 대상 | 서버가 실제로 하는 검사 | 근거 |
 * |---|---|---|
 * | 회원가입 | `email`/`password` **blank 아님**만. 형식·길이·복잡도 검사 전무 | `validateSignupRequest` |
 * | 회원가입 중복 | `userRepository.existsByEmail` → 400 `"Email already exists"` | `signup()` |
 * | 회원가입 닉네임 | `SignupRequest` 에 `name` 필드 자체가 없음. `email.split("@")[0]` 자동 생성 | `signup():52` |
 * | 로그인 | blank 검사 → 이메일 조회 → 소셜 전용(해시 없음) 차단 → BCrypt 비교. 실패는 전부 **400** | `login()` |
 * | 비밀번호 변경 | 소셜 차단 · 현재 비번 일치 · **새 비번 8자 이상** · 현재와 달라야 함 | `changePassword()` |
 * | 닉네임 변경 | `trim()` 후 **2~20자** + `^[a-zA-Z0-9가-힣_.\-]+$` | `changeName()` |
 *
 * 즉 **가입 시 서버는 사실상 아무 검증도 하지 않는다.** 앱이 유일한 방어선이므로
 * wiki/tech/Auth.md §2-2 대로 서버보다 엄격하게 선차단한다. 특히 가입 비밀번호를 8자 이상으로
 * 막는 이유는 서버의 비밀번호 **변경** 규칙이 8자 이상이라, 그보다 짧게 가입하면 나중에
 * 변경 자체가 막히는 상태가 되기 때문이다.
 *
 * 문구는 wiki/design/Screen Specs.md SCR-03/04/26/27 원문을 그대로 쓴다.
 */

/**
 * 이메일 형식 — Auth.md §2-2 의 정규식 그대로.
 * `z.email()` 을 쓰지 않는 이유: zod 내장 규칙은 위키가 확정한 규칙과 미세하게 다르고
 * (TLD 2자 미만 허용 등) 위키가 정본이다.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 서버 `changeName` 정규식과 글자 단위로 동일해야 한다. */
const NICKNAME_PATTERN = /^[a-zA-Z0-9가-힣_.\-]+$/;

/** 가입 비밀번호 상한. 서버에는 상한이 없으나 BCrypt 가 72바이트를 넘기면 조용히 잘린다. */
const PASSWORD_MAX = 32;

/** SCR-04 상시 노출 힌트. */
export const SIGNUP_PASSWORD_HINT = '8자 이상 입력해 주세요.';

/** SCR-26 닉네임 입력 힌트 (원문 설명문에서 추출). */
export const NICKNAME_HINT = '2~20자, 한글·영문·숫자·_.- 사용 가능.';

/**
 * 차단하지 않는 권장 안내 (Auth.md §2-2). 제출을 막지 않고 힌트만 바꾼다.
 * 영문·숫자를 함께 쓰지 않았을 때만 문구를 돌려준다.
 */
export function passwordAdvice(password: string): string | null {
  if (password.length < 8) return null;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  return hasLetter && hasDigit ? null : '영문과 숫자를 함께 쓰면 더 안전합니다.';
}

/**
 * 이메일 필드. 앞뒤 공백 제거 + 소문자 정규화까지 스키마가 책임진다 —
 * 서버는 이메일을 정규화하지 않으므로 `A@b.com` 과 `a@b.com` 이 서로 다른 계정이 된다.
 * 검사 순서가 곧 사용자에게 보이는 첫 에러의 순서다(빈 값 → 형식 → 길이).
 */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, '이메일을 입력해 주세요.')
  .regex(EMAIL_PATTERN, '이메일 형식이 올바르지 않습니다.')
  .max(254, '이메일 형식이 올바르지 않습니다.');

/** 로그인 비밀번호 — 기존 계정은 8자 미만일 수 있으므로 길이를 검사하지 않는다. */
const loginPasswordField = z
  .string()
  .min(1, '비밀번호를 입력해 주세요.')
  // 서버는 `isBlank()` 로 판정하므로 공백만 입력한 값은 400 이 된다. 왕복 없이 앱에서 막는다.
  .refine((value) => value.trim().length > 0, '비밀번호를 입력해 주세요.');

/** 가입 비밀번호 — 8자 이상 (서버 변경 규칙과 일치). */
const signupPasswordField = z
  .string()
  .min(1, '비밀번호를 입력해 주세요.')
  .min(8, '비밀번호는 8자 이상이어야 합니다.')
  .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자 이하로 입력해 주세요.`)
  .refine((value) => value.trim().length > 0, '비밀번호를 입력해 주세요.');

/** SCR-03 로그인 폼. */
export const loginSchema = z.object({
  email: emailField,
  password: loginPasswordField,
});

/** SCR-04 회원가입 폼. 닉네임 필드는 두지 않는다 (FR-024 — 가입 직후 별도 단계). */
export const signupSchema = z.object({
  email: emailField,
  password: signupPasswordField,
});

/**
 * 비밀번호 확인 필드를 함께 쓰는 변형. SCR-04 와이어프레임에는 확인 필드가 없지만
 * Auth.md §2-2 가 규칙과 문구를 확정해 두었으므로 화면이 필요할 때 바로 쓸 수 있게 둔다.
 */
export const signupWithConfirmSchema = z
  .object({
    email: emailField,
    password: signupPasswordField,
    passwordConfirm: z.string().min(1, '비밀번호를 입력해 주세요.'),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    error: '비밀번호가 일치하지 않습니다.',
    path: ['passwordConfirm'],
  });

/** SCR-26 닉네임(표시 이름). 서버 `changeName` 과 규칙·순서를 일치시킨다. */
export const nicknameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, '2~20자, 한글·영문·숫자·_.- 만 사용할 수 있습니다.')
    .max(20, '2~20자, 한글·영문·숫자·_.- 만 사용할 수 있습니다.')
    .regex(NICKNAME_PATTERN, '2~20자, 한글·영문·숫자·_.- 만 사용할 수 있습니다.'),
});

/**
 * SCR-27 비밀번호 변경 (Phase 6 화면이지만 규칙 정본은 인증 코어가 소유한다).
 * 문구는 SCR-27 원문 — `새 비밀번호는 8자 이상이어야 합니다.` / `현재 비밀번호와 다르게 설정해주세요.`
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '비밀번호를 입력해 주세요.'),
    newPassword: z
      .string()
      .min(8, '새 비밀번호는 8자 이상이어야 합니다.')
      .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자 이하로 입력해 주세요.`),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    error: '현재 비밀번호와 다르게 설정해주세요.',
    path: ['newPassword'],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type SignupFormValues = z.infer<typeof signupSchema>;
export type SignupWithConfirmFormValues = z.infer<typeof signupWithConfirmSchema>;
export type NicknameFormValues = z.infer<typeof nicknameSchema>;
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
