// src/components/ui/SegmentedControl.tsx
//
// CMP-12 SegmentedControl — Component Library §2 정본.
// 테마 3택(CMP-51)과 문서유형 필터가 이 컴포넌트를 쓴다.
//
// 인디케이터는 Reanimated 로 슬라이드한다(MOT-13, 200ms `standard` [0.2,0,0,1]).
// `LayoutAnimation` 은 안드로이드에서 깨지므로 금지 — 위키 MOT-13 명시.
// 인디케이터 배경은 `elevation.raised` 가 함께 들고 있다: 다크에서는 그림자가 아니라
// 표면 밝기가 고도를 만들기 때문에 배경과 그림자를 분리하면 다크에서 인디케이터가 사라진다(N-5).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/scale';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 5개 초과 시 가로 스크롤 (SCR-29 일수 선택) */
  scrollable?: boolean;
  size?: 'sm' | 'md'; // 32 / 36 dp
  /** HAP-01 — default true */
  haptic?: boolean;
  /** 그룹 라벨 (예: '테마') — A11Y-16 */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TRACK_PADDING = 3;
const SIZE: Record<'sm' | 'md', { height: number; text: string }> = {
  sm: { height: 32, text: 'text-label' },
  md: { height: 36, text: 'text-body-sm' },
};

/**
 * 칸의 **세로** 실효 타겟을 44dp 로 올린다 (§11-1).
 * 폭은 `flex-1`(3칸이면 390dp 에서 칸당 128dp) 또는 `minWidth 64` 라 이미 충분한데,
 * 높이는 32/36dp 로 하한 아래였다. 좌우는 건드리지 않는다 — 이웃 칸의 판정을 먹는다.
 * 세로 6dp 확장은 트랙 패딩(3) + 호출부 여백(8dp 이상) 안쪽이라 위아래 행을 침범하지 않는다.
 */
const slopFor = (height: number) => Math.max(0, Math.round((44 - height) / 2));

type Box = { x: number; width: number };

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  scrollable = false,
  size = 'md',
  haptic = true,
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  // onLayout 결과를 인덱스 키로 모은다. noUncheckedIndexedAccess 때문에 조회는 항상 undefined 를 고려한다.
  const [boxes, setBoxes] = useState<Record<number, Box>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  const activeIndex = options.findIndex((o) => o.value === value);
  const activeBox = activeIndex >= 0 ? boxes[activeIndex] : undefined;

  useEffect(() => {
    if (!activeBox) return;
    const duration = reduceMotion ? 0 : 200;
    const easing = Easing.bezier(0.2, 0, 0, 1); // motion.easing.standard
    x.value = withTiming(activeBox.x, { duration, easing });
    w.value = withTiming(activeBox.width, { duration, easing });
  }, [activeBox, reduceMotion, w, x]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: w.value,
    transform: [{ translateX: x.value }],
  }));

  const measure = useCallback((index: number, box: Box) => {
    setBoxes((prev) => {
      const found = prev[index];
      if (found && found.x === box.x && found.width === box.width) return prev;
      return { ...prev, [index]: box };
    });
  }, []);

  const select = useCallback(
    (option: SegmentedOption<T>) => {
      if (option.disabled || option.value === value) return;
      if (haptic) haptics.selection();
      onChange(option.value);
    },
    [haptic, onChange, value],
  );

  const items = options.map((option, index) => {
    const isActive = option.value === value;
    return (
      <Pressable
        key={String(option.value)}
        // A11Y-16 — 각 칸은 button + selected 상태. 3칸이면 340dp 에서도 한 칸 44dp 를 넘긴다
        accessibilityRole="button"
        accessibilityLabel={option.label}
        accessibilityState={{ selected: isActive, disabled: option.disabled ?? false }}
        disabled={option.disabled ?? false}
        onPress={() => select(option)}
        onLayout={(e) =>
          measure(index, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })
        }
        hitSlop={{ top: slopFor(SIZE[size].height), bottom: slopFor(SIZE[size].height) }}
        className={`${scrollable ? 'px-4' : 'flex-1'} items-center justify-center rounded-sm`}
        style={{ height: SIZE[size].height, minWidth: scrollable ? 64 : undefined }}
      >
        <Text
          className={`${SIZE[size].text} ${
            option.disabled
              ? 'font-w600 text-text-disabled'
              : isActive
                ? 'font-w700 text-text-primary' // 선택은 색 외 단서(굵기)를 함께 준다(§14-4)
                : 'font-w600 text-text-muted'
          }`}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {option.label}
        </Text>
      </Pressable>
    );
  });

  const track = (
    <View className="relative flex-row">
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: radius.sm },
          // 배경 + 그림자를 한 벌로 받는다 (§10-6 규칙 1)
          t.elevation.raised,
          indicatorStyle,
        ]}
      />
      {items}
    </View>
  );

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className="rounded-md bg-surface-alt"
      style={[{ padding: TRACK_PADDING }, style]}
    >
      {scrollable ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {track}
        </ScrollView>
      ) : (
        track
      )}
    </View>
  );
}
