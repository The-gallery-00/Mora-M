// app/(auth)/login.tsx — SCR-03 로그인
//
// 원본: `frontend/app/login/page.tsx` + `components/shared/AuthForm.tsx`.
// 레이아웃·소셜 버튼은 `AuthScreen` 이 소유하고, 이 파일은 **폼 상태와 결과 처리**만 맡는다.
//
// 검증은 zod(`loginSchema`) 가 한다. 원본에는 클라이언트 검증이 없었고 `required` 속성뿐이었는데
// RN 에는 그 개념이 없다 → SCR-03 상태표의 신규 문구를 스키마가 그대로 들고 있다.
//
// 실패 문구는 **서버 `error` 문자열을 쓰지 않는다.** `useLogin()` 이 HTTP status + 작업 종류로
// AUTH_COPY 를 골라 `AuthError.message` 에 담아 준다 (API Contract §4-5).
//
// 401 분기는 이 파일에 없다. 세션 만료 처리는 `services/http.ts` 한 곳뿐이다 (2026-07-28 확정).
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { BackHandler, Keyboard, type TextInput } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { TextField, toast } from '@/components/ui';
import {
  AUTH_COPY,
  loginSchema,
  useLogin,
  useSocialLogin,
  type LoginFormValues,
  type SocialProvider,
} from '@/features/auth';
import { haptics } from '@/lib/haptics';

/** 이중 백 종료 판정 간격 (Mobile UX Guide §4). */
const EXIT_WINDOW_MS = 2_000;

export default function LoginScreen() {
  const router = useRouter();
  const login = useLogin();
  const social = useSocialLogin();

  const passwordRef = useRef<TextInput>(null);
  const lastBackAt = useRef(0);
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    // 제출 시 1회 검증 → 이후에는 입력할 때마다 즉시 해제된다(타이핑 중 빨간 보더가 계속 뜨지 않게).
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  /* ── 제출 ─────────────────────────────────────────────────────────────── */

  const submit = handleSubmit(
    (values) => {
      Keyboard.dismiss(); // §5 규칙 6: 제출 시 키보드부터 닫는다
      login.mutate(values, {
        onSuccess: () => {
          // 성공 피드백은 즉시 전환 자체다 (SCR-03 상태표: 토스트 없음).
          router.replace('/(tabs)');
        },
        onError: () => {
          haptics.error(); // HAP-04
        },
      });
    },
    () => {
      // 클라이언트 검증 실패 — 필드 보더/흔들림은 TextField 가 처리한다.
      haptics.warning(); // HAP-03
    },
  );

  /* ── 소셜 로그인 ──────────────────────────────────────────────────────── */

  const onSocialPress = useCallback(
    (provider: SocialProvider) => {
      setSocialBusy(provider);
      social.mutate(provider, {
        onSettled: () => setSocialBusy(null),
        onSuccess: (result) => {
          switch (result.status) {
            case 'success':
              toast.success(result.message); // HAP-02 는 토스트가 울린다
              router.replace('/(tabs)');
              return;
            case 'canceled':
              // 취소는 에러가 아니다 → 무음 복귀 (SCR-05 상태표).
              return;
            case 'unavailable':
              // 서버 착지 주소가 앱 스킴이 아닐 때의 폴백 문구 (`준비 중입니다.`).
              toast.info(result.message);
              return;
            default:
              toast.error(result.message); // HAP-04 는 토스트가 울린다
          }
        },
      });
    },
    [router, social],
  );

  /* ── 하드웨어 백: 앱 종료 확인 (Mobile UX Guide §4) ───────────────────── */

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        // 회원가입에서 push 로 들어온 경우는 평범한 pop 이다.
        if (router.canGoBack()) return false;

        const now = Date.now();
        if (now - lastBackAt.current < EXIT_WINDOW_MS) {
          BackHandler.exitApp();
          return true;
        }
        lastBackAt.current = now;
        toast.info('한 번 더 누르면 종료됩니다', { haptic: false });
        return true;
      });

      return () => subscription.remove();
    }, [router]),
  );

  /* ── 렌더 ─────────────────────────────────────────────────────────────── */

  return (
    <AuthScreen
      title="로그인"
      submitLabel="로그인"
      submitLoadingLabel={AUTH_COPY.submittingLogin}
      submitting={login.isPending}
      onSubmit={submit}
      errorMessage={login.error?.message}
      socialBusy={socialBusy}
      onSocialPress={onSocialPress}
      footerText="계정이 없으신가요?"
      footerLinkLabel="회원가입"
      onFooterLinkPress={() => {
        haptics.selection(); // HAP-01
        router.push('/(auth)/signup');
      }}
      testID="screen-login"
      renderFields={({ onFieldFocus }) => (
        <>
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onFocus={onFieldFocus}
                placeholder="이메일"
                variant="auth"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                error={errors.email?.message}
                testID="field-email"
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <TextField
                ref={passwordRef}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onFocus={onFieldFocus}
                placeholder="비밀번호"
                variant="auth"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={submit}
                error={errors.password?.message}
                testID="field-password"
              />
            )}
          />
        </>
      )}
    />
  );
}
