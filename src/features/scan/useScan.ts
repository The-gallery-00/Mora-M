import { useCameraPermissions } from 'expo-camera';
import type { CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo } from 'react';
import { Linking } from 'react-native';

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
 * 문구 정책: 서버 에러 문자열을 화면에 그대로 노출하지 않는다. HTTP status 와 `success` 불리언만으로
 * 분기하고 문구는 아래 매핑표에서 고른다 (§13 공통 규칙). 유일한 예외는 저장 부분 성공 `message`
 * (임베딩 실패 경고)이며 그것은 완료 화면에서 원문을 그대로 보여준다 (§11-2).
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
  /** 표에 적힌 액션 라벨. 화면이 이 순서대로 버튼을 만든다. */
  actions: readonly string[];
};

/**
 * SCF-01 ~ SCF-13 + CLS-04 + FLD-06 문구.
 * `원문` 표기가 있는 문구는 원본 웹 코드에 실재하는 문자열을 그대로 재사용한 것이다.
 */
export function describeFailure(failure: ScanFailure | null): ScanFailureMessage | null {
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

    case 'SCF-07':
      return {
        code,
        title: 'OCR 서버에 연결할 수 없습니다.', // 원문
        actions: ['이미지 없이 저장', '다시 시도', '취소'],
      };

    case 'SCF-08':
      return {
        code,
        title: '문서를 읽는 데 시간이 너무 오래 걸립니다.',
        body: '잠시 후 다시 시도해 주세요.',
        actions: ['다시 시도', '취소'],
      };

    case 'SCF-09':
      return {
        code,
        title: `서버 에러 (${status ?? 0})`, // 원문 `서버 에러 (${res.status})`
        actions: ['다시 시도'],
      };

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
