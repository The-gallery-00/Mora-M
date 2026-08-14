/**
 * 스캔 파이프라인 코어 (Phase 3) 배럴.
 *
 * 화면(`app/scan/*`)은 이 파일만 import 한다.
 * 계층 규약: 화면은 `useScan()` 만 쓰고, 스토어/네트워크/이미지 계층에 직접 손대지 않는다.
 */

export type {
  AdjustedImage,
  ClassificationTier,
  CommitResult,
  CropRect,
  DocumentType,
  OcrImageSize,
  ParsedFields,
  PreparedImage,
  RawBlock,
  ReceiptItemInput,
  SavableDocumentType,
  SaveDocumentResult,
  ScanApiResult,
  ScanFailure,
  ScanFailureCode,
  ScanResult,
  ScanStep,
  TypeSource,
  UploadHandle,
  UploadPhase,
} from './types';
export {
  DOCUMENT_TYPES,
  SAVABLE_DOCUMENT_TYPES,
  ScanPipelineError,
  TYPE_LABELS,
  isDocumentType,
  isSavableDocumentType,
} from './types';

export type { FieldDef, FieldInputType, FieldValidation } from './fieldSchema';
export {
  COMMON_FIELD_MAP,
  CURRENCY_CODE_OPTIONS,
  DOCUMENT_FIELD_DEFS,
  DOCUMENT_FIELD_SCHEMAS,
  PAYMENT_METHOD_OPTIONS,
  PERSISTED_FIELD_KEYS,
  TRANSPORT_TYPE_OPTIONS,
  buildDocumentZodSchema,
  buildFieldDefs,
  fieldZodSchema,
  formatMoney,
  formatMoneyKo,
  inferFieldDef,
  inheritFieldValues,
  initialFieldValues,
  isIsoDate,
  isIsoTime,
  normalizePhone,
  parseMoney,
  receiptItemSchema,
  recognitionSummary,
  softWarningFor,
  toIsoDate,
  toIsoTime,
  validateFieldValue,
  validateFields,
  warnFieldValue,
} from './fieldSchema';

export type { PrepareOptions } from './imagePipeline';
export {
  IMAGE_SPEC,
  UPLOAD_FILE_NAME,
  cropAndRotate,
  normalizeRotation,
  prepareForUpload,
  readImageSize,
} from './imagePipeline';

export type { CommitOptions, SaveBodyArgs, SaveDocumentArgs, ScanImageOptions } from './api';
export {
  COMMIT_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  buildSaveBody,
  commitDocument,
  saveDocument,
  scanImage,
  unwrapCommit,
  unwrapScan,
} from './api';

export type { RunScanOptions, ScanActions, ScanState, ScanStore } from './scanStore';
export {
  CONFIDENCE_CONFIRM_THRESHOLD,
  CONFIDENCE_PICK_THRESHOLD,
  canSave,
  classificationTier,
  confidenceBadge,
  currentFieldDefs,
  currentSoftWarning,
  currentValidation,
  hasNoExtractedValues,
  useScanStore,
} from './scanStore';

export type { PermissionOutcome, PickOutcome, ScanFailureMessage } from './useScan';
export { SCR11_STEP_LABELS, UPLOAD_PHASE_LABELS, describeFailure, useScan } from './useScan';
