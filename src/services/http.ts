import { getApiBaseUrl } from '@/config/env';
import { isMockEnabled } from '@/mocks/config';
import { handleMockRequest } from '@/mocks/handlers';

import { clearSession, getTokenSync } from './session';

/**
 * MORA Spring 백엔드용 HTTP 클라이언트.
 *
 * 서버 응답 규약과 알려진 함정은 wiki/tech/API Contract.md 가 정본이다. 요약:
 *  - 모든 응답이 { success, data, error, message } 로 감싸져 있다.
 *  - /api/scan 처럼 Python OCR 응답을 다시 감싼 **이중 래핑**(data.data)이 존재한다.
 *  - 목록 응답은 배열이거나 Spring `Page<>`({ content: [...] })이거나 둘 다 온다.
 *  - `LocalDateTime` 이 [2026,7,27,15,4,0] 같은 숫자 배열로 직렬화된다.
 *  - 에러 메시지 한글이 인코딩 깨져 오는 경우가 있어 상태코드 기반 문구를 우선한다.
 */

export type ErrorKind = 'offline' | 'timeout' | 'unauthorized' | 'client' | 'server' | 'parse';

export type AppError = {
  kind: ErrorKind;
  status: number | null;
  /** 사용자에게 보여줄 한국어 문구. 서버 문구를 신뢰할 수 없을 때 상태코드로 생성한다. */
  message: string;
};

export type ApiResult<T> = { ok: true; data: T; message?: string } | { ok: false; error: AppError };

const DEFAULT_TIMEOUT_MS = 15_000;
/** 이미지 업로드는 OCR 추론 시간까지 기다려야 한다. */
/**
 * 이미지 업로드는 OCR 추론 시간까지 기다려야 한다.
 *
 * 120초인 이유 — 서버는 Cloud Run 에 배포되고 gunicorn 이 `--timeout 300` 으로 뜬다(`ocr/Dockerfile`).
 * 컨테이너 이미지에 PaddleOCR + NER 가중치 844MB 가 들어 있어 **콜드스타트에 수십 초**가 걸린다.
 * 60초로 두면 인스턴스가 잠들어 있던 뒤의 첫 스캔이 매번 타임아웃으로 보인다 — [[Risks]] RSK-43.
 * LAN 개발에서는 콜드스타트가 없어 이 문제가 절대 재현되지 않는다.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** 세션이 끊겼을 때 라우터가 로그인 화면으로 보내도록 알린다. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;
export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

function messageForStatus(status: number): string {
  if (status === 401) return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.';
  if (status === 403) return '권한이 없습니다.';
  if (status === 404) return '요청한 정보를 찾을 수 없습니다.';
  if (status === 409) return '이미 존재하는 데이터입니다.';
  if (status === 413) return '파일이 너무 큽니다.';
  if (status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return `서버에 문제가 발생했습니다. (${status})`;
  return `요청을 처리하지 못했습니다. (${status})`;
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401) return 'unauthorized';
  if (status >= 500) return 'server';
  return 'client';
}

/** Spring 이 숫자 배열로 직렬화한 LocalDateTime 을 ISO 문자열로 되돌린다. */
export function normalizeDateTime(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length >= 3) {
    const [y, mo, d, h = 0, mi = 0, s = 0] = value as number[];
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo as number)}-${p(d as number)}T${p(h)}:${p(mi)}:${p(s)}`;
  }
  return undefined;
}

/** 배열 / Page<> / 이중 래핑을 모두 흡수해 배열로 꺼낸다. */
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const content = (data as { content?: unknown }).content;
    if (Array.isArray(content)) return content as T[];
    const inner = (data as { data?: unknown }).data;
    if (inner !== undefined) return unwrapList<T>(inner);
  }
  return [];
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON 바디. FormData 를 보낼 때는 body 대신 formData 를 쓴다. */
  json?: unknown;
  formData?: FormData;
  timeoutMs?: number;
  /** 인증 헤더를 붙이지 않는다 (로그인/회원가입/헬스체크). */
  anonymous?: boolean;
  signal?: AbortSignal;
};

/**
 * 목 모드 요청 1건 (`mocks/handlers.ts` 라우터).
 *
 * **아래 `request()` 의 후처리를 글자 그대로 다시 밟는다** — 401 세션 정리, `success:false` 판정,
 * 봉투 언랩, `message` 승계까지. 여기서 한 줄이라도 갈라지면 "목에서만 나는 버그"가 생겨
 * 목 모드의 목적(프론트 디버깅)이 무너진다.
 *
 * 취소(`signal`)는 `fetch` 처럼 즉시 끊지 않고 목 지연(200~600ms)이 끝난 뒤 판정한다.
 * 결과는 같다 — 실서버의 AbortError 와 동일하게 `timeout` 으로 돌려준다.
 */
async function mockRequest<T>(path: string, options: RequestOptions): Promise<ApiResult<T>> {
  const { method = 'GET', json, formData, anonymous = false, signal } = options;

  const aborted: ApiResult<T> = {
    ok: false,
    error: { kind: 'timeout', status: null, message: '서버 응답이 없습니다. 네트워크를 확인해 주세요.' },
  };
  if (signal?.aborted) return aborted;

  // 익명 요청(로그인·회원가입)은 실서버와 같은 조건 — 토큰을 붙이지 않는다.
  const token = anonymous ? null : getTokenSync();
  // multipart 로 오는 경로는 목 라우터에 없다(스캔·커밋은 `features/scan/api.ts` 가 직접 가로챈다).
  const body = formData !== undefined ? undefined : json;

  const mock = await handleMockRequest(method, path, body, { token });
  if (signal?.aborted) return aborted;

  if (mock.status === 401) {
    await clearSession();
    onSessionExpired?.();
    return { ok: false, error: { kind: 'unauthorized', status: 401, message: messageForStatus(401) } };
  }

  const envelope = mock.body as { success?: boolean; data?: unknown; error?: string; message?: string } | null;
  const httpOk = mock.status >= 200 && mock.status < 300;

  if (!httpOk || envelope?.success === false) {
    return {
      ok: false,
      error: {
        kind: kindForStatus(mock.status),
        status: mock.status,
        message: messageForStatus(mock.status),
      },
    };
  }

  const data = (envelope && 'data' in envelope ? envelope.data : mock.body) as T;
  return { ok: true, data, message: envelope?.message };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  if (isMockEnabled()) return mockRequest<T>(path, options);

  const {
    method = 'GET',
    json,
    formData,
    timeoutMs = formData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    anonymous = false,
    signal,
  } = options;

  const url = `${getApiBaseUrl()}${path}`;
  const headers: Record<string, string> = {};

  if (!anonymous) {
    const token = getTokenSync();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // multipart 는 boundary 를 fetch 가 직접 붙이므로 Content-Type 을 절대 수동 지정하지 않는다.
  if (json !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /* 호출자 signal → 내부 controller 브리지.
     리스너를 **반드시 떼어낸다** — 호출자의 AbortController 가 요청보다 오래 사는 경우(챗봇의
     세션 컨트롤러처럼)에는 메시지를 보낼 때마다 죽은 리스너가 하나씩 쌓인다.
     이미 중단된 signal 로 들어오면 `addEventListener` 는 영영 발화하지 않으므로 즉시 끊는다. */
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort);
  }
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: formData ?? (json !== undefined ? JSON.stringify(json) : undefined),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? { kind: 'timeout', status: null, message: '서버 응답이 없습니다. 네트워크를 확인해 주세요.' }
        : {
            kind: 'offline',
            status: null,
            message: '서버에 연결할 수 없습니다. 같은 Wi-Fi 에 있는지, 서버 주소가 맞는지 확인해 주세요.',
          },
    };
  } finally {
    // 응답 헤더가 온 시점에 타이머를 끈다 — 본문(`res.text()`)을 읽는 동안 중단되면 안 된다.
    cleanup();
  }

  const raw = await res.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      // 서버가 HTML 에러 페이지를 준 경우. 상태코드로만 판단한다.
    }
  }

  if (res.status === 401) {
    await clearSession();
    onSessionExpired?.();
    return { ok: false, error: { kind: 'unauthorized', status: 401, message: messageForStatus(401) } };
  }

  const envelope = body as { success?: boolean; data?: unknown; error?: string; message?: string } | null;

  if (!res.ok || envelope?.success === false) {
    return {
      ok: false,
      error: {
        kind: kindForStatus(res.status),
        status: res.status,
        message: messageForStatus(res.status),
      },
    };
  }

  // success 필드가 없는 응답(OCR 서버 등)은 파싱된 바디 전체를 데이터로 본다.
  const data = (envelope && 'data' in envelope ? envelope.data : body) as T;
  return { ok: true, data, message: envelope?.message };
}
