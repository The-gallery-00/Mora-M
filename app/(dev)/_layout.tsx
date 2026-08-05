// app/(dev)/_layout.tsx — 개발 전용 화면 그룹 가드
//
// **왜 이 파일이 생겼나 (2026-08-05).**
// `(dev)` 그룹에는 진단(SCR-31)·파이프라인·목 모드 화면이 있고, 그중 진단 화면은
// 임의의 호스트를 **MMKV 에 영구 저장**한다(`config/env.ts` `setServerOverride`).
// 한 번 저장되면 그 뒤 모든 요청이 그 주소로 나간다.
//
// 진입점은 원래 전부 `variant !== 'production'` 뒤에 숨어 있었지만, 실제로는 두 곳이 새 있었다:
//   · `app/(tabs)/settings/index.tsx` `tapVersion` — 버전 라벨 연속 탭(이스터에그).
//   · `app/scan/analyzing.tsx` SCF-06/SCF-09 의 `서버 주소 확인` 액션.
//     **일반 사용자에게 가장 흔한 실패 경로**다.
// 즉 스토어 빌드 사용자가 스캔 한 번 실패시키면 서버 주소 입력창에 도달할 수 있었다.
// (둘 다 지금은 각 파일에서 production 게이트를 달아 진입점 자체가 렌더되지 않는다 — 아래 2차 수정.)
//
// 화면마다 가드를 흩뿌리면 다음에 추가되는 (dev) 화면이 또 빠진다. 그래서 **그룹 레이아웃 한 곳**에
// 건다 — `(auth)/_layout.tsx` · `(tabs)/_layout.tsx` 가 인증 가드를 두는 방식과 같은 패턴이고,
// 그쪽 주석이 "가드는 레이아웃에만 둔다" 를 이미 규칙으로 못 박아 두었다.
//
// 판정 기준은 `variant`(`config/env.ts` → `app.config.js` 의 `extra.variant`)다. `__DEV__` 가
// 아니다 — 릴리스로 빌드한 preview APK 는 `__DEV__ === false` 지만 팀 내부 테스트용이라
// 진단 화면이 **있어야** 한다. 막아야 하는 것은 스토어에 올라가는 production 프로파일뿐이다.
//
// ⚠️ 2026-08-05 2차 수정 — **이 가드는 "심층 방어" 로만 쓴다.**
// 화면 안에서 되돌려 보내는 것은 이미 벌어진 이동을 되감는 일이라 대가가 있다:
// `Redirect` 는 `router.replace` 라서 **현재 스택 엔트리를 지운다.** `/scan` 모달 스택에서
// 넘어온 경우 그 스택이 통째로 사라지고 압축이 끝난 이미지·실패 상태·재시도 카운트가 날아간다.
// 그래서 (1) 진입점 쪽에서 애초에 렌더하지 않는 것이 1차 방어이고
//        (`app/scan/analyzing.tsx` `DIAGNOSTICS_AVAILABLE`,
//         `app/(tabs)/settings/index.tsx` `tapVersion`),
//     (2) 여기서는 딥링크(`mora://(dev)/diagnostics`) 처럼 우리가 모르는 경로만 받아 낸다.
// 그리고 받아 낼 때도 **되돌아갈 곳이 있으면 replace 가 아니라 back** 으로 물러난다 —
// 그래야 밑에 깔린 스택이 그대로 남는다. 되돌아갈 곳이 없을 때(딥링크 콜드스타트)만
// `/(tabs)` 로 replace 한다. 미인증 상태라면 `(tabs)/_layout` 가 다시 로그인으로 넘긴다.
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { variant } from '@/config/env';

/**
 * production 에서 `(dev)` 로 들어온 요청을 **스택을 부수지 않고** 되돌린다.
 *
 * `useFocusEffect` 를 쓰는 이유는 expo-router 의 `Redirect` 와 같다 — 마운트가 아니라
 * 포커스 시점에 이동해야 내비게이션 상태가 준비된 뒤에 실행된다.
 * 화면은 아무것도 그리지 않는다(null): "여기 개발자 화면이 있다" 는 사실을 알릴 필요가 없고,
 * 어차피 한 프레임 뒤에 사라진다.
 */
function DevBlocked() {
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(tabs)');
    }, [router]),
  );

  return null;
}

export default function DevLayout() {
  // `variant` 는 모듈 상수라 한 세션 안에서 바뀌지 않는다 → 이 분기로 훅 순서가 흔들리지 않는다.
  if (variant === 'production') return <DevBlocked />;

  // 루트 스택이 `headerShown: false` 이므로 중첩 스택도 같은 값을 명시한다.
  // 빠뜨리면 (dev) 화면에만 헤더가 하나 더 생긴다. 전환은 MOT-01 기본값.
  return <Stack screenOptions={{ headerShown: false, animation: 'default' }} />;
}
