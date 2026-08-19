// app/(tabs)/archive/index.tsx
//
// SCR-14 보관함 허브 — 유형 필터 칩 + 통합 목록.
//
// 웹은 헤더 드롭다운에서 4개 라우트로 바로 갔다. 하단 탭은 드롭다운을 가질 수 없으므로
// **허브 화면 = `전체` 뷰 + 유형 칩**이고, 유형 전용 화면(SCR-15~18)은 그룹·KPI·섹션 같은
// 고유 기능 때문에 그대로 남는다. 칩 롱프레스 / `전체 >` 로 그쪽으로 넘어간다.
//
// 칩 순서는 원본 `STORAGE_ITEMS`(명함 → 티켓 → 포스터 → 영수증)를 따른다.
// `?type=` 파라미터는 홈의 문서 4종 바로가기와 알림 딥링크(Navigation Map §5-1)가 넘긴다.
//
// **`전체` 의 무한 스크롤은 4종 커서가 독립이다.** 그 처리 규칙은
// `src/features/documents/ArchiveList.tsx` 상단 주석이 정본이다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortSheet, type SortOption } from '@/components/documents';
import { Chip, type ChipDocTone } from '@/components/ui';
import { DOCUMENT_TYPES, type DocumentType } from '@/features/documents';
import {
  ARCHIVE_SORT_LABELS,
  ArchiveHeader,
  ArchiveList,
  href,
  useArchiveView,
  type ArchiveSort,
} from '@/features/documents/ArchiveList';
import { haptics } from '@/lib/haptics';
import { tabScrollBottomPadding } from '@/navigation/shell';

/** 허브 필터 값 — Navigation Map §7 라우트 파라미터 계약(`ALL|BUSINESS_CARD|TICKET|POSTER|RECEIPT`). */
const ARCHIVE_FILTERS = ['ALL', 'BUSINESS_CARD', 'TICKET', 'POSTER', 'RECEIPT'] as const;
type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

const isArchiveFilter = (value: unknown): value is ArchiveFilter =>
  typeof value === 'string' && (ARCHIVE_FILTERS as readonly string[]).includes(value);

type FilterMeta = {
  value: ArchiveFilter;
  label: string;
  /** 칩 색. `ALL` 만 문서 색이 아니라 brand 톤을 쓴다. */
  docTone?: ChipDocTone;
  /** 유형 전용 화면 경로 (칩 롱프레스 · `전체 >`). `ALL` 은 없다. */
  route?: '/archive/cards' | '/archive/tickets' | '/archive/posters' | '/archive/receipts';
  /** 빈 상태 문구 — Mobile UX Guide §7-2 CP-08~CP-11 최종안 그대로. */
  empty: { title: string; description: string; action: string };
};

const ALL_FILTER: FilterMeta = {
  value: 'ALL',
  label: '전체',
  empty: {
    title: '보관함이 비어 있습니다',
    description: '문서를 스캔하면 여기에 정리됩니다.',
    action: '문서 스캔하기',
  },
};

const FILTERS: readonly FilterMeta[] = [
  ALL_FILTER,
  {
    value: 'BUSINESS_CARD',
    label: '명함',
    docTone: 'card',
    route: '/archive/cards',
    empty: {
      title: '아직 저장된 명함이 없어요',
      description: '명함을 촬영하면 이름·회사·연락처를 정리해 드려요.',
      action: '명함 스캔하기',
    },
  },
  {
    value: 'TICKET',
    label: '티켓',
    docTone: 'ticket',
    route: '/archive/tickets',
    empty: {
      title: '아직 저장된 티켓이 없어요',
      description: '티켓을 촬영하면 출발지·시간을 자동으로 정리해 드려요.',
      action: '티켓 스캔하기',
    },
  },
  {
    value: 'POSTER',
    label: '포스터',
    docTone: 'poster',
    route: '/archive/posters',
    empty: {
      title: '아직 저장된 포스터가 없어요',
      description: '포스터를 촬영하면 행사일과 마감일을 챙겨 드려요.',
      action: '포스터 스캔하기',
    },
  },
  {
    value: 'RECEIPT',
    label: '영수증',
    docTone: 'receipt',
    route: '/archive/receipts',
    empty: {
      title: '아직 저장된 영수증이 없어요',
      description: '영수증을 촬영하면 가게·금액·날짜를 정리해 드려요.',
      action: '영수증 스캔하기',
    },
  },
];

/** 허브 정렬은 4종 공통 축(등록일)만 쓴다. 종별 축(출발일·행사일 등)은 전용 화면의 몫이다. */
const SORT_OPTIONS: SortOption<ArchiveSort>[] = [
  { value: 'recent', label: ARCHIVE_SORT_LABELS.recent },
  { value: 'oldest', label: ARCHIVE_SORT_LABELS.oldest },
];

export default function ArchiveHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();

  const [selected, setSelected] = useState<ArchiveFilter>(() =>
    isArchiveFilter(params.type) ? params.type : 'ALL',
  );
  const [sort, setSort] = useState<ArchiveSort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const { view, toggleView } = useArchiveView('hub', 'grid');

  /* 이미 이 화면이 떠 있는 상태에서 `?type=` 이 바뀌어 들어오는 경로(홈 바로가기·알림 딥링크)를
     받는다. `useEffect` 가 아니라 **렌더 중 조정**이다 — React 공식 패턴(“Adjusting state when a
     prop changes”)이고, 이펙트로 하면 한 프레임 동안 이전 필터의 목록이 그려졌다 바뀐다. */
  const [syncedType, setSyncedType] = useState(params.type);
  if (params.type !== syncedType) {
    setSyncedType(params.type);
    if (isArchiveFilter(params.type)) setSelected(params.type);
  }

  const active = FILTERS.find((f) => f.value === selected) ?? ALL_FILTER;
  const sectionLinkLabel = selected === 'BUSINESS_CARD' ? '명함첩' : '가계부';

  /** `ALL` 이면 4종 전부. 그 외에는 한 종류만 — 그래도 목록 컨테이너는 같은 것을 쓴다. */
  const types = useMemo<readonly DocumentType[]>(
    () => (selected === 'ALL' ? DOCUMENT_TYPES : [selected]),
    [selected],
  );

  /* 칩 개수(`명함 12`)는 목록이 이미 받은 `totalElements` 를 그대로 쓴다 — 개수만 세는 별도
     요청을 만들지 않는다. 유형 필터 상태에서는 그 종류의 값만 새로 오므로 **이전 값과 병합**해
     다른 칩의 숫자가 사라지지 않게 한다. */
  const [counts, setCounts] = useState<Partial<Record<DocumentType, number>>>({});

  const handleData = useCallback(
    ({ totals }: { totals: Partial<Record<DocumentType, number>> }) => {
      setCounts((prev) => {
        const changed = (Object.keys(totals) as DocumentType[]).some(
          (key) => prev[key] !== totals[key],
        );
        return changed ? { ...prev, ...totals } : prev;
      });
    },
    [],
  );

  /** `전체` 개수는 4종을 다 알고 있을 때만 뜻이 있다. 하나라도 모르면 숫자를 감춘다. */
  const allCount = DOCUMENT_TYPES.every((type) => counts[type] !== undefined)
    ? DOCUMENT_TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0)
    : undefined;

  /* `href()` 를 거치는 이유: typedRoutes 가 켜져 있고 종별 라우트 4개는 이번 작업에서 새로 만든
     파일이라 아직 생성 타입(`.expo/types/router.d.ts`)에 없다. 개발 서버가 타입을 재생성하면
     단언 없이도 통과한다. */
  const goTypeScreen = (meta: FilterMeta) => {
    if (!meta.route) return;
    router.push(href(meta.route));
  };

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="보관함"
        onSort={() => setSortOpen(true)}
        view={view}
        onToggleView={toggleView}
        testID="archive-hub-header"
      />

      {/* ── 유형 필터 칩 (가로 스크롤) ──
          칩 탭 = 같은 화면에서 필터, 칩 롱프레스 = 유형 전용 화면 (SCR-14 인터랙션 표). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow 0 이 없으면 세로 방향으로 남은 공간을 전부 먹어 본문이 밀린다.
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}
      >
        {FILTERS.map((filter) => {
          const count = filter.value === 'ALL' ? allCount : counts[filter.value];
          return (
            <Chip
              key={filter.value}
              label={filter.label}
              selected={selected === filter.value}
              onPress={() => setSelected(filter.value)}
              {...(count === undefined ? {} : { count })}
              {...(filter.docTone ? { docTone: filter.docTone } : {})}
              testID={`archive-filter-${filter.value}`}
            />
          );
        })}
      </ScrollView>

      <ArchiveList
        types={types}
        view={view}
        sort={sort}
        empty={{
          title: active.empty.title,
          description: active.empty.description,
          actionLabel: active.empty.action,
          onAction: () => router.push('/scan'),
        }}
        errorMessage="보관함을 불러오지 못했습니다."
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        onDataChange={handleData}
        header={
          selected === 'ALL' || selected === 'TICKET' || selected === 'POSTER' ? (
            // 링크가 없는 유형도 같은 높이·라벨 구조를 유지해 첫 항목의 시작 위치를 통일한다.
            <View className="h-11 justify-center px-4">
              <Text className="text-body-sm font-w700 text-text-secondary">{active.label}</Text>
            </View>
          ) : (
            // 유형 필터 상태에서만 `전체 >` 링크를 띄운다 (SCR-14 구성 요소 표).
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${sectionLinkLabel} 보기`}
              onPress={() => {
                haptics.selection();
                goTypeScreen(active);
              }}
              // py-2 = 34dp 라 44dp 하한에 못 미친다 (A11Y §11-1)
              className="min-h-11 flex-row items-center justify-between px-4 py-2"
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
            >
              <Text className="text-body-sm font-w700 text-text-secondary">{active.label}</Text>
              <Text className="text-body-sm font-w600 text-action">{`${sectionLinkLabel} ›`}</Text>
            </Pressable>
          )
        }
        testID="archive-hub-list"
      />

      <SortSheet
        visible={sortOpen}
        options={SORT_OPTIONS}
        selected={sort}
        onSelect={setSort}
        onClose={() => setSortOpen(false)}
      />
    </View>
  );
}
