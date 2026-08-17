// app/(auth)/signup.tsx — SCR-04 회원가입
//
// 원본: `frontend/app/signup/page.tsx` (`/login` 과 구조가 같고 카피·엔드포인트만 다르다).
// 레이아웃은 SCR-03 과 `AuthScreen` 을 공유하고 여기서는 카피와 검증만 분기한다.
//
// 화면이 두 단계다:
//   1) 가입 폼      — 이메일 / 비밀번호 / 비밀번호 확인 + 상시 정책 안내
//   2) 닉네임 단계  — FR-024. 가입 요청과 분리되어 있어 여기서 실패해도 가입은 롤백되지 않는다.
//
// 왜 닉네임을 가입 폼에 넣지 않았나: 서버 `SignupRequest` 에 `name` 필드가 아예 없어 무시된다
// (`AuthService.signup()` 이 `email.split("@")[0]` 로 자체 생성). 그래서 가입 성공 직후
// `PATCH /auth/me`(API-04) 로 따로 반영한다 — Screen Specs SCR-04 변경점 2.
//
// 비밀번호 8자 이상: 원본 가입 화면엔 규칙이 없었지만 서버의 비밀번호 **변경** 규칙이 8자 이상이라,
// 그보다 짧게 가입하면 나중에 변경 자체가 막힌다 → 앱이 선차단한다 (SCR-04 변경점 3).
// 확인 필드는 Auth.md §2-2 가 규칙·문구를 확정해 둔 `signupWithConfirmSchema` 를 쓴다.
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { MoraLogo } from '@/components/brand/MoraLogo';
import { Button, TextField, toast } from '@/components/ui';
import {
  AUTH_COPY,
  NICKNAME_HINT,
  SIGNUP_PASSWORD_HINT,
  SIGNUP_SUCCESS_MESSAGE,
  nicknameSchema,
  signupWithConfirmSchema,
  useSignup,
  useSocialLogin,
  useUpdateName,
  type AuthUser,
  type NicknameFormValues,
  type SignupWithConfirmFormValues,
  type SocialProvider,
} from '@/features/auth';
import { useHoldAuthRedirect } from '@/features/auth/authFlow';
import { haptics } from '@/lib/haptics';

export default function SignupScreen() {
  const router = useRouter();
  const signup = useSignup();
  const social = useSocialLogin();

  /** null 이면 가입 폼, 값이 있으면 닉네임 단계다. */
  const [signedUp, setSignedUp] = useState<AuthUser | null>(null);

  // 가입 성공 = 세션 성립이라 (auth) 가드가 즉시 (tabs) 로 튕긴다. 닉네임 단계 동안만 붙잡는다.
  useHoldAuthRedirect(signedUp !== null);
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupWithConfirmFormValues>({
    resolver: zodResolver(signupWithConfirmSchema),
    defaultValues: { email: '', password: '', passwordConfirm: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  /** 닉네임 단계 종료 → 홈. 저장 성공/건너뛰기 공통 출구. */
  const finish = useCallback(() => {
    // HAP-02 는 성공 토스트가 울린다 (ToastHost). 여기서 또 부르면 두 번 진동한다.
    toast.success(SIGNUP_SUCCESS_MESSAGE);
    router.replace('/(tabs)');
  }, [router]);

  /* ── 1단계: 가입 제출 ─────────────────────────────────────────────────── */

  const submit = handleSubmit(
    (values) => {
      Keyboard.dismiss();
      // 서버는 `name` 을 무시하므로 보내지 않는다 (SCR-04 데이터 표).
      signup.mutate(
        { email: values.email, password: values.password },
        {
          onSuccess: (user) => {
            setSignedUp(user);
          },
          onError: () => {
            haptics.error(); // HAP-04
          },
        },
      );
    },
    () => {
      haptics.warning(); // HAP-03
    },
  );

  const onSocialPress = useCallback(
    (provider: SocialProvider) => {
      setSocialBusy(provider);
      // 소셜은 로그인과 같은 엔드포인트다 — 서버가 신규/기존을 자동 판별한다 (SCR-04 인터랙션).
      social.mutate(provider, {
        onSettled: () => setSocialBusy(null),
        onSuccess: (result) => {
          switch (result.status) {
            case 'success':
              toast.success(result.message); // HAP-02 는 토스트가 울린다
              router.replace('/(tabs)');
              return;
            case 'canceled':
              return; // 취소는 에러가 아니다
            case 'unavailable':
              toast.info(result.message); // `준비 중입니다.`
              return;
            default:
              toast.error(result.message); // HAP-04 는 토스트가 울린다
          }
        },
      });
    },
    [router, social],
  );

  if (signedUp) {
    return <NicknameStep initialName={signedUp.name} onDone={finish} />;
  }

  return (
    <AuthScreen
      title="회원가입"
      submitLabel="가입하기"
      submitLoadingLabel={AUTH_COPY.submittingSignup}
      submitting={signup.isPending}
      onSubmit={submit}
      errorMessage={signup.error?.message}
      socialBusy={socialBusy}
      onSocialPress={onSocialPress}
      footerText="계정이 있으신가요?"
      footerLinkLabel="로그인"
      onFooterLinkPress={() => {
        haptics.selection();
        // replace 다 — push 면 로그인↔가입이 스택에 무한히 쌓인다 (SCR-04 인터랙션).
        router.replace('/(auth)/login');
      }}
      testID="screen-signup"
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
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                // 정책 안내는 상시 노출하고, 검증에 걸리면 같은 자리가 danger 로 바뀐다 (SCR-04 상태표).
                hint={SIGNUP_PASSWORD_HINT}
                error={errors.password?.message}
                testID="field-password"
              />
            )}
          />

          <Controller
            control={control}
            name="passwordConfirm"
            render={({ field }) => (
              <TextField
                ref={confirmRef}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onFocus={onFieldFocus}
                placeholder="비밀번호 확인"
                variant="auth"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={submit}
                error={errors.passwordConfirm?.message}
                testID="field-password-confirm"
              />
            )}
          />

          <View className="items-center">
            <Text className="text-center text-body-sm text-text-muted">
              가입하기 전에 이용약관과 개인정보 처리방침을 확인해 주세요.
            </Text>
            <View className="flex-row items-center justify-center gap-4">
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="이용약관 보기"
                onPress={() =>
                  router.push({
                    pathname: '/settings/legal/[doc]',
                    params: { doc: 'terms' },
                  })
                }
                hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                className="min-h-11 justify-center"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                testID="link-terms"
              >
                <Text className="text-body-sm font-w600 text-action underline">이용약관 보기</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="개인정보 처리방침 보기"
                onPress={() =>
                  router.push({
                    pathname: '/settings/legal/[doc]',
                    params: { doc: 'privacy' },
                  })
                }
                hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                className="min-h-11 justify-center"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                testID="link-privacy-policy"
              >
                <Text className="text-body-sm font-w600 text-action underline">
                  개인정보 처리방침 보기
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    />
  );
}

/* ── 2단계: 닉네임 (FR-024 · SCR-26 재사용) ─────────────────────────────
   `건너뛰기` 가 항상 가능해야 한다 — 여기서 막히면 가입은 이미 끝났는데 앱에 못 들어간다. */

function NicknameStep({ initialName, onDone }: { initialName: string; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const updateName = useUpdateName();

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<NicknameFormValues>({
    resolver: zodResolver(nicknameSchema),
    defaultValues: { name: initialName },
    mode: 'onChange',
  });

  const current = watch('name');
  // 서버가 만들어 준 이름 그대로면 왕복할 이유가 없다 (SCR-26: 미변경이면 저장 disabled).
  const unchanged = current.trim() === initialName.trim();

  // 백 = 건너뛰기. 가입은 이미 완료됐으므로 이전 폼으로 되돌리는 것은 의미가 없다.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onDone();
        return true;
      });
      return () => subscription.remove();
    }, [onDone]),
  );

  const save = handleSubmit((values) => {
    Keyboard.dismiss();
    updateName.mutate(values.name, {
      onSuccess: () => onDone(),
      onError: () => {
        haptics.error();
      },
    });
  });

  return (
    <View className="flex-1 bg-bg-base" style={{ paddingTop: insets.top }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <View className="items-center pb-6 pt-8">
            <MoraLogo variant="mark" size={64} accessibilityLabel="MORA" />
          </View>

          <Text className="text-center text-h1 font-w700 text-brand" accessibilityRole="header">
            닉네임 설정
          </Text>
          <Text className="mb-6 mt-2 text-center text-base text-text-muted">
            MORA에서 사용할 이름을 정해 주세요. 나중에 설정에서 바꿀 수 있어요.
          </Text>

          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label="닉네임"
                placeholder="닉네임"
                variant="auth"
                maxLength={20}
                clearable
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={save}
                hint={NICKNAME_HINT}
                error={errors.name?.message}
                testID="field-nickname"
              />
            )}
          />

          {updateName.error ? (
            <Text className="mt-4 text-center text-base text-danger" accessibilityLiveRegion="polite">
              {updateName.error.message}
            </Text>
          ) : null}

          <Button
            label="저장"
            loadingLabel="저장 중..."
            loading={updateName.isPending}
            disabled={!isValid || unchanged}
            onPress={save}
            variant="primary"
            size="lg"
            fullWidth
            style={{ marginTop: 24 }}
          />
          <Button
            label="건너뛰기"
            onPress={onDone}
            variant="ghost"
            size="lg"
            fullWidth
            haptic="selection"
            style={{ marginTop: 8 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
