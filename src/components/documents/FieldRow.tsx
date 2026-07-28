// src/components/documents/FieldRow.tsx
//
// CMP-27 FieldRow — Component Library §2 (1-D) 정본. 원본 `StorageDrawer.Field` 이식.
// 문서 상세(SCR-19)와 편집(SCR-20)이 **같은 컴포넌트**를 쓰고 `editing` 으로만 갈린다.
// 두 화면이 다른 컴포넌트를 쓰면 라벨·순서가 반드시 어긋난다(원본이 실제로 그랬다 — 보관함 `직책` vs 검색 `직함`).
//
// 편집 모드는 CMP-03 TextField 를 그대로 재사용하고, 필드 메타(라벨·키보드·multiline·maxLength)는
// `src/features/scan/fieldSchema.ts` 의 `FieldDef` 를 `field` prop 으로 받아 채운다 — 폼 정의는 한 곳뿐이다.
import * as Clipboard from 'expo-clipboard';
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  Text,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { TextField, toast } from '@/components/ui';
import type { FieldDef } from '@/features/scan/fieldSchema';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

export type FieldAction = 'copy' | 'call' | 'sms' | 'email' | 'web' | 'map' | 'calendar';

/** 접힘 상태에서 보여줄 최대 줄 수 (OCR 원문처럼 수백 자인 값 대비) */
const COLLAPSED_LINES = 6;

const ACTION_LABEL: Record<FieldAction, string> = {
  copy: '복사',
  call: '전화 걸기',
  sms: '문자 보내기',
  email: '메일 보내기',
  web: '웹사이트 열기',
  map: '지도에서 보기',
  calendar: '캘린더에 추가',
};

/* ── 인라인 아이콘 20dp ──────────────────────────────────────────────
   lucide-react-native 미설치(패키지 추가 금지)라 react-native-svg 로 같은 크기·같은 색 규칙을 만든다.
   색은 className 이 닿지 않는 SVG stroke 이므로 useTheme() 에서 받는다(§3-0 N-6). */
function ActionGlyph({ action, color }: { action: FieldAction; color: string }) {
  const common = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const };
  switch (action) {
    case 'copy':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Rect x={9} y={9} width={11} height={11} rx={2} {...common} />
          <Path d="M15 5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v8A1.5 1.5 0 005.5 15" {...common} />
        </Svg>
      );
    case 'call':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6 3h3l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v3a2 2 0 01-2 2C10.6 20 4 13.4 4 5a2 2 0 012-2z"
            {...common}
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'sms':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path d="M21 12a7 7 0 01-7 7H8l-4 3v-4.5A7 7 0 018 5h6a7 7 0 017 7z" {...common} strokeLinejoin="round" />
        </Svg>
      );
    case 'email':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Rect x={3} y={5} width={18} height={14} rx={2} {...common} />
          <Path d="M3.5 7l8.5 6 8.5-6" {...common} />
        </Svg>
      );
    case 'web':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" {...common} />
        </Svg>
      );
    case 'map':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" {...common} strokeLinejoin="round" />
          <Circle cx={12} cy={10} r={2.5} {...common} />
        </Svg>
      );
    case 'calendar':
      return (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Rect x={3.5} y={5} width={17} height={16} rx={2} {...common} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...common} />
        </Svg>
      );
  }
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5L16 12L9 19" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export interface FieldRowProps {
  /** `field` 를 주면 생략 가능 — 그때는 `field.label` 이 쓰인다 */
  label?: string;
  /** 읽기 모드 표시값 / 편집 모드 입력값 */
  value?: string | null;
  /** 빈 값 표시. default '-' (원본 규칙: `(value||'-').trim()||'-'`) */
  emptyText?: string;
  /** 편집 모드로 전환. default false */
  editing?: boolean;
  onChangeText?: (text: string) => void;
  error?: string;
  hint?: string;
  /** `저장 안 됨` 같은 필드 배지 슬롯 */
  badge?: ReactNode;

  /** fieldSchema.ts 의 필드 정의. 라벨·키보드·multiline·maxLength·placeholder 를 채운다 */
  field?: FieldDef;
  multiline?: boolean;
  /** multiline + 긴 텍스트(OCR 원문) — `더 보기`/`접기` 토글 */
  collapsible?: boolean;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  /** 바텀시트 안이면 true — TextField 가 BottomSheetTextInput 으로 스위칭한다 */
  inSheet?: boolean;

  /** 읽기 모드 우측 액션 아이콘. `copy` 는 이 컴포넌트가 직접 처리한다 */
  actions?: FieldAction[];
  onAction?: (action: FieldAction, value: string) => void;
  /** 우측 chevron + 탭 (명함 그룹 선택 등). 액션 아이콘과 함께 쓰지 않는다 */
  onPress?: () => void;
  /** 마지막 행은 화면이 false 로 꺼서 이중선을 막는다. default true */
  showDivider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FieldRow({
  label,
  value,
  emptyText = '-',
  editing = false,
  onChangeText,
  error,
  hint,
  badge,
  field,
  multiline,
  collapsible = false,
  placeholder,
  keyboardType,
  maxLength,
  rows,
  required,
  disabled = false,
  inSheet = false,
  actions,
  onAction,
  onPress,
  showDivider = true,
  style,
  testID,
}: FieldRowProps) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);

  const resolvedLabel = label ?? field?.label ?? '';
  const isMultiline = multiline ?? field?.inputType === 'multiline';
  const raw = value ?? '';

  /* 하단 hairline 은 원본 `#F1F5F9` = bg.sunken 토큰이다.
     border.subtle(#CBD5E1)은 필드 사이 선으로는 너무 진해 값이 표처럼 보인다. */
  const dividerClass = showDivider ? 'border-b border-bg-sunken' : '';

  // ── 편집 모드 ─────────────────────────────────────────────────────
  if (editing) {
    return (
      <View className={`py-2 ${dividerClass}`} style={style}>
        {badge ? <View className="mb-1 flex-row">{badge}</View> : null}
        <TextField
          value={raw}
          onChangeText={onChangeText ?? (() => undefined)}
          label={resolvedLabel}
          placeholder={placeholder ?? field?.placeholder}
          error={error}
          hint={hint}
          required={required ?? field?.required ?? false}
          disabled={disabled}
          multiline={isMultiline}
          numberOfLines={rows ?? field?.rows ?? 4}
          maxLength={maxLength ?? field?.maxLength}
          keyboardType={keyboardType ?? field?.keyboardType}
          autoCapitalize={field?.autoCapitalize}
          inSheet={inSheet}
          testID={testID}
        />
      </View>
    );
  }

  // ── 읽기 모드 ─────────────────────────────────────────────────────
  // 원본 규칙 그대로: 값이 없거나 공백뿐이면 '-'
  const display = (raw || emptyText).trim() || emptyText;
  const hasValue = raw.trim().length > 0;
  const canCollapse = collapsible && isMultiline && hasValue;

  const copy = async () => {
    if (!hasValue) return;
    await Clipboard.setStringAsync(raw);
    // CP — 복사 완료 문구는 `복사했습니다.` 하나뿐이다 (UX 가이드 §7-2)
    // 햅틱은 이미 진입점(롱프레스 HAP-06 / 액션 탭 HAP-01)에서 울렸다 → 토스트는 무음이다(§9 금지 2).
    toast.success('복사했습니다.', { haptic: false });
  };

  const handleAction = (action: FieldAction) => {
    haptics.selection(); // HAP-01
    if (action === 'copy' && !onAction) {
      void copy();
      return;
    }
    onAction?.(action, raw);
  };

  const body = (
    <>
      <View className="flex-row items-center gap-1.5">
        <Text className="text-caption text-text-disabled" maxFontSizeMultiplier={1.3}>
          {resolvedLabel}
        </Text>
        {badge}
      </View>

      <View className="mt-0.5 flex-row items-start">
        <Text
          className={`flex-1 text-base ${hasValue ? 'text-text-primary' : 'text-text-disabled'}`}
          numberOfLines={canCollapse && !expanded ? COLLAPSED_LINES : undefined}
          maxFontSizeMultiplier={1.4}
          // 값 롱프레스 → 복사 (SCR-19 인터랙션 표). Medium 햅틱은 롱프레스 규약(HAP-06)
          onLongPress={
            hasValue
              ? () => {
                  haptics.impact('medium');
                  void copy();
                }
              : undefined
          }
          selectable
        >
          {display}
        </Text>

        {actions && actions.length > 0 && hasValue ? (
          <View className="ml-2 flex-row items-center gap-1">
            {actions.map((action) => (
              <Pressable
                key={action}
                accessibilityRole="button"
                accessibilityLabel={`${resolvedLabel} ${ACTION_LABEL[action]}`}
                onPress={() => handleAction(action)}
                // 시각 20dp + hitSlop 12 = 실효 44dp (§11-1)
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
              >
                <ActionGlyph action={action} color={t.text.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {onPress ? (
          <View className="ml-1 pt-0.5">
            <ChevronIcon color={t.text.disabled} />
          </View>
        ) : null}
      </View>

      {canCollapse ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? '접기' : '더 보기'}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((prev) => !prev)}
          // label(16dp) 한 줄 — 실효 44dp 를 hitSlop 으로 만든다 (§11-1)
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          className="mt-1 self-start"
        >
          <Text className="text-label font-w600 text-action">{expanded ? '접기' : '더 보기'}</Text>
        </Pressable>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${resolvedLabel}, ${display}`}
        onPress={onPress}
        className={`min-h-[56px] justify-center py-2.5 ${dividerClass}`}
        style={({ pressed }) => [pressed ? { opacity: 0.9 } : null, style]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      className={`py-2.5 ${dividerClass}`}
      style={style}
      // 라벨과 값을 한 항목으로 읽는다(A11Y-05). 액션 버튼은 자식으로 따로 포커스된다.
      accessible={false}
    >
      {body}
    </View>
  );
}
