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

export type RunScanOptions = {
  /** 서버로 보낼 문서 종류. 생략하면 `requestedDocType`, 그것도 없으면 서버 기본값. */
  documentType?: DocumentType;
  /**
   * 사용자가 종류를 직접 골라 다시 파싱하는 경우.
   * 두 가지를 함께 바꾼다 — `typeSource` 를 'manual' 로 두고(확인했다는 사실),
   * 이미 입력된 값을 새 파싱 결과보다 우선한다(타이핑한 것을 지우지 않는다).
   */
  userChosen?: boolean;
};

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

  /**
   * 촬영 화면 힌트 칩이 고른 종류. 첫 스캔의 `document_type` 이 된다.
   *
   * `docType` 과 다른 값이다: 이쪽은 **요청**(스캔하기 전의 의도)이고 `docType` 은
   * **현재 확정된 종류**(스캔 응답 또는 사용자 선택의 결과)다. 칩을 누르지 않으면
   * null 이고, 그러면 파트를 보내지 않아 서버 기본값 BUSINESS_CARD 로 파싱된다.
   */
  requestedDocType: DocumentType | null;

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
  /**
   * 촬영 화면에서 고른 문서 유형 힌트. 첫 스캔의 `document_type` 이 된다.
   * null 이면 파트를 보내지 않고 서버 기본값(BUSINESS_CARD)에 맡긴다.
   */
  setRequestedDocType: (next: DocumentType | null) => void;

  /** SCAN-05 ~ SCAN-07. prepared 가 없으면 아무것도 하지 않는다. */
  runScan: (options?: RunScanOptions) => Promise<boolean>;
  cancelScan: () => void;
  /**
   * 문서 종류를 바꾸고 **같은 이미지를 그 종류로 다시 파싱한다.**
   *
   * 서버 파서는 종류마다 다른 규칙을 돌린다. 종류만 바꾸고 재파싱을 하지 않으면
   * 포스터 탭을 눌러도 명함 파싱 결과(또는 빈 값)가 그대로 남는다 — 사용자에게는
   * "종류를 바꿔도 아무것도 안 채워진다" 로 보인다.
   *
   * 재스캔이 불가능하거나 불필요한 경우에는 `setDocType` 과 동일하게 상태만 바꾼다:
   *  · 커밋 이후(R3) — 저장 경로가 확정됐으므로 종류 변경 자체가 금지다
   *  · 압축 결과가 없음 — 보낼 파일이 없다 (수기 입력 진입 등)
   *  · 이미 그 종류로 스캔했음 — 같은 요청을 반복할 이유가 없다
   * 재스캔이 실패하면 종류 변경은 유지하고 실패만 노출한다. 사용자 입력값은
   * 어느 경로에서도 보존된다(inheritFieldValues 의 ① 현재 입력값 우선).
   */
  rescanAs: (next: DocumentType) => Promise<boolean>;

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
  requestedDocType: null,
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

  setRequestedDocType: (next) => set({ requestedDocType: next }),

  runScan: async (options = {}) => {
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

    /* 서버로 보낼 문서 종류.
       ① 호출자가 명시한 값(재파싱) → ② 촬영 화면 힌트 칩 → ③ 미지정(서버 기본값).
       ETC 는 보내지 않는다 — 서버 DOCUMENT_FIELDS["ETC"] 가 빈 dict 라 파싱이 반드시
       비고, 그것은 "종류를 안 골랐다" 와 구별되지 않는 결과다. 초기 docType 이 'ETC'
       이므로 이 가드가 없으면 힌트 칩을 누르지 않은 첫 스캔이 ETC 로 나간다. */
    const requested = options.documentType ?? get().requestedDocType ?? null;
    const documentType = requested && requested !== 'ETC' ? requested : undefined;

    /* 이 스캔의 종류를 **사용자가 정했는가.**
       결과 화면 탭(userChosen)과 촬영 화면 힌트 칩(requestedDocType) 둘 다 해당한다.
       아래 typeSource 판정이 이 값을 쓴다 — 사용자가 고른 종류에 "확인해 주세요" 를
       띄우지 않기 위해서다. */
    const userPicked = Boolean(options.userChosen || documentType);

    const handle = scanImage(prepared, {
      ...(documentType ? { documentType } : {}),
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
      /* 종류의 **출처**를 그대로 기록한다. 셋을 섞지 않는 것이 이 줄의 전부다.
         · 사용자가 골랐다 → `manual`: 결과 화면 탭(userChosen)뿐 아니라 **촬영 화면
           힌트 칩(requestedDocType)도 사용자의 선택**이다. 이것을 'default' 로 두면
           사용자가 방금 고른 종류를 두고 "문서 종류를 확인해 주세요" 배너가 뜬다 —
           이미 한 일을 다시 하라는 안내라 오류로 읽힌다.
         · classified === false → `default`: 서버가 판정을 하지 않았고 사용자도 고르지
           않았다. `type` 은 서버 기본값이고 confidence 0 은 측정값 없음이다.
           "저신뢰" 와 다르다 (→ tier `unclassified`: 확인 바는 띄우되 폼·저장은 잠그지 않는다).
         · CLS-05 — 티켓 confidence 1.0 은 키워드 하드코딩이라 실측이 아니다.
         · 그 외 → `auto`: 서버가 실제로 판정했고 confidence 가 실측값이다. */
      typeSource: userPicked
        ? 'manual'
        : !scan.classified
          ? 'default'
          : scan.type === 'TICKET' && scan.confidence === 1
            ? 'keyword'
            : 'auto',
      confidence: scan.confidence,
      /* 재파싱(rescanAs)에서는 사용자가 이미 손댄 값을 새 파싱 결과로 덮지 않는다.
         inheritFieldValues 의 우선순위가 ① 현재 입력값 ② 별칭 승계 ③ parsed 라
         "종류를 바꿨더니 방금 타이핑한 것이 사라졌다" 가 생기지 않는다.
         첫 스캔은 보존할 입력이 없으므로 initialFieldValues 를 그대로 쓴다. */
      values: options.userChosen
        ? inheritFieldValues(defs, get().values, scan.parsed)
        : initialFieldValues(defs, scan.parsed),
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

  rescanAs: async (next) => {
    const state = get();

    // 상태만 바꾸고 끝내는 세 경우. 어느 쪽도 오류가 아니므로 true 를 돌려준다.
    //  · 커밋 이후(R3): setDocType 이 이미 막는다. 여기서도 같은 판정을 먼저 한다.
    //  · 보낼 파일이 없음: 수기 입력 진입 등. 재스캔할 대상이 없다.
    //  · 이미 그 종류로 스캔했음: 같은 요청을 반복할 이유가 없다.
    //    (`scan.type` 은 서버가 우리가 보낸 값을 되돌려준 것이라 요청 종류와 같다.)
    if (state.committedImageUrl || !state.prepared || state.scan?.type === next) {
      state.setDocType(next);
      return true;
    }

    // 먼저 종류를 반영한다. 재스캔이 실패해도 사용자가 고른 종류는 유지되어야 하고,
    // 그 사이 화면이 그리는 폼도 새 종류의 것이어야 한다(빈 폼이 옛 종류로 보이면 안 된다).
    state.setDocType(next);

    return get().runScan({ documentType: next, userChosen: true });
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
 *
 * ── `unclassified` 를 나눈 이유 (2026-08-05 4차) ─────────────────────────────
 * "서버가 분류를 **안 했다**" 와 "서버가 분류했는데 **확신이 낮다**" 는 다른 사건인데,
 * 종전에는 둘 다 confidence 0 → `pick` 으로 접혔다. `pick` 은 폼·저장을 잠그는 등급이라
 * (`canSave` 아래 · `review.tsx locked`) **모든 스캔이 잠긴 채 도착**했고, 그 잠금을 푸는 유일한
 * 경로가 `setDocType` 인데 그 트리거인 `SegmentedControl` 은 이미 선택된 칩의 재탭을 삼킨다
 * (`src/components/ui/SegmentedControl.tsx:99` — `option.value === value` 면 onChange 미발화).
 * 즉 명함을 정상 스캔하면 저장까지 갈 방법이 사실상 없었다.
 *
 * 미판정은 "위험 신호" 가 아니라 **정보 없음**이다. 명함 전용 파이프라인이 명함 필드를 뽑아낸
 * 이상 BUSINESS_CARD 를 기본값으로 제시하고 사용자가 바꾸게 하는 것이 정직하며 막다른 길도 없다.
 * → 확인 바는 띄우되(종류를 바꿀 수 있다는 사실을 알려야 하므로) 폼·저장은 열어 둔다.
 *
 * 임계 로직(0.80 / 0.55)은 **손대지 않았다.** 실제 분류기가 붙어 진짜 confidence 가 오면
 * `confident`/`confirm`/`pick` 이 그대로 다시 살아난다.
 */
export function classificationTier(state: ScanState): ClassificationTier {
  /* 스캔 결과가 아예 없는 상태. 단 **수기 입력(`enterManualEntry`)은 예외**다.
     ── 2026-08-05 4차에 발견한 같은 계열의 막다른 길 ──────────────────────────
     SCR-11 의 `직접 입력`(SCF-03/06/07/08/09 → `analyzing.tsx handleManualEntry`)은 스캔이
     한 번도 성공하지 않은 상태로 SCR-12 에 들어간다 → `state.scan` 이 null 이라 이 줄이
     `pick` 을 돌려주고, `review.tsx` 가 폼을 통째로 잠갔다. **`직접 입력` 이라는 라벨이 약속한
     동작(빈 폼에 직접 입력)이 실제로는 일어나지 않았다.** 게다가 그 잠금의 유일한 해제 경로인
     종류 칩은 이미 선택된 값을 재탭해도 반응하지 않는다(SegmentedControl:99).
     `enterManualEntry` 는 `typeSource: 'manual'` 을 세우므로, 그 사실을 먼저 존중한다.
     (SCF-10 의 `그래도 직접 입력` 은 스캔이 성공한 뒤라 `scan` 이 있어 종전에도 통과했다.) */
  if (!state.scan) return state.typeSource === 'manual' ? 'manual' : 'pick';
  if (state.scan.rawBlocks.length === 0) return 'empty';
  if (state.docType === 'ETC') return 'blocked';
  if (state.typeSource === 'manual') return 'manual';
  // 서버가 판정하지 않았다 → 임계 비교 자체가 성립하지 않는다. 임계 분기보다 먼저 걸러낸다.
  if (state.typeSource === 'default') return 'unclassified';
  // CLS-05 — 티켓은 이미지 분류 모델에 클래스가 없고 키워드 2개 매칭 시 1.0 을 하드코딩한다.
  // 실제 신뢰도가 아니므로 수치를 표시하지 않는다.
  if (state.docType === 'TICKET' && state.confidence === 1) return 'keyword';
  if (state.confidence >= CONFIDENCE_CONFIRM_THRESHOLD) return 'confident';
  if (state.confidence >= CONFIDENCE_PICK_THRESHOLD) return 'confirm';
  /* `pick` 은 **실서버 구성에서는 도달하지 않는다** (2026-08-05 4차 확인).
     `/api/scan` 이 `classified:false` 를 내려주는 한 위의 `unclassified` 에서 끝나고,
     맨 위 `!scan` 갈래도 SCR-12 에 도달하는 두 경로가 모두 빠져나간다:
     스캔 성공(→ `scan` 세팅) · 수기 입력(→ `typeSource:'manual'`).
     남는 도달 경로는 **목 모드**뿐이다 — `src/mocks/scan.ts` 가 3회에 1회 confidence 0.48 을
     내려주므로(`LOW_CONFIDENCE_EVERY`) 목 빌드에서는 이 등급과 그 탈출구를 실제로 밟아 볼 수 있다.
     그래도 **로직은 남긴다.** 실제 분류기가 붙어 0 < confidence < 0.55 가 오는 순간 이 등급이
     다시 살아나고, 그때는 "쟀는데 애매하다" 가 사실이므로 잠그는 것이 옳다.
     (그 경우의 탈출구는 `review.tsx` 의 `이 종류가 맞아요` 확인 버튼이 담당한다 — 같은 칩
      재탭이 SegmentedControl 에서 삼켜지는 문제 때문에 칩만으로는 잠금을 풀 수 없다.) */
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

/**
 * 신뢰도 배지 문구.
 *
 * `keyword`(티켓 하드코딩 1.0) / `manual`(사용자 지정) 은 **잰 적이 없는 수치**라 숫자를 감추고
 * 출처를 말한다. 2026-08-05 에 같은 이유로 한 갈래를 더 추가했다.
 *
 * ── `신뢰도 0.0%` 를 없앤 이유 ────────────────────────────────────────────────
 * 서버 파이프라인에는 **문서 분류기가 없다.** 그동안 응답의 `confidence` 자리에는 OCR 인식
 * 신뢰도가 들어가 있었고, 그래서 영수증을 찍어도 `confident` 티어로 확인 없이 명함으로 확정되며
 * `신뢰도 97%` 까지 붙었다 — 측정하지 않은 것을 측정한 척한 거짓 신호다.
 * 그런데 서버가 값을 0 으로 내린 뒤에도 배지는 `신뢰도 0.0%` 를 렌더했다. "0% 확신" 은
 * **잰 결과가 0** 이라는 뜻으로 읽히므로 이 역시 또 다른 거짓 신호다. 잰 적이 없으면 숫자를
 * 쓰지 않는다는 위의 관례를 그대로 적용해 수치 대신 상태를 말한다.
 *
 * 판정 근거는 이제 tier `unclassified`(= 서버가 `classified:false` 를 명시)다.
 * 아래 `typeSource === 'auto' && confidence === 0` 줄은 **그 플래그를 보내지 않는 구버전 배포**
 * 를 위한 하위호환 갈래로 남긴다 — 그 배포에서는 tier 가 `pick` 이지만 배지 문구는 같아야 한다.
 */
export function confidenceBadge(state: ScanState): string {
  const tier = classificationTier(state);
  if (tier === 'keyword') return '키워드로 추정됨';
  if (tier === 'manual') return '직접 지정함';
  if (tier === 'unclassified') return '종류 미확정';
  if (state.typeSource === 'auto' && state.confidence === 0) return '종류 미확정';
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
 *   **미판정(`unclassified`)은 여기에 걸리지 않는다** — 잠글 근거가 되는 측정값이 없기 때문이다
 *   (`classificationTier` 주석 참조). 확인 바만 뜨고 저장은 열린다.
 */
export function canSave(state: ScanState): boolean {
  if (state.step === 'saving') return false;
  if (!isSavableDocumentType(state.docType)) return false;
  if (classificationTier(state) === 'pick') return false;
  return currentValidation(state).ok;
}
