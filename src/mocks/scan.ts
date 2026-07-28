import { DOCUMENT_FIELD_SCHEMAS } from '@/features/scan/fieldSchema';
import type {
  ParsedFields,
  PreparedImage,
  RawBlock,
  SavableDocumentType,
  ScanApiResult,
  UploadHandle,
} from '@/features/scan/types';
import { storage } from '@/store/storage';

/**
 * 스캔 파이프라인 목 (API-41 `/api/scan` · API-63 `/api/commit`).
 *
 * 이 둘만 여기 있는 이유: 진행률·취소가 필요해 `request()` 가 아니라 **XHR 업로더**를 쓰므로
 * http 계층의 목 라우터로 가로챌 수 없다. 저장(`/api/{종류}/save`)은 `request()` 를 타므로
 * `mocks/handlers.ts` 담당이다 — 여기서 또 구현하지 않는다.
 *
 * 실서버 계약은 `src/features/scan/api.ts` 의 `unwrapScan`/`unwrapCommit` 이 정본이고,
 * 이 파일은 **그 파서가 먹을 수 있는 원본 JSON 봉투를 그대로 만든다.**
 * 목이 만든 객체를 곧장 돌려주지 않고 봉투 → 실제 파서 순서를 거치게 한 이유가 이것이다 —
 * 봉투 모양이 어긋나면 목 모드에서 바로 티가 난다(실서버에서만 터지는 것을 막는다).
 *
 * 지켜야 하는 실측 규칙:
 *  - `/api/scan` 은 **이중 래핑**이다: `{success, data:{success, data:{...}}}` (API Contract §4-4)
 *  - 안쪽 키는 Spring 을 거쳐도 **snake_case 그대로**다 (`raw_blocks`, `image_url`, `image_size`)
 *  - `ApiResponse` 는 `@JsonInclude(NON_NULL)` 이라 **null 필드는 키 자체가 없다** (§2-1)
 *  - `/api/commit` 은 **단일 래핑** `{success, data:{image_url, count}}` (API-63)
 *  - 스캔 단계의 `image_url` 은 항상 `''` 이고, 커밋 단계에서도 목은 실제 파일을 만들지 않으므로 `''` 다
 *
 * 문서 유형은 **랜덤이 아니라 순환**한다(명함 → 포스터 → 영수증 → 티켓). 디버깅할 때
 * 원하는 유형을 최대 4번 안에 반드시 다시 만날 수 있어야 하기 때문이다.
 */

// ─────────────────────────────────────────────────── 순환 상태 (스캔 카운터)

/**
 * 스캔 횟수 카운터. MMKV 에 두는 이유는 Fast Refresh 로 모듈이 다시 평가돼도
 * 순서가 처음으로 튀지 않게 하기 위해서다. `StorageKey` 에는 넣지 않는다(개발 전용).
 */
const SCAN_CYCLE_STORAGE_KEY = 'mock.scanCycle';

/** 순환 순서. 명함 → 포스터 → 영수증 → 티켓. */
const TYPE_CYCLE: readonly SavableDocumentType[] = [
  'BUSINESS_CARD',
  'POSTER',
  'RECEIPT',
  'TICKET',
];

/**
 * 고신뢰 구간 값(0.72~0.97). 길이 7 이라 유형 순환(4)·저신뢰 주기(3)와 겹치지 않아
 * 같은 조합이 반복되지 않는다. 난수를 쓰지 않는 이유는 버그 재현성 때문이다.
 */
const CONFIDENCE_CYCLE = [0.93, 0.81, 0.76, 0.88, 0.97, 0.72, 0.85] as const;

/** 저신뢰 구간 값. `< 0.55` 라 화면이 `pick` 티어(종류 선택 시트)로 들어간다 (CLS-03). */
const LOW_CONFIDENCE_CYCLE = [0.48, 0.41, 0.53] as const;

/** 3번에 1번은 저신뢰로 만든다 — 유형 변경 UI 를 매번 손으로 만들지 않고 검증하기 위해서다. */
const LOW_CONFIDENCE_EVERY = 3;

export type MockScanPlan = {
  /** 0부터 증가하는 스캔 순번. */
  index: number;
  type: SavableDocumentType;
  confidence: number;
  lowConfidence: boolean;
};

function planFor(index: number): MockScanPlan {
  const type = TYPE_CYCLE[index % TYPE_CYCLE.length] ?? 'BUSINESS_CARD';
  const lowConfidence = index % LOW_CONFIDENCE_EVERY === LOW_CONFIDENCE_EVERY - 1;
  const confidence = lowConfidence
    ? (LOW_CONFIDENCE_CYCLE[index % LOW_CONFIDENCE_CYCLE.length] ?? 0.48)
    : (CONFIDENCE_CYCLE[index % CONFIDENCE_CYCLE.length] ?? 0.9);
  return { index, type, confidence, lowConfidence };
}

/** 다음 스캔이 무엇을 낼지 미리 본다(소비하지 않는다). 개발 화면 표시용. */
export function peekMockScanPlan(): MockScanPlan {
  return planFor(storage.getNumber(SCAN_CYCLE_STORAGE_KEY) ?? 0);
}

/** 순번을 하나 소비한다. 취소된 스캔도 한 칸을 쓴다(단순한 규칙이 디버깅에 낫다). */
function consumeScanPlan(): MockScanPlan {
  const index = storage.getNumber(SCAN_CYCLE_STORAGE_KEY) ?? 0;
  storage.set(SCAN_CYCLE_STORAGE_KEY, index + 1);
  return planFor(index);
}

/** 순환을 처음(명함·고신뢰)으로 되돌린다. 개발 화면의 `데이터 초기화` 가 함께 호출한다. */
export function resetMockScanCycle(): void {
  storage.remove(SCAN_CYCLE_STORAGE_KEY);
}

// ─────────────────────────────────────────────────────── 유형별 OCR 샘플

type ScanSample = {
  /** OCR 이 값을 뽑아낸 필드만. **빈 값은 키 자체를 넣지 않는다**(실서버와 같은 규칙). */
  parsed: Readonly<Record<string, string>>;
  /** 저신뢰 케이스에서만 살아남는 키. 나머지는 인식 실패로 떨어진다. */
  lowConfidenceKeys: readonly string[];
  /** `raw_blocks` 텍스트. 원문 목록과 bbox 오버레이가 이 순서대로 그려진다. */
  lines: readonly string[];
};

const SAMPLES: Record<SavableDocumentType, ScanSample> = {
  BUSINESS_CARD: {
    parsed: {
      name: '김민우',
      english_name: 'Minwoo Kim',
      company_name: '주식회사 모라',
      department: '플랫폼개발팀',
      job_title: '선임 연구원',
      mobile_phone: '010-2345-6789',
      office_phone: '02-555-0142',
      fax: '02-555-0143',
      email: 'minwoo.kim@mora.app',
      address: '서울특별시 강남구 테헤란로 231 8층',
      website: 'https://mora.app',
      zip_code: '06142',
    },
    lowConfidenceKeys: ['company_name', 'mobile_phone'],
    lines: [
      '주식회사 모라',
      'MORA',
      '김민우 / Minwoo Kim',
      '플랫폼개발팀 선임 연구원',
      'M. 010-2345-6789',
      'T. 02-555-0142   F. 02-555-0143',
      'minwoo.kim@mora.app',
      '(06142) 서울특별시 강남구 테헤란로 231 8층',
      'https://mora.app',
    ],
  },

  POSTER: {
    parsed: {
      title: '2026 서울 프론트엔드 개발자 컨퍼런스',
      organizer_name: '한국소프트웨어산업협회',
      event_start_date: '2026-08-14',
      event_end_date: '2026-08-15',
      contact_phone: '02-780-0102',
      contact_email: 'hello@fedev-conf.kr',
      location: '코엑스 그랜드볼룸 103호',
      website_url: 'https://fedev-conf.kr/2026',
    },
    lowConfidenceKeys: ['title'],
    lines: [
      '2026 서울 프론트엔드',
      '개발자 컨퍼런스',
      '2026. 08. 14(금) ~ 08. 15(토)',
      '코엑스 그랜드볼룸 103호',
      '주최 : 한국소프트웨어산업협회',
      '문의 02-780-0102 / hello@fedev-conf.kr',
      '사전등록 https://fedev-conf.kr/2026',
    ],
  },

  RECEIPT: {
    parsed: {
      store_name: '스타벅스 역삼점',
      purchase_date: '2026-07-21',
      total_amount: '14,300',
    },
    lowConfidenceKeys: ['store_name'],
    lines: [
      '스타벅스 역삼점',
      '사업자번호 220-81-62517',
      '서울 강남구 테헤란로 152',
      '2026-07-21 14:32',
      '아메리카노(T)     2     9,000',
      '카페라떼(T)       1     5,300',
      '합계            14,300',
      '신용카드 승인 14,300',
    ],
  },

  TICKET: {
    parsed: {
      transport_type: 'KTX',
      departure_location: '서울',
      departure_date: '2026-08-14',
      departure_time: '07:20',
      arrival_location: '부산',
      arrival_date: '2026-08-14',
      arrival_time: '10:02',
    },
    lowConfidenceKeys: ['departure_location', 'arrival_location'],
    lines: [
      'KTX 101',
      '서울 → 부산',
      '2026년 8월 14일 (금)',
      '출발 07:20   도착 10:02',
      '4호차 12A   일반실',
      '어른 1명 59,800원',
    ],
  },
};

/** 저신뢰 케이스는 인식 필드를 대폭 잃는다 — 화면의 `인식된 정보가 없습니다` 경로까지 밟게 된다. */
function buildParsed(sample: ScanSample, lowConfidence: boolean): Record<string, string> {
  if (!lowConfidence) return { ...sample.parsed };
  const out: Record<string, string> = {};
  for (const key of sample.lowConfidenceKeys) {
    const value = sample.parsed[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * `raw_blocks` 생성. bbox 는 `image_size` 좌표계의 4점 폴리곤이다(API Contract §4-4).
 * 실제 OCR 처럼 줄 단위로 아래로 쌓고, 글자 수에 비례해 가로 폭을 잡는다.
 */
function buildRawBlocks(lines: readonly string[]): RawBlock[] {
  return lines.map((text, index) => {
    const left = 56;
    const top = 64 + index * 92;
    const width = Math.min(1160, Math.max(180, text.length * 30));
    const height = 56;
    return {
      block_index: index,
      text,
      // 블록 신뢰도는 문서 신뢰도와 다른 축이다. 0.88~0.96 을 결정적으로 돌린다.
      confidence: Number((0.88 + ((index * 7) % 9) / 100).toFixed(2)),
      bbox: [
        [left, top],
        [left + width, top],
        [left + width, top + height],
        [left, top + height],
      ],
    };
  });
}

// ────────────────────────────────────────────────── 목 업로드 러너 (진행률·취소)

export type MockUploadOptions = {
  /** 0~1. 실서버는 XHR 실측 바이트지만 목은 균등 분할이다. */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

/** 진행률 콜백 횟수. 12단계면 프로그레스 바가 뚝뚝 끊겨 보이지 않는다. */
const PROGRESS_STEPS = 12;

type MockUploadArgs<T> = {
  /** 업로드(실측 진행률) 구간. */
  uploadMs: number;
  /** 업로드 100% 이후 서버 처리 구간. 화면은 여기서 인디터미네이트로 바뀐다 (§8). */
  serverMs: number;
  /** 실서버가 돌려줄 JSON 봉투. */
  envelope: () => unknown;
  /** `unwrapScan` / `unwrapCommit`. 호출부가 넘겨 준다 — 여기서 import 하면 순환 참조가 된다. */
  parse: (json: unknown) => T;
  options: MockUploadOptions;
};

/**
 * `uploadMultipart` 와 **같은 계약**의 목 러너.
 * 취소되면 `{ok:false, canceled:true, code:'CANCELED'}` 로 끝난다(문구 없음 — API Contract §4-5).
 */
function mockUpload<T>(args: MockUploadArgs<T>): UploadHandle<T> {
  const { uploadMs, serverMs, envelope, parse, options } = args;
  const { onProgress, signal } = options;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveOuter: ((result: ScanApiResult<T>) => void) | null = null;

  const stop = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    signal?.removeEventListener('abort', cancel);
  };

  function cancel(): void {
    if (settled) return;
    settled = true;
    stop();
    resolveOuter?.({ ok: false, canceled: true, error: { code: 'CANCELED', status: null } });
  }

  const promise = new Promise<ScanApiResult<T>>((resolve) => {
    resolveOuter = resolve;

    // 이미 취소된 signal 로 들어오면 이벤트가 영영 오지 않는다. 즉시 끝낸다.
    if (signal?.aborted) {
      settled = true;
      resolve({ ok: false, canceled: true, error: { code: 'CANCELED', status: null } });
      return;
    }
    signal?.addEventListener('abort', cancel);

    let step = 0;
    const tick = () => {
      if (settled) return;
      step += 1;
      onProgress?.(step / PROGRESS_STEPS);

      if (step < PROGRESS_STEPS) {
        timer = setTimeout(tick, uploadMs / PROGRESS_STEPS);
        return;
      }
      // 업로드 완료 → 서버 추론 구간(진행률 없음).
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stop();
        resolve({ ok: true, data: parse(envelope()) });
      }, serverMs);
    };

    timer = setTimeout(tick, uploadMs / PROGRESS_STEPS);
  });

  return { promise, cancel };
}

// ───────────────────────────────────────────────────── API-41 `/api/scan` 목

/** 업로드 구간 1.4초 + 유형별 추론 구간 → 총 2.6~3.3초. 진행률이 눈에 보이는 길이다. */
const SCAN_UPLOAD_MS = 1_400;
const SCAN_SERVER_MS: Record<SavableDocumentType, number> = {
  BUSINESS_CARD: 1_200,
  POSTER: 1_700,
  RECEIPT: 1_400,
  TICKET: 1_900,
};

/** 이미지 정보가 없을 때 쓰는 기본 크기(OCR `MAX_IMAGE_SIDE = 1280`). */
const FALLBACK_IMAGE_SIZE = { width: 1280, height: 960 } as const;

/**
 * `POST /api/scan` 목. 호출부(`features/scan/api.ts`)가 `unwrapScan` 을 넘겨 준다.
 *
 * @param file 압축 결과. `image_size` 를 실제 이미지 크기로 채우는 데만 쓴다(전송하지 않는다).
 */
export function mockScanImage<T>(
  file: PreparedImage | null,
  parse: (json: unknown) => T,
  options: MockUploadOptions = {},
): UploadHandle<T> {
  const plan = consumeScanPlan();
  const sample = SAMPLES[plan.type];
  const parsed = buildParsed(sample, plan.lowConfidence);
  const rawBlocks = buildRawBlocks(sample.lines);
  const imageSize =
    file && file.width > 0 && file.height > 0
      ? { width: file.width, height: file.height }
      : FALLBACK_IMAGE_SIZE;

  return mockUpload<T>({
    uploadMs: SCAN_UPLOAD_MS,
    serverMs: SCAN_SERVER_MS[plan.type],
    parse,
    options,
    envelope: () => ({
      // 이중 래핑 — Spring 이 FastAPI 응답을 통째로 다시 감싼다 (§4-4).
      success: true,
      data: {
        success: true,
        data: {
          type: plan.type,
          confidence: plan.confidence,
          parsed,
          // 라벨 맵은 서버 `FIELD_LABELS_KO` 와 키 집합이 같다(OCR 추출 대상 필드 전체).
          fields: DOCUMENT_FIELD_SCHEMAS[plan.type],
          // 영수증 품목 파서는 서버에도 없다. 항상 빈 배열이다.
          items: [],
          raw_blocks: rawBlocks,
          // 스캔 단계에서는 실서버도 항상 빈 문자열이다. 영구 URL 은 커밋에서 나온다.
          image_url: '',
          image_size: imageSize,
        },
      },
    }),
  });
}

// ─────────────────────────────────────────────────── API-63 `/api/commit` 목

const COMMIT_UPLOAD_MS = 500;
const COMMIT_SERVER_MS = 250;

/**
 * `POST /api/commit` 목 (OCR 서버 직결, 단일 래핑).
 *
 * 목에는 파일 시스템이 없으므로 `image_url` 은 **빈 문자열**이다. 그러면 저장 흐름이
 * R2 경로(`imageMissing`)를 타서 완료 화면의 `이미지 없이 저장됨` 배너까지 검증된다.
 * `count` 는 실서버와 같은 의미로 "누적된 NER 라벨 건수" 를 흉내 낸다.
 */
export function mockCommitDocument<T>(
  _documentType: SavableDocumentType,
  rawBlocks: readonly RawBlock[],
  correctedFields: ParsedFields,
  parse: (json: unknown) => T,
  options: MockUploadOptions = {},
): UploadHandle<T> {
  const labeled = Object.values(correctedFields).filter((v) => v.trim() !== '').length;
  const count = labeled > 0 ? labeled : rawBlocks.length;

  return mockUpload<T>({
    uploadMs: COMMIT_UPLOAD_MS,
    serverMs: COMMIT_SERVER_MS,
    parse,
    options,
    envelope: () => ({ success: true, data: { image_url: '', count } }),
  });
}

// ────────────────────────────────────────────────── 저장(`/save`)은 여기 없다

/*
 * 4종 `POST /api/{종류}/save` 는 `request()` 를 타므로 **http 계층의 목 라우터**(`mocks/handlers.ts`)가
 * 처리한다. 여기서 한 번 더 구현하면 같은 저장 로직이 두 벌이 되어 조용히 갈라진다.
 * 이 파일이 맡는 것은 `request()` 로 갈 수 없는 두 호출(XHR 업로더를 쓰는 스캔·커밋)뿐이다.
 */
