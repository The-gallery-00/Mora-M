// src/components/search/SearchResultCard.tsx
//
// CMP-41 SearchResultCard — Component Library §2 (1-G) 정본. SCR-23 결과 카드.
// 원본 `search/page.tsx` 의 3단(260px 1fr auto) 카드를 **썸네일 위 / 정보 아래 세로 스택**으로
// 바꾼 것 외에는 표시 규칙(제목·부제·facts·프리뷰·하이라이트)이 원본 `normalize*` 그대로다.
//
// 와이어프레임 수치: 이미지 h150 cover r10 · 제목 h3 + 유사도 배지 · 부제 bodySm ·
// facts wrap · 프리뷰 `"… {preview} …"` **2줄** + 첫 매칭 1회 하이라이트(`info` / 700).
//
// 하이라이트 색은 원본 `#2563EB` = 라이트 `info` 토큰이다(다크는 `#7FB0EF` 로 자동 치환).
// HEX 를 되돌려 놓지 마라 — 다크에서 대비가 무너진다(Design Tokens §10-5).
import { Image } from 'expo-image';
import { memo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { DocPlaceholderIcon, DocTypeBadge } from '@/components/documents';
import { resolveImageUrl } from '@/config/env';
import { DOCUMENT_TYPE_LABELS, type DocumentDetail, type DocumentType } from '@/features/documents';
import { useTheme } from '@/theme/ThemeProvider';

const IMAGE_HEIGHT = 150;

export interface SearchFact {
  label: string;
  value: string;
}

export interface SearchResultCardProps {
  docType: DocumentType;
  title: string;
  subtitle?: string;
  /** 서버 상대경로여도 된다 — 내부에서 `resolveImageUrl` 로 OCR 베이스에 붙인다. */
  imageUri?: string | null;
  facts?: SearchFact[];
  preview?: string;
  /** 하이라이트할 검색어. **첫 매칭 1회만** 강조한다(원본 `highlightText` 규칙). */
  query?: string;
  /** 0~1. 있으면 우상단 `98%` 배지. 영수증은 임베딩이 없어 값이 낮게 나온다(정상). */
  similarity?: number | null;
  /** `전체` 검색일 때만 true — 유형이 섞이므로 배지가 필수다. 단일 유형은 헤더에 이미 있다. */
  showTypeBadge?: boolean;
  onPress: () => void;
  testID?: string;
}

// ───────────────────────────────────────────────────────────── 하이라이트

/**
 * 첫 매칭 1회만 `info` + 700 으로 강조한다 (원본 `highlightText` 이식).
 *
 * 전부 강조하지 않는 이유도 원본과 같다: OCR 원문에는 같은 토큰이 여러 번 나오는 경우가 흔해
 * 전량 강조하면 프리뷰 두 줄이 통째로 파랗게 물든다.
 */
export function HighlightedText({
  text,
  query,
  className,
  numberOfLines,
}: {
  text: string;
  query?: string;
  className?: string;
  numberOfLines?: number;
}): ReactNode {
  const keyword = query?.trim() ?? '';
  const index = keyword === '' ? -1 : text.toLowerCase().indexOf(keyword.toLowerCase());

  return (
    <Text className={className} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.3}>
      {index < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, index)}
          {/* 중첩 Text 는 부모 스타일을 상속하므로 색·굵기만 덮어쓴다. */}
          <Text className="font-w700 text-info">{text.slice(index, index + keyword.length)}</Text>
          {text.slice(index + keyword.length)}
        </>
      )}
    </Text>
  );
}

// ───────────────────────────────────────────────────────────── facts

/** 원본 `formatDate` 계승 — ISO 문자열 앞 10자를 `YYYY.MM.DD` 로. 값이 없으면 `-`. */
function formatSavedAt(iso?: string): string {
  if (!iso) return '-';
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return matched ? `${matched[1]}.${matched[2]}.${matched[3]}` : iso;
}

/** 원본 `formatAmount` 계승 — 3자리 구분. 없으면 `-`. */
const formatAmount = (amount: number | null | undefined): string =>
  amount == null ? '-' : amount.toLocaleString('ko-KR');

const dash = (value: string): string => (value.trim() === '' ? '-' : value);

/**
 * 유형별 facts (SCR-23 "유형별 표시 필드" 표 = 원본 `normalize*` 의 `facts` 배열 그대로).
 * 카드가 소유한다 — 화면 4곳에서 같은 표를 다시 짜면 반드시 어긋난다.
 */
export function searchFactsOf(doc: DocumentDetail): SearchFact[] {
  switch (doc.type) {
    case 'BUSINESS_CARD':
      return [
        { label: '직함', value: dash(doc.position) },
        { label: '회사', value: dash(doc.company) },
        { label: '연락처', value: dash(doc.phone) },
        { label: '이메일', value: dash(doc.email) },
        { label: '저장일', value: formatSavedAt(doc.createdAt) },
      ];
    case 'TICKET':
      return [
        { label: '이동수단', value: dash(doc.transportType) },
        { label: '출발지', value: dash(doc.departureLocation) },
        { label: '출발일', value: dash(doc.departureDate) },
        { label: '출발시간', value: dash(doc.departureTime) },
        { label: '도착지', value: dash(doc.arrivalLocation) },
        { label: '도착일', value: dash(doc.arrivalDate) },
        { label: '도착시간', value: dash(doc.arrivalTime) },
        { label: '저장일', value: formatSavedAt(doc.createdAt) },
      ];
    case 'POSTER':
      return [
        { label: '주최', value: dash(doc.organizerName) },
        { label: '행사 시작일', value: dash(doc.eventStartDate) },
        { label: '행사 종료일', value: dash(doc.eventEndDate) },
        { label: '장소', value: dash(doc.location) },
        { label: '연락처', value: dash(doc.contactPhone) },
        { label: '이메일', value: dash(doc.contactEmail) },
        { label: '참가비', value: dash(doc.fee) },
        { label: '웹사이트', value: dash(doc.websiteUrl) },
        { label: '저장일', value: formatSavedAt(doc.createdAt) },
      ];
    case 'RECEIPT':
      return [
        { label: '상호명', value: dash(doc.merchantName) },
        { label: '주소', value: dash(doc.merchantAddress) },
        { label: '구매일', value: dash(doc.purchaseDate) },
        { label: '구매시간', value: dash(doc.purchaseTime) },
        { label: '결제수단', value: dash(doc.paymentMethod) },
        { label: '카드사', value: dash(doc.cardCompany) },
        {
          label: '총액',
          value: `${formatAmount(doc.totalAmount)} ${doc.currencyCode || 'KRW'}`,
        },
        { label: '저장일', value: formatSavedAt(doc.createdAt) },
      ];
  }
}

// ───────────────────────────────────────────────────────────── 본체

function SearchResultCardBase({
  docType,
  title,
  subtitle,
  imageUri,
  facts,
  preview,
  query,
  similarity,
  showTypeBadge = false,
  onPress,
  testID,
}: SearchResultCardProps) {
  const t = useTheme();
  const uri = resolveImageUrl(imageUri);
  const percent =
    similarity === null || similarity === undefined ? null : `${Math.round(similarity * 100)}%`;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[DOCUMENT_TYPE_LABELS[docType], title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      // MOT — 결과 카드 탭 scale 0.98 은 Pressable opacity 로 대체한다(리스트 셀에 Reanimated 를 얹지 않는다).
      style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
      className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated"
    >
      {/* 이미지가 없으면 자리를 비운다 — 빈 회색 블록 150dp 는 목록 스캔을 방해한다. */}
      {uri ? (
        <View className="bg-surface-alt" style={{ height: IMAGE_HEIGHT }}>
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : null}

      <View className="gap-1.5 p-4">
        <View className="flex-row items-center gap-1.5">
          {!uri ? <DocPlaceholderIcon color={t.text.disabled} size={18} /> : null}
          <Text
            className="shrink text-h3 font-w700 text-text-primary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </Text>
          {showTypeBadge ? <DocTypeBadge docType={docType} /> : null}
          <View className="flex-1" />
          {percent ? (
            <View className="rounded-full bg-info-container px-2 py-0.5">
              <Text className="text-micro font-w700 text-info" maxFontSizeMultiplier={1.2}>
                {percent}
              </Text>
            </View>
          ) : null}
        </View>

        {subtitle ? (
          <Text
            className="text-body-sm text-text-secondary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {subtitle}
          </Text>
        ) : null}

        {facts && facts.length > 0 ? (
          <View className="mt-0.5 flex-row flex-wrap gap-x-3 gap-y-1">
            {facts.map((fact) => (
              <View key={fact.label} className="flex-row items-center gap-1">
                <Text className="text-caption text-text-muted" maxFontSizeMultiplier={1.2}>
                  {fact.label}
                </Text>
                <Text
                  className="max-w-[180px] text-caption font-w600 text-text-secondary"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                >
                  {fact.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {preview ? (
          <View className="mt-1 rounded-md bg-surface px-3 py-2">
            <HighlightedText
              text={`"… ${preview} …"`}
              {...(query ? { query } : {})}
              className="text-body-sm text-text-secondary"
              numberOfLines={2}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** §0-2 규칙 6 — 리스트 아이템은 memo 한다. */
export const SearchResultCard = memo(SearchResultCardBase);
SearchResultCard.displayName = 'SearchResultCard';
