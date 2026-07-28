// src/features/network/status.ts
//
// 전역 연결 상태 단일 소스 (FR-101 · OFF-01~OFF-08).
//
// 정본: wiki/tech/Networking.md §5-1(판정 규칙) · §5-2(복귀)
//       wiki/tech/Offline and State.md §5(오프라인 정책)
//       wiki/design/Screen Specs.md G-5(배너 문구·높이)
//
// ─────────────────────────── 왜 `isInternetReachable` 을 보지 않는가 ───────────────────────────
//
// [[Networking]] §5-1 이 별표로 못박은 규칙이다: **`isInternetReachable` 로 요청을 막지 않는다.**
// MORA 의 개발/프리뷰 빌드는 개발 PC 의 LAN IP(`http://192.168.x.x:8080`)에 직접 붙으므로
// 공유기에 WAN 이 없어도 API 는 정상 동작한다. 그 상황에서 NetInfo 는
// `isConnected: true, isInternetReachable: false` 를 준다 — 이 값을 오프라인으로 해석하면
// **멀쩡히 동작하는 앱이 통째로 잠긴다.**
//
// [[Offline and State]] §8-1 예시는 `isInternetReachable !== false` 를 쓰지만 그 문단의 논거는
// "`null`(판정 중)을 오프라인으로 오판하지 마라" 하나뿐이고, `false` 를 오프라인으로 보는 부분에
// 대한 근거는 없다. LAN 직결이 기본 프로파일인 이 앱에서는 [[Networking]] 쪽이 맞다.
// → **물리적 미연결(`isConnected === false`)만 오프라인으로 본다.**
//
// 서버가 죽었거나 IP 가 바뀐 경우(= `server-unreachable`)는 연결 상태가 아니라 **요청 실패**로
// 드러나며, 그 안내는 각 화면의 에러 카드와 개발 빌드의 연결 진단 화면이 담당한다.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

import type { AppError } from '@/services/http';

// ───────────────────────────────────────────────────────────── 문구

/**
 * 오프라인 관련 사용자 문구. **여기서 새로 짓지 않는다** — 전부 위키 원문이다.
 *  - `banner`        : Screen Specs G-5 (전 화면 공통 40dp 배너). SCR-08/15~18 의 "공통 문구"가 이것이다
 *  - `restored`      : Offline and State OFF-07 (복귀 후 1.5초 노출)
 *  - `writeBlocked`  : Offline and State OFF-05 (쓰기 버튼 차단 토스트 — 저장 경로 기본값)
 *  - `editBlocked`   : Screen Specs SCR-20 오프라인 행 (수정·삭제 차단)
 *  - `refreshBlocked`: Offline and State OFF-03 (pull-to-refresh 토스트)
 */
export const NETWORK_COPY = {
  banner: '오프라인입니다. 네트워크 연결을 확인해 주세요.',
  restored: '연결됨',
  writeBlocked: '오프라인 상태에서는 저장할 수 없습니다.',
  editBlocked: '오프라인입니다. 수정·삭제는 연결 후 가능합니다.',
  refreshBlocked: '오프라인 상태입니다.',
} as const;

// ───────────────────────────────────────────────────────────── 상태 모델

/** NetInfo 원문 `type` 을 앱이 쓰는 좁은 유니온으로 정규화한 값. 진단 화면이 `wifi` 를 본다. */
export type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none' | 'unknown';

export type NetworkStatus = {
  /** 물리적 연결 여부. NetInfo `isConnected` 가 `null`(판정 중)이면 **연결된 것으로 본다.** */
  isConnected: boolean;
  type: ConnectionType;
  /** 오프라인 → 온라인 복귀 직후 1.5초 동안만 true (OFF-07 `연결됨` 배너). */
  justReconnected: boolean;
};

/** OFF-07 — 복귀 배너 노출 시간. */
export const RECONNECT_NOTICE_MS = 1_500;

function toConnectionType(raw: string): ConnectionType {
  switch (raw) {
    case 'wifi':
    case 'cellular':
    case 'ethernet':
    case 'none':
      return raw;
    case 'unknown':
      return 'unknown';
    default:
      return 'other';
  }
}

/**
 * 초기값은 **온라인**이다. NetInfo 첫 콜백이 오기 전(부팅 1~2프레임)에 오프라인으로 두면
 * 배너가 한 번 번쩍이고 쓰기 버튼이 잠깐 잠긴다 — 실제 상태를 모르는 구간에서는 막지 않는다.
 */
let snapshot: NetworkStatus = { isConnected: true, type: 'unknown', justReconnected: false };

const listeners = new Set<() => void>();
let netInfoSubscription: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

/** 값이 실제로 바뀔 때만 스냅샷 객체를 새로 만든다 — `useSyncExternalStore` 는 참조로 비교한다. */
function commit(next: NetworkStatus): void {
  if (
    next.isConnected === snapshot.isConnected &&
    next.type === snapshot.type &&
    next.justReconnected === snapshot.justReconnected
  ) {
    return;
  }
  snapshot = next;
  emit();
}

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function handleNetInfo(state: NetInfoState): void {
  const type = toConnectionType(String(state.type));
  const isConnected = state.isConnected !== false; // null(판정 중)은 연결로 본다
  const wasOffline = !snapshot.isConnected;

  if (!isConnected) {
    clearReconnectTimer();
    commit({ isConnected: false, type, justReconnected: false });
    return;
  }

  if (!wasOffline) {
    commit({ ...snapshot, isConnected: true, type });
    return;
  }

  // 오프라인 → 온라인 복귀 (OFF-07)
  clearReconnectTimer();
  commit({ isConnected: true, type, justReconnected: true });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    commit({ ...snapshot, justReconnected: false });
  }, RECONNECT_NOTICE_MS);
}

/**
 * NetInfo 구독을 시작한다. **여러 번 불러도 안전하다**(구독은 앱 전체에 1개).
 * 앱 부팅 시 `installQueryNetworkBridge()` 가 부르고, 그보다 먼저 컴포넌트가 뜨는 경우를 위해
 * `subscribe()` 도 부른다. 구독 자체는 앱 수명과 같아 해제하지 않는다.
 */
export function startNetworkWatch(): void {
  if (netInfoSubscription !== null) return;
  netInfoSubscription = NetInfo.addEventListener(handleNetInfo);
}

function subscribe(listener: () => void): () => void {
  startNetworkWatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): NetworkStatus => snapshot;

// ───────────────────────────────────────────────────────────── 훅

/** 전역 연결 상태. 구독은 모듈 전체에 1개이므로 몇 군데서 불러도 리스너가 늘지 않는다. */
export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 화면이 쓰기 버튼을 `disabled` 로 만들 때 쓰는 값 (OFF-05). */
export function useIsOffline(): boolean {
  return !useNetworkStatus().isConnected;
}

// ───────────────────────────────────────────────────────────── 명령형 API

/**
 * 훅 밖(뮤테이션 `mutationFn`, 이벤트 핸들러)에서 읽는 현재 상태.
 * 구독 전이라면 초기값(온라인)을 돌려준다 — **모르는 상태에서 사용자를 막지 않는다.**
 */
export function isOffline(): boolean {
  return !snapshot.isConnected;
}

/**
 * 오프라인일 때 뮤테이션을 **시도 전에** 실패시키기 위한 에러.
 *
 * 큐잉하지 않는다 (Offline and State §5-2) — 저장이 2단계 비원자 트랜잭션이고 서버에 멱등키가
 * 없어서, 재접속 시 재생하면 이미지·NER 라벨·문서가 그대로 중복 생성된다.
 */
export function offlineError(message: string = NETWORK_COPY.writeBlocked): AppError {
  return { kind: 'offline', status: null, message };
}

/** 오프라인이면 즉시 던질 에러를, 온라인이면 `null` 을 준다. 뮤테이션 첫 줄에서 쓴다. */
export function offlineWriteBlock(message?: string): AppError | null {
  return isOffline() ? offlineError(message) : null;
}
