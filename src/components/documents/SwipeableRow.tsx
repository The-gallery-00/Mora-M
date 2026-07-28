// src/components/documents/SwipeableRow.tsx
//
// CMP-46 SwipeableRow — Component Library §2 (1-E) 정본 + Mobile UX Guide UX-12 / MOT-14 / HAP-05·06.
//
// 원본 웹의 "인라인 삭제 확인 2버튼이 행 안에 등장"(`storage/cards|tickets|posters`)을 대체한다.
// 좌스와이프로 액션을 노출하고, 임계값(열림 폭의 40%)을 넘겨 놓으면 열린 채 스냅, 못 넘기면 복귀한다.
// 120dp 넘게 당기면 첫 액션을 즉시 실행한다 — 실행 주체는 화면이며 보통 ConfirmDialog 를 띄운다
// (SCR-15 `이 명함을 삭제할까요?`). 이 컴포넌트는 삭제를 직접 하지 않는다.
//
// `react-native-reanimated` 만 쓰고 `react-native-gesture-handler` 의 `Swipeable` 을 쓰지 않는 이유:
// Swipeable 은 임계값·풀스와이프 정책을 우리가 원하는 값으로 못 바꾸고, 액션 폭이 렌더 콜백에 묶여
// FlashList 셀 재활용과 충돌한다.
import { forwardRef, useCallback, useImperativeHandle, useMemo, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';

export type SwipeActionTone = 'danger' | 'neutral' | 'point';

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  tone: SwipeActionTone;
  onPress: () => void;
}

export interface SwipeableRowHandle {
  /** 열린 행을 닫는다. 화면이 "다른 행이 열리면 이 행은 닫는다"를 구현할 때 쓴다. */
  close: () => void;
}

export interface SwipeableRowProps {
  children: ReactNode;
  /** 우→좌 스와이프로 노출 */
  rightActions?: SwipeAction[];
  /** 좌→우 스와이프로 노출 */
  leftActions?: SwipeAction[];
  /** 120dp 넘게 당기면 첫 액션 즉시 실행. default true (첫 액션이 danger 일 때만 동작) */
  enableFullSwipe?: boolean;
  /** 액션을 실행한 뒤 행을 닫는다. default true */
  closeOnAction?: boolean;
  onSwipeOpen?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 액션 버튼 폭 (CMP-46). 44dp 터치 타겟을 여유 있게 넘긴다 */
const ACTION_WIDTH = 80;
/** MOT-14 — 임계값 40% */
const OPEN_RATIO = 0.4;
/** CMP-46 — 120dp 넘기면 첫 액션 즉시 실행 */
const FULL_SWIPE_DISTANCE = 120;
/** 손가락을 놓았을 때만 늘어나는 여유분(고무줄) */
const OVERSHOOT = 48;
/** MOT-14 — 릴리즈 시 spring */
const SPRING = { damping: 30, stiffness: 300 } as const;
/**
 * UX 가이드 §4 규칙 8 — Android 제스처 내비게이션과 겹치지 않도록
 * 화면 좌측 가장자리 24dp 안쪽에서는 스와이프를 시작시키지 않는다.
 */
const EDGE_GUARD = 24;

const TONE_CLASS: Record<SwipeActionTone, { box: string; text: string }> = {
  danger: { box: 'bg-danger', text: 'text-text-inverse' },
  neutral: { box: 'bg-surface-alt', text: 'text-text-primary' },
  point: { box: 'bg-action', text: 'text-text-inverse' },
};

function ActionButton({ action, onDone }: { action: SwipeAction; onDone: () => void }) {
  const visual = TONE_CLASS[action.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={() => {
        action.onPress();
        onDone();
      }}
      className={`h-full items-center justify-center gap-1 ${visual.box}`}
      style={({ pressed }) => [{ width: ACTION_WIDTH }, pressed ? { opacity: 0.85 } : null]}
    >
      {action.icon}
      <Text className={`text-label font-w600 ${visual.text}`} maxFontSizeMultiplier={1.2}>
        {action.label}
      </Text>
    </Pressable>
  );
}

export const SwipeableRow = forwardRef<SwipeableRowHandle, SwipeableRowProps>(
  function SwipeableRow(
    {
      children,
      rightActions,
      leftActions,
      enableFullSwipe = true,
      closeOnAction = true,
      onSwipeOpen,
      style,
      testID,
    },
    ref,
  ) {
    const right = rightActions ?? [];
    const left = leftActions ?? [];
    const rightWidth = right.length * ACTION_WIDTH;
    const leftWidth = left.length * ACTION_WIDTH;

    const translateX = useSharedValue(0);
    const startX = useSharedValue(0);
    /** 풀스와이프 임계값을 이미 넘었는지 — 햅틱을 1회만 울리기 위한 래치 */
    const armed = useSharedValue(false);

    const firstRight = right[0];
    // CMP-46: default true 이되 **danger 액션일 때만**. 되돌릴 수 없는 액션이 아니면 자동 실행은 위험하다.
    const canFullSwipe = enableFullSwipe && firstRight?.tone === 'danger';

    const close = useCallback(() => {
      translateX.value = withSpring(0, SPRING);
      armed.value = false;
    }, [armed, translateX]);

    useImperativeHandle(ref, () => ({ close }), [close]);

    /** HAP-05 — 스와이프-삭제 임계 도달은 Light 다(Medium 은 셔터·롱프레스 전용, §9 표) */
    const hapticThreshold = useCallback(() => {
      haptics.impact('light');
    }, []);

    /** CMP-46 — 열림 시 selection (HAP-01 계열: 행 상태가 바뀐다) */
    const hapticOpen = useCallback(() => {
      haptics.selection();
      onSwipeOpen?.();
    }, [onSwipeOpen]);

    const runFirstRight = useCallback(() => {
      firstRight?.onPress();
    }, [firstRight]);

    /* 제스처는 `useMemo` 로 고정한다 — 보관함 행은 FlashList 셀이라 렌더가 잦다.
       공유값 변형에 대해 `react-hooks/immutability`(React Compiler)가 경고를 내지만,
       Reanimated 의 공식 관용구이고 이 저장소의 기존 제스처 코드(`app/scan/crop.tsx`)와 같은 형태다. */
    const pan = useMemo(() => {
      const gesture = Gesture.Pan()
        // 세로 스크롤이 주인이다 — 수평 12dp 를 넘겨야 행 스와이프가 가져간다
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          startX.value = translateX.value;
          armed.value = false;
        })
        .onUpdate((e) => {
          const next = startX.value + e.translationX;
          const min = rightWidth > 0 ? -(rightWidth + OVERSHOOT) : 0;
          const max = leftWidth > 0 ? leftWidth + OVERSHOOT : 0;
          translateX.value = Math.min(max, Math.max(min, next));

          if (!canFullSwipe) return;
          const passed = translateX.value <= -FULL_SWIPE_DISTANCE;
          if (passed && !armed.value) {
            armed.value = true;
            runOnJS(hapticThreshold)();
          } else if (!passed && armed.value) {
            armed.value = false;
          }
        })
        .onEnd(() => {
          const x = translateX.value;

          // ① 풀스와이프 — 행은 제자리로 돌아가고 화면이 확인 다이얼로그를 띄운다
          if (canFullSwipe && x <= -FULL_SWIPE_DISTANCE) {
            translateX.value = withTiming(0, { duration: 220 });
            armed.value = false;
            runOnJS(runFirstRight)();
            return;
          }
          // ② 임계값(40%) 초과 — 열린 채 스냅
          if (rightWidth > 0 && x < -rightWidth * OPEN_RATIO) {
            translateX.value = withSpring(-rightWidth, SPRING);
            runOnJS(hapticOpen)();
            return;
          }
          if (leftWidth > 0 && x > leftWidth * OPEN_RATIO) {
            translateX.value = withSpring(leftWidth, SPRING);
            runOnJS(hapticOpen)();
            return;
          }
          // ③ 미달 — 복귀
          translateX.value = withSpring(0, SPRING);
        });

      // 안드로이드 뒤로가기 제스처와 충돌하지 않게 좌측 가장자리 판정을 잘라낸다(음수 hitSlop = 축소)
      return Platform.OS === 'android' ? gesture.hitSlop({ left: -EDGE_GUARD }) : gesture;
    }, [
      armed,
      canFullSwipe,
      hapticOpen,
      hapticThreshold,
      leftWidth,
      rightWidth,
      runFirstRight,
      startX,
      translateX,
    ]);

    const contentStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: translateX.value }],
    }));

    const handleActionDone = useCallback(() => {
      if (closeOnAction) close();
    }, [close, closeOnAction]);

    // 액션이 없으면 제스처를 붙이지 않는다 (빈 GestureDetector 는 스크롤만 방해한다)
    if (rightWidth === 0 && leftWidth === 0) {
      return (
        <View testID={testID} style={style}>
          {children}
        </View>
      );
    }

    return (
      <View testID={testID} className="relative overflow-hidden" style={style}>
        {leftWidth > 0 ? (
          <View className="absolute inset-y-0 left-0 flex-row" style={{ width: leftWidth }}>
            {left.map((action) => (
              <ActionButton key={action.label} action={action} onDone={handleActionDone} />
            ))}
          </View>
        ) : null}

        {rightWidth > 0 ? (
          <View className="absolute inset-y-0 right-0 flex-row" style={{ width: rightWidth }}>
            {right.map((action) => (
              <ActionButton key={action.label} action={action} onDone={handleActionDone} />
            ))}
          </View>
        ) : null}

        <GestureDetector gesture={pan}>
          {/* 배경이 불투명해야 아래 액션 버튼이 비쳐 보이지 않는다 */}
          <Animated.View className="bg-bg-elevated" style={contentStyle}>
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    );
  },
);
