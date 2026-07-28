/**
 * 인증 화면·토스트 문구 단일 출처.
 *
 * 문구 정본은 wiki/design/Mobile UX Guide.md §7-2 카피 테이블(`최종안` 열이 앱에 들어가는
 * 유일한 문자열)과 wiki/design/Screen Specs.md SCR-03/04/05/26 이다. 각 항목에 근거를 달았다.
 * **서버가 준 `error` 문자열은 절대 노출하지 않는다** (한/영 혼재 + 인코딩 깨짐 —
 * wiki/tech/API Contract.md §4-5). 화면은 여기 있는 문구만 쓴다.
 */
export const AUTH_COPY = {
  // ── 에러 (Mobile UX Guide §7-2 에러 표) ────────────────────────────────
  /** CP-19 — 로그인 자격증명 실패 */
  loginFailed: '이메일 또는 비밀번호를 다시 확인해 주세요',
  /** CP-20 — 회원가입 실패(대부분 이메일 중복) */
  signupFailed: '가입하지 못했어요. 이미 가입된 이메일인지 확인해 주세요',
  /** CP-21 — 200 을 받았는데 토큰이 없음 */
  tokenMissing: '로그인에 실패했어요. 잠시 후 다시 시도해 주세요',
  /** CP-22 — 서버 도달 실패 / 타임아웃 */
  serverUnreachable: '서버에 연결할 수 없어요. 네트워크와 서버 주소를 확인해 주세요',
  /** 저장된 세션은 있는데 서버 응답이 늦은 경우. 로그인 화면으로 튕기지 않고 낙관적으로 진입한다. */
  serverSlow: '서버 응답이 느려요. 일부 정보가 늦게 표시될 수 있어요',
  /** CP-24 — 401 세션 만료 (원본 문구 유지) */
  sessionExpired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
  /** API Contract §4-5 — 429 (비밀번호 변경 rate limit) */
  rateLimited: '요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.',

  // ── 소셜 로그인 (Screen Specs SCR-03 인터랙션 · SCR-05 상태) ───────────
  /** SCR-03 소셜 버튼 실패 토스트 / SCR-05 에러 카드 제목 */
  socialFailed: '소셜 로그인에 실패했습니다.',
  /** SCR-05 에러 카드 부제 (원본 실패 HTML 문구) */
  socialFailedDetail: '브라우저를 닫고 다시 시도해 주세요.',
  /** SCR-05 폴백 — 서버 착지 주소가 앱 스킴이 아닐 때 소셜 버튼을 막는 토스트 */
  socialUnavailable: '준비 중입니다.',
  /** SCR-05 빈 상태 — 딥링크에 토큰이 없음 */
  socialNoParams: '로그인 정보를 받지 못했습니다.',
  /** SCR-05 진행 안내 (원본 OAuth 브리지 HTML `<p>` 원문) */
  socialProgress: '로그인 처리 중입니다.',
  socialProgressSub: '잠시만 기다려 주세요.',

  // ── 성공 ──────────────────────────────────────────────────────────────
  /** SCR-04 가입 성공 토스트 */
  signupSuccess: '가입이 완료되었습니다. MORA를 시작해 보세요.',
  /** SCR-26 닉네임 변경 성공 / 실패 */
  nameChanged: '닉네임을 변경했습니다.',
  nameChangeFailed: '닉네임 변경에 실패했습니다.',

  // ── 세션 수명 (Auth.md §4-4) ──────────────────────────────────────────
  expiryWarning: '로그인이 곧 만료됩니다. 저장하지 않은 스캔이 있다면 먼저 저장해 주세요.',

  // ── 버튼 로딩 라벨 (CP-06) ────────────────────────────────────────────
  submittingLogin: '로그인 중',
  submittingSignup: '가입 중',
} as const;

/** SCR-05 성공 토스트 — `Google로 로그인했습니다.` */
export function socialSuccessMessage(providerLabel: string): string {
  return `${providerLabel}로 로그인했습니다.`;
}
