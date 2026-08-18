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

export default function OAuthCallbackBridge() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
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
