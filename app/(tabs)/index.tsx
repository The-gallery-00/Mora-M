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
import { useCallback, useEffect, useState } from "react";
import {
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
  ScheduleListItem,
  STAT_TILE_MIN_HEIGHT,
  STAT_TILE_WIDTH,
  StatTile,
  WeekCalendar,
} from "@/components/dashboard";
import {
  Button,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  DASHBOARD_COPY,
  monthLabel,
  todayString,
  useDashboard,
  useWeekStrip,
  type CalendarEvent,
  type DashboardDeadline,
  type DashboardSchedule,
} from "@/features/dashboard";
import { DOC_ROUTE_SEGMENT } from "@/features/documents";
import { formatDateShortKo, href } from "@/features/documents/ArchiveList";
import { useUnreadCount } from "@/features/notifications";
import { haptics } from "@/lib/haptics";
import { HEADER_HEIGHT, tabScrollBottomPadding } from "@/navigation/shell";
import { useAuthStore } from "@/store/authStore";
import { spacing } from "@/theme/scale";

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

/* ── 문서 4종 바로가기 ─────────────────────────────────────────────
   순서는 원본 `STORAGE_ITEMS`(명함 → 티켓 → 포스터 → 영수증) 그대로다 (Screen Specs SCR-14 §3).
   색 클래스는 tailwind 가 정적 추출하므로 문자열을 조립하지 않고 통째로 적는다.
   개수를 붙이지 않는다 — API-24 는 4종 **합계**(`storedDocumentCount`)만 준다. 종별 숫자를
   채우려면 목록 4콜이 필요하고, 그것은 FR-081(홈 1콜)을 깨뜨린다. */
/** 마감 카드 캐러셀의 스냅 간격 = 카드 폭 + 카드 사이 간격. */
const CARD_GAP = spacing.md;
const SNAP_INTERVAL = DEADLINE_CARD_WIDTH + CARD_GAP;

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

  const openSchedule = useCallback(
    (item: DashboardSchedule) => {
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
  const deadlines = data?.upcomingDeadlines ?? [];
  const schedules = data?.todaySchedules ?? [];
  const now = new Date();
  const [selectedWeekDate, setSelectedWeekDate] = useState(() => todayString());
  const { days: weekDays, eventsByDate: weekEventsByDate } = useWeekStrip(baseDate);
  const selectedDateEvents = weekEventsByDate[selectedWeekDate] ?? [];
  const selectedScheduleCount = selectedDateEvents.length;

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
        ) : data ? (
          <>
            {/* ── 통계 타일 3개 (가로 스크롤) ──
                390dp 에서 4분할은 칸당 90dp 라 숫자+라벨이 안 들어간다 → 3개 가로 스크롤이다.

                `alignItems: 'stretch'` 는 기본값이지만 **명시한다.** 세 타일의 높이를 서로 맞추는
                유일한 장치이기 때문이다 — 한 타일이 (큰 글꼴 배율 등으로) 더 커지면 나머지 둘이
                따라 늘어난다. 여기서 `alignItems: 'flex-start'` 로 바꾸면 세 타일 높이가 어긋나고,
                캐러셀이 잰 높이보다 큰 타일은 잘린다. */}
            <View
              style={{
                width: "100%",
                flexDirection: "row",
                gap: CARD_GAP,
                marginTop: spacing.sm,
                minHeight: STAT_TILE_MIN_HEIGHT,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <StatTile
                  icon="📅"
                  tone="schedule"
                  label="오늘 일정"
                  value={data.todayScheduleCount}
                  unit="건"
                  hint="예정된 일정"
                  style={{ width: "100%" }}
                  onPress={() => router.push(href("/calendar"))}
                  testID="stat-today"
                />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <StatTile
                  icon="⏰"
                  tone="deadline"
                  label="마감 임박"
                  value={data.upcomingDeadlineCount}
                  unit="건"
                  hint={`${data.deadlineDays}일 이내 마감`}
                  style={{ width: "100%" }}
                  onPress={() => router.push(href("/calendar"))}
                  testID="stat-deadline"
                />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <StatTile
                  icon="📄"
                  tone="stored"
                  label="보관 문서"
                  value={data.storedDocumentCount}
                  unit="건"
                  hint="전체 저장 문서"
                  style={{ width: "100%" }}
                  onPress={() => router.push("/(tabs)/archive")}
                  testID="stat-stored"
                />
              </View>
            </View>

            {dashboard.isBrandNew ? (
              /* ── 빈(전체 신규 유저) — 통계 전부 0 ── */
              <View className="mt-6 rounded-card border border-border-subtle bg-bg-elevated">
                <EmptyState
                  title="아직 저장된 문서가 없어요"
                  description="첫 문서를 스캔하고 MORA를 시작해 보세요."
                  actionLabel="문서 스캔하기"
                  onAction={() => router.push("/scan")}
                  testID="home-empty"
                />
              </View>
            ) : (
              <>
                {/* ── 마감 임박 ── */}
                <SectionHeader
                  title="마감 임박"
                  {...(deadlines.length > 0
                    ? { badge: `${deadlines.length}건` }
                    : {})}
                />

                {deadlines.length === 0 ? (
                  <View className="h-24 items-center justify-center rounded-card border border-dashed border-border-subtle">
                    <Text
                      className="text-body-sm text-text-muted"
                      maxFontSizeMultiplier={1.3}
                    >
                      {DASHBOARD_COPY.emptyDeadlines}
                    </Text>
                  </View>
                ) : (
                  /* FlashList 를 쓰지 않는다 — 세로 ScrollView 안에 가로 가상 리스트를 넣으면
                     중첩 스크롤 경고와 측정 충돌이 난다. 항목 수가 마감 윈도우(30일) 안쪽으로
                     제한돼 있어 가상화 이득도 없다. 스냅 간격만 스펙대로 맞춘다. */
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

                {/* ── 오늘 일정 ──
                    우측 링크는 SCR-06 와이어프레임의 `2026년 7월 >` 이다. 월간 전체는 SCR-07 이 맡는다. */}
                {false ? (
                <>
                <SectionHeader
                  title={`${formatDayHeading(baseDate)} 일정`}
                  {...(schedules.length > 0
                    ? { badge: `${schedules.length}건` }
                    : {})}
                  linkLabel={monthLabel(now.getFullYear(), now.getMonth() + 1)}
                  onLink={() => router.push(href("/calendar"))}
                />

                {schedules.length === 0 ? (
                  <View className="items-center rounded-card border border-border-subtle bg-bg-elevated py-8">
                    <Text
                      className="text-body-sm text-text-muted"
                      maxFontSizeMultiplier={1.3}
                    >
                      {DASHBOARD_COPY.emptySchedules}
                    </Text>
                  </View>
                ) : (
                  <View className="overflow-hidden rounded-card">
                    {schedules.map((item, index) => (
                      <View key={item.key}>
                        {index > 0 ? (
                          <View className="h-px bg-bg-base" />
                        ) : null}
                        <ScheduleListItem
                          docType={item.type}
                          title={item.title}
                          {...(item.time ? { time: item.time } : {})}
                          onPress={() => openSchedule(item)}
                          testID={`schedule-${item.key}`}
                        />
                      </View>
                    ))}
                  </View>
                )}
                </>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {/* ── 문서 4종 바로가기 → 보관함(SCR-14)의 해당 유형 필터 ── */}
        {/*
        <Text
          className="mb-3 mt-7 text-input font-w600 text-text-primary"
          accessibilityRole="header"
        >
          문서 유형
        </Text>
        <View className="flex-row flex-wrap gap-3">
          {DOC_SHORTCUTS.map((doc) => (
            <Pressable
              key={doc.type}
              accessibilityRole="button"
              accessibilityLabel={`${doc.label} 보관함 열기`}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/archive",
                  params: { type: doc.type },
                })
              }
              // 2열 그리드 — 47% 두 칸 + gap 12 가 한 줄에 들어가고 남는 폭은 grow 가 나눠 갖는다
              className={`h-20 grow basis-[47%] justify-end rounded-card p-4 ${doc.box}`}
            >
              <Text className={`text-h3 font-w700 ${doc.text}`}>
                {doc.label}
              </Text>
            </Pressable>
          ))}
        </View>
        */}

        {false ? (
        <>
        {/* ── 주 CTA. 용어집(§7-4)상 등록 진입은 `스캔하기` 다 ── */}
        <Button
          label="스캔하기"
          onPress={() => router.push("/scan")}
          variant="primary"
          size="lg"
          fullWidth
          haptic="medium"
          style={{ marginTop: 28 }}
        />
        </>
        ) : null}

        <SectionHeader
          title="이번 주"
        />
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
              <View className="overflow-hidden rounded-card">
                {selectedDateEvents.map((item, index) => (
                  <View key={item.key}>
                    {index > 0 ? <View className="h-px bg-bg-base" /> : null}
                    <ScheduleListItem
                      docType={item.type}
                      title={item.title}
                      {...(item.time ? { time: item.time } : {})}
                      onPress={() => openCalendarEvent(item)}
                      testID={`schedule-${item.key}`}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}
        <Button
          label="스캔하기"
          onPress={() => router.push("/scan")}
          variant="primary"
          size="lg"
          fullWidth
          haptic="medium"
          style={{ marginTop: 28 }}
        />
      </ScrollView>
    </View>
  );
}
