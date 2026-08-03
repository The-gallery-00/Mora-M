// app/settings/danger.tsx — SCR-28 계정 · 데이터 삭제 (API-06 / API-62, FR-093 · FR-094)
//
// 원본은 `ConfirmModal` 두 개였다. 모바일에서는 **전용 화면 + 확인 시트**의 2단계다:
//   ① 화면의 위험 카드에서 무엇이 지워지는지 읽는다 → ② 시트에서 확인 문구/비밀번호를 입력한다
// 다이얼로그 하나로 끝내지 않는 이유는 이 화면의 두 액션이 **되돌릴 수 없기** 때문이다.
// 오탭 한 번에 문서가 전부 사라지면 안 된다.
//
// ⚠ 확인 문구(`전체삭제` / `탈퇴`)는 **서버 계약이 아니다.** `DeleteAccountRequest` 에는
//   `password` 필드 하나뿐이고 `DELETE /api/me/documents` 는 바디를 받지도 않는다.
//   순수하게 앱이 세운 방어벽이며 SCR-28 이 정한 UX 다 — 서버를 믿고 생략하면 안 된다.
//
// ⚠ 두 액션의 파급 범위가 다르다:
//   - 데이터 전체 삭제 → 계정은 남는다. 구글 캘린더 **연동 자체는 유지**되고 이벤트 매핑만 지워진다.
//   - 회원 탈퇴 → 계정이 사라진다. `useDeleteAccount` 가 SecureStore 파기 + 캐시 clear 까지 하고,
//     **화면 이동은 여기서** 한다(데이터 계층이 라우터를 알지 않는다는 규약).
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Button, TextField, toast } from '@/components/ui';
import {
  DANGER_ZONE_COPY,
  DELETE_ACCOUNT_CONFIRM_TEXT,
  DELETE_DOCUMENTS_CONFIRM_TEXT,
  deletedDocumentsMessage,
  matchesConfirmText,
  useDeleteAccount,
  useDeleteMyDocuments,
} from '@/features/account';
import { useAuth } from '@/features/auth';
import { ArchiveHeader } from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/** SCR-28 위험 카드 `⚠` — 48dp 원판 안에 들어간다. */
function WarningIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.8L21.2 19.5H2.8L12 3.8Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M12 10V14" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 16.8V16.9" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/* ── 위험 카드 ──────────────────────────────────────────────────────────────
   피그마 개정: 카드 채움(`bg#FEFAFA` = danger.container)을 걷어내고 `b#FECACA` = danger.border
   테두리만 남긴다. 위험 신호는 보더 + ⚠ 아이콘 + `text-danger` 제목 + danger 버튼이 함께 진다.
   (새 HEX 를 만들지 않는다 — DK-09.) */

function DangerCard({
  title,
  body,
  actionLabel,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();

  return (
    <View
      className="gap-3 rounded-card border border-danger-border p-4"
      testID={testID}
    >
      <View className="flex-row items-center gap-2">
        <WarningIcon color={t.danger.base} size={18} />
        <Text className="flex-1 text-input font-w700 text-danger" maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      </View>

      <Text className="text-body-sm text-text-secondary" maxFontSizeMultiplier={1.4}>
        {body}
      </Text>

      <Button
        label={actionLabel}
        onPress={onPress}
        variant="danger"
        size="md"
        fullWidth
        disabled={disabled ?? false}
        haptic="none" // Warning 햅틱은 시트를 여는 쪽에서 직접 준다 (SCR-28 인터랙션 표)
        testID={testID ? `${testID}-action` : undefined}
      />
    </View>
  );
}

/* ── 확인 시트 ─────────────────────────────────────────────────────────────
   `@gorhom/bottom-sheet` 를 쓰지 않고 RN `Modal` 로 만든 이유는 `app/groups.tsx` 와 같다:
   입력 하나짜리 시트에 제스처·스냅포인트가 필요 없고, Modal 쪽이 백버튼 처리(`onRequestClose`)를
   공짜로 준다. **삭제 진행 중에는 dismiss 를 막는다**(SCR-28 로딩 상태).

   ⚠ 그래서 `TextField` 에 `inSheet` 를 **주면 안 된다.** 그 플래그는 `BottomSheetTextInput` 으로
     갈아 끼우는데, 그 컴포넌트는 `useBottomSheetInternal()` 을 호출하고 BottomSheet 컨텍스트가
     없으면 그대로 throw 한다("cannot be used out of the BottomSheet!"). 여기는 RN Modal 이다. */

type SheetKind = 'documents' | 'account';

function ConfirmSheet({
  kind,
  visible,
  /** 로컬 계정이면 비밀번호, 소셜이면 확인 문구를 받는다. */
  requirePassword,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  kind: SheetKind;
  visible: boolean;
  requirePassword: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState('');

  /* 입력값 초기화는 이펙트가 아니라 **리마운트**로 한다 — 호출부가 `key={sheet ?? 'closed'}` 로
     시트를 갈아 끼우므로 닫히는 순간 이 컴포넌트가 통째로 버려지고 `input` 도 함께 사라진다.
     (비밀번호를 이펙트로 지우면 지우기 전 한 프레임이 남고, setState-in-effect 로 렌더가 한 번 더 돈다.)
     여기서는 열릴 때 포커스만 잡는다. Modal 이 화면에 올라온 뒤여야 키보드가 뜬다. */
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const isDocuments = kind === 'documents';
  const expected = isDocuments ? DELETE_DOCUMENTS_CONFIRM_TEXT : DELETE_ACCOUNT_CONFIRM_TEXT;

  // 로컬 계정 탈퇴만 서버가 검증한다(BCrypt). 나머지는 확인 문구가 유일한 방어선이다.
  const ready =
    !isDocuments && requirePassword ? input.trim().length > 0 : matchesConfirmText(input, expected);

  const title = isDocuments ? DANGER_ZONE_COPY.documentsSheetTitle : DANGER_ZONE_COPY.accountCardTitle;
  const body = isDocuments
    ? DANGER_ZONE_COPY.documentsCardBody
    : requirePassword
      ? DANGER_ZONE_COPY.accountLocalBody
      : DANGER_ZONE_COPY.accountSocialBody;
  const confirmLabel = isDocuments
    ? DANGER_ZONE_COPY.documentsAction
    : DANGER_ZONE_COPY.accountConfirmAction;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // 삭제가 도는 중에는 백버튼으로도 닫히지 않는다.
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: t.scrim }}
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={() => {
            if (!busy) onClose();
          }}
        >
          <Pressable
            className="gap-4 rounded-t-sheet bg-bg-elevated px-5 pt-4"
            style={{ paddingBottom: insets.bottom + spacing.lg }}
            onPress={() => undefined}
          >
            <View className="items-center">
              <View className="h-1 w-9 rounded-full bg-border-subtle" />
            </View>

            <View className="items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-danger-container">
                <WarningIcon color={t.danger.base} size={24} />
              </View>
              <Text
                className="text-center text-h3 font-w700 text-text-primary"
                accessibilityRole="header"
              >
                {title}
              </Text>
              <Text className="text-center text-body-sm text-text-secondary">{body}</Text>
            </View>

            {!isDocuments && requirePassword ? (
              <TextField
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                label="비밀번호"
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                {...(error ? { error } : {})}
                testID="danger-password"
              />
            ) : (
              <TextField
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                label={DANGER_ZONE_COPY.documentsConfirmLabel}
                placeholder={expected}
                hint={
                  isDocuments
                    ? DANGER_ZONE_COPY.documentsConfirmHint
                    : `계속하려면 "${expected}"를 정확히 입력하세요.`
                }
                autoCapitalize="none"
                {...(error ? { error } : {})}
                testID="danger-confirm-text"
              />
            )}

            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  label={DANGER_ZONE_COPY.cancel}
                  onPress={onClose}
                  variant="secondary"
                  size="md"
                  fullWidth
                  disabled={busy}
                />
              </View>
              <View className="flex-[2]">
                <Button
                  label={confirmLabel}
                  loadingLabel={DANGER_ZONE_COPY.submitting}
                  onPress={() => onSubmit(input)}
                  variant="danger"
                  size="md"
                  fullWidth
                  loading={busy}
                  disabled={!ready || busy}
                  haptic="none"
                  testID="danger-submit"
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── 화면 ──────────────────────────────────────────────────────────────────── */

export default function DangerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isSocialAccount } = useAuth();

  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const deleteDocuments = useDeleteMyDocuments();
  const deleteAccount = useDeleteAccount();

  const busy = deleteDocuments.isPending || deleteAccount.isPending;

  const openSheet = (kind: SheetKind) => {
    haptics.warning(); // G-6
    setSheetError(null);
    setSheet(kind);
  };

  const closeSheet = () => {
    if (busy) return;
    setSheet(null);
    setSheetError(null);
  };

  const submit = (input: string) => {
    setSheetError(null);

    if (sheet === 'documents') {
      deleteDocuments.mutate(undefined, {
        onSuccess: (result) => {
          // HAP-02 는 아래 성공 토스트가 울린다 (ToastHost).
          setSheet(null);
          toast.success(deletedDocumentsMessage(result.totalDocuments));
        },
        // 실패는 시트를 닫지 않는다 — 닫으면 무엇이 실패했는지 알 수 없다.
        onError: (error) => setSheetError(error.message),
      });
      return;
    }

    if (sheet !== 'account') return;

    deleteAccount.mutate(
      isSocialAccount ? { kind: 'social' } : { kind: 'local', password: input },
      {
        onSuccess: () => {
          setSheet(null);
          toast.success(DANGER_ZONE_COPY.accountSuccess);
          // 뮤테이션이 이미 SecureStore 파기 + 캐시 clear 를 마쳤다. 남은 것은 이동뿐이고,
          // 탈퇴한 계정 화면으로 되돌아갈 수 없게 `replace` 다 (Navigation Map §6-3 규칙 2).
          router.replace('/(auth)/login');
        },
        onError: (error) => {
          // 로컬 계정의 400 은 사실상 "비밀번호 불일치"다 — 그 상황에서 일반 실패 문구를 주면
          // 사용자가 무엇을 고쳐야 하는지 알 수 없다.
          const wrongPassword = !isSocialAccount && error.status === 400;
          setSheetError(wrongPassword ? DANGER_ZONE_COPY.passwordInvalid : error.message);
        },
      },
    );
  };

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title={DANGER_ZONE_COPY.screenTitle}
        onBack={() => router.back()}
        testID="danger-header"
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-2 mt-6 px-1 text-input font-w600 text-text-secondary">
          {DANGER_ZONE_COPY.documentsSection}
        </Text>
        <DangerCard
          title={DANGER_ZONE_COPY.documentsCardTitle}
          body={DANGER_ZONE_COPY.documentsCardBody}
          actionLabel={DANGER_ZONE_COPY.documentsAction}
          onPress={() => openSheet('documents')}
          disabled={busy}
          testID="danger-documents"
        />

        <Text className="mb-2 mt-8 px-1 text-input font-w600 text-text-secondary">
          {DANGER_ZONE_COPY.accountSection}
        </Text>
        <DangerCard
          title={DANGER_ZONE_COPY.accountCardTitle}
          body={DANGER_ZONE_COPY.accountCardBody}
          actionLabel={DANGER_ZONE_COPY.accountAction}
          onPress={() => openSheet('account')}
          disabled={busy}
          testID="danger-account"
        />

        {/* 어느 계정에 적용되는지 못 박아 둔다 — 계정을 바꿔 가며 쓰는 사용자가 남의 데이터를
            지우는 사고를 막는 마지막 안내다. */}
        {user?.email ? (
          <Text className="mt-6 px-1 text-caption text-text-muted">
            {`${user.email} 계정에 적용됩니다.`}
          </Text>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        // 시트를 열 때마다 입력값이 초기화되도록 종류가 바뀌면 리마운트한다.
        key={sheet ?? 'closed'}
        kind={sheet ?? 'documents'}
        visible={sheet !== null}
        requirePassword={!isSocialAccount}
        busy={busy}
        error={sheetError}
        onSubmit={submit}
        onClose={closeSheet}
      />
    </View>
  );
}
