import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationBar } from 'expo-navigation-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ToastHost, toast } from '@/components/ui';
import { useAuth, useAuthBootstrap, useSessionRevalidate } from '@/features/auth';
import { useAuthFlowStore } from '@/features/auth/authFlow';
import { installQueryNetworkBridge, queryRetry, queryRetryDelay } from '@/features/network';
import { tabToastBottomOffset } from '@/navigation/shell';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

/**
 * 스플래시 유지 — Navigation Map §6-3 규칙 4.
 *
 * **여기서는 잡기만 한다.** 실제 `hideAsync()` 는 폰트 로드 + 세션 판정이 끝나는 부트 라우터
 * (`app/index.tsx`)의 몫이다. 두 곳에서 부르면 판정 전에 보호 화면이 노출된다.
 * 모듈 스코프에서 불러야 첫 프레임보다 앞선다. 이미 숨겨진 뒤의 호출은 reject 하므로 삼킨다.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * RN 에는 `online`/`offline` 이벤트도 `visibilitychange` 도 없다. 이 배선이 없으면 아래의
 * `refetchOnReconnect` · `refetchOnWindowFocus` 가 영원히 발화하지 않는다 (Offline and State §8-1).
 * 전역 싱글턴이라 모듈 스코프에서 1회만 부른다.
 */
installQueryNetworkBridge();

/**
 * 전역 쿼리 설정 — 정본은 wiki/tech/Offline and State.md §2 QK-01 이다.
 *
 * | 값 | 근거 |
 * |---|---|
 * | `staleTime: 30초` | 보관함은 본인만 쓰는 단일 소유 데이터라 서버에서 몰래 바뀌지 않는다 |
 * | `gcTime: 30분` | **오프라인 열람(FR-101)의 실질 조건.** 기본 5분이면 탭을 몇 번 오간 뒤 기내모드로 들어가는 순간 캐시가 이미 수거돼 빈 화면이 된다 |
 * | `retry` | GET 만 지수 백오프 2회. 4xx·500 은 재현되므로 즉시 포기 — `features/network/retryPolicy.ts` |
 * | `networkMode: 'online'` | 오프라인이면 fetch 를 **시도조차 하지 않고** 쿼리를 `paused` 로 둔다. `'always'` 로 두면 쿼리가 `error` 가 되어 캐시가 화면에서 사라진다 |
 * | `refetchOnWindowFocus: true` | `focusManager` ↔ AppState 배선과 짝. 실제 재요청은 키별 `staleTime` 이 결정한다(RVL-01~07) |
 *
 * `mutations.networkMode` 만 위키 예시(`'online'`)와 **일부러 다르다.** 뮤테이션에서 `'online'`
 * 은 오프라인 호출을 `paused` 로 잡아 두었다가 재연결 시 **자동으로 재생**한다 — 그것이 바로
 * 같은 문서 §5-1 이 금지한 "쓰기 큐잉"이다. 서버에 멱등키가 없어 재생 1회가 곧 문서·이미지·NER
 * 라벨 중복이므로(§5-2), 오프라인 쓰기는 큐에 쌓지 않고 **즉시 실패**시킨다. 실제 차단은 각
 * 뮤테이션 첫 줄의 `offlineWriteBlock()` 이 담당한다.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: queryRetry,
      retryDelay: queryRetryDelay,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      networkMode: 'online',
      throwOnError: false,
      structuralSharing: true,
    },
    mutations: {
      retry: 0,
      networkMode: 'always',
      gcTime: 5 * 60_000,
    },
  },
});

/**
 * 테마 종속 시스템 크롬 — Design Tokens §13-6. 루트에 1회만 마운트한다.
 *
 * 정본 §13-6 은 `NavigationBar.setBackgroundColorAsync` / `setButtonStyleAsync` 와
 * `StatusBar` 의 `backgroundColor` · `translucent` 를 쓰지만, Expo SDK 57 은 edge-to-edge
 * 강제 전환으로 그 네 API 를 모두 제거했다. 같은 결과를 내는 현행 API 로 옮긴 것이다:
 *  - 상태바/내비바 배경 → `SystemUI.setBackgroundColorAsync` 가 앱 루트 배경을 칠하고
 *    edge-to-edge 라 두 바가 그 위에 투명하게 겹친다 (§13-6 의 "앱 배경과 같은 색" 달성)
 *  - 내비바 버튼 명암 → `NavigationBar.setStyle`
 * 값은 여전히 tokens.ts 한 곳(`t.bg.base`)에서만 나온다.
 */
function AppChrome() {
  const t = useTheme();
  const dark = t.scheme === 'dark';

  useEffect(() => {
    // 화면 전환 사이에 순간 노출되는 네이티브 루트 배경. 안 맞추면 전환마다 흰 섬광이 보인다.
    // 스플래시(다크) → 앱(라이트) 점프 구간을 1프레임으로 줄이는 완화책이기도 하다 (§13-7 함정 1).
    void SystemUI.setBackgroundColorAsync(t.bg.base);
    if (Platform.OS === 'android') {
      NavigationBar.setStyle(dark ? 'light' : 'dark');
    }
  }, [t, dark]);

  return <StatusBar style={dark ? 'light' : 'dark'} />;
}

/**
 * 세션 부트 + 만료 처리. UI 를 그리지 않는다.
 *
 *  1. `useAuthBootstrap()` — SecureStore 토큰 복원 (앱 실행당 1회, 훅 내부에서 중복 방지)
 *  2. `useSessionRevalidate()` — 포그라운드 복귀 시 `GET /auth/me` 재검증 + 세션 파기 시 쿼리 캐시 정리.
 *     **루트에 한 번만** 마운트한다 (여러 화면에서 부르면 복귀마다 요청이 중복된다)
 *  3. 세션이 끊기면(401/400 인터셉터 또는 토큰 `exp` 경과) 토스트 CP-24 + 로그인 화면으로 `replace`
 *     — Navigation Map §4 각주 · §6-3 규칙 2
 *
 * `setSessionExpiredHandler` 배선 자체는 `authStore` 가 모듈 로드 시 이미 끝냈다
 * (`registerAuthHttpBridge()`). 핸들러 슬롯이 하나뿐이라 여기서 다시 등록하면 세션 파기 로직을
 * 덮어쓰게 되므로, 라우팅·토스트는 스토어가 남긴 `expiredNotice` 를 구독해 처리한다.
 * 초기 상태의 `expiredNotice` 는 항상 null 이고 값이 생기는 시점은 비동기 이후라,
 * 이 `replace` 가 라우트 트리 마운트보다 앞설 일은 없다.
 *
 * **`authFlow` 홀드 중에는 유예한다** — `(auth)/_layout` 의 역방향 가드와 **같은 조건**이다.
 * 홀드 구간은 SCR-04 닉네임 단계와 SCR-05 콜백 브리지 두 곳이고, 후자에서 실제 사고가 난다:
 * 콜드 스타트 OAuth 딥링크로 들어왔는데 SecureStore 에 만료된 옛 토큰이 남아 있으면
 * `bootstrap()` 이 `expiredNotice` 를 세우고, 부트 게이트가 `/(auth)/callback` 으로 보낸 직후
 * 여기가 `/(auth)/login` 으로 덮어써 토큰 승격이 끊긴다. 가드를 레이아웃 한쪽에만 걸면
 * 다른 쪽이 같은 화면을 걷어차므로 두 곳이 같은 기준을 봐야 한다 (Navigation Map §6-3 규칙 1).
 *
 * 유예 중에는 알림을 **소비하지 않고 남겨 둔다** → 홀드가 풀리면 이 이펙트가 다시 판정한다.
 * OAuth 가 성공하면 `applyCredentials` 가 `expiredNotice` 를 null 로 지우므로 토스트도 뜨지 않는다.
 */
function SessionBootstrap() {
  const router = useRouter();
  const holds = useAuthFlowStore((s) => s.holds);

  useAuthBootstrap();
  useSessionRevalidate();

  const { expiredNotice, sessionExpiredMessage, clearExpiredNotice } = useAuth();

  useEffect(() => {
    if (!expiredNotice) return;
    if (holds > 0) return; // 홀드가 풀릴 때까지 알림을 남겨 둔다
    // 먼저 지운다 — 토스트/라우팅이 재렌더를 유발해도 두 번 뜨지 않게.
    clearExpiredNotice();
    toast.error(sessionExpiredMessage);
    router.replace('/(auth)/login');
  }, [clearExpiredNotice, expiredNotice, holds, router, sessionExpiredMessage]);

  return null;
}

/**
 * 토스트 호스트 — 앱 전체에 **1개**만 둔다 (CMP-16).
 * 탭이 있는 화면에서는 탭바 위 12dp, 그 밖(인증·모달·스캔)에서는 제스처바 위 16dp 에 뜬다.
 */
function AppToastHost() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const inTabs = segments[0] === '(tabs)';

  return <ToastHost bottomOffset={inTabs ? tabToastBottomOffset(insets.bottom) : undefined} />;
}

/**
 * 루트 스택 전환 정책 — Mobile UX Guide §8.
 *
 * MOT-01: push/pop 은 **네이티브 스택 기본값**이다. 커스텀 duration/easing 을 주면 iOS
 * 스와이프-백 제스처의 추종 곡선과 어긋나 손가락보다 화면이 늦게 따라온다 → `animation: 'default'`.
 * MOT-02(모달)는 화면 성격을 아는 쪽이 선언한다: `/chat`(presentation:'modal'),
 * `/viewer`(fullScreenModal + fade), `/doc/[type]/[id]`(slide_from_right)는 각 화면이 직접 걸고,
 * 루트에서는 화면 파일이 없는 **스택 라우트**(`/scan`)만 아래에서 지정한다.
 */
const ROOT_SCREEN_OPTIONS = {
  headerShown: false,
  animation: 'default',
} as const;

/**
 * 프로바이더 순서는 §13-5 정본이다.
 * `ThemeProvider` 는 `SafeAreaProvider` 안, `QueryClientProvider` 밖에 둔다 —
 * 스플래시를 내리기 전에 테마가 확정되어야 하고, 쿼리 캐시 복원보다 앞서야
 * 로딩 스켈레톤이 올바른 테마로 처음 그려진다.
 *
 * `SessionBootstrap` 은 React Query 를 쓰므로 `QueryClientProvider` **안**이어야 하고,
 * `ToastHost` 는 화면 위에 떠야 하므로 `Stack` **뒤**에 온다.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AppChrome />
            <SessionBootstrap />
            <Stack screenOptions={ROOT_SCREEN_OPTIONS}>
              {/*
                MOT-02 — 스캔은 **전체화면 모달**이다 (Screen Specs SCR-09~13 라우트 행).
                `app/scan/_layout.tsx` 가 거는 `fullScreenModal` 은 스캔 스택 *내부* 전환에만 적용되고,
                탭 → `/scan` 진입은 이 루트 스택이 그린다. 여기에 선언이 없으면 카메라가 옆에서
                밀려 들어와(push) 모달로 보이지 않는다.
                선언하지 않은 나머지 라우트는 파일 시스템 그대로 남고 MOT-01 기본 전환을 쓴다.
              */}
              <Stack.Screen
                name="scan"
                options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
              />
            </Stack>
            <AppToastHost />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
