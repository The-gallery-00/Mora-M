/**
 * 목 계층 배럴.
 *
 * **주입 지점 3곳은 이 배럴을 쓰지 않고 서브모듈을 직접 import 한다** — 목이 꺼져 있을 때
 * 배럴 하나 때문에 씨드·챗봇·스캔 샘플 모듈까지 전부 끌려 들어오는 것을 피하기 위해서다.
 *
 * | 주입 지점                    | import                                        |
 * | ---------------------------- | --------------------------------------------- |
 * | `services/http.ts`           | `@/mocks/config` · `@/mocks/handlers`         |
 * | `features/scan/api.ts`       | `@/mocks/config` · `@/mocks/scan`             |
 * | `services/health.ts`         | `@/mocks/config` · `@/mocks/health`           |
 *
 * 이 파일은 **목 계층의 전체 표면을 한눈에 보기 위한 목록**이자 개발 화면(`app/(dev)/mock.tsx`)·
 * 테스트용 진입점이다. **제품 화면 코드가 이 모듈을 import 하면 안 된다** — 목은 네트워크
 * 계층에서만 갈아끼운다.
 */

// 플래그 — 모든 주입 지점의 유일한 판정 함수.
export {
  clearMockOverride,
  hasMockOverride,
  isMockBuild,
  isMockEnabled,
  setMockEnabled,
} from './config';

// 라우터 — `request()` 가 부르는 것은 사실상 `handleMockRequest` 하나다.
export {
  handleMockRequest,
  isMockedPath,
  MOCK_MAX_DELAY_MS,
  MOCK_MIN_DELAY_MS,
  MOCK_ROUTE_TABLE,
  type MockMethod,
  type MockRequestOptions,
  type MockResponse,
} from './handlers';

// 저장소.
export {
  invalidateDbCache,
  MOCK_DB_KEY,
  paginate,
  readDb,
  resetDb,
  type FlatPage,
} from './db';

export { answerChat, CHAT_NOT_FOUND, type MockChatDocType, type MockChatResult } from './chat';

// 스캔·커밋 — `request()` 로 갈 수 없어 `features/scan/api.ts` 가 직접 가로챈다.
export {
  mockCommitDocument,
  mockScanImage,
  peekMockScanPlan,
  resetMockScanCycle,
  type MockScanPlan,
  type MockUploadOptions,
} from './scan';

// 진단 화면 프로브.
export { mockProbe, MOCK_PROBE_DETAIL } from './health';

export {
  createSeed,
  localDate,
  localDateTime,
  todayDate,
  type MockCard,
  type MockCardGroup,
  type MockData,
  type MockNotification,
  type MockPoster,
  type MockReceipt,
  type MockSearchHistory,
  type MockTicket,
  type MockUser,
} from './fixtures';
