// src/components/documents/DocumentGridCard.tsx
//
// CMP-30 DocumentGridCard — Component Library §2 (1-E) 정본. 원본 `StorageCard.tsx` 이식(색만 교체).
// 2열 그리드(SCR-17 포스터 기본 뷰, SCR-14 그리드 토글)의 카드 1장.
//
// 원본은 구 다크 오렌지 테마(`bg-white/[0.02]`, `text-white`, `#FF8A3D`)라 색을 의미론적 토큰으로
// 전면 교체했다. 구조(썸네일 + 제목 + 부제)와 제목 정규화 규칙은 그대로 계승한다.
// 원본 우상단 삭제 버튼 + `ConfirmPopover` 는 제거하고 롱프레스 ActionSheet 로 대체한다(CMP-30 결정).
import { Image } from 'expo-image';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { resolveImageUrl } from '@/config/env';
import { TYPE_LABELS, type DocumentType } from '@/features/scan/types';
import { useTheme } from '@/theme/ThemeProvider';

import {
  DocPlaceholderIcon,
  DocTypeBadge,
  normalizeDocumentTitle,
} from './DocumentListItem';

export interface DocumentGridCardProps {
  docType: DocumentType;
  /** 서버 상대경로면 `resolveImageUrl` 이 OCR 베이스로 조립한다 */
  imageUri?: string | null;
  title: string;
  subtitle?: string;
  /** 이미지 우상단 오버레이 (D-day 배지 등) */
  overlay?: ReactNode;
  /** 명함 4:3 / 포스터 3:4. default 4/3 */
  aspectRatio?: number;
  /** 카드 폭. 화면이 `(width - 거터*2 - gap) / 2` 를 계산해 넘긴다. 미지정이면 부모를 채운다 */
  width?: number;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function DocumentGridCardBase({
  docType,
  imageUri,
  title,
  subtitle,
  overlay,
  aspectRatio = 4 / 3,
  width,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  testID,
}: DocumentGridCardProps) {
  const t = useTheme();
  /* 404·부재 모두 같은 폴백으로 흡수한다 — 서버에 이미지가 없는 문서가 실제로 존재한다.
     불리언이 아니라 **실패한 URI** 를 담는 이유는 `DocumentListItem` 과 같다: FlashList 셀
     재활용 때문에 boolean 이면 실패 상태가 다음 문서에까지 눌어붙는다. */
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = resolveImageUrl(imageUri);
  const showImage = uri !== null && failedUri !== uri;

  const displayTitle = normalizeDocumentTitle(title);
  const label =
    accessibilityLabel ?? [TYPE_LABELS[docType], displayTitle, subtitle].filter(Boolean).join(', ');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      className="overflow-hidden rounded-card border border-border-subtle bg-bg-elevated"
      // UX-01 — hover 대체. 카드는 scale 0.98 (SCR-17 인터랙션 표)
      style={({ pressed }) => [
        width === undefined ? { width: '100%' } : { width },
        pressed ? { transform: [{ scale: 0.98 }], opacity: 0.95 } : null,
        style,
      ]}
    >
      {/* CMP-24 mat — 이미지 사방 4dp 매트 + surface.alt 프레임.
          다크에서 흰 문서 이미지가 카드 배경에 직접 닿아 눈부신 것을 막는다(§3-0 예외 7). */}
      <View className="border-b border-border-subtle bg-surface-alt p-1">
        <View
          className="w-full items-center justify-center overflow-hidden rounded-sm bg-surface-alt"
          style={{ aspectRatio }}
        >
          {showImage ? (
            <Image
              source={{ uri }}
              style={{ width: '100%', height: '100%' }}
              // 비율은 컨테이너가 잡고 이미지는 cover — 원본 `object-cover` 대응
              contentFit="cover"
              // Networking §4-4 / Offline and State §7-1 — 150ms 페이드
              transition={150}
              cachePolicy="memory-disk"
              // FlashList 셀 재활용 시 이전 카드 이미지가 남는 것을 막는다 (§7-2 "필수 조합")
              recyclingKey={uri}
              onError={() => setFailedUri(uri)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <DocPlaceholderIcon color={t.border.subtle} size={32} />
          )}
        </View>

        {overlay ? <View className="absolute right-2 top-2">{overlay}</View> : null}
      </View>

      <View className="gap-1 px-3 py-3">
        <View className="flex-row items-start gap-1.5">
          <Text
            className="shrink text-base font-w700 text-text-primary"
            numberOfLines={2}
            maxFontSizeMultiplier={1.3}
          >
            {displayTitle}
          </Text>
          <DocTypeBadge docType={docType} style={{ marginTop: 2 }} />
        </View>

        {subtitle ? (
          <Text
            className="text-caption text-text-muted"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** §0-2 규칙 6 — 리스트 아이템만 memo 한다. */
export const DocumentGridCard = memo(DocumentGridCardBase);
DocumentGridCard.displayName = 'DocumentGridCard';
