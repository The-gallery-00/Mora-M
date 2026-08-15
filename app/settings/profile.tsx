// app/settings/profile.tsx — SCR-26 프로필 편집 (닉네임 변경, FR-091)
//
// 원본은 460dp 중앙 다이얼로그(`NicknameModal`)였다. 모바일에서는 전용 화면이다.
// **아바타 업로드는 없다** — 서버 엔드포인트가 없어 기기에만 남는 사진이 되기 때문이다
// (SCR-25 변경점 표 · `components/settings/Avatar.tsx` 상단 주석).
//
// 검증 규칙은 여기서 새로 쓰지 않는다. `nicknameSchema` 가 서버 `AuthService.changeName`
// (`trim()` 후 2~20자 + `^[a-zA-Z0-9가-힣_.\-]+$`)과 글자 단위로 맞춰져 있고 회원가입과 공유한다.
//
// 저장은 `useUpdateNickname`(= `features/auth` 의 `useUpdateName`)이다. 여기서 별도 뮤테이션을
// 만들면 `authStore` 의 SecureStore 스냅샷 갱신이 빠져 **재부팅 시 옛 닉네임이 뜬다**
// (`features/account/queries.ts` 상단 경고).
import { zodResolver } from '@hookform/resolvers/zod';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, SettingsRow, SettingsSection } from '@/components/settings';
import { TextField, toast } from '@/components/ui';
import {
  nicknameSchema,
  NAME_CHANGED_MESSAGE,
  NICKNAME_HINT,
  useProfile,
  useUpdateNickname,
  type NicknameFormValues,
} from '@/features/account';
import { useAuth } from '@/features/auth';
import { ArchiveHeader } from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { spacing } from '@/theme/scale';

/** SCR-26 상태표 원문. */
const COPY = {
  screenTitle: '프로필',
  save: '저장',
  nicknameLabel: '닉네임',
  emailLabel: '이메일',
  emailHint: '이메일은 변경할 수 없습니다.',
  providerLabel: '로그인 방식',
  joinedLabel: '가입일',
  saveFailed: '닉네임 변경에 실패했습니다.',
  leaveTitle: '변경 사항을 저장하지 않고 나갈까요?',
  leaveBody: '입력한 내용이 사라집니다.',
  leaveConfirm: '나가기',
  cancel: '취소',
} as const;

/** 서버 `provider` 값을 화면 문구로. `local` 은 이메일 가입이다. */
const PROVIDER_LABEL: Record<string, string> = {
  local: '이메일',
  google: 'Google',
  kakao: '카카오',
  naver: '네이버',
};

/** `2026. 7. 1.` — SCR-26 와이어프레임 표기. 서버 `createdAt` 은 ISO 문자열이다(실측). */
function formatDate(iso: string | undefined): string {
  if (!iso) return '가입일 정보 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '가입일 정보 없음';
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // 캐시된 세션 사용자로 즉시 그리고(빈 화면 금지), `useProfile()` 이 최신값으로 덮는다.
  const { user } = useAuth();
  const profile = useProfile();
  const me = profile.data ?? user;

  const update = useUpdateNickname();

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<NicknameFormValues>({
    resolver: zodResolver(nicknameSchema),
    defaultValues: { name: me?.name ?? '' },
    /* `defaultValues` 만으로는 부족하다 — 이 화면은 인증 가드가 없는 루트 스택에 있어서
       `mora://settings/profile` 콜드 스타트 시 세션 복원 **전에** 마운트될 수 있고, 그러면 폼이
       빈 문자열로 굳는다. `values` 로 프로필이 늦게 도착해도 프리필이 따라오게 하고,
       `keepDirtyValues` 로 그 사이에 사용자가 입력한 값은 덮지 않는다. */
    values: { name: me?.name ?? '' },
    resetOptions: { keepDirtyValues: true },
    mode: 'onChange', // SCR-26 인터랙션 표: 입력할 때마다 실시간 검증 + 저장 버튼 활성/비활성
  });

  // `watch()` 가 아니라 `useWatch()` 다 — `watch` 는 렌더마다 새 함수를 돌려줘 React Compiler 가
  // 이 컴포넌트의 메모이제이션을 통째로 포기한다(eslint `react-hooks/incompatible-library`).
  const current = useWatch({ control, name: 'name' });
  const parsed = nicknameSchema.safeParse({ name: current });
  // 원래 이름과 같으면 저장할 것이 없다 — 서버 왕복을 만들지 않는다.
  const changed = isDirty && current.trim() !== (me?.name ?? '').trim();
  const canSave = changed && parsed.success && !update.isPending;

  /* ── 이탈 확인 (SCR-26: dirty 면 확인) ─────────────────────────────────── */

  const leave = useCallback(() => {
    if (!changed) {
      router.back();
      return;
    }
    Alert.alert(COPY.leaveTitle, COPY.leaveBody, [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.leaveConfirm, style: 'destructive', onPress: () => router.back() },
    ]);
  }, [changed, router]);

  // 하드웨어 백도 같은 판정을 거쳐야 한다 — 헤더 `‹` 만 막으면 안드로이드에서 그냥 빠져나간다.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!changed) return false; // 기본 pop 에 넘긴다
        leave();
        return true;
      });
      return () => subscription.remove();
    }, [changed, leave]),
  );

  /* ── 저장 ──────────────────────────────────────────────────────────────── */

  const submit = handleSubmit(
    (values) => {
      Keyboard.dismiss();
      update.mutate(values.name.trim(), {
        onSuccess: () => {
          // HAP-02 는 아래 성공 토스트가 울린다 (ToastHost). 여기서 또 부르면 두 번 진동한다.
          toast.success(NAME_CHANGED_MESSAGE);
          router.back();
        },
        onError: (error) => {
          // HAP-04 는 아래 에러 토스트가 울린다.
          // `AuthError.message` 는 이미 완성된 화면 문구다(서버 문장을 쓰지 않는다).
          toast.error(error.message || COPY.saveFailed);
        },
      });
    },
    () => haptics.warning(), // HAP-03
  );

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title={COPY.screenTitle}
        onBack={leave}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.save}
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={submit}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            className="px-3 py-2"
            testID="profile-save"
          >
            <Text
              className={`text-button font-w700 ${canSave ? 'text-action' : 'text-text-disabled'}`}
              maxFontSizeMultiplier={1.3}
            >
              {update.isPending ? '저장 중...' : COPY.save}
            </Text>
          </Pressable>
        }
        testID="profile-header"
      />

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
          <View className="items-center py-6">
            <Avatar name={me?.name} {...(me?.picture ? { uri: me.picture } : {})} size={80} />
          </View>

          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={COPY.nicknameLabel}
                maxLength={20}
                clearable
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={submit}
                hint={NICKNAME_HINT}
                {...(errors.name?.message ? { error: errors.name.message } : {})}
                testID="field-nickname"
              />
            )}
          />

          {/* 이메일은 서버에 변경 흐름이 없다(원본 주석: `Email is read-only until /me/email
              verification flow exists on backend`). 값만 보여 주며 탭 동작은 제공하지 않는다. */}
          <View pointerEvents="none" className="mt-5">
            <TextField
              value={me?.email ?? ''}
              onChangeText={() => undefined}
              label={COPY.emailLabel}
              hint={COPY.emailHint}
              disabled
              testID="field-email"
            />
          </View>

          <SettingsSection>
            <SettingsRow
              label={COPY.providerLabel}
              value={PROVIDER_LABEL[me?.provider ?? 'local'] ?? '이메일'}
              testID="row-provider"
            />
            <SettingsRow
              label={COPY.joinedLabel}
              value={formatDate(me?.createdAt)}
              testID="row-joined"
            />
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
