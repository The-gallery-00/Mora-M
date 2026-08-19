// app/(tabs)/index.tsx
//
// SCR-06 홈 대시보드 — Phase 6 실데이터 연동본.
//
// ─────────────────────────────────────────────────────────────────────────────
// 이 화면이 부르는 API 는 **2개뿐**이다.
//   ① API-24 `GET /api/dashboard`  — 배너·통계 3종·마감 카드·오늘 일정이 전부 이 1건에 들어 있다.
//   ② API-33 `GET /api/notifications/unread-count` — 헤더 벨 배지(60초 폴링).
// 원본 웹은 `getMyCards()` + `getMyTickets(0,100)` + `getMyPosters(0,100)` 3콜을 받아 D-day·오늘
// 일정·총계를 클라이언트에서 계산했다. 서버가 이미 조립해 주는 것을 300건 파싱으로 재현할 이유가 없다
// (FR-081 · SCR-06 모바일 변경점 1행).
//
// **주간 스트립(7일 dot)을 그리지 않는 이유**: API-24 의 `todaySchedules` 는 기준일 하루치뿐이다.
// 다른 날짜의 dot 을 찍으려면 티켓·포스터 목록(각 100건)을 추가로 받아야 하고, 그 순간 홈이 3콜이
// 되어 FR-081 이 깨진다(`features/dashboard/queries.ts` 의 `useWeekStrip` 주석이 같은 경고를 한다).
// 대신 일정 섹션 우측에 와이어프레임의 `2026년 7월 >` 링크만 남기고, 월간 전체는 SCR-07(`/calendar`)이 맡는다.
//
// 헤더 벨은 Phase 0 스텁에서 `toast.info('준비 중입니다.')` 로 막혀 있었다 — 목적지(SCR-08)가
// 생겼으므로 `/notifications` 로 실제 연결하고 미읽음 배지를 붙인다.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { MoraLogo } from "@/components/brand/MoraLogo";
import {
  DEADLINE_CARD_WIDTH,
  DeadlineCard,
  dDayLabel,
  ScheduleListItem,
  STAT_TILE_MIN_HEIGHT,
  STAT_TILE_WIDTH,
  StatTile,
  WeekCalendar,
} from "@/components/dashboard";
import {
  Button,
  IconButton,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  DASHBOARD_COPY,
  toLocalDateString,
  todayString,
  useDashboard,
  useWeekStrip,
  type CalendarEvent,
  type DashboardDeadline,
} from "@/features/dashboard";
import { DOC_ROUTE_SEGMENT } from "@/features/documents";
import { ddayLabel, formatDateShortKo, href } from "@/features/documents/ArchiveList";
import { useUnreadCount } from "@/features/notifications";
import { haptics } from "@/lib/haptics";
import { HEADER_HEIGHT, tabScrollBottomPadding } from "@/navigation/shell";
import { useAuthStore } from "@/store/authStore";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/scale";

/* ── 아이콘 (lucide 미설치 → 같은 실루엣으로 인라인 SVG) ─────────────── */

/** 색은 IconButton 이 tone 에 맞춰 주입한다(cloneElement). 여기서 기본값을 두면 그 주입이 막힌다. */
function BellIcon({ color, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9.5A6 6 0 0 1 18 9.5V14L19.8 17.2H4.2L6 14V9.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M9.8 20A2.4 2.4 0 0 0 14.2 20"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * 설정이 탭바에서 빠지면서(5번째 슬롯은 캘린더가 됐다) **여기가 유일한 진입점**이다.
 * lucide `settings` 공식 path 를 그대로 쓴다 — 탭바 아이콘 5종도 같은 규격(strokeWidth 2,
 * linecap/linejoin round)으로 옮겼으므로 헤더만 옛 수제 실루엣으로 남으면 굵기가 어긋난다.
 *
 * `color` 에 **기본값을 주면 안 된다.** IconButton 은 `icon.props.color === undefined` 일 때만
 * cloneElement 로 tone 색을 주입한다(`src/components/ui/IconButton.tsx`). 위 BellIcon 과 같은 규칙.
 */

/* ── 날짜 문구 ─────────────────────────────────────────────────────── */

/** `2026-07-28` → `7월 28일` (일정 섹션 헤더). */
function formatDayHeading(iso: string): string {
  const parts = iso.split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
  return `${month}월 ${day}일`;
}

function isOngoingPoster(event: CalendarEvent, today: string): boolean {
  return (
    event.type === "POSTER" &&
    event.hasCompletePosterDateRange === true &&
    event.startDate < event.endDate &&
    event.startDate <= today &&
    today <= event.endDate
  );
}

function ongoingEndLabel(endDate: string, today: string): string {
  const dDay = ddayLabel(endDate, today);
  return dDay === "D-DAY" ? "오늘 종료" : dDay ? `종료 ${dDay}` : "";
}

/* ── 문서 4종 바로가기 ─────────────────────────────────────────────
   순서는 원본 `STORAGE_ITEMS`(명함 → 티켓 → 포스터 → 영수증) 그대로다 (Screen Specs SCR-14 §3).
   색 클래스는 tailwind 가 정적 추출하므로 문자열을 조립하지 않고 통째로 적는다.
   개수를 붙이지 않는다 — API-24 는 4종 **합계**(`storedDocumentCount`)만 준다. 종별 숫자를
   채우려면 목록 4콜이 필요하고, 그것은 FR-081(홈 1콜)을 깨뜨린다. */
/** 마감 카드 캐러셀의 스냅 간격 = 카드 폭 + 카드 사이 간격. */
const CARD_GAP = spacing.md;
const SNAP_INTERVAL = DEADLINE_CARD_WIDTH + CARD_GAP;
const EMPTY_DEADLINES: readonly DashboardDeadline[] = [];

type UpcomingSheetItem = DashboardDeadline & { time: string };

/* ── 섹션 헤더 ─────────────────────────────────────────────────────
   16/600 이다 (Design Tokens §5 `section` 롤). 16px 스케일 토큰명이 `input` 이라 클래스가
   `text-input` 이 된다 — 입력 필드와 무관하고 크기 토큰을 가리킨다. */
function SectionHeader({
  title,
  badge,
  todayTag,
  linkLabel,
  onLink,
}: {
  title: string;
  badge?: string;
  todayTag?: boolean;
  linkLabel?: string;
  onLink?: () => void;
}) {
  return (
    <View className="mb-3 mt-7 flex-row items-center gap-2">
      <Text
        className="text-h3 font-w800 text-text-primary"
        accessibilityRole="header"
      >
        {title}
      </Text>
      {todayTag ? (
        <View className="rounded-full border border-info-border bg-info-container px-2 py-0.5">
          <Text className="text-caption font-w600 text-action" maxFontSizeMultiplier={1.2}>
            오늘
          </Text>
        </View>
      ) : null}
      {badge ? (
        <View className="rounded-full bg-deadline-bg px-2 py-0.5">
          <Text
            className="text-label font-w800 text-deadline"
            maxFontSizeMultiplier={1.2}
          >
            {badge}
          </Text>
        </View>
      ) : null}
      <View className="flex-1" />
      {linkLabel && onLink ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={linkLabel}
          onPress={() => {
            haptics.selection();
            onLink();
          }}
          // body-sm 한 줄(18dp)짜리 텍스트 링크 — 44dp 하한을 hitSlop 으로 만든다(A11Y §11-1)
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text
            className="text-body-sm font-w600 text-action"
            maxFontSizeMultiplier={1.2}
          >
            {`${linkLabel} ›`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ScheduleSheetFrame({
  visible,
  title,
  description,
  count,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  description: string;
  count: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy >= 80 || gesture.vy >= 0.8) {
            onClose();
          }
        },
      }),
    [onClose],
  );

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: t.scrim }}
        accessibilityRole="button"
        accessibilityLabel={`${title} 전체 목록 닫기`}
        onPress={onClose}
      >
        <Pressable
          className="rounded-t-sheet bg-bg-elevated px-5 pt-3"
          style={{ maxHeight: "82%", paddingBottom: insets.bottom + spacing.lg }}
          accessibilityViewIsModal
          onPress={() => undefined}
        >
          <View {...panResponder.panHandlers}>
            <View className="mb-3 h-1 w-9 self-center rounded-full bg-border-subtle" />
            <View className="flex-row items-center justify-between">
              <Text
                className="text-h2 font-w700 text-text-primary"
                accessibilityRole="header"
                maxFontSizeMultiplier={1.3}
              >
                {title}
              </Text>
              <Text
                className="text-body-sm font-w700 text-action"
                maxFontSizeMultiplier={1.2}
              >
                {`총 ${count}건`}
              </Text>
            </View>
            <Text
              className="mb-4 mt-1 text-caption text-text-muted"
              maxFontSizeMultiplier={1.2}
            >
              {description}
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.md }}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ScheduleSheetListItem({
  type,
  title,
  meta,
  statusLabel,
  statusClass,
  onPress,
  testID,
}: {
  type: CalendarEvent["type"];
  title: string;
  meta: string;
  statusLabel: string;
  statusClass: "text-deadline" | "text-action";
  onPress: () => void;
  testID: string;
}) {
  const t = useTheme();
  const isTicket = type === "TICKET";
  const badgeBoxClass = isTicket ? "bg-ticket-bg" : "bg-poster-bg";
  const badgeTextClass = isTicket ? "text-ticket" : "text-poster";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${isTicket ? "티켓" : "포스터"}, ${title}, ${meta}, ${statusLabel}`}
      onPress={onPress}
      className="min-h-20 flex-row items-center rounded-card border border-border-subtle bg-bg-elevated px-4 py-3"
      style={({ pressed }) => [t.elevation.raised, pressed ? { opacity: 0.86 } : null]}
      testID={testID}
    >
      <View className="mr-3 flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center" style={{ minWidth: 0 }}>
          <View className={`mr-2 rounded-xs px-2 py-0.5 ${badgeBoxClass}`}>
            <Text
              className={`text-caption font-w600 ${badgeTextClass}`}
              maxFontSizeMultiplier={1.2}
            >
              {isTicket ? "티켓" : "포스터"}
            </Text>
          </View>
          <Text
            className="flex-1 text-base font-w700 text-text-primary"
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.2}
            style={{ minWidth: 0, flexShrink: 1 }}
          >
            {title}
          </Text>
        </View>
        <Text
          className="mt-2 text-label text-text-muted"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {meta}
        </Text>
      </View>

      <Text className={`text-base font-w800 ${statusClass}`} maxFontSizeMultiplier={1.2}>
        {statusLabel}
      </Text>
    </Pressable>
  );
}

function UpcomingScheduleSheet({
  visible,
  items,
  onClose,
  onOpenItem,
}: {
  visible: boolean;
  items: readonly UpcomingSheetItem[];
  onClose: () => void;
  onOpenItem: (item: DashboardDeadline) => void;
}) {
  if (!visible) return null;

  return (
    <ScheduleSheetFrame
      visible
      title="다가오는 일정"
      description="2주 내 일정을 보여드려요."
      count={items.length}
      onClose={onClose}
    >
      {items.map((item) => {
        const isTicket = item.type === "TICKET";
        const label = dDayLabel(item.dDay);
        const dateAndTime = `${formatDateShortKo(item.date)}${
          isTicket && item.time ? ` · ${item.time}` : ""
        }`;

        return (
          <ScheduleSheetListItem
            key={item.key}
            type={item.type}
            title={item.title}
            meta={dateAndTime}
            statusLabel={label}
            statusClass={item.dDay <= 3 ? "text-deadline" : "text-action"}
            onPress={() => {
              onClose();
              onOpenItem(item);
            }}
            testID={`upcoming-sheet-${item.key}`}
          />
        );
      })}
    </ScheduleSheetFrame>
  );
}

function OngoingScheduleSheet({
  visible,
  items,
  currentDate,
  onClose,
  onOpenItem,
}: {
  visible: boolean;
  items: readonly CalendarEvent[];
  currentDate: string;
  onClose: () => void;
  onOpenItem: (item: CalendarEvent) => void;
}) {
  if (!visible) return null;

  return (
    <ScheduleSheetFrame
      visible
      title="진행 중"
      description="현재 진행 중인 일정을 보여드려요."
      count={items.length}
      onClose={onClose}
    >
      {items.map((item) => {
        const endLabel = ongoingEndLabel(item.endDate, currentDate);
        const dateAndOrganizer = `${formatDateShortKo(item.endDate)}${
          item.subtitle ? ` · ${item.subtitle}` : ""
        }`;

        return (
          <ScheduleSheetListItem
            key={item.key}
            type={item.type}
            title={item.title}
            meta={dateAndOrganizer}
            statusLabel={endLabel}
            statusClass="text-deadline"
            onPress={() => {
              onClose();
              onOpenItem(item);
            }}
            testID={`ongoing-sheet-${item.key}`}
          />
        );
      })}
    </ScheduleSheetFrame>
  );
}

/* ── 스켈레톤 (배너 / 타일 / 카드 3블록 — SCR-06 상태 표 "초기") ────── */

function HomeSkeleton({ slow }: { slow: boolean }) {
  return (
    <View>
      {/* 치수를 적지 않고 StatTile 상수를 쓴다 — 예전에 여기 하드코딩된 96 이 실제 타일 높이와
          어긋나 있었고, 그 어긋남이 통계 타일 잘림 버그의 표식이었다. */}
      <View className="flex-row gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            width={STAT_TILE_WIDTH}
            height={STAT_TILE_MIN_HEIGHT}
            radius={12}
          />
        ))}
      </View>
      <View className="mt-7 flex-row gap-3">
        {[0, 1].map((i) => (
          <Skeleton
            key={i}
            width={DEADLINE_CARD_WIDTH}
            height={120}
            radius={12}
          />
        ))}
      </View>
      {slow ? (
        <Text className="mt-4 text-center text-body-sm text-text-muted">
          불러오는 중...
        </Text>
      ) : null}
    </View>
  );
}

/* ── 화면 ───────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const dashboard = useDashboard();
  const unread = useUnreadCount();

  const data = dashboard.data;
  const { refetch: refetchDashboard, isStale: dashboardStale } = dashboard;
  const { refetch: refetchUnread, isStale: unreadStale } = unread;

  // SCR-06 데이터 표: 화면 포커스 시 재요청. staleTime(2분) 안이면 네트워크를 타지 않는다.
  useFocusEffect(
    useCallback(() => {
      if (dashboardStale) void refetchDashboard();
      if (unreadStale) void refetchUnread();
    }, [dashboardStale, refetchDashboard, refetchUnread, unreadStale]),
  );

  // 로딩 3초 초과 시 `불러오는 중...` (상태 표 "로딩").
  const [slow, setSlow] = useState(false);
  const isPending = dashboard.isPending;
  useEffect(() => {
    if (!isPending) return undefined;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [isPending]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.impact("light");
    void Promise.all([refetchDashboard(), refetchUnread()])
      .then(([result]) => {
        // 실패해도 기존 데이터는 유지된다 — 토스트로만 알린다 (SCR-06 인터랙션 표).
        if (result.isError) toast.error(DASHBOARD_COPY.refreshFailed);
      })
      .finally(() => setRefreshing(false));
  }, [refetchDashboard, refetchUnread]);

  const openDeadline = useCallback(
    (item: DashboardDeadline) => {
      // 서버가 문자열 id 를 주므로 보관함 PK(Integer)로 되돌리지 못하는 경우가 있다.
      if (item.documentId === null) {
        toast.error(DASHBOARD_COPY.documentMissing);
        return;
      }
      router.push(
        href(`/doc/${DOC_ROUTE_SEGMENT[item.type]}/${item.documentId}`),
      );
    },
    [router],
  );

  // 아바타 이니셜 — 이름이 없으면 원본 폴백 `U` (Screen Specs SCR-06 구성 요소).
  const initial = user?.name?.trim().charAt(0) || "U";

  const baseDate = data?.date || todayString();
  const deadlines = data?.upcomingDeadlines ?? EMPTY_DEADLINES;
  const [upcomingSheetVisible, setUpcomingSheetVisible] = useState(false);
  const [ongoingSheetVisible, setOngoingSheetVisible] = useState(false);
  const [selectedWeekDate, setSelectedWeekDate] = useState(() => todayString());
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const currentDate = toLocalDateString(currentTime);
  const { days: weekDays, eventsByDate: weekEventsByDate } = useWeekStrip(baseDate);
  const selectedDateEvents = weekEventsByDate[selectedWeekDate] ?? [];
  const selectedScheduleCount = selectedDateEvents.length;
  const ongoingEvents = useMemo(() => {
    const uniqueEvents = new Map<string, CalendarEvent>();
    for (const events of Object.values(weekEventsByDate)) {
      for (const event of events) uniqueEvents.set(event.key, event);
    }
    return [...uniqueEvents.values()]
      .filter((event) => isOngoingPoster(event, currentDate))
      .sort((a, b) => a.endDate.localeCompare(b.endDate));
  }, [currentDate, weekEventsByDate]);
  const upcomingSheetItems = useMemo<UpcomingSheetItem[]>(() => {
    return deadlines
      .map((item) => {
        const calendarEvent = (weekEventsByDate[item.date] ?? []).find(
          (event) => event.key === item.key,
        );
        return {
          ...item,
          time: item.type === "TICKET" ? (calendarEvent?.time ?? "") : "",
        };
      })
      .sort((a, b) => {
        const dateOrder = a.date.localeCompare(b.date);
        if (dateOrder !== 0) return dateOrder;

        if (a.type === "TICKET" && b.type === "TICKET") {
          const timeOrder = (a.time || "99:99").localeCompare(b.time || "99:99");
          if (timeOrder !== 0) return timeOrder;
        } else if (a.type !== b.type) {
          return a.type === "TICKET" ? -1 : 1;
        }

        return a.title.localeCompare(b.title, "ko");
      });
  }, [deadlines, weekEventsByDate]);

  const openCalendarEvent = useCallback(
    (event: CalendarEvent) => {
      router.push(href(`/doc/${DOC_ROUTE_SEGMENT[event.type]}/${event.id}`));
    },
    [router],
  );

  return (
    <View className="flex-1 bg-bg-base">
      {/* ── 헤더 (CMP-20). 커스텀 헤더이므로 상단 inset 은 여기서만 먹인다 (UX 가이드 §3 규칙 2) ── */}
      <View
        className="flex-row items-center justify-between px-4"
        style={{ paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }}
      >
        <MoraLogo variant="full" size={24} />

        <View className="flex-row items-center gap-1">
          <IconButton
            icon={<BellIcon />}
            accessibilityLabel={
              unread.count > 0 ? `알림 ${unread.count}건` : "알림"
            }
            badgeCount={unread.count}
            haptic
            onPress={() => router.push(href("/notifications"))}
            testID="home-bell"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="내 계정"
            onPress={() => router.push("/(tabs)/settings")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="h-8 w-8 items-center justify-center rounded-full bg-brand"
          >
            <Text className="text-body-sm font-w700 text-text-inverse">
              {initial}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          // 탭바 + 제스처바에 콘텐츠가 가리지 않게 한다 (UX 가이드 §3 규칙 3).
          paddingBottom: tabScrollBottomPadding(insets.bottom),
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ── 에러 (상태 표 "에러": 상단 인라인 에러 카드 + 다시 시도) ──
            원본은 `res.success === false` 를 빈 배열로 삼켰다. 상용 앱에선 부적절하다. */}
        {dashboard.isError ? (
          <View
            className="mt-2 items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
            accessibilityLiveRegion="polite"
          >
            <Text
              className="text-center text-base font-w600 text-danger"
              maxFontSizeMultiplier={1.3}
            >
              {dashboard.error?.message ?? DASHBOARD_COPY.loadFailed}
            </Text>
            <Button
              label="다시 시도"
              onPress={() => void refetchDashboard()}
              variant="secondary"
              size="sm"
            />
          </View>
        ) : null}

        {dashboard.isPending ? (
          <View className="mt-2">
            <HomeSkeleton slow={slow} />
          </View>
        ) : null}

        <WeekCalendar
          days={weekDays}
          selectedDate={selectedWeekDate}
          eventsByDate={weekEventsByDate}
          onSelectDate={setSelectedWeekDate}
          testID="home-week-calendar"
        />
        {data ? (
          <>
            <SectionHeader
              title={`${formatDayHeading(selectedWeekDate)} 일정`}
              todayTag={selectedWeekDate === todayString()}
              {...(selectedScheduleCount > 0
                ? { badge: `${selectedScheduleCount}건` }
                : {})}
            />
            {selectedScheduleCount === 0 ? (
              <View className="items-center rounded-card border border-border-subtle bg-bg-elevated py-8">
                <Text className="text-body-sm text-text-muted" maxFontSizeMultiplier={1.3}>
                  {DASHBOARD_COPY.emptySchedules}
                </Text>
              </View>
            ) : (
              <View className="rounded-card">
                {selectedDateEvents.map((item, index) => (
                  <View key={item.key}>
                    {index > 0 ? <View className="h-px bg-bg-base" /> : null}
                    <ScheduleListItem
                      docType={item.type}
                      title={item.title}
                      {...(item.time ? { time: item.time } : {})}
                      {...(item.subtitle ? { subtitle: item.subtitle } : {})}
                      style={{
                        borderTopLeftRadius: index === 0 ? radius.card : 0,
                        borderTopRightRadius: index === 0 ? radius.card : 0,
                        borderBottomLeftRadius:
                          index === selectedDateEvents.length - 1 ? radius.card : 0,
                        borderBottomRightRadius:
                          index === selectedDateEvents.length - 1 ? radius.card : 0,
                      }}
                      onPress={() => openCalendarEvent(item)}
                      testID={`schedule-${item.key}`}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}

        {data ? (
          <>
            <SectionHeader
              title="다가오는 일정"
              {...(deadlines.length > 0
                ? {
                    badge: `${deadlines.length}건`,
                    linkLabel: "전체",
                    onLink: () => setUpcomingSheetVisible(true),
                  }
                : {})}
            />

            {deadlines.length === 0 ? (
              <View className="items-center rounded-card border border-border-subtle bg-bg-elevated py-8">
                <Text
                  className="text-body-sm text-text-muted"
                  maxFontSizeMultiplier={1.3}
                >
                  {DASHBOARD_COPY.emptyDeadlines}
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                decelerationRate="fast"
                style={{ marginHorizontal: -16 }}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  gap: CARD_GAP,
                }}
              >
                {deadlines.map((item) => (
                  <DeadlineCard
                    key={item.key}
                    docType={item.type}
                    title={item.title}
                    {...(item.subtitle ? { subtitle: item.subtitle } : {})}
                    dateLabel={formatDateShortKo(item.date)}
                    dDay={item.dDay}
                    imageUri={item.thumbnailUrl}
                    onPress={() => openDeadline(item)}
                    testID={`deadline-${item.key}`}
                  />
                ))}
              </ScrollView>
            )}
          </>
        ) : null}

        {data ? (
          <>
            <SectionHeader
              title="진행 중"
              {...(ongoingEvents.length > 0
                ? {
                    badge: `${ongoingEvents.length}건`,
                    linkLabel: "전체",
                    onLink: () => setOngoingSheetVisible(true),
                  }
                : {})}
            />
            {ongoingEvents.length === 0 ? (
              <View className="items-center rounded-card border border-border-subtle bg-bg-elevated py-8">
                <Text className="text-body-sm text-text-muted" maxFontSizeMultiplier={1.3}>
                  진행 중인 일정이 없습니다
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                decelerationRate="fast"
                style={{ marginHorizontal: -16 }}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  gap: CARD_GAP,
                }}
              >
                {ongoingEvents.map((item) => {
                  const endLabel = ongoingEndLabel(item.endDate, currentDate);

                  return (
                    <DeadlineCard
                      key={item.key}
                      docType={item.type}
                      title={item.title}
                      {...(item.subtitle ? { subtitle: item.subtitle } : {})}
                      dateLabel={formatDateShortKo(item.endDate)}
                      statusLabel={endLabel}
                      onPress={() => openCalendarEvent(item)}
                      testID={`ongoing-${item.key}`}
                    />
                  );
                })}
              </ScrollView>
            )}
          </>
        ) : null}
      </ScrollView>

      <UpcomingScheduleSheet
        visible={upcomingSheetVisible}
        items={upcomingSheetItems}
        onClose={() => setUpcomingSheetVisible(false)}
        onOpenItem={openDeadline}
      />
      <OngoingScheduleSheet
        visible={ongoingSheetVisible}
        items={ongoingEvents}
        currentDate={currentDate}
        onClose={() => setOngoingSheetVisible(false)}
        onOpenItem={openCalendarEvent}
      />
    </View>
  );
}
