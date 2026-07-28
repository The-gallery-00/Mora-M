// app/(auth)/_layout.tsx — 미인증 전용 스택
//
// 역방향 인증 가드. 토큰이 있는 상태로 이 그룹에 들어오면 곧바로 (tabs) 로 되돌린다
// (Navigation Map §6-3). 가드는 **`(tabs)/_layout` 과 이 파일 두 곳에만** 둔다 —
// 개별 화면에 중복 가드를 넣지 않는다(원본도 `dashboard/layout.tsx` 한 곳에서만 걸었다).
//
// `booting` 에서 null 을 그리는 이유: 그 구간은 아직 스플래시가 떠 있고, 여기서 화면을 그리면
// 판정 전 로그인 화면이 한 프레임 노출된다.
//
// **예외**: 세션이 선 뒤에도 잠깐 더 머물러야 하는 두 구간(SCR-04 닉네임 단계 · SCR-05 콜백 처리)은
// `authFlow` 홀드가 켜져 있는 동안 리다이렉트를 유예한다. 그 사유와 카운터 설계는 그 파일에 있다.
//
// 프레젠테이션은 `card` + `headerShown:false` (Navigation Map §8). 화면마다 자체 헤더가 없고
// 로고 블록이 헤더 역할을 한다.
import { Redirect, Stack } from 'expo-router';

import { useAuthFlowStore } from '@/features/auth/authFlow';
import { useAuthStore } from '@/store/authStore';

export default function AuthLayout() {
  const status = useAuthStore((s) => s.status);
  const holds = useAuthFlowStore((s) => s.holds);

  if (status === 'booting') return null;
  if (status === 'authenticated' && holds === 0) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // MOT-01 — 화면 전환은 네이티브 기본값. 커스텀하면 스와이프-백과 어긋난다.
        animation: 'default',
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      {/* 콜백은 되돌아갈 대상이 아니다 — 제스처로 빠져나오면 토큰 처리 중간에 화면이 사라진다. */}
      <Stack.Screen name="callback" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
