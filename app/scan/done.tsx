// app/scan/done.tsx — SCR-13 · 저장 완료
//
// 정본: wiki/design/Screen Specs.md SCR-13 (와이어프레임 · 서브텍스트 규칙 · 상태표 · 인터랙션표)
//       wiki/tech/Camera and Scan.md §12 (연속 스캔 루프 — 카메라로 직행한다. 탭 루트로 돌아가지 않는다)
//
// 버튼 3분기는 Screen Specs 문구를 그대로 쓴다: `저장한 문서 보기` · `계속 스캔하기` · `완료`.
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { BackHandler, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Button } from '@/components/ui';
import { TYPE_LABELS, useScan, type DocumentType } from '@/features/scan';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

/**
 * 보관함 허브 / 탭 루트 경로.
 *
 * 두 라우트는 다른 담당(셸·보관함)이 만든다. 타입 생성 시점에 아직 없을 수 있어
 * `Href` 로 좁혀 둔다 — 값 자체는 Navigation Map §1 의 확정 경로다.
 */
const ARCHIVE_HREF = '/(tabs)/archive' as Href;
const HOME_HREF = '/(tabs)' as Href;

/** 문서 4종 → 배경 토큰(체크 원). ETC 는 이 화면에 도달할 수 없다(CLS-04). */
const DOC_TONE_CLASS: Record<DocumentType, string> = {
  BUSINESS_CARD: 'bg-card',
  TICKET: 'bg-ticket',
  POSTER: 'bg-poster',
  RECEIPT: 'bg-receipt',
  ETC: 'bg-action',
};

function CheckIcon({ color, size = 28 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5L10 17.5L19 7.5"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function ScanDoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const reduceMotion = useReducedMotion();

  const { docType, values, saveWarning, imageMissing, resetForNextScan } = useScan();

  const scale = useSharedValue(reduceMotion ? 1 : 0.6);

  /* 진입 시 체크 애니메이션 + Success 햅틱 */
  useEffect(() => {
    haptics.success();
    if (reduceMotion) return;
    scale.value = withSpring(1, { damping: 12, stiffness: 180 });
  }, [reduceMotion, scale]);

  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  /**
   * 서브텍스트 규칙(원본 이식):
   * `{TYPE_LABELS[type]} · {비어있지 않은 값 상위 2개를 ' · ' 로 join}`.
   * 값이 하나도 없으면 유형 라벨만 남는다.
   */
  const subtitle = useMemo(() => {
    const filled = Object.values(values)
      .map((v) => v.trim())
      .filter((v) => v !== '')
      .slice(0, 2);
    return [TYPE_LABELS[docType], ...filled].join(' · ');
  }, [docType, values]);

  const goHome = useCallback(() => {
    router.replace(HOME_HREF);
  }, [router]);

  const goArchive = useCallback(() => {
    router.replace(ARCHIVE_HREF);
  }, [router]);

  const scanAgain = useCallback(() => {
    haptics.impact('light');
    // §12 연속 스캔 — 세션 카운터만 남기고 초기화한 뒤 카메라로 직행한다.
    resetForNextScan();
    router.replace('/scan');
  }, [resetForNextScan, router]);

  /* Android 백 = `완료` (Screen Specs 인터랙션 표) */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, [goHome]);

  // 부분 성공(임베딩 실패)의 서버 `message` 는 §11-2 가 지정한 유일한 원문 노출 지점이다.
  const warningText = saveWarning ?? (imageMissing ? '이미지 없이 정보만 저장되었습니다.' : null);

  return (
    <View
      className="flex-1 bg-bg-base px-6"
      style={{ paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }}
    >
      <View className="flex-1 items-center justify-center">
        <Animated.View
          style={checkStyle}
          className={`h-14 w-14 items-center justify-center rounded-full ${DOC_TONE_CLASS[docType]}`}
        >
          <CheckIcon color={t.text.inverse} />
        </Animated.View>

        <Text className="mt-4 text-center text-h2 font-w700 text-text-primary">저장되었습니다</Text>
        <Text className="mt-2 text-center text-body-sm text-text-muted">{subtitle}</Text>

        {warningText ? (
          <View
            className="mt-5 w-full border border-warn-border bg-warn-container px-4 py-3"
            style={{ borderRadius: radius.button }}
            accessible
            accessibilityLabel={`경고. ${warningText}`}
          >
            <Text className="text-body-sm text-warn">{warningText}</Text>
          </View>
        ) : null}
      </View>

      <View className="w-full items-center gap-3">
        <Button label="저장한 문서 보기" onPress={goArchive} variant="primary" size="lg" fullWidth />
        <Button
          label="계속 스캔하기"
          onPress={scanAgain}
          variant="secondary"
          size="lg"
          fullWidth
          haptic="none"
        />
        <Button label="완료" onPress={goHome} variant="ghost" size="md" haptic="selection" />
      </View>
    </View>
  );
}
