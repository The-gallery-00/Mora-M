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
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { variant } from '@/config/env';
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

/**
 * 스캔 흐름을 완전히 벗어날 때의 착지점.
 *
 * `/scan` 스택은 `fullScreenModal` 이고 이 화면은 크롭에서 `replace` 로 들어오므로 스택이
 * `[/scan, /scan/analyzing]` 이다 → `router.back()` 은 **카메라로 되돌아갈 뿐** 흐름을 끝내지 않는다.
 * SCR-13 의 `완료` 버튼(`done.tsx goHome`)과 같은 방식으로 탭 루트로 replace 해서 스택째 벗어난다.
 * 스토어 비우기는 `app/scan/_layout.tsx` 의 언마운트 이펙트가 담당한다.
 */
const HOME_HREF = '/(tabs)' as Href;

/**
 * `(dev)` 그룹(진단 화면 SCR-31)이 이 빌드에 존재하는가.
 *
 * **production 에서는 액션 자체를 그리지 않는다.** `app/(dev)/_layout.tsx` 에 이미
 * `variant === 'production'` 가드가 있지만, 그건 **화면에 들어온 뒤** 되돌려 보내는 장치다.
 * 그 되돌림이 `<Redirect>`(= 내비게이션 replace)였을 때는 `/scan` 모달 스택이 통째로 사라지면서
 * 압축이 끝난 `prepared` 이미지 · `failure` · 재시도 카운트가 함께 날아갔다 —
 * 스토어 빌드에서 Wi-Fi 를 끊고 스캔을 실패시킨 뒤 `서버 주소 확인` 을 누르면
 * **진단 화면 대신 홈으로 튕기면서 하던 작업이 사라졌다.** 사용자 입장에서 그 버튼은
 * "작업 삭제" 버튼이었다. 지금은 그 가드도 되도록 `back()` 으로 물러나게 고쳤지만,
 * 어차피 **못 가는 곳으로 데려가는 버튼**이므로 여기서는 진입점을 아예 만들지 않는다.
 * (가드 쪽은 딥링크 같은 미지의 경로를 위한 심층 방어로만 남긴다.)
 *
 * 판정은 `__DEV__` 가 아니라 `variant` 다 — 릴리스로 빌드한 preview APK 는 팀 내부 테스트용이라
 * 이 버튼이 **있어야** 한다(`(dev)/_layout.tsx` 주석과 같은 기준).
 *
 * 버튼이 빠져도 안내가 빈약해지지 않는지 §13 표로 확인했다(`features/scan/useScan.ts`):
 *  · SCF-06 — 제목 `백엔드 서버에 연결할 수 없습니다.` + 부제 `PC와 같은 Wi-Fi에 연결되어…` 가
 *    원인을 그대로 말하고, 남는 버튼은 `다시 시도`* · `다른 사진 선택` · `직접 입력` 이다.
 *  · SCF-09(업스트림 4xx) — 제목/부제가 "다시 시도해도 같은 결과" 를 명시하고,
 *    1순위 `직접 입력` 이 흐름을 계속할 수 있게 남는다.
 *    (재촬영 계열 버튼은 이 갈래에 **의도적으로 없다** — 아래 `failureActions` 규칙 ② 참조.)
 * 두 경우 모두 막다른 골목이 되지 않는다.
 */
const DIAGNOSTICS_AVAILABLE = variant !== 'production';

/**
 * 실패 블록 버튼 1개.
 *
 * `label` 은 §13 표(또는 이 화면의 보충 액션)에서 오고, `kind` 는 **실제 동작**이다.
 * 둘을 분리해 들고 다니는 이유: 중복 제거를 `label` 로 하면 라벨만 다른 쌍둥이 버튼이 생기고,
 * `onPress` 함수 동일성으로 하면 표에 있는 라벨이 통째로 사라진다(아래 `failureActions` 주석).
 */
type FailureActionKind =
  | 'retry'
  | 'retake'
  /** 앨범 피커를 **실제로 연다**. `retake`(촬영 화면 복귀)와 착지점이 다르므로 분리한다. */
  | 'album'
  | 'manual'
  | 'diagnostics'
  | 'settings'
  | 'dismiss';
type FailureAction = { label: string; kind: FailureActionKind; onPress: () => void };

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
    openAppSettings,
    pickFromLibrary,
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

  /* ── 이탈 경로 두 가지 ────────────────────────────────────────────────
     1차 수정은 `취소`·`다시 촬영`·`다른 사진 선택`·`앨범에서 선택` 을 **전부 같은 핸들러**
     (촬영 화면 복귀)로 묶었다. 그 결과 `취소` 라벨이 카메라를 다시 열어 라벨과 동작이 어긋났고,
     핸들러 동일성 기반 중복 제거 때문에 `취소` 가 있는 실패 코드(SCF-07/08 등)에서
     `다른 사진 선택` 버튼이 통째로 사라졌다. 그래서 **동작을 둘로 갈라** 이름을 붙인다. */

  /**
   * 진행 중인 요청을 끊고 **촬영 화면(SCR-09)으로 되돌아간다.**
   * Screen Specs SCR-11 인터랙션표의 `취소` 행(`abort()` → SCR-09 복귀) 그대로이며,
   * 실패 블록의 `다시 촬영` / `다른 사진 선택` / `앨범에서 선택` 도 같은 곳에 착지한다.
   * 스캔은 부작용이 없다(서버가 임시파일을 finally 로 지운다) → 확인 다이얼로그 없이 즉시 끊는다.
   */
  const abortToCamera = useCallback(() => {
    cancelScan();
    resetForNextScan();
    router.replace('/scan');
  }, [cancelScan, resetForNextScan, router]);

  /**
   * **스캔 흐름 자체를 끝낸다.** 실패 블록의 `취소` / `닫기` 가 여기로 온다.
   *
   * 판단 근거: 이 화면에는 이미 "파일을 버리고 다시 찍는다" 를 뜻하는 라벨이 따로 있다
   * (`다시 촬영` · `다른 사진 선택`). 그 옆의 `취소` 까지 카메라를 다시 열면 두 버튼이 같은 일을
   * 하면서 라벨만 다른 상태가 되고, 사용자가 "그만두겠다" 고 누른 버튼이 다음 촬영을 권하는
   * 화면을 띄운다. §13 표에서 `취소` 는 `다시 시도` 의 반대편(= 포기)에 놓인 액션이므로
   * 흐름 종료로 해석한다. SCR-09 의 `✕ 닫기` 와 같은 착지점이다.
   */
  const dismissScan = useCallback(() => {
    cancelScan();
    resetForNextScan();
    router.replace(HOME_HREF);
  }, [cancelScan, resetForNextScan, router]);

  /* ── Android 백: 진행 중 이탈 차단, 두 번 누르면 취소 ─────────────────── */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running) {
        // 에러 블록 상태에서는 백이 곧 `다른 사진 선택` 과 같다(한 단계 뒤 = 촬영 화면).
        // 흐름 종료는 헤더 `닫기` 와 실패 블록의 `취소` 가 담당한다.
        abortToCamera();
        return true;
      }
      const now = Date.now();
      if (now - backPressedAt.current < BACK_CONFIRM_MS) {
        abortToCamera();
        return true;
      }
      backPressedAt.current = now;
      toast.info('한 번 더 누르면 분석을 취소합니다.');
      return true;
    });
    return () => sub.remove();
  }, [abortToCamera, running]);

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

  /**
   * `앨범에서 선택` — **라벨대로 앨범 피커를 연다** (2026-08-05 4차 · R7).
   *
   * 종전에는 `앨범에서 선택` / `카메라로 촬영` 이 둘 다 `abortToCamera`(촬영 화면 복귀)에
   * 묶여 있었다. `카메라로 촬영` 은 착지점이 실제로 카메라라 맞지만, `앨범에서 선택` 은
   * 라벨이 약속한 앨범 대신 카메라를 열었다 — §13 라벨 어휘 약속과 어긋난다.
   * (SCF-01/02 는 실제로는 촬영 화면에서 뜨므로 이 화면에서 거의 볼 일이 없지만,
   *  "라벨이 약속한 동작이 실제로 일어나지 않는" 상태를 남겨 두지 않는다.)
   *
   * 결과 처리는 촬영 화면(`app/scan/index.tsx openAlbum`)과 같은 규칙이다:
   *  · selected — `setSource` 가 실패를 지우고 원본을 갈아끼운다 → 크롭 화면으로.
   *  · canceled — 사용자가 스스로 닫았다. 아무것도 하지 않는다(실패 블록 그대로 유지).
   *  · denied   — `pickFromLibrary` 가 SCF-02 를 스토어에 싣는다 → 이 화면의 실패 블록이
   *               `설정 열기` · `카메라로 촬영` 안내로 바뀐다. 막다른 길이 아니다.
   */
  const openAlbum = useCallback(async () => {
    const outcome = await pickFromLibrary();
    if (outcome === 'selected') router.replace('/scan/crop');
  }, [pickFromLibrary, router]);

  const handleManualEntry = useCallback(() => {
    // 문서 종류를 직접 고르고 빈 폼으로 진행한다 (SCF-10 `그래도 직접 입력` 과 같은 경로).
    enterManualEntry();
    router.replace('/scan/review');
  }, [enterManualEntry, router]);

  /** SCF-06 `서버 주소 확인` — SCR-31 진단 화면에서 백엔드·OCR 주소를 확인/교체한다 (FR-121). */
  const openDiagnostics = useCallback(() => {
    router.push('/(dev)/diagnostics');
  }, [router]);

  /* ── 실패 액션 목록 (§13 표를 실제로 렌더한다) ────────────────────────
     예전에는 `describeFailure` 가 만들어 준 `actions` 를 통째로 버리고 고정 버튼 3개만 그렸다.
     그래서 SCF-06 의 `서버 주소 확인` 처럼 원인 추적에 직결되는 액션이 화면에 존재하지 않았다. */

  /**
   * §13 액션 라벨 → 이 화면이 실제로 수행할 수 있는 동작.
   * 해석되지 않는 라벨(SCF-07 의 `이미지 없이 저장` = 저장 단계 전용, SCF-13 의 `로그인` 등)은
   * `null` 을 돌려 목록에서 빠진다. 눌러도 아무 일이 없는 버튼을 그리는 것이 더 나쁜 거짓 신호다.
   *
   * **라벨과 동작은 반드시 일치시킨다.** 특히 `취소` 는 `다시 촬영` 과 다른 동작(`dismiss`)이다 —
   * 1차 수정이 둘을 같은 핸들러로 묶어 만든 회귀를 여기서 되돌린다.
   */
  const resolveAction = useCallback(
    (label: string): Omit<FailureAction, 'label'> | null => {
      switch (label) {
        case '다시 시도':
          // 3회를 넘기면 표에 있어도 그리지 않는다 (SCR-11 재시도 상한).
          return canRetryScan
            ? {
                kind: 'retry',
                onPress: () => {
                  void handleRetry();
                },
              }
            : null;
        // 셋 다 "이 파일을 버리고 촬영 화면으로" 다. 라벨은 §13 표 문구를 그대로 살린다.
        // (`다른 사진 선택` 의 착지점이 촬영 화면인 것은 §13 어휘 약속 그대로다 —
        //  `useScan.ScanFailureMessage.actions` 주석이 정본.)
        case '다시 촬영':
        case '다른 사진 선택':
        case '카메라로 촬영':
          return { kind: 'retake', onPress: abortToCamera };
        // 라벨이 앨범을 약속하므로 앨범을 연다 (R7 — `openAlbum` 주석 참조).
        case '앨범에서 선택':
          return {
            kind: 'album',
            onPress: () => {
              void openAlbum();
            },
          };
        // 흐름 종료. 촬영 화면으로 돌아가지 않는다 (`dismissScan` 주석 참조).
        case '취소':
        case '닫기':
          return { kind: 'dismiss', onPress: dismissScan };
        case '직접 입력':
        case '그래도 직접 입력':
          return { kind: 'manual', onPress: handleManualEntry };
        // production 에서는 해석하지 않는다 → 이 라벨의 버튼이 아예 그려지지 않는다.
        // (`DIAGNOSTICS_AVAILABLE` 주석 참조. 눌러도 못 가는 버튼을 그리는 것보다,
        //  스택을 파괴하며 튕기는 버튼을 그리는 것이 훨씬 나쁘다.)
        case '서버 주소 확인':
          return DIAGNOSTICS_AVAILABLE ? { kind: 'diagnostics', onPress: openDiagnostics } : null;
        case '설정 열기':
          return { kind: 'settings', onPress: openAppSettings };
        default:
          return null;
      }
    },
    [
      abortToCamera,
      canRetryScan,
      dismissScan,
      handleManualEntry,
      handleRetry,
      openAlbum,
      openAppSettings,
      openDiagnostics,
    ],
  );

  /**
   * 실제로 그릴 버튼 목록.
   *
   * 규칙 세 가지 — 1차 수정이 만든 회귀(§13 표에 있는 버튼이 사라짐)를 되돌리기 위한 것이다.
   *  ① §13 표의 라벨은 **하나도 잃지 않는다.** 중복 제거는 `label` 기준이라 서로 다른 라벨이
   *     같은 동작을 가리켜도 둘 다 렌더된다.
   *  ② 이 화면 고유의 탈출구(`다른 사진 선택` / `직접 입력`)는 **보충**일 뿐이라,
   *     같은 `kind` 가 이미 있으면 넣지 않는다. 그래서 SCF-10 처럼 표에 `다시 촬영` ·
   *     `그래도 직접 입력` 이 이미 있는 경우 쌍둥이 버튼이 생기지 않는다.
   *
   *     ── ②의 재촬영 보충을 좁혔다 (2026-08-05 4차 · R4) ────────────────────────
   *     종전 ②는 `다른 사진 선택` 을 **무조건** 얹었다. 그런데 3차에서 두 갈래는 재시도가
   *     무의미하다는 것을 본문에 못박았다:
   *       · SCF-07 unreachable — "…지금 다시 시도해도 같은 결과입니다."
   *       · SCF-09 contract    — "…다시 시도해도 같은 결과가 나옵니다."
   *     둘 다 **서버 배포/계약 문제**라 사진을 아무리 바꿔도 결과가 같다. 그 화면에 `다른 사진
   *     선택` 이 붙으면 사용자는 "사진이 문제였나" 로 읽고 다시 찍는다 → 같은 503 을 다시 본다.
   *     본문은 "같은 결과" 라고 말하는데 버튼은 재시도를 권하는 모순이다.
   *     → **재촬영 보충은 §13 표가 `다시 시도` 를 제시한 실패에서만** 한다. 표가 재시도를 뺀
   *       실패는 "이 요청을 다시 보내도 소용없다" 는 판정이 이미 내려진 것이므로, 그 판정을
   *       화면이 뒤집지 않는다. (표가 `다시 촬영`/`앨범에서 선택` 을 직접 준 실패 —
   *       SCF-04/05/10/01/02 — 는 그 버튼이 이미 있으므로 아래 kind 검사에서 걸러진다.)
   *     `직접 입력` 보충은 그대로 **무조건**이다. 사진 탓으로 읽히지 않고, 어떤 실패에서도
   *     흐름을 계속할 수 있는 유일한 탈출구라 빼면 막다른 길이 생긴다.
   *
   *  ③ `dismiss`(취소/닫기)는 **항상 맨 아래**로 내린다. 목록 순서가 곧 시각 위계라서
   *     (0번 primary · 마지막 ghost), 재시도가 3회로 소진된 실패에서 `취소` 가 primary 자리를
   *     차지해 "그만두기" 를 권하는 화면이 되는 것을 막는다.
   *
   * ── 실패 코드별 최종 버튼 (위 → 아래, `*` = 재시도 3회 초과 시 빠짐) ────────────
   * | 코드 | §13 actions | 실제 버튼 |
   * |---|---|---|
   * | SCF-01 (이 화면 미도달) | 설정 열기 · 앨범에서 선택 · 닫기 | 설정 열기 · 앨범에서 선택 · 직접 입력 · 닫기 |
   * | SCF-02 (앨범 권한 거부) | 설정 열기 · 카메라로 촬영 | 설정 열기 · 카메라로 촬영 · 직접 입력 |
   * | SCF-03 | 다시 시도 · 취소 | 다시 시도* · 다른 사진 선택 · 직접 입력 · 취소 |
   * | SCF-04 | 다시 촬영 | 다시 촬영 · 직접 입력 |
   * | SCF-05 | 다시 촬영 | 다시 촬영 · 직접 입력 |
   * | SCF-06 | 다시 시도 · 서버 주소 확인 | 다시 시도* · 서버 주소 확인 · 다른 사진 선택 · 직접 입력 |
   * | SCF-07 (커밋 네트워크 · SCR-12 전용) | 이미지 없이 저장 · 다시 시도 · 취소 | 다시 시도* · 다른 사진 선택 · 직접 입력 · 취소 |
   * | SCF-07 (업스트림 연결 불가) | 직접 입력 · 서버 주소 확인 · 취소 | 직접 입력 · 서버 주소 확인 · 취소 |
   * | SCF-08 | 다시 시도 · 취소 | 다시 시도* · 다른 사진 선택 · 직접 입력 · 취소 |
   * | SCF-09 (Spring 자체 5xx) | 다시 시도 | 다시 시도* · 다른 사진 선택 · 직접 입력 |
   * | SCF-09 (업스트림 5xx) | 다시 시도 · 직접 입력 · 취소 | 다시 시도* · 직접 입력 · 다른 사진 선택 · 취소 |
   * | SCF-09 (업스트림 4xx 거절) | 직접 입력 · 서버 주소 확인 | 직접 입력 · 서버 주소 확인 |
   * | SCF-10 | 다시 촬영 · 그래도 직접 입력 | 다시 촬영 · 그래도 직접 입력 |
   *
   * 재촬영 계열이 **없는** 행은 위 ②의 좁힌 규칙이 적용된 곳이다(SCF-07 업스트림 연결 불가 ·
   * SCF-09 업스트림 4xx). 둘 다 본문이 "다시 시도해도 같은 결과" 라고 말하는 갈래다.
   *
   * (`이미지 없이 저장` 은 저장 단계 전용이라 이 화면에서는 해석되지 않고 조용히 빠진다.
   *  SCF-10 / SCF-11 은 실제로는 SCR-12 에서 뜨지만 매핑은 대칭을 위해 유지한다.
   *  `서버 주소 확인` 은 production 빌드에서 빠진다 — `DIAGNOSTICS_AVAILABLE` 주석 참조.
   *  그때 SCF-06 은 `다시 시도`* · `다른 사진 선택` · `직접 입력`,
   *  SCF-07(연결 불가)은 `직접 입력` · `취소`, SCF-09(업스트림 4xx)는 `직접 입력` 만 남는다.)
   */
  const failureActions = useMemo<FailureAction[]>(() => {
    const out: FailureAction[] = [];
    const push = (label: string, resolved: Omit<FailureAction, 'label'> | null) => {
      if (!resolved) return;
      if (out.some((action) => action.label === label)) return; // ①
      out.push({ label, ...resolved });
    };

    const tableActions = failureMessage?.actions ?? [];
    for (const label of tableActions) push(label, resolveAction(label));

    /* ② 같은 동작이 이미 있으면 보충하지 않는다.
       재촬영 보충은 §13 표가 `다시 시도` 를 제시한 실패에서만 — 위 주석의 R4 문단 참조.
       `canRetryScan` 이 아니라 **표**를 본다: 3회 소진으로 `다시 시도` 버튼이 빠진 실패는
       여전히 "다른 사진으로 해 볼 만한" 실패이고, 그때 남는 유일한 탈출구가 이 버튼이다. */
    const retryIsMeaningful = tableActions.includes('다시 시도');
    const hasPhotoAction = out.some(
      (action) => action.kind === 'retake' || action.kind === 'album',
    );
    if (retryIsMeaningful && !hasPhotoAction) {
      push('다른 사진 선택', { kind: 'retake', onPress: abortToCamera });
    }
    if (!out.some((action) => action.kind === 'manual')) {
      push('직접 입력', { kind: 'manual', onPress: handleManualEntry });
    }

    // ③ filter 는 순서를 보존하므로 나머지 상대 순서는 그대로 유지된다.
    return [
      ...out.filter((action) => action.kind !== 'dismiss'),
      ...out.filter((action) => action.kind === 'dismiss'),
    ];
  }, [abortToCamera, failureMessage, handleManualEntry, resolveAction]);

  /* ── 렌더 ──────────────────────────────────────────────────────────── */

  const determinate = uploadPhase === 'sending';
  const stageLabel = SCR11_STEP_LABELS[stageIndex] ?? SCR11_STEP_LABELS[0];

  return (
    <View
      className="flex-1 bg-bg-base px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xxl }}
    >
      {/* ── 헤더 (상시 노출) ─────────────────────────────────────────────
          라벨이 상태에 따라 바뀐다. 진행 중에는 SCR-11 인터랙션표 원문대로 `취소`
          (= 요청을 끊고 촬영 화면 복귀)지만, 실패 블록에서는 끊을 요청이 없고 아래 버튼 목록에
          이미 `취소`(흐름 종료)가 있을 수 있다. 같은 화면에서 같은 단어가 서로 다른 곳에
          착지하면 안 되므로, 실패 상태의 헤더는 SCR-09 와 같은 `닫기`(흐름 종료)로 바꾼다. */}
      <View className="h-14 flex-row items-center justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={running ? '분석 취소' : '스캔 닫기'}
          onPress={running ? abortToCamera : dismissScan}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="h-11 justify-center"
        >
          <Text className="text-button font-w600 text-text-secondary">
            {running ? '취소' : '닫기'}
          </Text>
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
            <Text className="mt-8 text-h3 font-w700 text-brand">{stageLabel}</Text>
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
          /* ── 실패 블록 (§13 매핑표 문구 + 서버가 준 사유 한 줄) ────────
             제목·부제는 표가 소유하고, 세 번째 줄만 서버 원문을 **한 줄로 요약해** 보여준다
             (`api.ts summarizeDetail` → `useScan.visibleDetail`). 예전에는 이 줄이 아예 없어
             `서버 에러 (503)` 만 보였고, 그래서 앱 버그와 서버 사망을 구분할 수 없었다. */
          <View className="mt-8 w-full items-center">
            <Text className="text-center text-h3 font-w700 text-text-primary">
              {failureMessage?.title ?? '문서를 인식하지 못했습니다.'}
            </Text>
            {failureMessage?.body ? (
              <Text className="mt-2 text-center text-body-sm text-text-muted">
                {failureMessage.body}
              </Text>
            ) : null}
            {failureMessage?.detail ? (
              <Text
                className="mt-2 text-center text-caption text-text-muted"
                numberOfLines={3}
                accessibilityLabel={`서버 응답: ${failureMessage.detail}`}
              >
                {failureMessage.detail}
              </Text>
            ) : null}

            <View className="mt-6 w-full gap-2">
              {failureActions.map((action, index) => {
                // 위계는 기존 고정 버튼 3개와 동일하게 유지한다: 첫 번째 primary/lg,
                // 마지막 ghost/md, 중간 secondary/lg. 액션이 하나뿐이면 primary/lg 하나만 남는다.
                const trailing = index > 0 && index === failureActions.length - 1;
                return (
                  <Button
                    key={action.label}
                    label={action.label}
                    onPress={action.onPress}
                    variant={index === 0 ? 'primary' : trailing ? 'ghost' : 'secondary'}
                    size={trailing ? 'md' : 'lg'}
                    fullWidth
                    haptic={index === 0 ? 'light' : 'selection'}
                  />
                );
              })}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
