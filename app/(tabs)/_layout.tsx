// app/(tabs)/_layout.tsx
//
// 하단 탭 4개(홈·보관함·검색·설정) + 중앙 스캔 액션 = 5슬롯. 정본: wiki/design/Navigation Map.md §3.
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
// 아이콘: lucide-react-native 는 설치되어 있지 않으므로(패키지 추가 금지) Navigation Map §3 이 지정한
// lucide 아이콘(House/FolderOpen/ScanLine/Search/Settings)을 react-native-svg 로 같은 실루엣·24dp 로 그렸다.
// lucide 도입 시 이 5개만 교체하면 된다. SVG stroke 는 className 이 닿지 않아 색은 탭바가 주는 tint 값을 쓴다.
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
import Svg, { Circle, Path } from 'react-native-svg';
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

function HomeIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 10.5L12 3.5L20.5 10.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V10.5Z"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M9.5 20.5V14H14.5V20.5"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ArchiveIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 8V18A1.5 1.5 0 0 0 4.5 19.5H19A1.5 1.5 0 0 0 20.5 18V10.5H11.5L9.5 8H3Z"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M3 8V6A1.5 1.5 0 0 1 4.5 4.5H8.5L10.5 7"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ScanIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4H18.5A1.5 1.5 0 0 1 20 5.5V8M20 16V18.5A1.5 1.5 0 0 1 18.5 20H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"
        stroke={toStroke(color)}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 12H19.5"
        stroke={toStroke(color)}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function SearchIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.8} cy={10.8} r={6.8} stroke={toStroke(color)} strokeWidth={1.8} />
      <Path
        d="M15.8 15.8L20.5 20.5"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function SettingsIcon({ color, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3.4} stroke={toStroke(color)} strokeWidth={1.8} />
      {/* 톱니 8개 — 45° 간격으로 r6.2 → r8.6 */}
      <Path
        d="M18.2 12H20.6M16.24 7.76L17.94 6.06M12 5.8V3.4M7.76 7.76L6.06 6.06M5.8 12H3.4M7.76 16.24L6.06 17.94M12 18.2V20.6M16.24 16.24L17.94 17.94"
        stroke={toStroke(color)}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
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
   (다른 탭에서 앱이 종료되면 사용자가 데이터를 잃었다고 느낀다 — §4 구현 노트)

   `useFocusEffect` 를 쓰는 이유: `/scan` 같은 루트 스택 모달이 위에 올라오면 이 레이아웃은
   포커스를 잃고 리스너가 해제된다. 그래야 모달의 자체 백 가드(SCR-09/12)가 가려지지 않는다. */
function useTabsBackPolicy(): void {
  const router = useRouter();
  // 그룹 세그먼트 `(tabs)` 는 경로에 나타나지 않는다 → 홈 탭의 경로는 정확히 '/' 다
  // (보관함 '/archive', 검색 '/search', 설정 '/settings').
  const isHomeTab = usePathname() === '/';

  useFocusEffect(
    useCallback(() => {
      let exitArmed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!isHomeTab) {
          router.navigate('/(tabs)');
          return true;
        }
        // 두 번째 백은 처리하지 않고 기본 동작(앱 종료)에 넘긴다.
        if (exitArmed) return false;

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
    }, [isHomeTab, router]),
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

      <Tabs.Screen
        name="settings/index"
        options={{
          title: '설정',
          tabBarAccessibilityLabel: '설정',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <SettingsIcon color={color} size={size} />
            </TabIcon>
          ),
        }}
        listeners={TAB_PRESS_HAPTIC}
      />
    </Tabs>
  );
}
