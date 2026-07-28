// src/components/ui/Chip.tsx
//
// CMP-06 Chip — Component Library §2 / §3-3 정본.
// tone 3종(brand=보관함 / info=챗봇 / neutral=중립)은 **맥락**이며 테마와 무관하다(N-2).
// 문서 유형 칩은 `docTone` 으로 문서 4종 토큰(card/ticket/poster/receipt)을 받는다.
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';

export type ChipTone = 'brand' | 'info' | 'neutral';
/**
 * 문서 4종 색 토큰. 도메인 타입(`DocumentType`)이 준비되면 화면이
 * `BUSINESS_CARD → 'card'` 처럼 매핑해 넘긴다 — primitive 는 도메인을 알지 않는다(§0-1).
 */
export type ChipDocTone = 'card' | 'ticket' | 'poster' | 'receipt';
export type ChipSize = 'sm' | 'md';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  count?: number; // 라벨 뒤 개수 (예: '명함 12')
  leadingIcon?: ReactNode;
  tone?: ChipTone; // default 'brand'
  /** 지정하면 tone 을 무시하고 문서 유형 색을 쓴다 */
  docTone?: ChipDocTone;
  size?: ChipSize; // 28 / 34 dp
  disabled?: boolean;
  /** HAP-01 — 문서 유형/필터 선택. default true */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

type ChipVisual = { selectedBox: string; selectedText: string; box: string; text: string };

/* §3-3 tone × state. HEX 는 라이트 값 표기이며 다크는 같은 토큰으로 치환된다(N-1).
   원본 borderSoft(slate-200) / 챗봇 칩의 blue-900 은 tokens.ts 에 없으므로
   각각 border.subtle / info 로 매핑했다(DK-09 — 새 HEX 를 만들지 않는다). */
const TONE: Record<ChipTone, ChipVisual> = {
  brand: {
    selectedBox: 'bg-brand border border-brand',
    selectedText: 'text-text-inverse',
    box: 'bg-bg-elevated border border-border-subtle',
    text: 'text-text-secondary',
  },
  info: {
    selectedBox: 'bg-info border border-info',
    selectedText: 'text-text-inverse',
    box: 'bg-info-container border border-info-border',
    text: 'text-info',
  },
  neutral: {
    selectedBox: 'bg-brand-container border border-brand-container',
    selectedText: 'text-brand',
    box: 'bg-surface border border-border-subtle',
    text: 'text-text-muted',
  },
};

/* 문서 4종 — 선택 시 채움(fg 배경 + inverse 라벨), 비선택은 §3-4 의 fg/bg 조합(대비 4.5:1 확보) */
const DOC_TONE: Record<ChipDocTone, ChipVisual> = {
  card: {
    selectedBox: 'bg-card border border-card',
    selectedText: 'text-text-inverse',
    box: 'bg-card-bg border border-card-bg',
    text: 'text-card',
  },
  ticket: {
    selectedBox: 'bg-ticket border border-ticket',
    selectedText: 'text-text-inverse',
    box: 'bg-ticket-bg border border-ticket-bg',
    text: 'text-ticket',
  },
  poster: {
    selectedBox: 'bg-poster border border-poster',
    selectedText: 'text-text-inverse',
    box: 'bg-poster-bg border border-poster-bg',
    text: 'text-poster',
  },
  receipt: {
    selectedBox: 'bg-receipt border border-receipt',
    selectedText: 'text-text-inverse',
    box: 'bg-receipt-bg border border-receipt-bg',
    text: 'text-receipt',
  },
};

const SIZE: Record<ChipSize, { box: string; text: string; slop: number }> = {
  // h28 / paddingH 10 / 12·600 — hitSlop 으로 48dp 높이를 만든다(§11-1)
  sm: { box: 'h-7 px-2.5', text: 'text-label font-w600', slop: 10 },
  // h34 / paddingH 12 / 13·700
  md: { box: 'h-[34px] px-3', text: 'text-body-sm font-w700', slop: 7 },
};

export function Chip({
  label,
  selected = false,
  onPress,
  count,
  leadingIcon,
  tone = 'brand',
  docTone,
  size = 'md',
  disabled = false,
  haptic = true,
  style,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const [pressed, setPressed] = useState(false);
  const visual = docTone ? DOC_TONE[docTone] : TONE[tone];

  const boxClass = disabled
    ? 'bg-surface-alt border border-border-subtle'
    : selected
      ? visual.selectedBox
      : visual.box;

  const textClass = disabled
    ? 'text-text-disabled'
    : selected
      ? visual.selectedText
      : visual.text;

  const body = (
    <>
      {leadingIcon}
      <Text
        className={`${SIZE[size].text} ${textClass}`}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {count === undefined ? label : `${label} ${count}`}
      </Text>
    </>
  );

  const boxClassName = `flex-row items-center justify-center gap-1.5 rounded-full ${SIZE[size].box} ${boxClass}`;

  // 비인터랙티브 칩(개수 표시 등)은 Pressable 로 감싸지 않는다 — 스크린리더가 버튼으로 읽는다
  if (!onPress) {
    return (
      <View testID={testID} className={boxClassName} style={style}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      disabled={disabled}
      pointerEvents={disabled ? 'none' : 'auto'}
      onPress={() => {
        if (haptic) haptics.selection();
        onPress();
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={{
        top: SIZE[size].slop,
        bottom: SIZE[size].slop,
        left: 4,
        right: 4,
      }}
      style={[pressed ? { opacity: 0.85 } : null, style]}
      className={boxClassName}
    >
      {body}
    </Pressable>
  );
}
