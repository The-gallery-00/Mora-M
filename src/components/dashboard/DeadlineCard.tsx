// src/components/dashboard/DeadlineCard.tsx
//
// CMP-31 DeadlineCard — Component Library §2 (1-E) 정본. SCR-06 마감 임박 가로 캐러셀의 카드 1장.
//
// 원본(`dashboard/page.tsx`)은 `minWidth:320 / maxWidth:360` 에 `cursor:pointer` 만 있고
// **onClick 이 없었다**(Screen Specs §부록 원본 결함 6). 모바일은 폭 280dp 로 줄이고
// 탭하면 문서 상세(SCR-19)로 보낸다 — 원본 미구현 기능의 완성이다.
//
// 색 규칙(SCR-06 구성 요소 표): D-day 는 `dDay <= 3` 이면 마감색, 아니면 포인트색.
// 정본 HEX `#DC8540` / `#0077B6` 는 각각 `deadline` / `action` 토큰이다 — HEX 를 적지 않는다.
import { Image } from "expo-image";
import { memo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { resolveImageUrl } from "@/config/env";
import { useTheme } from "@/theme/ThemeProvider";

/** 마감 대상은 티켓·포스터 2종뿐이다 (서버 `DeadlineNotificationScheduler` 기준). */
export type DeadlineDocType = "TICKET" | "POSTER";

export interface DeadlineCardProps {
  docType: DeadlineDocType;
  title: string;
  /** 티켓은 `transportType`, 포스터는 `organizerName`. */
  subtitle?: string;
  /** `MM.DD (요일)`. */
  dateLabel: string;
  /** 0 이면 라벨이 `D-Day` 다. */
  dDay?: number;
  /** D-Day 대신 표시할 상태 문구. 진행 중 포스터의 종료 라벨에 사용한다. */
  statusLabel?: string;
  imageUri?: string | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** SCR-06 모바일 변경점: 원본 320~360 → 280dp. */
export const DEADLINE_CARD_WIDTH = 280;
export const DEADLINE_CARD_HEIGHT = 120;
const IMAGE_WIDTH = 100;
const TEXT_COLUMN_WIDTH = DEADLINE_CARD_WIDTH - IMAGE_WIDTH;

/** 이미지 부재 시 이모지 폴백 (원본 규칙). */
const FALLBACK_EMOJI: Record<DeadlineDocType, string> = {
  TICKET: "🎫",
  POSTER: "📄",
};

const TYPE_LABEL: Record<DeadlineDocType, string> = {
  TICKET: "티켓",
  POSTER: "포스터",
};

const BADGE_CLASS: Record<DeadlineDocType, { box: string; text: string }> = {
  TICKET: { box: "bg-ticket-bg", text: "text-ticket" },
  POSTER: { box: "bg-poster-bg", text: "text-poster" },
};

/** `dDay===0` → `D-Day`. 음수는 서버가 만들지 않지만 들어와도 날짜만 보여 준다. */
export function dDayLabel(dDay: number): string {
  if (dDay === 0) return "D-Day";
  return dDay > 0 ? `D-${dDay}` : "";
}

function DeadlineCardBase({
  docType,
  title,
  subtitle,
  dateLabel,
  dDay,
  statusLabel,
  imageUri,
  onPress,
  style,
  testID,
}: DeadlineCardProps) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = resolveImageUrl(imageUri);
  const showImage = uri !== null && !failed;

  const badge = BADGE_CLASS[docType];
  const label = statusLabel ?? (dDay === undefined ? "" : dDayLabel(dDay));
  // 임박(3일 이내)은 마감색, 그 밖은 포인트색.
  const dDayClass = dDay !== undefined && dDay > 3 ? "text-action" : "text-deadline";

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[
        TYPE_LABEL[docType],
        title,
        subtitle,
        label,
        dateLabel,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      className="flex-row overflow-hidden rounded-card border border-border-subtle bg-bg-elevated"
      style={({ pressed }) => [
        t.elevation.raised,
        {
          width: DEADLINE_CARD_WIDTH,
          minWidth: DEADLINE_CARD_WIDTH,
          maxWidth: DEADLINE_CARD_WIDTH,
          height: DEADLINE_CARD_HEIGHT,
          flexShrink: 0,
        },
        style,
        // SCR-06 인터랙션 표: 마감 카드 탭 scale 0.98
        pressed ? { opacity: 0.94, transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      <View
        className="justify-between px-4 py-3"
        style={{ width: TEXT_COLUMN_WIDTH, maxWidth: TEXT_COLUMN_WIDTH, flexShrink: 0 }}
      >
        <View style={{ width: "100%", minWidth: 0 }}>
          <View className={`self-start rounded-xs px-2 py-0.5 ${badge.box}`}>
            <Text
              className={`text-caption font-w600 ${badge.text}`}
              maxFontSizeMultiplier={1.2}
            >
              {TYPE_LABEL[docType]}
            </Text>
          </View>

          <Text
            className="mt-2 text-base font-w800 text-text-primary"
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.2}
            style={{ width: "100%", maxWidth: "100%", minWidth: 0, flexShrink: 1 }}
          >
            {title}
          </Text>
        </View>

        <View style={{ width: "100%", minWidth: 0 }}>
          {label ? (
            <Text
              className={`text-body-sm font-w800 ${dDayClass}`}
              maxFontSizeMultiplier={1.2}
            >
              {label}
            </Text>
          ) : null}
          <Text
            className="text-label text-text-muted"
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.2}
            style={{ width: "100%", maxWidth: "100%", minWidth: 0, flexShrink: 1 }}
          >
            {subtitle ? `${dateLabel} · ${subtitle}` : dateLabel}
          </Text>
        </View>
      </View>

      {/* 썸네일 — 다크에서 흰 문서가 카드 배경에 직접 닿지 않게 surface-alt 매트를 깐다(CMP-24). */}
      <View
        className="items-center justify-center bg-surface-alt"
        style={{
          width: IMAGE_WIDTH,
          minWidth: IMAGE_WIDTH,
          maxWidth: IMAGE_WIDTH,
          height: "100%",
          flexShrink: 0,
        }}
      >
        {showImage ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text className="text-display" maxFontSizeMultiplier={1.1}>
            {FALLBACK_EMOJI[docType]}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export const DeadlineCard = memo(DeadlineCardBase);
DeadlineCard.displayName = "DeadlineCard";
