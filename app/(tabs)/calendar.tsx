// app/(tabs)/calendar.tsx
//
// SCR-07 캘린더(월간) — 원본 대시보드 안의 한 섹션을 독립 화면으로 분리한 것.
//
// **탭 5번째 슬롯이다**(예전 설정 자리). 파일은 `app/calendar.tsx` 에서 옮겨 왔고, `(tabs)` 는
// 그룹 세그먼트라 **경로는 `/calendar` 그대로**다 — 홈의 `router.push(href('/calendar'))` 4곳과
// 위젯 딥링크 `mora://calendar[?date=…]` 가 그대로 산다. 탭 루트가 되면서 달라진 것 2가지:
//   1. 헤더의 뒤로가기를 뺀다 — 탭 루트는 되돌아갈 곳이 없다(`router.back()` 이 탭 밖으로 튄다).
//   2. 인증 가드는 `(tabs)/_layout` 이 대신한다(화면이 직접 들지 않는다, Navigation Map §6-3 규칙 1).
//
// ── 이 화면의 데이터가 서버 캘린더 API 가 아닌 이유 ────────────────────────────
// `GET /api/google-calendar/month` 는 **껍데기다.** `GoogleCalendarService.getMonth()` 가
// `.events(List.of())` 를 하드코딩해 항상 빈 배열을 돌려준다(구글 API 를 호출하는 코드가 함수 안에
// 아예 없다 — `features/dashboard/calendar.ts` 상단 ①, 실측 확인). 그래서 SCR-07 데이터 표가 지정한
// 대로 `GET /api/tickets` + `GET /api/posters`(각 `page=0&size=100`)에서 **앱이 직접 조립**한다.
// 조립기는 데이터 계층(`toCalendarEvents` / `buildEventIndex`)에 있고 이 화면은 그리기만 한다.
//
// **월이 바뀌어도 재요청하지 않는다.** 원천을 1벌 받아 두고(`['dashboard','calendar','source']`)
// 월 파생은 전부 메모이즈된 순수 계산이다 — 서버에 기간 필터 파라미터가 없어 어차피 전건을 받아야
// 하고, 좌우 스와이프가 네트워크를 기다리면 체감이 무너진다.
//
// 날짜별 일정은 날짜 셀을 누르면 고정 크기 모달에서 표시한다. 일정이 많아도 캘린더 화면은 움직이지
// 않고 모달 내부 목록만 스크롤한다.
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthCalendar, ScheduleListItem } from '@/components/dashboard';
import { Button, EmptyState, Skeleton, toast } from '@/components/ui';
import {
  addMonths,
  CALENDAR_COPY,
  DASHBOARD_COPY,
  todayString,
  useCalendarMonth,
  useCalendarSource,
  WEEKDAY_LABELS,
  type CalendarEvent,
} from '@/features/dashboard';
import { DOC_ROUTE_SEGMENT } from '@/features/documents';
import { href } from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

/* ── 날짜 문구 ─────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');
const DAY_MODAL_WIDTH = 328;
const DAY_MODAL_HEIGHT = 440;
const DAY_MODAL_TRAILING_WIDTH = 72;

/** `2026-07-27` → `7월 27일 (월)` (SCR-07 sticky 헤더). */
function formatDayHeading(iso: string): string {
  const parts = iso.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  const weekday = WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()] ?? '';
  return `${month}월 ${day}일 (${weekday})`;
}

/** 포스터 기간 `07.25~07.30`. 하루짜리는 해당 날짜 `07.25`를 표시한다. */
function formatRange(event: CalendarEvent): string {
  const short = (iso: string) => {
    const parts = iso.split('-');
    return parts[1] && parts[2] ? `${parts[1]}.${parts[2]}` : iso;
  };
  if (event.startDate === event.endDate) return short(event.startDate);
  return `${short(event.startDate)} ~ ${short(event.endDate)}`;
}

/* ── 화면 ───────────────────────────────────────────────────────────── */

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();

  // 화면이 떠 있는 동안 '오늘'이 흔들리면 `오늘` 버튼 활성 판정이 튄다 — 마운트 시점으로 고정한다.
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const [cursor, setCursor] = useState({ year: currentYear, month: currentMonth });
  const [selectedDate, setSelectedDate] = useState<string>(() => todayString());
  const [dayModalVisible, setDayModalVisible] = useState(false);

  const { matrix, eventsByDate, monthEvents, isPending, isError, error, refetch } = useCalendarMonth(
    cursor.year,
    cursor.month,
  );

  /* 같은 쿼리 키(`['dashboard','calendar','source']`)를 한 번 더 구독한다 — 네트워크가 늘지 않는다.
     `useCalendarMonth` 가 `isRefetching` 과 프라미스형 refetch 를 노출하지 않아 당김-새로고침
     인디케이터를 제어할 수 없어서다. */
  const source = useCalendarSource();

  /** 월을 옮기면 선택일도 옮긴다 — 이번 달이면 오늘, 아니면 1일. 보이지 않는 날짜가 선택된 채로
      하단 패널이 `일정이 없습니다` 를 띄우는 상태를 만들지 않기 위해서다. */
  const defaultDateOf = useCallback(
    (year: number, month: number): string =>
      year === currentYear && month === currentMonth
        ? todayString()
        : `${year}-${pad2(month)}-01`,
    [currentMonth, currentYear],
  );

  const changeMonth = useCallback(
    (delta: number) => {
      const next = addMonths(cursor.year, cursor.month, delta);
      setCursor(next);
      setSelectedDate(defaultDateOf(next.year, next.month));
    },
    [cursor.month, cursor.year, defaultDateOf],
  );

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setDayModalVisible(true);
  }, []);

  const refresh = useCallback(() => {
    haptics.impact('light'); // HAP-05 — pull-to-refresh 임계 도달
    void source.refetch().then((result) => {
      if (result.isError) toast.error(DASHBOARD_COPY.refreshFailed);
    });
  }, [source]);

  const openEvent = useCallback(
    (event: CalendarEvent) => {
      router.push(href(`/doc/${DOC_ROUTE_SEGMENT[event.type]}/${event.id}`));
    },
    [router],
  );

  const dayEvents = useMemo(() => {
    const events = eventsByDate[selectedDate] ?? [];
    return [...events].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'TICKET' ? -1 : 1;
      if (a.type !== 'TICKET') return 0;
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });
  }, [eventsByDate, selectedDate]);

  return (
    <View className="flex-1 bg-bg-base">
      {/* ── 상단: 월간 그리드 (고정) ───────────────────────────────── */}
      <View className="px-4 pt-3" style={{ paddingTop: insets.top + 12 }}>
        {isError ? (
          <View
            className="items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
            accessibilityLiveRegion="polite"
          >
            <Text className="text-center text-base font-w600 text-danger" maxFontSizeMultiplier={1.3}>
              {error?.message ?? CALENDAR_COPY.loadFailed}
            </Text>
            <Button label="다시 시도" onPress={refetch} variant="secondary" size="sm" />
          </View>
        ) : (
          <MonthCalendar
            matrix={matrix}
            selectedDate={selectedDate}
            eventsByDate={eventsByDate}
            events={source.data ?? monthEvents}
            onSelectDate={selectDate}
            onChangeMonth={changeMonth}
            loading={isPending}
            testID="calendar-grid"
          />
        )}
      </View>

      <Modal
        visible={dayModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setDayModalVisible(false)}
      >
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: t.scrim }}
          accessibilityRole="button"
          accessibilityLabel="선택 날짜 일정 닫기"
          onPress={() => setDayModalVisible(false)}
        >
          <Pressable
            className="overflow-hidden rounded-card bg-bg-elevated"
            style={[
              { width: DAY_MODAL_WIDTH, height: DAY_MODAL_HEIGHT },
              t.elevation.sheet,
            ]}
            accessibilityViewIsModal
            onPress={() => undefined}
            testID="calendar-day-modal"
          >
            <View className="flex-row items-center border-b border-bg-sunken px-4 py-3">
              <View className="flex-1 flex-row items-center gap-2" style={{ minWidth: 0 }}>
                <Text
                  className="shrink text-input font-w700 text-text-primary"
                  accessibilityRole="header"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {formatDayHeading(selectedDate)}
                </Text>
                {dayEvents.length > 0 ? (
                  <View className="shrink-0 rounded-full bg-info-container px-2 py-0.5">
                    <Text className="text-label font-w600 text-action" maxFontSizeMultiplier={1.2}>
                      {`${dayEvents.length}건`}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="선택 날짜 일정 닫기"
                hitSlop={12}
                onPress={() => setDayModalVisible(false)}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
              >
                <Text className="text-body-sm font-w600 text-action" maxFontSizeMultiplier={1.2}>
                  닫기
                </Text>
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 16 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={source.isRefetching && !isPending}
                  onRefresh={refresh}
                />
              }
            >
              {isPending ? (
                <View
                  className="gap-px"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {[0, 1, 2].map((i) => (
                    <View key={i} className="flex-row items-center gap-3 px-4 py-3.5">
                      <Skeleton width={40} height={40} radius={10} />
                      <View className="flex-1 gap-2">
                        <Skeleton width="55%" height={15} radius={4} />
                        <Skeleton width="35%" height={12} radius={4} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : dayEvents.length > 0 ? (
                dayEvents.map((event, index) => (
                  <View key={event.key}>
                    {index > 0 ? <View className="h-px bg-bg-elevated" /> : null}
                    <ScheduleListItem
                      docType={event.type}
                      title={event.title}
                      size="regular"
                      {...(event.type === 'TICKET' && event.time && event.arrivalTime
                        ? { time: `${event.time} → ${event.arrivalTime}` }
                        : {})}
                      timeOnRight={event.type === 'TICKET'}
                      trailingWidth={DAY_MODAL_TRAILING_WIDTH}
                      {...(event.subtitle ? { subtitle: event.subtitle } : {})}
                      {...(formatRange(event) ? { dateRange: formatRange(event) } : {})}
                      onPress={() => {
                        setDayModalVisible(false);
                        openEvent(event);
                      }}
                      testID={`calendar-event-${event.key}`}
                    />
                  </View>
                ))
              ) : monthEvents.length === 0 ? (
                <EmptyState
                  compact
                  title={DASHBOARD_COPY.emptyMonth}
                  description={DASHBOARD_COPY.emptyMonthCaption}
                  testID="calendar-empty-month"
                />
              ) : (
                <View className="items-center py-10">
                  <Text className="text-body-sm text-text-muted" maxFontSizeMultiplier={1.3}>
                    {DASHBOARD_COPY.emptySchedules}
                  </Text>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
