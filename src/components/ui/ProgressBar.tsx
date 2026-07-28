// src/components/ui/ProgressBar.tsx
//
// CMP-23 ProgressBar — Component Library §2 정본. SCR-11 업로드/스캔 진행률용.
// determinate(0~1) + indeterminate(progress 미지정).
//
// MOT-16 — 값 변화당 200ms linear 보간, **되감기 금지**(값은 단조 증가).
// §14-4 — 채움 vs 트랙 대비 3:1. `action`/`brand`/`success` on `surface.alt` 가 이를 만족한다.
import { useEffect, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
import type { ThemeTokens } from '@/theme/tokens';

export type ProgressTone = 'point' | 'brand' | 'success';

export interface ProgressBarProps {
  /** 0~1. undefined 면 indeterminate(무한 슬라이드) */
  progress?: number;
  height?: 4 | 6 | 8; // default 6
  tone?: ProgressTone; // default 'point'
  showLabel?: boolean; // 우측에 '62%'
  /** 스크린리더용 진행 설명 (예: '이미지 업로드') */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * 채움색. `point` 는 Design Tokens §2 통합 후 `action` 토큰이다.
 * Reanimated 로 애니메이션하는 View 라 className 이 아니라 useTheme() 을 통과한다(N-6).
 */
const FILL: Record<ProgressTone, (t: ThemeTokens) => string> = {
  point: (t) => t.action.base,
  brand: (t) => t.brand.base,
  success: (t) => t.success.base,
};

const INDETERMINATE_RATIO = 0.35;

export function ProgressBar({
  progress,
  height = 6,
  tone = 'point',
  showLabel = false,
  accessibilityLabel,
  style,
  testID,
}: ProgressBarProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const determinate = progress !== undefined;
  const clamped = determinate ? Math.min(1, Math.max(0, progress)) : 0;

  const ratio = useSharedValue(clamped);
  const loop = useSharedValue(0);

  // determinate — 값 변화당 200ms linear (MOT-16)
  useEffect(() => {
    if (!determinate) return;
    ratio.value = withTiming(clamped, { duration: 200, easing: Easing.linear });
  }, [clamped, determinate, ratio]);

  // indeterminate — 1200ms linear 무한 슬라이드. Reduce Motion 이면 이동 없이 opacity 만 쓴다
  useEffect(() => {
    if (determinate) return;
    loop.value = 0;
    loop.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(loop);
  }, [determinate, loop]);

  // 폭을 % 문자열이 아니라 측정된 dp 로 계산한다 — 세 분기의 스타일 형태를 같게 유지해야
  // 워클릿 반환 타입이 흔들리지 않는다.
  const fillStyle = useAnimatedStyle(() => {
    if (determinate) {
      return { width: trackWidth * ratio.value, opacity: 1, transform: [{ translateX: 0 }] };
    }
    if (reduceMotion) {
      // 이동 대신 밝기 펄스 (§8 전역 규칙 1)
      return {
        width: trackWidth,
        opacity: interpolate(loop.value, [0, 0.5, 1], [0.45, 1, 0.45]),
        transform: [{ translateX: 0 }],
      };
    }
    const bar = trackWidth * INDETERMINATE_RATIO;
    return {
      width: bar,
      opacity: 1,
      transform: [{ translateX: interpolate(loop.value, [0, 1], [-bar, trackWidth]) }],
    };
  });

  const percent = Math.round(clamped * 100);

  return (
    <View className="w-full flex-row items-center gap-2" style={style} testID={testID}>
      <View
        className="flex-1 overflow-hidden rounded-full bg-surface-alt"
        style={{ height }}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={determinate ? { min: 0, max: 100, now: percent } : undefined}
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: 999, backgroundColor: FILL[tone](t) },
            fillStyle,
          ]}
        />
      </View>

      {showLabel && determinate ? (
        <Text className="text-label font-w600 text-text-muted" maxFontSizeMultiplier={1.2}>
          {`${percent}%`}
        </Text>
      ) : null}
    </View>
  );
}
