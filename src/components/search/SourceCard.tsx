// src/components/search/SourceCard.tsx
//
// CMP-40 SourceCard — Component Library §2 (1-G) 정본. SCR-24 답변 하단의 출처 카드(FR-079).
// 카드 200×72 · radius 10 · border `border.subtle` · bg `bg.elevated`, 가로 스크롤 레일에 배치한다.
//
// **props 가 정본 시그니처와 다른 점 1가지** — 정본은 `source: Record<string, unknown>`(서버 DTO
// 원본)을 받아 카드가 직접 파싱하지만, 이 앱에서는 `features/chat/api.ts` 가 이미
// `toDocumentDetail → toDocumentSummary` 를 통과시켜 `DocumentSummary` 로 내려 준다.
// 파싱을 컴포넌트로 되돌리면 제목·부제 규칙이 보관함/검색과 갈린다(Data Model §5-1: 변환은 한 곳).
//
// 원본 웹은 `sources` 를 아예 표시하지 않았다 — 이 컴포넌트는 모바일 신규다.
import { Pressable, Text, View } from 'react-native';

import { DocTypeBadge } from '@/components/documents';
import { DOCUMENT_TYPE_LABELS, type DocumentSummary } from '@/features/documents';
import { radius } from '@/theme/scale';

export const SOURCE_CARD_WIDTH = 200;
export const SOURCE_CARD_HEIGHT = 72;

export interface SourceCardProps {
  source: DocumentSummary;
  /** 탭 → SCR-19. 이동 경로 조립(`DOC_ROUTE_SEGMENT`)은 화면이 한다. */
  onPress: (source: DocumentSummary) => void;
  testID?: string;
}

export function SourceCard({ source, onPress, testID }: SourceCardProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`출처, ${DOCUMENT_TYPE_LABELS[source.type]}, ${source.title}`}
      onPress={() => onPress(source)}
      // SCR-24 인터랙션 표 — 출처 카드 탭 scale 0.98
      style={({ pressed }) => [
        { width: SOURCE_CARD_WIDTH, height: SOURCE_CARD_HEIGHT, borderRadius: radius.button },
        pressed ? { opacity: 0.9 } : null,
      ]}
      className="justify-center gap-1 border border-border-subtle bg-bg-elevated px-3"
    >
      <View className="flex-row items-center gap-1.5">
        <DocTypeBadge docType={source.type} />
        <Text
          className="shrink text-body-sm font-w700 text-text-primary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {source.title}
        </Text>
      </View>

      {source.subtitle ? (
        <Text className="text-caption text-text-muted" numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {source.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}
