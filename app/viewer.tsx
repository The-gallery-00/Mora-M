// app/viewer.tsx — SCR-21 · 이미지 뷰어 (OCR 오버레이)
//
// 정본: wiki/design/Screen Specs.md SCR-21 (와이어프레임 · 상태표 · 인터랙션표 · bbox 좌표 변환)
//       wiki/design/Design Tokens.md §10-5 (뷰어는 양 테마에서 항상 다크)
//       wiki/design/Mobile UX Guide.md UX-20 (핀치줌 뷰어로 분리한 근거)
//
// ── 색 규칙 (국소 예외) ──────────────────────────────────────────────────────
// 배경·컨트롤 바는 **테마와 무관하게 항상 다크**다. 그래서 className(테마 종속)이 아니라
// `themes.dark` 토큰을 직접 읽는다 — HEX 는 여전히 `src/theme/tokens.ts` 한 곳에서만 나온다(§13-0).
// 반대로 **bbox 색만 테마를 따른다**(§10-5): 어두운 스캔 이미지 위에서 라이트 `action` 은 경계가 사라진다.
//
// ── 파라미터 계약 ────────────────────────────────────────────────────────────
//   uri          (필수) 절대 URL. 호출자가 `resolveImageUrl()` 로 이미 조립한 값이다.
//   title        접근성 라벨용 이름
//   docType      `TICKET` 이면 bbox 색이 티켓 색으로 바뀐다(원본 티켓 화면의 색 관계 보존)
//   blocks       `RawBlock[]` JSON 문자열. 없으면 bbox 레이어를 못 그린다
//   imageWidth / imageHeight  OCR `image_size`(리사이즈 1280 기준). 없으면 실제 이미지 크기로 폴백
//   boxes        `'1'` 이면 bbox 를 켠 채로 시작한다(스캔 경로). 기본은 OFF(보관함 경로)
//
// **보관함(SCR-19) 경로에서는 bbox 가 없다.** 앱 모델(`DocumentDetail`)이 `rawJson` 을 들고 있지
// 않기 때문이며(어댑터가 버린다), 명함은 애초에 `rawJson` 이 저장되지 않아 원본도 미지원이다.
// 그때는 토글이 비활성처럼 보이고 탭하면 사유를 토스트로 알린다(상태표 `빈(bbox 없음)`).
//
// ⤓ `사진에 저장`은 `expo-media-library` 가 없어(패키지 설치 금지) 이번 범위에서 제외한다.
//
// ── 린트 주의 ────────────────────────────────────────────────────────────────
// 제스처는 `useMemo` 로 고정한다. 공유값 변형(`scale.value = …`)에 대해 React Compiler 규칙
// (`react-hooks/immutability`)이 경고를 내지만 Reanimated 의 공식 관용구이며, 이 저장소의 기존
// 제스처 코드(`app/scan/crop.tsx`, `src/components/documents/SwipeableRow.tsx`)와 같은 형태다.
// 매 렌더마다 제스처를 새로 만들면 GestureDetector 가 핸들러를 재부착해 줌 중에 튄다.
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { toast } from '@/components/ui';
import { isDocumentType } from '@/features/documents';
import type { RawBlock } from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';
import { themes } from '@/theme/tokens';

/** 항상 다크인 화면이므로 라이트/다크 분기 없이 다크 토큰만 쓴다 (§10-5). */
const DARK = themes.dark;

const MIN_SCALE = 1;
const MAX_SCALE = 5;
/** 더블탭 확대 배율 (SCR-21 인터랙션표). */
const DOUBLE_TAP_SCALE = 2.5;
/** 경계 밖 고무줄 여유. 손을 떼면 범위 안으로 스프링 복귀한다. */
const RUBBER = 0.2;
/** 아래로 스와이프 닫기 임계 거리(dp). */
const DISMISS_DISTANCE = 120;
/** 컨트롤 자동 숨김 (와이어프레임 `3초 후 자동 숨김`). */
const CHROME_TIMEOUT_MS = 3000;

const COPY = {
  imageEmpty: '이미지가 없습니다',
  loadFailed: '이미지를 불러올 수 없습니다.',
  noBoxes: '인식된 텍스트 위치 정보가 없습니다.',
  copied: '복사했습니다.',
  retry: '다시 시도',
} as const;

/* ── 아이콘 ───────────────────────────────────────────────────────────────── */

function CloseIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6L18 18M18 6L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function BoxesIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={3.5} width={17} height={17} rx={2} stroke={color} strokeWidth={1.8} />
      <Path d="M3.5 10h17M10 3.5v17" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

function CopyIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={9} width={11} height={11} rx={2} stroke={color} strokeWidth={1.8} />
      <Path
        d="M15 5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v8A1.5 1.5 0 005.5 15"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function BrokenImageIcon({ color }: { color: string }) {
  return (
    <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4.5} width={18} height={15} rx={2} stroke={color} strokeWidth={1.6} />
      <Circle cx={8.5} cy={9.5} r={1.4} stroke={color} strokeWidth={1.6} />
      <Path d="M4 16l4.5-4 3.5 3 3-2.5L20 16" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

/* ── 유틸 ─────────────────────────────────────────────────────────────────── */

function first(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? '';
  return '';
}

/** `#0077B6` + 알파 → `rgba(...)`. bbox 채움은 테두리와 같은 색의 12% 다(§10-5). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const value = Number.parseInt(m[1] ?? '0', 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** 파라미터로 실려 온 `RawBlock[]` 복원. 깨진 JSON 은 조용히 빈 배열로 떨어뜨린다. */
function parseBlocks(raw: string): RawBlock[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RawBlock => {
      if (item === null || typeof item !== 'object') return false;
      const block = item as Partial<RawBlock>;
      return Array.isArray(block.bbox) && typeof block.text === 'string';
    });
  } catch {
    return [];
  }
}

/**
 * 4점 폴리곤 → `left/top/width/height` (원본 `renderBboxOverlay` 로직 이식).
 * 좌표계는 OCR `image_size` 가 정본이고, 없으면 실제 이미지 크기로 폴백한다.
 */
function boxOf(bbox: number[][], scaleX: number, scaleY: number) {
  const xs = bbox.map((point) => point[0] ?? 0);
  const ys = bbox.map((point) => point[1] ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    left: minX * scaleX,
    top: minY * scaleY,
    width: (Math.max(...xs) - minX) * scaleX,
    height: (Math.max(...ys) - minY) * scaleY,
  };
}

/* ── 화면 ─────────────────────────────────────────────────────────────────── */

export default function ImageViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const params = useLocalSearchParams<{
    uri?: string;
    title?: string;
    docType?: string;
    blocks?: string;
    imageWidth?: string;
    imageHeight?: string;
    boxes?: string;
  }>();

  const uri = first(params.uri);
  const title = first(params.title) || '이미지';
  const rawDocType = first(params.docType);
  const blocks = useMemo(() => parseBlocks(first(params.blocks)), [params.blocks]);

  /** OCR 이 리사이즈한 좌표계(1280 기준). 없으면 실제 이미지 크기로 폴백한다. */
  const ocrSize = useMemo(() => {
    const w = Number(first(params.imageWidth));
    const h = Number(first(params.imageHeight));
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
  }, [params.imageWidth, params.imageHeight]);

  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(uri === '');
  /** `다시 시도` 카운터. expo-image 는 같은 uri 를 실패 캐시로 기억하므로 key 를 바꿔 다시 붙인다. */
  const [reloadKey, setReloadKey] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [showBoxes, setShowBoxes] = useState(first(params.boxes) === '1');
  const [selected, setSelected] = useState<RawBlock | null>(null);
  /** 닫는 중 — `✕` 연타로 두 번 pop 되는 것을 막는다(스와이프 닫기는 제스처가 1회만 끝난다). */
  const [dismissing, setDismissing] = useState(false);
  const [offline, setOffline] = useState(false);

  // 실패 문구가 갈린다: 디스크 캐시 미스(오프라인)와 404 는 사용자가 할 수 있는 일이 다르다(상태표).
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  // 티켓 경로만 색 관계를 바꾼다(원본 티켓 화면 보존). 나머지는 `action`.
  const bboxColor =
    isDocumentType(rawDocType) && rawDocType === 'TICKET' ? t.doc.TICKET.fg : t.action.base;

  /* ── 닫기 ───────────────────────────────────────────────────────────────── */
  const close = useCallback(() => {
    setDismissing(true);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/archive');
  }, [router, setDismissing]);

  /* ── 컨트롤 자동 숨김 ─────────────────────────────────────────────────────
     실패 상태에서는 숨기지 않는다 — 볼 이미지가 없는 화면에서 `✕` 까지 사라지면
     탭으로 다시 불러내는 법을 모르는 사용자가 빠져나갈 길을 잃는다. */
  useEffect(() => {
    if (!chromeVisible || failed) return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [chromeVisible, failed]);

  /** 재시도 — 실패 플래그를 풀고 Image 를 새로 붙인다. */
  // 세터를 의존성에 적는다 — 이 파일의 `close`/`toggleChrome` 과 같은 규약이다
  // (React Compiler 의 `preserve-manual-memoization` 이 빠진 세터를 잡는다).
  const retryImage = useCallback(() => {
    setFailed(false);
    setReloadKey((prev) => prev + 1);
  }, [setFailed, setReloadKey]);

  const toggleChrome = useCallback(() => setChromeVisible((prev) => !prev), [setChromeVisible]);

  /* ── 제스처 ─────────────────────────────────────────────────────────────── */

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((event) => {
        // 경계에서 살짝 넘어가게 두고(고무줄) 손을 떼면 스프링으로 되돌린다.
        const next = savedScale.value * event.scale;
        scale.value = Math.min(MAX_SCALE * (1 + RUBBER), Math.max(MIN_SCALE * (1 - RUBBER), next));
      })
      .onEnd(() => {
        const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value));
        scale.value = withSpring(clamped, { damping: 20, stiffness: 200 });
        savedScale.value = clamped;
        if (clamped === MIN_SCALE) {
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          savedX.value = 0;
          savedY.value = 0;
        }
      });

    const pan = Gesture.Pan()
      .onUpdate((event) => {
        if (scale.value > MIN_SCALE) {
          translateX.value = savedX.value + event.translationX;
          translateY.value = savedY.value + event.translationY;
          return;
        }
        // 원배율에서는 세로 이동만 받는다 — 아래로 스와이프해 닫는 제스처다.
        translateY.value = event.translationY;
      })
      .onEnd((event) => {
        if (scale.value > MIN_SCALE) {
          savedX.value = translateX.value;
          savedY.value = translateY.value;
          return;
        }
        if (translateY.value > DISMISS_DISTANCE || event.velocityY > 1200) {
          runOnJS(close)();
          return;
        }
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        const zoomed = scale.value > MIN_SCALE + 0.01;
        const next = zoomed ? MIN_SCALE : DOUBLE_TAP_SCALE;
        scale.value = withTiming(next, { duration: 250 });
        savedScale.value = next;
        if (!zoomed) return;
        translateX.value = withTiming(0, { duration: 250 });
        translateY.value = withTiming(0, { duration: 250 });
        savedX.value = 0;
        savedY.value = 0;
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .onEnd(() => {
        runOnJS(toggleChrome)();
      });

    // 더블탭이 단일탭을 이긴다. 핀치/팬은 탭과 동시에 인식된다.
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [close, savedScale, savedX, savedY, scale, toggleChrome, translateX, translateY]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    // 아래로 스와이프하는 동안 배경까지 함께 옅어진다(인터랙션표 `배경 opacity 연동 dismiss`).
    opacity:
      scale.value > MIN_SCALE ? 1 : Math.max(0.4, 1 - Math.abs(translateY.value) / (DISMISS_DISTANCE * 4)),
  }));

  /* ── 기하 계산 (contain 렌더 결과 + bbox 스케일) ────────────────────────── */

  const geometry = useMemo(() => {
    if (!natural || container.width === 0 || container.height === 0) return null;
    const fit = Math.min(container.width / natural.width, container.height / natural.height);
    const width = natural.width * fit;
    const height = natural.height * fit;
    const source = ocrSize ?? natural;
    return {
      width,
      height,
      offsetX: (container.width - width) / 2,
      offsetY: (container.height - height) / 2,
      scaleX: width / source.width,
      scaleY: height / source.height,
    };
  }, [container.height, container.width, natural, ocrSize]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setContainer({ width, height });
    },
    [setContainer],
  );

  /* ── 액션 ───────────────────────────────────────────────────────────────── */

  const toggleBoxes = useCallback(() => {
    if (blocks.length === 0) {
      toast.info(COPY.noBoxes);
      return;
    }
    haptics.selection();
    setShowBoxes((prev) => {
      if (prev) setSelected(null);
      return !prev;
    });
  }, [blocks.length, setSelected, setShowBoxes]);

  const selectBlock = useCallback(
    (block: RawBlock) => {
      haptics.selection();
      setSelected((prev) => (prev?.block_index === block.block_index ? null : block));
    },
    [setSelected],
  );

  const copySelected = useCallback(() => {
    if (!selected) return;
    void Clipboard.setStringAsync(selected.text);
    toast.success(COPY.copied);
  }, [selected]);

  /* ── 렌더 ───────────────────────────────────────────────────────────────── */

  const boxesReady = showBoxes && geometry !== null && blocks.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg.sunken }}>
      <Stack.Screen
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          contentStyle: { backgroundColor: DARK.bg.sunken },
        }}
      />
      {/* 상태바 숨김 + light-content 고정 (SCR-21 라우트 행) */}
      <StatusBar hidden style="light" />

      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1 }, contentStyle]} onLayout={onLayout}>
          {failed ? null : (
            <>
              <Image
                key={reloadKey}
                source={{ uri }}
                contentFit="contain"
                // 저해상 캐시 → 원본 crossfade (상태표 `로딩`)
                transition={200}
                style={{ width: '100%', height: '100%' }}
                onLoad={(event) =>
                  setNatural({ width: event.source.width, height: event.source.height })
                }
                onError={() => setFailed(true)}
                accessibilityLabel={title}
              />

              {/* ── bbox 레이어 ─────────────────────────────────────────── */}
              {boxesReady
                ? blocks.map((block) => {
                    const box = boxOf(block.bbox, geometry.scaleX, geometry.scaleY);
                    if (box.width <= 0 || box.height <= 0) return null;
                    const active = selected?.block_index === block.block_index;
                    return (
                      <Pressable
                        key={block.block_index}
                        accessibilityRole="button"
                        accessibilityLabel={block.text}
                        onPress={() => selectBlock(block)}
                        style={{
                          position: 'absolute',
                          left: geometry.offsetX + box.left,
                          top: geometry.offsetY + box.top,
                          width: box.width,
                          height: box.height,
                          borderWidth: 2,
                          borderRadius: radius.xs,
                          borderColor: bboxColor,
                          backgroundColor: withAlpha(bboxColor, active ? 0.28 : 0.12),
                        }}
                      />
                    );
                  })
                : null}
            </>
          )}
        </Animated.View>
      </GestureDetector>

      {/* ── 실패 상태 (FR-109 에러 + 재시도) ─────────────────────────────────
          GestureDetector **밖**에 둔다. 안에 두면 부모의 단일탭 제스처(크롬 토글)와
          재시도 버튼의 press 가 같은 릴리즈를 두고 겨룬다. `box-none` 이라 버튼 밖의
          팬(아래로 스와이프해 닫기)은 그대로 아래 레이어로 흘러간다. */}
      {failed ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          className="items-center justify-center gap-3 px-8"
          pointerEvents="box-none"
        >
          <BrokenImageIcon color={DARK.text.muted} />
          <Text
            style={{ color: DARK.text.secondary, fontSize: 14, textAlign: 'center' }}
            accessibilityLiveRegion="polite"
          >
            {offline ? COPY.loadFailed : COPY.imageEmpty}
          </Text>

          {/* 주소 자체가 없으면 다시 부를 대상이 없다 — 그때는 버튼을 만들지 않는다. */}
          {uri === '' ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.retry}
              onPress={retryImage}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: spacing.xl,
                borderRadius: radius.button,
                backgroundColor: DARK.overlayImage,
                opacity: pressed ? 0.7 : 1,
              })}
              testID="viewer-retry"
            >
              <Text style={{ color: DARK.text.primary, fontSize: 15, fontWeight: '700' }}>
                {COPY.retry}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* ── 상단 컨트롤 (40dp 원형, 3초 무동작 시 사라진다) ──────────────── */}
      {chromeVisible ? (
        <View
          className="absolute left-0 right-0 flex-row items-center justify-between px-4"
          style={{ top: insets.top + spacing.sm }}
          pointerEvents="box-none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={close}
            disabled={dismissing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: DARK.overlayImage,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <CloseIcon color={DARK.text.primary} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="OCR 영역 표시"
            accessibilityState={{ selected: showBoxes, disabled: blocks.length === 0 }}
            onPress={toggleBoxes}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: DARK.overlayImage,
              // bbox 가 없으면 비활성으로 보이되, 탭하면 사유를 토스트로 알린다(상태표).
              opacity: blocks.length === 0 ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <BoxesIcon color={showBoxes ? t.action.base : DARK.text.primary} />
          </Pressable>
        </View>
      ) : null}

      {/* ── 하단 정보 바 (블록 선택 시에만) ──────────────────────────────── */}
      {selected ? (
        <View
          className="absolute left-0 right-0 px-4"
          style={{ bottom: insets.bottom + spacing.lg }}
          pointerEvents="box-none"
        >
          <View
            style={{
              minHeight: 64,
              borderRadius: radius.card,
              backgroundColor: DARK.overlayImage,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: DARK.text.primary, fontSize: 14 }} numberOfLines={2} selectable>
                {selected.text}
              </Text>
              <Text style={{ color: DARK.text.muted, fontSize: 11, marginTop: 2 }}>
                {/* 원문 포맷 그대로: `{(confidence*100).toFixed(1)}%` */}
                {`${(selected.confidence * 100).toFixed(1)}%`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="복사"
              onPress={copySelected}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => ({ marginLeft: spacing.md, opacity: pressed ? 0.6 : 1 })}
            >
              <CopyIcon color={DARK.text.primary} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
