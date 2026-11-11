// app/scan/_layout.tsx
//
// 스캔 위저드 스택 (SCR-09 → SCR-10 → SCR-11 → SCR-12 → SCR-13).
//
// 정본: wiki/design/Screen Specs.md `스캔 파이프라인 개요` + 각 화면의 `라우트` 행
//       (다섯 화면 모두 `presentation: 'fullScreenModal'`)
//       wiki/design/Navigation Map.md §3 — `/scan` 은 탭 밖 라우트라 탭바가 자동으로 사라진다.
//
// 이 레이아웃의 두 가지 책임
//  1) 스택 옵션: 헤더 없음 + fullScreenModal + 진행/완료 화면의 스와이프 백 차단
//  2) 세션 수명: 스캔 흐름을 완전히 벗어나면(= 이 레이아웃 언마운트) `scanStore.reset()`.
//     스토어가 영속되지 않으므로(scanStore 주석) 남겨두면 다음 진입에 이전 결과가 비친다.
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { useScanStore } from '@/features/scan';
import { haptics } from '@/lib/haptics';

/**
 * 화면을 떠나면 사라질 "작성 중인 데이터"가 있는지.
 *
 * 촬영본만 있는 상태(=아직 아무것도 입력하지 않음)는 확인 없이 버려도 되므로 제외하고,
 * OCR 결과가 도착했거나(scan) 사용자가 값을 손댄 경우(values)만 dirty 로 본다.
 */
export function hasScanDraft(): boolean {
  const state = useScanStore.getState();
  if (state.step === 'done') return false; // SCR-13 은 이미 저장이 끝난 상태다
  if (state.scan) return true;
  return Object.values(state.values).some((v) => v.trim() !== '');
}

/**
 * SCR-12 `이탈 확인 다이얼로그` (Screen Specs 원문).
 * 제목 `저장하지 않고 나갈까요?` / 본문 `입력한 내용이 사라집니다.` / `나가기`(destructive) · `계속 작성`
 *
 * 작성 중인 데이터가 없으면 묻지 않고 즉시 `onLeave()` 를 호출한다.
 */
export function confirmDiscardScan(onLeave: () => void): void {
  if (!hasScanDraft()) {
    onLeave();
    return;
  }
  haptics.warning(); // Screen Specs G-6 — 파괴적 확인 다이얼로그는 Warning 을 동반한다
  Alert.alert('저장하지 않고 나갈까요?', '입력한 내용이 사라집니다.', [
    { text: '계속 작성', style: 'cancel' },
    { text: '나가기', style: 'destructive', onPress: onLeave },
  ]);
}

export default function ScanLayout() {
  // 스캔 스택 전체가 사라질 때만 세션을 비운다. 화면 간 이동에서는 실행되지 않는다.
  useEffect(
    () => () => {
      useScanStore.getState().reset();
    },
    [],
  );

  return (
    <Stack
      screenOptions={{
        headerShown: false, // 화면별 커스텀 헤더 (UX-05)
        presentation: 'fullScreenModal',
        // 스캔 화면들은 자체 배경(카메라=검정 / 결과=테마 배경)을 그린다.
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      {/* SCR-09 카메라 */}
      <Stack.Screen name="index" />
      {/* SCR-10 크롭/보정 */}
      <Stack.Screen name="crop" />
      {/* SCR-11 분석 진행 — 백 제스처 비활성 (Screen Specs 라우트 행) */}
      <Stack.Screen name="analyzing" options={{ gestureEnabled: false }} />
      {/* SCR-12 결과 확인/편집 — 값 변경 시 확인 다이얼로그는 화면이 직접 건다 */}
      <Stack.Screen name="review" />
      {/* SCR-13 저장 완료 — 백 차단 */}
      <Stack.Screen name="done" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
