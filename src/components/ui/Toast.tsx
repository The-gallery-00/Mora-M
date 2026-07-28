// src/components/ui/Toast.tsx
//
// CMP-16 Toast — 표시 담당. 상태·명령형 API 는 `toastStore.ts` 에 있다.
//
// 배치: 하단. 탭바가 있는 화면은 `tabBarHeight + insets.bottom + 12`, 없으면 `insets.bottom + 16`
// (§2 CMP-16). 동시에 1개만 표시하고, 새 토스트가 오면 기존 것을 fade-out 한 뒤 교체한다.
// 모션: MOT-09 in(translateY 16→0 + opacity, 200ms decelerate) / MOT-10 out(opacity + translateY 8, 160ms accelerate).
//
// **이 파일은 `<ToastHost/>` 를 export 만 한다.** 루트(app/_layout.tsx)에 마운트하는 것은
// 셸 담당의 몫이다(이 에이전트는 _layout.tsx 를 건드리지 않는다).
//
// 색: 컨테이너는 `elevation.dropdown`(§7-1)이 backgroundColor 를 함께 들고 오므로
// className 으로 배경을 덮을 수 없다 → tone 색 전부를 useTheme() 에서 받는다(§10-6 규칙 1, N-6).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeTokens } from '@/theme/tokens';

import { useToastStore, type ToastItem, type ToastTone } from './toastStore';

export { toast, useToastStore } from './toastStore';
export type { ToastItem, ToastOptions, ToastTone } from './toastStore';

export interface ToastHostProps {
  /**
   * 하단 오프셋(dp). 미지정 시 `insets.bottom + 16`.
   * 탭바가 있는 화면 트리에서는 `tabBarHeight + insets.bottom + 12` 를 넘긴다.
   */
  bottomOffset?: number;
  testID?: string;
}

type ToneColors = { bg: string; fg: string; border: string };

const toneColors = (tone: ToastTone, t: ThemeTokens): ToneColors => {
  switch (tone) {
    case 'success':
      // 라이트는 success.base 가 아니라 success.text 를 써야 텍스트 대비가 확보된다(§14-4)
      return { bg: t.success.container, fg: t.success.text, border: t.success.base };
    case 'error':
      return { bg: t.danger.container, fg: t.danger.strong, border: t.danger.border };
    case 'warn':
      return { bg: t.warn.container, fg: t.warn.base, border: t.warn.border };
    case 'info':
    default:
      return { bg: t.bg.elevated, fg: t.text.primary, border: t.info.border };
  }
};

const IN_DURATION = 200; // motion.duration.toastIn
const OUT_DURATION = 160; // motion.duration.toastOut

export function ToastHost({ bottomOffset, testID }: ToastHostProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);

  /** 화면에 그려지고 있는 항목. store 의 current 를 애니메이션 지연만큼 늦게 따라간다 */
  const [shown, setShown] = useState<ToastItem | null>(null);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    dismissTimer.current = null;
    swapTimer.current = null;
  }, []);

  const animateOut = useCallback(
    (after: () => void) => {
      const duration = reduceMotion ? 0 : OUT_DURATION;
      opacity.value = withTiming(0, { duration, easing: Easing.bezier(0.4, 0, 1, 1) });
      translateY.value = withTiming(reduceMotion ? 0 : 8, { duration });
      if (swapTimer.current) clearTimeout(swapTimer.current);
      swapTimer.current = setTimeout(after, duration);
    },
    [opacity, reduceMotion, translateY],
  );

  /* store → 화면. 교체는 "이전 것 fade-out 후 새 것" 순서를 지킨다 */
  useEffect(() => {
    if (!current) {
      if (shown) animateOut(() => setShown(null));
      return;
    }
    if (!shown) {
      setShown(current);
      return;
    }
    if (shown.id !== current.id) animateOut(() => setShown(current));
  }, [animateOut, current, shown]);

  /* 새 항목이 화면에 올라올 때: 진입 모션 + 햅틱 + 스크린리더 알림 + 자동 소멸 타이머 */
  useEffect(() => {
    if (!shown) return;

    const duration = reduceMotion ? 0 : IN_DURATION;
    translateY.value = reduceMotion ? 0 : 16;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration, easing: Easing.bezier(0.16, 1, 0.3, 1) });
    translateY.value = withTiming(0, { duration, easing: Easing.bezier(0.16, 1, 0.3, 1) });

    if (shown.haptic) {
      if (shown.tone === 'success') haptics.success();
      else if (shown.tone === 'error') haptics.error();
      else if (shown.tone === 'warn') haptics.warning();
    }

    // A11Y-11 — 토스트는 시각 전용이므로 스크린리더 알림을 반드시 병행한다
    AccessibilityInfo.announceForAccessibility(shown.message);

    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    const id = shown.id;
    dismissTimer.current = setTimeout(() => hide(id), shown.duration);

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [hide, opacity, reduceMotion, shown, translateY]);

  useEffect(() => clearTimers, [clearTimers]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: reduceMotion ? 0 : translateY.value }],
  }));

  if (!shown) return null;

  const colors = toneColors(shown.tone, t);
  const bottom = bottomOffset ?? insets.bottom + 16;

  return (
    <View
      testID={testID}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom, paddingHorizontal: 16, zIndex: 50 }}
    >
      <Animated.View
        style={[
          // elevation 은 배경 토큰을 함께 들고 온다 → tone 배경으로 덮어쓴다(§10-6 규칙 1)
          t.elevation.dropdown,
          { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
          animStyle,
        ]}
      >
        <View
          className="flex-row items-center gap-3 px-4 py-3"
          accessibilityLiveRegion="polite"
        >
          <Text className="flex-1 text-body-sm font-w500" style={{ color: colors.fg }}>
            {shown.message}
          </Text>

          {shown.actionLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shown.actionLabel}
              onPress={() => {
                clearTimers();
                shown.onAction?.();
                hide(shown.id);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              className="min-h-[44px] justify-center"
            >
              {/* 액션 라벨은 5초 안에 찾아 눌러야 하므로 대비 4.5:1 을 지킨다(§14-4) */}
              <Text className="text-label font-w700" style={{ color: t.action.base }}>
                {shown.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
