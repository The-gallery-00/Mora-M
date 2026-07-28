// src/components/ui/Divider.tsx
//
// CMP-09 Divider — Component Library §2 정본. 원본 `shared/Divider.tsx` 이식(구현 변경).
// 원본은 흰 배경 텍스트 박스로 선을 **덮는** 방식이었다. 다크에서 즉시 깨지므로
// `flexDirection:'row'` + 양쪽 `flex:1` 선 + 중앙 라벨 구조로 교체했다(§2 CMP-09 각주).
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type DividerOrientation = 'horizontal' | 'vertical';
/** default = border.subtle / soft = surface.alt (원본 구분선 2종에 대응) */
export type DividerTone = 'default' | 'soft';

export interface DividerProps {
  /** 가운데 텍스트. 있으면 좌우 선 + 중앙 라벨 (예: '또는') */
  label?: string;
  orientation?: DividerOrientation; // default 'horizontal'
  inset?: number; // 좌우(수직이면 상하) 여백
  tone?: DividerTone; // default 'default'
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const LINE: Record<DividerTone, string> = {
  default: 'bg-border-subtle',
  soft: 'bg-surface-alt',
};

export function Divider({
  label,
  orientation = 'horizontal',
  inset = 0,
  tone = 'default',
  style,
  testID,
}: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <View
        testID={testID}
        className={`w-px self-stretch ${LINE[tone]}`}
        style={[{ marginVertical: inset }, style]}
        // 장식 요소는 스크린리더에서 숨긴다(A11Y-04)
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }

  if (!label) {
    return (
      <View
        testID={testID}
        className={`h-px w-full ${LINE[tone]}`}
        style={[{ marginHorizontal: inset }, style]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }

  return (
    <View
      testID={testID}
      className="h-5 w-full flex-row items-center"
      style={[{ marginHorizontal: inset }, style]}
    >
      <View className={`h-px flex-1 ${LINE[tone]}`} />
      {/* 원본 px-[20px] 유지. 라벨 색은 캡션 기본값 text.muted (§11-2 결정) */}
      <Text className="px-5 text-body-sm text-text-muted">{label}</Text>
      <View className={`h-px flex-1 ${LINE[tone]}`} />
    </View>
  );
}
