// app/calendar.tsx
//
// SCR-07 캘린더(월간) — 원본 대시보드 안의 한 섹션을 독립 화면으로 분리한 것.
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
// ── 구글 캘린더 연동을 "되는 척" 만들지 않는다 ────────────────────────────────
// 이 서버는 `connect-url` 이 **400** 이고(client-id/secret 미설정), 콜백이 302 로
// `{app.frontend-url}/dashboard/settings?...` 에 착지한다(기본값 `http://localhost:3000`).
// 즉 기본 설정에서는 앱으로 돌아올 길이 없다. `useCalendarLink().available` 이 거짓이면 버튼을
// 비활성으로 두고 `이 기기에서는 준비 중입니다.` 만 안내한다(소셜 로그인과 같은 폴백 정책).
// 연동 **해제**는 SCR-25 설정 소관이라 여기 두지 않는다 — 이 화면은 상태 표시 + 연동 유도까지다.
//
// 하단 일정 패널은 바텀시트 모양(상단 라운드 + elevation)의 **고정 패널**이다. SCR-07 레이아웃이
// `상단 캘린더 고정 + 하단 일정 리스트` 세로 2단이고, 날짜를 누를 때마다 시트가 떴다 사라지면
// 연속으로 날짜를 훑어볼 수 없다. 모달 시트(@gorhom)는 루트에 provider 가 없어 화면마다 Modal 을
// 한 겹 더 쌓아야 하는 문제도 있다(CMP-43 주석과 같은 사정).
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarLegend, MonthCalendar, ScheduleListItem } from '@/components/dashboard';
import { Button, EmptyState, Skeleton, toast } from '@/components/ui';
import {
  addMonths,
  CALENDAR_COPY,
  DASHBOARD_COPY,
  todayString,
  useCalendarLink,
  useCalendarMonth,
  useCalendarSource,
  WEEKDAY_LABELS,
  type CalendarEvent,
} from '@/features/dashboard';
import { DOC_ROUTE_SEGMENT } from '@/features/documents';
import { ArchiveHeader, href } from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/* ── 날짜 문구 ─────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');

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

/** 포스터 기간 `07.25~07.30`. 하루짜리면 빈 문자열(중복 표기를 만들지 않는다). */
function formatRange(event: CalendarEvent): string {
  if (event.startDate === event.endDate) return '';
  const short = (iso: string) => {
    const parts = iso.split('-');
    return parts[1] && parts[2] ? `${parts[1]}.${parts[2]}` : iso;
  };
  return `${short(event.startDate)}~${short(event.endDate)}`;
}

/* ── 화면 ───────────────────────────────────────────────────────────── */

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const userId = useAuthStore((s) => s.user?.id);

  // 화면이 떠 있는 동안 '오늘'이 흔들리면 `오늘` 버튼 활성 판정이 튄다 — 마운트 시점으로 고정한다.
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const [cursor, setCursor] = useState({ year: currentYear, month: currentMonth });
  const [selectedDate, setSelectedDate] = useState<string>(() => todayString());

  const { matrix, eventsByDate, monthEvents, isPending, isError, error, refetch } = useCalendarMonth(
    cursor.year,
    cursor.month,
  );

  /* 같은 쿼리 키(`['dashboard','calendar','source']`)를 한 번 더 구독한다 — 네트워크가 늘지 않는다.
     `useCalendarMonth` 가 `isRefetching` 과 프라미스형 refetch 를 노출하지 않아 당김-새로고침
     인디케이터를 제어할 수 없어서다. */
  const source = useCalendarSource();

  const calendarLink = useCalendarLink(userId);

  const isCurrentMonth = cursor.year === currentYear && cursor.month === currentMonth;

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

  const goToday = useCallback(() => {
    haptics.selection(); // HAP-01 — 캘린더 날짜 선택이 바뀐다(제스처가 아니므로 impact 아님)
    setCursor({ year: currentYear, month: currentMonth });
    setSelectedDate(todayString());
  }, [currentMonth, currentYear]);

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

  const connectCalendar = useCallback(() => {
    calendarLink.connect.mutate(undefined, {
      onSuccess: (outcome) => {
        if (outcome.status === 'unavailable') toast.info(CALENDAR_COPY.unavailable);
        else if (outcome.status === 'failed') toast.error(outcome.message);
        // 'canceled' 는 사용자가 브라우저를 닫은 것이다 — 에러가 아니므로 조용히 복귀한다.
        // 'success' 는 훅이 연동 상태를 재조회한다(딥링크 문자열은 성공의 정본이 아니다).
      },
      onError: (mutationError) => toast.error(mutationError.message),
    });
  }, [calendarLink.connect]);

  const dayEvents = eventsByDate[selectedDate] ?? [];

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="캘린더"
        onBack={() => router.back()}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="오늘로 이동"
            accessibilityState={{ disabled: isCurrentMonth }}
            disabled={isCurrentMonth}
            onPress={goToday}
            // 텍스트 버튼(18dp) + py-1 로는 실효 26dp 뿐이다 → 44dp 하한을 hitSlop 으로 채운다(A11Y §11-1)
            hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
            className="px-2 py-1"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            testID="calendar-today"
          >
            <Text
              className={`text-body-sm font-w600 ${isCurrentMonth ? 'text-text-disabled' : 'text-action'}`}
              maxFontSizeMultiplier={1.2}
            >
              오늘
            </Text>
          </Pressable>
        }
        testID="calendar-header"
      />

      {/* ── 상단: 월간 그리드 (고정) ───────────────────────────────── */}
      <View className="px-4 pt-3">
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
            onSelectDate={setSelectedDate}
            onChangeMonth={changeMonth}
            loading={isPending}
            testID="calendar-grid"
          />
        )}

        <View className="flex-row items-center justify-between">
          <CalendarLegend />

          {/* 구글 캘린더 연동 상태. 해제는 SCR-25 소관이라 여기서는 표시 + 유도만 한다. */}
          {calendarLink.connected ? (
            <View className="mt-2 rounded-full bg-success-container px-2 py-0.5">
              <Text className="text-caption font-w600 text-success-text" maxFontSizeMultiplier={1.2}>
                {`${CALENDAR_COPY.rowTitle} ${CALENDAR_COPY.connected}`}
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${CALENDAR_COPY.rowTitle} ${CALENDAR_COPY.disconnected}`}
              disabled={!calendarLink.available || calendarLink.isBusy}
              onPress={connectCalendar}
              // caption(16dp) 한 줄짜리 링크 — 44dp 하한을 hitSlop 으로 만든다(A11Y §11-1)
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              className="mt-2 flex-row items-center gap-1"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
              testID="calendar-connect"
            >
              <Text
                className={`text-caption font-w600 ${
                  calendarLink.available ? 'text-action' : 'text-text-disabled'
                }`}
                maxFontSizeMultiplier={1.2}
              >
                {calendarLink.available
                  ? `${CALENDAR_COPY.rowTitle} ${CALENDAR_COPY.disconnected} ›`
                  : CALENDAR_COPY.unavailable}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── 하단: 선택일 일정 패널 ─────────────────────────────────── */}
      <View
        className="mt-3 flex-1 overflow-hidden rounded-t-sheet bg-bg-elevated"
        style={t.elevation.sheet}
      >
        <View className="flex-row items-center gap-2 border-b border-bg-sunken px-4 py-3">
          <Text
            className="text-input font-w700 text-text-primary"
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
          >
            {formatDayHeading(selectedDate)}
          </Text>
          {dayEvents.length > 0 ? (
            <View className="rounded-full bg-info-container px-2 py-0.5">
              <Text className="text-label font-w600 text-action" maxFontSizeMultiplier={1.2}>
                {`${dayEvents.length}건`}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={source.isRefetching && !isPending}
              onRefresh={refresh}
            />
          }
        >
          {isPending ? (
            /* 로딩 — 예전에는 이 자리가 `일정이 없습니다` 였다. 아직 받지도 않은 상태를
               "없음"으로 단정해 버려서, 느린 회선에서 매번 빈 하루가 스쳐 지나갔다.
               상단 그리드가 이미 스켈레톤이므로 패널도 같은 위계로 맞춘다(FR-109). */
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
                  showChevron
                  {...(event.time ? { time: event.time } : {})}
                  {...(event.subtitle ? { subtitle: event.subtitle } : {})}
                  {...(formatRange(event) ? { dateRange: formatRange(event) } : {})}
                  onPress={() => openEvent(event)}
                  testID={`calendar-event-${event.key}`}
                />
              </View>
            ))
          ) : monthEvents.length === 0 ? (
            /* 이 달 전체가 비었을 때 — 왜 비었는지까지 알려 준다 (SCR-07 빈 상태 2종 중 하나).
               `!isPending` 은 위 로딩 분기가 이미 걸러 주므로 여기서 또 볼 필요가 없다. */
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
      </View>
    </View>
  );
}
