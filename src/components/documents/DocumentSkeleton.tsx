// src/components/documents/DocumentSkeleton.tsx
//
// 보관함 목록·그리드의 **최초 로드** 자리표시자 — Mobile UX Guide §6 로딩 위계 2단계.
// "실제 카드와 같은 형태의 회색 블록 + shimmer 1200ms" 가 요구사항이므로 치수를 CMP-29/30 과 맞춘다:
// 리스트 = 썸네일 72×48 / 행 높이 80, 그리드 = 카드 비율 + 제목 2줄.
//
// 위계 0(캐시)·1(낙관적 업데이트)이 가능한 상황에서는 이걸 쓰지 않는다. 재진입은 캐시가 먼저다.
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { Skeleton } from '@/components/ui';
import { spacing } from '@/theme/scale';

export type DocumentSkeletonVariant = 'list' | 'grid';

export interface DocumentSkeletonProps {
  variant?: DocumentSkeletonVariant; // default 'list'
  /** 반복 개수. SCR-15 는 리스트 5행, SCR-17 은 그리드 4장을 지정한다 */
  count?: number;
  /** 그리드 카드 이미지 비율. 명함 4:3 / 포스터 3:4 */
  aspectRatio?: number;
  /** 그리드 카드 폭. 미지정이면 SCR-17 기준(거터 16 · gap 12 · 2열)으로 계산한다 */
  cardWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const THUMB_WIDTH = 72;
const THUMB_HEIGHT = 48;
const GRID_GAP = spacing.md; // 12
const GRID_GUTTER = spacing.lg; // 16

function ListRow() {
  return (
    <View className="h-20 flex-row items-center px-4">
      <Skeleton width={THUMB_WIDTH} height={THUMB_HEIGHT} radius={6} />
      <View className="ml-3 flex-1 gap-1.5">
        <Skeleton width="55%" height={16} radius={4} />
        <Skeleton width="72%" height={13} radius={4} />
        <Skeleton width="40%" height={11} radius={4} />
      </View>
    </View>
  );
}

function GridCard({ width, aspectRatio }: { width: number; aspectRatio: number }) {
  // mat 4dp 를 뺀 실제 이미지 폭에서 높이를 낸다 — 실제 카드와 높이가 어긋나면 전환 때 리스트가 튄다
  const innerWidth = width - 2 /* border */ - spacing.xxs * 2; /* p-1 = 4dp 양쪽 */
  const imageHeight = Math.max(0, Math.round(innerWidth / aspectRatio));

  return (
    <View
      className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated"
      style={{ width }}
    >
      <View className="bg-surface-alt p-1">
        <Skeleton width="100%" height={imageHeight} radius={6} />
      </View>
      <View className="gap-1.5 px-3 py-3">
        <Skeleton width="80%" height={16} radius={4} />
        <Skeleton width="50%" height={11} radius={4} />
      </View>
    </View>
  );
}

export function DocumentSkeleton({
  variant = 'list',
  count,
  aspectRatio = 4 / 3,
  cardWidth,
  style,
  testID,
}: DocumentSkeletonProps) {
  const { width: screenWidth } = useWindowDimensions();
  const total = Math.max(0, count ?? (variant === 'grid' ? 4 : 5));
  const items = Array.from({ length: total }, (_, i) => i);
  const resolvedCardWidth =
    cardWidth ?? Math.floor((screenWidth - GRID_GUTTER * 2 - GRID_GAP) / 2);

  return (
    <View
      testID={testID}
      style={style}
      // 자리표시자는 스크린리더가 읽을 내용이 없다(A11Y-04)
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {variant === 'list' ? (
        <View>
          {items.map((i) => (
            <ListRow key={i} />
          ))}
        </View>
      ) : (
        <View
          className="flex-row flex-wrap"
          style={{ paddingHorizontal: GRID_GUTTER, gap: GRID_GAP }}
        >
          {items.map((i) => (
            <GridCard key={i} width={resolvedCardWidth} aspectRatio={aspectRatio} />
          ))}
        </View>
      )}
    </View>
  );
}
