// app/(onboarding)/index.tsx — SCR-02 온보딩
//
// 원본 `frontend/app/page.tsx` 의 마케팅 랜딩 7섹션을 **가로 스와이프 4장 페이저**로 압축했다.
// 카피는 원본 `ScrollPinnedShowcase` 의 `STEP 01~04` 배열 그대로다(1페이지 본문만 예외 — 아래 주석).
//
// 원본 → 모바일 (Screen Specs SCR-02 변경점 표)
//  - 2단 grid + `position:sticky` + IntersectionObserver → 페이저. 390dp 에서 2단 sticky 는 불가능하다
//  - 아이폰 프레임 목업 2개(632dp) → 페이지당 시각 1개, 회전 제거
//  - `Nav` 앵커 링크 / `Footer` / 15개 카드 → 폐기. 4번째 페이지에 CTA 2개만 남긴다
//  - 스크롤 dot(활성 w18 / 비활성 w6) → 규격 그대로 유지 (MOT-19)
//
// 페이저 구현: `react-native-pager-view` 는 설치되어 있지 않고, MOT-19 가 지정한 방식이
// `FlatList pagingEnabled` 다. 4장 고정 페이저라 목록이 아니므로 G-12(flash-list) 대상이 아니다.
//
// 시각 자산: 원본의 목업 PNG 4장(UploadScreen/ParseScreen/ListScreen/LedgerScreen)은 웹 전용이라
// 번들에 없다. 대신 브랜드 일러스트(`illust.png`)와 문서 4종 아이콘을 조합해 각 단계를 표현하고,
// Design Tokens §10-5 대로 `surface.alt` + `border.subtle` 매트 프레임에 넣는다(반전·틴트 금지).
//
// 데이터: API 호출 없음. MMKV `onboarding.seen` 만 쓴다.
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { markOnboardingSeen } from '@/features/onboarding/seen';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

const ILLUST = require('../../assets/brand/illust.png') as number;
const ICON_CARD = require('../../assets/brand/business_card.png') as number;
const ICON_TICKET = require('../../assets/brand/ticket.png') as number;
const ICON_POSTER = require('../../assets/brand/poster.png') as number;
const ICON_RECEIPT = require('../../assets/brand/receipt.png') as number;

type Page = {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
};

/** 카피 정본: 원본 `app/page.tsx` STEP 배열 (Screen Specs SCR-02 페이지별 카피 표). */
const PAGES: readonly Page[] = [
  {
    key: 'upload',
    eyebrow: 'STEP 01',
    title: '그냥 올리기만 하세요',
    // 결정(SCR-02): 원문의 `드래그&드롭까지` 는 모바일에 없는 입력 방식이라 교체한다. 나머지 3개는 원문 유지.
    body: '카메라 촬영, 앨범 선택, 파일 불러오기까지. 어떤 방식이든 사진만 올리면 MORA가 알아서 분석합니다.',
  },
  {
    key: 'parse',
    eyebrow: 'STEP 02',
    title: 'MORA가 읽고 분석합니다',
    body: 'OCR이 이미지 속 글자를 읽고, AI가 사람·날짜·금액·장소 같은 핵심 정보를 자동으로 추출합니다.',
  },
  {
    key: 'list',
    eyebrow: 'STEP 03',
    title: '유형별로 알아서 정리됩니다',
    body: '명함은 연락처로, 티켓 및 포스터는 캘린더로, 영수증은 가계부로 자동 분류해 보관함에 정리합니다.',
  },
  {
    key: 'ledger',
    eyebrow: 'STEP 04',
    title: '말하듯 검색하고, 한눈에 요약하세요',
    body: '"3월 부산 출장 영수증"처럼 자연어로 검색하면, 관련 기록을 찾아 핵심 내용까지 AI가 정리해줍니다.',
  },
] as const;

const LAST_INDEX = PAGES.length - 1;

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Page>>(null);
  const [page, setPage] = useState(0);
  /** 스크롤 콜백에서 읽는 현재 페이지. 상태보다 한 틱 빠르게 갱신해 햅틱 중복을 막는다. */
  const pageRef = useRef(0);

  /** 온보딩 완료 기록 후 이동. 저장 실패해도 이동은 강행한다 (SCR-02 인터랙션). */
  const leave = useCallback(
    (target: '/(auth)/login' | '/(auth)/signup') => {
      markOnboardingSeen();
      // replace 다 — 백으로 온보딩에 되돌아오면 안 된다 (Navigation Map §8).
      router.replace(target);
    },
    [router],
  );

  /**
   * 프로그램 이동(다음 버튼 · 백 키). 상태를 먼저 맞춰 두면 뒤이어 오는 `onMomentumScrollEnd` 가
   * 같은 값이라 햅틱을 한 번 더 쏘지 않는다.
   */
  const goToPage = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(LAST_INDEX, next));
    pageRef.current = clamped;
    setPage(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
  }, []);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
      // 햅틱은 setState 업데이터 안에서 쏘지 않는다 — 개발 모드의 이중 호출로 두 번 울린다.
      if (next === pageRef.current) return;
      pageRef.current = next;
      haptics.selection(); // HAP-01
      setPage(next);
    },
    [width],
  );

  // Android 백: 이전 페이지, 1페이지면 앱 종료(기본 동작에 맡긴다) — SCR-02 인터랙션 표.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 0) return false;
      goToPage(page - 1);
      return true;
    });
    return () => subscription.remove();
  }, [goToPage, page]);

  return (
    <View className="flex-1 bg-bg-base" style={{ paddingTop: insets.top }}>
      {/* 헤더 — 건너뛰기 (44dp 터치 타깃) */}
      <View className="h-12 flex-row items-center justify-end px-screen">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="건너뛰기"
          onPress={() => {
            haptics.selection();
            leave('/(auth)/login');
          }}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          className="min-h-11 justify-center px-2"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text className="text-button font-w600 text-text-muted">건너뛰기</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={PAGES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        renderItem={({ item, index }) => (
          <OnboardingPage page={item} index={index} width={width} />
        )}
        style={{ flex: 1 }}
      />

      {/* 하단 고정 영역 — 인디케이터 + CTA */}
      <View className="px-screen" style={{ paddingBottom: insets.bottom + 16 }}>
        <View className="mb-5 flex-row items-center justify-center gap-1.5">
          {PAGES.map((item, index) => (
            <PageDot key={item.key} active={index === page} />
          ))}
        </View>

        {page < LAST_INDEX ? (
          <Button
            label="다음"
            onPress={() => goToPage(page + 1)}
            size="lg"
            fullWidth
            haptic="selection"
          />
        ) : (
          <>
            <Button
              label="무료로 시작하기 →"
              onPress={() => leave('/(auth)/signup')}
              size="lg"
              fullWidth
              haptic="light"
            />
            <Button
              label="로그인"
              onPress={() => leave('/(auth)/login')}
              variant="secondary"
              size="lg"
              fullWidth
              haptic="selection"
              style={{ marginTop: 8 }}
            />
            <Text className="mt-3 text-center text-caption text-text-disabled">
              AI OCR · 문서 정리 자동화
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

/* ── 페이지 ─────────────────────────────────────────────────────────────── */

function OnboardingPage({ page, index, width }: { page: Page; index: number; width: number }) {
  return (
    <View style={{ width }} className="flex-1 px-screen">
      {/* 초기 모션: fade-in 400ms + translateY(12→0). Reduce Motion 은 Reanimated 가 자동 처리한다 */}
      <Animated.View entering={FadeInDown.duration(400)} style={{ flex: 1, justifyContent: 'center' }}>
        <VisualFrame>
          <PageVisual index={index} />
        </VisualFrame>
      </Animated.View>

      <View className="pb-6 pt-6">
        <Text className="text-micro font-w700 text-action" style={{ letterSpacing: 1 }}>
          {page.eyebrow}
        </Text>
        {/* 와이어프레임의 display 28 은 스케일 토큰 사이값(stat 24 / display 32)이다.
            4페이지 제목이 3줄로 흘러넘치지 않도록 stat 을 택했다 (§5 타이포 스케일). */}
        <Text className="mt-2 text-stat font-w800 text-brand">{page.title}</Text>
        <Text className="mt-3 text-base text-text-muted">{page.body}</Text>
      </View>
    </View>
  );
}

/** §10-5 — 라이트 기준 이미지를 반전·틴트 없이 매트 프레임에 넣는다. */
function VisualFrame({ children }: { children: React.ReactNode }) {
  return (
    <View className="w-full rounded-xl border border-border-subtle bg-surface-alt p-1">
      <View className="w-full items-center justify-center rounded-xl bg-bg-elevated p-4" style={{ minHeight: 240 }}>
        {children}
      </View>
    </View>
  );
}

function PageVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <Image
        source={ILLUST}
        contentFit="contain"
        style={{ width: '100%', height: 260 }}
        accessible
        accessibilityLabel="명함·티켓·포스터·영수증을 스마트폰으로 올리는 모습"
      />
    );
  }

  // STEP 02 — 이미지에서 뽑아낸 항목이 채워지는 모습
  if (index === 1) {
    return (
      <View className="w-full flex-row items-center gap-4" accessible accessibilityLabel="문서에서 항목을 추출하는 모습">
        <Image source={ICON_CARD} contentFit="contain" style={{ width: 88, height: 88 }} />
        <View className="flex-1 gap-2.5">
          <ExtractedRow label="이름" widthRatio={0.55} />
          <ExtractedRow label="회사" widthRatio={0.8} />
          <ExtractedRow label="연락처" widthRatio={0.65} />
        </View>
      </View>
    );
  }

  // STEP 03 — 유형별 자동 분류
  if (index === 2) {
    return (
      <View className="w-full flex-row flex-wrap justify-center gap-3" accessible accessibilityLabel="명함, 티켓, 포스터, 영수증으로 분류된 모습">
        <DocTile source={ICON_CARD} label="명함" tone="card" />
        <DocTile source={ICON_TICKET} label="티켓" tone="ticket" />
        <DocTile source={ICON_POSTER} label="포스터" tone="poster" />
        <DocTile source={ICON_RECEIPT} label="영수증" tone="receipt" />
      </View>
    );
  }

  // STEP 04 — 자연어 검색 + AI 요약
  return (
    <View className="w-full gap-3" accessible accessibilityLabel="자연어로 검색하고 요약을 받는 모습">
      <View className="h-11 flex-row items-center rounded-md border border-border-subtle bg-surface px-3">
        <Text className="text-body-sm text-text-disabled" numberOfLines={1}>
          3월 부산 출장 영수증
        </Text>
      </View>
      <View className="flex-row items-center gap-3 rounded-card border border-border-subtle bg-surface p-3">
        <Image source={ICON_RECEIPT} contentFit="contain" style={{ width: 40, height: 40 }} />
        <View className="flex-1 gap-2">
          <SkeletonBar widthRatio={0.7} />
          <SkeletonBar widthRatio={0.45} />
        </View>
      </View>
      <View className="rounded-card bg-brand-container p-3">
        <Text className="text-caption font-w700 text-brand">AI 요약</Text>
        <View className="mt-2 gap-2">
          <SkeletonBar widthRatio={0.9} />
          <SkeletonBar widthRatio={0.6} />
        </View>
      </View>
    </View>
  );
}

function ExtractedRow({ label, widthRatio }: { label: string; widthRatio: number }) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-14 text-caption text-text-muted">{label}</Text>
      <SkeletonBar widthRatio={widthRatio} />
    </View>
  );
}

function SkeletonBar({ widthRatio }: { widthRatio: number }) {
  return (
    <View
      className="h-2.5 rounded-full bg-surface-alt"
      style={{ width: `${Math.round(widthRatio * 100)}%` }}
    />
  );
}

const DOC_TILE: Record<'card' | 'ticket' | 'poster' | 'receipt', { box: string; label: string }> = {
  card: { box: 'bg-card-bg', label: 'text-card' },
  ticket: { box: 'bg-ticket-bg', label: 'text-ticket' },
  poster: { box: 'bg-poster-bg', label: 'text-poster' },
  receipt: { box: 'bg-receipt-bg', label: 'text-receipt' },
};

function DocTile({
  source,
  label,
  tone,
}: {
  source: number;
  label: string;
  tone: keyof typeof DOC_TILE;
}) {
  const style = DOC_TILE[tone];
  return (
    <View className={`w-[46%] items-center rounded-card py-3 ${style.box}`}>
      <Image source={source} contentFit="contain" style={{ width: 44, height: 44 }} />
      <Text className={`mt-1.5 text-caption font-w600 ${style.label}`}>{label}</Text>
    </View>
  );
}

/* ── 인디케이터 (MOT-19: 폭 6 → 18, 300ms) ─────────────────────────────── */

function PageDot({ active }: { active: boolean }) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const w = useSharedValue(active ? 18 : 6);

  useEffect(() => {
    const target = active ? 18 : 6;
    w.value = reduceMotion
      ? target
      : withTiming(target, { duration: 300, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [active, reduceMotion, w]);

  const animStyle = useAnimatedStyle(() => ({ width: w.value }));

  return (
    <Animated.View
      // Reanimated 컴포넌트에는 className 을 걸지 않는다(기존 UI 프리미티브 관례) → 색은 useTheme (N-6)
      style={[
        { height: 6, borderRadius: 3, backgroundColor: active ? t.brand.base : t.border.subtle },
        animStyle,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
