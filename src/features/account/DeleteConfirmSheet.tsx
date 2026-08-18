import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

import {
  DANGER_ZONE_COPY,
  DELETE_ACCOUNT_CONFIRM_TEXT,
  DELETE_DOCUMENTS_CONFIRM_TEXT,
  matchesConfirmText,
} from './schema';

export type DeleteConfirmKind = 'documents' | 'account';

/** SCR-28 위험 표시 아이콘. */
export function DeleteWarningIcon({ color, size = 22 }: { color: string; size?: number }) {
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

/**
 * 데이터 전체 삭제와 회원 탈퇴가 공유하는 확인 Bottom Sheet.
 * 로컬 계정 탈퇴만 비밀번호를 받고, 나머지는 지정된 확인 문구를 정확히 입력해야 한다.
 */
export function DeleteConfirmSheet({
  kind,
  visible,
  requirePassword,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  kind: DeleteConfirmKind;
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

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const isDocuments = kind === 'documents';
  const expected = isDocuments ? DELETE_DOCUMENTS_CONFIRM_TEXT : DELETE_ACCOUNT_CONFIRM_TEXT;
  const ready =
    !isDocuments && requirePassword ? input.trim().length > 0 : matchesConfirmText(input, expected);

  const title = isDocuments ? DANGER_ZONE_COPY.documentsSheetTitle : DANGER_ZONE_COPY.accountCardTitle;
  const body = isDocuments
    ? DANGER_ZONE_COPY.documentsSheetBody
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
                <DeleteWarningIcon color={t.danger.base} size={24} />
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
