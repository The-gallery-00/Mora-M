// app/scan/analyzing.tsx — SCR-11 · 스캔 · 분석 진행
//
// 정본: wiki/design/Screen Specs.md SCR-11 (와이어프레임 · 4스텝 라벨 · 상태표 · 인터랙션표)
//       wiki/tech/Camera and Scan.md §8 (업로드 UX · 취소 정책 · 백그라운드 규칙) · §13 (실패 표)
//
// ── 진행률 정직성 ────────────────────────────────────────────────────────────
// 서버는 단계별 콜백을 주지 않는다(단일 `POST /api/scan`). 그래서
//   · `sending` 구간만 **실측 바이트 진행률**(XHR upload.onprogress)로 determinate ProgressBar
//   · 업로드 100% 이후(서버 OCR 추론)는 **indeterminate** 로 전환한다 — 가짜 % 를 만들지 않는다
// 4개 스텝 인디케이터의 2~4번째 점등은 "진행률"이 아니라 대기 체감을 관리하는 **연출**이고,
// 그래서 퍼센트 숫자와 연결하지 않는다 (Screen Specs SCR-11 각주 · Mobile UX Guide).
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button, ProgressBar, toast } from '@/components/ui';
import { SCR11_STEP_LABELS, useScan, useScanStore } from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/** 와이어프레임의 미리보기 크기. */
const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 160;

/* ── 스텝 아이콘 ────────────────────────────────────────────────────────────
   lucide-react-native 는 설치하지 않는다(패키지 추가 금지). Lucide 공식 24×24 path 를
   react-native-svg 로 그대로 그린다 — crop.tsx / TextField.tsx 와 같은 방식이다.
   색은 className 이 SVG 에 닿지 않으므로 호출부가 토큰 객체를 넘긴다(tokens.ts §13-0). */

type StepIconProps = { color: string; size?: number };

/** lucide `upload` */
function UploadIcon({ color, size = 20 }: StepIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Path d="M17 8l-5-5-5 5" />
      <Path d="M12 3v12" />
    </Svg>
  );
}

/** lucide `eye` */
function EyeIcon({ color, size = 20 }: StepIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}

/** lucide `file-text` */
function FileTextIcon({ color, size = 20 }: StepIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <Path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <Path d="M16 13H8" />
      <Path d="M16 17H8" />
    </Svg>
  );
}

/** lucide `check` */
function CheckStepIcon({ color, size = 20 }: StepIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

/** 원본 웹 `처리 과정` 4스텝. 순서는 단계 라벨과 1:1 이다. */
const STEP_ICONS = [
  { key: 'upload', Icon: UploadIcon },
  { key: 'read', Icon: EyeIcon },
  { key: 'extract', Icon: FileTextIcon },
  { key: 'done', Icon: CheckStepIcon },
] as const;

/** §8 — 백그라운드 30초를 넘기면 태스크를 버리고 재시도 화면으로 전환한다. */
const BACKGROUND_LIMIT_MS = 30_000;
/** Android 백 2회 확인 간격. */
const BACK_CONFIRM_MS = 2500;
/** 연출용 스텝 점등 간격 (Screen Specs SCR-11 각주). */
const STAGE_INTERVAL_MS = 1600;

export default function ScanAnalyzingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const reduceMotion = useReducedMotion();

  const {
    adjustedUri,
    sourceUri,
    uploadPhase,
    uploadProgress,
    progressLabel,
    failure,
    failureMessage,
    canRetryScan,
    prepare,
    runScan,
    retryScan,
    cancelScan,
    enterManualEntry,
    resetForNextScan,
  } = useScan();

  const previewUri = adjustedUri ?? sourceUri;
  const [stageIndex, setStageIndex] = useState(0);
  // 성공 직후 `router.replace` 전 1프레임 동안 SCF-10 배너가 번쩍이는 것을 막는다.
  const [leaving, setLeaving] = useState(false);
  const startedRef = useRef(false);
  const backPressedAt = useRef(0);
  const scanLine = useSharedValue(0);

  const running = leaving || failure === null;

  /* ── 진입 즉시 압축 → 업로드 → OCR ───────────────────────────────────── */

  const start = useCallback(async () => {
    setStageIndex(0);
    const prepared = await prepare();
    if (!prepared) return; // SCF-03 / SCF-04 가 failure 로 올라간다
    const ok = await runScan();
    if (!ok) return; // 실패 또는 사용자 취소. 아래 에러 블록이 처리한다
    setLeaving(true);
    haptics.success();
    router.replace('/scan/review');
  }, [prepare, router, runScan]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!sourceUri) {
      router.replace('/scan');
      return;
    }
    void start();
  }, [router, sourceUri, start]);

  /* ── 스텝 연출: 업로드가 끝난 뒤부터 1.6초 간격으로 순차 점등 ──────────── */
  useEffect(() => {
    if (uploadPhase === 'sending') {
      setStageIndex(0);
      return;
    }
    if (uploadPhase === null) return;
    setStageIndex(1);
    const timer = setInterval(() => {
      setStageIndex((prev) => Math.min(STEP_ICONS.length - 1, prev + 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [uploadPhase]);

  /* ── 스캔 라인 상하 왕복 1.2s ───────────────────────────────────────── */
  useEffect(() => {
    if (reduceMotion || !running) return;
    scanLine.value = 0;
    scanLine.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [reduceMotion, running, scanLine]);

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanLine.value * (PREVIEW_HEIGHT - 2) }],
  }));

  /* ── 취소 ──────────────────────────────────────────────────────────── */

  const handleCancel = useCallback(() => {
    // 스캔은 부작용이 없다(서버가 임시파일을 finally 로 지운다) → 확인 다이얼로그 없이 즉시 취소.
    cancelScan();
    resetForNextScan();
    router.replace('/scan');
  }, [cancelScan, resetForNextScan, router]);

  /* ── Android 백: 진행 중 이탈 차단, 두 번 누르면 취소 ─────────────────── */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running) {
        // 에러 블록 상태에서는 백이 곧 `다른 사진 선택` 과 같다.
        handleCancel();
        return true;
      }
      const now = Date.now();
      if (now - backPressedAt.current < BACK_CONFIRM_MS) {
        handleCancel();
        return true;
      }
      backPressedAt.current = now;
      toast.info('한 번 더 누르면 분석을 취소합니다.');
      return true;
    });
    return () => sub.remove();
  }, [handleCancel, running]);

  /* ── 백그라운드 30초 초과 → 태스크 폐기 후 SCF-08 (§8) ────────────────── */
  useEffect(() => {
    let leftAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        leftAt = Date.now();
        return;
      }
      if (next !== 'active' || leftAt === null) return;
      const away = Date.now() - leftAt;
      leftAt = null;
      if (away <= BACKGROUND_LIMIT_MS) return;
      const state = useScanStore.getState();
      if (state.step !== 'uploading') return;
      state.cancelScan();
      // useScan 은 setFailure 를 노출하지 않는다(권한 실패 전용 API 로 설계됨) → 스토어에 직접 싣는다.
      state.setFailure({ code: 'SCF-08', status: null });
    });
    return () => sub.remove();
  }, []);

  /* ── 실패 액션 ─────────────────────────────────────────────────────── */

  const handleRetry = useCallback(async () => {
    setStageIndex(0);
    // 파일은 파기하지 않는다(§13 공통 규칙). prepared 가 없으면 압축부터 다시.
    if (!useScanStore.getState().prepared) {
      void start();
      return;
    }
    const ok = await retryScan();
    if (!ok) return;
    setLeaving(true);
    haptics.success();
    router.replace('/scan/review');
  }, [retryScan, router, start]);

  const handleManualEntry = useCallback(() => {
    // 문서 종류를 직접 고르고 빈 폼으로 진행한다 (SCF-10 `그래도 직접 입력` 과 같은 경로).
    enterManualEntry();
    router.replace('/scan/review');
  }, [enterManualEntry, router]);

  /* ── 렌더 ──────────────────────────────────────────────────────────── */

  const determinate = uploadPhase === 'sending';
  const stageLabel = SCR11_STEP_LABELS[stageIndex] ?? SCR11_STEP_LABELS[0];

  return (
    <View
      className="flex-1 bg-bg-base px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xxl }}
    >
      {/* ── 헤더: 취소 (상시 노출) ───────────────────────────────────── */}
      <View className="h-14 flex-row items-center justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="분석 취소"
          onPress={handleCancel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="h-11 justify-center"
        >
          <Text className="text-button font-w600 text-text-secondary">취소</Text>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center">
        {/* ── 미리보기 + 스캔 라인 ─────────────────────────────────── */}
        {previewUri ? (
          <View
            className="overflow-hidden border border-border-subtle bg-surface"
            style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, borderRadius: radius.card }}
          >
            <Image
              source={{ uri: previewUri }}
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
              accessibilityLabel="분석 중인 문서 이미지"
            />
            {running ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: t.action.base },
                  scanLineStyle,
                ]}
              />
            ) : null}
          </View>
        ) : null}

        {running ? (
          <>
            {/* ── 스텝 인디케이터 4개 ──────────────────────────────── */}
            <View
              className="mt-8 flex-row items-center"
              accessibilityRole="progressbar"
              accessibilityLabel={`문서 분석 ${stageIndex + 1}단계 / 4단계, ${stageLabel}`}
            >
              {STEP_ICONS.map(({ key, Icon }, index) => {
                const active = index <= stageIndex;
                return (
                  <View key={key} className="flex-row items-center">
                    <View
                      className={`h-11 w-11 items-center justify-center rounded-full border-2 ${
                        active ? 'border-action bg-surface-active' : 'border-border-subtle bg-surface'
                      }`}
                    >
                      {/* 아이콘에 accessibilityLabel 을 붙이지 않는다 — 부모 progressbar 가
                          `N단계 / 4단계, 라벨` 을 이미 읽는다. 붙이면 같은 정보를 5번 읽는다. */}
                      <Icon color={active ? t.action.base : t.text.disabled} />
                    </View>
                    {index < STEP_ICONS.length - 1 ? (
                      <View
                        className={`h-0.5 w-6 ${active ? 'bg-action' : 'bg-border-subtle'}`}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>

            <Text className="mt-6 text-h3 font-w700 text-brand">{stageLabel}</Text>
            <Text className="mt-1 text-body-sm text-text-muted">잠시만 기다려 주세요</Text>

            {/* determinate 는 실측 업로드 구간에서만. 그 뒤는 indeterminate. */}
            <View className="mt-6 w-full">
              <ProgressBar
                {...(determinate ? { progress: uploadProgress } : {})}
                height={6}
                tone="point"
                showLabel={determinate}
                accessibilityLabel={progressLabel ?? '문서 분석 중'}
              />
            </View>
          </>
        ) : (
          /* ── 실패 블록 (§13 매핑표 문구. 서버 원문은 노출하지 않는다) ── */
          <View className="mt-8 w-full items-center">
            <Text className="text-center text-h3 font-w700 text-text-primary">
              {failureMessage?.title ?? '문서를 인식하지 못했습니다.'}
            </Text>
            {failureMessage?.body ? (
              <Text className="mt-2 text-center text-body-sm text-text-muted">
                {failureMessage.body}
              </Text>
            ) : null}

            <View className="mt-6 w-full gap-2">
              {canRetryScan ? (
                <Button
                  label="다시 시도"
                  onPress={() => {
                    void handleRetry();
                  }}
                  variant="primary"
                  size="lg"
                  fullWidth
                />
              ) : null}
              <Button
                label="다른 사진 선택"
                onPress={handleCancel}
                variant="secondary"
                size="lg"
                fullWidth
                haptic="selection"
              />
              <Button
                label="그래도 직접 입력"
                onPress={handleManualEntry}
                variant="ghost"
                size="md"
                fullWidth
                haptic="selection"
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
