import { getApiBaseUrl, getOcrBaseUrl } from '@/config/env';
import { isMockEnabled } from '@/mocks/config';
import { mockProbe } from '@/mocks/health';

/**
 * 서버 연결 진단 (FR-121 / FR-122, 화면 SCR-31).
 *
 * 두 서버 모두 전용 헬스 엔드포인트가 없다.
 *  - Spring: actuator 미포함. SecurityConfig 가 anyRequest().permitAll() 이고 인증은 컨트롤러에서
 *    JWT 로 검증하므로, 토큰 없이 GET /auth/me 를 치면 래핑된 401 이 온다.
 *    → 응답이 오고 본문에 success 필드가 있으면 "MORA Spring 이 맞다" 까지 확인된다.
 *  - OCR: GET / 이 {"service":"MORA OCR Service", ...} 를 준다. (원본: ocr/app.py)
 */

const PROBE_TIMEOUT_MS = 5_000;

export type ProbeStatus = 'ok' | 'wrong-server' | 'unreachable' | 'timeout' | 'error';

export type ProbeResult = {
  target: 'spring' | 'ocr';
  url: string;
  status: ProbeStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string;
};

const MESSAGE: Record<ProbeStatus, string> = {
  ok: '정상 응답',
  'wrong-server': '응답은 왔지만 MORA 서버가 아닙니다. 포트를 확인해 주세요.',
  unreachable: '연결할 수 없습니다. 서버 기동 여부와 PC 방화벽 인바운드 허용을 확인해 주세요.',
  timeout: '5초 안에 응답이 없습니다. 같은 Wi-Fi 인지 확인해 주세요.',
  error: '알 수 없는 오류',
};

async function probe(
  target: ProbeResult['target'],
  url: string,
  verify: (body: unknown, httpStatus: number) => boolean,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // Date.now 대신 성능 측정용으로도 Date.now 를 쓴다 (RN 에 performance.now 가 있으나 정밀도 이점이 없다).
  const started = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }

    const okShape = verify(body, res.status);
    return {
      target,
      url,
      status: okShape ? 'ok' : 'wrong-server',
      httpStatus: res.status,
      latencyMs,
      detail: okShape ? MESSAGE.ok : MESSAGE['wrong-server'],
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    const status: ProbeStatus = aborted ? 'timeout' : 'unreachable';
    return { target, url, status, httpStatus: null, latencyMs: null, detail: MESSAGE[status] };
  } finally {
    clearTimeout(timer);
  }
}

export function probeSpring(): Promise<ProbeResult> {
  const url = `${getApiBaseUrl()}/auth/me`;
  // 목 모드에서는 서버가 없는 것이 정상이다. 빨간 실패 카드 대신 `목 모드` 문구로 구분한다.
  if (isMockEnabled()) return mockProbe('spring', url);

  return probe('spring', url, (body) => {
    return !!body && typeof body === 'object' && 'success' in (body as object);
  });
}

export function probeOcr(): Promise<ProbeResult> {
  const url = `${getOcrBaseUrl()}/`;
  if (isMockEnabled()) return mockProbe('ocr', url);

  return probe('ocr', url, (body) => {
    const service = (body as { service?: unknown } | null)?.service;
    return typeof service === 'string' && service.includes('MORA OCR');
  });
}

/** 두 서버를 동시에 찍는다. 한쪽 실패가 다른 쪽 결과를 가리지 않도록 병렬로 돌린다. */
export function probeAll(): Promise<ProbeResult[]> {
  return Promise.all([probeSpring(), probeOcr()]);
}
