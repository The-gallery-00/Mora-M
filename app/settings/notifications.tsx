// app/settings/notifications.tsx — SCR-29 알림 설정 (API-39 / API-40, FR-089)
//
// **신설 화면이다.** 원본 웹의 토글 3종(`OCR 처리 완료`/`일정 등록`/`데이터 동기화`)은
// localStorage 에만 저장되고 실제 알림과 아무 관계가 없었다. 반대로 서버의
// `NotificationSettingController`(API-39/40)는 완성돼 있는데 아무도 호출하지 않았다.
// → **서버 스키마 3필드에 맞춰 카피를 새로 썼다.**
//
// ⚠ `deadlineReminderDays` 의 의미를 오해하기 쉽다. "며칠 전에 알린다"가 아니라
//   **"며칠 앞까지 훑을지"의 윈도우**이고, 윈도우 안에서 **1회만** 생성된다(5-튜플 유니크).
//   반복 알림이 아니다. 같은 기간 값을 시작 예정 알림과 진행 중 종료 알림에 함께 적용한다.
//
// ⚠ **OS 푸시 권한을 요청하지 않는다.** 백엔드에 FCM/APNs 토큰 저장소가 없어 실제 푸시가
//   불가능하다(SCR-29 신설 근거 4). 권한만 받아 두고 알림이 오지 않으면 그게 더 나쁘다.
//   상단 안내 배너가 "앱 안에서만 확인"이라는 사실을 먼저 말한다.
//
// 저장은 **낙관적 갱신 + 변경된 필드만 전송**이다. 전체 객체를 매번 실으면 토글을 빠르게
// 연타할 때 뒤 요청이 앞 요청의 값을 되돌린다(서버가 래퍼 타입 null 스킵으로 부분 업데이트를 지원).
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { SettingsRow, SettingsSection } from '@/components/settings';
import { Button, SegmentedControl, Skeleton, toast } from '@/components/ui';
import {
  DEADLINE_REMINDER_DAY_OPTIONS,
  deadlineDaysCaption,
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTINGS_COPY,
  useNotificationSettings,
  useUpdateNotificationSettings,
  type NotificationSettingsInput,
} from '@/features/account';
import { ArchiveHeader } from '@/features/documents/ArchiveList';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

function InfoIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path d="M12 11V16.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 7.6V7.7" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/** SCR-29 세그먼트 선택지 `1일 3일 5일 7일 14일`. 값은 숫자, 라벨만 `일` 을 붙인다. */
const DAY_OPTIONS = DEADLINE_REMINDER_DAY_OPTIONS.map((days) => ({
  value: days,
  label: `${days}일`,
}));

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();

  const settingsQuery = useNotificationSettings();
  const update = useUpdateNotificationSettings();

  // 로딩 중에도 세그먼트/토글의 자리와 개수가 흔들리지 않도록 기본값으로 그린다.
  // 서버가 row 를 자동 생성하므로(`findOrCreate`) 이 값이 실제와 어긋나는 구간은 첫 왕복뿐이다.
  const settings = settingsQuery.data ?? DEFAULT_NOTIFICATION_SETTINGS;
  const loading = settingsQuery.isPending;
  const failed = settingsQuery.isError;

  const save = (input: NotificationSettingsInput) => {
    update.mutate(input, {
      // 실패는 조용히 롤백하지 않는다 — 값이 되돌아간 이유를 사용자가 알아야 한다 (R4).
      onError: (error) => toast.error(error.message),
    });
  };

  /* ── 조회 실패 ─────────────────────────────────────────────────────────── */

  if (failed) {
    return (
      <View className="flex-1 bg-bg-base">
        <ArchiveHeader
          title={NOTIFICATION_SETTINGS_COPY.screenTitle}
          onBack={() => router.back()}
        />
        <View
          className="flex-1 items-center justify-center gap-4 px-8"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-center text-base font-w600 text-text-secondary">
            {settingsQuery.error.message}
          </Text>
          <Button
            label={NOTIFICATION_SETTINGS_COPY.retry}
            onPress={() => void settingsQuery.refetch()}
            variant="secondary"
            size="md"
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title={NOTIFICATION_SETTINGS_COPY.screenTitle}
        onBack={() => router.back()}
        testID="notif-settings-header"
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 기기 푸시가 없다는 사실을 화면 첫 줄에서 말한다 — 나중에 알게 되면 고장으로 읽힌다. */}
        <View className="mt-4 flex-row gap-2 rounded-card border border-info-border bg-info-container p-3">
          <View className="pt-0.5">
            <InfoIcon color={t.info.base} />
          </View>
          <Text className="flex-1 text-caption text-info" maxFontSizeMultiplier={1.4}>
            {NOTIFICATION_SETTINGS_COPY.notice}
          </Text>
        </View>

        {loading ? (
          <View className="mt-6 gap-3 rounded-card border border-border-subtle bg-bg-elevated p-4">
            <Skeleton width="55%" height={16} />
            <Skeleton width="80%" height={12} />
            <Skeleton width="55%" height={16} />
            <Skeleton width="80%" height={12} />
          </View>
        ) : (
          <>
            <SettingsSection title={NOTIFICATION_SETTINGS_COPY.typeSection}>
              <SettingsRow
                label={NOTIFICATION_SETTINGS_COPY.deadlineTitle}
                description={NOTIFICATION_SETTINGS_COPY.deadlineCaption}
                toggle={{
                  value: settings.deadlineReminderEnabled,
                  onValueChange: (next) => save({ deadlineReminderEnabled: next }),
                }}
                testID="row-deadline-enabled"
              />
              <SettingsRow
                label={NOTIFICATION_SETTINGS_COPY.scheduleTitle}
                description={NOTIFICATION_SETTINGS_COPY.scheduleCaption}
                toggle={{
                  value: settings.scheduleReminderEnabled,
                  onValueChange: (next) => save({ scheduleReminderEnabled: next }),
                }}
                testID="row-schedule-enabled"
              />
            </SettingsSection>

            <SettingsSection
              title={NOTIFICATION_SETTINGS_COPY.timingSection}
              footer={NOTIFICATION_SETTINGS_COPY.footer}
            >
              {/* 두 알림이 모두 꺼져 있으면 일수는 의미가 없다 → 비활성 (SCR-29 인터랙션 표 3행).
                  행 자체를 숨기지 않는 이유: 토글을 켰을 때 없던 컨트롤이 튀어나오면
                  레이아웃이 점프한다. */}
              <SettingsRow
                label={NOTIFICATION_SETTINGS_COPY.daysTitle}
                description={deadlineDaysCaption(settings.deadlineReminderDays)}
                disabled={!settings.deadlineReminderEnabled && !settings.scheduleReminderEnabled}
                segmented={
                  <View style={{ opacity: settings.deadlineReminderEnabled || settings.scheduleReminderEnabled ? 1 : 0.4 }}>
                    <SegmentedControl
                      options={DAY_OPTIONS.map((option) => ({
                        ...option,
                        disabled: !settings.deadlineReminderEnabled && !settings.scheduleReminderEnabled,
                      }))}
                      value={settings.deadlineReminderDays}
                      onChange={(days) => save({ deadlineReminderDays: days })}
                      // 5칸이라 390dp 에서 한 칸 ≈65dp — `14일` 이 줄바꿈되지 않게 가로 스크롤로 둔다.
                      scrollable
                      accessibilityLabel={NOTIFICATION_SETTINGS_COPY.daysTitle}
                      testID="segment-deadline-days"
                    />
                  </View>
                }
                testID="row-deadline-days"
              />
            </SettingsSection>
          </>
        )}
      </ScrollView>
    </View>
  );
}
