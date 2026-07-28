import type { ProbeResult } from '@/services/health';

/**
 * 헬스 프로브 목 (SCR-31 진단 화면 · FR-121/FR-122).
 *
 * 목 모드에서는 두 서버(Spring `:8080` / OCR `:8000`) 중 **아무것도 뜨지 않은 상태가 정상**이다.
 * 그런데 진단 화면이 빨간 `실패` 카드 두 장을 그리면 팀원이 "환경이 깨졌다"고 오해한다.
 * 그래서 목 모드에서는 `ok` 로 응답하되, **detail 문구로 실서버 정상과 반드시 구분한다** —
 * 여기서 "정상 응답" 이라고만 쓰면 진짜 서버가 붙은 것과 구별할 수 없다.
 *
 * `ProbeResult` 는 타입만 가져온다(`import type`). 값을 가져오면
 * `services/health.ts` ↔ 이 파일이 런타임 순환 import 가 된다.
 */

/** 실서버 문구(`정상 응답`)와 절대 겹치지 않게 쓴다. 진단 카드 본문에 그대로 노출된다. */
export const MOCK_PROBE_DETAIL = '목 모드 — 서버에 연결하지 않고 앱 내부 목 응답을 씁니다.';

/** 프로브 왕복을 흉내 내는 지연. 스피너가 한 프레임이라도 보이도록 최소한만 준다. */
const MOCK_PROBE_DELAY_MS = 220;

/** 실측 왕복이 아니므로 고정값이다. LAN 실측(수 ms)과 헷갈리지 않게 일부러 작게 둔다. */
const MOCK_LATENCY_MS = 3;

/**
 * 목 프로브 1건. 실제 소켓을 열지 않는다.
 *
 * `url` 은 호출부(`services/health.ts`)가 계산한 **실제 대상 주소**를 그대로 받는다 —
 * 목 모드라도 사용자가 어떤 주소를 보고 있는지는 화면에 남아야 진단에 쓸모가 있다.
 */
export function mockProbe(target: ProbeResult['target'], url: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        target,
        url,
        status: 'ok',
        httpStatus: 200,
        latencyMs: MOCK_LATENCY_MS,
        detail: MOCK_PROBE_DETAIL,
      });
    }, MOCK_PROBE_DELAY_MS);
  });
}
