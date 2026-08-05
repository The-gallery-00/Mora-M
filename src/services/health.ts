import { getApiBaseUrl, getOcrBaseUrl } from '@/config/env';
import { isMockEnabled } from '@/mocks/config';
import { mockProbe } from '@/mocks/health';
import { StorageKey, storage } from '@/store/storage';

import { getTokenSync } from './session';

/**
 * 서버 연결 진단 (FR-121 / FR-122, 화면 SCR-31).
 *
 *  - Spring: actuator 미포함(`server/spring/pom.xml` 에 spring-boot-starter-actuator 없음).
 *    SecurityConfig 가 `anyRequest().permitAll()` 이고 인증은 컨트롤러가 직접 JWT 로 검증한다.
 *  - OCR: GET /health 가 **추론 셀프테스트 결과까지** 담아 준다. (원본: ocr/routers/ocr.py)
 *
 * ⚠️ 예전에는 OCR 을 `GET /` 의 `service` 문자열로만 판정했다. 그 응답은 FastAPI 라우트가
 * 살아 있다는 뜻일 뿐이라 **PaddleOCR 추론이 100% 죽어 있어도 초록불**이었다 —
 * OOM 장애(2026-08) 내내 이 화면은 "두 서버 모두 정상" 이라고 말했다.
 * 그래서 지금은 `/health` 의 `ocr` 필드까지 봐야만 'ok' 로 친다.
 *
 * ⚠️ 2026-08-05 추가 — **Spring 쪽에 같은 거짓 초록불이 그대로 남아 있었다.**
 * 종전 판정은 "본문에 `success` 필드가 있으면 ok" 였는데, 토큰 없는 `GET /auth/me` 는
 * `AuthController.me()` 첫 줄에서 Authorization 헤더가 없다는 이유로 **DB 를 건드리기 전에**
 * 401 을 만든다(`server/spring/.../controller/AuthController.java:117-119`).
 * 즉 Cloud SQL 이 통째로 죽어도 그 401 은 똑같이 오고, 화면은 "정상 응답" 을 냈다.
 * → 지금은 **토큰이 있으면 붙여서** 200 을 받아야만 'ok' 로 치고(그 경로가 DB 조회까지 통과한다),
 *   그렇지 못하면 초록도 빨강도 아닌 'reachable'(도달만 확인) 로 남긴다. 아래 `probeSpring` 참조.
 *
 * ⚠️ 2026-08-05 2차 추가 — **위 "토큰을 붙인다" 가 그대로는 토큰 유출 경로였다.**
 * 이 프로브는 사용자가 방금 타이핑한 임의의 호스트로 요청을 보낼 수 있다(LAN 모드는 평문 http).
 * → 아래 `decideSpringAuth` 가 **부착 여부를 주소의 출처로 판정**한다.
 *   빌드에 주입된/폴백 주소(팀이 정한 값)에만 기본 부착하고, 사용자가 직접 입력한
 *   오버라이드 주소에는 **명시적으로 허용하지 않는 한 붙이지 않는다.**
 *   그리고 그 결정은 `ProbeResult.auth` 로 화면까지 올라간다 — 안 그러면 "인증까지 확인했는가"를
 *   모른 채 결과를 읽게 되고, 그건 이 파일이 없애려는 바로 그 거짓 신호다.
 *
 * ⚠️ 2026-08-05 4차 정정 — **위 2차 서술은 이 파일이 세션 유출을 막는다고 읽혔지만, 사실이 아니었다.**
 * 종전 진단 화면은 [연결 확인] 이 `setServerOverride` 로 **먼저 저장하고** 프로브를 돌렸다.
 * 그러니 프로브가 토큰을 뺀 것과 무관하게 그 주소는 이미 앱의 API 주소가 되어 있었고,
 * 화면을 나가는 순간부터 `services/http.ts` `request()` 가 **모든** 인증 요청에
 * `Authorization: Bearer <jwt>` 를 붙여 그 호스트로 보냈다(:183-185). 프로브 1회를 막고
 * 그 뒤 전부를 흘려보낸 셈이다.
 * → 실질 방어선은 이제 **저장 시점**에 있다: API 주소를 바꾸는 저장/해제는 세션을 파기한다
 *   (`config/env.ts` `setServerOverride` / `clearServerOverride`). 그리고 [연결 확인] 은
 *   더 이상 아무것도 저장하지 않고 **지금 유효한 주소만** 잰다.
 * → 그러므로 아래 `decideSpringAuth` 의 보류는 "세션이 남의 호스트로 넘어가는 것을 막는 장치"가
 *   **아니다.** 그건 저장 시점이 한다. 여기 남은 역할은 딱 하나 — 사람이 손으로 넣은 주소에
 *   토큰을 자동으로 얹지 않는 것(오래 전에 저장돼 잊힌 오버라이드가 남아 있는 경우가 실제 대상이다).
 *   이 구분을 뭉개면 화면 문구가 다시 있지도 않은 방어선을 사칭하게 된다.
 */

/**
 * 프로브 타임아웃.
 *
 * 5초는 **정상 서버를 죽었다고 오판**하는 값이었다. Cloud Run 은 min-instances 0 이라
 * 첫 요청이 콜드스타트를 그대로 맞는다.
 *
 * 40 → 60초 상향(2026-08-05). 40초의 근거였던 **18~33초 실측은 `POST /api/scan` 경로**의 값이다
 * (컨테이너 기동 + PaddleOCR 모델 lazy 로드). 이 프로브가 때리는 `GET /health` 는 그 위에
 * **192×64 합성 이미지 셀프테스트를 한 번 더** 태운다(`server/ocr/routers/ocr.py` `_ocr_selftest`).
 * (흰 64×64 는 2차까지의 이미지다. det 가 글자를 0개 찾아 rec 가 아예 실행되지 않았고 —
 *  그 자체가 거짓 초록불이었다. 지금은 `SELFTEST_WIDTH_PX=192 / HEIGHT=64` 캔버스에
 *  `SELFTEST_TEXT="MORA OCR"` 를 그려 태운다: 로컬 실측 150~270ms.)
 * 즉 33초는 이 경로의 상한이 아니라 **하한**이고, 40초는 여유가 7초뿐이라 콜드 인스턴스를
 * 종종 `timeout`(빨강)으로 오판한다 — 이 브랜치가 없애려는 바로 그 거짓 신호다.
 *
 * 대가는 "정말 죽은 서버가 빨강으로 바뀌기까지 60초"다. 화면은 그동안 스피너를 돌리고 있으므로
 * 무응답으로 보이지 않는다. 두 프로브는 `Promise.all` 로 병렬이라 총 대기도 60초를 넘지 않는다.
 * 이 값을 다시 줄이려면 콜드스타트를 먼저 없애라(min-instances 1 또는 이미지에 모델 동봉).
 */
const PROBE_TIMEOUT_MS = 60_000;

export type ProbeStatus =
  | 'ok'
  /**
   * **닿았지만 거기까지만 확인됐다.** 초록도 빨강도 아니다.
   * Spring 전용이며, 무인증 `GET /auth/me` 가 DB 를 거치지 않는다는 사실에서 나온 상태다.
   * 'ok' 로 칠하면 DB 장애에 올클리어를 내고, 'degraded' 로 칠하면 멀쩡한 서버를 매번
   * 경고로 신고한다 — 둘 다 거짓 신호라 상태값을 따로 뒀다.
   */
  | 'reachable'
  | 'degraded'
  | 'stale-server'
  | 'wrong-server'
  | 'unreachable'
  /**
   * `probe()` 의 catch 는 AbortError 만 'timeout' 으로 가르고 나머지는 전부 'unreachable' 이다.
   * 예전에는 여기에 `'error'`(알 수 없는 오류) 가 하나 더 있었는데 **어떤 경로로도 생성되지 않았다** —
   * `MESSAGE.error` 와 진단 화면의 `STATUS_LABEL.error` 까지 함께 죽은 코드였고,
   * 상태표를 읽는 사람에게 "이런 결과도 나올 수 있다" 는 거짓 정보를 줬다. 그래서 지웠다.
   * 새 상태값을 추가할 때는 **그 값을 실제로 만드는 코드 경로를 같은 커밋에** 넣어라.
   */
  | 'timeout';

/**
 * 이 프로브가 실제로 때린 base URL 이 **어디서 왔는지**.
 * `config/env.ts` 의 우선순위(MMKV 오버라이드 > EXPO_PUBLIC_* > 하드코딩 폴백)와 1:1 이다.
 *
 * 이번 OOM 조사에서 가장 오래 걸린 부분이 "앱이 LAN IP(192.168.0.2)를 보고 있는지
 * Cloud Run 을 보고 있는지" 를 화면에서 알 수 없다는 점이었다. 주소만으로는
 * 그 주소가 남아 있는 오버라이드인지 빌드 기본값인지 구분이 안 된다.
 */
export type UrlSource = 'override' | 'env' | 'fallback';

/**
 * Spring 프로브가 **세션 JWT 를 실제로 보냈는지, 안 보냈으면 왜 안 보냈는지**.
 *
 * 판정 기준은 "이 주소를 누가 정했는가" 다 (위 파일 머리말 2차 추가분 참조).
 *  · `sent-trusted`      — 빌드에 주입된 값(EXPO_PUBLIC_*)이나 하드코딩 폴백. 팀이 정한 호스트다.
 *  · `sent-user-approved`— 사용자가 직접 입력한 오버라이드인데, 진단 화면에서 **명시적으로 허용**했다.
 *  · `withheld-untrusted`— 직접 입력한 오버라이드이고 허용하지 않았다 → 무인증으로만 확인했다.
 *  · `withheld-no-token` — 애초에 로그인 전이라 붙일 토큰이 없다.
 *
 * HTTPS 여부는 부착 **차단** 기준으로 쓰지 않는다. LAN 개발 서버(http://192.168.x.x:8080)가
 * 이 화면의 1순위 용도라 http 를 막으면 기능 자체가 사라진다. 대신 `springAuthLabel()` 이
 * "평문(HTTP)" 을 문구에 박아 사용자가 그 사실을 보고 결정하게 한다.
 */
export type SpringAuthMode =
  | 'sent-trusted'
  | 'sent-user-approved'
  | 'withheld-untrusted'
  | 'withheld-no-token';

export type ProbeResult = {
  target: 'spring' | 'ocr';
  url: string;
  /** url 의 출처. 진단 화면에 그대로 노출한다. */
  source: UrlSource;
  status: ProbeStatus;
  httpStatus: number | null;
  /** 앱이 잰 왕복 시간. 콜드스타트가 섞이면 수십 초가 나온다. */
  latencyMs: number | null;
  /** 서버가 스스로 잰 추론 시간(`/health` 의 latency_ms). 없으면 null. */
  serverLatencyMs: number | null;
  /**
   * 위 `serverLatencyMs` 가 **지금 측정한 값이 아니라 서버 캐시에서 나온 값**인지.
   * `/health` 는 TTL 안이면 셀프테스트를 다시 돌리지 않고 `cached: true` 를 붙여 돌려준다.
   * TTL 은 결과에 따라 다르다(`server/ocr/routers/ocr.py`):
   * 성공 `HEALTH_CACHE_TTL_SEC = 30.0`, 실패 `HEALTH_FAIL_CACHE_TTL_SEC = 5.0`.
   * 이 플래그를 무시하면 묵은 지연시간이 "지금 잰 추론 시간" 으로 화면에 뜬다 —
   * 재배포 직후 확인에서 특히 위험하다. 화면에는 **초 단위 숫자를 적지 않는다**:
   * 두 TTL 이 다르므로 "최대 30초 전 값" 은 503 캐시(5초)에 대해서는 거짓이 된다.
   */
  serverLatencyCached: boolean;
  /**
   * 이 요청에 Authorization 을 붙였는지(붙이지 않았다면 그 이유).
   * OCR 프로브와 목 프로브는 토큰을 다루지 않으므로 언제나 null 이다 — 화면은 null 이면
   * 인증 줄 자체를 그리지 않는다. "붙였다/안 붙였다" 는 이 값 **하나로만** 표시한다:
   * 화면이 따로 계산하면 실제 요청 헤더와 표시가 어긋날 수 있고, 그 순간 진단 결과 자체가
   * 거짓 신호가 된다.
   */
  auth: SpringAuthMode | null;
  detail: string;
};

const MESSAGE: Record<ProbeStatus, string> = {
  ok: '정상 응답',
  reachable:
    'MORA Spring 프로세스에는 닿았습니다. 다만 토큰 없는 GET /auth/me 는 DB 를 거치지 않고 401 을 만들기 때문에, 이 결과만으로는 DB(Cloud SQL) 상태를 알 수 없습니다. 로그인한 상태에서 다시 확인하면 DB 조회까지 검증됩니다.',
  degraded: 'OCR 서버는 응답하지만 문자 인식이 동작하지 않습니다. 서버 로그를 확인해 주세요.',
  'stale-server': '구버전 OCR 서버입니다. 최신 이미지로 재배포가 필요합니다.',
  'wrong-server': '응답은 왔지만 MORA 서버가 아닙니다. 포트를 확인해 주세요.',
  unreachable: '연결할 수 없습니다. 서버 기동 여부와 PC 방화벽 인바운드 허용을 확인해 주세요.',
  timeout:
    '60초 안에 응답이 없습니다. LAN 모드면 같은 Wi-Fi 인지, Cloud Run 이면 콜드스타트(스캔 경로 실측 18~33초 + /health 셀프테스트)를 넘긴 것이므로 인스턴스가 뜨지 못한 상태인지 확인해 주세요.',
};

/** 진단 화면 표시용 한국어 라벨. 상태값 문자열을 화면에서 재해석하지 않게 여기서 준다. */
export const URL_SOURCE_LABEL: Record<UrlSource, string> = {
  override: '진단 화면 오버라이드 (MMKV)',
  env: '빌드 주입 (EXPO_PUBLIC_*)',
  fallback: '하드코딩 폴백 (Cloud Run)',
};

/**
 * base URL 의 출처를 `config/env.ts` 와 **똑같은 규칙**으로 되짚는다.
 *
 * env.ts 를 고쳐서 출처를 같이 반환하게 만드는 편이 깔끔하지만, env.ts 는 앱 전역이
 * 의존하는 파일이라 이번 변경 범위 밖이다. 대신 판정 로직을 여기서 복제하되
 * **연산자까지 동일하게** 맞춘다:
 *   - 오버라이드: env.ts 가 `if (override)` 이므로 빈 문자열은 오버라이드로 치지 않는다.
 *   - env: env.ts 가 `?? FALLBACK` 이므로 빈 문자열이어도 undefined 가 아니면 env 다.
 * `process.env.EXPO_PUBLIC_*` 는 Expo 바벨 플러그인이 **정확한 멤버 표현식만** 정적 치환하므로
 * 동적 인덱싱(process.env[key])으로 묶지 않고 두 벌을 그대로 적는다.
 */
export function getApiUrlSource(): UrlSource {
  if (storage.getString(StorageKey.serverApiUrl)) return 'override';
  return process.env.EXPO_PUBLIC_API_URL !== undefined ? 'env' : 'fallback';
}

export function getOcrUrlSource(): UrlSource {
  if (storage.getString(StorageKey.serverOcrUrl)) return 'override';
  return process.env.EXPO_PUBLIC_OCR_URL !== undefined ? 'env' : 'fallback';
}

/**
 * 이번 Spring 프로브가 토큰을 붙일지 결정한다. **화면과 요청이 같은 함수를 쓴다** —
 * 진단 화면은 [연결 확인] 을 누르기 전에 이 함수로 "지금 누르면 인증이 포함되는가" 를 미리 보여주고,
 * `probeSpring()` 은 같은 값으로 실제 헤더를 만든다. 두 벌로 나누면 표시와 동작이 갈라진다.
 *
 * `allowOverrideAuth` 는 진단 화면의 **명시적 옵트인**이다(기본 false). 켜지 않으면
 * 오버라이드 주소에는 이 프로브가 토큰을 보내지 않는다.
 * ⚠️ 이 기본값은 "세션이 남의 호스트로 넘어가는 것" 을 막지 못한다 — 그건 저장 시점이 막는다
 * (파일 머리말 4차 정정). 여기서 막는 것은 **이 요청 한 건**뿐이다. 문구도 그렇게만 적어야 한다.
 *
 * 2026-08-05 4차 — `source` 를 밖에서 받던 매개변수를 없앴다. 그 매개변수는 진단 화면이
 * [연결 확인] 에서 **저장 → 프로브** 순서로 돌던 시절, "저장된 뒤의 출처" 로 미리보기를 맞추기
 * 위한 것이었다. 이제 [연결 확인] 은 아무것도 저장하지 않고 **지금 유효한 주소만** 재므로
 * 그 경로가 사라졌다. 남겨 두면 화면이 실제 요청과 다른 출처로 미리보기를 만들 수 있는
 * 구멍만 남는다 — 표시와 동작이 갈라질 수 있는 문은 닫는다.
 */
export function decideSpringAuth(allowOverrideAuth = false): SpringAuthMode {
  const source = getApiUrlSource();
  // 토큰이 없으면 헤더 자체를 붙이지 않는다. 빈 Bearer 를 보내면 서버가 400 을 내서
  // "만료된 토큰" 과 "토큰 없음" 이 화면에서 구분되지 않는다.
  if (!getTokenSync()) return 'withheld-no-token';
  // 오버라이드가 아니면 빌드가 정한 주소다(EXPO_PUBLIC_* / 폴백) → 신뢰 대상.
  if (source !== 'override') return 'sent-trusted';
  return allowOverrideAuth ? 'sent-user-approved' : 'withheld-untrusted';
}

/**
 * 진단 화면에 그대로 찍는 한국어 문구. 전송이 **실제로 일어나는 경우에만** 전송 구간이
 * 평문(http)인지까지 밝힌다 — 안 보내는 경우에 스킴을 말하면 경고가 흐려진다.
 */
export function springAuthLabel(mode: SpringAuthMode, url: string): string {
  const plaintext = !/^https:/i.test(url) ? ' · 평문(HTTP) 전송' : '';
  switch (mode) {
    case 'sent-trusted':
      return `인증 포함 — 빌드가 정한 주소라 로그인 토큰을 붙였습니다${plaintext}`;
    case 'sent-user-approved':
      return `인증 포함 — 직접 입력한 주소이지만 사용자가 토큰 전송을 허용했습니다${plaintext}`;
    case 'withheld-untrusted':
      return '인증 없음 — 직접 입력한 주소라 로그인 토큰을 보내지 않았습니다 (DB 경로 미검증)';
    case 'withheld-no-token':
      return '인증 없음 — 로그인 전이라 붙일 토큰이 없습니다 (DB 경로 미검증)';
  }
}

/** classify 콜백이 돌려주는 판정. detail 을 주면 MESSAGE 기본 문구 대신 그 문장을 쓴다. */
type Verdict = {
  status: ProbeStatus;
  detail?: string;
  serverLatencyMs?: number | null;
  serverLatencyCached?: boolean;
};

function asObject(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
}

/**
 * "본문이 JSON 이 아닌 5xx" 판정.
 *
 * 이번 OOM 장애의 지문이다. FastAPI/Spring 은 실패해도 JSON 을 준다 —
 * text/plain "Service Unavailable" 은 **앱 코드가 아니라 Google Frontend** 가 낸 것이고,
 * 컨테이너가 통째로 죽었다는 뜻이다. 이걸 'wrong-server'(포트를 확인해 주세요)로 칠하면
 * 사용자를 정반대 방향으로 보내게 된다.
 */
function isGatewayFailure(body: unknown, httpStatus: number): boolean {
  return httpStatus >= 500 && asObject(body) === null;
}

/**
 * "본문이 JSON 이 아닌 403" 판정.
 *
 * Cloud Run 서비스가 **비공개**로 떠 있을 때의 지문이다. `gcloud run deploy` 를 `--quiet` 로
 * 돌리면서 `--allow-unauthenticated` 를 빠뜨리면 신규 서비스가 비공개로 생성되고,
 * 그때 앱이 받는 것은 우리 서버의 봉투 JSON 이 아니라 **Google 이 낸 HTML 403** 이다.
 * 이걸 'wrong-server' 기본 문구("포트를 확인해 주세요")로 칠하면 사용자를 정반대 방향으로 보낸다 —
 * 포트도 주소도 맞고 문제는 IAM 이다. → `server/cloudrun/deploy-*.ps1` 의 `-AllowUnauthenticated`.
 */
function isForbiddenGateway(body: unknown, httpStatus: number): boolean {
  return httpStatus === 403 && asObject(body) === null;
}

/** 위 403 지문에 붙일 문구. 두 프로브가 같은 문장을 써야 한다 — 원인이 같기 때문이다. */
const FORBIDDEN_DETAIL =
  '주소는 맞지만 접근이 거부됐습니다 (HTTP 403, 본문이 JSON 이 아님). Cloud Run 서비스가 비공개로 배포된 상태일 수 있습니다 — 포트가 아니라 IAM 을 확인해 주세요 (server/cloudrun/deploy-*.ps1 의 --allow-unauthenticated).';

async function probe(
  target: ProbeResult['target'],
  url: string,
  source: UrlSource,
  classify: (body: unknown, httpStatus: number) => Verdict,
  /**
   * 인증 부착 결정(`decideSpringAuth`). Spring 프로브만 값을 넘기고 OCR 은 null 이다.
   *
   * **헤더를 직접 받지 않고 결정값을 받는다.** 예전 시그니처는 `headers` 를 그대로 받았는데,
   * 그러면 "결과에 적힌 인증 여부" 와 "실제로 나간 헤더" 가 서로 다른 곳에서 만들어져
   * 언제든 어긋날 수 있었다. 여기서 한 번에 만들면 그 어긋남이 구조적으로 불가능하다.
   *
   * `services/http.ts` 의 `request()` 를 쓰지 않는 이유는 그쪽이 401 에서
   * `clearSession()` + 세션 만료 라우팅을 일으키기 때문이다 — 진단을 눌렀다고
   * 로그아웃되면 안 된다. 여기서는 순수 `fetch` 로 부작용 없이 관찰만 한다.
   */
  auth: SpringAuthMode | null = null,
): Promise<ProbeResult> {
  const token = auth === 'sent-trusted' || auth === 'sent-user-approved' ? getTokenSync() : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // Date.now 대신 성능 측정용으로도 Date.now 를 쓴다 (RN 에 performance.now 가 있으나 정밀도 이점이 없다).
  const started = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }

    const verdict = classify(body, res.status);
    return {
      target,
      url,
      source,
      status: verdict.status,
      httpStatus: res.status,
      latencyMs,
      serverLatencyMs: verdict.serverLatencyMs ?? null,
      serverLatencyCached: verdict.serverLatencyCached ?? false,
      auth,
      detail: verdict.detail ?? MESSAGE[verdict.status],
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    const status: ProbeStatus = aborted ? 'timeout' : 'unreachable';
    return {
      target,
      url,
      source,
      status,
      httpStatus: null,
      latencyMs: null,
      serverLatencyMs: null,
      serverLatencyCached: false,
      auth,
      detail: MESSAGE[status],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spring 프로브 — `GET /auth/me`.
 *
 * **왜 이 경로인가**: 레포의 Spring 에는 무인증으로 DB 를 건드리는 엔드포인트가 하나도 없다.
 * 직접 확인한 것 —
 *  · actuator 미포함(`server/spring/pom.xml` 에 spring-boot-starter-actuator 의존 0건)
 *    → `/actuator/health` 로 DB 를 볼 수 없다.
 *  · `SecurityConfig` 는 `anyRequest().permitAll()` 이지만, 컨트롤러가 전부 첫 줄에서
 *    Authorization 헤더를 검사하고 없으면 **DB 접근 전에** 401 을 만든다.
 *  · `POST /auth/login` 은 DB(`UserRepository.findByEmail`)를 타지만,
 *    `AuthController.login()` 이 `RuntimeException` 을 통째로 잡아 **DB 장애든 자격증명 오류든
 *    똑같은 400 `{"success":false,"error":"Invalid email or password"}`** 를 낸다(:98-106).
 *    구분이 불가능하므로 DB 프로브로 쓸 수 없다.
 * → 서버 변경 없이 DB 를 확인할 수 있는 유일한 방법은 **유효한 토큰을 붙여 200 을 받는 것**이다.
 *   그 200 은 JwtFilter → 컨트롤러 → `JwtUtil.getUserId` → `AuthService.getUserById`(DB 조회)
 *   전 구간을 통과했다는 뜻이다(:113-125).
 *
 * 토큰이 없거나(로그인 전 진입) 만료되어 200 을 못 받으면 'ok' 대신 'reachable' 을 낸다.
 * 종전처럼 'ok' 로 칠하면 Cloud SQL 이 죽어 모든 저장이 실패하는 상황에서도 초록불이 뜬다.
 *
 * **이 요청 한 건에 대해서는** 토큰을 아무 주소에나 보내지 않는다. 부착 여부는 `decideSpringAuth` 가
 * 주소의 출처로 판정하고, 그 결정은 결과 카드에 문장으로 남는다. (그 보류가 세션 자체를
 * 지키는 것은 아니다 — 세션 방어선은 저장 시점이다. 파일 머리말 4차 정정.)
 * 토큰을 보내지 않은 확인은 'ok' 가 될 수 없고 최대 'reachable' 이다 — 무인증 `GET /auth/me` 는
 * 항상 401 이기 때문이다. 즉 "인증을 뺐더니 초록불" 같은 거짓 신호는 구조적으로 나올 수 없다.
 */
export function probeSpring(options?: { allowOverrideAuth?: boolean }): Promise<ProbeResult> {
  const url = `${getApiBaseUrl()}/auth/me`;
  const source = getApiUrlSource();
  // 목 모드에서는 서버가 없는 것이 정상이다. 빨간 실패 카드 대신 `목 모드` 문구로 구분한다.
  if (isMockEnabled()) return mockProbe('spring', url, source);

  const auth = decideSpringAuth(options?.allowOverrideAuth ?? false);

  return probe(
    'spring',
    url,
    source,
    (body, httpStatus) => {
      if (isGatewayFailure(body, httpStatus)) {
        return {
          status: 'degraded',
          detail: `Spring 이 아니라 게이트웨이가 HTTP ${httpStatus} 를 냈습니다 (본문이 JSON 이 아님). 인스턴스가 죽은 상태입니다 — 서버 로그를 확인해 주세요.`,
        };
      }

      if (isForbiddenGateway(body, httpStatus)) {
        return { status: 'wrong-server', detail: FORBIDDEN_DETAIL };
      }

      const obj = asObject(body);
      // 봉투(`{success,...}`)가 없으면 우리 서버가 아니다 (공유기 관리 페이지 등).
      if (!obj || !('success' in obj)) return { status: 'wrong-server' };

      if (httpStatus === 200 && obj.success === true) {
        return {
          status: 'ok',
          detail:
            '정상 응답 — 인증 조회(GET /auth/me)가 200 이므로 JWT 검증과 DB 사용자 조회까지 확인됐습니다.',
        };
      }

      // 여기부터는 "닿았다" 만 참이다. 어떤 이유로 200 을 못 받았는지에 따라 다음 행동이 다르므로 나눠 적는다.
      // **토큰을 안 보낸 401 을 "만료됐을 수 있다" 로 설명하면 안 된다** — 로그인 상태인 사용자에게
      // 재로그인을 시키는 거짓 안내가 되고, 정작 진짜 이유(우리가 안 보냈다)는 숨는다.
      if (auth === 'withheld-no-token') return { status: 'reachable' };
      if (auth === 'withheld-untrusted') {
        return {
          status: 'reachable',
          detail: `서버 프로세스에는 닿았습니다(HTTP ${httpStatus}). 다만 지금 주소는 이 화면에서 직접 입력한 값이라 로그인 토큰을 보내지 않았고, 무인증 GET /auth/me 는 DB 를 거치지 않고 401 을 만들기 때문에 DB(Cloud SQL) 상태는 확인되지 않았습니다. 이 주소가 확실히 우리 서버라면 아래 [이 주소로 로그인 토큰 전송] 을 켜고 다시 확인해 주세요.`,
        };
      }
      return {
        status: 'reachable',
        detail: `서버 프로세스에는 닿았지만 인증 조회가 HTTP ${httpStatus} 로 끝나 DB 경로를 확인하지 못했습니다. 토큰이 만료됐거나(재로그인 필요) DB 조회가 실패한 것입니다 — 저장이 안 된다는 증상이 함께 있다면 Cloud SQL 상태를 먼저 확인해 주세요.`,
      };
    },
    auth,
  );
}

/**
 * `/health` 판정. 계약(`server/ocr/routers/ocr.py` `health()` — 2026-08-05 서버 코드 직접 확인):
 *   200 → {"status":"ok","service":"MORA OCR Service","version":"3.0","ocr":"ok","latency_ms":312,"blocks":2}
 *   503 → {"status":"degraded",…,"ocr":"no-text","error":"OCR selftest found no text","latency_ms":N,"blocks":0}
 *   503 → {"status":"degraded",…,"ocr":"fail","error":"OCR selftest failed"}   ← 추론이 예외로 끝남
 *   503 → {"status":"degraded",…,"ocr":"selftest-error","error":"OCR selftest image could not be built"}
 *   위 넷 모두 캐시 적중 시 `{"cached":true}` 가 추가된다 (성공 30초 / 실패 5초 TTL).
 *
 * **`fail` 과 `selftest-error` 는 서로 다른 사건이다.** 앞의 셋은 추론 경로를 실제로 태운 결과지만
 * `selftest-error` 는 합성 이미지를 만들지 못해 **추론을 시도조차 못 한** 경우다(폰트 누락 등).
 * 운영자가 파야 할 방향이 정반대다 — 전자는 모델·메모리, 후자는 이미지 생성 코드다.
 * 앱 판정은 둘 다 `degraded` 로 묶되 서버 `error` 문자열을 그대로 덧붙여 방향을 잃지 않게 한다.
 *
 * **200 은 언제나 `blocks >= 1` 이다.** 셀프테스트 이미지에는 글자가 그려져 있으므로
 * 검출 0개는 rec 경로가 죽었다는 뜻이고, 서버가 그 경우를 503 `no-text` 로 내린다
 * (`routers/ocr.py` `health()` 의 `probe["blocks"] < 1` 분기).
 * 종전 이 자리의 예시는 `"blocks":0` 이었는데, 그건 **서버가 없앤 거짓 초록불을 계약으로
 * 되살려 적은 것**이다 — 이 파일을 읽고 판정을 고치는 사람이 blocks 를 무의미한 필드로 읽게 된다.
 *
 * `status === 'ok'` 와 `ocr === 'ok'` 를 **둘 다** 봐야 한다. 라우트가 살아 있다는 것과
 * 추론이 된다는 것은 별개이며, 예전 판정이 놓친 게 정확히 뒤쪽이다.
 * (`blocks` 를 앱이 다시 검사하지는 않는다. 서버가 이미 503 으로 내리므로 여기서 한 번 더 세면
 *  판정 기준이 두 곳이 되고, 서버 계약이 바뀔 때 갈라진다. 계약 서술만 정확히 남긴다.)
 *
 * `cached` 도 반드시 읽어 올린다. 안 읽으면 TTL 안에서 재사용된 `latency_ms` 가 화면에서
 * "서버 추론 Nms" 라는 **현재값 표기**로 둔갑한다 — 서버가 일부러 붙여 준 구분 신호를 버리는 셈이다.
 */
function classifyOcrHealth(body: unknown, httpStatus: number): Verdict {
  if (isGatewayFailure(body, httpStatus)) {
    return {
      status: 'degraded',
      detail: `OCR 이 아니라 게이트웨이가 HTTP ${httpStatus} 를 냈습니다 (본문이 JSON 이 아님). 요청 이미지가 커서 인스턴스가 죽었을 수 있습니다 — 서버 로그를 확인해 주세요.`,
    };
  }

  if (isForbiddenGateway(body, httpStatus)) {
    return { status: 'wrong-server', detail: FORBIDDEN_DETAIL };
  }

  const obj = asObject(body);
  const service = obj?.service;
  if (typeof service !== 'string' || !service.includes('MORA OCR')) {
    return { status: 'wrong-server' };
  }

  const serverLatencyMs = typeof obj?.latency_ms === 'number' ? obj.latency_ms : null;
  const serverLatencyCached = obj?.cached === true;
  if (obj?.status === 'ok' && obj?.ocr === 'ok') {
    return { status: 'ok', serverLatencyMs, serverLatencyCached };
  }

  // 서버가 스스로 실패를 자백한 경우다. error 문구가 있으면 그대로 얹는다 — 이게 서버 로그를 여는 첫 단서다.
  const reason = typeof obj?.error === 'string' ? obj.error : null;
  return {
    status: 'degraded',
    detail: reason ? `${MESSAGE.degraded} (서버 응답: ${reason})` : MESSAGE.degraded,
    serverLatencyMs,
    serverLatencyCached,
  };
}

/** 구버전 폴백용 `GET /` 판정. 여기서 통과해도 **추론 상태는 확인되지 않았다**. */
function classifyOcrRoot(body: unknown, httpStatus: number): Verdict {
  if (isGatewayFailure(body, httpStatus)) {
    return {
      status: 'degraded',
      detail: `OCR 이 아니라 게이트웨이가 HTTP ${httpStatus} 를 냈습니다 (본문이 JSON 이 아님). 인스턴스가 죽은 상태입니다 — 서버 로그를 확인해 주세요.`,
    };
  }
  if (isForbiddenGateway(body, httpStatus)) {
    return { status: 'wrong-server', detail: FORBIDDEN_DETAIL };
  }
  const service = asObject(body)?.service;
  const isMora = typeof service === 'string' && service.includes('MORA OCR');
  return { status: isMora ? 'stale-server' : 'wrong-server' };
}

/**
 * OCR 프로브. `/health` 를 먼저 치고, **404 일 때만** 구버전 폴백으로 `GET /` 를 친다.
 *
 * 폴백 성공을 'ok' 로 칠하지 않는 게 핵심이다. 그건 "라우트는 살아 있다" 까지밖에 못 말하고,
 * 그 착각이 이번 장애를 몇 시간 늘렸다. 배포 전/후를 사용자가 구분할 수 있어야 하므로
 * 별도 상태값 'stale-server' 로 남긴다.
 */
export async function probeOcr(): Promise<ProbeResult> {
  const base = getOcrBaseUrl();
  const source = getOcrUrlSource();
  const healthUrl = `${base}/health`;
  if (isMockEnabled()) return mockProbe('ocr', healthUrl, source);

  const health = await probe('ocr', healthUrl, source, classifyOcrHealth);
  if (health.httpStatus !== 404) return health;

  return probe('ocr', `${base}/`, source, classifyOcrRoot);
}

/**
 * 두 서버를 동시에 찍는다. 한쪽 실패가 다른 쪽 결과를 가리지 않도록 병렬로 돌린다.
 * `allowOverrideAuth` 는 Spring 프로브에만 전달된다 — OCR 은 어떤 경우에도 토큰을 보내지 않는다
 * (`/health` 는 무인증 엔드포인트이고, 보낼 이유가 없는 곳에 보내면 그것도 유출이다).
 */
export function probeAll(options?: { allowOverrideAuth?: boolean }): Promise<ProbeResult[]> {
  return Promise.all([probeSpring(options), probeOcr()]);
}
