// app/(tabs)/_layout.tsx
//
// 하단 탭 4개(홈·보관함·검색·캘린더) + 중앙 스캔 액션 = 5슬롯. 정본: wiki/design/Navigation Map.md §3.
//
// **설정은 더 이상 탭이 아니다.** 5번째 슬롯이 캘린더로 바뀌었고, 설정은 홈 헤더에서만 들어온다.
// 화면 파일은 `app/(tabs)/settings/index.tsx` 에 그대로 두고 `href: null` 로 **탭바 칸만** 없앤다 —
// 라우트 `/settings` 가 살아 있어야 홈 헤더 push 와 DL-02 캘린더 콜백 착지가 깨지지 않는다.
//
// 중앙 슬롯은 **탭 화면이 아니라 액션**이다. `scan.tsx` 는 렌더되지 않는 플레이스홀더이고,
// `tabPress` 를 가로채 `/scan`(fullScreenModal)을 push 한다 — 탭 상태를 오염시키지 않기 위한 규정이다.
//
// 인증 가드는 이 레이아웃과 `(auth)/_layout` **두 곳에만** 둔다 (Navigation Map §6-3 규칙 1).
//
// 탭 재선택(Navigation Map §8 "탭 스택 리셋 규칙"): 현재 4개 탭은 모두 스택이 없는 단일 화면이라
// "루트로 pop" 이 성립하지 않는다. 남은 규칙인 "리스트 최상단으로 스크롤"은 목록이 실제로 생기는
// Phase 4/5 에서 각 탭 화면이 `useScrollToTop`(expo-router 재export)으로 붙인다 — 리스트 ref 를
// 소유한 화면이 할 일이지 레이아웃이 대신할 수 없다. 세 번째 슬롯(스캔)은 언제나 예외(항상 새 모달)다.
//
// 아이콘: lucide-react-native 는 설치되어 있지 않으므로(패키지 추가 금지) lucide 공식 아이콘
// `house` / `folder-open` / `scan-line` / `search` / `calendar` 의 **path 데이터를 그대로**
// react-native-svg 로 옮겼다. lucide 기본 렌더 규격(viewBox 0 0 24 24, strokeWidth 2,
// strokeLinecap/strokeLinejoin round)도 같이 따른다 — 그래야 실루엣이 디자인과 픽셀로 일치한다.
// stroke·strokeWidth 는 `<Svg>` 루트에 한 번만 주고 자식이 상속받는다.
// SVG stroke 는 className 이 닿지 않아 색은 탭바가 주는 tint 값을 쓴다.
import { Redirect, useFocusEffect, usePathname, useRouter } from 'expo-router';
// SDK 57 에서 `expo-router` 의 `Tabs` re-export 는 deprecated 다 → 정식 경로로 가져온다.
// (위키 §3 코드 발췌의 `from 'expo-router'` 는 SDK 54 시점 표기다.)
import { Tabs } from 'expo-router/js-tabs';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  BackHandler,
  Pressable,
  View,
  type ColorValue,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { SCAN_BUTTON_LIFT, SCAN_BUTTON_SIZE, TAB_BAR_HEIGHT } from '@/navigation/shell';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, fontScale } from '@/theme/scale';

/* ── 탭 아이콘 ─────────────────────────────────────────────────────────── */

type TabIconProps = { color: ColorValue; size?: number };

/** ColorValue 는 문자열이 아닐 수 있다(OpaqueColorValue) → SVG 에 넘길 문자열로 좁힌다. */
const toStroke = (color: ColorValue): string => String(color);

/** lucide `house` (https://lucide.dev/icons/house) — path 원문 그대로. */
function HomeIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={toStroke(color)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

/** lucide `folder-open` (https://lucide.dev/icons/folder-open) — path 원문 그대로(단일 path). */
function ArchiveIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={toStroke(color)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}

/** lucide `scan-line` (https://lucide.dev/icons/scan-line) — path 원문 그대로. 중앙 스캔 버튼 전용. */
function ScanIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={toStroke(color)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <Path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <Path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <Path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <Path d="M7 12h10" />
    </Svg>
  );
}

/** lucide `search` (https://lucide.dev/icons/search) — path 원문 그대로. */
function SearchIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={toStroke(color)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m21 21-4.34-4.34" />
      <Circle cx={11} cy={11} r={8} />
    </Svg>
  );
}

/** lucide `calendar` (https://lucide.dev/icons/calendar) — path 원문 그대로. 5번째 탭(설정 자리 대체). */
function CalendarIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={toStroke(color)}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M8 2v4" />
      <Path d="M16 2v4" />
      <Rect width={18} height={18} x={3} y={4} rx={2} />
      <Path d="M3 10h18" />
    </Svg>
  );
}

/* ── 탭 아이콘 활성 전환 (MOT-12) ───────────────────────────────────────
   Mobile UX Guide §8: `color + scale 1→1.08→1 / 150ms / standard [0.2,0,0,1]`.
   색은 탭 내비게이터가 `tabBarActiveTintColor` 로 이미 바꾸므로 여기서는 스케일만 맡는다.

   §8 전역 규칙 1 — `Reduce Motion` 이면 transform 을 아예 걸지 않는다.
   최초 마운트(앱을 켜자마자 홈이 활성)에서는 튀지 않아야 하므로 첫 렌더는 건너뛴다. */
const TAB_PULSE_MS = 75; // 1→1.08→1 왕복 합계 150ms
const STANDARD_EASING = Easing.bezier(0.2, 0, 0, 1);

function TabIcon({
  focused,
  children,
}: {
  focused: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!focused || reduceMotion) return;
    scale.value = withSequence(
      withTiming(1.08, { duration: TAB_PULSE_MS, easing: STANDARD_EASING }),
      withTiming(1, { duration: TAB_PULSE_MS, easing: STANDARD_EASING }),
    );
  }, [focused, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

/* ── 중앙 스캔 버튼 ─────────────────────────────────────────────────────
   Navigation Map §3: 56dp 원형, 배경 action(#0077B6 = 원본 point), 아이콘 흰색,
   elevation.sheet, 탭바 상단으로 12dp 돌출. 라벨이 없으므로 accessibilityLabel 필수. */
function ScanTabButton({ onPress }: { onPress?: (event: GestureResponderEvent) => void }) {
  const t = useTheme();

  return (
    // 돌출분(12dp)이 탭바 밖으로 나가야 하므로 슬롯은 클리핑하지 않는다.
    <View className="flex-1 items-center justify-start" pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="문서 스캔"
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="items-center justify-center rounded-full"
        style={[
          // elevation 은 backgroundColor 를 함께 들고 오므로 뒤에서 덮어쓴다 (Design Tokens §10-6 규칙 1).
          t.elevation.sheet,
          {
            width: SCAN_BUTTON_SIZE,
            height: SCAN_BUTTON_SIZE,
            marginTop: -SCAN_BUTTON_LIFT,
            backgroundColor: t.action.base,
          },
        ]}
      >
        <ScanIcon color={t.text.inverse} size={26} />
      </Pressable>
    </View>
  );
}

/* ── 하드웨어 뒤로가기 정책 ─────────────────────────────────────────────
   Mobile UX Guide §4: 홈 탭 루트에서만 "두 번 눌러 종료", 나머지 탭 루트는 홈 탭으로 이동한다.
   보관함 종별 화면처럼 숨겨진 하위 탭은 이 정책이 소비하지 않고 Tabs history 의 기본 뒤로가기에
   맡긴다. 그래야 `/archive/tickets` 에서 직전의 `/archive` 로 돌아갈 수 있다.
   (다른 탭에서 앱이 종료되면 사용자가 데이터를 잃었다고 느낀다 — §4 구현 노트)

   `useFocusEffect` 를 쓰는 이유: `/scan` 같은 루트 스택 모달이 위에 올라오면 이 레이아웃은
   포커스를 잃고 리스너가 해제된다. 그래야 모달의 자체 백 가드(SCR-09/12)가 가려지지 않는다. */
const TAB_ROOT_PATHS = new Set(['/', '/archive', '/search', '/calendar', '/settings']);

function useTabsBackPolicy(): void {
  const router = useRouter();
  // 그룹 세그먼트 `(tabs)` 는 경로에 나타나지 않는다.
  const pathname = usePathname();
  const isHomeTab = pathname === '/';
  const isTabRoot = TAB_ROOT_PATHS.has(pathname);

  useFocusEffect(
    useCallback(() => {
      let exitArmed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        // 숨김 하위 화면은 `backBehavior="history"` 가 기록한 실제 직전 탭으로 돌아간다.
        if (!isTabRoot) return false;

        if (!isHomeTab) {
          router.navigate('/(tabs)');
          return true;
        }
        // 루트 Stack 에 이전 엔트리가 남아 있어도 Tabs history 로 돌아가지 않고 앱을 종료한다.
        if (exitArmed) {
          BackHandler.exitApp();
          return true;
        }

        exitArmed = true;
        toast.info('한 번 더 누르면 종료됩니다', { haptic: false });
        timer = setTimeout(() => {
          exitArmed = false;
        }, 2000);
        return true;
      });

      return () => {
        subscription.remove();
        if (timer) clearTimeout(timer);
      };
    }, [isHomeTab, isTabRoot, router]),
  );
}

/* ── 탭 레이아웃 ───────────────────────────────────────────────────────── */

/**
 * HAP-01 — 탭 전환. 네 탭이 같은 객체를 공유한다(화면마다 다른 세기를 쓰지 않기 위해).
 * 중앙 스캔 슬롯은 탭이 아니라 액션이라 HAP-06(Medium)을 따로 준다.
 *
 * `preventDefault` 를 부르지 않으므로 내비게이션 동작은 그대로다.
 */
const TAB_PRESS_HAPTIC = {
  tabPress: () => {
    haptics.selection();
  },
};

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  // 조기 return 앞에 둔다 — 훅 호출 순서는 렌더마다 같아야 한다.
  useTabsBackPolicy();

  // 스플래시가 아직 떠 있는 구간이다. 여기서 화면을 그리면 판정 전 보호 화면이 노출된다.
  if (status === 'booting') return null;
  if (status !== 'authenticated') return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false, // 화면별 커스텀 헤더 (UX-05)
        tabBarActiveTintColor: t.action.base,
        tabBarInactiveTintColor: t.text.muted,
        tabBarStyle: {
          // 탭바 점유 높이 = 56 + 제스처바 (Mobile UX Guide §3 규칙 3)
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
          backgroundColor: t.bg.base,
          borderTopColor: t.border.subtle,
          borderTopWidth: 1,
          // 중앙 버튼의 돌출분이 잘리지 않게 한다.
          overflow: 'visible',
        },
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: {
          fontFamily: fontFamily.semibold,
          fontSize: fontScale.micro.size,
          lineHeight: fontScale.micro.line,
        },
        // 큰 글씨 설정에서 라벨이 줄바꿈되면 5슬롯 정렬이 깨진다 → 라벨만 스케일을 고정하고
        // 정보는 아이콘 + accessibilityLabel 이 중복으로 전달한다.
        tabBarAllowFontScaling: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarAccessibilityLabel: '홈',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <HomeIcon color={color} size={size} />
            </TabIcon>
          ),
        }}
        listeners={TAB_PRESS_HAPTIC}
      />

      {/*
        `archive/` 폴더에 _layout.tsx 가 없으므로 라우트는 이 탭 내비게이터로 hoist 되고
        스크린 이름이 `archive/index` 가 된다 (expo-router: "routes in directories without
        _layout files are hoisted to the nearest _layout").
        → Phase 4 에서 archive/cards|tickets|posters|receipts 를 추가할 때는 각각
          `<Tabs.Screen name="archive/cards" options={{ href: null }} />` 로 선언해
          탭바에 새 칸이 생기지 않게 해야 한다.
      */}
      <Tabs.Screen
        name="archive/index"
        options={{
          title: '보관함',
          tabBarAccessibilityLabel: '보관함',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <ArchiveIcon color={color} size={size} />
            </TabIcon>
          ),
        }}
        listeners={TAB_PRESS_HAPTIC}
      />

      {/*
        종별 보관함 화면 4개. 위 주석대로 hoist 되므로 `href: null` 로 **탭바에서 숨긴다.**
        선언을 빠뜨리면 탭이 5칸 → 9칸으로 늘어난다 (실기기에서 실제로 재현됨).
        진입은 보관함 허브의 필터 칩에서 `router.push` 로만 한다.
      */}
      <Tabs.Screen name="archive/cards" options={{ href: null }} />
      <Tabs.Screen name="archive/tickets" options={{ href: null }} />
      <Tabs.Screen name="archive/posters" options={{ href: null }} />
      <Tabs.Screen name="archive/receipts" options={{ href: null }} />

      <Tabs.Screen
        name="scan"
        options={{
          title: '',
          tabBarButton: (props) => <ScanTabButton onPress={props.onPress} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault(); // 탭 화면(scan.tsx)을 렌더하지 않는다
            haptics.impact('medium'); // HAP-06
            router.push('/scan');
          },
        }}
      />

      <Tabs.Screen
        name="search"
        options={{
          title: '검색',
          tabBarAccessibilityLabel: '검색',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <SearchIcon color={color} size={size} />
            </TabIcon>
          ),
        }}
        listeners={TAB_PRESS_HAPTIC}
      />

      {/*
        5번째 슬롯 — 캘린더(SCR-07). 화면 파일은 `app/calendar.tsx` 에서 `app/(tabs)/calendar.tsx`
        로 **이동**해 왔다. `(tabs)` 는 그룹 세그먼트라 경로는 `/calendar` 그대로이므로
        홈의 `router.push(href('/calendar'))` 4곳과 위젯 딥링크 `mora://calendar[?date=…]` 가
        전부 그대로 산다. **원본 `app/calendar.tsx` 는 반드시 삭제한다** — 남기면 같은 `/calendar`
        가 둘이 되어 라우트가 충돌한다.
      */}
      <Tabs.Screen
        name="calendar"
        options={{
          title: '캘린더',
          tabBarAccessibilityLabel: '캘린더',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <CalendarIcon color={color} size={size} />
            </TabIcon>
          ),
        }}
        listeners={TAB_PRESS_HAPTIC}
      />

      {/*
        설정 — **탭바에서만** 뺀다. 위 archive/* 4개와 똑같이 `href: null` 이고, 빠뜨리면
        탭이 5칸 → 6칸으로 늘어나 캘린더 옆에 `settings` 칸이 되살아난다(실기기 재현 이력 있는 함정).
        진입은 홈 헤더의 설정 버튼(`app/(tabs)/index.tsx`, `router.push('/(tabs)/settings')`)이고,
        라우트 `/settings` 는 그대로라 DL-02 캘린더 콜백 착지도 유지된다.
        화면이 이 내비게이터 안에 남아 있으므로 탭바는 계속 보인다 → iOS 에서도 홈 탭을 눌러
        빠져나올 수 있다(막다른 골목이 아니다).
      */}
      <Tabs.Screen name="settings/index" options={{ href: null }} />
    </Tabs>
  );
}
