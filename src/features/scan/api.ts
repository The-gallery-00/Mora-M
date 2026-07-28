import { getApiBaseUrl, getOcrBaseUrl } from '@/config/env';
import { request } from '@/services/http';
import { getTokenSync } from '@/services/session';

import { parseMoney, validateFields, buildFieldDefs } from './fieldSchema';
import {
  type CommitResult,
  type DocumentType,
  type ParsedFields,
  type PreparedImage,
  type RawBlock,
  type ReceiptItemInput,
  type SaveDocumentResult,
  type SavableDocumentType,
  type ScanApiResult,
  type ScanFailure,
  type ScanFailureCode,
  type ScanResult,
  type UploadHandle,
  isDocumentType,
  isSavableDocumentType,
} from './types';

/**
 * 스캔 파이프라인 네트워크 계층.
 *
 * 정본: wiki/tech/API Contract.md §3-9(API-41) · §3-15(API-63) · §4-1(RN multipart) ·
 *       §4-4(이중 래핑) · §5-5(XHR 업로더) · §5-6(언랩)
 *       wiki/tech/Camera and Scan.md §7(멀티파트·타임아웃) · §11(저장 시퀀스·보상 규칙)
 *
 * 서버 base URL 이 2개다: Spring `:8080`(스캔·저장) / OCR FastAPI `:8000`(커밋).
 * 커밋은 Spring 을 우회하므로 방화벽 포트도 2개를 열어야 한다.
 */

// ───────────────────────────────────────────────────────────── 타임아웃 (§7-4)

/**
 * PaddleOCR 첫 요청은 모델 lazy 로드까지 포함해 수십 초가 걸릴 수 있다.
 *
 * 60s → 120s 상향(2026-07-28). 서버가 Cloud Run 이라 인스턴스가 잠들면 **콜드스타트에
 * 컨테이너 기동 + 가중치 844MB 로드**가 얹힌다. gunicorn 자체는 `--timeout 300` 이므로
 * 앱이 먼저 끊는 구조였다 — [[Risks]] RSK-43. LAN 개발에서는 재현되지 않는다.
 */
export const SCAN_TIMEOUT_MS = 120_000;
/**
 * 이미지 저장 + 라벨 파일 쓰기만 하고 OCR 추론이 없다.
 * (API Contract §9 표는 60s 로 적혀 있으나 파이프라인 정본인 Camera and Scan §7-4 의 45s 를 따른다.)
 */
export const COMMIT_TIMEOUT_MS = 45_000;
/** OpenAI 임베딩 호출을 포함하지만 실패해도 서버가 부분성공으로 200 을 준다. */
export const SAVE_TIMEOUT_MS = 20_000;

// ───────────────────────────────────────────────────────────── 언랩 (§5-6)

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : {};

const asStringMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(value))) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
};

const asRawBlocks = (value: unknown): RawBlock[] => {
  if (!Array.isArray(value)) return [];
  const out: RawBlock[] = [];
  value.forEach((item, index) => {
    const block = asRecord(item);
    const text = typeof block.text === 'string' ? block.text : '';
    out.push({
      block_index: typeof block.block_index === 'number' ? block.block_index : index,
      text,
      confidence: typeof block.confidence === 'number' ? block.confidence : 0,
      bbox: Array.isArray(block.bbox) ? (block.bbox as number[][]) : [],
    });
  });
  return out;
};

/**
 * API-41 이중 언랩. Spring 이 FastAPI 응답 JSON 을 통째로 다시 `ApiResponse` 로 감싸므로
 * `{success, data:{success, data:{...}}}` 구조가 된다. `data.data` 를 우선하고 없으면 `data`.
 * 안쪽 키는 Spring 을 거쳐도 **snake_case 그대로** 통과한다.
 */
export function unwrapScan(json: unknown): ScanResult {
  const root = asRecord(json);
  const outer = asRecord(root.data);
  const inner = outer.data !== undefined ? asRecord(outer.data) : outer;

  // 원본 웹과 동일한 2단 폴백: 안쪽에 키가 없으면 한 겹 바깥에서 찾는다.
  const pick = (key: string): unknown => (inner[key] !== undefined ? inner[key] : outer[key]);

  const rawBlocks = asRawBlocks(pick('raw_blocks'));
  const type = pick('type');
  const confidence = pick('confidence');
  const imageSize = asRecord(pick('image_size'));

  return {
    type: isDocumentType(type) ? type : 'ETC',
    confidence: typeof confidence === 'number' ? confidence : 0,
    parsed: asStringMap(pick('parsed')),
    fields: asStringMap(pick('fields')),
    items: Array.isArray(pick('items')) ? (pick('items') as unknown[]) : [],
    rawTexts: rawBlocks.map((b) => b.text),
    rawBlocks,
    imageUrl: typeof pick('image_url') === 'string' ? (pick('image_url') as string) : '',
    imageSize:
      typeof imageSize.width === 'number' && typeof imageSize.height === 'number'
        ? { width: imageSize.width, height: imageSize.height }
        : null,
  };
}

/** API-63 단일 래핑. `image_url` 은 `/uploads/{TYPE}/{uuid}.jpg` 상대경로다. */
export function unwrapCommit(json: unknown): CommitResult {
  const data = asRecord(asRecord(json).data);
  return {
    imageUrl: typeof data.image_url === 'string' ? data.image_url : '',
    count: typeof data.count === 'number' ? data.count : 0,
  };
}

// ───────────────────────────────────────────────────────── multipart 업로더

type UploadFailureKind = 'network' | 'timeout' | 'canceled' | 'http' | 'parse';

type UploadArgs<T> = {
  url: string;
  file: PreparedImage;
  /** 추가 폼 필드. 값은 **전부 문자열**이어야 한다 (FastAPI `Form(str)`). */
  fields?: Record<string, string>;
  /** Authorization 헤더를 붙일지. `/api/commit` 은 인증을 검사하지 않으므로 false. */
  authorize: boolean;
  timeoutMs: number;
  /** 0~1. **실측값**이다 (아래 주석 참조). */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  parse: (json: unknown) => T;
  mapFailure: (
    kind: UploadFailureKind,
    status: number | null,
    body: unknown,
    raw: string,
  ) => ScanFailure;
};

/**
 * RN 전용 multipart 업로더.
 *
 * **진행률은 가짜가 아니다.** `fetch` 는 업로드 진행률을 노출하지 않으므로
 * `XMLHttpRequest.upload.onprogress`(RN 이 네이티브에서 실제 전송 바이트를 올려준다)를 쓴다.
 * 단 여기서 얻는 값은 **업로드 바이트 진행률**이고, 업로드가 100% 가 된 뒤의
 * 서버 OCR 추론 시간은 진행률로 표현할 수 없다 → 그 구간은 인디터미네이트로 전환한다(§8).
 * 스토어의 `uploadPhase` 가 이 전환을 담당한다.
 *
 * RN FormData 의 파일 형식은 웹과 다르다: `File`/`Blob` 이 없으므로 `{uri, name, type}` 객체를
 * append 한다. `name` 의 확장자와 `type` 을 직접 넣지 않으면 서버가 임시파일 suffix 를 못 구한다.
 * `Content-Type` 은 **절대** 수동 지정하지 않는다 — boundary 가 사라져 415/500 이 된다.
 */
function uploadMultipart<T>(args: UploadArgs<T>): UploadHandle<T> {
  const { url, file, fields, authorize, timeoutMs, onProgress, signal, parse, mapFailure } = args;
  const xhr = new XMLHttpRequest();
  let canceled = false;

  const cancel = () => {
    canceled = true;
    try {
      xhr.abort();
    } catch {
      // 이미 종료된 요청. 무시.
    }
  };

  const promise = new Promise<ScanApiResult<T>>((resolve) => {
    const fail = (kind: UploadFailureKind, status: number | null, body: unknown, raw: string) => {
      if (kind === 'canceled' || canceled) {
        resolve({
          ok: false,
          canceled: true,
          error: { code: 'CANCELED', status: null },
        });
        return;
      }
      resolve({ ok: false, error: mapFailure(kind, status, body, raw) });
    };

    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob); // RN 타입 정의가 Blob 을 요구하므로 캐스팅이 필요하다.
    for (const [key, value] of Object.entries(fields ?? {})) form.append(key, value);

    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader('Accept', 'application/json');
    if (authorize) {
      const token = getTokenSync();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      };
    }

    xhr.ontimeout = () => fail('timeout', null, null, '');
    xhr.onerror = () => fail('network', null, null, '');
    xhr.onabort = () => fail('canceled', null, null, '');
    xhr.onload = () => {
      const raw = xhr.responseText ?? '';
      let body: unknown = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          // Spring 기본 에러 페이지(HTML) 등. 상태코드만으로 판단한다.
        }
      }

      const envelope = asRecord(body);
      const ok = xhr.status >= 200 && xhr.status < 300 && envelope.success !== false;
      if (!ok) {
        fail('http', xhr.status, body, raw);
        return;
      }

      try {
        resolve({ ok: true, data: parse(body) });
      } catch (e) {
        fail('parse', xhr.status, body, e instanceof Error ? e.message : String(e));
      }
    };

    if (signal) {
      // 이미 취소된 signal 로 들어오면 `xhr.abort()` 는 send 전이라 abort 이벤트를 내지 않는다
      // (프라미스가 영원히 안 풀린다). 여기서 직접 resolve 한다.
      if (signal.aborted) {
        canceled = true;
        resolve({ ok: false, canceled: true, error: { code: 'CANCELED', status: null } });
        return;
      }
      signal.addEventListener('abort', cancel);
    }

    xhr.send(form);
  });

  return { promise, cancel };
}

/** `success` 키가 없는 바디 = `@ControllerAdvice` 를 거치지 않은 Spring 기본 에러 (§1 표). */
const isSpringDefaultError = (body: unknown): boolean => {
  const record = asRecord(body);
  return Object.keys(record).length > 0 && record.success === undefined;
};

// ───────────────────────────────────────────────────────── API-41 스캔

export type ScanImageOptions = {
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

/**
 * API-41 `POST {API_BASE}/api/scan` — multipart 파트명 `file` 1개.
 *
 * 인증은 서버가 검사하지 않지만 웹과 동일하게 헤더를 붙인다(무해).
 * **부작용 없음**: 서버가 임시파일로 처리하고 `finally` 에서 삭제한다 → 취소·재시도가 안전하다.
 */
export function scanImage(file: PreparedImage, options: ScanImageOptions = {}): UploadHandle<ScanResult> {
  return uploadMultipart<ScanResult>({
    url: `${getApiBaseUrl()}/api/scan`,
    file,
    authorize: true,
    timeoutMs: SCAN_TIMEOUT_MS,
    onProgress: options.onProgress,
    signal: options.signal,
    parse: unwrapScan,
    mapFailure: (kind, status, body, raw) => {
      if (kind === 'timeout') return { code: 'SCF-08', status: null };
      if (kind === 'network') return { code: 'SCF-06', status: null };
      if (kind === 'parse') return { code: 'SCF-09', status, detail: raw };
      // SCF-05: 10MB 초과가 서버까지 도달한 경우. ApiResponse 포맷이 아닌 에러가 온다.
      if (status === 413 || (status === 400 && isSpringDefaultError(body))) {
        return { code: 'SCF-05', status };
      }
      return { code: 'SCF-09', status, detail: raw };
    },
  });
}

// ───────────────────────────────────────────────────────── API-63 커밋

export type CommitOptions = {
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

/**
 * API-63 `POST {OCR_BASE}/api/commit` — Spring 우회, 인증 없음.
 *
 * **이 앱에서 부작용이 있는 유일한 OCR 호출이다.** 이미지를 `ocr/uploads/{TYPE}/` 에 영구 저장하고
 * `ner_dataset` 에 학습 라벨을 누적한다. 따라서
 *  - 저장 버튼을 누른 시점에 **1회만** 호출한다 (폼 편집 중 프리커밋 금지).
 *  - 저장 재시도 시 **다시 호출하지 않는다** (R1 — 재커밋 N회 = 고아 이미지 N-1장).
 *  - `document_type` 이 저장 경로를 결정하므로 커밋 이후 종류 변경은 금지한다 (R3).
 *
 * `document_type` 은 서버 화이트리스트(`ALLOWED_DOC_TYPES`)를 벗어나면 조용히 `ETC` 로 대체되어
 * 엉뚱한 디렉터리에 저장된다. 그래서 호출부에서 4종으로 좁혀 받는다.
 */
export function commitDocument(
  file: PreparedImage,
  documentType: SavableDocumentType,
  rawBlocks: RawBlock[] = [],
  correctedFields: ParsedFields = {},
  options: CommitOptions = {},
): UploadHandle<CommitResult> {
  return uploadMultipart<CommitResult>({
    url: `${getOcrBaseUrl()}/api/commit`,
    file,
    // 인증 헤더 없음: /api/commit 은 인증을 검사하지 않는다.
    authorize: false,
    timeoutMs: COMMIT_TIMEOUT_MS,
    onProgress: options.onProgress,
    signal: options.signal,
    fields: {
      document_type: documentType,
      raw_blocks: JSON.stringify(rawBlocks),
      corrected_fields: JSON.stringify(correctedFields),
    },
    parse: unwrapCommit,
    mapFailure: (kind, status, _body, raw) => {
      if (kind === 'timeout') return { code: 'SCF-08', status: null };
      if (kind === 'network') return { code: 'SCF-07', status: null };
      return { code: 'SCF-11', status, detail: raw };
    },
  });
}

// ───────────────────────────────────────────────────────── 저장 바디 조립

const SAVE_PATHS: Record<SavableDocumentType, string> = {
  BUSINESS_CARD: '/api/cards/save',
  POSTER: '/api/posters/save',
  RECEIPT: '/api/receipts/save',
  TICKET: '/api/tickets/save',
};

export type SaveBodyArgs = {
  documentType: SavableDocumentType;
  fields: ParsedFields;
  imageUrl: string;
  rawTexts: string[];
  rawBlocks: RawBlock[];
  confidence: number;
  receiptItems?: ReceiptItemInput[];
  groupId?: string | null;
};

/**
 * 원본 `frontend/lib/api.ts saveCard` 의 필드 매핑을 그대로 옮긴 것이다. 추측한 키가 하나도 없다.
 *
 * 비대칭 주의: **명함만** 5종 세트(`docType`/`classificationConfidence`/`rawText[]`/`parsedJson`/`rawJson`)를
 * 하나도 보내지 않고 `imageUrl` + `rawOcrText`(개행 JOIN) + 5개 필드만 보낸다.
 * 나머지 3종은 `imageUrl` 컬럼이 없어 `parsedJson` 문자열 안에 매립하는 것이 유일한 경로다.
 */
export function buildSaveBody(args: SaveBodyArgs): { path: string; body: Record<string, unknown> } {
  const { documentType, fields, imageUrl, rawTexts, rawBlocks, confidence } = args;
  const f = (key: string): string => fields[key] ?? '';
  const path = SAVE_PATHS[documentType];

  switch (documentType) {
    case 'BUSINESS_CARD':
      return {
        path,
        body: {
          imageUrl,
          rawOcrText: rawTexts.join('\n'), // ★ 배열이 아니라 개행 JOIN 문자열
          name: f('name'),
          company: f('company_name'),
          position: f('job_title'),
          phone: f('mobile_phone') || f('contact_phone'),
          email: f('email') || f('contact_email'),
          // groupId 는 값이 있을 때만 넣는다. null 을 보내면 UUID 파싱 경로를 건드린다.
          ...(args.groupId ? { groupId: args.groupId } : {}),
        },
      };

    case 'POSTER':
      return {
        path,
        body: {
          docType: 'POSTER',
          classificationConfidence: confidence,
          title: f('title'),
          organizerName: f('organizer_name'),
          eventStartDate: f('event_start_date'),
          eventEndDate: f('event_end_date'),
          contactPhone: f('contact_phone'),
          contactEmail: f('contact_email'),
          location: f('location'),
          fee: f('fee'),
          websiteUrl: f('website_url'),
          description: f('description'),
          rawText: rawTexts, // ★ 요청은 배열, 응답은 공백 JOIN 문자열
          parsedJson: JSON.stringify({ ...fields, imageUrl }),
          rawJson: JSON.stringify(rawBlocks),
        },
      };

    case 'TICKET':
      return {
        path,
        body: {
          docType: 'TICKET',
          classificationConfidence: confidence,
          transportType: f('transport_type'),
          departureLocation: f('departure_location'),
          departureDate: f('departure_date'),
          departureTime: f('departure_time'),
          arrivalLocation: f('arrival_location'),
          arrivalDate: f('arrival_date'),
          arrivalTime: f('arrival_time'),
          rawText: rawTexts,
          parsedJson: JSON.stringify({ ...fields, imageUrl }),
          rawJson: JSON.stringify(rawBlocks),
        },
      };

    case 'RECEIPT':
      return {
        path,
        body: {
          docType: 'RECEIPT',
          classificationConfidence: confidence,
          merchantName: f('store_name') || f('merchant_name'),
          merchantAddress: f('merchant_address') || f('address'),
          purchaseDate: f('purchase_date'),
          purchaseTime: f('purchase_time'),
          paymentMethod: f('payment_method'),
          cardCompany: f('card_company'),
          totalAmount: parseMoney(f('total_amount')),
          currencyCode: f('currency_code') || 'KRW',
          rawText: rawTexts,
          parsedJson: JSON.stringify({ ...fields, imageUrl }),
          rawJson: JSON.stringify(rawBlocks),
          // 웹은 항상 [] 를 보냈다. OCR 품목 파서는 미구현이지만 서버 저장 경로는 완성되어 있어
          // 앱은 수기 추가된 품목을 정상 전송한다 (Data Model §1-5 결정).
          items: (args.receiptItems ?? []).map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity ?? null,
            unitPrice: item.unitPrice ?? null,
            totalPrice: item.totalPrice ?? null,
            category: item.category ?? null,
          })),
        },
      };
  }
}

// ───────────────────────────────────────────────────────── 저장 (커밋 → /save)

export type SaveDocumentArgs = {
  documentType: DocumentType;
  fields: ParsedFields;
  /** 이미 확보한 image_url. **있으면 커밋을 건너뛴다** (R1: 재시도 시 재커밋 금지). */
  imageUrl?: string;
  rawTexts?: string[];
  rawBlocks?: RawBlock[];
  /** 서버가 준 원래 값. 사용자가 종류를 바꿨어도 조작하지 않는다 (학습 데이터 오염 방지). */
  confidence?: number;
  /** 커밋에 재전송할 파일. null 이면 커밋을 시도하지 않는다. */
  file?: PreparedImage | null;
  receiptItems?: ReceiptItemInput[];
  groupId?: string | null;
  /** 서버 `fields`(라벨 맵). 검증 대상 필드 집합을 확정하는 데 쓴다. */
  serverFields?: Record<string, string> | null;
  /** R2: 커밋이 실패했을 때 `imageUrl=''` 로 강행할지. 기본은 중단하고 사용자에게 묻는다. */
  allowMissingImage?: boolean;
  onCommitProgress?: (ratio: number) => void;
  /**
   * R1 의 핵심 훅. 커밋이 성공한 **즉시** 호출된다.
   * 뒤이은 `/save` 가 실패해도 호출부가 이 값을 상태에 고정해 두면 재시도 때 재커밋하지 않는다
   * (재커밋 N회 = 고아 이미지 N-1장 — 원본 웹의 실제 버그).
   */
  onImageUrlResolved?: (imageUrl: string) => void;
  signal?: AbortSignal;
};

/**
 * SCAN-09 ~ SCAN-11. `POST /api/commit` 으로 image_url 을 확보한 뒤 문서 종류별 `/save` 를 호출한다.
 *
 * 순서와 보상 규칙(§11-1):
 *  R1 커밋 성공 시 `image_url` 을 호출부가 상태에 고정하고, 저장 재시도 때 `imageUrl` 을 넘겨 재커밋을 막는다.
 *  R2 커밋 실패는 치명적이지 않다. `allowMissingImage` 없이 호출하면 SCF-11 을 반환하고 저장을 하지 않는다.
 *  R3 종류 변경은 커밋 전까지만 허용된다(스토어가 강제).
 *
 * 저장 실패 시 재시도는 **`/save` 만** 다시 호출한다.
 */
export async function saveDocument(args: SaveDocumentArgs): Promise<ScanApiResult<SaveDocumentResult>> {
  const {
    documentType,
    fields,
    rawTexts = [],
    rawBlocks = [],
    confidence = 0,
    file = null,
    serverFields = null,
    allowMissingImage = false,
    signal,
  } = args;

  // CLS-04 — ETC 는 서버 화이트리스트에 없다. 서버 이전에 클라이언트가 막는다.
  if (!isSavableDocumentType(documentType)) {
    return { ok: false, error: { code: 'CLS-04', status: null } };
  }

  // FLD-06 정규화 게이트. 형식이 틀린 날짜/시각/금액을 보내면 서버가 조용히 null 을 넣는다.
  const defs = buildFieldDefs(documentType, serverFields);
  const validation = validateFields(defs, fields);
  if (!validation.ok) {
    return {
      ok: false,
      error: { code: 'FLD-06', status: null, detail: JSON.stringify(validation.errors) },
    };
  }

  let imageUrl = args.imageUrl ?? '';
  let imageMissing = false;

  if (!imageUrl && file) {
    const commit = await commitDocument(file, documentType, rawBlocks, fields, {
      onProgress: args.onCommitProgress,
      signal,
    }).promise;

    if (commit.ok) {
      imageUrl = commit.data.imageUrl || '';
      // /save 실패와 무관하게 즉시 통지한다 (R1).
      if (imageUrl) args.onImageUrlResolved?.(imageUrl);
    } else if (commit.canceled) {
      return { ok: false, canceled: true, error: commit.error };
    } else if (allowMissingImage) {
      imageMissing = true;
    } else {
      return { ok: false, error: commit.error };
    }
  } else if (!imageUrl) {
    imageMissing = true;
  }

  const { path, body } = buildSaveBody({
    documentType,
    fields,
    imageUrl,
    rawTexts,
    rawBlocks,
    confidence,
    receiptItems: args.receiptItems,
    groupId: args.groupId,
  });

  const result = await request<unknown>(path, {
    method: 'POST',
    json: body,
    timeoutMs: SAVE_TIMEOUT_MS,
    signal,
  });

  if (!result.ok) {
    return { ok: false, error: mapSaveFailure(result.error.kind, result.error.status) };
  }

  const saved = asRecord(result.data);
  const id = typeof saved.id === 'string' || typeof saved.id === 'number' ? saved.id : undefined;

  return {
    ok: true,
    data: {
      ...(id !== undefined ? { id } : {}),
      imageUrl,
      imageMissing,
      // 부분 성공 경고(임베딩 실패). 저장 자체는 성공했다 (§11-2).
      ...(result.message ? { message: result.message } : {}),
    },
    ...(result.message ? { message: result.message } : {}),
  };
}

/**
 * `/save` 실패를 SCF 코드로 좁힌다.
 *
 * 참고: Camera and Scan §13 SCF-13 은 "401 또는 400" 이라고 적혀 있으나, 실제 4개 컨트롤러
 * (Card/Poster/Receipt/Ticket) 의 `save()` 는 인증 누락에 **전부 401** 을 반환한다.
 * 400 은 세션 만료가 아니므로 SCF-12 로 둔다.
 */
function mapSaveFailure(kind: string, status: number | null): ScanFailure {
  if (kind === 'unauthorized') return { code: 'SCF-13', status };
  if (kind === 'timeout') return { code: 'SCF-08', status: null };
  if (kind === 'offline') return { code: 'SCF-06', status: null };
  const code: ScanFailureCode = status === 413 ? 'SCF-05' : 'SCF-12';
  return { code, status };
}
