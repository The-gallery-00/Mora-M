// app/settings/password.tsx — SCR-27 비밀번호 변경 (API-05, FR-092)
//
// 원본 `PasswordModal` → 전용 화면. 원본에 **없던** 것 두 가지를 여기서 처리한다:
//   1. 서버 **429**(`PasswordChangeRateLimiter`, IP+토큰당 분당 5회). 실측으로 확인했다 —
//      틀린 현재 비밀번호로 5회 시도하면 6회째부터 429 다. rate limit 이 인증보다 **먼저** 돌기
//      때문에 실패한 시도도 버킷을 소모한다.
//   2. 소셜 계정 진입 차단. 서버도 400 으로 막지만, 왕복해서 실패 문구를 보는 것보다
//      화면에서 이유를 먼저 말해 주는 편이 낫다.
//
// 429 를 400 과 같은 실패로 뭉뚱그리지 않는 이유는 SCR-27 상태표가 **버튼 60초 비활성**이라는
// 다른 UI 를 요구하기 때문이다. `useChangePassword()` 가 잠금 타이머를 들고 있고
// **throw 하지 않는다** — 결과 유니온을 그대로 돌려준다.
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { Button, TextField, toast } from '@/components/ui';
import {
  changePasswordFormSchema,
  PASSWORD_FORM_COPY,
  useChangePassword,
  type ChangePasswordFormSchemaValues,
} from '@/features/account';
import { useAuth } from '@/features/auth';
import { ArchiveHeader } from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

const COPY = {
  screenTitle: '비밀번호 변경',
  leaveTitle: '변경을 취소할까요?',
  leaveBody: '입력한 내용이 사라집니다.',
  leaveConfirm: '나가기',
  cancel: '취소',
  back: '돌아가기',
} as const;

/** SCR-27 와이어프레임 상단 `🔒 44dp #DBEAFE` — info.border 가 그 색이다. */
function LockIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={10} width={16} height={10} rx={2} stroke={color} strokeWidth={1.8} />
      <Path
        d="M8 10V7.5A4 4 0 0 1 16 7.5V10"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function PasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { isSocialAccount } = useAuth();

  const newRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const change = useChangePassword();

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty, isValid },
    reset,
  } = useForm<ChangePasswordFormSchemaValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordConfirm: '' },
    mode: 'onChange', // SCR-27: 3필드가 모두 채워지고 검증을 통과해야 `변경` 이 켜진다
  });

  /* ── 이탈 확인 ─────────────────────────────────────────────────────────── */

  const leave = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert(COPY.leaveTitle, COPY.leaveBody, [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.leaveConfirm, style: 'destructive', onPress: () => router.back() },
    ]);
  }, [isDirty, router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!isDirty) return false;
        leave();
        return true;
      });
      return () => subscription.remove();
    }, [isDirty, leave]),
  );

  /* ── 제출 ──────────────────────────────────────────────────────────────── */

  const submit = handleSubmit(
    (values) => {
      Keyboard.dismiss();
      void (async () => {
        const result = await change.submit({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });

        if (result.ok) {
          // HAP-02 는 아래 성공 토스트가 울린다 (ToastHost). 여기서 또 부르면 두 번 진동한다.
          // 서버는 토큰을 무효화하지 않는다(발급된 JWT 는 만료까지 유효 — Auth.md §4-5).
          // 그래서 재로그인 없이 그대로 되돌아간다.
          reset();
          toast.success(PASSWORD_FORM_COPY.success);
          router.back();
          return;
        }

        haptics.error(); // HAP-04
        // 문구는 화면 하단 캡션이 이미 보여 준다(`change.errorMessage`) → 토스트로 중복하지 않는다.
      })();
    },
    () => haptics.warning(), // HAP-03
  );

  /* ── 소셜 계정 차단 ─────────────────────────────────────────────────────
     SCR-25 가 행 자체를 막지만, 딥링크로 직접 들어올 수 있으므로 화면에서도 방어한다. */

  if (isSocialAccount) {
    return (
      <View className="flex-1 bg-bg-base">
        <ArchiveHeader title={COPY.screenTitle} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-5 px-8">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-info-container">
            <LockIcon color={t.info.base} />
          </View>
          <Text className="text-center text-base text-text-secondary">
            {PASSWORD_FORM_COPY.socialBlocked}
          </Text>
          <Button label={COPY.back} onPress={() => router.back()} variant="secondary" size="md" />
        </View>
      </View>
    );
  }

  const retrySeconds = Math.ceil(change.retryAfterMs / 1000);
  const submitDisabled = !isValid || change.isPending || change.isRateLimited;

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader title={COPY.screenTitle} onBack={leave} testID="password-header" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.xxxl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center gap-3 py-6">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-info-container">
              <LockIcon color={t.info.base} />
            </View>
            <Text className="text-center text-body-sm text-text-secondary">
              {PASSWORD_FORM_COPY.description}
            </Text>
          </View>

          <Controller
            control={control}
            name="currentPassword"
            render={({ field }) => (
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={PASSWORD_FORM_COPY.currentLabel}
                placeholder={PASSWORD_FORM_COPY.currentPlaceholder}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="next"
                onSubmitEditing={() => newRef.current?.focus()}
                {...(errors.currentPassword?.message
                  ? { error: errors.currentPassword.message }
                  : {})}
                testID="field-current-password"
              />
            )}
          />

          <View className="h-5" />

          <Controller
            control={control}
            name="newPassword"
            render={({ field }) => (
              <TextField
                ref={newRef}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={PASSWORD_FORM_COPY.newLabel}
                placeholder={PASSWORD_FORM_COPY.newPlaceholder}
                hint={PASSWORD_FORM_COPY.newHint}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                {...(errors.newPassword?.message ? { error: errors.newPassword.message } : {})}
                testID="field-new-password"
              />
            )}
          />

          <View className="h-5" />

          <Controller
            control={control}
            name="newPasswordConfirm"
            render={({ field }) => (
              <TextField
                ref={confirmRef}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={PASSWORD_FORM_COPY.confirmLabel}
                placeholder={PASSWORD_FORM_COPY.confirmPlaceholder}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={submit}
                {...(errors.newPasswordConfirm?.message
                  ? { error: errors.newPasswordConfirm.message }
                  : {})}
                testID="field-confirm-password"
              />
            )}
          />

          {/* 서버 실패 캡션. 429 는 남은 시간을 함께 보여 준다 — 그냥 비활성이면 고장으로 보인다. */}
          {change.errorMessage ? (
            <Text
              className="mt-4 text-center text-caption text-danger"
              // 429 잠금·비밀번호 불일치는 화면 이동 없이 이 캡션에만 나타난다 → 즉시 읽혀야 한다.
              accessibilityLiveRegion="polite"
              testID="password-error"
            >
              {change.isRateLimited
                ? `${change.errorMessage} (${retrySeconds}초 후 다시 시도)`
                : change.errorMessage}
            </Text>
          ) : null}

          <Button
            label={PASSWORD_FORM_COPY.submit}
            loadingLabel={PASSWORD_FORM_COPY.submitting}
            onPress={submit}
            loading={change.isPending}
            disabled={submitDisabled}
            size="lg"
            fullWidth
            style={{ marginTop: spacing.xxl }}
            testID="password-submit"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
