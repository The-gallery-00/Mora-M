// src/components/search/RecentQueryList.tsx
//
// CMP-42 RecentQueryList — Component Library §2 (1-G) 정본. SCR-23 미입력 상태의 최근 검색어.
// 헤더 `최근 검색어` + `전체 삭제`, 행 h48 (`🕐 {검색어} … ✕`).
//
// **props 가 정본 시그니처와 다른 점 1가지** — 정본은 `items: RecentQuery[]`(서버 API-54 행:
// `{id, query, documentType, createdAt}`) 에 `onRemove(id)` 지만, 이 화면의 최근 검색어는
// **로컬 MMKV `search.recent` 가 1차 소스**다(ST-06). 로컬 항목에는 서버 id 가 없고 동일성은
// `(q, docType)` 쌍으로 정해지므로(`features/search/recent.ts`) 그 쌍을 그대로 받는다.
// 서버 기록(API-54)은 `전체 기록 보기` 전용이며 이 컴포넌트를 거치지 않는다.
//
// 유형 라벨을 행 우측에 붙이는 것은 와이어프레임에 없는 추가다. 같은 검색어라도 `명함`으로
// 찾은 것과 `티켓`으로 찾은 것은 **탭했을 때 복원되는 칩이 다른 별개 항목**이라(dedupe 키가
// `(q, docType)`), 라벨이 없으면 완전히 같은 두 줄이 나란히 보인다.
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  SEARCH_COPY,
  SEARCH_DOC_TYPE_LABELS,
  type RecentSearch,
  type SearchDocType,
} from '@/features/search';
import { useTheme } from '@/theme/ThemeProvider';

export interface RecentQueryListProps {
  items: readonly RecentSearch[];
  /** 탭 → 검색어와 칩을 함께 복원하고 즉시 재검색한다 (SCR-23 인터랙션 표). */
  onSelect: (q: string, docType: SearchDocType) => void;
  /** ✕ → **로컬에서만** 제거. 서버에는 단건 삭제 API 가 없다. */
  onRemove: (q: string, docType: SearchDocType) => void;
  /** `전체 삭제` → 확인 다이얼로그 후 API-55. 확인 절차는 화면이 소유한다. */
  onClearAll: () => void;
  /** 삭제 요청 진행 중 — `전체 삭제` 를 잠가 중복 호출을 막는다. */
  clearing?: boolean;
  testID?: string;
}

/** 🕐 — lucide `Clock` 자리. 패키지 추가 금지라 같은 실루엣으로 그린다. */
function ClockIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.7} />
      <Path d="M12 7.5V12L15 14" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

function XIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function RecentQueryList({
  items,
  onSelect,
  onRemove,
  onClearAll,
  clearing = false,
  testID,
}: RecentQueryListProps) {
  const t = useTheme();

  // 빈(최근 검색어 0) — 섹션 자체를 숨긴다 (SCR-23 상태표).
  if (items.length === 0) return null;

  return (
    <View testID={testID}>
      <View className="mb-1 flex-row items-center justify-between">
        <Text
          className="text-input font-w600 text-text-primary"
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
        >
          {SEARCH_COPY.recentTitle}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SEARCH_COPY.clearAll}
          accessibilityState={{ disabled: clearing }}
          disabled={clearing}
          onPress={onClearAll}
          // body-sm 한 줄(18dp) — 실효 44dp 를 hitSlop 으로 만든다 (§11-1)
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text
            className={`text-body-sm font-w600 ${clearing ? 'text-text-disabled' : 'text-text-muted'}`}
            maxFontSizeMultiplier={1.3}
          >
            {SEARCH_COPY.clearAll}
          </Text>
        </Pressable>
      </View>

      <View className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated">
        {items.map((item, index) => (
          <View
            key={`${item.docType}:${item.q}`}
            className={`flex-row items-center px-3 ${index === 0 ? '' : 'border-t border-border-subtle'}`}
            style={{ height: 48 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.q}, ${SEARCH_DOC_TYPE_LABELS[item.docType]}으로 다시 검색`}
              onPress={() => onSelect(item.q, item.docType)}
              className="h-full flex-1 flex-row items-center gap-2"
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            >
              <ClockIcon color={t.text.disabled} />
              <Text
                className="flex-1 text-base text-text-primary"
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {item.q}
              </Text>
              <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
                {SEARCH_DOC_TYPE_LABELS[item.docType]}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.q} 삭제`}
              onPress={() => onRemove(item.q, item.docType)}
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              className="ml-2 h-full items-center justify-center"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            >
              <XIcon color={t.text.disabled} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
