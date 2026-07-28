import { create } from 'zustand';

import { commitDocument, saveDocument, scanImage } from './api';
import {
  type FieldDef,
  buildFieldDefs,
  inheritFieldValues,
  initialFieldValues,
  softWarningFor,
  validateFields,
  type FieldValidation,
} from './fieldSchema';
import { type PrepareOptions, prepareForUpload } from './imagePipeline';
import {
  type ClassificationTier,
  type DocumentType,
  type ParsedFields,
  type PreparedImage,
  type ReceiptItemInput,
  type ScanFailure,
  type ScanResult,
  type ScanStep,
  type TypeSource,
  type UploadPhase,
  ScanPipelineError,
  isSavableDocumentType,
} from './types';

/**
 * 스캔 세션 스토어 (SCAN-01 ~ SCAN-12).
 *
 * 정본: wiki/tech/Camera and Scan.md §2(파이프라인) · §9(CLS-01~06) · §11(보상 규칙) · §12(연속 스캔)
 *       wiki/design/Screen Specs.md SCR-09 ~ SCR-13
 *
 * **영속하지 않는다.** SCR-11 정본이 "결과 객체는 스캔 세션 스토어(Zustand, 화면 이탈 시 폐기)"로
 * 못박았고, 이미지 파일 자체가 캐시 디렉터리에 있어 OS 가 언제든 지울 수 있어 초안 복원이
 * 반쪽이 된다. MMKV `mora.scan.draft` 로의 초안 보존은 Offline and State 담당 범위다
 * (`StorageKey` 에 draft 키가 아직 없다 — 추가는 그쪽 소유).
 */

/** CLS-01 — 서버가 죽은 상수로 남긴 `CONFIDENCE_THRESHOLD = 0.8` 을 그대로 승계한다. */
export const CONFIDENCE_CONFIRM_THRESHOLD = 0.8;
/** CLS-03 — 3클래스 소프트맥스에서 "무작위(0.33)보다는 확실하지만 사람이 확인해야 하는" 구간의 하한. */
export const CONFIDENCE_PICK_THRESHOLD = 0.55;

export type ScanState = {
  step: ScanStep;

  /** SCAN-02 결과 (촬영본 또는 앨범 원본). */
  sourceUri: string | null;
  sourceSize: { width: number; height: number } | null;
  /** SCAN-03 크롭/회전 미리보기 결과. 압축 전 상태. */
  adjustedUri: string | null;
  /** SCAN-04 결과. `/api/scan` 과 `/api/commit` 에 **같은 파일**을 보낸다. */
  prepared: PreparedImage | null;

  /** 0~1 업로드 바이트 실측 진행률. 서버 추론 구간에는 갱신되지 않는다. */
  uploadProgress: number;
  uploadPhase: UploadPhase | null;

  scan: ScanResult | null;
  /** 확정 문서 종류. 사용자가 바꿨을 수 있다. */
  docType: DocumentType;
  typeSource: TypeSource;
  /** 서버가 준 원래 신뢰도. 사용자 선택으로 조작하지 않는다 (§9-3 #3). */
  confidence: number;

  /** 사용자가 편집한 최종 필드값 (snake_case 키). */
  values: ParsedFields;
  receiptItems: ReceiptItemInput[];

  /** R1 — 커밋 성공 시 여기 고정하고 저장 재시도 때 재커밋하지 않는다. */
  committedImageUrl: string | null;
  /** R2 — 커밋 실패를 감수하고 저장했는지. */
  imageMissing: boolean;

  savedId: string | number | null;
  /** 부분 성공 경고 (임베딩 실패). 서버 message 원문. */
  saveWarning: string | null;

  failure: ScanFailure | null;
  /** SCR-11 `다시 시도` 최대 3회 정책용. */
  scanAttempts: number;
  /** §12 연속 스캔 루프 — 카메라 상단 `이번 세션 {n}장 저장됨`. */
  sessionSavedCount: number;

  /** 진행 중인 업로드 취소 핸들. 직렬화 대상이 아니다. */
  cancelUpload: (() => void) | null;
};

export type ScanActions = {
  reset: () => void;
  resetForNextScan: () => void;

  setSource: (uri: string, size?: { width: number; height: number } | null) => void;
  setAdjusted: (uri: string) => void;
  clearAdjusted: () => void;

  /** SCAN-04. 실패 시 SCF-03 / SCF-04 로 failure 를 세운다. */
  prepare: (options?: PrepareOptions) => Promise<boolean>;

  /** SCAN-05 ~ SCAN-07. prepared 가 없으면 아무것도 하지 않는다. */
  runScan: () => Promise<boolean>;
  cancelScan: () => void;

  /** 종류 선택 시트/칩. 커밋 이후에는 무시한다 (R3). */
  setDocType: (next: DocumentType) => void;
  /** SCF-10 에서 `그래도 직접 입력` — 빈 폼으로 편집 단계에 들어간다. */
  enterManualEntry: (type?: DocumentType) => void;

  setValue: (key: string, value: string) => void;
  setValues: (patch: ParsedFields) => void;

  addReceiptItem: (item?: ReceiptItemInput) => void;
  updateReceiptItem: (index: number, patch: Partial<ReceiptItemInput>) => void;
  removeReceiptItem: (index: number) => void;

  /** SCAN-09 단독 커밋. 보통은 save() 안에서 자동 수행된다. */
  commit: () => Promise<boolean>;
  /** SCAN-09 ~ SCAN-12. `allowMissingImage` 는 SCF-11 다이얼로그의 `이미지 없이 저장`. */
  save: (options?: { allowMissingImage?: boolean }) => Promise<boolean>;

  clearFailure: () => void;
  /** 권한 거부(SCF-01/02)처럼 네트워크 밖에서 발생한 실패를 화면 대신 스토어에 싣는다. */
  setFailure: (failure: ScanFailure | null) => void;
};

export type ScanStore = ScanState & ScanActions;

const initialState: ScanState = {
  step: 'idle',
  sourceUri: null,
  sourceSize: null,
  adjustedUri: null,
  prepared: null,
  uploadProgress: 0,
  uploadPhase: null,
  scan: null,
  docType: 'ETC',
  typeSource: 'auto',
  confidence: 0,
  values: {},
  receiptItems: [],
  committedImageUrl: null,
  imageMissing: false,
  savedId: null,
  saveWarning: null,
  failure: null,
  scanAttempts: 0,
  sessionSavedCount: 0,
  cancelUpload: null,
};

export const useScanStore = create<ScanStore>((set, get) => ({
  ...initialState,

  reset: () => {
    get().cancelUpload?.();
    set({ ...initialState });
  },

  // §12 연속 스캔: 세션 카운터만 유지하고 나머지를 초기화한다.
  resetForNextScan: () => {
    get().cancelUpload?.();
    set({ ...initialState, sessionSavedCount: get().sessionSavedCount });
  },

  setSource: (uri, size = null) =>
    set({
      sourceUri: uri,
      sourceSize: size,
      adjustedUri: null,
      prepared: null,
      step: 'captured',
      failure: null,
      uploadProgress: 0,
      uploadPhase: null,
      scanAttempts: 0,
    }),

  setAdjusted: (uri) => set({ adjustedUri: uri, prepared: null, step: 'cropped', failure: null }),

  clearAdjusted: () => set({ adjustedUri: null, prepared: null }),

  prepare: async (options = {}) => {
    const { sourceUri, sourceSize, adjustedUri } = get();
    // 크롭 화면이 `cropAndRotate` 로 이미 결과 파일을 만들었다면 그것을 입력으로 쓴다.
    // 그 경우 crop/rotate 를 **다시 넘기지 말 것** — 이중 적용된다.
    const baseUri = adjustedUri ?? sourceUri;
    if (!baseUri) return false;

    try {
      const prepared = await prepareForUpload(baseUri, {
        size: adjustedUri ? null : (options.size ?? sourceSize),
        rotate: options.rotate,
        crop: options.crop,
      });
      set({ prepared, step: 'cropped', failure: null });
      return true;
    } catch (e) {
      const code = e instanceof ScanPipelineError ? e.code : 'SCF-03';
      const detail = e instanceof Error ? e.message : String(e);
      set({ failure: { code, status: null, detail }, prepared: null });
      return false;
    }
  },

  runScan: async () => {
    const { prepared } = get();
    if (!prepared) {
      // 압축 결과가 없으면 업로드할 것이 없다. 크롭 화면으로 되돌린다.
      set({ failure: { code: 'SCF-03', status: null, detail: 'prepared image missing' } });
      return false;
    }

    // 진행률 콜백이 초기 상태를 덮어쓰지 않도록 **먼저** 세팅한다
    // (uploadMultipart 는 생성 즉시 xhr.send 까지 동기로 진행한다).
    set({
      step: 'uploading',
      uploadProgress: 0,
      uploadPhase: 'sending',
      failure: null,
      scanAttempts: get().scanAttempts + 1,
    });

    const handle = scanImage(prepared, {
      onProgress: (ratio) => {
        // 실측 진행률. 100% 도달 후 서버 추론 구간은 인디터미네이트로 전환한다 (§8).
        set({
          uploadProgress: ratio,
          uploadPhase: ratio >= 1 ? 'reading' : 'sending',
        });
      },
    });
    set({ cancelUpload: handle.cancel });

    const result = await handle.promise;
    set({ cancelUpload: null });

    if (!result.ok) {
      if (result.canceled) {
        // 스캔은 부작용이 없으므로 파일을 보존한 채 크롭 단계로만 되돌린다 (§8 취소 정책).
        set({ step: 'cropped', uploadProgress: 0, uploadPhase: null, failure: null });
        return false;
      }
      set({ step: 'cropped', uploadPhase: null, failure: result.error });
      return false;
    }

    const scan = result.data;
    const defs = buildFieldDefs(scan.type, scan.fields);

    // CLS-06 / SCF-10 — OCR 블록이 0건이면 분류 결과와 무관하게 빈 결과로 처리한다.
    // 블록은 있는데 추출 필드만 비어 있는 경우는 SCF-10 이 아니라 SCR-12 의
    // `인식된 정보가 없습니다.` 배너로 다룬다 → hasNoExtractedValues() 셀렉터.
    const noText = scan.rawBlocks.length === 0;

    // CLS-03 저신뢰 / CLS-04 ETC 는 종류 확정 전까지 폼을 비활성으로 둔다.
    // 그 판단은 화면이 tier 로 하고, 스토어는 편집 단계까지 올려 준다.
    set({
      scan,
      step: 'editing',
      uploadPhase: null,
      uploadProgress: 1,
      docType: scan.type,
      // CLS-05 — 티켓 confidence 1.0 은 키워드 하드코딩이라 실측이 아니다.
      typeSource: scan.type === 'TICKET' && scan.confidence === 1 ? 'keyword' : 'auto',
      confidence: scan.confidence,
      values: initialFieldValues(defs, scan.parsed),
      receiptItems: [],
      committedImageUrl: null,
      imageMissing: false,
      saveWarning: null,
      savedId: null,
      failure: noText ? { code: 'SCF-10', status: null } : null,
    });
    return true;
  },

  cancelScan: () => {
    get().cancelUpload?.();
    set({ cancelUpload: null, uploadProgress: 0, uploadPhase: null });
  },

  setDocType: (next) => {
    const state = get();
    // R3 — `document_type` 이 커밋의 저장 경로와 NER 라벨 디렉터리를 결정한다.
    // 커밋 이후 변경은 고아 파일을 만들므로 막는다.
    if (state.committedImageUrl) return;

    const parsed = state.scan?.parsed ?? {};
    // 서버 `fields` 는 스캔된 원래 종류에만 유효하다. 종류를 바꾸면 앱 내장 스키마를 쓴다
    // (원본 웹 handleTypeChange 도 DOCUMENT_FIELD_SCHEMAS 를 기준으로 재생성한다).
    const serverFields = state.scan && next === state.scan.type ? state.scan.fields : null;
    const nextDefs = buildFieldDefs(next, serverFields);

    set({
      docType: next,
      // 서버 추정치와 같은 값을 골라도 "사용자가 확인했다" 는 사실은 같다.
      // 이 값이 'manual' 로 바뀌어야 CLS-03(저신뢰) 게이트가 풀리고 배지가 `직접 지정함` 이 된다.
      typeSource: 'manual',
      values: inheritFieldValues(nextDefs, state.values, parsed),
      step: state.step === 'classified' ? 'editing' : state.step,
    });
  },

  enterManualEntry: (type) => {
    const state = get();
    const next = type ?? (state.docType === 'ETC' ? 'BUSINESS_CARD' : state.docType);
    const defs = buildFieldDefs(next, null);
    set({
      docType: next,
      typeSource: 'manual',
      values: initialFieldValues(defs, {}),
      step: 'editing',
      failure: null,
    });
  },

  setValue: (key, value) => set({ values: { ...get().values, [key]: value } }),

  setValues: (patch) => set({ values: { ...get().values, ...patch } }),

  addReceiptItem: (item) =>
    set({
      receiptItems: [
        ...get().receiptItems,
        item ?? { itemName: '', quantity: null, unitPrice: null, totalPrice: null, category: null },
      ],
    }),

  updateReceiptItem: (index, patch) =>
    set({
      receiptItems: get().receiptItems.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }),

  removeReceiptItem: (index) =>
    set({ receiptItems: get().receiptItems.filter((_, i) => i !== index) }),

  commit: async () => {
    const state = get();
    if (state.committedImageUrl) return true; // R1 — 재커밋 금지
    if (!state.prepared) return false;
    if (!isSavableDocumentType(state.docType)) {
      set({ failure: { code: 'CLS-04', status: null } });
      return false;
    }

    const handle = commitDocument(
      state.prepared,
      state.docType,
      state.scan?.rawBlocks ?? [],
      state.values,
    );
    set({ cancelUpload: handle.cancel, failure: null });

    const result = await handle.promise;
    set({ cancelUpload: null });

    if (!result.ok) {
      if (!result.canceled) set({ failure: result.error });
      return false;
    }
    set({ committedImageUrl: result.data.imageUrl, imageMissing: !result.data.imageUrl });
    return true;
  },

  save: async (options = {}) => {
    const state = get();
    if (!isSavableDocumentType(state.docType)) {
      set({ failure: { code: 'CLS-04', status: null } });
      return false;
    }

    set({ step: 'saving', failure: null });

    const result = await saveDocument({
      documentType: state.docType,
      fields: state.values,
      // R1 — 이미 커밋했다면 그 값을 그대로 넘겨 재커밋을 막는다.
      imageUrl: state.committedImageUrl ?? '',
      rawTexts: state.scan?.rawTexts ?? [],
      rawBlocks: state.scan?.rawBlocks ?? [],
      confidence: state.confidence,
      file: state.prepared,
      receiptItems: state.docType === 'RECEIPT' ? state.receiptItems : [],
      serverFields: state.scan && state.docType === state.scan.type ? state.scan.fields : null,
      allowMissingImage: options.allowMissingImage ?? false,
      // R1 — /save 가 실패해도 커밋 결과를 즉시 고정해 재시도 시 재커밋을 막는다.
      onImageUrlResolved: (imageUrl) => set({ committedImageUrl: imageUrl }),
    });

    if (!result.ok) {
      set({ step: 'editing', failure: result.canceled ? null : result.error });
      return false;
    }

    set({
      step: 'done',
      savedId: result.data.id ?? null,
      committedImageUrl: result.data.imageUrl || null,
      imageMissing: result.data.imageMissing,
      saveWarning: result.data.message ?? null,
      sessionSavedCount: get().sessionSavedCount + 1,
      failure: null,
    });
    return true;
  },

  clearFailure: () => set({ failure: null }),

  setFailure: (failure) => set({ failure }),
}));

// ───────────────────────────────────────────────────────────── 파생 셀렉터

/**
 * CLS-01 ~ CLS-06 등급 판정. 화면은 이 값으로 배지/확인 바/선택 시트를 결정한다.
 * 임계값은 Camera and Scan §9-2 의 확정값(0.80 / 0.55)을 쓴다.
 */
export function classificationTier(state: ScanState): ClassificationTier {
  if (!state.scan) return 'pick';
  if (state.scan.rawBlocks.length === 0) return 'empty';
  if (state.docType === 'ETC') return 'blocked';
  if (state.typeSource === 'manual') return 'manual';
  // CLS-05 — 티켓은 이미지 분류 모델에 클래스가 없고 키워드 2개 매칭 시 1.0 을 하드코딩한다.
  // 실제 신뢰도가 아니므로 수치를 표시하지 않는다.
  if (state.docType === 'TICKET' && state.confidence === 1) return 'keyword';
  if (state.confidence >= CONFIDENCE_CONFIRM_THRESHOLD) return 'confident';
  if (state.confidence >= CONFIDENCE_PICK_THRESHOLD) return 'confirm';
  return 'pick';
}

/**
 * OCR 블록은 있는데 추출된 필드 값이 하나도 없는 상태.
 * SCR-12 의 `인식된 정보가 없습니다. / 직접 입력하거나 다시 촬영해 주세요.` 배너 조건이다.
 * (SCF-10 은 글자 자체를 못 읽은 경우이므로 문구를 섞지 않는다.)
 */
export function hasNoExtractedValues(state: ScanState): boolean {
  if (!state.scan) return false;
  if (state.scan.rawBlocks.length === 0) return false;
  return Object.values(state.scan.parsed).every((v) => v.trim() === '');
}

/** 신뢰도 배지 문구. `keyword`/`manual` 은 수치를 노출하지 않는다. */
export function confidenceBadge(state: ScanState): string {
  const tier = classificationTier(state);
  if (tier === 'keyword') return '키워드로 추정됨';
  if (tier === 'manual') return '직접 지정함';
  return `신뢰도 ${(state.confidence * 100).toFixed(1)}%`;
}

/** 현재 종류/서버 라벨에 맞는 필드 정의 목록 (FLD-01/02). */
export function currentFieldDefs(state: ScanState): FieldDef[] {
  const serverFields = state.scan && state.docType === state.scan.type ? state.scan.fields : null;
  return buildFieldDefs(state.docType, serverFields);
}

export function currentValidation(state: ScanState): FieldValidation {
  return validateFields(currentFieldDefs(state), state.values);
}

/** §10-3 소프트 경고. 저장을 막지 않는다. */
export function currentSoftWarning(state: ScanState): string | null {
  return softWarningFor(state.docType, state.values);
}

/**
 * 저장 가능 여부.
 * - ETC 는 저장 경로가 없다 (CLS-04).
 * - A등급 정규화 게이트를 통과해야 한다 (FLD-06).
 * - 저신뢰(`pick`)는 종류를 확정하기 전까지 폼이 비활성이다 (CLS-03).
 */
export function canSave(state: ScanState): boolean {
  if (state.step === 'saving') return false;
  if (!isSavableDocumentType(state.docType)) return false;
  if (classificationTier(state) === 'pick') return false;
  return currentValidation(state).ok;
}
