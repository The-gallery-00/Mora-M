// src/components/search/ChatBubble.tsx
//
// CMP-38 ChatBubble (+ TypingBubble) — Component Library §2 (1-G) 정본. SCR-24 말풍선.
// 원본 `ChatbotWidget.tsx` 의 형상(모서리·패딩·13/1.55·maxWidth 84%·고양이 귀 2개)을 그대로 옮겼다.
//
// ── 원본 HEX 2개를 토큰으로 바꾼 이유 (Component Library CMP-38 주석 그대로) ──────────
//  ① user 말풍선 `#1D4ED8` 은 Design Tokens §2 가 폐기한 두 번째 블루다 → 제출·확정 계열인 `brand`.
//  ② assistant 말풍선 `#FFFFFF` 를 리터럴로 두면 다크에서 대화창 절반이 흰 블록이 된다 → `bg.elevated`.
// 고양이 귀도 몸통과 같은 배경·보더 토큰을 **상속**해야 이어져 보인다.
//
// 귀 재현: 12×12 정사각을 45° 회전하고 왼쪽·위 보더만 그린다. 회전 후 위쪽으로 튀어나온 꼭짓점이
// 삼각형처럼 보이는 원본 CSS 트릭 그대로다. 말풍선 컨테이너가 `overflow: hidden` 이면 귀가 잘리므로
// 귀는 **말풍선 바깥 래퍼**에 absolute 로 얹는다.
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CHAT_COPY, type ChatRole } from '@/features/chat';
import { radius, spacing } from '@/theme/scale';

/** 말풍선 최대 폭 (원본 `maxWidth: '84%'`). */
const MAX_WIDTH = '84%' as const;
/** 귀 12×12, 좌우 18dp 안쪽 (원본 `left:18 / right:18`). */
const EAR_SIZE = 12;
const EAR_INSET = 18;

export interface ChatBubbleProps {
  role: ChatRole;
  text: string;
  /** default: `role === 'assistant'` — 모라냥 아이덴티티. */
  showEars?: boolean;
  /** 롱프레스 복사 (SCR-24 인터랙션 표). */
  onLongPress?: () => void;
  /** system(오류) 말풍선 하단의 `다시 시도` 칩. */
  onRetry?: () => void;
  testID?: string;
}

const EAR_STYLE = {
  top: 0,
  width: EAR_SIZE,
  height: EAR_SIZE,
  borderRadius: 2,
  transform: [{ rotate: '45deg' }],
} as const;

function CatEars() {
  return (
    // 장식이다 — 스크린리더가 읽을 내용이 없다(A11Y-04).
    // 래퍼를 컨테이너 최상단에 절대배치해야 귀가 말풍선 위(`paddingTop:6` 만큼)로 솟는다.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      className="absolute left-0 right-0 top-0"
    >
      <View
        className="absolute border-l border-t border-info-border bg-bg-elevated"
        style={[EAR_STYLE, { left: EAR_INSET }]}
      />
      <View
        className="absolute border-l border-t border-info-border bg-bg-elevated"
        style={[EAR_STYLE, { right: EAR_INSET }]}
      />
    </View>
  );
}

function ChatBubbleBase({
  role,
  text,
  showEars,
  onLongPress,
  onRetry,
  testID,
}: ChatBubbleProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const ears = showEars ?? role === 'assistant';

  /* 정렬 · 배경 · 보더 · 모서리 — CMP-38 스펙 표 그대로 */
  const align = isUser ? 'items-end' : isSystem ? 'items-center' : 'items-start';
  const box = isUser
    ? 'bg-brand'
    : isSystem
      ? 'border border-danger-border bg-danger-container'
      : 'border border-info-border bg-bg-elevated';
  const label = isUser
    ? 'text-text-inverse'
    : isSystem
      ? 'text-danger-strong'
      : 'text-text-primary';
  const corners = isUser
    ? { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomRightRadius: 4, borderBottomLeftRadius: 14 }
    : isSystem
      ? { borderRadius: radius.card }
      : { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomRightRadius: 14, borderBottomLeftRadius: 4 };

  return (
    <View testID={testID} className={`w-full ${align}`}>
      <View style={{ maxWidth: MAX_WIDTH, paddingTop: ears ? 6 : 0 }}>
        {ears ? <CatEars /> : null}

        <Pressable
          accessibilityRole="text"
          accessibilityLabel={text}
          onLongPress={onLongPress}
          disabled={onLongPress === undefined}
          className={box}
          style={({ pressed }) => [
            { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
            corners,
            pressed && onLongPress ? { opacity: 0.9 } : null,
          ]}
        >
          <Text className={`text-body-sm ${label}`} maxFontSizeMultiplier={1.4}>
            {text}
          </Text>

          {onRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={CHAT_COPY.retry}
              onPress={onRetry}
              // caption + py-1 = 26dp 뿐이라 44dp 하한에 못 미친다 (§11-1)
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="mt-2 self-end rounded-full border border-danger-border px-3 py-1"
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            >
              <Text className="text-caption font-w700 text-danger-strong" maxFontSizeMultiplier={1.2}>
                {CHAT_COPY.retry}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

export const ChatBubble = memo(ChatBubbleBase);
ChatBubble.displayName = 'ChatBubble';

/** 타이핑 인디케이터 — `답변 작성 중...` (원본 문구). assistant 말풍선과 같은 형상이다. */
export function TypingBubble({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="w-full items-start">
      <View
        className="border border-info-border bg-bg-elevated"
        style={{
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          borderBottomRightRadius: 14,
          borderBottomLeftRadius: 4,
        }}
        // 상태 변화는 라이브 리전으로 알린다(A11Y — 로딩 상태 낭독).
        accessibilityLiveRegion="polite"
      >
        <Text className="text-body-sm text-text-muted" maxFontSizeMultiplier={1.4}>
          {CHAT_COPY.typing}
        </Text>
      </View>
    </View>
  );
}
