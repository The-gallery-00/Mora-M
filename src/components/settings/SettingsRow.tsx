// src/components/settings/SettingsRow.tsx
//
// CMP-35 SettingsRow — Component Library §2 정본. 원본 `settings/page.tsx` 의 `Row` + `Chevron` 대체다.
// 원본은 hover 상태 4종으로 상호작용을 표현했는데 터치에는 hover 가 없으므로 pressed 로 옮겼다(§1474).
//
// 행의 우측 요소는 5종이다 — `value`(읽기 전용 값) / `chevronLabel`+`›` / `toggle` / `pill` / 없음.
// `segmented` 만 예외로 **라벨 아래 전체 폭 블록**으로 내려간다: SCR-25 `화면 > 테마` 와
// SCR-29 `며칠 전부터 알림 받기` 와이어프레임이 둘 다 세그먼트를 제목 아래 줄에 그린다.
// 40dp 짜리 세그먼트를 우측 슬롯에 밀어 넣으면 3칸 라벨(`시스템 따름`)이 줄바꿈된다.
//
// `pill` 과 `toggle` 은 **함께** 올 수 있다 — SCR-25 Google Calendar 행이 `연동됨` Pill + Toggle 이다.
import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

import { Toggle } from './Toggle';

export type SettingsRowTone = 'default' | 'danger';

/** Pill 색조. `연동됨`=success / `미연동`=neutral 이 기본 쓰임이다. */
export type SettingsPillTone = 'success' | 'neutral' | 'info' | 'warn';

export interface SettingsRowToggle {
  value: boolean;
  onValueChange: (next: boolean) => void;
  busy?: boolean;
  disabled?: boolean;
  /** 미지정 시 행 `label` 을 쓴다. */
  accessibilityLabel?: string;
}

export interface SettingsRowProps {
  label: string;
  description?: string;
  /** 우측 읽기 전용 값 (`hong@naver.com`, `1.0.0 (1)`). */
  value?: string;
  /** `›` 앞에 붙는 액션 라벨 — 원본 `변경`/`삭제`/`열기`/`보기`. 없어도 chevron 은 그려진다. */
  chevronLabel?: string;
  /**
   * `›` 노출 강제/억제. 기본은 "누를 수 있고 토글이 없으면 표시".
   *
   * `false` 가 필요한 자리가 실제로 있다 — SCR-25 `이메일`(읽기 전용이지만 탭하면 이유를 알려 준다)과
   * `앱 버전`(5회 탭이 진단 화면 진입로다). 둘 다 **다음 화면으로 가지 않으므로** chevron 이 있으면
   * 거짓말이 된다.
   */
  chevron?: boolean;
  toggle?: SettingsRowToggle;
  /** 라벨 아래 전체 폭 블록 (CMP-12 SegmentedControl 등). */
  segmented?: ReactNode;
  pill?: { label: string; tone: SettingsPillTone };
  tone?: SettingsRowTone; // default 'default'
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/* ── chevron (lucide 미설치 → 인라인 SVG. Design Tokens §12 의 ChevronRight 실루엣) ─────── */
export function ChevronIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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

/* ── Pill — `연동됨` / `미연동` ────────────────────────────────────────────────────────── */

const PILL: Record<SettingsPillTone, string> = {
  success: 'bg-success-container',
  neutral: 'bg-surface-alt',
  info: 'bg-info-container',
  warn: 'bg-warn-container',
};

const PILL_TEXT: Record<SettingsPillTone, string> = {
  success: 'text-success-text',
  neutral: 'text-text-muted',
  info: 'text-info',
  warn: 'text-warn',
};

export function SettingsPill({ label, tone }: { label: string; tone: SettingsPillTone }) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${PILL[tone]}`}>
      <Text className={`text-caption font-w600 ${PILL_TEXT[tone]}`} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

/* ── 행 ────────────────────────────────────────────────────────────────────────────────── */

/** SCR-25 와이어프레임 `h56`. 설명·세그먼트가 붙으면 그만큼 늘어난다. */
const MIN_HEIGHT = 56;

export function SettingsRow({
  label,
  description,
  value,
  chevronLabel,
  chevron,
  toggle,
  segmented,
  pill,
  tone = 'default',
  disabled = false,
  onPress,
  style,
  testID,
}: SettingsRowProps) {
  const t = useTheme();

  // 토글 행은 토글 자신이 눌리는 것이지 행 전체가 눌리는 것이 아니다 —
  // 행을 Pressable 로 감싸면 스크린리더가 `버튼` 과 `스위치` 를 겹쳐 읽는다.
  const interactive = onPress !== undefined && !disabled;
  const showChevron = chevron ?? (interactive && toggle === undefined);

  const labelClass = disabled
    ? 'text-text-disabled'
    : tone === 'danger'
      ? 'text-danger'
      : 'text-text-primary';

  const body = (
    <View className="justify-center px-4 py-3" style={{ minHeight: MIN_HEIGHT }}>
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className={`text-base font-w600 ${labelClass}`} maxFontSizeMultiplier={1.4}>
            {label}
          </Text>
          {description ? (
            <Text
              className={`mt-0.5 text-caption ${disabled ? 'text-text-disabled' : 'text-text-muted'}`}
              maxFontSizeMultiplier={1.4}
            >
              {description}
            </Text>
          ) : null}
        </View>

        {pill ? <SettingsPill label={pill.label} tone={pill.tone} /> : null}

        {value ? (
          <Text
            className={`text-body-sm ${disabled ? 'text-text-disabled' : 'text-text-secondary'}`}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            // 값이 길면(이메일) 라벨을 밀어내지 않고 자신이 줄어든다.
            style={{ flexShrink: 1, maxWidth: '55%' }}
          >
            {value}
          </Text>
        ) : null}

        {toggle ? (
          <Toggle
            value={toggle.value}
            onValueChange={toggle.onValueChange}
            {...(toggle.busy === undefined ? {} : { busy: toggle.busy })}
            disabled={disabled || (toggle.disabled ?? false)}
            accessibilityLabel={toggle.accessibilityLabel ?? label}
            testID={testID ? `${testID}-toggle` : undefined}
          />
        ) : null}

        {chevronLabel && showChevron ? (
          <Text
            className={`text-label font-w600 ${tone === 'danger' ? 'text-danger' : 'text-action'}`}
            maxFontSizeMultiplier={1.3}
          >
            {chevronLabel}
          </Text>
        ) : null}

        {showChevron ? (
          <ChevronIcon color={tone === 'danger' ? t.danger.base : t.text.muted} />
        ) : null}
      </View>

      {segmented ? <View className="mt-3">{segmented}</View> : null}
    </View>
  );

  if (!interactive) {
    return (
      <View
        style={style}
        testID={testID}
        accessible={toggle === undefined}
        accessibilityState={{ disabled }}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={description ? `${label}, ${description}` : label}
      onPress={onPress}
      android_ripple={{ color: t.surface.active }}
      style={({ pressed }) => [pressed ? { opacity: 0.9 } : null, style]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}
