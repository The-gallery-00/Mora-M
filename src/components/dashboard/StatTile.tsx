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

import { fontScale, spacing } from '@/theme/scale';

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

/** SCR-06 와이어프레임 폭. 높이는 아래에서 계산한다. */
export const STAT_TILE_WIDTH = 148;

/* 타일 내부 치수 — **아래 높이 계산과 JSX 클래스가 같은 값을 봐야 한다.**
   숫자를 바꿀 때는 짝을 이룬 클래스도 함께 바꿔라(`p-3` · `gap-1` · `h-8 w-8` · `border`). */
const TILE_PADDING = spacing.md; //  p-3
const TILE_ROW_GAP = spacing.xxs; // gap-1
const TILE_ICON = 32; //             h-8 / w-8
const TILE_BORDER = 1; //            border

/**
 * 타일 최소 높이 — **와이어프레임의 96dp 를 상수로 되돌려 놓지 마라.**
 *
 * 96 은 부제(`hint`) 줄이 붙기 전의 값이다. 실제 세로 스택은
 *   아이콘 32 + 라벨 20(body-sm) + 숫자 30(stat) + 부제 14(micro)
 *   + 행 간격 4×3 + 패딩 12×2 + 테두리 1×2 = **134dp**
 * 라서 96dp 박스보다 38dp 크다. 값이 0 건이던 동안에는 스택이 짧아 티가 나지 않았지만, 실데이터가
 * 들어오자 넘친 부분이 가로 캐러셀(`ScrollView`)이 잰 높이 밖으로 나가 잘렸다 — 실기기에서 본
 * "라벨이 카드 하단에서 잘리고 숫자·부제가 안 보이는" 증상이 정확히 이것이다.
 *
 * 그래서 숫자를 적지 않고 **타이포 스케일에서 계산**한다. `scale.cjs` 의 행간이 바뀌어도 박스가
 * 따라오고, 스켈레톤(`HomeSkeleton`)도 이 상수를 쓰므로 다시 어긋날 수 없다.
 */
export const STAT_TILE_MIN_HEIGHT =
  TILE_ICON +
  fontScale['body-sm'].line +
  fontScale.stat.line +
  fontScale.micro.line +
  TILE_ROW_GAP * 3 +
  TILE_PADDING * 2 +
  TILE_BORDER * 2;

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
      /* 4줄 스택 — 각 줄의 높이가 **고정**이어야 `STAT_TILE_MIN_HEIGHT` 계산이 성립한다.
         그래서 세 줄 모두 `numberOfLines={1}` 이다: 폭이 148dp 로 고정이라 긴 라벨·긴 값은
         언제든 2줄로 넘어갈 수 있고, 그 한 줄(20~30dp)이 그대로 박스를 넘쳐 잘림으로 나타났다.
         `adjustsFontSizeToFit` 은 쓰지 않는다 — 타일마다 글자 크기가 달라져 3개가 따로 놀고,
         숫자를 작게 만들어 읽는 것이 이 타일의 목적과 정반대다. 잘린 전문은 `accessibilityLabel`
         이 그대로 읽어 준다(위 `a11yLabel`). 넘치면 줄이는 게 아니라 말줄임으로 끝낸다. */
      <View className="gap-1">
        <StatIcon icon={icon} tone={tone} />
        <Text
          className="text-body-sm text-text-secondary"
          numberOfLines={1}
          ellipsizeMode="tail"
          maxFontSizeMultiplier={1.2}
        >
          {label}
        </Text>
        <Text
          className="text-stat font-w800 text-brand"
          numberOfLines={1}
          ellipsizeMode="tail"
          maxFontSizeMultiplier={1.2}
        >
          {shown}
          {unit ? <Text className="text-base font-w500 text-text-secondary">{` ${unit}`}</Text> : null}
        </Text>
        {hint ? (
          <Text
            className="text-micro text-text-muted"
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.2}
          >
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
