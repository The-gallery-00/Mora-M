// src/components/dashboard/StatTile.tsx
//
// CMP-32 StatTile — Component Library §2 (1-E) 정본. SCR-06 통계 타일 3개 · SCR-25 설정 행이 쓴다.
//
// **정본 props 와 다른 점 1가지 — `iconBg` / `iconFg` 를 `tone` 으로 바꿨다.**
// 정본 시그니처는 색 문자열 2개를 받지만(`iconBg: string`), 이 저장소는 HEX 리터럴을 화면·컴포넌트
// 코드에 두는 것을 금지한다(Design Tokens §0 규칙 5 · tailwind.config.js 주석). 색 3쌍은 SCR-06
// 구성 요소 표가 고정한 값이고 그 외 조합이 생길 계획이 없으므로, 세 조합을 `tone` 유니온으로 닫고
// 클래스 문자열을 여기 한 곳에 적는다. 값의 대응은 다음과 같다(정본 HEX → 의미론 토큰):
//   오늘 일정  `#E8F4FD` / `#0077B6`  → `bg-info-container` / `text-action`
//   마감 임박  `#FEF3E2` / `#DC8540`  → `bg-deadline-bg`    / `text-deadline`
//   보관 문서  `#DCFCE7` / `#4FB048`  → `bg-success-container` / `text-success`
// 라이트에서 눈으로 같은 색이고, 다크에서는 정본 HEX 가 애초에 대비를 못 내므로 토큰이 정답이다.
import { memo, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type StatTileTone = 'schedule' | 'deadline' | 'stored';
export type StatTileVariant = 'tile' | 'row';

export interface StatTileProps {
  /** 이모지 문자열 또는 아이콘 엘리먼트 (원본 📅 ⏰ 📄). */
  icon: ReactNode | string;
  tone: StatTileTone;
  label: string;
  value: string | number;
  /** `건`. 값 뒤에 작게 붙는다. */
  unit?: string;
  /** `예정된 일정` 같은 부제. */
  hint?: string;
  /** true 면 값 자리에 `-` 를 그린다 (원본 규칙 — 숫자를 지어내지 않는다). */
  loading?: boolean;
  onPress?: () => void;
  /** 홈 가로 스크롤 타일 / 설정 행. default 'tile' */
  variant?: StatTileVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** SCR-06 와이어프레임: 각 w148 h96. */
export const STAT_TILE_WIDTH = 148;
const STAT_TILE_MIN_HEIGHT = 96;

const TONE: Record<StatTileTone, { box: string; text: string }> = {
  schedule: { box: 'bg-info-container', text: 'text-action' },
  deadline: { box: 'bg-deadline-bg', text: 'text-deadline' },
  stored: { box: 'bg-success-container', text: 'text-success' },
};

function StatIcon({ icon, tone }: { icon: ReactNode | string; tone: StatTileTone }) {
  const visual = TONE[tone];
  return (
    <View className={`h-8 w-8 items-center justify-center rounded-full ${visual.box}`}>
      {typeof icon === 'string' ? (
        <Text className={`text-body-sm ${visual.text}`} maxFontSizeMultiplier={1.2}>
          {icon}
        </Text>
      ) : (
        icon
      )}
    </View>
  );
}

function StatTileBase({
  icon,
  tone,
  label,
  value,
  unit,
  hint,
  loading = false,
  onPress,
  variant = 'tile',
  style,
  testID,
}: StatTileProps) {
  // 원본 규칙: 로딩 중에는 값 자리가 `-` 다.
  const shown = loading ? '-' : String(value);
  const a11yLabel = [label, loading ? '불러오는 중' : `${shown}${unit ?? ''}`, hint]
    .filter(Boolean)
    .join(', ');

  const body =
    variant === 'row' ? (
      <View className="flex-1 flex-row items-center gap-3">
        <StatIcon icon={icon} tone={tone} />
        <Text className="flex-1 text-base font-w600 text-text-primary" maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        <Text className="text-h3 font-w800 text-text-primary" maxFontSizeMultiplier={1.3}>
          {shown}
          {unit ? <Text className="text-body-sm font-w500 text-text-secondary">{` ${unit}`}</Text> : null}
        </Text>
      </View>
    ) : (
      <View className="gap-1">
        <StatIcon icon={icon} tone={tone} />
        <Text className="text-body-sm text-text-secondary" maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
        <Text className="text-stat font-w800 text-brand" maxFontSizeMultiplier={1.2}>
          {shown}
          {unit ? <Text className="text-base font-w500 text-text-secondary">{` ${unit}`}</Text> : null}
        </Text>
        {hint ? (
          <Text className="text-micro text-text-muted" numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {hint}
          </Text>
        ) : null}
      </View>
    );

  const shell = `justify-between rounded-card border border-border-subtle bg-bg-elevated ${
    variant === 'row' ? 'flex-row items-center px-4 py-3' : 'p-3'
  }`;

  const sizing: StyleProp<ViewStyle> =
    variant === 'row' ? style : [{ width: STAT_TILE_WIDTH, minHeight: STAT_TILE_MIN_HEIGHT }, style];

  if (!onPress) {
    return (
      <View testID={testID} className={shell} style={sizing} accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      className={shell}
      // SCR-06 인터랙션 표: 통계 타일 탭은 scale 0.98. 눌림 표현은 opacity + 축소를 함께 쓴다.
      style={({ pressed }) => [
        sizing,
        pressed ? { opacity: 0.92, transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

export const StatTile = memo(StatTileBase);
StatTile.displayName = 'StatTile';
