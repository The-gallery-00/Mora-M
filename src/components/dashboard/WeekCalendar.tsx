import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { WEEKDAY_LABELS, type CalendarDay, type CalendarEvent } from '@/features/dashboard';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export interface WeekCalendarProps {
  days: readonly CalendarDay[];
  selectedDate: string;
  eventsByDate: Record<string, CalendarEvent[]>;
  onSelectDate: (date: string) => void;
  testID?: string;
}

const TODAY_BADGE = 28;
const DOT_SIZE = 5;
const MAX_DOTS = 3;

function WeekCalendarBase({
  days,
  selectedDate,
  eventsByDate,
  onSelectDate,
  testID,
}: WeekCalendarProps) {
  const t = useTheme();

  const weekdayColor = useCallback(
    (weekday: number): string =>
      weekday === 0 ? t.calendar.sunday : weekday === 6 ? t.calendar.saturday : t.text.disabled,
    [t],
  );

  const dayColor = useCallback(
    (day: CalendarDay): string => {
      if (day.isToday) return t.text.inverse;
      if (day.weekday === 0) return t.calendar.sunday;
      if (day.weekday === 6) return t.calendar.saturday;
      return t.text.primary;
    },
    [t],
  );

  return (
    <>
      <View testID={testID} className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label, weekday) => (
          <View key={label} className="flex-1 items-center py-1">
            <Text
              className="text-caption font-w600"
              style={{ color: weekdayColor(weekday) }}
              maxFontSizeMultiplier={1.1}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row">
        {days.map((day) => {
          const events = eventsByDate[day.date] ?? [];
          const dots = events.slice(0, MAX_DOTS);
          const overflow = events.length - dots.length;
          const selected = selectedDate === day.date;

          return (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${day.day}일${events.length > 0 ? `, 일정 ${events.length}건` : ''}`}
              onPress={() => {
                haptics.selection();
                onSelectDate(day.date);
              }}
              className="flex-1 items-center border-t border-border-subtle pb-3 pt-1"
              style={selected ? { backgroundColor: t.calendar.selected } : null}
            >
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

              <View className="mt-1 h-2 flex-row items-center justify-center gap-0.5">
                {dots.map((event) => (
                  <View
                    key={event.key}
                    style={{
                      width: DOT_SIZE,
                      height: DOT_SIZE,
                      borderRadius: DOT_SIZE / 2,
                      backgroundColor: event.type === 'TICKET' ? t.doc.TICKET.fg : t.calendar.poster,
                    }}
                  />
                ))}
                {overflow > 0 ? (
                  <Text className="text-micro font-w600 text-text-muted" maxFontSizeMultiplier={1}>
                    {`+${overflow}`}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      </View>

      <View className="mt-2 flex-row items-center gap-4 px-1">
        <View className="flex-row items-center gap-1.5">
          <View
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: t.doc.TICKET.fg,
            }}
          />
          <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
            티켓
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: t.calendar.poster,
            }}
          />
          <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
            포스터
          </Text>
        </View>
      </View>
    </>
  );
}

export const WeekCalendar = memo(WeekCalendarBase);
WeekCalendar.displayName = 'WeekCalendar';
