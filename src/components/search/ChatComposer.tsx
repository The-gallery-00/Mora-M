// src/components/search/ChatComposer.tsx
//
// CMP-39 ChatComposer — Component Library §2 (1-G) 정본. SCR-24 하단 칩 레일 + 입력바.
//
// 원본 4열 grid(34dp) → **가로 스크롤 칩 레일**(좁은 폰에서 4열은 글자가 잘린다).
// 칩은 CMP-06 `tone="info"` 다 — 원본 챗봇 칩의 `#1E3A8A` 계열이 그 톤으로 토큰화되어 있다
// (보관함 필터칩의 `brand` 와 시각 위계를 일부러 다르게 둔 것이다).
//
// **전송 비활성 조건은 원본 그대로**: `!selectedType || value.trim() === '' || sending`.
// 판정 자체는 데이터 레이어의 `canSendChat()` 하나만 쓴다 — 화면·컴포넌트가 각자 다시 짜면 어긋난다.
//
// **`취소` 버튼**: API Contract §3-6 이 "타임아웃 60초 + 취소 버튼 필수"를 요구한다. 전송 중에는
// `전송` 이 어차피 비활성이므로 같은 자리를 `취소` 로 바꾼다 — 버튼을 하나 더 늘리면 입력폭이
// 좁아지고, 진행 중에만 의미 있는 액션이라 상시 노출할 이유가 없다.
import { ScrollView, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button, Chip } from '@/components/ui';
import { CHAT_COPY, canSendChat, chatPlaceholder, type ChatDocType } from '@/features/chat';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/features/documents';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, fontScale, radius, spacing } from '@/theme/scale';

const INPUT_HEIGHT = 44;

export interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** `null` 이면 전송 불가 + placeholder 가 `문서 유형을 먼저 선택하세요` 로 바뀐다 (FR-077). */
  selectedType: ChatDocType | null;
  onSelectType: (type: ChatDocType) => void;
  sending?: boolean;
  /** 진행 중 요청 취소 (§3-6). 주면 전송 중에 `취소` 버튼이 나온다. */
  onCancel?: () => void;
  /** 오프라인 — 입력바 전체를 잠근다 (SCR-24 상태표). */
  disabled?: boolean;
  testID?: string;
}

/* lucide-react-native 미설치(패키지 추가 금지) — lucide `send` 공식 path 를 그대로 그린다.
   `SearchBar.tsx` / `ChatFab.tsx` 와 같은 방식이다. */
function SendIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <Path d="m21.854 2.147-10.94 10.939" />
    </Svg>
  );
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  selectedType,
  onSelectType,
  sending = false,
  onCancel,
  disabled = false,
  testID,
}: ChatComposerProps) {
  const t = useTheme();
  const canSend = !disabled && canSendChat(selectedType, value, sending);
  const inputDisabled = disabled || sending;

  return (
    <View testID={testID}>
      {/* ── 문서유형 칩 레일 (h54, 상단 보더 info.border) ── */}
      <View className="border-t border-info-border bg-bg-elevated">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            gap: spacing.sm,
          }}
        >
          {DOCUMENT_TYPES.map((type) => (
            <Chip
              key={type}
              label={DOCUMENT_TYPE_LABELS[type]}
              tone="info"
              selected={selectedType === type}
              disabled={disabled}
              onPress={() => onSelectType(type)}
              accessibilityLabel={`${DOCUMENT_TYPE_LABELS[type]} 유형으로 질문`}
              testID={`chat-type-${type}`}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── 입력바 (상단 보더 border.subtle = 원본 #CBD5E1) ── */}
      <View
        className="flex-row items-center border-t border-border-subtle bg-bg-elevated"
        style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm }}
      >
        <View
          className={`flex-1 justify-center border border-border-subtle ${
            inputDisabled ? 'bg-surface-alt' : 'bg-surface'
          }`}
          style={{ height: INPUT_HEIGHT, borderRadius: radius.card, paddingHorizontal: spacing.md }}
        >
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={chatPlaceholder(selectedType)}
            placeholderTextColor={t.text.disabled}
            editable={!inputDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            // 키보드 전송도 같은 경로다. 비활성 조건은 `onSend` 를 부르는 화면이 아니라 여기서 막는다.
            onSubmitEditing={() => {
              if (canSend) onSend();
            }}
            accessibilityLabel={chatPlaceholder(selectedType)}
            selectionColor={t.action.base}
            style={{
              paddingVertical: 0,
              fontFamily: fontFamily.medium,
              fontSize: fontScale.input.size,
              lineHeight: fontScale.input.line,
              color: inputDisabled ? t.text.disabled : t.text.primary,
            }}
            testID="chat-input"
          />
        </View>

        {sending && onCancel ? (
          <Button
            // SCR-24 문구표에 취소 버튼 항목이 없다(원본에 취소가 없었기 때문). §3-6 이 요구하는
            // 버튼이므로 앱 전역에서 쓰는 중립 라벨 `취소` 를 그대로 쓴다.
            label="취소"
            onPress={onCancel}
            variant="secondary"
            size="md"
            haptic="selection"
            testID="chat-cancel"
          />
        ) : (
          <Button
            label={CHAT_COPY.send}
            // 아이콘 색은 SVG stroke 라 className 이 닿지 않는다 → useTheme (§3-0 N-6).
            // primary 는 disabled 에서도 라벨색이 text.inverse 고정이라 아이콘도 같은 색이다.
            leadingIcon={<SendIcon color={t.text.inverse} />}
            onPress={onSend}
            variant="primary"
            size="md"
            disabled={!canSend}
            testID="chat-send"
          />
        )}
      </View>
    </View>
  );
}
