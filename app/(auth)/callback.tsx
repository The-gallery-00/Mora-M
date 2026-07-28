// app/(auth)/callback.tsx — SCR-05 OAuth 콜백 브리지
//
// 사용자가 보는 시간은 1~2초다. 하는 일은 딥링크가 실어 온 토큰을 세션으로 승격시키는 것뿐이다.
//
// 이 화면이 필요한 경우는 **콜드 스타트 딥링크** 하나다. 앱이 살아 있는 상태의 소셜 로그인은
// `WebBrowser.openAuthSessionAsync` 가 반환값으로 URL 을 돌려주므로 SCR-03/04 안에서 끝난다
// (`useSocialLogin`). 그 경우 이 라우트는 아예 지나가지 않는다.
//
// 원본은 이 지점이 `text/html` + 인라인 `<script>` 로 `localStorage` 를 쓰는 브리지 문서였다.
// 앱에는 localStorage 도 opener 도 없으므로 **HTML 을 해석하지 않는다.** 쿼리스트링만 회수한다
// (Screen Specs SCR-05 모바일 변경점).
//
// 보안 (Auth.md §3-2 · NFR-017): 토큰이 URL 쿼리로 온다. 회수 즉시 SecureStore 로 옮기고
// **어떤 로그에도 남기지 않는다.** 딥링크가 준 `userId/email/name` 은 신뢰하지 않고
// `GET /auth/me`(API-03) 응답으로 덮어쓴다 — 그 보정은 `authStore.acceptOAuthSession` 이 한다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoraLogo } from '@/components/brand/MoraLogo';
import { Button, toast } from '@/components/ui';
import {
  AUTH_COPY,
  isJwtLike,
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_LABEL,
  socialSuccessMessage,
  useAcceptOAuthSession,
  type SocialProvider,
} from '@/features/auth';
import { useHoldAuthRedirect } from '@/features/auth/authFlow';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

/** SCR-05 인터랙션 표 — 10초 타임아웃. */
const CALLBACK_TIMEOUT_MS = 10_000;

/** `useLocalSearchParams` 는 값이 string | string[] 다. 첫 값만 쓴다. */
function first(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

function toProvider(raw: string): SocialProvider | null {
  return SOCIAL_PROVIDERS.find((p) => p === raw) ?? null;
}

type Failure = { title: string; detail?: string };

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  // 제네릭을 붙이지 않는다 — 딥링크가 실어 오는 키는 서버가 정하므로 앱이 계약으로 고정할 수 없다.
  const params = useLocalSearchParams();

  const accept = useAcceptOAuthSession();
  const [failure, setFailure] = useState<Failure | null>(null);
  const started = useRef(false);
  const settled = useRef(false);

  // 토큰 저장 순간 세션이 서지만, 성공 토스트와 실패 복귀가 남아 있다 → 가드 리다이렉트를 붙잡는다.
  useHoldAuthRedirect(true);

  const fail = useCallback((next: Failure) => {
    if (settled.current) return;
    settled.current = true;
    haptics.error(); // HAP-04
    setFailure(next);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = first(params.token);
    // 형식조차 아니면 서버 왕복을 하지 않는다 — 조작된 딥링크를 그대로 저장하지 않는다(NFR-017).
    if (!isJwtLike(token)) {
      fail({ title: AUTH_COPY.socialNoParams });
      return;
    }

    // provider 는 딥링크에 없다(서버가 붙이지 않는다). 힌트가 없으면 google 로 두고,
    // 최종 표시는 `/auth/me` 가 확정한 `user.provider` 로 고친다.
    const hinted = toProvider(first(params.provider));
    const provider: SocialProvider = hinted ?? 'google';

    accept.mutate(
      {
        payload: {
          token,
          userId: first(params.userId),
          email: first(params.email),
          name: first(params.name),
        },
        provider,
      },
      {
        onSuccess: (user) => {
          if (settled.current) return;
          settled.current = true;
          const confirmed = toProvider(user.provider) ?? provider;
          // HAP-02 는 성공 토스트가 울린다 (ToastHost).
          toast.success(socialSuccessMessage(SOCIAL_PROVIDER_LABEL[confirmed]));
          router.replace('/(tabs)');
        },
        onError: (error) => {
          // 서버가 준 문장이 아니라 status 로 고른 문구다 (useAuth.authErrorMessage).
          fail({ title: error.message, detail: AUTH_COPY.socialFailedDetail });
        },
      },
    );
    // params 는 마운트 시점 값 하나만 쓴다. 재실행되면 같은 토큰으로 두 번 왕복한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 콜백이 오지 않는 상태로 방치되지 않게 하는 상한 (FR-027).
  useEffect(() => {
    const timer = setTimeout(() => {
      fail({ title: AUTH_COPY.socialFailed, detail: AUTH_COPY.socialFailedDetail });
    }, CALLBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fail]);

  return (
    <View
      className="flex-1 items-center justify-center bg-bg-base px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <MoraLogo variant="mark" size={64} accessibilityLabel="MORA" />

      {failure ? (
        // 에러 카드 — 원본 실패 HTML 의 문구를 그대로 옮겼다.
        <View className="mt-8 w-full items-center">
          <Text className="text-center text-h3 font-w700 text-text-primary">{failure.title}</Text>
          {failure.detail ? (
            <Text className="mt-2 text-center text-body-sm text-text-muted">{failure.detail}</Text>
          ) : null}
          <Button
            label="다시 시도"
            onPress={() => router.replace('/(auth)/login')}
            variant="primary"
            size="lg"
            fullWidth
            haptic="selection"
            style={{ marginTop: 24 }}
          />
        </View>
      ) : (
        <View className="mt-8 items-center" accessibilityLiveRegion="polite">
          {/* 스피너 색은 className 이 닿지 않는다 → useTheme (N-6) */}
          <ActivityIndicator size="large" color={t.action.base} />
          <Text className="mt-6 text-center text-base text-text-secondary">
            {AUTH_COPY.socialProgress}
          </Text>
          <Text className="mt-1 text-center text-body-sm text-text-muted">
            {AUTH_COPY.socialProgressSub}
          </Text>
        </View>
      )}
    </View>
  );
}
