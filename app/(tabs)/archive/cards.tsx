// app/(tabs)/archive/cards.tsx
//
// SCR-15 명함 목록.
//
// 원본(`dashboard/storage/cards/page.tsx`)의 **220px 고정 사이드바**를 상단 그룹 칩 레일 + 우측
// `⚙ 관리`(SCR-22)로 바꾼 화면이다. 390dp 폭에서 사이드바 220dp 는 화면의 56% 를 먹는다.
//
// 원본 대비 고친 것
//  - 삭제 버튼이 `position:absolute right:8` 로 이메일 컬럼을 덮던 버그 → 좌스와이프 삭제
//  - 인라인 확인 2버튼 → 확인 다이얼로그
//  - 날짜 그룹 헤더가 `createdAt.split('T')[0]` 원문(`2026-07-27`) → `2026년 7월 27일` + sticky
//  - 그룹 라벨은 GroupChipRail 이 소유
//  - onClick 이 없던 유령 버튼 `명함 관리` → 폐기(기능은 SCR-22 가 흡수)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import {
  ALL_GROUP_ID,
  GroupChipRail,
  SortSheet,
  UNGROUPED_GROUP_ID,
  type CardGroupChip,
  type SortOption,
} from '@/components/documents';
import { Button, IconButton, toast } from '@/components/ui';
import {
  useCardGroups,
  useInfiniteDocuments,
  useMoveCardToGroup,
  type CardGroupFilter,
  type DocumentDetail,
} from '@/features/documents';
import {
  ARCHIVE_SORT_LABELS,
  ArchiveHeader,
  ArchiveList,
  formatDateKo,
  href,
  useArchiveView,
  type ArchiveSectionSpec,
  type ArchiveSort,
} from '@/features/documents/ArchiveList';
import { tabScrollBottomPadding } from '@/navigation/shell';

/** 원본 정렬 `<select>` 문구 그대로 (`등록일 순` / `오래된 순`). */
const SORT_OPTIONS: SortOption<ArchiveSort>[] = [
  { value: 'recent', label: ARCHIVE_SORT_LABELS.recent },
  { value: 'oldest', label: ARCHIVE_SORT_LABELS.oldest },
];

/** 등록일(`createdAt`) 기준 날짜 섹션. sticky 헤더로 스크롤 중 현재 날짜가 계속 보인다. */
const DATE_SECTION: ArchiveSectionSpec = {
  of: (doc: DocumentDetail) => (doc.createdAt ?? '').slice(0, 10),
  title: (key: string) => (key ? formatDateKo(key) : '날짜 없음'),
};

/** lucide `list-checks` — 목록 다중 선택 진입. 색은 IconButton이 주입한다. */
function ListChecksIcon({ color }: { color?: string }) {
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m3 7 2 2 4-4" />
      <Path d="m3 17 2 2 4-4" />
      <Path d="M13 6h8" />
      <Path d="M13 12h8" />
      <Path d="M13 18h8" />
    </Svg>
  );
}

export default function ArchiveCardsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // SCR-22 에서 그룹 행을 탭하면 `?groupId=` 로 되돌아온다 (Navigation Map §7 `groupId` 계약).
  const params = useLocalSearchParams<{ groupId?: string }>();

  const [groupFilter, setGroupFilter] = useState<CardGroupFilter>(
    () => params.groupId ?? ALL_GROUP_ID,
  );
  const [sort, setSort] = useState<ArchiveSort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const { view, toggleView } = useArchiveView('cards', 'list');

  /* 화면이 이미 떠 있는 상태에서 파라미터만 바뀌어 들어오는 경로(명함첩 관리 → 그룹 행 탭)를
     받는다. 렌더 중 조정 패턴 — 이펙트로 하면 한 프레임 동안 이전 그룹의 목록이 그려진다. */
  const [syncedGroupId, setSyncedGroupId] = useState(params.groupId);
  if (params.groupId !== syncedGroupId) {
    setSyncedGroupId(params.groupId);
    if (params.groupId) setGroupFilter(params.groupId);
  }

  const groupsQuery = useCardGroups();
  const allCardsQuery = useInfiniteDocuments('BUSINESS_CARD', { group: ALL_GROUP_ID });
  const {
    documents: allCards,
    total: allCardsTotal,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: areAllCardsPending,
  } = allCardsQuery;

  /* 그룹 API에는 수량이 없으므로 전체 명함 목록의 모든 페이지를 한 번만 채운 뒤 집계한다.
     `전체` 필터의 ArchiveList와 query key가 같아 첫 조회와 캐시는 중복되지 않는다. */
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    allCards.forEach((document) => {
      if (document.type !== 'BUSINESS_CARD') return;
      const groupId = document.groupId ?? UNGROUPED_GROUP_ID;
      counts[groupId] = (counts[groupId] ?? 0) + 1;
    });

    return counts;
  }, [allCards]);

  const chips = useMemo<CardGroupChip[]>(
    () => [
      { id: ALL_GROUP_ID, name: '전체', count: allCardsTotal },
      {
        id: UNGROUPED_GROUP_ID,
        name: '미분류',
        count: groupCounts[UNGROUPED_GROUP_ID] ?? 0,
      },
      ...(groupsQuery.data ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        count: groupCounts[group.id] ?? 0,
      })),
    ],
    [allCardsTotal, groupCounts, groupsQuery.data],
  );

  const countsLoading =
    areAllCardsPending ||
    isFetchingNextPage ||
    hasNextPage === true;

  const filteredGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const moveCardMutation = useMoveCardToGroup(groupFilter);

  const toggleSelection = useCallback((doc: DocumentDetail) => {
    const key = String(doc.id);
    setSelectedIds((current) =>
      current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
    );
  }, []);

  const closeSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
    setMoveSheetOpen(false);
  }, []);

  const handleMoveToGroup = useCallback(
    (groupId: string) => {
      if (selectedIds.length === 0) {
        closeSelectionMode();
        return;
      }
      selectedIds.forEach((cardId) => {
        moveCardMutation.mutate({ cardId, groupId }, {
          onError: (error) => toast.error(error.message),
        });
      });
      toast.success('선택한 명함을 그룹으로 옮기고 있습니다.');
      closeSelectionMode();
    },
    [closeSelectionMode, moveCardMutation, selectedIds],
  );

  const isGroupFiltered = groupFilter !== ALL_GROUP_ID;

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="명함첩"
        onBack={() => router.replace({ pathname: '/(tabs)/archive', params: { type: 'BUSINESS_CARD' } })}
        onSort={() => setSortOpen(true)}
        view={view}
        onToggleView={toggleView}
        leadingAction={selectionMode ? (
          <Button
            label="취소"
            onPress={() => {
              if (selectionMode) closeSelectionMode();
              else setSelectionMode(true);
            }}
            size="sm"
            variant="ghost"
            haptic="selection"
            testID="archive-cards-select"
          />
        ) : (
          <IconButton
            icon={<ListChecksIcon />}
            onPress={() => setSelectionMode(true)}
            size="sm"
            haptic
            accessibilityLabel="선택"
            testID="archive-cards-select"
          />
        )}
        trailing={selectionMode ? (
          <Button
            label={`이동${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
            onPress={() => setMoveSheetOpen(true)}
            size="sm"
            variant="primary"
            disabled={selectedIds.length === 0}
            testID="archive-cards-move"
          />
        ) : undefined}
        testID="archive-cards-header"
      />

      <GroupChipRail
        groups={chips}
        selectedId={groupFilter}
        onSelect={setGroupFilter}
        onManage={() => router.push(href('/groups'))}
        onAdd={() => router.push(href('/groups?compose=1'))}
        loading={groupsQuery.isLoading || countsLoading}
        testID="archive-cards-groups"
      />

      <ArchiveList
        types={['BUSINESS_CARD']}
        view={view}
        sort={sort}
        group={groupFilter}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelection}
        // 명함만 담는 목록이라 모든 행에 `명함` 배지가 반복돼 정보가 0이다 → 배지·셰브런 모두 끈다
        // (피그마 SCR-16 개정). 허브의 `명함` 필터에서는 다른 유형과 섞이므로 배지를 유지한다.
        showTypeBadge={false}
        // 날짜 헤더는 등록일 축으로 정렬돼 있을 때만 의미가 있다.
        {...(view === 'list' ? { section: DATE_SECTION } : {})}
        empty={
          isGroupFiltered
            ? {
                // 그룹 필터의 빈 상태는 "명함이 없다"가 아니라 "이 명함첩이 비었다"다.
                title: '이 명함첩에 저장된 명함이 없습니다.',
              }
            : {
                title: '아직 저장된 명함이 없습니다',
                description: '명함을 촬영하면 이름·회사·연락처를 정리해 드려요.',
                actionLabel: '명함 스캔하기',
                onAction: () => router.push('/scan'),
              }
        }
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        testID="archive-cards-list"
      />

      <SortSheet
        visible={sortOpen}
        options={SORT_OPTIONS}
        selected={sort}
        onSelect={setSort}
        onClose={() => setSortOpen(false)}
      />

      <Modal
        visible={moveSheetOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMoveSheetOpen(false)}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          onPress={() => setMoveSheetOpen(false)}
        >
          <Pressable
            className="absolute bottom-0 left-0 right-0 rounded-t-sheet bg-bg-elevated p-4"
            onPress={() => undefined}
          >
            <Text className="text-body-lg font-w700 text-text-primary">명함첩에 옮기기</Text>
            <Text className="mt-2 text-body-sm text-text-secondary">
              선택한 명함 {selectedIds.length}개를 이동할 그룹을 선택하세요.
            </Text>
            <ScrollView className="mt-4 max-h-72">
              {filteredGroups.map((group) => (
                <Pressable
                  key={group.id}
                  onPress={() => {
                    setMoveSheetOpen(false);
                    handleMoveToGroup(group.id);
                  }}
                  className="rounded-card border border-border-subtle bg-bg-base p-4 mb-2"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
                >
                  <Text className="text-body-sm font-w700 text-text-primary">{group.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button
              label="취소"
              onPress={() => setMoveSheetOpen(false)}
              size="sm"
              variant="ghost"
              fullWidth
              testID="archive-cards-move-cancel"
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
