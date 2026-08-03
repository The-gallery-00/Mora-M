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
//  - 그룹 라벨 `전체명함`/`전체 명함` 혼용 → `전체 명함` 으로 통일 (GroupChipRail 이 소유)
//  - onClick 이 없던 유령 버튼 `명함 관리` → 폐기(기능은 SCR-22 가 흡수)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ALL_GROUP_ID,
  GroupChipRail,
  SortSheet,
  type CardGroupChip,
  type SortOption,
} from '@/components/documents';
import { useCardGroups, type CardGroupFilter, type DocumentDetail } from '@/features/documents';
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
  const [total, setTotal] = useState(0);
  const { view, toggleView } = useArchiveView('cards', 'list');

  /* 화면이 이미 떠 있는 상태에서 파라미터만 바뀌어 들어오는 경로(명함첩 관리 → 그룹 행 탭)를
     받는다. 렌더 중 조정 패턴 — 이펙트로 하면 한 프레임 동안 이전 그룹의 목록이 그려진다. */
  const [syncedGroupId, setSyncedGroupId] = useState(params.groupId);
  if (params.groupId !== syncedGroupId) {
    setSyncedGroupId(params.groupId);
    if (params.groupId) setGroupFilter(params.groupId);
  }

  const groupsQuery = useCardGroups();

  /* `onDataChange` 는 목록 컨테이너의 이펙트 의존성이다 — 인라인 화살표를 넘기면 매 렌더
     새 함수가 되어 이펙트가 계속 재실행된다. 반드시 `useCallback` 으로 고정한다. */
  const handleData = useCallback(({ total: loaded }: { total: number }) => {
    setTotal(loaded);
  }, []);

  const chips = useMemo<CardGroupChip[]>(
    // 고정 2개(전체 명함 / 미분류)는 GroupChipRail 이 스스로 앞에 붙인다 — 서버 그룹만 넘긴다.
    () => (groupsQuery.data ?? []).map((group) => ({ id: group.id, name: group.name })),
    [groupsQuery.data],
  );

  const isGroupFiltered = groupFilter !== ALL_GROUP_ID;

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="명함"
        count={total}
        onBack={() => router.back()}
        onSort={() => setSortOpen(true)}
        view={view}
        onToggleView={toggleView}
        testID="archive-cards-header"
      />

      <GroupChipRail
        groups={chips}
        selectedId={groupFilter}
        onSelect={setGroupFilter}
        onManage={() => router.push(href('/groups'))}
        onAdd={() => router.push(href('/groups?compose=1'))}
        loading={groupsQuery.isLoading}
        testID="archive-cards-groups"
      />

      <ArchiveList
        types={['BUSINESS_CARD']}
        view={view}
        sort={sort}
        group={groupFilter}
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
                actionLabel: '명함 옮기기',
                onAction: () => router.push(href('/groups')),
              }
            : {
                title: '아직 저장된 명함이 없습니다',
                description: '명함을 촬영하면 이름·회사·연락처를 자동으로 정리해 드려요.',
                actionLabel: '명함 스캔하기',
                onAction: () => router.push('/scan'),
              }
        }
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        onDataChange={handleData}
        testID="archive-cards-list"
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
