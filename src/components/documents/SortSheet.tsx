// src/components/documents/SortSheet.tsx
//
// CMP-43 SortSheet — Component Library §2 (1-G) 정본. 원본 정렬 `<select>` 를 대체한다(UX-14: 옵션 ≥4 는 시트,
// ≤3 도 헤더 `⇅` 버튼과 짝지어야 하므로 보관함은 전부 시트로 통일).
//
// **선언형 컴포넌트인 이유**: 정본은 `sortSheet(): Promise<T|null>` 명령형 API 지만, 그 형태는
// 루트(`app/_layout.tsx`)에 시트 호스트를 1개 마운트해야 성립한다. 현재 루트에는 `BottomSheetModalProvider`
// 가 없고 루트 파일은 이 작업의 담당 범위 밖이다. 호스트가 생기면 이 컴포넌트를 그 호스트가 감싸
// 명령형 래퍼를 얹으면 되고, props 타입(`SortOption` / `SortSheetOptions`)은 정본 그대로 유지했다.
//
// 그래서 자체적으로 RN `Modal` + `BottomSheet`(비-modal) 조합을 쓴다. `Modal` 안에서 제스처가 살아야 하므로
// 내부에 `GestureHandlerRootView` 를 한 겹 더 둔다 — RNGH 의 공식 권장 형태다.
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  useBottomSheetSpringConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useRef, type ComponentRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/scale';

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

export interface SortSheetOptions<T extends string> {
  /** default '정렬' */
  title?: string;
  options: SortOption<T>[];
  selected: T;
}

export interface SortSheetProps<T extends string> extends SortSheetOptions<T> {
  visible: boolean;
  onSelect: (value: T) => void;
  /** 백드롭 탭 / pan-down / Android 백 */
  onClose: () => void;
  testID?: string;
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.5L9.5 17.5L19.5 7"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SortSheet<T extends string>({
  visible,
  title = '정렬',
  options,
  selected,
  onSelect,
  onClose,
  testID,
}: SortSheetProps<T>) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<ComponentRef<typeof BottomSheet>>(null);

  // MOT-03 — 바텀시트 open spring (damping 50 / stiffness 400 / mass 1)
  const animationConfigs = useBottomSheetSpringConfigs({
    damping: 50,
    stiffness: 400,
    mass: 1,
  });

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      // MOT-05 — backdrop opacity 0→1 을 시트와 동기. 색(알파 포함)은 테마 `scrim` 이 정본이다.
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior="close"
        style={[props.style, { backgroundColor: t.scrim }]}
      />
    ),
    [t.scrim],
  );

  const handlePick = useCallback(
    (value: T) => {
      haptics.selection(); // HAP-01 — 필터/정렬 변경
      onSelect(value);
      sheetRef.current?.close();
    },
    [onSelect],
  );

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      // 시트 자체가 애니메이션을 담당한다. Modal 의 기본 슬라이드와 겹치면 2번 움직인다.
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => sheetRef.current?.close()}
    >
      {/* BottomSheet 는 testID 를 받지 않는다 — 루트에 건다 */}
      <GestureHandlerRootView testID={testID} style={{ flex: 1 }}>
        <BottomSheet
          ref={sheetRef}
          index={0}
          enableDynamicSizing
          enablePanDownToClose
          animationConfigs={animationConfigs}
          backdropComponent={renderBackdrop}
          onClose={onClose}
          backgroundStyle={{
            backgroundColor: t.bg.elevated,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
          }}
          handleIndicatorStyle={{ backgroundColor: t.border.subtle, width: 36 }}
        >
          <BottomSheetView
            // §4 규칙 4 — bottomInset 을 라이브러리에 넘기지 않고 마지막 요소에 직접 준다
            style={{ paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.xl }}
          >
            <Text
              className="pb-2 pt-1 text-h3 font-w700 text-text-primary"
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
            >
              {title}
            </Text>

            <View accessibilityRole="radiogroup">
              {options.map((option) => {
                const isSelected = option.value === selected;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, checked: isSelected }}
                    accessibilityLabel={option.label}
                    onPress={() => handlePick(option.value)}
                    // 56dp — 44dp 최소 타겟을 넉넉히 넘긴다(§11-1)
                    className="h-14 flex-row items-center justify-between"
                    style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
                  >
                    <Text
                      className={`text-input ${isSelected ? 'font-w700 text-action' : 'font-w500 text-text-primary'}`}
                      maxFontSizeMultiplier={1.3}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <CheckIcon color={t.action.base} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </BottomSheetView>
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}
