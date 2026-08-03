// app/+not-found.tsx
//
// 알 수 없는 딥링크 착지점 — Navigation Map §1 · §5 공통 처리 규칙 3
// ("알 수 없는 URL → +not-found → `홈으로` 버튼").
//
// 루트 Stack 은 `headerShown:false` 라 되돌아갈 헤더가 없다. 유일한 출구인 `홈으로` 는
// `push` 가 아니라 `replace` 다 — 존재하지 않는 경로를 백스택에 남기면 뒤로가기로 다시 여기 온다.
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';

export default function NotFoundScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      className="flex-1 items-center justify-center bg-bg-base px-4"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      {/* 피그마 개정: 아이콘 영역 삭제. CMP-14 EmptyState 는 아이콘 미지정이어도 64dp 중립
          프레임(`h-16 w-16 rounded-xl border`)을 항상 그리므로 이 화면에서는 쓰지 않는다.
          EmptyState 를 조건부로 바꾸면 빈 상태 7곳이 전부 같이 바뀐다 — 여기만 인라인으로 푼다.
          타이포·간격 토큰은 EmptyState 와 동일한 값을 그대로 옮겼다. */}
      <View
        className="w-full items-center px-6"
        accessible
        accessibilityLabel="페이지를 찾을 수 없어요. 주소가 바뀌었거나 사라진 화면이에요."
      >
        <Text className="text-center text-h3 font-w700 text-text-primary">
          페이지를 찾을 수 없어요
        </Text>
        <Text className="mt-2 text-center text-body-sm text-text-muted">
          주소가 바뀌었거나 사라진 화면이에요.
        </Text>

        <View className="mt-5">
          <Button
            label="홈으로"
            onPress={() => router.replace('/(tabs)')}
            variant="primary"
            size="md"
          />
        </View>
      </View>
    </View>
  );
}
