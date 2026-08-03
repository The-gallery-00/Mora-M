// src/components/dashboard/ScheduleListItem.tsx
//
// CMP-34 ScheduleListItem — Component Library §2 (1-E) 정본.
// SCR-06 `7월 27일 일정` 리스트(h56)와 SCR-07 하단 일정 리스트(h72, 우측 chevron)가 공유한다.
//
// 배경 = 문서 유형 배경 토큰의 45% 알파(`bg-ticket-bg/45` / `bg-poster-bg/45`). 토큰이
// `rgb(var(--doc-*-bg) / <alpha-value>)` 라서 새 HEX 없이 연하게 만들 수 있다(tailwind.config.js §colors).
// 유형 배지는 `bg-bg-elevated` 표면 위 유형 전경색이고, 폭은 3글자 기준 44dp 로 고정한다 —
// 내용폭이면 '티켓'(2자)/'포스터'(3자)의 배지 폭이 달라 행마다 제목 시작 x 가 어긋난다.
import { memo } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

export type ScheduleDocType = 'TICKET' | 'POSTER';

export interface ScheduleListItemProps {
  docType: ScheduleDocType;
  title: string;
  /** `HH:MM`. 포스터는 서버가 항상 빈 문자열을 준다. */
  time?: string;
  /** 포스터 기간 `07.25~07.30`. */
  dateRange?: string;
  subtitle?: string;
  /** 홈(SCR-06)은 h56, 캘린더(SCR-07)는 h72. default 'compact' */
  size?: 'compact' | 'regular';
  /** SCR-07 만 우측 `›` 를 그린다. default false */
  showChevron?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TYPE_LABEL: Record<ScheduleDocType, string> = { TICKET: '티켓', POSTER: '포스터' };

/** 45% 알파 — 토큰이 `rgb(var(--doc-*-bg) / <alpha-value>)` 라 새 HEX 없이 연하게 만든다.
    리터럴로 적어야 NativeWind content 스캐너가 클래스를 생성한다(변수로 조립 금지). */
const ROW_CLASS: Record<ScheduleDocType, string> = {
  TICKET: 'bg-ticket-bg/45',
  POSTER: 'bg-poster-bg/45',
};

const BADGE_TEXT: Record<ScheduleDocType, string> = {
  TICKET: 'text-ticket',
  POSTER: 'text-poster',
};

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5L16 12L9 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ScheduleListItemBase({
  docType,
  title,
  time,
  dateRange,
  subtitle,
  size = 'compact',
  showChevron = false,
  onPress,
  style,
  testID,
}: ScheduleListItemProps) {
  const t = useTheme();
  const height = size === 'compact' ? 56 : 72;
  // 우측 보조 텍스트: 티켓은 시각, 포스터는 기간. 둘 다 없으면 부제를 올린다.
  const trailingText = time || dateRange || '';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[TYPE_LABEL[docType], time, title, subtitle, dateRange]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      className={`flex-row items-center gap-2 px-3 ${ROW_CLASS[docType]}`}
      style={({ pressed }) => [
        { height },
        style,
        // SCR-06/07 인터랙션 표: 일정 행 탭 scale 0.98
        pressed ? { opacity: 0.92, transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      {/* 3글자('포스터') 기준 고정폭 44dp. 내용폭이면 '티켓'(2자)과 '포스터'(3자)의 폭이 달라
          행마다 제목 시작 x 가 어긋난다 — 폭을 고정하고 텍스트를 가운데로 둔다.
          `w-11` 을 쓰지 않는 이유: metro 의 nativewind inlineRem 기본값이 14 라
          `w-11`(2.75rem)이 38.5dp 로 줄어 '포스터'(≈36dp)가 아슬아슬해진다. dp 로 못 박는다. */}
      <View className="items-center rounded-xs bg-bg-elevated py-0.5" style={{ width: 44 }}>
        <Text
          className={`text-micro font-w700 ${BADGE_TEXT[docType]}`}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {TYPE_LABEL[docType]}
        </Text>
      </View>

      {time ? (
        <Text className="text-body-sm font-w700 text-text-primary" maxFontSizeMultiplier={1.2}>
          {time}
        </Text>
      ) : null}

      <View className="flex-1">
        <Text
          className="text-base font-w600 text-text-primary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {title}
        </Text>
        {size === 'regular' && subtitle ? (
          <Text className="text-caption text-text-secondary" numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* 시각을 이미 좌측에 그렸다면 우측에는 기간만 남긴다(같은 값 중복 방지). */}
      {!time && trailingText ? (
        <Text className="text-caption text-text-secondary" numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {trailingText}
        </Text>
      ) : null}

      {showChevron ? <ChevronIcon color={t.text.disabled} /> : null}
    </Pressable>
  );
}

export const ScheduleListItem = memo(ScheduleListItemBase);
ScheduleListItem.displayName = 'ScheduleListItem';
