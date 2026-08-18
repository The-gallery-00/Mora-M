// src/components/dashboard/NotificationItem.tsx
//
// CMP-44 NotificationItem — Component Library §2 (1-E) 정본. SCR-08 알림 목록의 행 1개.
//
// 원본 웹에는 이 화면이 **없다**(벨 버튼에 onClick 조차 없었다). 백엔드는 매일 09:00 KST 스케줄러가
// 알림 row 를 쌓고 있으므로 소비 UI 를 모바일에서 완성한다.
//
// 미읽음 = 좌측 4dp 바(`bg-action`) + 배경 `surface-active`(라이트 `#F0F9FF` — 정본 값과 같다).
// 읽음 = `bg-bg-elevated`. 유형별 이모지 원형 아이콘은 피그마 개정으로 삭제됐다 — 유형 구분은
// 제목(`title` 없으면 `NOTIFICATION_COPY.typeLabel[type]`)이 그대로 담당한다.
//
// **메시지 정규화**: 서버가 `…남았습니다입니다.` 를 그대로 저장한다(`formatDDay()` 이중 어미 버그).
// 데이터 계층 `toNotification()` 이 이미 고쳐서 주지만, 이 컴포넌트도 **표시 직전에 한 번 더** 태운다.
// 정규화 함수는 멱등이라 두 번 적용해도 결과가 같고, 낙관적 갱신으로 만든 임시 객체가 어댑터를
// 거치지 않고 들어오는 경로가 실제로 존재한다 — 마지막 방어선을 화면 쪽에 둔다.
import { memo } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  formatRelativeTime,
  NOTIFICATION_COPY,
  normalizeNotificationMessage,
  type NotificationType,
} from '@/features/notifications';
import { useTheme } from '@/theme/ThemeProvider';

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 12l4 4 8-8"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export interface NotificationItemProps {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** ISO 문자열. 상대시각으로 변환해 우상단에 그린다. */
  createdAt: string;
  read: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function NotificationItemBase({
  type,
  title,
  message,
  createdAt,
  read,
  selectionMode = false,
  selected = false,
  onPress,
  style,
  testID,
}: NotificationItemProps) {
  const t = useTheme();
  const body = normalizeNotificationMessage(message);
  const when = formatRelativeTime(createdAt);
  const heading = title || NOTIFICATION_COPY.typeLabel[type];

  const row = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={
        selectionMode ? { selected, checked: selected } : { selected: !read }
      }
      accessibilityLabel={[
        selectionMode ? (selected ? '선택됨' : '선택 안 됨') : read ? '' : '읽지 않음',
        heading,
        body,
        when,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
      className={`flex-row items-stretch ${selected || !read ? 'bg-surface-active' : 'bg-bg-elevated'}`}
      style={({ pressed }) => [style, pressed ? { opacity: 0.9 } : null]}
    >
      {/* 미읽음 좌측 4dp 바(행 전체 높이). 읽으면 같은 폭의 투명 자리만 남아 정렬이 흔들리지 않는다. */}
      <View className={`w-1 ${read ? 'bg-transparent' : 'bg-action'}`} />

      {/* `pl-3` 유지 — 바깥 미읽음 바가 w-1(4dp)이라 4 + 12 = 16dp 로 화면 거터·구분선과 맞는다. */}
      <View className="flex-1 py-3 pl-3 pr-4">
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 text-base font-w600 text-text-primary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {heading}
          </Text>
          {when ? (
            <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
              {when}
            </Text>
          ) : null}
        </View>

        <Text
          className="mt-0.5 text-body-sm text-text-secondary"
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
        >
          {body}
        </Text>
      </View>

      {selectionMode ? (
        <View className="pr-4 items-center justify-center">
          <View
            className={`h-5 w-5 items-center justify-center rounded-full border ${
              selected ? 'border-action bg-action' : 'border-border-subtle bg-bg-base'
            }`}
          >
            {selected ? <CheckIcon color={t.text.inverse} /> : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );

  return row;
}

export const NotificationItem = memo(NotificationItemBase);
NotificationItem.displayName = 'NotificationItem';
