// src/components/dashboard/MonthCalendar.tsx
//
// CMP-33 Calendar (month 모드) — Component Library §2 (1-E) + Screen Specs SCR-07 정본.
//
// **달력 라이브러리를 쓰지 않는다.** 프로젝트 규약상 패키지 추가가 금지돼 있고, Component Library
// §5-2 도 `react-native-calendars` 를 반려했다(유형 dot·기간 이벤트·요일 색 규칙이 고유해서
// 테마 오버라이드가 자체 구현보다 길어진다). 7×6 그리드 계산은 데이터 계층
// `features/dashboard/calendar.ts` 의 `buildMonthMatrix()` 가 이미 순수 함수로 갖고 있으므로
// 이 파일은 **그 결과를 그리는 일만** 한다.
//
// 원본(웹)에서 폐기한 것: 셀 120px, 기간 pill 라벨, `labelSpan` 로직, 화살표 키 내비게이션.
// 모바일이 더한 것: **좌우 스와이프로 월 이동**(SCR-07 인터랙션 표).
//
// 색은 className 이 닿지 않는 자리(SVG 없는 원형 배지 배경·요일색·dot)라 `useTheme()` 로 받는다.
// `theme.calendar.{sunday,saturday,selected}` 는 이 화면을 위해 tokens.ts 에 이미 존재한다.
import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Skeleton } from '@/components/ui';
import { WEEKDAY_LABELS, type CalendarEvent, type CalendarMonth } from '@/features/dashboard';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export interface MonthCalendarProps {
  /** `buildMonthMatrix(year, month)` 결과. 항상 6주 × 7일 = 42칸이다. */
  matrix: CalendarMonth;
  selectedDate: string | null;
  /** `YYYY-MM-DD` → 그 날 걸치는 이벤트. `buildEventIndex()` 결과를 그대로 넘긴다. */
  eventsByDate: Record<string, CalendarEvent[]>;
  onSelectDate: (date: string) => void;
  /** `-1` 이전 달 / `+1` 다음 달. 스와이프와 `‹` `›` 버튼이 함께 쓴다. */
  onChangeMonth: (delta: number) => void;
  /** 셀당 최대 dot 수. 초과분은 `+N`. default 3 (SCR-07 모바일 변경점) */
  maxDots?: number;
  loading?: boolean;
  testID?: string;
}

/** SCR-07: 셀 높이 56dp × 6주 = 336dp 가 상한이다. */
const CELL_HEIGHT = 56;
/** 오늘 표시 원형 배지 지름. */
const TODAY_BADGE = 28;
const DOT_SIZE = 5;
/** 이만큼 끌면 월이 바뀐다. 세로 스크롤과 겨루지 않도록 넉넉히 잡았다. */
const SWIPE_THRESHOLD = 60;

function ChevronLeft({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5L8 12L15 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronRight({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
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

function MonthCalendarBase({
  matrix,
  selectedDate,
  eventsByDate,
  onSelectDate,
  onChangeMonth,
  maxDots = 3,
  loading = false,
  testID,
}: MonthCalendarProps) {
  const t = useTheme();

  /** 요일 색 — 일 빨강 / 토 파랑 / 평일 흐림 (원본 `getWeekendColor()`). */
  const weekdayColor = useCallback(
    (weekday: number): string =>
      weekday === 0 ? t.calendar.sunday : weekday === 6 ? t.calendar.saturday : t.text.disabled,
    [t],
  );

  /**
   * 날짜 숫자 색.
   *  오늘 → 원형 배지 위 흰 글씨 / 이번 달 아님 → 흐림 / 주말 → 요일색 / 평일 → 본문색.
   * 평일에 `weekdayColor`(흐림)를 그대로 쓰면 날짜가 전부 회색이 된다 — 요일 헤더 전용 색이다.
   */
  const dayColor = useCallback(
    (day: { isToday: boolean; inMonth: boolean; weekday: number }): string => {
      if (day.isToday) return t.text.inverse;
      if (!day.inMonth) return t.border.subtle;
      if (day.weekday === 0) return t.calendar.sunday;
      if (day.weekday === 6) return t.calendar.saturday;
      return t.text.primary;
    },
    [t],
  );

  const change = useCallback(
    (delta: number) => {
      haptics.selection();
      onChangeMonth(delta);
    },
    [onChangeMonth],
  );

  const dx = useSharedValue(0);

  /* 좌우 스와이프로 월 이동. 세로 스크롤이 주인이므로 수평 16dp 를 넘겨야 제스처가 활성화되고,
     세로로 20dp 이상 움직이면 실패시킨다(부모 ScrollView 에 양보).

     공유값 변형에 대해 `react-hooks/immutability`(React Compiler)가 오류를 낸다. Reanimated 의
     공식 관용구이고 이 저장소의 기존 제스처 코드(`components/documents/SwipeableRow.tsx`,
     `app/scan/crop.tsx`)와 **같은 형태**다 — 규칙을 우회하려고 제스처를 매 렌더 새로 만들면
     FlashList 셀 재활용과 충돌한다. 같은 판정을 여기서도 유지한다. */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-20, 20])
        .onUpdate((e) => {
          dx.value = e.translationX;
        })
        .onEnd((e) => {
          if (e.translationX <= -SWIPE_THRESHOLD) runOnJS(change)(1);
          else if (e.translationX >= SWIPE_THRESHOLD) runOnJS(change)(-1);
          // 월이 바뀌면 새 그리드가 제자리로 미끄러져 들어오는 인상을 준다 (SCR-07: 슬라이드 250ms).
          dx.value = withTiming(0, { duration: 250 });
        }),
    [change, dx],
  );

  const gridStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));

  return (
    <View
      testID={testID}
      className="rounded-card bg-bg-elevated py-3"
    >
      {/* ── 월 네비게이션 ─────────────────────────────────────────────── */}
      <View className="mb-2 flex-row items-center justify-center gap-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 달"
          onPress={() => change(-1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <ChevronLeft color={t.text.secondary} />
        </Pressable>

        <Text
          className="text-h2 font-w700 text-text-primary"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
        >
          {matrix.label}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 달"
          onPress={() => change(1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <ChevronRight color={t.text.secondary} />
        </Pressable>
      </View>

      {/* ── 요일 헤더 ─────────────────────────────────────────────────── */}
      <View className="flex-row px-1">
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={label} className="flex-1 items-center py-1">
            <Text
              className="text-caption font-w600"
              style={{ color: weekdayColor(index) }}
              maxFontSizeMultiplier={1.1}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* ── 그리드 ────────────────────────────────────────────────────── */}
      {loading ? (
        <View className="gap-2 px-3 pt-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <Skeleton key={row} height={CELL_HEIGHT - 16} radius={8} />
          ))}
        </View>
      ) : (
        <GestureDetector gesture={pan}>
          <Animated.View style={gridStyle} className="px-1">
            {matrix.weeks.map((week, weekIndex) => (
              <View key={week[0]?.date ?? weekIndex} className="flex-row">
                {week.map((day) => {
                  const events = eventsByDate[day.date] ?? [];
                  const dots = events.slice(0, maxDots);
                  const overflow = events.length - dots.length;
                  const selected = selectedDate === day.date;

                  return (
                    <Pressable
                      key={day.date}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${day.day}일${
                        events.length > 0 ? `, 일정 ${events.length}건` : ''
                      }`}
                      onPress={() => {
                        haptics.selection();
                        onSelectDate(day.date);
                      }}
                      // 셀 상단 헤어라인 — 원본 캘린더의 격자 인상을 유지한다.
                      className="flex-1 items-center border-t border-border-subtle pt-1"
                      style={[
                        { height: CELL_HEIGHT },
                        selected ? { backgroundColor: t.calendar.selected } : null,
                      ]}
                    >
                      {/* 오늘은 요일색 원형 배지 + 흰 글씨 700 (CMP-33). */}
                      <View
                        className="items-center justify-center rounded-full"
                        style={[
                          { width: TODAY_BADGE, height: TODAY_BADGE },
                          day.isToday
                            ? {
                                backgroundColor:
                                  day.weekday === 0
                                    ? t.calendar.sunday
                                    : day.weekday === 6
                                      ? t.calendar.saturday
                                      : t.action.base,
                              }
                            : null,
                        ]}
                      >
                        <Text
                          className={`text-body-sm ${day.isToday ? 'font-w700' : 'font-w500'}`}
                          style={{ color: dayColor(day) }}
                          maxFontSizeMultiplier={1.1}
                        >
                          {day.day}
                        </Text>
                      </View>

                      {/* 이벤트 dot — 티켓/포스터 색. 4개 이상이면 `+N` (SCR-07 모바일 변경점). */}
                      <View className="mt-1 h-2 flex-row items-center justify-center gap-0.5">
                        {dots.map((event) => (
                          <View
                            key={event.key}
                            style={{
                              width: DOT_SIZE,
                              height: DOT_SIZE,
                              borderRadius: DOT_SIZE / 2,
                              backgroundColor:
                                event.type === 'TICKET' ? t.doc.TICKET.fg : t.calendar.poster,
                            }}
                          />
                        ))}
                        {overflow > 0 ? (
                          <Text
                            className="text-micro font-w600 text-text-muted"
                            maxFontSizeMultiplier={1}
                          >
                            {`+${overflow}`}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

export const MonthCalendar = memo(MonthCalendarBase);
MonthCalendar.displayName = 'MonthCalendar';

/** SCR-07 범례 — `● 티켓  ● 포스터`. 캘린더 바로 아래에 놓는다. */
export function CalendarLegend({ testID }: { testID?: string }) {
  const t = useTheme();
  const items = [
    { label: '티켓', color: t.doc.TICKET.fg },
    { label: '포스터', color: t.calendar.poster },
  ];

  return (
    <View testID={testID} className="mt-2 flex-row items-center gap-4 px-1">
      {items.map((item) => (
        <View key={item.label} className="flex-row items-center gap-1.5">
          <View
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: item.color,
            }}
          />
          <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
