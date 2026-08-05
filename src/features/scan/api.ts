import { getApiBaseUrl, getOcrBaseUrl } from '@/config/env';
import { isMockEnabled } from '@/mocks/config';
import { mockCommitDocument, mockScanImage } from '@/mocks/scan';
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
 * 60s → 120s 상향(2026-07-28). 서버가 Cloud Run 이라 인스턴스가 잠들면 콜드스타트에
 * 컨테이너 기동 + PaddleOCR 모델 lazy 로드가 통째로 얹힌다 — [[Risks]] RSK-43.
 *
 * **주석 정정(2026-08-05).** 이 자리에 있던 근거 두 줄은 둘 다 사실이 아니었다:
 *  · "gunicorn 자체는 `--timeout 300`" → `server/ocr/Dockerfile` 은 gunicorn 을 쓰지 않는다.
 *    단일 `uvicorn app:app` 으로 뜬다(레포 전체 gunicorn 사용처 0건). 앞단 워커 타임아웃이라는
 *    안전망은 애초에 없었고, 앱 타임아웃이 유일한 상한이다.
 *  · "가중치 844MB 로드" → 그런 크기의 NER 가중치는 레포에 없다. 분류기는
 *    `server/ocr/src/classifier/rule_based.py` 의 순수 정규식이다.
 *
 * 값 120s 는 그대로 둔다 — 근거만 틀렸고 값은 이번 실측으로 정당화된다:
 * Cloud Run 콜드스타트 실측 18~33s. 그리고 인스턴스가 OOM 으로 죽으면 앱 코드를 거치지 않고
 * **Google Frontend 가 text/plain `Service Unavailable` 503** 을 돌려준다(FastAPI 는 실패 시
 * 500 + JSON 만 낸다 — 503 을 보면 우리 코드가 낸 것이 아니다). LAN 개발에서는 둘 다 재현되지 않는다.
 */
export const SCAN_TIMEOUT_MS = 120_000;
/**
 * 이미지 저장 + 라벨 파일 쓰기만 하고 OCR 추론이 없다.
 *
 * 45s → 90s 상향(2026-08-05). 커밋은 Spring 을 거치지 않고 `getOcrBaseUrl()` 로 OCR 을 직접 친다
 * → 스캔이 깨운 인스턴스와 **별개 인스턴스의 콜드스타트를 그대로 맞는다**. 실측 콜드스타트가
 * 18~33s 라 45s 는 여유가 12s 뿐이었고, 추론이 없는 요청이 SCF-08(시간 초과)로 튕겼다.
 * (API Contract §9 표는 60s, 파이프라인 정본인 Camera and Scan §7-4 는 45s 로 적혀 있다 —
 *  둘 다 Cloud Run 이전에 정해진 값이다.)
 */
export const COMMIT_TIMEOUT_MS = 90_000;
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
  const classified = pick('classified');
  const imageSize = asRecord(pick('image_size'));

  return {
    type: isDocumentType(type) ? type : 'ETC',
    /* `classified` — "서버가 문서 종류를 판정했는가" (2026-08-05 4차 신설).
       `server/ocr` 은 명함 전용이라 분류기가 없고 `type:"BUSINESS_CARD"` / `confidence:0.0` 을
       고정으로 내려준다. 그 사실을 앱이 알 방법이 그동안 없어서, 앱은 "0 = 신뢰도가 바닥" 으로
       읽고 폼을 잠갔다 — 잰 적 없는 값을 근거로 잠그는 거짓 신호였다.
       이제 서버가 `"classified": false` 로 명시하고 앱은 그것을 전용 상태로 다룬다.

       **하위호환**: 키가 없으면(= 이 필드 이전에 배포된 서버) `true` 로 읽어 종전 동작을 그대로
       유지한다. 없다고 `false` 로 떨어뜨리면 실제 분류기를 붙인 배포까지 미판정 취급하게 된다.
       불리언이 아닌 값(문자열 "false" 등)도 계약 위반이므로 종전 동작 쪽으로 붙인다. */
    classified: typeof classified === 'boolean' ? classified : true,
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
  /**
   * 실패를 SCF 코드로 좁힌다.
   *
   * ⚠️ **4번째 인자의 의미가 `kind` 에 따라 다르다.** 이름이 `raw` 라 두 번이나 오독됐으므로
   * 여기 못박는다 (실제 호출은 아래 `xhr.onload` / `fail(...)`):
   *  · `kind === 'http'`  → 응답 **원문**(`xhr.responseText`)
   *  · `kind === 'parse'` → `parse()` 가 던진 **예외 메시지**. 이때 원문은 넘기지 않는다
   *    (파싱 실패의 원인은 서버 문구가 아니라 파서가 무엇에 걸렸는지이기 때문).
   *  · `timeout`/`network`/`canceled` → 빈 문자열
   */
  mapFailure: (
    kind: UploadFailureKind,
    status: number | null,
    body: unknown,
    rawOrParseError: string,
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

/**
 * 화면에 내보내도 되는 "사람이 읽을 수 있는 한 줄" 인지 판정한다 (2026-08-05 강화).
 *
 * **근거 정정(2026-08-05 3차).** 이 필터를 넣을 때 적어 둔 근거는 "SCF-11 로 pydantic JSON 이
 * SCR-11 실패 부제에 떴다" 였는데, **그 시나리오는 당시 성립하지 않았다.** SCF-11(커밋 실패)은
 * 저장 버튼을 누른 SCR-12(`app/scan/review.tsx`)에서만 발생하는데, 그 화면은 실패 배너에
 * `title`/`body` 만 그리고 `detail` 을 아예 렌더하지 않았다. SCR-11(`analyzing.tsx`)은 `detail`
 * 을 그리지만 커밋을 하지 않으므로 SCF-11 이 뜨지 않는다. 즉 그 JSON 은 어느 화면에도 뜬 적이 없다.
 *
 * 그럼에도 **되돌리지 않는다.** 같은 라운드에서 SCR-12 가 `detail` 한 줄을 그리도록 고쳐졌고
 * (B6 — 목록에만 있고 도달하지 않는 코드를 없애기 위해), 그 순간부터 위 시나리오가 **실재하는
 * 위험**이 된다. `/api/commit` 은 Spring 을 우회해 FastAPI 를 직접 치므로 파트명이 어긋나면
 * `{"detail":[{"type":"missing","loc":["body","file"],...,"url":"https://errors.pydantic.dev/…"}]}`
 * 가 그대로 오고, `detail` 이 **배열**이라 문자열 검사에서 미끄러져 raw 가 채택된다.
 * 프록시가 HTML 에러 페이지를 주면 `<html><head><title>502 …` 가 채택된다.
 *
 * 거짓 신호를 지우자고 만든 줄이 **내부 구현 원문을 유출하는 줄**이 되면 안 된다. 그래서
 *  · `<` `{` `[` 로 시작하면(HTML/JSON/배열) 버린다
 *  · 마크업 문자(`<` `>` `{` `}`)가 섞여 있으면 버린다 — 잘린 태그 조각도 함께 걸러진다
 *  · URL 이 들어 있으면 버린다 (pydantic 문서 링크·내부 엔드포인트 주소)
 * 남는 것은 `Service Unavailable`, `OCR upstream failed (503)` 같은 **평문 한 줄**뿐이다.
 */
const MARKUP_HEAD_RE = /^[<{[]/;
const MARKUP_CHAR_RE = /[<>{}]/;
const URL_RE = /\bhttps?:\/\//i;

function humanLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  const line = value.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  if (MARKUP_HEAD_RE.test(line) || MARKUP_CHAR_RE.test(line) || URL_RE.test(line)) return '';
  return line;
}

/**
 * FastAPI(pydantic) 검증 오류 배열을 한 줄로 접는다.
 *
 * 원문은 `type`/`input`/`url` 까지 달고 오는 JSON 배열이라 그대로 보여줄 수 없다.
 * 진단에 실제로 쓸모 있는 것은 `loc`(어느 파트가) 과 `msg`(무엇이 틀렸나) 둘뿐이다:
 *   `[{"loc":["body","file"],"msg":"Field required"}]` → `body.file: Field required`
 * 이 한 줄이면 "앱이 보낸 파트명이 서버 시그니처와 다르다" 를 즉시 알 수 있다.
 * 3건까지만 이어 붙인다(그 이상은 화면에서 의미가 없다).
 */
function summarizeValidationDetail(detail: unknown): string {
  if (!Array.isArray(detail)) return '';
  const parts: string[] = [];
  for (const item of detail.slice(0, 3)) {
    const record = asRecord(item);
    const msg = typeof record.msg === 'string' ? record.msg : '';
    const loc = Array.isArray(record.loc)
      ? record.loc.filter((v) => typeof v === 'string' || typeof v === 'number').join('.')
      : '';
    if (!msg && !loc) continue;
    parts.push(loc && msg ? `${loc}: ${msg}` : loc || msg);
  }
  return parts.join(' / ');
}

/**
 * 실패 상세를 **한 줄**로 좁힌다 (2026-08-05 신설 · 같은 날 폴백 강화).
 *
 * 그동안 `ScanFailure.detail` 에는 응답 본문 원문이 통째로 들어갔고 화면에는 아무것도 뜨지 않아,
 * 사용자에게 보이는 것이 `서버 에러 (503)` 뿐이었다 — OCR OOM 장애의 원인 추적이 불가능했던 주된 이유다.
 * 이제 SCR-11(`analyzing.tsx`) 과 SCR-12(`review.tsx`) 의 실패 블록이 이 값을 작은 글씨 한 줄로
 * 노출하므로, 스택트레이스가 아니라 **서버가 준 에러 문구 한 줄**만 남긴다.
 *
 * 우선순위:
 *  ① Spring `ApiResponse.error`  ② Spring 기본 에러 `message`  ③ FastAPI 문자열 `detail`
 *  ④ FastAPI 배열 `detail`(pydantic) 을 `loc: msg` 로 접은 것
 *  ⑤ 응답 원문 — **평문일 때만.** Cloud Run 이 인스턴스 사망 시 내려주는 text/plain
 *     `Service Unavailable` 이 여기로 살아남는다. 그 문자열 자체가 "앱이 아니라 인스턴스가
 *     죽었다" 는 신호이므로 이 경로를 없애면 안 된다.
 *  ⑥ 원문이 JSON/HTML 이면 **원문 대신** 그 사실만 알린다. 마크업을 화면에 내보내는 대신
 *     "읽을 수 없는 형식으로 왔다 + 상태코드" 라는, 그 자체로 진단이 되는 문구를 쓴다.
 *
 * 길이 컷은 표시 계층(`useScan.describeFailure`)이 한다. 여기서는 개행·중복 공백만 정리한다.
 */
function summarizeDetail(body: unknown, raw: string, status: number | null): string {
  const record = asRecord(body);

  for (const candidate of [record.error, record.message, record.detail]) {
    const line = humanLine(candidate); // FastAPI `detail` 은 배열/객체일 수 있다 → 아래 ④ 로 넘어간다.
    if (line) return line;
  }

  const validation = humanLine(summarizeValidationDetail(record.detail));
  if (validation) return validation;

  const rawLine = humanLine(raw);
  if (rawLine) return rawLine;

  if (!raw.trim()) return '';
  return `서버가 읽을 수 없는 형식으로 응답했습니다 (HTTP ${status ?? 0})`;
}

/**
 * Spring 이 `/api/scan` 실패에 실어 보내는 **업스트림 실패 마커**를 해석한다.
 *
 * 배경(2026-08-05, 2차 개정). Spring 의 업스트림 실패 매핑이 **네 갈래**로 확정됐다
 * (`CardController.scan()` 의 매핑표 · `OcrUpstreamException` 의 [실패 등급] 주석이 정본):
 *
 * | 업스트림에서 벌어진 일 | Spring 응답 | `error` 본문                        |
 * |---|---|---|
 * | OCR 이 5xx 응답        | **502** | `OCR upstream failed (nnn)`          |
 * | OCR 이 4xx 응답        | **500** | `OCR upstream contract error (nnn)`  |
 * | 연결 불가(DNS·거부)    | **503** | `OCR upstream unreachable`           |
 * | read 타임아웃          | **504** | `OCR upstream timeout`               |
 * | 그 외 Spring 자체 실패 | 500     | `OCR processing failed`              |
 *
 * **상태코드만으로는 못 가른다.** 503/504 는 Spring 앞단(Google Frontend)이 Spring 컨테이너
 * 자체의 사망·지연으로 낼 수도 있는 숫자이고, 업스트림 4xx 는 Spring 자체 500 과 같은 숫자다.
 * 그래서 판정의 1순위는 **본문 문구**로 두고, 마커가 없으면 상태코드 기반 폴백으로 떨어뜨린다
 * (그 경우 "Spring 이 낸 것이 아니다" 가 오히려 정확한 정보가 된다 — `scanImage.mapFailure` 참조).
 *
 * `ScanFailureCode` 에 전용 코드를 새로 만드는 편이 정석이지만 그 union 은 `types.ts` 소유이고
 * 이번 라운드의 담당 범위 밖이다. 그래서 **코드는 기존 SCF 를 재사용하고 문구·액션만** 갈라낸다
 * (`useScan.failureCopy`). 파싱은 이 함수 하나만 하고 화면 계층은 이 결과만 본다.
 *
 * 마커 문구가 바뀌어 매칭이 실패하면 상태코드 폴백(SCF-08/09)으로 떨어진다 — 조용히 나빠질 뿐
 * 깨지지는 않는다. 상세 한 줄에는 원문이 그대로 남으므로 진단은 여전히 가능하다.
 *
 * 커밋(`/api/commit`)은 Spring 을 우회해 FastAPI 를 직접 치므로 이 마커가 실릴 수 없다.
 * 그래서 코드로 게이트하지 않아도 오탐이 나지 않는다.
 */
export type SpringUpstreamKind = 'server' | 'contract' | 'unreachable' | 'timeout';

export type SpringUpstreamFailure = {
  kind: SpringUpstreamKind;
  /** 마커 괄호 안의 업스트림 상태코드. 응답 자체가 없던 `unreachable`/`timeout` 은 null. */
  upstreamStatus: number | null;
};

const UPSTREAM_MARKERS: readonly { re: RegExp; kind: SpringUpstreamKind }[] = [
  // `contract error` 를 먼저 본다 — 문자열이 겹치지는 않지만 의미가 가장 좁은 것부터 검사한다.
  { re: /upstream\s+contract\s+error\s*\((\d{3})\)/i, kind: 'contract' },
  { re: /upstream\s+failed\s*\((\d{3})\)/i, kind: 'server' },
  { re: /upstream\s+unreachable/i, kind: 'unreachable' },
  { re: /upstream\s+timeout/i, kind: 'timeout' },
];

/** 입력은 `ScanFailure.detail`(= `summarizeDetail` 이 접은 서버 문구 한 줄)이다. */
export function springUpstreamFailure(detail: string | null | undefined): SpringUpstreamFailure | null {
  if (!detail) return null;
  for (const { re, kind } of UPSTREAM_MARKERS) {
    const match = re.exec(detail);
    if (!match) continue;
    const captured = match[1] === undefined ? Number.NaN : Number(match[1]);
    return { kind, upstreamStatus: Number.isFinite(captured) ? captured : null };
  }
  return null;
}

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
  /* 목 모드 주입점. 스캔·커밋은 `request()` 가 아니라 XHR 업로더를 쓰므로 http 계층에서
     가로챌 수 없다 — 같은 `UploadHandle` 계약으로 여기서 갈아끼운다.
     목도 **봉투 → `unwrapScan`** 순서를 그대로 밟는다(파서를 우회하지 않는다). */
  if (isMockEnabled()) return mockScanImage(file, unwrapScan, options);

  return uploadMultipart<ScanResult>({
    url: `${getApiBaseUrl()}/api/scan`,
    file,
    authorize: true,
    timeoutMs: SCAN_TIMEOUT_MS,
    onProgress: options.onProgress,
    signal: options.signal,
    parse: unwrapScan,
    mapFailure: (kind, status, body, rawOrParseError) => {
      if (kind === 'timeout') return { code: 'SCF-08', status: null };
      if (kind === 'network') return { code: 'SCF-06', status: null };
      /* 파싱 실패의 원인은 서버 문구가 아니라 파서 예외 메시지다 → 본문 대신 예외 메시지를 남긴다.
         (`uploadMultipart` 는 kind==='parse' 일 때만 4번째 인자에 응답 원문 대신 **예외 메시지**를
          넣는다 — UploadArgs.mapFailure 의 매개변수 주석 참조. 여기서 body 에 null 을 주는 것도
          "본문이 아니라 예외 메시지를 쓴다" 를 강제하기 위한 것이다.) */
      if (kind === 'parse') {
        return { code: 'SCF-09', status, detail: summarizeDetail(null, rawOrParseError, status) };
      }

      const detail = summarizeDetail(body, rawOrParseError, status);

      // SCF-05: 10MB 초과가 서버까지 도달한 경우. ApiResponse 포맷이 아닌 에러가 온다.
      if (status === 413 || (status === 400 && isSpringDefaultError(body))) {
        return { code: 'SCF-05', status, detail };
      }

      /* ── 업스트림(OCR) 실패를 Spring 자체 실패와 **네 갈래**로 분리한다 (2026-08-05 2차) ──
         갈래·응답 문구의 정본은 `springUpstreamFailure()` 주석의 표다. 여기서는 그 판정을
         SCF 코드에 얹기만 한다. **판정 근거는 상태코드가 아니라 본문 마커**다 — 503/504 는
         Spring 컨테이너 자체가 죽거나 느릴 때 Google Frontend 도 내는 숫자라, 숫자만 믿으면
         "OCR 이 안 붙는다" 와 "백엔드가 죽었다" 를 같은 문구로 말하게 된다.

           unreachable → SCF-07 : Spring 이 OCR 주소에 **닿지 못했다**. 배포/설정 오류이므로
                                  재시도로 풀리지 않는다 → 문구·액션에서 `다시 시도` 를 뺀다.
           timeout     → SCF-08 : 연결은 됐는데 응답이 상한을 넘겼다 → 재시도가 의미 있다.
           server      → SCF-09 : 업스트림이 5xx 를 냈다(인스턴스 사망 또는 추론 실패).
                                  **연결은 성공했다** → "연결할 수 없습니다" 라고 말하면 거짓이다.
           contract    → SCF-09 : 업스트림 4xx = Spring↔OCR 계약 위반. 같은 요청은 항상 같은
                                  4xx 로 돌아온다 → 여기서도 `다시 시도` 를 뺀다.
         문구·액션 분기는 `useScan.failureCopy` 가 같은 판정 함수를 다시 불러 수행한다.

         마커가 없으면(= Spring 이 낸 응답이 아니거나 문구가 바뀌었으면) 상태코드 폴백으로
         떨어진다: 504 는 그래도 "오래 걸렸다" 가 맞으므로 SCF-08, 나머지 5xx 는 SCF-09
         `서버 에러 (nnn)`. 이 경우 숫자를 그대로 보여 주는 편이 억지 해석보다 정확하다. */
      const upstream = springUpstreamFailure(detail);
      if (upstream?.kind === 'unreachable') return { code: 'SCF-07', status, detail };
      if (upstream?.kind === 'timeout' || status === 504) return { code: 'SCF-08', status, detail };

      return { code: 'SCF-09', status, detail };
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
  // 목 모드: 파일 시스템이 없으므로 `image_url` 이 빈 문자열로 온다 → R2 경로가 검증된다.
  if (isMockEnabled()) {
    return mockCommitDocument(documentType, rawBlocks, correctedFields, unwrapCommit, options);
  }

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
    mapFailure: (kind, status, body, raw) => {
      if (kind === 'timeout') return { code: 'SCF-08', status: null };
      if (kind === 'network') return { code: 'SCF-07', status: null };
      // 커밋은 Spring 을 우회하므로 502/504 는 오지 않는다. 대신 OCR 이 낸 500 + JSON `detail`,
      // 파트명이 어긋났을 때의 **422 + pydantic 배열 detail**, 인스턴스 사망 시의 text/plain 503 이
      // 그대로 온다 → `summarizeDetail` 이 셋 다 평문 한 줄로 접는다(배열은 `loc: msg` 로).
      return { code: 'SCF-11', status, detail: summarizeDetail(body, raw, status) };
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

  // 저장은 `request()` 를 타므로 목 모드 주입이 필요 없다 — http 계층이 목 라우터로 보낸다.
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
 *
 * **`detail` 을 설정하지 않는 것은 의도다** (2026-08-05 3차에 확인). 저장은 XHR 업로더가 아니라
 * `request()`(`src/services/http.ts`)를 타는데, 그 계층의 `AppError` 는 서버 문구를 아예 버리고
 * 상태코드로 만든 한국어(`messageForStatus`)만 들고 온다 — "에러 메시지 한글이 인코딩 깨져 오는
 * 경우가 있어" 라는 그 파일의 명시적 결정이다. 그래서 여기서 채울 서버 원문이 존재하지 않는다.
 * 그 사실에 맞춰 `useScan.DETAIL_VISIBLE_CODES` 에서 SCF-12 를 뺐다(항상 undefined 였다).
 * 서버 원문을 저장 실패에도 노출하고 싶어지면 먼저 `AppError` 에 원문 필드를 추가해야 한다.
 */
function mapSaveFailure(kind: string, status: number | null): ScanFailure {
  if (kind === 'unauthorized') return { code: 'SCF-13', status };
  if (kind === 'timeout') return { code: 'SCF-08', status: null };
  if (kind === 'offline') return { code: 'SCF-06', status: null };
  const code: ScanFailureCode = status === 413 ? 'SCF-05' : 'SCF-12';
  return { code, status };
}
