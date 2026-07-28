// src/components/ui/IconButton.tsx
//
// CMP-02 IconButton — Component Library §2 정본.
// 시각 크기는 32/40/48dp 이지만 hitSlop 으로 **실효 터치 타겟 48dp** 를 항상 만든다(§11-1 규칙 2).
// 아이콘만 있으므로 `accessibilityLabel` 은 필수 prop 이다(A11Y-01).
import { cloneElement, isValidElement, useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export type IconButtonSize = 'sm' | 'md' | 'lg';
/** overlay = 이미지 위 어두운 원형. 라이트/다크 **양 테마 모두 어둡다**(§3-0 예외 6) */
export type IconButtonVariant = 'plain' | 'filled' | 'overlay';
export type IconButtonTone = 'default' | 'danger' | 'inverse';

export interface IconButtonProps {
  /** 아이콘 엘리먼트. `color` prop 을 받는 엘리먼트라면 tone 색이 자동 주입된다 */
  icon: ReactNode;
  onPress: () => void;
  size?: IconButtonSize; // 32 / 40 / 48 dp — 전부 hitSlop 으로 48dp 보장
  variant?: IconButtonVariant; // default 'plain'
  tone?: IconButtonTone; // default 'default'
  disabled?: boolean;
  /** >0 이면 우상단 카운트 배지 (99+ 클램프) */
  badgeCount?: number;
  /** HAP-01 — 헤더 액션은 기본 무음, 필터/토글 성격이면 화면이 true 로 켠다 */
  haptic?: boolean;
  accessibilityLabel: string; // 필수 — 아이콘만 있으므로
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const DIM: Record<IconButtonSize, number> = { sm: 32, md: 40, lg: 48 };
/** 실효 타겟 48dp — §11-1. 시각 크기는 그대로 두고 판정 영역만 넓힌다 */
const slopFor = (dim: number) => Math.max(0, Math.round((48 - dim) / 2));

const VARIANT: Record<IconButtonVariant, { base: string; pressed: string; disabled: string }> = {
  plain: { base: 'bg-transparent', pressed: 'bg-surface-alt', disabled: 'bg-transparent' },
  filled: { base: 'bg-surface-alt', pressed: 'bg-surface-active', disabled: 'bg-surface' },
  // 예외 6: 카메라·크롭·뷰어 크롬. 테마를 따르면 라이트에서 아이콘이 사라진다.
  // HEX 가 아니라 tailwind 기본 팔레트의 black + 알파 유틸을 쓴다.
  overlay: { base: 'bg-black/40', pressed: 'bg-black/60', disabled: 'bg-black/30' },
};

export function IconButton({
  icon,
  onPress,
  size = 'md',
  variant = 'plain',
  tone = 'default',
  disabled = false,
  badgeCount,
  haptic = false,
  accessibilityLabel,
  style,
  testID,
}: IconButtonProps) {
  const t = useTheme();
  const [pressed, setPressed] = useState(false);

  const dim = DIM[size];
  const slop = slopFor(dim);

  // 아이콘 색은 SVG fill/stroke 라 className 이 닿지 않는다 → useTheme (N-6)
  const iconColor = disabled
    ? t.text.disabled
    : variant === 'overlay'
      ? t.text.inverse // 오버레이는 항상 어두운 배경이므로 밝은 아이콘
      : tone === 'danger'
        ? t.danger.base
        : tone === 'inverse'
          ? t.text.inverse
          : t.text.secondary;

  const handlePress = useCallback(() => {
    if (haptic) haptics.selection();
    onPress();
  }, [haptic, onPress]);

  const painted =
    isValidElement(icon) && (icon.props as { color?: string }).color === undefined
      ? cloneElement(icon as ReactElement<{ color?: string }>, { color: iconColor })
      : icon;

  const count = badgeCount !== undefined && badgeCount > 0 ? Math.min(badgeCount, 100) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      pointerEvents={disabled ? 'none' : 'auto'}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      style={[{ width: dim, height: dim }, style]}
      className={[
        'items-center justify-center rounded-full',
        disabled
          ? VARIANT[variant].disabled
          : pressed
            ? VARIANT[variant].pressed
            : VARIANT[variant].base,
      ].join(' ')}
    >
      {painted}

      {count === null ? null : (
        <View
          className="absolute -right-1 -top-1 min-w-[18px] items-center justify-center rounded-full bg-danger px-1"
          style={{ height: 18 }}
          // 배지는 버튼 라벨에 이미 포함되어야 하는 정보이므로 별도로 읽히지 않게 한다(A11Y-04)
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text className="text-micro font-w700 text-text-inverse" maxFontSizeMultiplier={1.2}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
