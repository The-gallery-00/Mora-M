import { colorScheme as nwColorScheme } from 'nativewind';
import { Appearance, type ColorSchemeName } from 'react-native';
import { create } from 'zustand';

import type { ResolvedScheme } from '@/theme/tokens';

import { StorageKey, storage } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * 테마 3택 상태 — Design Tokens §13-4 정본.
 *
 * MMKV 키 `theme.mode` 는 StorageKey.themeMode 로 참조한다 (Offline and State §1-4).
 * 값은 ThemeMode 문자열을 **JSON 으로 감싸지 않고 그대로** 저장한다.
 *
 * zustand/persist 미들웨어를 쓰지 않는다 — (1) rehydrate 가 한 틱 늦어 첫 프레임이
 * 라이트로 깜빡이고, (2) persist 가 값을 `{state:{...},version:n}` 로 감싸 "키 하나에
 * 문자열 하나" 계약이 깨진다. 스토어 초기화에서 MMKV 를 동기로 직접 읽는다.
 */

/**
 * 다크모드 킬 스위치.
 *
 * false 면 사용자 선택·OS 값을 무시하고 라이트로 고정한다. 다크 팔레트·토큰·전환 배선은
 * 그대로 남아 있으므로 **이 상수만 true 로 되돌리면 즉시 복구**된다.
 *
 * 왜 삭제가 아니라 동결인가: 다크 지원의 남은 비용은 컴포넌트 갤러리 2벌(Phase 1)과
 * QA 매트릭스 2배(Phase 7)에 있고, 토큰 레이어는 이미 완성되어 유지비가 0 이다.
 * 코드를 지우면 위키 8문서(FR-123~129 · NFR-029 · 집계 · Scope · Phases · QA · Risks)를
 * 역롤백해야 해서 되돌리는 비용이 절약분보다 크다.
 *
 * 되돌릴 때 같이 할 일: app.config.js 의 `userInterfaceStyle` 을 'automatic' 으로,
 * 설정 화면(SCR-25)의 테마 3택 세그먼트 노출 복구.
 */
export const THEME_DARK_ENABLED = false;

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';

/** 부팅 시 **동기** 읽기. 미저장/오염된 값은 'system'. */
const readMode = (): ThemeMode => {
  if (!THEME_DARK_ENABLED) return 'light';
  const v = storage.getString(StorageKey.themeMode);
  return isMode(v) ? v : 'system';
};

/**
 * OS 가 보고하는 스킴. RN 의 `Appearance.getColorScheme()` 은
 * `'light' | 'dark' | 'unspecified' | null | undefined` 를 돌려주므로 전부 받는다.
 * 'dark' 가 아닌 값은 모두 라이트로 해석한다.
 */
type OsScheme = ColorSchemeName | null | undefined;

export const resolveScheme = (mode: ThemeMode, os: OsScheme): ResolvedScheme => {
  if (!THEME_DARK_ENABLED) return 'light';
  return mode === 'system' ? (os === 'dark' ? 'dark' : 'light') : mode;
};

type ThemeState = {
  mode: ThemeMode; // 사용자 선택 (설정 세그먼트가 바인딩하는 값)
  scheme: ResolvedScheme; // 실제 적용값 (컴포넌트가 읽는 값)
  setMode: (m: ThemeMode) => void;
  syncOS: (os: OsScheme) => void;
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const mode = readMode();
  // NativeWind 에 3택을 그대로 넘긴다('system' 지원). 동결 중이면 'light' 가 넘어가 dark 클래스가 안 붙는다.
  nwColorScheme.set(mode);
  return {
    mode,
    scheme: resolveScheme(mode, Appearance.getColorScheme()),

    setMode: (m) => {
      if (!THEME_DARK_ENABLED) return; // 동결 중 — 라이트 고정
      storage.set(StorageKey.themeMode, m); // 동기 저장 — 프로세스가 즉시 죽어도 남는다
      nwColorScheme.set(m);
      set({ mode: m, scheme: resolveScheme(m, Appearance.getColorScheme()) });
    },

    // OS 테마 변경 이벤트. 명시 선택(light/dark)은 흔들리지 않는다.
    syncOS: (os) => {
      if (get().mode !== 'system') return;
      const next = resolveScheme('system', os);
      if (next !== get().scheme) set({ scheme: next });
    },
  };
});
