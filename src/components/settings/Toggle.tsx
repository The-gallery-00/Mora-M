// src/components/settings/Toggle.tsx
//
// CMP-11 Toggle — Component Library §2 정본. 원본 `settings/page.tsx` 의 `Toggle` 이식이다.
// 규격을 원본 그대로 보존한다: 트랙 40×22, 노브 16, 노브 left `value ? 21 : 3`, 전환 150ms.
//
// **RN `Switch` 를 쓰지 않는 이유** — 안드로이드 네이티브 스위치는 크기가 OS 버전마다 다르고
// (Material You 에서 52×32 로 커졌다) `trackColor` 에 알파가 자동으로 섞여 토큰 색이 그대로
// 나오지 않는다. 설정 화면 행 높이(h56/h64)가 기기마다 달라지는 것을 막으려면 직접 그려야 한다.
//
// 색 전환은 `interpolateColor` 로 함께 보간한다. 위치만 움직이고 색을 즉시 바꾸면 150ms 동안
// "이미 켜진 트랙 위를 노브가 뒤늦게 따라가는" 어긋난 모션이 된다.
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** 원본 `calendarBusy` — 왕복이 끝날 때까지 중복 탭을 막고 노브에 스피너를 띄운다. */
  busy?: boolean;
  /** HAP-01 — default true (selection). */
  haptic?: boolean;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/* 원본 수치 보존 (§2 CMP-11). */
const TRACK_W = 40;
const TRACK_H = 22;
const KNOB = 16;
const KNOB_OFF = 3;
const KNOB_ON = TRACK_W - KNOB - KNOB_OFF; // 21
const DURATION = 150;

export function Toggle({
  value,
  onValueChange,
  disabled = false,
  busy = false,
  haptic = true,
  accessibilityLabel,
  style,
  testID,
}: ToggleProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration: reduceMotion ? 0 : DURATION,
      easing: Easing.bezier(0.2, 0, 0, 1), // motion.easing.standard
    });
  }, [progress, reduceMotion, value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [t.border.subtle, t.action.base]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [KNOB_OFF, KNOB_ON]) }],
  }));

  const locked = disabled || busy;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: locked, busy }}
      disabled={locked}
      onPress={() => {
        if (haptic) haptics.selection();
        onValueChange(!value);
      }}
      // 시각 크기는 40×22 로 두고 판정 영역만 48dp 로 넓힌다 (§11-1).
      hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }}
      style={[{ opacity: locked ? 0.6 : 1 }, style]}
      testID={testID}
    >
      <Animated.View
        className="justify-center rounded-full"
        style={[{ width: TRACK_W, height: TRACK_H }, trackStyle]}
      >
        <Animated.View
          className="absolute items-center justify-center rounded-full"
          style={[
            {
              width: KNOB,
              height: KNOB,
              left: 0,
              // 라이트에서는 흰 노브(원본 `#FFF`), 다크에서는 표면 색 노브다.
              // 다크에서 흰 노브를 그대로 두면 어두운 배경에서 혼자 번쩍인다.
              backgroundColor: t.bg.elevated,
            },
            knobStyle,
          ]}
        >
          {busy ? (
            // 노브(16dp) 안에 들어가도록 축소한다. small 기본 지름이 20dp 라 그대로는 넘친다.
            <ActivityIndicator
              size="small"
              color={t.action.base}
              style={{ transform: [{ scale: 0.6 }] }}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}
