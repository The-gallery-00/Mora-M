// src/components/ui/Skeleton.tsx
//
// CMP-13 Skeleton — Component Library §2 정본. 로딩 위계 2단계(스켈레톤)의 부품이다.
//
// MOT-11/MOT-22 — shimmer 는 translateX 1200ms linear 무한 반복.
// 색은 `skeleton.base` / `skeleton.highlight` 두 토큰이다: 다크에서 하이라이트를 흰색 상수로
// 두면 번쩍여서 로딩이 오히려 느리게 느껴진다(대비 1.21:1 유지 — §10-5).
// `react-native-skeleton-placeholder` 를 쓰지 않는 이유는 MaskedView 의존이 Android 에서 무겁다는 것(§5-2).
//
// 하이라이트 View 는 Reanimated 로 움직이므로 색을 className 이 아니라 useTheme() 으로 받는다(N-6).
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number; // default 8
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SHIMMER_DURATION = 1200; // motion.duration.shimmer
const HIGHLIGHT_RATIO = 0.6;

export function Skeleton({ width = '100%', height = 16, radius = 8, style, testID }: SkeletonProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const loop = useSharedValue(0);

  useEffect(() => {
    loop.value = 0;
    loop.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(loop);
  }, [loop]);

  const highlightWidth = boxWidth * HIGHLIGHT_RATIO;

  const shimmerStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      // transform 을 제거하고 opacity 만 쓴다(§8 전역 규칙 1)
      return {
        width: boxWidth,
        opacity: interpolate(loop.value, [0, 0.5, 1], [0, 0.6, 0]),
        transform: [{ translateX: 0 }],
      };
    }
    return {
      width: highlightWidth,
      // 하드 엣지를 감추기 위해 이동과 함께 opacity 를 램프한다(그라디언트 패키지 없이 같은 인상을 만든다)
      opacity: interpolate(loop.value, [0, 0.5, 1], [0, 0.9, 0]),
      transform: [{ translateX: interpolate(loop.value, [0, 1], [-highlightWidth, boxWidth]) }],
    };
  });

  return (
    <View
      testID={testID}
      onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
      className="overflow-hidden bg-skeleton"
      style={[{ width, height, borderRadius: radius }, style]}
      // 로딩 자리표시자는 스크린리더가 읽을 내용이 없다(A11Y-04)
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[{ height: '100%', backgroundColor: t.skeleton.highlight }, shimmerStyle]}
      />
    </View>
  );
}
