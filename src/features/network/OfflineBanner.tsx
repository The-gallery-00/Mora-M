// src/features/network/OfflineBanner.tsx
//
// G-5 전역 오프라인 배너 (FR-101 · OFF-02 / OFF-07).
//
// 정본: wiki/design/Screen Specs.md G-5 — "오프라인이면 화면 최상단에 40dp 배너
//       `오프라인입니다. 네트워크 연결을 확인해 주세요.` (`bg-warn-soft`/`text-warn`)"
//       wiki/design/Mobile UX Guide.md §7 — "헤더 바로 아래 고정, 연결까지, 자동 재시도"
//       wiki/tech/Offline and State.md OFF-07 — 복귀 시 `연결됨` 1.5초 후 사라짐
//
// ── 왜 오버레이가 아니라 흐름(in-flow) 컴포넌트인가 ───────────────────────────────
// 루트에 `position: absolute` 로 띄우면 화면마다 다른 56dp 커스텀 헤더를 덮어 **뒤로가기
// 버튼이 가려진다.** 오프라인은 몇 분씩 이어지는 상태라 그 사이 내비게이션이 막히는 것은
// 배너의 이득보다 크게 나쁘다. 그래서 헤더 바로 아래에 끼워 넣어 콘텐츠를 40dp 밀어낸다
// (Mobile UX Guide §7 의 "헤더 바로 아래 고정"과 같은 배치).
//
// `bg-warn-soft` 는 tailwind.config.js 에 없는 이름이고, 같은 역할의 실존 토큰이
// `warn.container`(라이트 `#FFFBEB` / 다크 `#2E2308`)다 — Design Tokens §660 이 이 토큰을
// "경고·안내 박스 텍스트, 오프라인 배너"로 지정한다.
import { Text, View } from 'react-native';

import { NETWORK_COPY, useNetworkStatus } from './status';

/** G-5 배너 높이(dp). 레이아웃 계산이 필요한 화면이 참조한다. */
export const OFFLINE_BANNER_HEIGHT = 40;

export interface OfflineBannerProps {
  testID?: string;
}

/**
 * 오프라인이면 경고색 배너를, 복귀 직후 1.5초 동안은 성공색 `연결됨` 을 보여 준다.
 * 그 외에는 **아무것도 렌더하지 않는다**(높이 0) — 온라인이 압도적 다수인 상태다.
 *
 * 재시도 버튼을 두지 않는다: `onlineManager` 가 연결 복구를 감지해 활성 쿼리를 자동 재개하므로
 * 사용자가 누를 것이 없다 (Mobile UX Guide §7 "액션: 없음 (자동 재시도)").
 */
export function OfflineBanner({ testID = 'offline-banner' }: OfflineBannerProps) {
  const { isConnected, justReconnected } = useNetworkStatus();

  if (isConnected && !justReconnected) return null;

  const offline = !isConnected;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={`h-10 flex-row items-center justify-center border-b px-4 ${
        offline ? 'border-warn-border bg-warn-container' : 'border-success-container bg-success-container'
      }`}
    >
      <Text
        className={`text-body-sm font-w600 ${offline ? 'text-warn' : 'text-success-text'}`}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {offline ? NETWORK_COPY.banner : NETWORK_COPY.restored}
      </Text>
    </View>
  );
}
