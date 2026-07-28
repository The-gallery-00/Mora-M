// app/(tabs)/search.tsx — SCR-23 · 검색
//
// 정본: wiki/design/Screen Specs.md SCR-23 (와이어프레임 · 상태표 · 인터랙션표 · 기본값 정책)
//       wiki/product/Requirements.md FR-069~FR-075 · FR-130
//       wiki/tech/Offline and State.md §10 ST-05~ST-07 · §10-1 ST-09~ST-14
//       wiki/design/Mobile UX Guide.md CP-38(검색 기록 삭제 확인 문구)
//
// ── 이 화면이 지키는 규칙 4가지 ────────────────────────────────────────────────
// 1. **디바운스 자동 검색 금지 (FR-071).** 입력창 값(`draft`)과 제출된 검색어(`submitted`)를
//    분리해 들고, `useSearch` 에는 **`submitted` 만** 넘긴다. 쿼리 키가 제출 시점에만 바뀌므로
//    구조적으로 타이핑 중 실행이 불가능하다. 서버는 검색 API 호출마다 검색기록을 1건
//    (`전체` 는 4건) 무조건 적립하며 앱이 끌 수단이 없다.
// 2. **초기 칩은 MMKV 복원** (`readLastSearchDocType()`, 최초 실행 `명함` — FR-069 · ST-09).
//    저장은 화면이 하지 않는다 — `useSearch` 가 **실행 성공 시점**에 한다(칩 탭 시점이 아니다).
// 3. **정렬 토글은 재요청을 만들지 않는다 (FR-073).** `useSearch({ order })` 가 캐시된 결과를
//    클라이언트에서 다시 정렬할 뿐이다. 재요청 1회 = 검색기록 1건이다.
// 4. **페이지네이션은 클라이언트 슬라이스**다. 서버 검색은 `topK=50` 한 방에 다 오므로
//    스크롤 하단에서 20개씩 더 **렌더**할 뿐 네트워크가 나가지 않는다.
//
// 라우트 문자열을 `href()` 로 단언하는 이유는 `ArchiveList.tsx` 와 같다 — typedRoutes 가 켜져 있고
// `/doc/{세그먼트}/{id}` 는 런타임 조립이라 리터럴 타입으로 표현되지 않는다. `/chat` 은 이번에
// 새로 만든 파일이라 타입 생성 전까지 리터럴로도 좁혀지지 않는다.
import NetInfo from '@react-native-community/netinfo';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { SortSheet, type SortOption } from '@/components/documents';
import {
  ChatFab,
  RecentQueryList,
  SearchBar,
  SearchResultCard,
  searchFactsOf,
} from '@/components/search';
import {
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  Skeleton,
  toast,
  type SegmentedOption,
} from '@/components/ui';
import { DOC_ROUTE_SEGMENT } from '@/features/documents';
import {
  SEARCH_COPY,
  SEARCH_DOC_TYPES,
  SEARCH_DOC_TYPE_LABELS,
  readLastSearchDocType,
  searchHistoryClearedMessage,
  useClearSearchHistory,
  useRecentSearches,
  useSearch,
  useSearchHistories,
  type SearchDocType,
  type SearchHit,
  type SearchSortOrder,
} from '@/features/search';
import { tabScrollBottomPadding } from '@/navigation/shell';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

/** 스크롤 하단에서 한 번에 더 그리는 개수 (SCR-23 모바일 변경점: 번호 페이지네이션 → 무한 스크롤). */
const PAGE_SIZE = 20;

/** typedRoutes 우회 — `ArchiveList.tsx` 의 같은 헬퍼와 동일한 이유·형태다. */
const href = (path: string): Href => path as Href;

const TYPE_OPTIONS: SegmentedOption<SearchDocType>[] = SEARCH_DOC_TYPES.map((type) => ({
  value: type,
  label: SEARCH_DOC_TYPE_LABELS[type],
}));

const SORT_OPTIONS: SortOption<SearchSortOrder>[] = [
  { value: 'relevance', label: SEARCH_COPY.sortRelevance },
  { value: 'recent', label: SEARCH_COPY.sortRecent },
];

/** `⇅` 정렬 (ArchiveList 와 같은 실루엣 — lucide 미설치). */
function SortIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3.5V20.5M7 20.5L3.5 17M7 20.5L10.5 17M17 20.5V3.5M17 3.5L13.5 7M17 3.5L20.5 7"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 로딩 3초 초과 시 `검색 중...` (SCR-23 상태표). ArchiveList `useSlowFlag` 와 같은 장치다. */
function useSlowFlag(active: boolean, delayMs = 3000): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return active && slow;
}

/** 결과 자리 스켈레톤 3장 — 실제 카드(이미지 150 + 제목 + 부제 + facts + 프리뷰)와 같은 형태. */
function ResultSkeleton() {
  return (
    <View
      className="gap-3 px-4"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated"
        >
          <Skeleton width="100%" height={150} radius={0} />
          <View className="gap-2 p-4">
            <Skeleton width="55%" height={17} radius={4} />
            <Skeleton width="70%" height={13} radius={4} />
            <Skeleton width="100%" height={36} radius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** 인라인 알림 배너 (부분 실패 · 부분 성공 경고 · 오프라인). */
function Banner({ text, tone }: { text: string; tone: 'danger' | 'warn' }) {
  const box =
    tone === 'danger'
      ? 'border-danger-border bg-danger-container'
      : 'border-warn-border bg-warn-container';
  const label = tone === 'danger' ? 'text-danger-strong' : 'text-warn';

  return (
    <View className={`mx-4 mb-3 rounded-card border px-3 py-2 ${box}`} accessibilityLiveRegion="polite">
      <Text className={`text-body-sm font-w600 ${label}`} maxFontSizeMultiplier={1.3}>
        {text}
      </Text>
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);

  /* ── 상태 ──────────────────────────────────────────────────────────────── */
  // `draft` 는 입력창, `submitted` 는 실행된 검색어다. 이 분리가 FR-071 의 구현 자체다.
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [docType, setDocType] = useState<SearchDocType>(readLastSearchDocType);
  const [order, setOrder] = useState<SearchSortOrder>('relevance');
  const [sortOpen, setSortOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  const search = useSearch(docType, submitted, { order, enabled: !offline });
  const recent = useRecentSearches();
  const clearHistory = useClearSearchHistory();
  const slowLoading = useSlowFlag(search.isLoading);

  /* ── 제출 (명시적 실행 지점 3곳: 키보드 `검색` / 🔍 / 칩·최근검색어 탭) ────── */
  const submit = useCallback((q: string, type: SearchDocType) => {
    const trimmed = q.trim();
    Keyboard.dismiss();
    if (trimmed === '') return;
    setDraft(trimmed);
    setDocType(type);
    setSubmitted(trimmed);
    setVisible(PAGE_SIZE); // 새 검색은 항상 첫 20개부터
  }, []);

  const onSubmitBar = useCallback(() => submit(draft, docType), [draft, docType, submit]);

  /** 칩 탭 — 검색어가 있으면 그 유형으로 **즉시 재실행**, 비어 있으면 선택만 바꾼다(SCR-23 인터랙션표). */
  const onChangeType = useCallback(
    (type: SearchDocType) => {
      if (draft.trim() === '') {
        setDocType(type);
        return;
      }
      submit(draft, type);
    },
    [draft, submit],
  );

  /** ✕ — 입력과 결과를 함께 비워 초기 상태(최근 검색어 + 안내 카드)로 돌아간다. */
  const onClear = useCallback(() => {
    setDraft('');
    setSubmitted('');
    setVisible(PAGE_SIZE);
  }, []);

  /* ── 최근 검색어 전체 삭제 (CP-38 → API-55) ──────────────────────────────── */
  const confirmClearAll = useCallback(() => {
    Alert.alert('검색 기록을 모두 삭제할까요?', '이 작업은 되돌릴 수 없습니다. 계속하려면 확인을 눌러주세요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          clearHistory.mutate(undefined, {
            // 서버 삭제 건수를 그대로 문구에 쓴다. 로컬 `search.recent` 비우기는 훅이 함께 처리한다(ST-07).
            onSuccess: (deleted) => toast.success(searchHistoryClearedMessage(deleted)),
            onError: (error) => toast.error(error.message),
          });
        },
      },
    ]);
  }, [clearHistory]);

  /* ── 결과 ──────────────────────────────────────────────────────────────── */
  const hits = search.hits;
  const page = useMemo(() => hits.slice(0, visible), [hits, visible]);
  const showTypeBadge = docType === 'ALL';

  const openHit = useCallback(
    (hit: SearchHit) => {
      router.push(
        href(`/doc/${DOC_ROUTE_SEGMENT[hit.type]}/${encodeURIComponent(String(hit.id))}`),
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchHit>) => (
      <View className="px-4 pb-3">
        <SearchResultCard
          docType={item.type}
          title={item.title}
          {...(item.subtitle ? { subtitle: item.subtitle } : {})}
          imageUri={item.thumbnailUrl}
          facts={searchFactsOf(item.document)}
          preview={item.preview}
          query={submitted}
          similarity={item.similarity ?? null}
          showTypeBadge={showTypeBadge}
          onPress={() => openHit(item)}
          testID={`search-result-${item.key}`}
        />
      </View>
    ),
    [openHit, showTypeBadge, submitted],
  );

  const bottomPadding = tabScrollBottomPadding(insets.bottom);

  /* ── 본문 4상태 ────────────────────────────────────────────────────────── */
  /** 오프라인이라 실행 자체가 막힌 상태 — 캐시된 결과가 있으면 그건 그대로 보여 준다. */
  const blockedOffline = offline && hits.length === 0;
  const showResultHeader =
    submitted !== '' && !search.isLoading && !search.isError && !blockedOffline;

  let body: ReactNode;

  if (submitted === '') {
    // ① 초기 — 최근 검색어 + 안내 카드. **요청을 보내지 않는다.**
    body = (
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <RecentQueryList
          items={recent.items}
          onSelect={(q, type) => submit(q, type)}
          onRemove={recent.remove}
          onClearAll={confirmClearAll}
          clearing={clearHistory.isPending}
          testID="search-recent"
        />

        {/* `전체 기록 보기`(API-54)는 로컬 목록과 별개다 — 열 때만 조회한다(ST-06). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SEARCH_COPY.historyTitle}
          onPress={() => setHistoryOpen(true)}
          className="mt-3 self-center"
          // body-sm 한 줄(18dp) — 44dp 하한을 hitSlop 으로 채운다(A11Y §11-1)
          hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text className="text-body-sm font-w600 text-action" maxFontSizeMultiplier={1.3}>
            {SEARCH_COPY.historyTitle}
          </Text>
        </Pressable>

        <Text className="mb-2 mt-6 text-input font-w600 text-text-primary" accessibilityRole="header">
          {SEARCH_COPY.guideTitle}
        </Text>
        <View className="rounded-card border border-border-subtle bg-surface p-4">
          <Text className="text-body-sm text-text-secondary" maxFontSizeMultiplier={1.4}>
            {SEARCH_COPY.guideBody}
          </Text>
        </View>
      </ScrollView>
    );
  } else if (search.isLoading) {
    // ② 로딩 — `전체` 도 4종이 다 끝날 때까지 스켈레톤 하나로 유지한다(부분 도착마다 흔들지 않는다).
    body = (
      <View className="flex-1">
        <ResultSkeleton />
        {slowLoading ? (
          <Text className="mt-3 text-center text-body-sm text-text-muted" accessibilityLiveRegion="polite">
            {SEARCH_COPY.loadingSlow}
          </Text>
        ) : null}
      </View>
    );
  } else if (blockedOffline) {
    // ②-b 오프라인 — 검색바는 이미 잠겼고 배너도 떠 있다. 결과 자리에는 사유만 남긴다.
    body = (
      <View className="flex-1 px-4 pt-6">
        <EmptyState title={SEARCH_COPY.offline} />
      </View>
    );
  } else if (search.isError) {
    // ③ 에러 — `SearchError.message` 는 이미 완성된 한국어 문구다(서버 문장을 쓰지 않는다).
    body = (
      <View className="flex-1 px-4">
        <View
          className="items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-center text-base font-w600 text-danger-strong" maxFontSizeMultiplier={1.3}>
            {search.error?.message ?? SEARCH_COPY.failed}
          </Text>
          <Button label="다시 시도" onPress={() => void search.refetch()} variant="secondary" size="sm" />
        </View>
      </View>
    );
  } else {
    // ④ 성공 / 빈 결과
    // FlashList 는 스스로 flex 하지 않는다 → 반드시 `flex-1` 컨테이너 안에 둔다(ArchiveList 와 동일).
    body = (
      <View className="flex-1">
        <FlashList
          data={page}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          drawDistance={400}
          onEndReached={() => setVisible((v) => (v >= hits.length ? v : v + PAGE_SIZE))}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          ListHeaderComponent={
            <View>
              {/* 부분 실패(`전체` 한정) — 성공한 유형 결과는 그대로 노출한다. */}
              {search.failureNotice ? <Banner text={search.failureNotice} tone="danger" /> : null}
              {/* 부분 성공 — 서버 `message` 원문(`임베딩 생성 실패. Fuzzy 검색만 가능.`). */}
              {search.warning ? <Banner text={search.warning} tone="warn" /> : null}
            </View>
          }
          ListEmptyComponent={
            <View className="pt-6">
              <EmptyState title={SEARCH_COPY.emptyTitle} description={SEARCH_COPY.emptyBody} />
            </View>
          }
          ListFooterComponent={<View style={{ height: spacing.sm }} />}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-base" style={{ paddingTop: insets.top }}>
      {/* ── 검색바 + 유형 세그먼트 (고정) ── */}
      <View className="gap-3 px-4 pb-3 pt-2">
        <SearchBar
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onSubmit={onSubmitBar}
          onClear={onClear}
          loading={search.isFetching}
          disabled={offline}
          testID="search-input"
        />
        <SegmentedControl
          options={TYPE_OPTIONS}
          value={docType}
          onChange={onChangeType}
          accessibilityLabel="문서 유형"
          testID="search-type"
        />
      </View>

      {offline ? <Banner text={SEARCH_COPY.offline} tone="warn" /> : null}

      {/* ── 결과 헤더 (`명함 3건` + `⇅`) — 검색을 실행했을 때만 ── */}
      {showResultHeader ? (
        <View className="flex-row items-center justify-between border-b border-bg-sunken px-4 pb-2">
          <Text className="text-body-sm font-w700 text-text-secondary" maxFontSizeMultiplier={1.3}>
            {search.countLabel}
          </Text>
          <IconButton
            icon={<SortIcon color={t.text.secondary} />}
            onPress={() => setSortOpen(true)}
            size="sm"
            accessibilityLabel="정렬"
            testID="search-sort"
          />
        </View>
      ) : null}

      {body}

      {/* SCR-24 진입 — 정본(CMP-22)은 전 탭 공통 FAB 이지만 `(tabs)/_layout.tsx` 는 담당 범위 밖이라
          검색 화면에만 둔다(반환 보고 참조).

          `bottom` 이 `tabBarHeight + 16` 이 아니라 그냥 16 인 이유: 이 탭 내비게이터의 탭바는
          **플로우 배치**다(`BottomTabView` 가 screens 컨테이너와 탭바를 세로로 쌓는다). 화면의
          하단 경계가 이미 탭바 위쪽이므로 탭바 높이를 또 더하면 FAB 이 72dp 더 떠 버린다.
          (정본의 `tabBarHeight + 16` 은 탭바가 콘텐츠를 덮는 배치를 전제한 값이다.) */}
      <ChatFab
        onPress={() => router.push(href('/chat'))}
        bottom={spacing.lg}
        testID="search-chat-fab"
      />

      <SortSheet
        visible={sortOpen}
        title="정렬"
        options={SORT_OPTIONS}
        selected={order}
        // 재요청이 아니다 — `useSearch` 가 캐시된 결과를 다시 정렬할 뿐이다(FR-073).
        onSelect={setOrder}
        onClose={() => setSortOpen(false)}
      />

      <SearchHistorySheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(q, type) => {
          setHistoryOpen(false);
          submit(q, type);
        }}
      />
    </View>
  );
}

/* ───────────────────────────────────────────────────── 전체 기록 보기 (API-54)
   로컬 최근 검색어와 **다른 소스**다(서버가 검색 API 호출마다 자동 적립한 기록).
   `전체` 검색 1회가 서버에 남긴 4행은 `mergeSearchHistories` 가 이미 1건으로 묶어 준다(ST-13).
   시트는 `ArchiveList` 의 ActionSheet 와 같은 이유로 순수 `Modal` 이다 — 제스처가 필요 없고
   루트에 `BottomSheetModalProvider` 가 없다. */
function SearchHistorySheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (q: string, docType: SearchDocType) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const history = useSearchHistories({ enabled: visible });

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: t.scrim }}
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={onClose}
      >
        <Pressable
          className="rounded-t-sheet bg-bg-elevated px-5 pt-4"
          style={{ paddingBottom: insets.bottom + spacing.lg, maxHeight: '70%' }}
          onPress={() => undefined}
        >
          <Text className="pb-2 text-h3 font-w700 text-text-primary" accessibilityRole="header">
            {SEARCH_COPY.historyTitle}
          </Text>

          {history.isLoading ? (
            <View className="gap-2 py-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} width="100%" height={20} radius={4} />
              ))}
            </View>
          ) : history.isError ? (
            /* 에러에는 반드시 재시도가 붙는다 — 시트를 닫았다 다시 여는 것 말고는
               다시 부를 방법이 없었다(FR-109). */
            <View className="items-center gap-3 py-6" accessibilityLiveRegion="polite">
              <Text className="text-center text-body-sm text-danger-strong">
                {history.error?.message ?? SEARCH_COPY.historyFailed}
              </Text>
              <Button
                label="다시 시도"
                onPress={() => void history.refetch()}
                variant="secondary"
                size="sm"
              />
            </View>
          ) : history.isEmpty ? (
            <Text className="py-6 text-center text-body-sm text-text-muted">
              검색 기록이 없습니다.
            </Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {history.groups.map((group) => {
                // 서버 4행이 묶인 그룹(= `전체` 검색)은 `ALL` 로, 단일 유형은 그 유형으로 복원한다.
                const only = group.docTypes.length === 1 ? group.docTypes[0] : undefined;
                const restored: SearchDocType = only ?? 'ALL';
                return (
                  <Pressable
                    key={group.id || `${group.query}:${group.createdAt}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.query}, ${SEARCH_DOC_TYPE_LABELS[restored]}으로 검색`}
                    onPress={() => onSelect(group.query, restored)}
                    className="h-12 flex-row items-center justify-between"
                    style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
                  >
                    <Text
                      className="flex-1 text-base text-text-primary"
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                    >
                      {group.query}
                    </Text>
                    <Text className="ml-2 text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
                      {SEARCH_DOC_TYPE_LABELS[restored]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
