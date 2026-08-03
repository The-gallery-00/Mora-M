// src/components/documents/DocumentListItem.tsx
//
// CMP-29 DocumentListItem — Component Library §2 (1-E) 정본.
// 보관함 목록(SCR-15/16/18)의 행 1개. 썸네일 72×48 r6 + 제목/부제/메타 + 우측 액션, 행 높이 80dp.
//
// 이 파일은 문서 4종 공통 부품 3개(`docToneOf` / `DocTypeBadge` / `DocPlaceholderIcon`)의 정의처이기도 하다.
// 그리드 카드·스켈레톤이 같은 색 규칙을 써야 하므로 한 곳에서만 정의하고 재사용한다.
//
// 색은 전부 NativeWind 토큰 클래스다. `card/ticket/poster/receipt` 는 tailwind.config.js 의
// 문서 4종 그룹(§10-4)이고, `-bg` 접미사가 배경, 접미사 없는 쪽이 전경(fg)이다.
import { Image } from 'expo-image';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { resolveImageUrl } from '@/config/env';
import { TYPE_LABELS, type DocumentType } from '@/features/scan/types';
import { useTheme } from '@/theme/ThemeProvider';

import { SwipeableRow, type SwipeAction } from './SwipeableRow';

/** tailwind 문서 4종 색 그룹 이름. `ETC` 는 대응 토큰이 없어 null 이다. */
export type DocTone = 'card' | 'ticket' | 'poster' | 'receipt';

const DOC_TONE: Record<DocumentType, DocTone | null> = {
  BUSINESS_CARD: 'card',
  TICKET: 'ticket',
  POSTER: 'poster',
  RECEIPT: 'receipt',
  ETC: null,
};

/** 도메인 타입 → 색 토큰 이름. 화면·다른 문서 컴포넌트가 공유한다. */
export function docToneOf(docType: DocumentType): DocTone | null {
  return DOC_TONE[docType];
}

/* 클래스 문자열은 **완전한 형태로** 적어야 한다 — `bg-${tone}-bg` 같은 동적 조합은
   tailwind 스캐너가 못 찾아 클래스가 생성되지 않고 색이 조용히 사라진다. */
const BADGE_CLASS: Record<DocTone, { box: string; text: string }> = {
  card: { box: 'bg-card-bg', text: 'text-card' },
  ticket: { box: 'bg-ticket-bg', text: 'text-ticket' },
  poster: { box: 'bg-poster-bg', text: 'text-poster' },
  receipt: { box: 'bg-receipt-bg', text: 'text-receipt' },
};

export interface DocTypeBadgeProps {
  docType: DocumentType;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 문서 유형 배지. 라벨은 `TYPE_LABELS`(원본 `TYPE_LABELS`) 그대로. */
export function DocTypeBadge({ docType, style, testID }: DocTypeBadgeProps) {
  const tone = docToneOf(docType);
  const visual = tone
    ? BADGE_CLASS[tone]
    : { box: 'bg-surface-alt', text: 'text-text-muted' }; // ETC — 전용 토큰이 없다

  return (
    <View
      testID={testID}
      className={`h-5 items-center justify-center rounded-full px-1.5 ${visual.box}`}
      style={style}
      // 유형은 이미 accessibilityLabel 에 합쳐 읽히므로 배지 자체는 중복 낭독을 막는다(A11Y-04)
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text className={`text-micro font-w700 ${visual.text}`} maxFontSizeMultiplier={1.2}>
        {TYPE_LABELS[docType]}
      </Text>
    </View>
  );
}

export interface DocPlaceholderIconProps {
  color: string;
  size?: number;
}

/**
 * 이미지 부재/404 폴백 아이콘 — 문서 한 장 모양.
 * SCR-15 는 사람 실루엣 28dp, SCR-17 은 이미지 아이콘 32dp 를 지정하지만 lucide 미설치라
 * (패키지 추가 금지) 중립 문서 아이콘 하나로 통일했다. lucide 도입 후 여기만 교체하면 된다.
 */
export function DocPlaceholderIcon({ color, size = 24 }: DocPlaceholderIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={3} width={16} height={18} rx={2} stroke={color} strokeWidth={1.6} />
      <Path
        d="M8 8H16M8 12H16M8 16H13"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5L16 12L9 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 원본 규칙 그대로: `'김도윤 명함'` → `'김도윤'`. 유형이 배지로 이미 보이므로 꼬리말을 지운다. */
export function normalizeDocumentTitle(title: string): string {
  return title.replace(/\s*(명함|티켓|포스터|영수증)\s*$/, '');
}

export interface DocumentListItemProps {
  docType: DocumentType;
  /** 서버 상대경로면 `resolveImageUrl` 이 OCR 베이스로 조립한다(Spring 이 아니다) */
  imageUri?: string | null;
  title: string;
  subtitle?: string;
  meta?: string;
  /** 우측 상단 슬롯 (D-day, 금액 등) */
  trailingTop?: ReactNode;
  trailingBottom?: ReactNode;
  /** 우측 `›`. trailing 슬롯을 쓰면 화면이 false 로 끈다. default true */
  showChevron?: boolean;
  /**
   * 제목 옆 유형 배지 표시. default true.
   * 한 유형만 담는 목록(명함 보관함 등)에서는 모든 행이 같은 배지를 반복해 정보가 0이므로 끈다.
   */
  showTypeBadge?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** 좌스와이프로 노출될 액션. 주면 행이 자동으로 SwipeableRow 로 감싸진다 */
  swipeActions?: SwipeAction[];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const THUMB_WIDTH = 72;
const THUMB_HEIGHT = 48;

function DocumentListItemBase({
  docType,
  imageUri,
  title,
  subtitle,
  meta,
  trailingTop,
  trailingBottom,
  showChevron = true,
  showTypeBadge = true,
  selected = false,
  onPress,
  onLongPress,
  swipeActions,
  accessibilityLabel,
  style,
  testID,
}: DocumentListItemProps) {
  const t = useTheme();
  /* 서버 이미지가 없거나 404 일 수 있다 — onError 로 폴백만 바꾸고 크래시시키지 않는다.
     **실패한 URI 자체를 기억한다**(불리언이 아니라). FlashList 는 셀을 재활용하므로 boolean 이면
     한 번 실패한 셀에 다음 문서가 실려도 계속 폴백 아이콘이 남는다 — 스크롤하다 보면 멀쩡한
     썸네일이 하나씩 사라지는 증상으로 나타난다. URI 를 담아 두면 값이 바뀌는 순간 저절로 풀린다. */
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = resolveImageUrl(imageUri);
  const showImage = uri !== null && failedUri !== uri;

  const displayTitle = normalizeDocumentTitle(title);
  const label =
    accessibilityLabel ??
    [TYPE_LABELS[docType], displayTitle, subtitle, meta].filter(Boolean).join(', ');

  const row = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      // 행 자체가 80dp 라 터치 타겟(44dp)은 이미 충족된다(§11-1)
      className={`h-20 flex-row items-center px-4 ${selected ? 'bg-surface-active' : 'bg-bg-elevated'}`}
      style={({ pressed }) => [pressed ? { opacity: 0.9 } : null, style]}
    >
      {/* 썸네일 72×48 r6 — 다크에서 흰 문서가 배경에 직접 닿지 않도록 surface-alt 프레임을 깐다(CMP-24 mat) */}
      <View
        className="items-center justify-center overflow-hidden rounded-sm border border-border-subtle bg-surface-alt"
        style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
      >
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            // Networking §4-4 / Offline and State §7-1 — 150ms 페이드
            transition={150}
            // 파일명이 uuid4 hex 라 URL 이 불변이다 → 디스크 캐시가 순이득이고 무효화 고민이 없다
            cachePolicy="memory-disk"
            // FlashList 셀 재활용 시 이전 이미지 잔상을 막는다 (Offline and State §7-2 "필수 조합")
            recyclingKey={uri}
            onError={() => setFailedUri(uri)}
            // OS '색상 반전' 이 문서 이미지를 뒤집는 것을 막는다 (앱 테마와 무관한 별개 기능)
            accessibilityIgnoresInvertColors
          />
        ) : (
          <DocPlaceholderIcon color={t.border.subtle} size={22} />
        )}
      </View>

      <View className="ml-3 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="shrink text-base font-w700 text-text-primary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {displayTitle}
          </Text>
          {showTypeBadge ? <DocTypeBadge docType={docType} /> : null}
        </View>

        {subtitle ? (
          <Text
            className="mt-0.5 text-body-sm text-text-secondary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {subtitle}
          </Text>
        ) : null}

        {meta ? (
          <Text
            className="mt-0.5 text-caption text-text-muted"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {meta}
          </Text>
        ) : null}
      </View>

      {trailingTop || trailingBottom ? (
        <View className="ml-2 items-end justify-center gap-1">
          {trailingTop}
          {trailingBottom}
        </View>
      ) : null}

      {showChevron ? (
        <View className="ml-1">
          <ChevronIcon color={t.text.disabled} />
        </View>
      ) : null}
    </Pressable>
  );

  if (!swipeActions || swipeActions.length === 0) return row;

  return <SwipeableRow rightActions={swipeActions}>{row}</SwipeableRow>;
}

/** §0-2 규칙 6 — 리스트 아이템만 memo 한다. */
export const DocumentListItem = memo(DocumentListItemBase);
DocumentListItem.displayName = 'DocumentListItem';
