// src/components/search/ChatFab.tsx
//
// CMP-22 ChatFab — Component Library §2 (1-C) 정본. SCR-24(챗봇) 진입 버튼.
// `absolute` / `right: 16` / `bottom: 탭바 + 16`, elevation `sheet`(원본 drop-shadow 대체).
//
// **아이콘이 이미지가 아닌 이유**: 정본은 `chatbot_logo` 를 PNG 3배수로 재추출해 쓰라고 하지만
// (원본 svg 는 540KB base64 PNG 래퍼다) `assets/images/` 에 아직 그 에셋이 없다. 에셋이 없는
// 상태에서 `require()` 를 적으면 번들이 깨지므로, 다른 아이콘들과 같은 방식으로
// react-native-svg 로 **모라냥 실루엣(말풍선 + 고양이 귀)** 을 그려 둔다.
// 에셋이 들어오면 이 파일의 `<CatChatIcon/>` 만 `<Image/>` 로 교체하면 된다.
// (정본 주의사항: 그 PNG 는 컬러 래스터라 **반전·틴트 금지**다.)
import { Pressable } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

const SIZE = 56;
const SIZE_COLLAPSED = 48;

export interface ChatFabProps {
  onPress: () => void;
  /** 스크롤 다운 시 축소 (56 → 48dp). */
  collapsed?: boolean;
  /** 키보드 표시 중 등. true 면 렌더 자체를 하지 않는다. */
  hidden?: boolean;
  /** 화면 하단에서 띄울 거리(dp). 탭 화면은 `tabBarHeight + insets.bottom + 16` 을 넘긴다. */
  bottom: number;
  testID?: string;
}

/** 말풍선 + 고양이 귀 — AI 모라냥 실루엣. */
function CatChatIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 귀 2개 */}
      <Path
        d="M6.2 6.6L5.2 3.2L8.4 4.8M17.8 6.6L18.8 3.2L15.6 4.8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 말풍선 몸통 + 꼬리 */}
      <Path
        d="M4 11.2A5.2 5.2 0 0 1 9.2 6h5.6A5.2 5.2 0 0 1 20 11.2v2.6a5.2 5.2 0 0 1-5.2 5.2H10l-3.6 2.6v-3.1A5.2 5.2 0 0 1 4 13.8v-2.6Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {/* 눈 2개 */}
      <Circle cx={9.8} cy={12.4} r={1.1} fill={color} />
      <Circle cx={14.2} cy={12.4} r={1.1} fill={color} />
    </Svg>
  );
}

export function ChatFab({ onPress, collapsed = false, hidden = false, bottom, testID }: ChatFabProps) {
  const t = useTheme();
  const dim = collapsed ? SIZE_COLLAPSED : SIZE;

  if (hidden) return null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      // 아이콘만 있으므로 라벨 필수 (A11Y-01). 원본 툴팁 문구가 없어 화면 이름을 그대로 쓴다.
      accessibilityLabel="AI 모라냥"
      onPress={() => {
        haptics.impact('medium'); // SCR-06 FAB 탭
        onPress();
      }}
      className="absolute items-center justify-center rounded-full"
      style={({ pressed }) => [
        // elevation 은 backgroundColor 를 함께 들고 온다 → 뒤에서 덮어쓴다 (Design Tokens §10-6 규칙 1).
        t.elevation.sheet,
        {
          right: 16,
          bottom,
          width: dim,
          height: dim,
          backgroundColor: t.brand.base,
        },
        pressed ? { transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      <CatChatIcon color={t.text.inverse} size={collapsed ? 24 : 28} />
    </Pressable>
  );
}
