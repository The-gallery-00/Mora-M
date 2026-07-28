import { Image } from 'expo-image';
import { create } from 'zustand';

import {
  changeName,
  fetchMe,
  fromSessionUser,
  login,
  persistSession,
  signOutLocal,
  signup,
  toSessionUser,
  type AuthCredentials,
  type AuthUser,
  type EmailCredentialInput,
} from '@/features/auth/api';
import { AUTH_COPY } from '@/features/auth/messages';
import { oauthPayloadToCredentials, type OAuthPayload, type SocialProvider } from '@/features/auth/oauth';
import { isTokenExpired, isTokenExpiringSoon } from '@/features/auth/token';
import { setSessionExpiredHandler, type ApiResult } from '@/services/http';
import { getCachedUser, loadSession, saveSession } from '@/services/session';
import { StorageKey, storage } from '@/store/storage';

/**
 * 세션 스토어 (전역 클라이언트 상태 — Offline and State ST-01/ST-03).
 *
 * 경계 규칙:
 *  - **토큰의 정본은 SecureStore** 다(`services/session.ts`). 여기 있는 `token` 은 매 요청마다
 *    네이티브 브리지를 왕복하지 않기 위한 메모리 미러다 (Auth.md §4-2).
 *  - MMKV persist 를 쓰지 않는다. 프로필 스냅샷은 이미 SecureStore(`mora.user`)에 있고,
 *    같은 값을 평문 MMKV 에 한 벌 더 두면 PII 가 늘고 두 소스가 어긋난다.
 *    Offline and State ST-03 의 "user 만 MMKV persist" 는 SecureStore 스냅샷으로 대체한다.
 *  - **라우팅을 하지 않는다.** `router.replace` 를 스토어에서 부르면 첫 프레임에 보호 화면이
 *    노출되는 문제가 생긴다. 화면 전환은 `<Redirect>` 기반 가드가 담당한다 (Auth.md §6-2 규칙 2).
 *  - 서버 상태(`GET /auth/me` 캐시)는 React Query 가 소유한다. 여기 있는 `user` 는 부팅 첫 프레임과
 *    가드 판정을 위한 최소 미러다.
 *
 * `status` 값(`booting`/`authenticated`/`anonymous`)은 Phase 2 구현 계약을 따른다.
 * 위키 표기(`loading`/`authed`/`guest` — Auth.md §4-3, Offline and State ST-03)와 이름만 다르고
 * 의미는 1:1 대응한다. 문자열 비교 대신 `isAuthenticated`/`isBooting` 헬퍼를 쓰면 안전하다.
 */
export type AuthStatus = 'booting' | 'authenticated' | 'anonymous';

/** 세션이 끊긴 이유. `exp` = 토큰 수명 소진(선제 판정), `unauthorized` = 서버가 401/400 을 줬다. */
export type SessionExpiryReason = 'exp' | 'unauthorized';

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  /** SecureStore 토큰의 메모리 미러. 화면에 노출하지 않는다. */
  token: string | null;
  /** 만료 1시간 전 비차단 배너 표시 여부 (Auth.md §4-4). */
  expiryWarning: boolean;
  /** 마지막으로 `GET /auth/me` 검증에 성공한 시각(ms). 0 = 아직 검증 안 함. */
  lastCheckedAt: number;
  /** 세션 만료 토스트를 아직 보여주지 않았는가 (한 번만 띄우기 위한 플래그). */
  expiredNotice: SessionExpiryReason | null;

  /** 앱 시작 시 1회. 스플래시는 이 함수가 `booting` 을 벗어날 때까지만 잡는다. */
  bootstrap: () => Promise<void>;
  signIn: (input: EmailCredentialInput) => Promise<ApiResult<AuthUser>>;
  signUp: (input: EmailCredentialInput) => Promise<ApiResult<AuthUser>>;
  /** OAuth 딥링크로 받은 토큰으로 세션을 세운다 (SCR-05). */
  acceptOAuthSession: (payload: OAuthPayload, provider: SocialProvider) => Promise<ApiResult<AuthUser>>;
  /** 닉네임 변경 (API-04). FR-024 가입 직후 단계 · SCR-26. */
  updateName: (name: string) => Promise<ApiResult<AuthUser>>;
  /**
   * `GET /auth/me` 재검증. 성공하면 프로필을 갱신하고, 401/`/auth/me` 400 이면 세션을 파기한다.
   * 네트워크 실패(offline/timeout/5xx)는 실패를 반환하되 **세션을 유지**한다.
   */
  refreshMe: () => Promise<ApiResult<AuthUser>>;
  /** 사용자가 명시적으로 로그아웃 (SCR-25). */
  signOut: () => Promise<void>;
  /** 401/토큰 만료로 세션을 파기한다. 중복 호출은 무해하다. */
  expireSession: (reason: SessionExpiryReason) => Promise<void>;
  setExpiryWarning: (value: boolean) => void;
  /** 재검증 성공 시각 갱신 (포그라운드 복귀 훅이 사용). */
  markChecked: () => void;
  /** 만료 토스트를 띄운 뒤 호출해 중복 노출을 막는다. */
  clearExpiredNotice: () => void;
};

/**
 * 세션 파기 시 함께 비워야 하는 외부 캐시 등록 슬롯.
 * React Query 인스턴스는 `app/_layout.tsx` 안에서 생성되어 스토어가 접근할 수 없으므로,
 * 루트에 마운트된 훅이 `queryClient.clear()` 를 등록한다 (`useSessionRevalidate` 가 기본 등록).
 */
type SessionCleanup = () => void;
const sessionCleanups = new Set<SessionCleanup>();

export function registerSessionCleanup(cleanup: SessionCleanup): () => void {
  sessionCleanups.add(cleanup);
  return () => {
    sessionCleanups.delete(cleanup);
  };
}

function runSessionCleanups(): void {
  for (const cleanup of sessionCleanups) {
    try {
      cleanup();
    } catch {
      // 캐시 정리 실패가 로그아웃 자체를 막아서는 안 된다.
    }
  }
}

/**
 * 계정에 종속된 로컬 데이터를 지운다 (Auth.md §4-5).
 * `theme.mode` · `onboarding.seen` · 서버 주소 오버라이드는 **유지**한다 — 기기 취향/개발 설정이다.
 *
 * `scan.draft` 는 경로에 따라 다르다:
 *  - 명시적 로그아웃: 삭제 (다른 계정에 남의 스캔이 뜨면 안 된다 — Auth.md §4-5 #6)
 *  - 401 세션 만료: **유지** (재로그인 후 "이어서 저장" — Offline and State §9)
 */
function clearAccountScopedStorage(options: { keepScanDraft: boolean }): void {
  storage.remove(StorageKey.searchLastDocType);
  // 아래 두 키는 Phase 4/5 소유지만 계정 종속이라 세션 정리 대상이다 (Offline and State §1-4).
  storage.remove('search.recent');
  if (!options.keepScanDraft) storage.remove('scan.draft');
}

/** 세션이 이미 끊긴 상태에서의 재검증 요청에 붙이는 문구 (CP-24). */
const SESSION_EXPIRED_MESSAGE = AUTH_COPY.sessionExpired;

/** 남의 문서 이미지가 캐시에 남지 않게 한다 (Auth.md §4-5 #8). */
function clearImageCaches(): void {
  void Image.clearMemoryCache();
  void Image.clearDiskCache();
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'booting',
  user: null,
  token: null,
  expiryWarning: false,
  lastCheckedAt: 0,
  expiredNotice: null,

  /**
   * 자동 로그인 시퀀스 (Auth.md §4-3).
   *  1. SecureStore 토큰 로드
   *  2. 없음 → anonymous
   *  3. 토큰 `exp` 경과 → 네트워크 호출 없이 정리 후 anonymous
   *  4. 캐시된 프로필로 authenticated 선반영 (첫 화면 즉시 렌더)
   *  5. 백그라운드로 `GET /auth/me` 검증 — 401/400 이면 만료, 네트워크 실패면 **세션 유지**
   */
  bootstrap: async () => {
    const token = await loadSession();

    if (!token) {
      set({ status: 'anonymous', user: null, token: null });
      return;
    }

    if (isTokenExpired(token)) {
      await signOutLocal();
      clearAccountScopedStorage({ keepScanDraft: true });
      set({ status: 'anonymous', user: null, token: null, expiredNotice: 'exp' });
      return;
    }

    const cached = await getCachedUser();
    set({
      status: 'authenticated',
      token,
      user: cached ? fromSessionUser(cached) : null,
      expiryWarning: isTokenExpiringSoon(token),
    });

    // 스플래시는 여기까지만 잡는다. 검증은 화면을 그린 뒤 백그라운드로 돌린다.
    void get().refreshMe();
  },

  signIn: async (input) => {
    const res = await login(input);
    if (!res.ok) return res;
    return applyCredentials(set, get, res.data);
  },

  signUp: async (input) => {
    const res = await signup(input);
    if (!res.ok) return res;
    return applyCredentials(set, get, res.data);
  },

  acceptOAuthSession: async (payload, provider) => {
    const credentials = oauthPayloadToCredentials(payload, provider);
    // 딥링크 파라미터는 신뢰하지 않는다. 여기서는 토큰만 세우고 프로필은 서버 응답으로 확정한다.
    return applyCredentials(set, get, credentials, { awaitProfile: true });
  },

  updateName: async (name) => {
    const res = await changeName(name);
    if (!res.ok) return res;

    const token = get().token;
    set({ user: res.data });
    if (token) await saveSession(token, toSessionUser(res.data));
    return res;
  },

  refreshMe: async () => {
    if (get().status !== 'authenticated') {
      return { ok: false, error: { kind: 'unauthorized', status: 401, message: SESSION_EXPIRED_MESSAGE } };
    }

    const res = await fetchMe();
    if (res.ok) {
      const token = get().token;
      set({ user: res.data, lastCheckedAt: Date.now() });
      if (token) await saveSession(token, toSessionUser(res.data));
      return res;
    }

    const { kind, status } = res.error;
    // 401 은 http.ts 가 이미 세션을 지우고 만료 핸들러를 부른다. 400 은 `/auth/me` 에서만 만료로 본다
    // (AuthController 가 `User not found` 등 도메인 실패를 400 으로 내리기 때문 — Auth.md §5-1).
    if (kind === 'unauthorized' || (kind === 'client' && status === 400)) {
      await get().expireSession('unauthorized');
    }
    // offline / timeout / 5xx → 세션을 유지한다. 네트워크 실패를 로그아웃으로 해석하지 않는다.
    return res;
  },

  signOut: async () => {
    await signOutLocal();
    runSessionCleanups();
    clearAccountScopedStorage({ keepScanDraft: false });
    clearImageCaches();
    set({
      status: 'anonymous',
      user: null,
      token: null,
      expiryWarning: false,
      lastCheckedAt: 0,
      expiredNotice: null,
    });
  },

  expireSession: async (reason) => {
    if (get().status === 'anonymous') return; // 동시 401 다중 호출 방지
    await signOutLocal();
    runSessionCleanups();
    // 스캔 초안은 남긴다 — 재로그인 후 이어서 저장한다.
    clearAccountScopedStorage({ keepScanDraft: true });
    set({
      status: 'anonymous',
      user: null,
      token: null,
      expiryWarning: false,
      lastCheckedAt: 0,
      expiredNotice: reason,
    });
  },

  setExpiryWarning: (value) => set({ expiryWarning: value }),
  markChecked: () => set({ lastCheckedAt: Date.now() }),
  clearExpiredNotice: () => set({ expiredNotice: null }),
}));

/** 로그인·가입·OAuth 공통 후처리: SecureStore 저장 → 상태 전환 → 프로필 정본 보정. */
async function applyCredentials(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
  credentials: AuthCredentials,
  options: { awaitProfile?: boolean } = {},
): Promise<ApiResult<AuthUser>> {
  await persistSession(credentials);
  set({
    status: 'authenticated',
    token: credentials.token,
    user: credentials.user,
    expiryWarning: false,
    lastCheckedAt: 0,
    expiredNotice: null,
  });

  // `AuthResponse` 에는 picture/provider/createdAt 이 없어 설정 화면의 계정 종류 분기를 할 수 없다.
  // 그래서 성공 직후 API-03 을 한 번 더 부른다 (Auth.md §2-3).
  if (options.awaitProfile) {
    const profile = await get().refreshMe();
    if (!profile.ok) {
      // OAuth 경로 — 딥링크가 준 userId/email/name 은 신뢰할 수 없으므로(Auth.md §7-3 #6)
      // 서버 확인에 실패하면 세션을 세우지 않고 되돌린다. 401 이면 expireSession 이 이미 정리했다.
      if (get().status !== 'anonymous') {
        await signOutLocal();
        set({ status: 'anonymous', token: null, user: null, expiryWarning: false, lastCheckedAt: 0 });
      }
      return profile;
    }
  } else {
    void get().refreshMe();
  }

  return { ok: true, data: get().user ?? credentials.user };
}

// ── 선택자 (문자열 비교를 화면에 흩뿌리지 않기 위한 헬퍼) ────────────────────
export const selectIsBooting = (s: AuthState): boolean => s.status === 'booting';
export const selectIsAuthenticated = (s: AuthState): boolean => s.status === 'authenticated';
export const selectIsAnonymous = (s: AuthState): boolean => s.status === 'anonymous';

/**
 * http.ts 의 401 처리와 스토어를 연결한다.
 * 모듈 로드 시 자동 실행되므로 화면 쪽 배선이 필요 없다(중복 호출은 무해).
 */
let bridgeRegistered = false;
export function registerAuthHttpBridge(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  setSessionExpiredHandler(() => {
    void useAuthStore.getState().expireSession('unauthorized');
  });
}

registerAuthHttpBridge();
