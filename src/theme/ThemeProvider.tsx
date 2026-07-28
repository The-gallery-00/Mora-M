import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance } from 'react-native';

import { useThemeStore, type ThemeMode } from '@/store/themeStore';

import { themes, type ThemeTokens } from './tokens';

/**
 * 테마 컨텍스트 — Design Tokens §13-5 정본.
 *
 * 마운트 위치는 `SafeAreaProvider` 안, `QueryClientProvider` 밖이다 (app/_layout.tsx).
 * 스플래시를 내리기 전에 테마가 확정되어야 하고, 쿼리 캐시 복원보다 앞서야
 * 로딩 스켈레톤이 올바른 테마로 처음 그려진다.
 */
const ThemeCtx = createContext<ThemeTokens>(themes.light);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useThemeStore((s) => s.scheme);
  const syncOS = useThemeStore((s) => s.syncOS);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => syncOS(colorScheme));
    return () => sub.remove();
  }, [syncOS]);

  const value = useMemo(() => themes[scheme], [scheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/**
 * className 을 못 쓰는 지점의 유일한 색 출처 — Reanimated, 네이티브 헤더 옵션, StatusBar,
 * expo-image placeholder, BottomSheet backdrop(`scrim`), elevation, SVG fill.
 *
 * `scrim` / `overlayImage` 는 알파가 테마마다 달라(0.30 → 0.60) CSS 채널 변수로 표현할 수
 * 없다. 클래스로 쓰지 않고 반드시 이 훅으로만 소비한다 (§13-1 각주).
 */
export function useTheme(): ThemeTokens {
  return useContext(ThemeCtx);
}

/** 설정 화면(SCR-25) 세그먼트 전용. 화면 코드가 mode 를 읽는 유일한 경로 */
export function useThemeMode(): { mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  return { mode, setMode };
}
