// app/(tabs)/archive/posters.tsx
//
// SCR-17 포스터 목록.
//
// **기본이 2열 그리드**인 유일한 화면이다. 포스터는 이미지 자체가 정보라 텍스트 행보다
// 썸네일 격자가 인지 속도가 빠르다. 비율은 원본 포스터 비율 3:4.
// 원본 6컬럼 테이블과 썸네일 대체 문자 `P`(의미 전달 실패)를 대체한다.
//
// D-day 는 `eventEndDate ?? eventStartDate` 기준이다 — 마감이 있는 문서이므로 종료일이 우선이다
// (ArchiveList 의 행 매핑이 이 규칙을 소유한다).
// 라벨 표기는 `주최자` / `행사 시작일` / `행사 종료일` 로 통일한다(원본은 보관함과 검색이 달랐다).
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortSheet, type SortOption } from '@/components/documents';
import {
  ARCHIVE_SORT_LABELS,
  ArchiveHeader,
  ArchiveList,
  GRID_ASPECT_POSTER,
  useArchiveView,
  type ArchiveSort,
} from '@/features/documents/ArchiveList';
import { tabScrollBottomPadding } from '@/navigation/shell';

const SORT_OPTIONS: SortOption<ArchiveSort>[] = [
  { value: 'eventDate', label: ARCHIVE_SORT_LABELS.eventDate },
  { value: 'recent', label: ARCHIVE_SORT_LABELS.recent },
];

export default function ArchivePostersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sort, setSort] = useState<ArchiveSort>('eventDate');
  const [sortOpen, setSortOpen] = useState(false);
  const [total, setTotal] = useState(0);
  // 이 화면만 기본값이 grid 다.
  const { view, toggleView } = useArchiveView('posters', 'grid');

  const handleData = useCallback(({ total: loaded }: { total: number }) => {
    setTotal(loaded);
  }, []);

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="포스터"
        count={total}
        onBack={() => router.back()}
        onSort={() => setSortOpen(true)}
        view={view}
        onToggleView={toggleView}
        testID="archive-posters-header"
      />

      <ArchiveList
        types={['POSTER']}
        view={view}
        sort={sort}
        gridAspectRatio={GRID_ASPECT_POSTER}
        empty={{
          title: '아직 저장된 포스터가 없습니다',
          description: '포스터를 촬영하면 행사일과 마감일을 챙겨 드려요.',
          actionLabel: '포스터 스캔하기',
          onAction: () => router.push('/scan'),
        }}
        errorMessage="포스터를 불러오지 못했습니다."
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        onDataChange={handleData}
        testID="archive-posters-list"
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
