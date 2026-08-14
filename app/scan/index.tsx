// app/scan/index.tsx — SCR-09 · 스캔 · 카메라
//
// 정본: wiki/design/Screen Specs.md SCR-09 (와이어프레임 · 상태표 · 인터랙션표 · 도움말 시트 문구)
//       wiki/tech/Camera and Scan.md §3(권한) · §4(expo-camera 설정) · §4-2(pictureSize) ·
//                                    §4-3(가이드 오버레이) · §12(연속 스캔 카운터)
//       wiki/design/Mobile UX Guide.md §10(권한 3단 구조: pre-permission → OS → 설정 유도)
//
// ── 이 화면의 색 규칙 (Screen Specs 다크 국소 예외) ────────────────────────────
// 프리뷰가 화면 전체를 덮으므로 **오버레이 UI 는 테마와 무관하게 항상 다크**다.
// 그래서 여기서만 `bg-black/40` · `text-white` 같은 테마 비종속 유틸을 쓴다
// (CMP-02 IconButton 의 `variant="overlay"` 가 이미 같은 예외를 확립해 두었다).
// 반대로 **도움말 바텀시트는 테마를 따른다** — 프리뷰 위가 아니라 시트 표면 위의 읽기 콘텐츠다.
//
// ── 권한 훅을 화면이 직접 들고 있는 이유 ──────────────────────────────────────
// `useScan().ensureCameraPermission` 은 요청만 감싸고 **재조회(get)** 를 노출하지 않는다.
// 이 화면은 "설정 열기 → OS 설정에서 허용 → 앱 복귀" 경로에서 권한을 다시 읽어야 하므로
// (Mobile UX Guide §10 세부 4) `useCameraPermissions()` 의 3번째 반환값이 필요하다.
// 촬영본 수용/앨범/설정 열기 등 나머지는 전부 `useScan()` 을 통과한다.
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button, IconButton, toast } from '@/components/ui';
import { TYPE_LABELS, useScan, type DocumentType } from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/* ── 아이콘 (lucide 미설치 → react-native-svg 인라인) ───────────────────────── */

/**
 * 카메라 크롬 전경색. Screen Specs SCR-09 다크 예외가 "아이콘·힌트 텍스트·가이드 프레임·셔터는
 * 흰색 고정" 이라고 못박은 값이라 테마 토큰을 통과시키지 않는다.
 * `IconButton` 은 `color` prop 이 **비어 있을 때만** tone 색을 주입하므로 반드시 명시해서 넘긴다
 * (넘기지 않으면 다크에서 `text.inverse` = 어두운 색이 들어와 아이콘이 사라진다).
 */
const OVERLAY_FG = '#FFFFFF';

type IconProps = { color?: string; size?: number };

function CloseIcon({ color = '#FFFFFF', size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6L18 18M18 6L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function HelpIcon({ color = '#FFFFFF', size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path
        d="M9.6 9.3A2.5 2.5 0 0 1 14.5 10c0 1.7-2.5 2-2.5 3.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={17} r={1} fill={color} />
    </Svg>
  );
}

/** `off` 는 슬래시, `auto` 는 우하단 점으로 상태를 구분한다(색만으로 구분하지 않는다 — A11Y-08). */
function FlashIcon({ mode, color = '#FFFFFF', size = 22 }: IconProps & { mode: FlashMode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13 2L5 13.5H11L10 22L18.5 10H12.5L13 2Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {mode === 'off' ? (
        <Path d="M4 3L20 21" stroke={color} strokeWidth={2} strokeLinecap="round" />
      ) : null}
      {mode === 'auto' ? <Circle cx={20} cy={19} r={2} fill={color} /> : null}
    </Svg>
  );
}

function AlbumIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 5.5A2 2 0 0 1 5.5 3.5H18.5A2 2 0 0 1 20.5 5.5V18.5A2 2 0 0 1 18.5 20.5H5.5A2 2 0 0 1 3.5 18.5V5.5Z"
        stroke={color}
        strokeWidth={1.8}
      />
      <Circle cx={9} cy={9} r={1.6} stroke={color} strokeWidth={1.6} />
      <Path d="M4 17L9.5 11.5L14 16L16.5 13.5L20 17" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

function FlipIcon({ color = '#FFFFFF', size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9.5A7.5 7.5 0 0 1 17.5 6M20 14.5A7.5 7.5 0 0 1 6.5 18"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M17.5 2.5V6.5H13.5M6.5 21.5V17.5H10.5" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

/* ── 가이드 프레임 (Camera and Scan §4-3) ─────────────────────────────────────
   비율 정본은 Camera and Scan §4-3 이다. Screen Specs 인터랙션 표의 `명함 5:3 / 영수증 2:5 /
   포스터 3:4 / 티켓 5:2` 와 값이 다른데, 오버레이 규격을 소유한 문서가 Camera and Scan 이므로
   그쪽(1.75:1 / 1:2.2 / 1:1.414 / 1.6:1)을 따른다. */

type GuideDocMode = Extract<DocumentType, 'BUSINESS_CARD' | 'POSTER' | 'RECEIPT' | 'TICKET'>;
type GuideMode = 'auto' | GuideDocMode;

/** 가로:세로 비율. `auto` 는 프레임 없이 4모서리 마커만 그린다. */
const GUIDE_RATIO: Record<GuideMode, number | null> = {
  auto: null,
  BUSINESS_CARD: 1.75,
  RECEIPT: 1 / 2.2,
  POSTER: 1 / 1.414,
  TICKET: 1.6,
};

/** 하단 힌트 1줄. 조사가 종류마다 달라 문자열을 통째로 적는다. */
const GUIDE_HINT: Record<GuideMode, string> = {
  auto: '빛 반사가 없도록 정면에서 촬영하세요',
  BUSINESS_CARD: '명함을 프레임에 맞춰 정면에서 촬영하세요',
  POSTER: '포스터를 프레임에 맞춰 정면에서 촬영하세요',
  RECEIPT: '영수증을 프레임에 맞춰 정면에서 촬영하세요',
  TICKET: '티켓을 프레임에 맞춰 정면에서 촬영하세요',
};

const GUIDE_CHIPS: GuideDocMode[] = ['BUSINESS_CARD', 'POSTER', 'RECEIPT', 'TICKET'];

/** 프레임 기준 폭 = 화면 폭의 88% (§4-3). */
const FRAME_WIDTH_RATIO = 0.88;
/** 세로로 긴 영수증 프레임이 컨트롤을 덮지 않도록 하는 상한. */
const FRAME_MAX_HEIGHT_RATIO = 0.86;

type FlashMode = 'off' | 'on' | 'auto';
const FLASH_ORDER: FlashMode[] = ['off', 'on', 'auto'];
const FLASH_LABEL: Record<FlashMode, string> = {
  off: '플래시 끔',
  on: '플래시 켬',
  auto: '플래시 자동',
};

/** §4-2 — 4:3 이면서 장변이 1600~2400px 구간에 있는 가장 작은 값. 없으면 undefined. */
function pickPictureSize(sizes: readonly string[]): string | undefined {
  let best: { size: string; long: number } | null = null;
  for (const raw of sizes) {
    const parts = raw.split('x');
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    // 4:3 판정은 부동소수 오차를 감안해 ±1% 허용
    if (Math.abs(long / short - 4 / 3) > 0.04) continue;
    if (long < 1600 || long > 2400) continue;
    if (!best || long < best.long) best = { size: raw, long };
  }
  return best?.size;
}

export default function ScanCameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const reduceMotion = useReducedMotion();

  const { acceptCapture, pickFromLibrary, openAppSettings, sessionSavedCount, setDocTypeHint } =
    useScan();
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [guideMode, setGuideMode] = useState<GuideMode>('auto');
  const [offline, setOffline] = useState(false);
  const [guideBox, setGuideBox] = useState({ width: 0, height: 0 });
  const [helpSheetOpen, setHelpSheetOpen] = useState(false);

  const shutterFlash = useSharedValue(0);

  /* ── 권한 재조회: 설정에서 허용하고 돌아온 경우를 잡는다 (UX 가이드 §10 세부 4) ── */
  useFocusEffect(
    useCallback(() => {
      void getPermission();
    }, [getPermission]),
  );

  /* ── 오프라인 배너 ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    return unsubscribe;
  }, []);

  /* ── §4-2 pictureSize 선택. 프리뷰 준비 이후 1회만 조회한다. ────────────── */
  useEffect(() => {
    if (!ready || pictureSize !== undefined) return;
    let alive = true;
    void (async () => {
      try {
        const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
        if (!alive || !sizes || sizes.length === 0) return;
        const chosen = pickPictureSize(sizes);
        if (chosen) setPictureSize(chosen);
      } catch {
        // 기기에 따라 미지원. 플랫폼 기본값으로 촬영한다.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, pictureSize]);

  /* ── 촬영 시 흰 섬광 80ms (Screen Specs 인터랙션 표) ────────────────────── */
  const flashStyle = useAnimatedStyle(() => ({ opacity: shutterFlash.value }));

  const frame = useMemo(() => {
    const ratio = GUIDE_RATIO[guideMode];
    if (ratio === null || guideBox.width === 0 || guideBox.height === 0) return null;
    let width = guideBox.width * FRAME_WIDTH_RATIO;
    let height = width / ratio;
    const maxHeight = guideBox.height * FRAME_MAX_HEIGHT_RATIO;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    return {
      width,
      height,
      x: (guideBox.width - width) / 2,
      y: (guideBox.height - height) / 2,
    };
  }, [guideMode, guideBox]);

  const closeScan = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const handleShutter = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || !ready || capturing) return;

    setCapturing(true);
    haptics.impact('medium');
    if (!reduceMotion) {
      shutterFlash.value = withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: 80, easing: Easing.out(Easing.quad) }),
      );
    }

    try {
      // §4 촬영 옵션 — quality 는 넉넉히(최종 압축은 SCAN-04), skipProcessing:false 로 회전 보정,
      // exif/base64 는 false (GPS 제거 + 힙 폭증 방지).
      const photo: CameraCapturedPicture | undefined = await camera.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        exif: false,
        base64: false,
      });
      if (!photo?.uri) throw new Error('empty capture');
      acceptCapture(photo);
      router.push('/scan/crop');
    } catch {
      toast.error('촬영에 실패했습니다.');
    } finally {
      setCapturing(false);
    }
  }, [acceptCapture, capturing, ready, reduceMotion, router, shutterFlash]);

  /** 앨범 열기 본체. 권한 거부만 SCF-02 안내로 올린다(단순 취소는 조용히 종료). */
  const openAlbum = useCallback(async () => {
    const outcome = await pickFromLibrary();
    if (outcome === 'selected') {
      router.push('/scan/crop');
      return;
    }
    if (outcome === 'denied') {
      Alert.alert('사진 접근 권한이 필요합니다.', '설정에서 사진 접근을 허용해 주세요.', [
        { text: '닫기', style: 'cancel' },
        { text: '설정 열기', onPress: openAppSettings },
      ]);
    }
  }, [openAppSettings, pickFromLibrary, router]);

  /**
   * UX 가이드 §10 — 앨범도 pre-permission 설명을 **OS 다이얼로그보다 먼저** 보여준다.
   * 이미 허용된 상태면 설명을 건너뛴다(매번 띄우면 방해가 된다).
   */
  const handleAlbumPress = useCallback(async () => {
    haptics.selection();
    let alreadyGranted = false;
    try {
      alreadyGranted = (await ImagePicker.getMediaLibraryPermissionsAsync()).granted;
    } catch {
      alreadyGranted = false;
    }
    if (alreadyGranted) {
      await openAlbum();
      return;
    }
    Alert.alert('앨범에서 사진을 불러올게요', '선택한 사진만 읽습니다. 앨범 전체를 열어보지 않아요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '앨범 열기',
        onPress: () => {
          void openAlbum();
        },
      },
    ]);
  }, [openAlbum]);

  const cycleFlash = useCallback(() => {
    setFlash((prev) => {
      const next = FLASH_ORDER[(FLASH_ORDER.indexOf(prev) + 1) % FLASH_ORDER.length] ?? 'off';
      return next;
    });
    haptics.selection();
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    haptics.selection();
  }, []);

  const selectGuide = useCallback(
    (mode: GuideMode) => {
      // 선택된 칩을 한 번 더 누르면 `자동` 으로 돌아간다.
      // 다음 값을 **업데이터 밖에서** 계산한다 — setState 업데이터는 순수해야 하고,
      // StrictMode 는 그것을 두 번 호출한다(그 안에서 스토어를 건드리면 두 번 쓴다).
      const next: GuideMode = guideMode === mode ? 'auto' : mode;
      setGuideMode(next);

      /* 이 칩은 **프레임 비율 힌트만이 아니다.** 서버 OCR 에는 문서 종류 분류기가
         없어서, 여기서 고른 종류가 그대로 `/api/scan` 의 document_type 이 되고
         종류별 파서를 결정한다. 넘기지 않으면 무엇을 찍든 명함 파서가 돌아
         포스터·영수증·티켓·청첩장은 필드가 하나도 채워지지 않는다.
         `auto` 는 null 로 넘겨 서버 기본값(BUSINESS_CARD)에 맡긴다 — 그 경우에도
         결과 화면에서 종류를 바꾸면 그때 다시 파싱된다. */
      setDocTypeHint(next === 'auto' ? null : next);
      haptics.selection();
    },
    [guideMode, setDocTypeHint],
  );

  /* ── 권한 미확정 / 미허용 화면 (테마 무관 다크 배경) ─────────────────────── */

  if (!permission) {
    // 권한 상태 조회 중. Screen Specs 로딩 상태 = 검은 화면 + 스피너.
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (!permission.granted) {
    const canAsk = permission.canAskAgain;
    return (
      <View
        className="flex-1 bg-black px-6"
        style={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl }}
      >
        <StatusBar style="light" />

        <View className="h-11 flex-row items-center">
          <IconButton
            icon={<CloseIcon color={OVERLAY_FG} />}
            onPress={closeScan}
            variant="overlay"
            size="md"
            accessibilityLabel="스캔 닫기"
          />
        </View>

        <View className="flex-1 items-center justify-center">
          {/* pre-permission(UX 가이드 §10) 과 권한거부(Screen Specs 상태표)의 문구를 상태별로 나눈다.
              OS 다이얼로그를 먼저 띄우는 경로는 만들지 않는다 — 3단 구조 강제. */}
          <Text className="text-center text-h2 font-w700 text-white">
            {canAsk ? '카메라로 문서를 찍어 주세요' : '카메라 권한이 필요합니다.'}
          </Text>
          <Text className="mt-3 text-center text-base text-white/80">
            {canAsk
              ? '명함·티켓·포스터·영수증을 촬영하면 MORA가 내용을 읽어 정리합니다. 사진은 문서 인식에만 사용돼요.'
              : '설정에서 카메라 접근을 허용하면 문서를 촬영할 수 있어요.'}
          </Text>

          <View className="mt-8 w-full items-center gap-3">
            <Button
              label={canAsk ? '카메라 권한 허용' : '설정 열기'}
              onPress={() => {
                if (canAsk) void requestPermission();
                else openAppSettings();
              }}
              variant="primary"
              size="lg"
              fullWidth
            />
            <Button
              label={canAsk ? '앨범에서 고르기' : '앨범에서 선택'}
              onPress={() => {
                void handleAlbumPress();
              }}
              variant="secondary"
              size="lg"
              fullWidth
              haptic="selection"
            />
          </View>
        </View>
      </View>
    );
  }

  /* ── 카메라 화면 ───────────────────────────────────────────────────────── */

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />

      {mountError ? null : (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          ratio="4:3"
          {...(pictureSize ? { pictureSize } : {})}
          flash={flash}
          autofocus="on"
          zoom={0}
          animateShutter={false} // 셔터 연출은 아래 흰 섬광 + 햅틱이 담당한다
          onCameraReady={() => setReady(true)}
          onMountError={() => setMountError(true)}
        />
      )}

      {/* 촬영 흰 섬광 80ms */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, flashStyle]}
      />

      <View className="flex-1" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {/* ── 상단 컨트롤 바 ─────────────────────────────────────────────── */}
        <View className="h-14 flex-row items-center justify-between px-4">
          <IconButton
            icon={<CloseIcon color={OVERLAY_FG} />}
            onPress={closeScan}
            variant="overlay"
            size="md"
            accessibilityLabel="스캔 닫기"
          />

          {sessionSavedCount > 0 ? (
            // §12 연속 스캔 루프 카운터
            <View className="rounded-full px-3 py-1" style={{ backgroundColor: t.overlayImage }}>
              <Text className="text-label font-w600 text-white" maxFontSizeMultiplier={1.2}>
                {`이번 세션 ${sessionSavedCount}장 저장됨`}
              </Text>
            </View>
          ) : (
            <View />
          )}

          <View className="flex-row items-center gap-2">
            <IconButton
              icon={<FlashIcon mode={flash} color={OVERLAY_FG} />}
              onPress={cycleFlash}
              variant="overlay"
              size="md"
              accessibilityLabel={`플래시 ${FLASH_LABEL[flash]}, 눌러서 변경`}
            />
            <IconButton
              icon={<HelpIcon color={OVERLAY_FG} />}
              onPress={() => setHelpSheetOpen(true)}
              variant="overlay"
              size="md"
              accessibilityLabel="촬영 가이드 도움말"
            />
          </View>
        </View>

        {offline ? (
          <View className="mx-4 rounded-btn px-3 py-2" style={{ backgroundColor: t.overlayImage }}>
            <Text className="text-body-sm text-white">오프라인입니다. 연결되면 분석을 시작합니다.</Text>
          </View>
        ) : null}

        {/* ── 가이드 프레임 영역 ─────────────────────────────────────────── */}
        <View
          className="flex-1"
          onLayout={(e) =>
            setGuideBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
          }
          pointerEvents="none"
        >
          {mountError ? null : frame ? (
            <>
              {/* 프레임 밖 마스크 4장 */}
              <View className="absolute left-0 right-0 top-0 bg-black/40" style={{ height: frame.y }} />
              <View className="absolute bottom-0 left-0 right-0 bg-black/40" style={{ top: frame.y + frame.height }} />
              <View
                className="absolute left-0 bg-black/40"
                style={{ top: frame.y, height: frame.height, width: frame.x }}
              />
              <View
                className="absolute right-0 bg-black/40"
                style={{ top: frame.y, height: frame.height, width: frame.x }}
              />
              {/* 프레임 라인 2dp + 모서리 L 마커 */}
              <View
                className="absolute"
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height,
                  borderWidth: 2,
                  borderColor: t.action.base,
                  borderRadius: radius.sm,
                }}
              />
              <CornerMarkers
                x={frame.x}
                y={frame.y}
                width={frame.width}
                height={frame.height}
                color={t.action.base}
                length={12}
                thickness={3}
              />
              <Text
                className="absolute text-center text-body-sm text-white/80"
                style={{ top: frame.y + frame.height + spacing.md, left: 0, right: 0 }}
              >
                {GUIDE_HINT[guideMode]}
              </Text>
            </>
          ) : (
            // `자동` — 프레임 없이 화각 4모서리 마커만 (Screen Specs 와이어프레임: 흰색 24dp L자)
            guideBox.width > 0 && (
              <>
                <CornerMarkers
                  x={spacing.xxl}
                  y={spacing.xxl}
                  width={guideBox.width - spacing.xxl * 2}
                  height={guideBox.height - spacing.giant * 2}
                  color="#FFFFFF"
                  length={24}
                  thickness={3}
                />
                <Text
                  className="absolute text-center text-body-sm text-white/80"
                  style={{ bottom: spacing.md, left: 0, right: 0 }}
                >
                  {GUIDE_HINT.auto}
                </Text>
              </>
            )
          )}
        </View>

        {/* ── 카메라 초기화 실패 (Screen Specs 에러 상태) ──────────────────── */}
        {mountError ? (
          <View className="absolute inset-0 items-center justify-center px-6">
            <Text className="text-center text-h3 font-w700 text-white">카메라를 사용할 수 없습니다.</Text>
            <Text className="mt-2 text-center text-body-sm text-white/80">
              앨범에서 사진을 선택해 주세요.
            </Text>
            <View className="mt-6">
              <Button
                label="앨범 열기"
                onPress={() => {
                  void handleAlbumPress();
                }}
                variant="primary"
                size="md"
              />
            </View>
          </View>
        ) : null}

        {/* ── 문서 유형 칩 ────────────────────────────────────────────────
            프레임 비율·안내문구뿐 아니라 **서버가 어느 파서를 돌릴지**를 정한다
            (서버에 문서 종류 분류기가 없다 — selectGuide 주석 참조).
            선택은 여전히 선택 사항이고, 결과 화면에서 언제든 바꿔 다시 파싱할 수 있다. */}
        <View className="flex-row items-center justify-center gap-2 px-4 pb-3">
          {GUIDE_CHIPS.map((mode) => {
            const selected = guideMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`${TYPE_LABELS[mode]} 가이드`}
                accessibilityState={{ selected }}
                onPress={() => selectGuide(mode)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                className="h-8 items-center justify-center rounded-full px-3"
                style={{ backgroundColor: selected ? t.action.base : t.overlayImage }}
              >
                <Text className="text-label font-w700 text-white" maxFontSizeMultiplier={1.2}>
                  {TYPE_LABELS[mode]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── 하단: 앨범 / 셔터 72dp / 카메라 전환 ─────────────────────────── */}
        <View className="h-24 flex-row items-center justify-between px-8">
          <IconButton
            icon={<AlbumIcon color={OVERLAY_FG} />}
            onPress={() => {
              void handleAlbumPress();
            }}
            variant="overlay"
            size="lg"
            accessibilityLabel="앨범에서 사진 선택"
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="촬영"
            accessibilityState={{ disabled: !ready || capturing || mountError, busy: capturing }}
            disabled={!ready || capturing || mountError}
            onPress={() => {
              void handleShutter();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="items-center justify-center rounded-full"
            style={{
              width: 72,
              height: 72,
              borderWidth: 4,
              borderColor: '#FFFFFF',
              opacity: !ready || mountError ? 0.5 : 1,
            }}
          >
            <View
              className="rounded-full"
              style={{ width: 56, height: 56, backgroundColor: '#FFFFFF' }}
            />
          </Pressable>

          <IconButton
            icon={<FlipIcon color={OVERLAY_FG} />}
            onPress={toggleFacing}
            variant="overlay"
            size="lg"
            accessibilityLabel={facing === 'back' ? '전면 카메라로 전환' : '후면 카메라로 전환'}
          />
        </View>
      </View>

      {/* ── 도움말 바텀시트 (CMP-17) — 여기만 테마를 따른다 ─────────────────── */}
      {helpSheetOpen ? (
        <BottomSheet
          index={0}
          snapPoints={['52%']}
          enablePanDownToClose
          onClose={() => setHelpSheetOpen(false)}
          backgroundStyle={{ backgroundColor: t.bg.elevated, borderRadius: radius.sheet }}
          handleIndicatorStyle={{ backgroundColor: t.border.subtle }}
          backdropComponent={(props) => (
            <BottomSheetBackdrop
              {...props}
              appearsOnIndex={0}
              disappearsOnIndex={-1}
              opacity={0.5}
              pressBehavior="close"
            />
          )}
        >
          <BottomSheetView style={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}>
            <Text className="text-h3 font-w700 text-text-primary">촬영 가이드</Text>

          <View className="mt-4 gap-2">
            <HelpLine text="선명하고 깨끗한 이미지 사용을 권장합니다." />
            <HelpLine text="빛 반사나 그림자가 없는 정면 촬영을 권장합니다." />
            <HelpLine text="텍스트가 잘 보이도록 고해상도 이미지를 사용하세요." />
          </View>

          <Text className="mt-6 text-body-sm font-w700 text-text-secondary">지원 형식</Text>
          <View className="mt-2 gap-2">
            <HelpLine text="JPG, PNG 지원" />
            {/* 원본 웹의 `최대 20MB` 는 서버 한도(10MB)와 불일치한 오표기다 (부록 B #11). */}
            <HelpLine text="최대 10MB" />
          </View>
          </BottomSheetView>
        </BottomSheet>
      ) : null}
    </View>
  );
}

function HelpLine({ text }: { text: string }) {
  return (
    <View className="flex-row items-start gap-2">
      <View className="mt-2 h-1 w-1 rounded-full bg-text-muted" />
      <Text className="flex-1 text-base text-text-secondary">{text}</Text>
    </View>
  );
}

/** L자 모서리 마커 4개. 프레임 라인과 별개로 화각 기준점을 준다. */
function CornerMarkers({
  x,
  y,
  width,
  height,
  color,
  length,
  thickness,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  length: number;
  thickness: number;
}) {
  // [모서리 위치, 가로 막대가 붙는 변, 세로 막대가 붙는 변]
  const corners: { left: number; top: number; hTop: boolean; vLeft: boolean }[] = [
    { left: x, top: y, hTop: true, vLeft: true },
    { left: x + width - length, top: y, hTop: true, vLeft: false },
    { left: x, top: y + height - length, hTop: false, vLeft: true },
    { left: x + width - length, top: y + height - length, hTop: false, vLeft: false },
  ];

  return (
    <>
      {corners.map((c) => (
        <View
          key={`${c.left}-${c.top}`}
          className="absolute"
          style={{ left: c.left, top: c.top, width: length, height: length }}
        >
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: length,
              height: thickness,
              backgroundColor: color,
              ...(c.hTop ? { top: 0 } : { bottom: 0 }),
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              width: thickness,
              height: length,
              backgroundColor: color,
              ...(c.vLeft ? { left: 0 } : { right: 0 }),
            }}
          />
        </View>
      ))}
    </>
  );
}

