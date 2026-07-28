// app/index.tsx — SCR-01 스플래시 / 세션 부트
//
// 이 화면의 유일한 임무는 **분기**다. 화면을 보여주는 것이 목적이 아니라, SecureStore 읽기가
// 비동기라서 "읽는 동안" 어딘가를 그려야 하기 때문에 존재한다 (Screen Specs SCR-01 모바일 변경점 1).
//
// 부트 시퀀스 (Screen Specs SCR-01 · Navigation Map §6-2)
//   1. Linking.getInitialURL() → OAuth 딥링크면 SCR-05 로 replace 하고 종료
//   2. authStore.bootstrap()   → SecureStore 토큰 로드 + 만료 선판정 + 캐시 프로필 선반영
//   3. 결과 분기: authenticated → (tabs) / anonymous → 온보딩 미완이면 (onboarding), 아니면 (auth)/login
//   4. 분기 직전에 SplashScreen.hideAsync() — 흰 화면 깜빡임 제거
//
// 폰트 로드(시퀀스 1단계)와 ToastHost 마운트는 루트 셸(app/_layout.tsx) 담당이라 여기서 하지 않는다.
//
// 실패 정책 (2026-07-28 확정): 부트가 6초 안에 끝나지 않으면 **앱을 멈추지 않는다.**
// 토스트로 알리고 로그인 화면으로 떨어뜨린다. `bootstrap()` 은 네트워크 실패를 로그아웃으로
// 해석하지 않으므로(authStore.refreshMe), 여기서 막히는 경우는 SecureStore 자체가 응답하지 않는
// 사실상의 장애 상황뿐이다.
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { MoraLogo } from '@/components/brand/MoraLogo';
import { toast } from '@/components/ui';
import { AUTH_COPY, parseOAuthDeepLink, useAuthBootstrap, type OAuthPayload } from '@/features/auth';
import { hasSeenOnboarding } from '@/features/onboarding/seen';
import { getTokenSync } from '@/services/session';
import { useTheme } from '@/theme/ThemeProvider';

// JS 첫 프레임 전에 네이티브 스플래시를 붙잡는다. 루트 셸이 이미 호출했더라도 중복은 무해하다.
void SplashScreen.preventAutoHideAsync().catch(() => {
  // 이미 자동으로 내려간 뒤라면 잡을 것이 없다. 부트 자체를 막을 이유는 없다.
});

/** 3초를 넘기면 "멈춘 게 아니다"라는 신호를 준다 (SCR-01 상태표: 3초 초과 시 dot 인디케이터). */
const SLOW_HINT_MS = 3_000;
/** SCR-01 인터랙션 표 — 6초 타임아웃. */
const BOOT_TIMEOUT_MS = 6_000;

type DeepLinkState = 'pending' | 'none' | 'oauth';

export default function BootGateScreen() {
  const router = useRouter();
  const t = useTheme();
  const status = useAuthBootstrap();

  const [deepLink, setDeepLink] = useState<DeepLinkState>('pending');
  const [oauthPayload, setOauthPayload] = useState<OAuthPayload | null>(null);
  const [slow, setSlow] = useState(false);

  // replace 는 단 한 번만. 이펙트가 재실행돼도 두 번 이동하지 않는다.
  const navigated = useRef(false);

  /** 분기 실행: 스플래시를 내리고 목적지로 replace 한다. 순서를 지켜야 흰 프레임이 안 생긴다. */
  const go = useCallback(
    (target: Parameters<typeof router.replace>[0]) => {
      if (navigated.current) return;
      navigated.current = true;
      router.replace(target);
      // replace 를 먼저 걸고 스플래시를 내린다 — 반대로 하면 부트 화면이 한 프레임 노출된다.
      void SplashScreen.hideAsync().catch(() => {});
    },
    [router],
  );

  // ── 시퀀스 1: 콜드 스타트 딥링크 ────────────────────────────────────────
  // OAuth 복귀로 앱이 시작된 경우다. token 은 여기서 절대 로그에 남기지 않는다 (Auth.md §3-2).
  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const url = await Linking.getInitialURL();
        const payload = url ? parseOAuthDeepLink(url) : null;
        if (!alive) return;
        if (payload) {
          setOauthPayload(payload);
          setDeepLink('oauth');
          return;
        }
        setDeepLink('none');
      } catch {
        // 딥링크를 못 읽는 것은 정상 부팅을 막을 사유가 아니다.
        if (alive) setDeepLink('none');
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // ── 지연 인디케이터 + 부트 타임아웃 ────────────────────────────────────
  useEffect(() => {
    const slowTimer = setTimeout(() => {
      setSlow(true);
      // 인디케이터를 보여주려면 네이티브 스플래시를 내려야 한다. 레이아웃이 동일해 시각 변화는 dot 뿐이다.
      void SplashScreen.hideAsync().catch(() => {});
    }, SLOW_HINT_MS);

    const failTimer = setTimeout(() => {
      if (navigated.current) return;

      // 부트 검증이 6초 안에 안 끝났다. 서버가 느린 것이지 세션이 무효라는 뜻이 아니다.
      //
      // 저장된 토큰이 있으면 **낙관적으로 탭으로 보낸다.** 서버가 Cloud Run 이라
      // 인스턴스가 잠들어 있으면 `GET /auth/me` 가 콜드스타트 때문에 6초를 쉽게 넘긴다
      // ([[Risks]] RSK-43). 여기서 로그인 화면으로 보내면 **유효한 세션을 가진 사용자가
      // 서버가 잠들 때마다 매번 튕긴다.**
      //
      // 토큰이 실제로 만료·위조라면 첫 API 호출에서 401 이 오고, `http.ts` 의 전역 401
      // 처리가 세션을 정리하며 로그인 화면으로 보낸다. 판정 권한은 그쪽 한 곳에만 둔다.
      if (getTokenSync()) {
        toast.error(AUTH_COPY.serverSlow);
        go('/(tabs)');
        return;
      }

      toast.error(AUTH_COPY.serverUnreachable);
      go('/(auth)/login');
    }, BOOT_TIMEOUT_MS);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(failTimer);
    };
  }, [go]);

  // ── 시퀀스 2·3: 세션 판정 후 분기 ──────────────────────────────────────
  useEffect(() => {
    if (navigated.current) return;
    if (deepLink === 'pending') return; // 딥링크 판정이 항상 먼저다

    if (deepLink === 'oauth' && oauthPayload) {
      go({
        pathname: '/(auth)/callback',
        params: {
          token: oauthPayload.token,
          userId: oauthPayload.userId,
          email: oauthPayload.email,
          name: oauthPayload.name,
        },
      });
      return;
    }

    if (status === 'booting') return; // 아직 SecureStore 를 읽는 중이다

    if (status === 'authenticated') {
      go('/(tabs)');
      return;
    }

    go(hasSeenOnboarding() ? '/(auth)/login' : '/(onboarding)');
  }, [deepLink, go, oauthPayload, status]);

  // ── 화면 (네이티브 스플래시와 동일한 레이아웃) ─────────────────────────
  return (
    <View className="flex-1 items-center justify-center bg-bg-base px-screen">
      <MoraLogo variant="mark" size={96} accessibilityLabel="MORA" />
      {/* 워드마크 px = 24 × dim/36 이고 CMP-50 이 dim 을 24|36|64|96 으로 제한한다.
          와이어프레임의 32px 에 가장 가까운 값이 dim 36(=24px)이다. */}
      <MoraLogo variant="wordmark" size={36} style={{ marginTop: 12 }} />
      <Text className="mt-3 text-body-sm text-text-muted">명함 스캔 & 검색</Text>

      {slow ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={{ position: 'absolute', bottom: 96, alignItems: 'center' }}
          accessibilityLiveRegion="polite"
        >
          <View className="flex-row gap-1.5">
            {/* dot 색은 className 이 닿지 않는 Reanimated 형제 요소와 톤을 맞춰 useTheme 로 통일한다 */}
            <Dot color={t.text.disabled} />
            <Dot color={t.text.disabled} />
            <Dot color={t.text.disabled} />
          </View>
          <Text className="mt-2 text-caption text-text-disabled">로딩 중...</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Dot({ color }: { color: string }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />;
}
