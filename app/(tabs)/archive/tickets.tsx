// app/(tabs)/archive/tickets.tsx
//
// SCR-16 티켓 목록.
//
// 원본 6컬럼 테이블(`80px 1fr 1fr 1fr 1fr auto`)을 카드 목록으로 바꿨다. 셀당 폭이 60dp 밖에
// 안 나와 구간(`수서 → 부산`)이 잘렸기 때문이다.
//
// **섹션 규칙(원본에는 없던 그룹핑)**: `departureDate >= 오늘` → `다가오는 일정`(오름차순),
// 그 외 → `지난 일정`(내림차순). 원본은 `createdAt` 단일 정렬이라 이미 지나간 티켓이 늘
// 상단을 점유했다. 정렬을 `등록일 순` 으로 바꾸면 이 구획도 함께 사라진다(등록일 축에는
// 다가옴/지남 개념이 없다).
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortSheet, type SortOption } from '@/components/documents';
import type { DocumentDetail } from '@/features/documents';
import {
  ARCHIVE_SORT_LABELS,
  ArchiveHeader,
  ArchiveList,
  primaryDateOf,
  ticketComparator,
  todayIso,
  useArchiveView,
  type ArchiveSectionSpec,
  type ArchiveSort,
} from '@/features/documents/ArchiveList';
import { tabScrollBottomPadding } from '@/navigation/shell';

const SORT_OPTIONS: SortOption<ArchiveSort>[] = [
  { value: 'departureDate', label: ARCHIVE_SORT_LABELS.departureDate },
  { value: 'recent', label: ARCHIVE_SORT_LABELS.recent },
];

const UPCOMING = 'upcoming';
const PAST = 'past';

export default function ArchiveTicketsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sort, setSort] = useState<ArchiveSort>('departureDate');
  const [sortOpen, setSortOpen] = useState(false);
  const [total, setTotal] = useState(0);
  /* 뷰 토글을 두지 않는다 — SCR-16 헤더에는 `⇅` 만 있다. 티켓의 핵심 정보는 구간·시각 텍스트라
     2열 그리드로 줄이면 `수서 → 부산` 이 다시 잘린다. 저장 키는 미리 잡아 둔다. */
  const { view } = useArchiveView('tickets', 'list');

  // 화면이 떠 있는 동안 '오늘'이 흔들리면 섹션이 튄다 — 마운트 시점 값으로 고정한다.
  const today = useMemo(() => todayIso(), []);

  /** `출발일 순` 일 때만 다가오는/지난 2구획. `등록일 순` 은 서버 정렬 그대로 단일 목록이다. */
  const byDeparture = sort === 'departureDate';

  const compare = useMemo(
    () => (byDeparture ? ticketComparator(today) : undefined),
    [byDeparture, today],
  );

  const section = useMemo<ArchiveSectionSpec | undefined>(
    () =>
      byDeparture
        ? {
            of: (doc: DocumentDetail) => (primaryDateOf(doc) >= today ? UPCOMING : PAST),
            title: (key: string) => (key === UPCOMING ? '다가오는 일정' : '지난 일정'),
          }
        : undefined,
    [byDeparture, today],
  );

  const handleData = useCallback(({ total: loaded }: { total: number }) => {
    setTotal(loaded);
  }, []);

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="티켓"
        count={total}
        onBack={() => router.back()}
        onSort={() => setSortOpen(true)}
        testID="archive-tickets-header"
      />

      <ArchiveList
        types={['TICKET']}
        view={view}
        sort={sort}
        {...(compare ? { compare } : {})}
        {...(section && view === 'list' ? { section } : {})}
        empty={{
          title: '아직 저장된 티켓이 없습니다',
          description: '티켓을 촬영하면 출발지·시간을 자동으로 정리해 드려요.',
          actionLabel: '티켓 스캔하기',
          onAction: () => router.push('/scan'),
        }}
        errorMessage="티켓을 불러오지 못했습니다."
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        onDataChange={handleData}
        testID="archive-tickets-list"
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
