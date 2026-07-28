// src/features/network/index.ts
//
// 오프라인 · 네트워크 견고성 계층 (FR-101 · FR-102).
//
//   status.ts       — NetInfo 단일 구독 + 전역 연결 상태 + 오프라인 문구/에러
//   queryBridge.ts  — onlineManager ↔ NetInfo, focusManager ↔ AppState 배선
//   retryPolicy.ts  — GET 지수 백오프 2회 / 변경 요청 무재시도
//   OfflineBanner   — G-5 배너 (헤더 바로 아래 40dp)
export { OfflineBanner, OFFLINE_BANNER_HEIGHT, type OfflineBannerProps } from './OfflineBanner';
export { installQueryNetworkBridge } from './queryBridge';
export { queryRetry, queryRetryDelay, QUERY_RETRY_MAX } from './retryPolicy';
export {
  isOffline,
  NETWORK_COPY,
  offlineError,
  offlineWriteBlock,
  RECONNECT_NOTICE_MS,
  startNetworkWatch,
  useIsOffline,
  useNetworkStatus,
  type ConnectionType,
  type NetworkStatus,
} from './status';
