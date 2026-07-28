// src/components/settings/SettingsSection.tsx
//
// CMP-36 SettingsSection — Component Library §2 정본. 원본 `settings/page.tsx` 의 `Card` 섹션이다.
// 원본은 2열 grid 안의 카드였고 모바일은 1열 세로 리스트다(SCR-25 변경점 표 1행).
//
// 행 사이 구분선을 **호출부가 아니라 섹션이** 넣는다. 화면에서 `<Divider/>` 를 손으로 끼우면
// 조건부 행(개발 전용·소셜 계정 분기)을 넣고 뺄 때마다 선이 하나 남거나 모자란다 —
// 실제로 SCR-25 는 계정 종류·빌드 프로파일에 따라 행 수가 달라지는 화면이다.
import { Children, isValidElement, type ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Divider } from '@/components/ui';

export interface SettingsSectionProps {
  /** 카드 위 섹션 제목 (`계정`·`연동`·`데이터`…). 없으면 카드만 그린다. */
  title?: string;
  subtitle?: string;
  /** 원본 titleIcon (UserRoundCog, Link, Database, Bell, Monitor, Info). */
  icon?: ReactNode;
  children: ReactNode;
  /** 카드 아래 회색 캡션 (SCR-29 `알림은 매일 오전 9시에 확인합니다.`). */
  footer?: string;
  /** false 면 행 사이 구분선을 넣지 않는다 (카드 하나짜리 블록). default true */
  divided?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SettingsSection({
  title,
  subtitle,
  icon,
  children,
  footer,
  divided = true,
  style,
  testID,
}: SettingsSectionProps) {
  // `{cond ? <Row/> : null}` 로 접힌 자리는 null 이 되어 배열에 남는다.
  // 그대로 두면 "보이지 않는 행" 앞뒤로 구분선이 두 줄 그려진다 → 먼저 걷어낸다.
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View className="mt-6" style={style} testID={testID}>
      {title ? (
        <View className="mb-2 flex-row items-center gap-1.5 px-1">
          {icon}
          <Text
            className="text-input font-w600 text-text-secondary"
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </Text>
        </View>
      ) : null}

      {subtitle ? (
        <Text className="mb-2 px-1 text-caption text-text-muted" maxFontSizeMultiplier={1.4}>
          {subtitle}
        </Text>
      ) : null}

      <View className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated">
        {rows.map((row, index) => (
          <View key={row.key ?? index}>
            {divided && index > 0 ? <Divider /> : null}
            {row}
          </View>
        ))}
      </View>

      {footer ? (
        <Text className="mt-2 px-1 text-caption text-text-muted" maxFontSizeMultiplier={1.4}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
