// src/components/ui/EmptyState.tsx
//
// CMP-14 EmptyState — Component Library §2 정본. 빈 목록 표현은 아이콘(48) + 제목 + 부제 + 1차 CTA(§7-1).
// 문구는 화면이 UX 가이드 §7-2 의 CP-08~CP-18 최종안을 그대로 넘긴다 — 여기서 창작하지 않는다.
//
// 원본 `StorageGrid` 의 빈 상태 아이콘은 문자 `□`(폰트 의존)였다. lucide-react-native 가 아직
// 설치되지 않았으므로(패키지 추가 금지) `icon` 미지정 시에는 중립 프레임만 그리고,
// 화면이 아이콘 엘리먼트를 넘기면 그 자리에 표시한다. lucide 도입 후 preset 기본 아이콘을 얹으면 된다.
import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from './Button';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** 섹션 내부 인라인용 — 패딩 축소 */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
  style,
  testID,
}: EmptyStateProps) {
  return (
    <View
      testID={testID}
      // 빈 상태 상하 여백 huge(40) / compact 는 xxl(24)
      className={`w-full items-center px-6 ${compact ? 'py-6' : 'py-10'}`}
      style={style}
      // 카드 전체를 한 항목으로 읽히게 한다(A11Y-05)
      accessible
      accessibilityLabel={description ? `${title}. ${description}` : title}
    >
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-xl border border-border-subtle bg-surface-alt">
        {icon}
      </View>

      <Text className="text-center text-h3 font-w700 text-text-primary">{title}</Text>

      {description ? (
        <Text className="mt-2 text-center text-body-sm text-text-muted">{description}</Text>
      ) : null}

      {actionLabel && onAction ? (
        <View className="mt-5 w-full items-center gap-2">
          <Button label={actionLabel} onPress={onAction} variant="primary" size="md" />
          {secondaryActionLabel && onSecondaryAction ? (
            <Button
              label={secondaryActionLabel}
              onPress={onSecondaryAction}
              variant="ghost"
              size="md"
              haptic="selection"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
