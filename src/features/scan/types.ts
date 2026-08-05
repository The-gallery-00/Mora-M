/**
 * 스캔 파이프라인 공용 타입.
 *
 * 정본: wiki/tech/Camera and Scan.md (SCAN-##, IMG-##, CLS-##, FLD-##, SCF-##)
 *       wiki/tech/Data Model.md §3-5 (스캔 타입) · §2 (필드 키 표)
 *       wiki/tech/API Contract.md §4-4 (이중 래핑) · §5-6 (언랩)
 *
 * 어휘 규칙: OCR 계층은 snake_case, Spring DTO 계층은 camelCase 다.
 * 이 파일과 fieldSchema/scanStore 는 **snake_case 만** 다루고,
 * camelCase 변환은 api.ts 의 저장 바디 조립에서 단 한 번만 일어난다 (FLD-04).
 */

/** 서버와 주고받는 유일한 문서 어휘 (대문자). */
export const DOCUMENT_TYPES = ['BUSINESS_CARD', 'POSTER', 'RECEIPT', 'TICKET', 'ETC'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * 저장 경로가 실제로 존재하는 4종.
 * `ETC` 는 원본 `saveCard` 화이트리스트에 없어 서버 이전에 클라이언트가 막는다 (CLS-04).
 */
export const SAVABLE_DOCUMENT_TYPES = ['BUSINESS_CARD', 'POSTER', 'RECEIPT', 'TICKET'] as const;
export type SavableDocumentType = (typeof SAVABLE_DOCUMENT_TYPES)[number];

/** 원본 `TYPE_LABELS` 그대로. */
export const TYPE_LABELS: Record<DocumentType, string> = {
  BUSINESS_CARD: '명함',
  POSTER: '포스터',
  RECEIPT: '영수증',
  TICKET: '티켓',
  ETC: '기타',
};

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isSavableDocumentType(value: DocumentType): value is SavableDocumentType {
  return value !== 'ETC';
}

/** OCR 이 돌려주는 텍스트 블록 1개. `bbox` 는 4점 폴리곤이고 좌표계는 `imageSize` 기준이다. */
export type RawBlock = {
  block_index: number;
  text: string;
  confidence: number;
  bbox: number[][];
};

export type OcrImageSize = { width: number; height: number };

/** 편집 화면이 다루는 필드 맵. 키는 항상 OCR snake_case, 값은 항상 문자열이다. */
export type ParsedFields = Record<string, string>;

/**
 * API-41 `POST /api/scan` 이중 언랩 결과.
 * 응답 키는 Spring 을 거쳐도 snake_case 그대로 통과하므로 언랩 단계에서만 camelCase 로 옮긴다.
 */
export type ScanResult = {
  type: DocumentType;
  /**
   * 서버가 문서 **종류를 실제로 판정했는가**.
   *
   * `server/ocr` 파이프라인에는 문서 종류 분류기가 없다 — 명함 전용이다
   * (`server/ocr/src/classifier/rule_based.py` 는 명함 *필드* 분류용 정규식이지 종류 분류기가 아니다).
   * 그래서 `/api/scan` 응답의 `type` 은 판정 결과가 아니라 **파이프라인이 명함 전용이라는 사실에서
   * 온 기본값**이고 `confidence` 0 은 "낮다" 가 아니라 **"측정값이 없다"** 는 뜻이다.
   * 서버는 이 사실을 `"classified": false` 로 명시한다.
   *
   * **하위호환**: 이 키가 없는 구버전 배포 응답은 `true` 로 읽는다(= 종전 동작 = confidence 임계
   * 로직이 그대로 판단한다). 값이 없다고 "판정하지 않았다" 로 단정하면, 실제 분류기가 붙은
   * 서버까지 미판정으로 취급하게 된다.
   */
  classified: boolean;
  /**
   * 0~1. TICKET 은 키워드 2개 매칭 시 서버가 1.0 을 하드코딩한다 (실측 아님 — CLS-05).
   * `classified === false` 면 이 값은 **측정된 적이 없다** — 숫자로 표시해선 안 된다.
   */
  confidence: number;
  /** 값이 실제로 추출된 필드만 들어온다. 빈 값은 키 자체가 없다. */
  parsed: ParsedFields;
  /** `{필드키: 한국어라벨}` 전체 목록. 폼 렌더링 1순위 소스 (FLD-01). */
  fields: Record<string, string>;
  /** 영수증 품목. 서버 파서 미구현이라 항상 `[]`. */
  items: unknown[];
  rawTexts: string[];
  rawBlocks: RawBlock[];
  /** 스캔 단계에서는 **항상 빈 문자열**. 영구 URL 은 API-63 커밋에서 받는다. */
  imageUrl: string;
  imageSize: OcrImageSize | null;
};

/**
 * 다단계 흐름 상태.
 * `idle → captured → cropped → uploading → classified → editing → saving → done`
 */
export type ScanStep =
  | 'idle'
  | 'captured'
  | 'cropped'
  | 'uploading'
  | 'classified'
  | 'editing'
  | 'saving'
  | 'done';

/**
 * SCR-11 진행 표기 (Camera and Scan §8).
 * `sending` 구간만 실측 진행률이 있고, 그 뒤는 서버 추론 시간이라 인디터미네이트다.
 */
export type UploadPhase = 'sending' | 'reading' | 'organizing';

/**
 * 사용자가 문서 종류를 어떻게 얻었는지 — 배지 문구가 갈린다 (CLS-01/05, §9-3).
 *
 * - `auto`    : 서버가 판정한 결과 (`confidence` 가 실측값)
 * - `keyword` : TICKET 키워드 매칭 하드코딩 1.0 (CLS-05 — 실측 아님)
 * - `manual`  : 사용자가 직접 지정
 * - `default` : **서버가 판정을 하지 않았다**(`ScanResult.classified === false`). `type` 은
 *               명함 전용 파이프라인의 기본값일 뿐이므로 `auto` 와 섞으면 안 된다 —
 *               `auto` 는 "쟀다", `default` 는 "잰 적이 없다" 다.
 */
export type TypeSource = 'auto' | 'keyword' | 'manual' | 'default';

/**
 * 분류 결과 처리 등급 (CLS-01~06).
 * - `empty`        : rawBlocks 0건 → SCF-10 (분류 결과와 무관)
 * - `blocked`      : ETC → 저장 불가, 4종 선택 강제
 * - `unclassified` : **서버가 분류를 수행하지 않았다.** 종류는 기본값 제시일 뿐이므로 확인 바를
 *                    띄우되 폼·저장은 **잠그지 않는다**(잠글 근거가 되는 측정값이 애초에 없다).
 * - `keyword`      : TICKET + confidence 1.0 → 수치 숨기고 `키워드로 추정됨`
 * - `manual`       : 사용자가 직접 지정
 * - `confident`    : ≥ 0.80
 * - `confirm`      : 0.55 ~ 0.80 → 확인 바
 * - `pick`         : < 0.55 → 폼 진입 전 종류 확정 강제 (실제 분류기가 낸 저신뢰 전용)
 */
export type ClassificationTier =
  | 'empty'
  | 'blocked'
  | 'unclassified'
  | 'keyword'
  | 'manual'
  | 'confident'
  | 'confirm'
  | 'pick';

/** SCAN-04 압축 결과. `/api/scan` 과 `/api/commit` 에 **같은 파일을 그대로** 재전송한다. */
export type PreparedImage = {
  uri: string;
  /** multipart 파트의 파일명. 확장자가 없으면 OCR 의 suffix 추출이 실패한다. */
  name: string;
  type: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
};

/** SCAN-03 크롭/회전 중간 결과 (미리보기 전용). */
export type AdjustedImage = {
  uri: string;
  width: number;
  height: number;
};

/** expo-image-manipulator 의 crop 사각형. 좌상단 원점 + 픽셀 크기. */
export type CropRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

/** 영수증 품목 수기 입력 행 (Data Model §1-5 / §3-6). */
export type ReceiptItemInput = {
  itemName: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  category?: string | null;
};

/**
 * 실패 케이스 코드.
 * `SCF-01`~`SCF-13` 은 Camera and Scan §13 표의 ID 를 그대로 쓴다.
 * `CLS-04`(ETC 저장 차단), `FLD-06`(정규화 게이트 불통과)는 같은 문서의 다른 ID 를 재사용한다.
 * `CANCELED` 는 사용자가 직접 취소한 경우이며 **어떤 문구도 노출하지 않는다**
 * (API Contract §4-5: canceled → 토스트 없음).
 */
export type ScanFailureCode =
  | 'CANCELED'
  | 'SCF-01'
  | 'SCF-02'
  | 'SCF-03'
  | 'SCF-04'
  | 'SCF-05'
  | 'SCF-06'
  | 'SCF-07'
  | 'SCF-08'
  | 'SCF-09'
  | 'SCF-10'
  | 'SCF-11'
  | 'SCF-12'
  | 'SCF-13'
  | 'CLS-04'
  | 'FLD-06';

/**
 * 화면에 전달하는 실패 정보.
 * **문구는 넣지 않는다** — 서버 에러 문자열을 UI 에 노출하지 않기 위해(§13 공통 규칙)
 * 코드 + status 만 나르고, 한국어 문구는 useScan 의 매핑표가 소유한다.
 */
export type ScanFailure = {
  code: ScanFailureCode;
  status: number | null;
  /** 로그 전용 원문. 절대 화면에 그대로 뿌리지 않는다. */
  detail?: string;
};

/** 이미지 준비 단계에서 던지는 에러. 코드는 그대로 ScanFailure 로 승격된다. */
export class ScanPipelineError extends Error {
  readonly code: ScanFailureCode;

  constructor(code: ScanFailureCode, message?: string) {
    super(message ?? code);
    this.name = 'ScanPipelineError';
    this.code = code;
  }
}

/** API-63 커밋 응답 (단일 래핑). `imageUrl` 은 `/uploads/{TYPE}/{uuid}.jpg` 상대경로다. */
export type CommitResult = {
  imageUrl: string;
  /** 누적된 NER 라벨 건수. 블록/필드가 비면 0 이 온다. */
  count: number;
};

export type SaveDocumentResult = {
  /** 명함은 UUID(string), 포스터·티켓·영수증은 Integer(number). 통일하지 않는다. */
  id?: string | number;
  /** 최종적으로 저장에 사용한 image_url. 커밋 실패 후 강행하면 빈 문자열이다. */
  imageUrl: string;
  /** 커밋 실패를 감수하고 저장했는지 (R2). 완료 화면 배너 판단용. */
  imageMissing: boolean;
  /** 부분 성공 경고 (임베딩 실패). 서버 `message` 원문 — 이 값만은 예외적으로 노출한다(§11-2). */
  message?: string;
};

/** 스캔 계층 공통 결과. 실패는 항상 SCF 코드로 좁혀진다. */
export type ScanApiResult<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: ScanFailure; canceled?: boolean };

/** 진행률 + 취소를 함께 넘기기 위한 업로드 핸들. */
export type UploadHandle<T> = {
  promise: Promise<ScanApiResult<T>>;
  cancel: () => void;
};
