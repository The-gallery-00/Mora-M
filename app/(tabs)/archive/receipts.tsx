// app/(tabs)/archive/receipts.tsx
//
// SCR-18 영수증 목록(가계부) — **이식이 아니라 구현**이다.
// 원본은 전 화면이 목업(`MOCK_ROWS` 3건, 예산 2,500,000 하드코딩)이고 `lib/api` 에서 아무
// 함수도 import 하지 않는다. 서버 `GET /api/receipts`(API-49)는 완성돼 있는데 웹이 안 썼을 뿐이다.
//
// 원본에서 **의도적으로 버린 것**
//  - `수입`/`지출` 구분: 서버 `Receipt` 엔티티에 해당 컬럼이 **없다**. 목업만의 개념이라
//    UI 에 노출하면 거짓 정보가 된다.
//  - `예산 잔액` KPI / `지난달 대비 +8.2%`: 서버에 근거가 없다. → `이달 지출` 단일 KPI + 건수.
//  - `카테고리`/`결제수단` 필터: `Receipt` 에 `category` 컬럼이 없고 `paymentMethod` 는
//    OCR 스키마에 없어 채워지지 않는다. → `월 선택` 하나만 제공한다.
//
// **월 필터는 클라이언트 계산이다.** 서버에 기간 파라미터가 없다. 그래서 진입 시 최대 5페이지
// (=100건)까지 자동으로 더 받고, 그보다 많으면 KPI 옆에 `최근 100건 기준` 캡션을 붙여
// 숫자의 한계를 화면에서 정직하게 밝힌다(SCR-18 데이터 표 각주).
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { SortSheet, type SortOption } from '@/components/documents';
import { IconButton } from '@/components/ui';
import type { DocumentDetail } from '@/features/documents';
import {
  ARCHIVE_SORT_LABELS,
  ArchiveHeader,
  ArchiveList,
  formatDateShortKo,
  formatWon,
  useArchiveView,
  type ArchiveSectionSpec,
  type ArchiveSort,
} from '@/features/documents/ArchiveList';
import { tabScrollBottomPadding } from '@/navigation/shell';
import { useTheme } from '@/theme/ThemeProvider';

const SORT_OPTIONS: SortOption<ArchiveSort>[] = [
  { value: 'purchaseDate', label: ARCHIVE_SORT_LABELS.purchaseDate },
  { value: 'amountDesc', label: ARCHIVE_SORT_LABELS.amountDesc },
  { value: 'recent', label: ARCHIVE_SORT_LABELS.recent },
];

/** 월 소계·KPI 를 자동 프리페치할 상한 (20건 × 5 = 100건). */
const AUTO_LOAD_PAGES = 5;

/**
 * 영수증의 날짜 축.
 * `purchaseDate` 가 정본이지만 OCR 이 날짜를 못 읽은 레코드가 실제로 존재한다. 그 문서를
 * 어느 달에도 넣지 않으면 **화면에서 영영 사라지므로** 등록일로 폴백한다.
 */
const receiptDateOf = (doc: DocumentDetail): string =>
  doc.type === 'RECEIPT' ? doc.purchaseDate || (doc.createdAt ?? '').slice(0, 10) : '';

const amountOf = (doc: DocumentDetail): number =>
  doc.type === 'RECEIPT' ? (doc.totalAmount ?? 0) : 0;

/** `2026-07` 형태의 월 키. */
const monthKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const shiftMonth = (monthKey: string, delta: number): string => {
  const parts = monthKey.split('-');
  const year = Number(parts[0] ?? '');
  const month = Number(parts[1] ?? '');
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return monthKeyOf(new Date(year, month - 1 + delta, 1));
};

const monthLabel = (monthKey: string): string => {
  const parts = monthKey.split('-');
  return parts[0] && parts[1] ? `${parts[0]}년 ${Number(parts[1])}월` : monthKey;
};

function ChevronLeft({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5L8 12L15 19" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronRight({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5L16 12L9 19" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 일자 섹션 + 우측 소계 (클라이언트 계산 — 서버가 주지 않는다). */
const DAY_SECTION: ArchiveSectionSpec = {
  of: receiptDateOf,
  title: (key) => (key ? formatDateShortKo(key) : '날짜 없음'),
  trailing: (docs) => formatWon(docs.reduce((sum, doc) => sum + amountOf(doc), 0)),
};

export default function ArchiveReceiptsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useTheme();

  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [sort, setSort] = useState<ArchiveSort>('purchaseDate');
  const [sortOpen, setSortOpen] = useState(false);
  const [stats, setStats] = useState({ amount: 0, count: 0, capped: false });
  // 영수증은 텍스트 원장이라 그리드가 의미 없다 — 리스트 고정.
  const { view } = useArchiveView('receipts', 'list');

  const filter = useCallback(
    (doc: DocumentDetail) => receiptDateOf(doc).startsWith(month),
    [month],
  );

  /* KPI 는 **현재 월로 걸러진 문서**로만 계산한다. `hasMore` 가 참이면 아직 못 받아온 페이지가
     있다는 뜻이고, 그때 합계는 `최근 100건 기준` 이라는 단서와 함께 보여야 한다. */
  const handleData = useCallback(
    ({ docs, hasMore }: { docs: DocumentDetail[]; hasMore: boolean }) => {
      const amount = docs.reduce((sum, doc) => sum + amountOf(doc), 0);
      setStats((prev) =>
        prev.amount === amount && prev.count === docs.length && prev.capped === hasMore
          ? prev
          : { amount, count: docs.length, capped: hasMore },
      );
    },
    [],
  );

  const header = useMemo(
    () => (
      <View className="gap-3 px-4 pb-3 pt-2">
        {/* ── 월 네비게이션 ── */}
        <View className="h-11 flex-row items-center justify-between rounded-card border border-border-subtle bg-bg-elevated px-2">
          <IconButton
            icon={<ChevronLeft color={t.text.secondary} />}
            onPress={() => setMonth(shiftMonth(month, -1))}
            size="md"
            haptic
            accessibilityLabel="이전 달"
            testID="receipts-prev-month"
          />
          <Text className="text-input font-w700 text-text-primary" maxFontSizeMultiplier={1.3}>
            {monthLabel(month)}
          </Text>
          <IconButton
            icon={<ChevronRight color={t.text.secondary} />}
            onPress={() => setMonth(shiftMonth(month, 1))}
            size="md"
            haptic
            accessibilityLabel="다음 달"
            testID="receipts-next-month"
          />
        </View>

        {/* ── 이달 지출 KPI ── */}
        <View className="gap-1 rounded-card border border-border-subtle bg-bg-elevated p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-caption text-text-muted">이달 지출</Text>
            {stats.capped ? (
              <Text className="text-caption text-text-muted">최근 100건 기준</Text>
            ) : null}
          </View>
          <View className="flex-row items-end justify-between">
            <Text className="text-stat font-w800 text-danger" maxFontSizeMultiplier={1.2}>
              {formatWon(stats.amount)}
            </Text>
            <Text className="text-body-sm text-text-muted">{stats.count}건</Text>
          </View>
        </View>
      </View>
    ),
    [month, stats.amount, stats.capped, stats.count, t.text.secondary],
  );

  return (
    <View className="flex-1 bg-bg-base">
      <ArchiveHeader
        title="가계부"
        onBack={() => router.replace({ pathname: '/(tabs)/archive', params: { type: 'RECEIPT' } })}
        onSort={() => setSortOpen(true)}
        testID="archive-receipts-header"
      />

      <ArchiveList
        types={['RECEIPT']}
        view={view}
        sort={sort}
        filter={filter}
        showTypeBadge={false}
        // 일자 소계는 구매일 축으로 정렬돼 있을 때만 뜻이 통한다. 금액 순에서는 섹션을 끈다.
        {...(sort === 'purchaseDate' ? { section: DAY_SECTION } : {})}
        header={header}
        autoLoadPages={AUTO_LOAD_PAGES}
        // 원본 문구 그대로. 월 필터로 0건이 된 상태와 아예 0건인 상태를 나눈다.
        filteredEmptyText="해당 조건의 거래가 없습니다"
        empty={{
          title: '아직 저장된 영수증이 없습니다',
          description: '영수증을 촬영하면 가게·금액·날짜를 정리해 드려요.',
          actionLabel: '영수증 스캔하기',
          onAction: () => router.push('/scan'),
        }}
        errorMessage="영수증을 불러오지 못했습니다."
        bottomPadding={tabScrollBottomPadding(insets.bottom)}
        onDataChange={handleData}
        testID="archive-receipts-list"
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
