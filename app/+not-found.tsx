// app/+not-found.tsx
//
// 알 수 없는 딥링크 착지점 — Navigation Map §1 · §5 공통 처리 규칙 3
// ("알 수 없는 URL → +not-found → `홈으로` 버튼").
//
// 루트 Stack 은 `headerShown:false` 라 되돌아갈 헤더가 없다. 유일한 출구인 `홈으로` 는
// `push` 가 아니라 `replace` 다 — 존재하지 않는 경로를 백스택에 남기면 뒤로가기로 다시 여기 온다.
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoraLogo } from '@/components/brand/MoraLogo';
import { EmptyState } from '@/components/ui';

export default function NotFoundScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      className="flex-1 items-center justify-center bg-bg-base px-4"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <MoraLogo variant="mark" size={64} />

      <EmptyState
        title="페이지를 찾을 수 없어요"
        description="주소가 바뀌었거나 사라진 화면이에요."
        actionLabel="홈으로"
        onAction={() => router.replace('/(tabs)')}
      />
    </View>
  );
}
