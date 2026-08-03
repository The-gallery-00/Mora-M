// src/components/documents/GroupChipRail.tsx
//
// CMP-45 GroupChipRail — Component Library §2 (1-E) 정본.
// 원본 명함 화면의 **220px 고정 사이드바**(내 명함 / 명함첩 / 그룹 목록 / `+ 그룹 추가`)를 대체한다.
// 390dp 화면에서 220dp 사이드바는 56% 를 먹는다 → 상단 가로 칩 레일 + 우측 고정 `⚙ 관리`(SCR-22).
//
// 칩은 CMP-06 Chip 을 그대로 재사용한다(햅틱 HAP-01 포함). 이 컴포넌트가 하는 일은
// 고정 항목 2개를 항상 앞에 놓는 정규화와 레이아웃뿐이다.
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Chip, IconButton, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/scale';

export interface CardGroupChip {
  /** 서버 그룹 id 또는 고정값 'all' | 'ungrouped' */
  id: string;
  name: string;
  count?: number;
}

export interface GroupChipRailProps {
  groups: CardGroupChip[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** 우측 ⚙ → SCR-22 명함 그룹 관리 */
  onManage: () => void;
  /** 주면 레일 끝에 `+ 명함첩 추가` 칩이 붙는다 (SCR-22 입력 시트로 직행) */
  onAdd?: () => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const ALL_GROUP_ID = 'all';
export const UNGROUPED_GROUP_ID = 'ungrouped';

/* 원본은 `전체명함`(띄어쓰기 없음)과 `전체 명함`을 섞어 썼다 — 원본 버그이므로 `전체 명함`으로 통일한다
   (Screen Specs 잔여 이슈 12). */
const FIXED_NAMES: Record<string, string> = {
  [ALL_GROUP_ID]: '전체 명함',
  [UNGROUPED_GROUP_ID]: '미분류',
};

function GearIcon({ color }: { color: string }) {
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}

function PlusGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/** 고정 2개(전체 명함 / 미분류)를 항상 앞에 두고, 서버가 같은 id 로 준 개수는 살린다. */
function normalizeGroups(groups: CardGroupChip[]): CardGroupChip[] {
  const fixedIds = [ALL_GROUP_ID, UNGROUPED_GROUP_ID];
  const head: CardGroupChip[] = fixedIds.map((id) => {
    const incoming = groups.find((g) => g.id === id);
    return {
      id,
      name: FIXED_NAMES[id] ?? id,
      ...(incoming?.count !== undefined ? { count: incoming.count } : {}),
    };
  });
  const rest = groups.filter((g) => !fixedIds.includes(g.id));
  return [...head, ...rest];
}

export function GroupChipRail({
  groups,
  selectedId,
  onSelect,
  onManage,
  onAdd,
  loading = false,
  style,
  testID,
}: GroupChipRailProps) {
  const t = useTheme();
  const items = normalizeGroups(groups);

  return (
    <View
      testID={testID}
      className="flex-row items-center border-b border-bg-sunken bg-bg-elevated py-2"
      style={style}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
          alignItems: 'center',
        }}
        className="flex-1"
      >
        {loading ? (
          // 로딩 위계 2단계 — 실제 칩과 같은 높이(34dp)·모양의 스켈레톤
          <>
            <Skeleton width={88} height={34} radius={999} />
            <Skeleton width={64} height={34} radius={999} />
            <Skeleton width={76} height={34} radius={999} />
          </>
        ) : (
          <>
            {items.map((group) => (
              <Chip
                key={group.id}
                label={group.name}
                {...(group.count !== undefined ? { count: group.count } : {})}
                selected={group.id === selectedId}
                onPress={() => onSelect(group.id)}
                tone="brand"
                size="md"
                accessibilityLabel={
                  group.count === undefined
                    ? group.name
                    : `${group.name}, ${group.count}건`
                }
                testID={`group-chip-${group.id}`}
              />
            ))}

            {onAdd ? (
              // 원본 사이드바의 `+ 그룹 추가` 자리. 문구는 SCR-22 의 `+ 명함첩 추가` 로 통일한다.
              <Chip
                label="명함첩 추가"
                leadingIcon={<PlusGlyph color={t.text.muted} />}
                onPress={onAdd}
                tone="neutral"
                size="md"
                accessibilityLabel="명함첩 추가"
                testID="group-chip-add"
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* 레일과 분리된 고정 액션 — 스크롤에 밀려 사라지면 안 된다 */}
      <View className="h-6 w-px bg-bg-sunken" />
      <View className="px-1">
        <IconButton
          icon={<GearIcon color={t.text.secondary} />}
          onPress={onManage}
          size="lg"
          haptic
          accessibilityLabel="명함첩 관리"
          testID="group-manage"
        />
      </View>
    </View>
  );
}
