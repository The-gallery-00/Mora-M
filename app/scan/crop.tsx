// app/scan/crop.tsx — SCR-10 · 스캔 · 크롭/보정
//
// 정본: wiki/design/Screen Specs.md SCR-10 (와이어프레임 · 상태표 · 인터랙션표)
//       wiki/tech/Camera and Scan.md §5 (v1 은 직사각 크롭 + 90° 단위 회전만. 원근 보정 범위 밖)
//
// 색: 캔버스가 사진이고 헤더도 와이어프레임에 `헤더(다크)` 로 못박혀 있어 **화면 크롬 전체가
// 항상 다크**다(SCR-09 와 같은 이미지 표면 예외). 테마 종속 토큰을 쓰지 않는 유일한 화면 2개 중 하나.
//
// 좌표계 주의 — `cropAndRotate` 는 **회전을 먼저 적용하고 그 결과에 crop 을 적용**한다
// (imagePipeline: rotate → crop). 그래서 이 화면은 회전된 이미지를 그대로 화면에 그리고,
// 크롭 사각형도 "회전된 이미지 픽셀" 좌표로 환산해 넘긴다. 화면에 보이는 것 = 잘리는 것.
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { toast } from '@/components/ui';
import {
  cropAndRotate,
  normalizeRotation,
  readImageSize,
  useScan,
  useScanStore,
  type CropRect,
} from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/** 8방향 핸들 시각 크기(dp). 터치 판정은 hitSlop 으로 44dp 이상 확보한다. */
const HANDLE_SIZE = 24;
/** 최소 크롭 크기 80×80px (Screen Specs 구성요소 표). 화면상 최소치도 함께 강제한다. */
const MIN_SOURCE_PX = 80;
const MIN_DISPLAY_DP = 56;

type Rect = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
};

/* ── 툴바 아이콘 ──────────────────────────────────────────────────────────── */

type IconProps = { color?: string; size?: number };

function RotateLeftIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5A8 8 0 1 1 5.6 16"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <Path d="M3.5 5.5V10.5H8.5" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
    </Svg>
  );
}

function RotateRightIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 10.5A8 8 0 1 0 18.4 16" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M20.5 5.5V10.5H15.5" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
    </Svg>
  );
}

function FitIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ResetIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 11A8 8 0 1 1 6.5 17" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M3.5 6V11H8.5" stroke={color} strokeWidth={1.9} strokeLinejoin="round" />
    </Svg>
  );
}

/* ── 화면 ─────────────────────────────────────────────────────────────────── */

export default function ScanCropScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();

  const { sourceUri, setAdjusted, resetForNextScan } = useScan();
  // `useScan()` 은 원본 픽셀 크기를 노출하지 않는다(업로드 파이프라인 내부 값). 스토어에서 직접 읽는다.
  const sourceSize = useScanStore((s) => s.sourceSize);

  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(sourceSize);
  const [processing, setProcessing] = useState(false);

  const rect: Rect = {
    x: useSharedValue(0),
    y: useSharedValue(0),
    w: useSharedValue(0),
    h: useSharedValue(0),
  };
  const boundsW = useSharedValue(0);
  const boundsH = useSharedValue(0);
  const minSize = useSharedValue(MIN_DISPLAY_DP);
  const lastHapticAt = useSharedValue(0);

  /* 촬영/선택 결과 없이 직접 들어온 경우 — 카메라로 되돌린다.
     `취소` 가 스토어를 비울 때 다시 발화하지 않도록 마운트 1회로 제한한다. */
  const bootChecked = useRef(false);
  useEffect(() => {
    if (bootChecked.current) return;
    bootChecked.current = true;
    if (!sourceUri) router.replace('/scan');
  }, [sourceUri, router]);

  /* 피커가 크기를 주지 않은 예외 경로 보강 (디코드 1회 추가). */
  useEffect(() => {
    if (size || !sourceUri) return;
    let alive = true;
    void (async () => {
      try {
        const measured = await readImageSize(sourceUri);
        if (alive) setSize(measured);
      } catch {
        if (alive) toast.error('이미지를 처리하지 못했습니다.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [size, sourceUri]);

  /** 회전이 반영된 이미지의 화면 배치. 캔버스 안에 contain 으로 앉힌다. */
  const layout = useMemo(() => {
    if (!size || canvas.width === 0 || canvas.height === 0) return null;
    const upright = rotation % 180 === 0;
    const rotW = upright ? size.width : size.height;
    const rotH = upright ? size.height : size.width;
    const scale = Math.min(canvas.width / rotW, canvas.height / rotH);
    const dispW = rotW * scale;
    const dispH = rotH * scale;
    return {
      scale,
      dispW,
      dispH,
      offsetX: (canvas.width - dispW) / 2,
      offsetY: (canvas.height - dispH) / 2,
      // 회전 전 원본 비율로 그린 뒤 transform 으로 돌린다(회전축 = 중심).
      imgW: size.width * scale,
      imgH: size.height * scale,
    };
  }, [size, canvas, rotation]);

  /** 크롭 박스를 이미지 전체로 되돌린다 (초기값 · `비율맞춤` · 회전 직후). */
  const resetRect = useCallback(() => {
    if (!layout) return;
    rect.x.value = 0;
    rect.y.value = 0;
    rect.w.value = layout.dispW;
    rect.h.value = layout.dispH;
    boundsW.value = layout.dispW;
    boundsH.value = layout.dispH;
    minSize.value = Math.max(MIN_DISPLAY_DP, MIN_SOURCE_PX * layout.scale);
  }, [layout, rect.x, rect.y, rect.w, rect.h, boundsW, boundsH, minSize]);

  // 레이아웃(캔버스 크기·회전)이 바뀌면 크롭 박스를 다시 맞춘다.
  useEffect(() => {
    resetRect();
  }, [resetRect]);

  const fireBoundaryHaptic = useCallback(() => {
    haptics.selection();
  }, []);

  /* ── 액션 ──────────────────────────────────────────────────────────────── */

  const rotate = useCallback((delta: number) => {
    haptics.selection();
    setRotation((prev) => normalizeRotation(prev + delta));
  }, []);

  const handleReset = useCallback(() => {
    haptics.impact('light');
    setRotation(0);
    resetRect();
  }, [resetRect]);

  const handleCancel = useCallback(() => {
    // 촬영본 폐기 후 SCR-09 복귀 (Screen Specs 인터랙션 표).
    // 세션 카운터(`이번 세션 n장 저장됨`)는 유지해야 하므로 reset 이 아니라 resetForNextScan 이다.
    resetForNextScan();
    router.replace('/scan');
  }, [resetForNextScan, router]);

  /** 표시 좌표 → 회전된 이미지의 픽셀 좌표. 전체 선택이면 null(크롭 생략). */
  const toSourceRect = useCallback((): CropRect | null => {
    if (!layout) return null;
    const { scale, dispW, dispH } = layout;
    const x = rect.x.value;
    const y = rect.y.value;
    const w = rect.w.value;
    const h = rect.h.value;
    const full = x <= 0.5 && y <= 0.5 && w >= dispW - 0.5 && h >= dispH - 0.5;
    if (full) return null;
    return {
      originX: Math.max(0, Math.round(x / scale)),
      originY: Math.max(0, Math.round(y / scale)),
      width: Math.max(MIN_SOURCE_PX, Math.round(w / scale)),
      height: Math.max(MIN_SOURCE_PX, Math.round(h / scale)),
    };
  }, [layout, rect.x, rect.y, rect.w, rect.h]);

  const handleDone = useCallback(async () => {
    if (!sourceUri || processing) return;
    const crop = toSourceRect();
    if (crop === null && rotation === 0) {
      // 손댄 것이 없다 = 건너뛰기와 동치. 불필요한 재인코딩(세대 손실)을 피한다.
      router.replace('/scan/analyzing');
      return;
    }
    setProcessing(true);
    try {
      const adjusted = await cropAndRotate(sourceUri, crop, rotation);
      setAdjusted(adjusted.uri);
      router.replace('/scan/analyzing');
    } catch {
      toast.error('이미지를 처리하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  }, [processing, rotation, router, setAdjusted, sourceUri, toSourceRect]);

  /* ── 제스처 ────────────────────────────────────────────────────────────── */

  const moveStartX = useSharedValue(0);
  const moveStartY = useSharedValue(0);

  const moveGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          moveStartX.value = rect.x.value;
          moveStartY.value = rect.y.value;
        })
        .onUpdate((e) => {
          const maxX = boundsW.value - rect.w.value;
          const maxY = boundsH.value - rect.h.value;
          const nx = Math.min(Math.max(0, moveStartX.value + e.translationX), Math.max(0, maxX));
          const ny = Math.min(Math.max(0, moveStartY.value + e.translationY), Math.max(0, maxY));
          if (nx !== rect.x.value && (nx <= 0 || nx >= maxX)) {
            const now = Date.now();
            if (now - lastHapticAt.value > 150) {
              lastHapticAt.value = now;
              runOnJS(fireBoundaryHaptic)();
            }
          }
          rect.x.value = nx;
          rect.y.value = ny;
        }),
    [boundsW, boundsH, fireBoundaryHaptic, lastHapticAt, moveStartX, moveStartY, rect.h, rect.w, rect.x, rect.y],
  );

  const boxStyle = useAnimatedStyle(() => ({
    left: rect.x.value,
    top: rect.y.value,
    width: rect.w.value,
    height: rect.h.value,
  }));

  const dimTopStyle = useAnimatedStyle(() => ({ height: rect.y.value }));
  const dimBottomStyle = useAnimatedStyle(() => ({ top: rect.y.value + rect.h.value }));
  const dimLeftStyle = useAnimatedStyle(() => ({
    top: rect.y.value,
    height: rect.h.value,
    width: rect.x.value,
  }));
  const dimRightStyle = useAnimatedStyle(() => ({
    top: rect.y.value,
    height: rect.h.value,
    left: rect.x.value + rect.w.value,
  }));

  const handleProps = {
    rect,
    boundsW,
    boundsH,
    minSize,
    lastHapticAt,
    onBoundary: fireBoundaryHaptic,
  };

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style="light" />

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <View className="h-14 flex-row items-center justify-between px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="크롭 취소"
          onPress={handleCancel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text className="text-button font-w600 text-white">취소</Text>
        </Pressable>

        <Text className="text-h3 font-w700 text-white">자르기</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="자르기 완료"
          accessibilityState={{ disabled: processing, busy: processing }}
          disabled={processing || !layout}
          onPress={() => {
            void handleDone();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text
            className="text-button font-w700"
            style={{ color: processing || !layout ? t.text.disabled : t.action.base }}
          >
            {processing ? '처리 중...' : '완료'}
          </Text>
        </Pressable>
      </View>

      {/* ── 캔버스 ───────────────────────────────────────────────────────── */}
      <View
        className="flex-1"
        onLayout={(e) =>
          setCanvas({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        {!sourceUri || !layout ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : (
          <View
            style={{
              position: 'absolute',
              left: layout.offsetX,
              top: layout.offsetY,
              width: layout.dispW,
              height: layout.dispH,
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: sourceUri }}
              contentFit="fill"
              // 회전 전 비율로 그린 뒤 중심 회전 → 결과 바운딩 박스가 정확히 dispW×dispH 가 된다.
              style={{
                position: 'absolute',
                left: (layout.dispW - layout.imgW) / 2,
                top: (layout.dispH - layout.imgH) / 2,
                width: layout.imgW,
                height: layout.imgH,
                transform: [{ rotate: `${rotation}deg` }],
              }}
              accessibilityLabel="촬영한 문서 이미지"
            />

            {/* 크롭 밖 딤 rgba(0,0,0,.6) */}
            <Animated.View pointerEvents="none" className="absolute left-0 right-0 top-0 bg-black/60" style={dimTopStyle} />
            <Animated.View pointerEvents="none" className="absolute bottom-0 left-0 right-0 bg-black/60" style={dimBottomStyle} />
            <Animated.View pointerEvents="none" className="absolute left-0 bg-black/60" style={dimLeftStyle} />
            <Animated.View pointerEvents="none" className="absolute right-0 bg-black/60" style={dimRightStyle} />

            {/* 크롭 박스 + 3×3 격자 */}
            <GestureDetector gesture={moveGesture}>
              <Animated.View
                accessibilityLabel="크롭 영역, 드래그해서 이동"
                style={[{ position: 'absolute', borderWidth: 1, borderColor: '#FFFFFF' }, boxStyle]}
              >
                <View pointerEvents="none" className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
                <View pointerEvents="none" className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
                <View pointerEvents="none" className="absolute left-0 top-1/3 h-px w-full bg-white/30" />
                <View pointerEvents="none" className="absolute left-0 top-2/3 h-px w-full bg-white/30" />
              </Animated.View>
            </GestureDetector>

            {/* 8방향 핸들 */}
            <CropHandle dx={-1} dy={-1} label="왼쪽 위 모서리" {...handleProps} />
            <CropHandle dx={0} dy={-1} label="위쪽 변" {...handleProps} />
            <CropHandle dx={1} dy={-1} label="오른쪽 위 모서리" {...handleProps} />
            <CropHandle dx={-1} dy={0} label="왼쪽 변" {...handleProps} />
            <CropHandle dx={1} dy={0} label="오른쪽 변" {...handleProps} />
            <CropHandle dx={-1} dy={1} label="왼쪽 아래 모서리" {...handleProps} />
            <CropHandle dx={0} dy={1} label="아래쪽 변" {...handleProps} />
            <CropHandle dx={1} dy={1} label="오른쪽 아래 모서리" {...handleProps} />
          </View>
        )}

        {processing ? (
          <View className="absolute inset-0 items-center justify-center bg-black/50">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : null}
      </View>

      {/* ── 툴바 ─────────────────────────────────────────────────────────── */}
      <View className="flex-row items-start justify-around px-4 pb-2 pt-3">
        <ToolButton icon={<RotateLeftIcon />} label="왼쪽회전" onPress={() => rotate(-90)} />
        <ToolButton icon={<RotateRightIcon />} label="오른쪽회전" onPress={() => rotate(90)} />
        <ToolButton icon={<FitIcon />} label="비율맞춤" onPress={resetRect} />
        <ToolButton icon={<ResetIcon />} label="초기화" onPress={handleReset} />
      </View>

      {/* 건너뛰기 링크는 뺐다(디자인 결정) — 경로 자체는 살아 있다:
          `handleDone` 이 크롭 없음 + 회전 0 이면 재인코딩 없이 원본 그대로 넘긴다. */}
    </View>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      className="items-center justify-center"
      style={{ minWidth: 64, minHeight: 44, borderRadius: radius.md, paddingVertical: spacing.xxs }}
    >
      {icon}
      <Text className="mt-1 text-caption text-white/80" maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 8방향 크롭 핸들 1개.
 * `dx`/`dy` 는 각각 -1(좌/상) · 0(중앙) · 1(우/하) 이며 위치와 리사이즈 방향을 동시에 결정한다.
 * 각 핸들이 자기 제스처 시작값을 들고 있어야 하므로(훅) 컴포넌트로 분리한다.
 */
function CropHandle({
  dx,
  dy,
  label,
  rect,
  boundsW,
  boundsH,
  minSize,
  lastHapticAt,
  onBoundary,
}: {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  label: string;
  rect: Rect;
  boundsW: SharedValue<number>;
  boundsH: SharedValue<number>;
  minSize: SharedValue<number>;
  lastHapticAt: SharedValue<number>;
  onBoundary: () => void;
}) {
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          sx.value = rect.x.value;
          sy.value = rect.y.value;
          sw.value = rect.w.value;
          sh.value = rect.h.value;
        })
        .onUpdate((e) => {
          let nx = sx.value;
          let ny = sy.value;
          let nw = sw.value;
          let nh = sh.value;
          let clamped = false;

          if (dx === -1) {
            const right = sx.value + sw.value;
            const candidate = sx.value + e.translationX;
            nx = Math.min(Math.max(0, candidate), right - minSize.value);
            nw = right - nx;
            if (candidate < 0 || candidate > right - minSize.value) clamped = true;
          } else if (dx === 1) {
            const candidate = sw.value + e.translationX;
            nw = Math.min(Math.max(minSize.value, candidate), boundsW.value - sx.value);
            if (candidate < minSize.value || candidate > boundsW.value - sx.value) clamped = true;
          }

          if (dy === -1) {
            const bottom = sy.value + sh.value;
            const candidate = sy.value + e.translationY;
            ny = Math.min(Math.max(0, candidate), bottom - minSize.value);
            nh = bottom - ny;
            if (candidate < 0 || candidate > bottom - minSize.value) clamped = true;
          } else if (dy === 1) {
            const candidate = sh.value + e.translationY;
            nh = Math.min(Math.max(minSize.value, candidate), boundsH.value - sy.value);
            if (candidate < minSize.value || candidate > boundsH.value - sy.value) clamped = true;
          }

          rect.x.value = nx;
          rect.y.value = ny;
          rect.w.value = nw;
          rect.h.value = nh;

          if (clamped) {
            const now = Date.now();
            if (now - lastHapticAt.value > 150) {
              lastHapticAt.value = now;
              runOnJS(onBoundary)();
            }
          }
        }),
    [boundsH, boundsW, dx, dy, lastHapticAt, minSize, onBoundary, rect.h, rect.w, rect.x, rect.y, sh, sw, sx, sy],
  );

  const style = useAnimatedStyle(() => ({
    left: rect.x.value + ((dx + 1) / 2) * rect.w.value - HANDLE_SIZE / 2,
    top: rect.y.value + ((dy + 1) / 2) * rect.h.value - HANDLE_SIZE / 2,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="adjustable"
        accessibilityLabel={`크롭 ${label}`}
        // 시각 24dp, 실효 터치 타겟은 hitSlop 으로 48dp (A11Y-06)
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[
          {
            position: 'absolute',
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        <View
          style={{
            width: dy === 0 ? 4 : dx === 0 ? 18 : 14,
            height: dx === 0 ? 4 : dy === 0 ? 18 : 14,
            backgroundColor: '#FFFFFF',
            borderRadius: 2,
          }}
        />
      </Animated.View>
    </GestureDetector>
  );
}
