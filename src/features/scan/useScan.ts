import { useCameraPermissions } from 'expo-camera';
import type { CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo } from 'react';
import { Linking } from 'react-native';

import { springUpstreamFailure } from './api';
import { recognitionSummary } from './fieldSchema';
import type { PrepareOptions } from './imagePipeline';
import {
  canSave as canSaveSelector,
  classificationTier,
  confidenceBadge,
  currentFieldDefs,
  currentSoftWarning,
  currentValidation,
  hasNoExtractedValues,
  useScanStore,
} from './scanStore';
import type { DocumentType, ScanFailure, ScanFailureCode, UploadPhase } from './types';

/**
 * 스캔 화면들이 쓰는 단일 훅.
 *
 * 정본: wiki/tech/Camera and Scan.md §3(권한) · §8(업로드 UX) · §13(실패 케이스 표)
 *       wiki/design/Screen Specs.md SCR-09 ~ SCR-13
 *
 * 문구 정책: 제목·부제는 서버 문자열이 아니라 아래 매핑표가 소유한다. HTTP status 와 `success`
 * 불리언만으로 코드를 고르고 문구는 표에서 꺼낸다 (§13 공통 규칙).
 *
 * 정책 완화(2026-08-05): 원래는 서버 문자열을 **한 글자도** 노출하지 않았는데, 그 결과
 * OCR OOM 장애에서 사용자·개발자 모두가 본 것이 `서버 에러 (503)` 한 줄뿐이었다.
 * 이제 `detail`(서버가 준 에러 문구 **한 줄 요약**)을 세 번째 줄로 함께 내린다.
 *  · 스택트레이스가 아니라 한 줄이다 (`api.ts summarizeDetail` 이 개행·중복 공백을 정리한다).
 *  · 사용자에게 의미 없는 내부 문자열은 `DETAIL_VISIBLE_CODES` 로 걸러낸다.
 *  · 200자를 넘으면 자른다.
 * 예외였던 저장 부분 성공 `message`(임베딩 실패 경고)는 종전대로 완료 화면에서 원문 노출 (§11-2).
 */

// ───────────────────────────────────────────────────────── 진행 표기 문구

/**
 * Camera and Scan §8 단계 표기.
 * `sending` 만 실측 진행률이 있고, 그 뒤는 서버 추론 시간이라 인디터미네이트다.
 */
export const UPLOAD_PHASE_LABELS: Record<UploadPhase, string> = {
  sending: '업로드 중',
  reading: '문서를 읽는 중...',
  organizing: '정보를 정리하는 중...',
};

/**
 * SCR-11 스텝 인디케이터 라벨 4개 (화면 정본).
 * 서버는 단계별 콜백을 주지 않으므로 2~4번째는 **연출**이다. 진행률로 쓰지 말 것.
 */
export const SCR11_STEP_LABELS = [
  '이미지를 올리는 중...',
  '텍스트를 읽는 중...',
  '정보를 정리하는 중...',
  '거의 다 됐어요...',
] as const;

// ───────────────────────────────────────────────────────── 실패 문구 매핑 (§13)

export type ScanFailureMessage = {
  code: ScanFailureCode;
  /** 시트/다이얼로그 제목. */
  title: string;
  /** 부제. 없을 수 있다. */
  body?: string;
  /**
   * 서버가 준 실패 사유 한 줄 (예: `OCR upstream failed (503)`).
   * 원인을 서버로 좁히기 위한 단서이며, 값이 없거나 노출 대상 코드가 아니면 `undefined` 다.
   * 화면은 이 줄을 **작은 글씨 부제**로만 그린다.
   */
  detail?: string;
  /**
   * 표에 적힌 액션 라벨. 화면이 이 순서대로 버튼을 만든다.
   *
   * 라벨 → 실제 동작의 해석은 **화면이 소유한다**(예: SCR-11 `analyzing.tsx resolveAction`).
   * 어휘 약속만 여기 적어 둔다 — 화면마다 다르게 읽히면 그것 자체가 거짓 신호가 된다.
   *  · `다시 시도`               : 같은 파일로 같은 요청을 다시 보낸다
   *  · `다시 촬영`/`다른 사진 선택`/`카메라로 촬영` : 이 파일을 버리고 촬영 화면(SCR-09)으로
   *  · `앨범에서 선택`           : **앨범 피커를 연다.** 촬영 화면 복귀가 아니다
   *    (2026-08-05 4차 정정 — 종전에는 이 라벨도 촬영 화면으로 묶여 있어 라벨이 약속한 앨범
   *     대신 카메라가 열렸다. `analyzing.tsx openAlbum` · `app/scan/index.tsx openAlbum` 참조.)
   *  · `취소`/`닫기`             : **흐름 종료.** 촬영 화면으로 되돌아가는 것이 아니다
   *  · `직접 입력`/`그래도 직접 입력` : 빈 폼으로 편집 단계 진입
   * 해석할 수 없는 라벨(저장 단계 전용 `이미지 없이 저장` 등)은 그 화면에서 조용히 빠진다.
   */
  actions: readonly string[];
};

/**
 * `detail` 을 화면에 내리는 코드 집합.
 *
 * 서버(또는 게이트웨이)가 만든 문자열이 실려 오는 실패만 고른다.
 * 제외 대상: SCF-03(`prepared image missing` — 내부 상태 문자열),
 * FLD-06(검증 오류 JSON — 사용자가 읽을 형식이 아니다), 권한/취소 계열(애초에 detail 이 없다).
 *
 * **SCF-12 를 뺐다 (2026-08-05 3차).** 목록에는 있었지만 `api.ts mapSaveFailure` 가 `detail` 을
 * 한 번도 설정하지 않아 **항상 undefined** 였다 — 저장 경로는 `request()` 를 타고, 그 계층의
 * `AppError` 는 서버 문구를 의도적으로 버린다(그 함수 주석 참조). 도달하지 않는 항목을 목록에
 * 남겨 두면 "이 실패는 서버 사유를 보여준다" 는 거짓 약속이 되고, 다음 사람이 "왜 안 보이지" 를
 * 디버깅하게 된다. 서버 원문을 저장 실패에도 싣게 되면 그때 다시 넣는다.
 *
 * 반대로 **SCF-11 은 남긴다.** 역시 도달하지 않던 항목이었으나(SCF-11 은 SCR-12 에서만 뜨는데
 * 그 화면이 `detail` 을 렌더하지 않았다) 이번에 `review.tsx` 가 실패 배너에 상세 한 줄을
 * 그리도록 고쳐 **실제로 도달하게** 만들었다. 커밋은 Spring 을 우회해 FastAPI 를 직접 치므로
 * 이 한 줄이 "파트명 불일치(422)" 와 "인스턴스 사망(503)" 을 가르는 유일한 단서다.
 */
const DETAIL_VISIBLE_CODES: readonly ScanFailureCode[] = [
  'SCF-05',
  'SCF-07',
  'SCF-08',
  'SCF-09',
  'SCF-11',
];

/** 부제 한 줄이 화면을 잡아먹지 않도록 자른다. */
const DETAIL_MAX_LEN = 200;

function visibleDetail(failure: ScanFailure): string | undefined {
  if (!failure.detail || !DETAIL_VISIBLE_CODES.includes(failure.code)) return undefined;
  const line = failure.detail.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > DETAIL_MAX_LEN ? `${line.slice(0, DETAIL_MAX_LEN)}…` : line;
}

/**
 * SCF-01 ~ SCF-13 + CLS-04 + FLD-06 문구 + 서버가 준 상세 한 줄.
 * 문구 자체는 `failureCopy` 가, 상세 노출 여부는 `visibleDetail` 이 결정한다.
 */
export function describeFailure(failure: ScanFailure | null): ScanFailureMessage | null {
  const copy = failureCopy(failure);
  if (!copy || !failure) return copy;
  const detail = visibleDetail(failure);
  return detail ? { ...copy, detail } : copy;
}

/**
 * SCF-01 ~ SCF-13 + CLS-04 + FLD-06 문구.
 * `원문` 표기가 있는 문구는 원본 웹 코드에 실재하는 문자열을 그대로 재사용한 것이다.
 */
function failureCopy(failure: ScanFailure | null): ScanFailureMessage | null {
  if (!failure) return null;
  const { code, status } = failure;

  switch (code) {
    // 사용자가 직접 취소한 경우 — 어떤 문구도 노출하지 않는다.
    case 'CANCELED':
      return null;

    case 'SCF-01':
      return {
        code,
        title: '카메라 권한이 필요합니다',
        body: '문서를 촬영하려면 설정에서 카메라 접근을 허용해 주세요.',
        actions: ['설정 열기', '앨범에서 선택', '닫기'],
      };

    case 'SCF-02':
      return {
        code,
        title: '사진 접근 권한이 필요합니다',
        body: '설정에서 사진 접근을 허용해 주세요.',
        actions: ['설정 열기', '카메라로 촬영'],
      };

    case 'SCF-03':
      return {
        code,
        title: '기기 저장 공간이 부족해 사진을 준비하지 못했습니다.',
        body: '공간을 확보한 뒤 다시 시도해 주세요.',
        actions: ['다시 시도', '취소'],
      };

    case 'SCF-04':
      return {
        code,
        title: '이미지가 너무 큽니다. 다른 사진을 선택해 주세요.',
        actions: ['다시 촬영'],
      };

    case 'SCF-05':
      return {
        code,
        title: '이미지가 너무 커서 업로드하지 못했습니다.',
        actions: ['다시 촬영'],
      };

    case 'SCF-06':
      return {
        code,
        title: '백엔드 서버에 연결할 수 없습니다.', // 원문
        body: 'PC와 같은 Wi-Fi에 연결되어 있는지 확인해 주세요.',
        actions: ['다시 시도', '서버 주소 확인'],
      };

    /* SCF-07 = **연결 자체가 성립하지 않은 실패**. 두 경로가 여기로 온다.
       ① 커밋(`/api/commit`) 네트워크 오류 — 기기가 OCR 서버(:8000)에 직접 못 붙은 경우. status null.
       ② 스캔 **503 `OCR upstream unreachable`** — Spring 이 OCR 주소에 못 붙은 경우 (2026-08-05 3차).

       ②를 새로 받는 대신 **스캔 502 를 여기서 뺐다.** 502 는 "업스트림이 5xx 로 *응답했다*" 는
       뜻이라 연결은 성공한 것이다. 거기에 `OCR 서버에 연결할 수 없습니다` 를 붙이면 배지에서
       지운 것과 같은 종류의 거짓 신호가 된다 → 502 는 아래 SCF-09 의 `server` 갈래로 간다.

       ①과 ②는 같은 제목(§13 원문)을 쓰되 **액션이 갈린다**: ①은 일시적 네트워크 문제일 수 있어
       재시도가 의미 있고 저장 단계라 `이미지 없이 저장` 이라는 탈출구도 있다. ②는 배포/설정 오류
       (주소가 틀렸거나 OCR 이 떠 있지 않다)라 재시도로 절대 풀리지 않는다. */
    case 'SCF-07': {
      if (springUpstreamFailure(failure.detail)?.kind === 'unreachable') {
        return {
          code,
          title: 'OCR 서버에 연결할 수 없습니다.', // 원문
          body: '백엔드 서버가 OCR 서버 주소에 닿지 못했습니다. 주소가 잘못됐거나 OCR 서버가 꺼져 있는 상태라, 지금 다시 시도해도 같은 결과입니다.',
          actions: ['직접 입력', '서버 주소 확인', '취소'],
        };
      }
      // `이미지 없이 저장` 은 저장 단계 전용 액션이라 스캔 화면에서는 해석되지 않고 조용히 빠진다.
      return {
        code,
        title: 'OCR 서버에 연결할 수 없습니다.', // 원문
        actions: ['이미지 없이 저장', '다시 시도', '취소'],
      };
    }

    /* SCF-08 = **기다렸는데 응답이 없었다**. 두 경로가 여기로 온다.
       ① 앱 자체 타이머 만료(SCAN_TIMEOUT_MS 120초) 또는 백그라운드 30초 초과. status null.
       ② 스캔 **504 `OCR upstream timeout`** — Spring 의 read 타임아웃(90초). 연결은 됐다.
       종전에는 Spring 이 연결 실패까지 504 로 접었기 때문에 **50ms 만에 끝난 DNS 실패**에도
       "시간이 너무 오래 걸립니다" 가 떴다. 이제 연결 불가는 503 → SCF-07 로 갈라졌으므로
       이 문구가 사실과 일치한다. 부제만 어느 쪽 타이머였는지 알려 준다. */
    case 'SCF-08': {
      const upstream = springUpstreamFailure(failure.detail);
      return {
        code,
        title: '문서를 읽는 데 시간이 너무 오래 걸립니다.',
        body:
          upstream?.kind === 'timeout'
            ? 'OCR 서버가 제한 시간 안에 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.'
            : '잠시 후 다시 시도해 주세요.',
        actions: ['다시 시도', '취소'],
      };
    }

    /* SCF-09 = §13 의 "스캔 5xx". 연결도 됐고 응답도 왔는데 내용이 실패인 경우다. 세 종류가 섞인다.
       ① Spring 자체 실패(파일 읽기 오류 등) → 전과 같이 `서버 에러 (500)` + `다시 시도`.
       ② **업스트림 5xx**(502 `OCR upstream failed (nnn)`) → OCR 인스턴스가 죽었거나 추론이 실패했다.
          시간이 지나면 풀릴 수 있으므로 재시도가 정당하다. 다만 원인이 OCR 서버라는 사실을
          제목에서 말해야 "앱이 이상한가?" 를 되묻지 않는다.
       ③ **업스트림 4xx**(500 `OCR upstream contract error (nnn)`) → Spring↔OCR 계약 위반.
          상태코드가 ①과 같아서 status 로는 못 가른다. `springUpstreamFailure()` 가 본문 마커로
          갈라낸다. ③에 `다시 시도` 를 주면 안 된다 — 같은 요청은 항상 같은 4xx 로 돌아오므로
          "다시 시도" 는 사용자를 무한 루프에 태우는 **거짓 신호**다. 대신 흐름을 계속할 수 있는
          `직접 입력` 을 1순위로, 서버 주소가 엉뚱한 빌드를 가리키는 경우를 잡는
          `서버 주소 확인` 을 2순위로 준다. */
    case 'SCF-09': {
      const upstream = springUpstreamFailure(failure.detail);
      if (upstream?.kind === 'contract') {
        return {
          code,
          title: `서버가 요청을 거절했습니다 (${upstream.upstreamStatus ?? 0})`,
          body: '앱과 서버의 요청 형식이 맞지 않습니다. 다시 시도해도 같은 결과가 나옵니다.',
          actions: ['직접 입력', '서버 주소 확인'],
        };
      }
      if (upstream?.kind === 'server') {
        return {
          code,
          title: `OCR 서버가 문서를 처리하지 못했습니다 (${upstream.upstreamStatus ?? 0})`,
          body: '연결은 됐지만 OCR 서버 쪽에서 실패했습니다. 잠시 후 다시 시도해 주세요.',
          actions: ['다시 시도', '직접 입력', '취소'],
        };
      }
      return {
        code,
        title: `서버 에러 (${status ?? 0})`, // 원문 `서버 에러 (${res.status})`
        actions: ['다시 시도'],
      };
    }

    case 'SCF-10':
      return {
        code,
        title: '이미지에서 글자를 찾지 못했습니다.',
        body: '더 밝은 곳에서 글자가 선명하게 보이도록 다시 촬영해 주세요.',
        actions: ['다시 촬영', '그래도 직접 입력'],
      };

    case 'SCF-11':
      return {
        code,
        title: `이미지 저장 실패 (${status ?? 0})`, // 원문 `이미지 저장 실패 (${res.status})`
        body: '이미지 없이 정보만 저장할 수 있습니다.',
        actions: ['이미지 없이 저장', '다시 시도', '취소'],
      };

    case 'SCF-12':
      return {
        code,
        title: `저장 실패 (${status ?? 0})`, // 원문 `저장 실패 (${res.status})`
        actions: ['다시 시도', '임시 보관'],
      };

    case 'SCF-13':
      return {
        code,
        title: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.', // 원문
        actions: ['로그인'],
      };

    case 'CLS-04':
      return {
        code,
        title: '지원하지 않는 문서 유형입니다.', // 원문
        body: '명함·포스터·영수증·티켓 중에서 골라 주세요.',
        actions: ['문서 종류 선택'],
      };

    case 'FLD-06':
      // 결정 — 위키에 확정 문구가 없어 이 문서에서 정한다.
      return {
        code,
        title: '날짜·시간·금액 형식을 확인해 주세요.',
        body: '날짜는 YYYY-MM-DD, 시간은 HH:MM 형식이어야 합니다.',
        actions: ['확인'],
      };
  }
}

// ───────────────────────────────────────────────────────── 훅

export type PermissionOutcome = 'granted' | 'denied';
/** 앨범 선택 결과. **단순 취소는 실패로 취급하지 않는다** (아래 주석). */
export type PickOutcome = 'selected' | 'canceled' | 'denied';

export function useScan() {
  const store = useScanStore();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const { docType, values, scan, failure, uploadPhase, uploadProgress, step } = store;

  // `store` 는 상태가 바뀔 때만 새 참조가 되므로 이 하나로 충분하다.
  const fieldDefs = useMemo(() => currentFieldDefs(store), [store]);
  const validation = useMemo(() => currentValidation(store), [store]);
  const softWarning = useMemo(() => currentSoftWarning(store), [store]);
  const summary = useMemo(() => recognitionSummary(fieldDefs, values), [fieldDefs, values]);
  const tier = useMemo(() => classificationTier(store), [store]);
  /** SCR-12 `인식된 정보가 없습니다.` 배너 조건 (SCF-10 과 구분한다). */
  const noExtractedValues = useMemo(() => hasNoExtractedValues(store), [store]);
  const badge = useMemo(() => confidenceBadge(store), [store]);
  const saveEnabled = useMemo(() => canSaveSelector(store), [store]);
  const failureMessage = useMemo(() => describeFailure(failure), [failure]);

  /** 업로드 진행 문구. `sending` 구간만 퍼센트를 붙인다 (가짜 진행률 금지). */
  const progressLabel = useMemo(() => {
    if (!uploadPhase) return null;
    if (uploadPhase === 'sending') {
      return `${UPLOAD_PHASE_LABELS.sending} ${Math.round(uploadProgress * 100)}%`;
    }
    return UPLOAD_PHASE_LABELS[uploadPhase];
  }, [uploadPhase, uploadProgress]);

  /**
   * SCAN-01 카메라 권한. **촬영 버튼을 처음 누를 때** 부르고, 탭 진입 즉시 부르지 않는다.
   */
  const ensureCameraPermission = useCallback(async (): Promise<PermissionOutcome> => {
    if (cameraPermission?.granted) return 'granted';
    const next = await requestCameraPermission();
    if (next.granted) return 'granted';
    store.setFailure({ code: 'SCF-01', status: null });
    return 'denied';
  }, [cameraPermission?.granted, requestCameraPermission, store]);

  /** SCAN-02a 촬영 결과 수용. `takePictureAsync({ exif: false, skipProcessing: false })` 결과를 넘긴다. */
  const acceptCapture = useCallback(
    (photo: Pick<CameraCapturedPicture, 'uri' | 'width' | 'height'>) => {
      store.setSource(photo.uri, { width: photo.width, height: photo.height });
    },
    [store],
  );

  /**
   * SCAN-02b 앨범 선택.
   *
   * §12 결정에 따라 `allowsMultipleSelection: false` 고정(1장 = 1문서)이다.
   *
   * 위키 §13 SCF-02 는 `canceled === true` 도 SCF-02 로 묶어 두었지만, 사용자가 스스로
   * `취소` 를 누른 상황에 권한 안내 시트를 띄우는 것은 오작동으로 읽힌다.
   * → **권한 거부만** SCF-02 로 올리고 단순 취소는 `'canceled'` 로 조용히 돌려준다.
   */
  const pickFromLibrary = useCallback(async (): Promise<PickOutcome> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!permission.granted) {
      store.setFailure({ code: 'SCF-02', status: null });
      return 'denied';
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      // 최종 압축은 SCAN-04(prepareForUpload)가 담당하므로 여기서 화질을 깎지 않는다.
      quality: 1,
      exif: false, // IMG-07 — GPS/기기정보 제거
    });
    if (result.canceled) return 'canceled';

    const asset = result.assets[0];
    if (!asset) return 'canceled';
    store.setSource(asset.uri, { width: asset.width, height: asset.height });
    return 'selected';
  }, [store]);

  /** SCF-01/02 시트의 `설정 열기`. */
  const openAppSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  /** SCAN-04 → SCAN-05 를 한 번에. 크롭 화면의 `사용하기` 가 쓴다. */
  const prepareAndScan = useCallback(
    async (options?: PrepareOptions): Promise<boolean> => {
      const prepared = await store.prepare(options);
      if (!prepared) return false;
      return store.runScan();
    },
    [store],
  );

  /** SCR-11 `다시 시도`. 동일 파일을 재사용한다 (§13 공통 규칙 — 실패 시트는 파일을 파기하지 않는다). */
  const retryScan = useCallback(async (): Promise<boolean> => {
    store.clearFailure();
    return store.runScan();
  }, [store]);

  /** SCF-11 다이얼로그의 `이미지 없이 저장`. */
  const saveWithoutImage = useCallback(
    () => store.save({ allowMissingImage: true }),
    [store],
  );

  const changeDocType = useCallback((next: DocumentType) => store.setDocType(next), [store]);

  return {
    // ── 상태
    step,
    scan,
    docType,
    values,
    receiptItems: store.receiptItems,
    prepared: store.prepared,
    sourceUri: store.sourceUri,
    adjustedUri: store.adjustedUri,
    uploadProgress,
    uploadPhase,
    progressLabel,
    savedId: store.savedId,
    saveWarning: store.saveWarning,
    imageMissing: store.imageMissing,
    committedImageUrl: store.committedImageUrl,
    sessionSavedCount: store.sessionSavedCount,

    // ── 파생
    fieldDefs,
    validation,
    softWarning,
    summary,
    tier,
    badge,
    noExtractedValues,
    canSave: saveEnabled,
    failure,
    failureMessage,
    /** SCR-11 `다시 시도` 는 최대 3회. 초과 시 `다른 사진 선택` 만 노출한다. */
    canRetryScan: store.scanAttempts < 3,

    // ── 권한 / 입력
    cameraPermission,
    ensureCameraPermission,
    acceptCapture,
    pickFromLibrary,
    openAppSettings,

    // ── 파이프라인
    setSource: store.setSource,
    setAdjusted: store.setAdjusted,
    prepare: store.prepare,
    runScan: store.runScan,
    prepareAndScan,
    retryScan,
    cancelScan: store.cancelScan,

    // ── 편집 / 저장
    changeDocType,
    enterManualEntry: store.enterManualEntry,
    setValue: store.setValue,
    setValues: store.setValues,
    addReceiptItem: store.addReceiptItem,
    updateReceiptItem: store.updateReceiptItem,
    removeReceiptItem: store.removeReceiptItem,
    commit: store.commit,
    save: store.save,
    saveWithoutImage,

    // ── 세션
    clearFailure: store.clearFailure,
    reset: store.reset,
    resetForNextScan: store.resetForNextScan,
  };
}
