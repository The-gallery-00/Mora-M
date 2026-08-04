// src/components/ui/Button.tsx
//
// CMP-01 Button — Component Library §2 / §3-1 정본.
// variant(primary/secondary/ghost/danger) × size(sm/md/lg) × state(default/pressed/disabled/loading).
//
// 색은 전부 의미론적 토큰 className 이다(§3-0 N-1). 특히 채움 라벨은 흰색 리터럴이 아니라
// `text-text-inverse` 다 — 다크에서 채움색이 밝아지므로 라벨은 어두워진다(§3-0 예외 4).
// className 으로 못 쓰는 ActivityIndicator 색만 useTheme() 을 통과한다(N-6).
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
/** HAP-01/05/06 — 기본 'light'. 파괴적 액션 확인 직전은 화면 코드가 'medium' 이상을 쓴다 */
export type ButtonHaptic = 'none' | 'selection' | 'light' | 'medium';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant; // default 'primary'
  size?: ButtonSize; // default 'md'
  disabled?: boolean;
  loading?: boolean; // true 면 라벨을 loadingLabel 로 교체 + 스피너
  loadingLabel?: string; // default '처리 중...' (원본 AuthForm 문구)
  fullWidth?: boolean; // default false
  /** 라벨 좌측 슬롯 (아이콘 엘리먼트) */
  leadingIcon?: ReactNode;
  /** 라벨 우측 슬롯 */
  trailingIcon?: ReactNode;
  haptic?: ButtonHaptic; // default 'light'
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string; // 미지정 시 label 사용
}

/* ── §3-1 variant × state (배경 / 보더) ──────────────────────────────── */
const CONTAINER: Record<ButtonVariant, { base: string; pressed: string; disabled: string }> = {
  // 제출·확정 액션 = brand 네이비 (§3-1 결정)
  primary: { base: 'bg-brand', pressed: 'bg-brand-pressed', disabled: 'bg-border-subtle' },
  secondary: {
    base: 'bg-bg-elevated border border-border-subtle',
    pressed: 'bg-surface border border-border-subtle',
    disabled: 'bg-surface border border-border-subtle',
  },
  ghost: { base: 'bg-transparent', pressed: 'bg-surface-active', disabled: 'bg-transparent' },
  danger: { base: 'bg-danger', pressed: 'bg-danger-pressed', disabled: 'bg-danger-border' },
};

/* 라벨색. 채움(primary/danger)은 disabled 에서도 inverse 를 유지한다(§3-1 표) */
const LABEL: Record<ButtonVariant, { base: string; disabled: string }> = {
  primary: { base: 'text-text-inverse', disabled: 'text-text-inverse' },
  secondary: { base: 'text-text-secondary', disabled: 'text-text-disabled' },
  ghost: { base: 'text-action', disabled: 'text-text-disabled' },
  danger: { base: 'text-text-inverse', disabled: 'text-text-inverse' },
};

/* ── §3-1 size (높이 / 좌우 패딩 / 타이포 / radius). md 44dp 가 터치 타겟 하한(§11-1) ── */
const SIZE: Record<ButtonSize, { container: string; label: string }> = {
  sm: { container: 'h-9 px-3.5 rounded-md', label: 'text-body-sm font-w700' },
  md: { container: 'h-11 px-4.5 rounded-btn', label: 'text-button font-w700' },
  lg: { container: 'h-[52px] px-5 rounded-card', label: 'text-button font-w700' },
};

/** MOT-07 press-in 90ms / MOT-08 press-out 140ms, scale 0.98 (§3-1) */
const PRESS_SCALE = 0.98;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  loadingLabel = '처리 중...',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  haptic = 'light',
  style,
  testID,
  accessibilityLabel,
}: ButtonProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);

  const blocked = disabled || loading;
  const state = disabled ? 'disabled' : pressed ? 'pressed' : 'base';

  const animStyle = useAnimatedStyle(() => ({
    transform: reduceMotion ? [] : [{ scale: scale.value }],
  }));

  const onPressIn = useCallback(() => {
    setPressed(true);
    scale.value = withTiming(PRESS_SCALE, { duration: 90, easing: Easing.out(Easing.quad) });
  }, [scale]);

  const onPressOut = useCallback(() => {
    setPressed(false);
    scale.value = withTiming(1, { duration: 140, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [scale]);

  const handlePress = useCallback(() => {
    // HAP: 1초 내 2회 초과 금지 규칙은 화면 코드의 책임이다. 여기서는 1회만 쏜다.
    if (haptic === 'selection') haptics.selection();
    else if (haptic === 'light') haptics.impact('light');
    else if (haptic === 'medium') haptics.impact('medium');
    onPress();
  }, [haptic, onPress]);

  // 스피너 색은 className 으로 지정할 수 없다 → useTheme (N-6)
  const spinnerColor =
    variant === 'secondary'
      ? t.text.secondary
      : variant === 'ghost'
        ? t.action.base
        : t.text.inverse;

  const containerClass = [
    'flex-row items-center justify-center gap-2',
    SIZE[size].container,
    state === 'disabled'
      ? CONTAINER[variant].disabled
      : state === 'pressed'
        ? CONTAINER[variant].pressed
        : CONTAINER[variant].base,
    fullWidth ? 'w-full' : '',
  ].join(' ');

  const labelClass = [
    SIZE[size].label,
    disabled ? LABEL[variant].disabled : LABEL[variant].base,
  ].join(' ');

  return (
    <Animated.View
      style={[
        fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'center' },
        // §3-1 loading: 채움 variant 만 채움색 유지 + opacity 0.6.
        // secondary/ghost 는 "동일 + 스피너"라 투명도를 건드리지 않는다.
        loading && (variant === 'primary' || variant === 'danger') ? { opacity: 0.6 } : null,
        animStyle,
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: blocked, busy: loading }}
        testID={testID}
        disabled={blocked}
        pointerEvents={blocked ? 'none' : 'auto'}
        onPress={handlePress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className={containerClass}
      >
        {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : leadingIcon}
        <Text className={labelClass} numberOfLines={1}>
          {loading ? loadingLabel : label}
        </Text>
        {loading ? null : trailingIcon}
      </Pressable>
    </Animated.View>
  );
}
