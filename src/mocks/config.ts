import { storage } from '@/store/storage';

/**
 * 목(mock) 모드 플래그.
 *
 * 서버(Spring·OCR·LLM·Postgres) 없이 앱만 켜서 전 화면을 돌려보기 위한 스위치다.
 * **실서버 모드가 기본**이고, 이 플래그가 켜졌을 때만 네트워크 계층이 목 응답으로 갈아끼워진다.
 * 플래그가 꺼져 있으면 앱 동작은 100% 그대로다.
 *
 * 우선순위:
 *   1. MMKV 런타임 토글 (`mock.enabled`) — 개발 화면 `app/(dev)/mock.tsx` 에서 켠다.
 *      값이 존재하면 빌드 플래그보다 **항상 우선**한다 (끄기도 가능해야 하므로).
 *   2. 빌드 타임 `EXPO_PUBLIC_MOCK=1` — `.env` 로 목 전용 빌드를 만들 때 쓴다.
 *   3. 둘 다 없으면 실서버 모드.
 *
 * MMKV 키는 `StorageKey`(앱 상태 키 목록)에 넣지 않는다 — 개발 전용 스위치라
 * 제품 상태 키와 섞이면 안 된다. 이름 충돌을 피하려고 `mock.` 접두사를 쓴다.
 */

/** 런타임 토글 저장 키. 이 파일 밖에서 직접 읽지 마라. */
const MOCK_ENABLED_STORAGE_KEY = 'mock.enabled';

/** 빌드 시 `EXPO_PUBLIC_MOCK=1` 로 주입됐는지. 런타임 토글과 무관한 순수 빌드 정보다. */
export function isMockBuild(): boolean {
  return process.env.EXPO_PUBLIC_MOCK === '1';
}

/**
 * 지금 목 모드인지. **모든 목 주입 지점의 유일한 판정 함수다.**
 *
 * 동기 함수이고 MMKV 읽기는 메모리 캐시라 요청마다 불러도 비용이 없다.
 */
export function isMockEnabled(): boolean {
  const override = storage.getBoolean(MOCK_ENABLED_STORAGE_KEY);
  return override ?? isMockBuild();
}

/**
 * 런타임 토글을 저장한다.
 *
 * ⚠️ **바꾼 뒤에는 앱을 완전히 종료했다가 다시 실행해야 한다.**
 * React Query 캐시(gcTime 30분)에 실서버/목 응답이 이미 들어 있어서, 토글만 뒤집으면
 * 화면이 이전 모드의 데이터를 그대로 보여 준다. 목 DB 는 모듈 스코프 상태라
 * 재시작 시점에 씨드부터 다시 만들어진다.
 */
export function setMockEnabled(enabled: boolean): void {
  storage.set(MOCK_ENABLED_STORAGE_KEY, enabled);
}

/** 런타임 토글이 저장돼 있는지 (없으면 빌드 플래그를 따른다). 진단 표시용. */
export function hasMockOverride(): boolean {
  return storage.contains(MOCK_ENABLED_STORAGE_KEY);
}

/**
 * 런타임 토글을 지우고 빌드 플래그 기본값으로 되돌린다.
 * `setMockEnabled` 와 같은 이유로 앱 재시작이 필요하다.
 */
export function clearMockOverride(): void {
  storage.remove(MOCK_ENABLED_STORAGE_KEY);
}
