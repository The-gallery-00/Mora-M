// src/components/brand/MoraLogo.tsx
//
// CMP-50 Logo — Component Library §2 / Design Tokens §12 정본.
//
// path 데이터는 원본 `frontend/public/icons/mora-logo-lg.svg`(36×36, viewBox 0 0 36 36)의
// `d` 속성을 **글자 단위로 그대로** 옮긴 것이다. 임의로 다시 그리지 않는다.
// SVG 파일 import 는 불가하다(react-native-svg-transformer 미설치) → 인라인 <Path> 로 렌더한다.
//
// 원본의 흰색 반전 트릭 `filter: brightness(0) invert(1)` 은 RN 에 없다 →
// `tone` 으로 fill 을 분기한다(§3-0 예외 1). `tone` 은 **테마가 아니라 자기가 놓인 배경**을 뜻한다:
// 브랜드 채움 표면(네이비 버튼·헤더) 위에서는 양 테마 모두 'inverse' 다.
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { fontScale } from '@/theme/scale';

export type MoraLogoSize = 'sm' | 'md' | 'lg';
export type MoraLogoTone = 'brand' | 'inverse';
/** mark = 심볼만, wordmark = MORA 텍스트만, full = 둘 다 */
export type MoraLogoVariant = 'mark' | 'wordmark' | 'full';

export interface MoraLogoProps {
  variant?: MoraLogoVariant; // default 'full'
  /** 심볼 한 변의 dp. 토큰(sm/md/lg) 또는 §2 CMP-50 의 실측값(24|36|64|96) */
  size?: MoraLogoSize | 24 | 36 | 64 | 96;
  tone?: MoraLogoTone; // default 'brand'
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string; // default 'MORA'
  testID?: string;
}

const SIZE: Record<MoraLogoSize, number> = { sm: 24, md: 36, lg: 64 };

/* ── mora-logo-lg.svg 원본 path (viewBox 36×36, stroke-width 0.5) ───────────── */
const MARK_BODY =
  'M16.2769 8.5L2 2.5V28.5C2 28.5 2.37664 29.8825 2.98462 30.5C3.59259 31.1175 4.95385 31.5 4.95385 31.5L34 33.5L31.5385 31.5L5.93846 29.5C5.93846 29.5 5.25783 29.3087 4.95385 29C4.64986 28.6913 4.46154 28 4.46154 28V6L16.2769 11L28.0923 7.5V22L30.0615 24.5V6.5C30.0615 6.5 30.0691 5.35147 29.5692 5C29.095 4.66656 28.0923 5 28.0923 5L16.2769 8.5Z';
const MARK_LINES =
  'M27.6 24.5L11.3538 23V24.5L27.1077 26L29.5692 28L8.4 26V27.5L33.0154 29.5L27.6 24.5Z';

export function MoraLogo({
  variant = 'full',
  size = 'md',
  tone = 'brand',
  style,
  accessibilityLabel = 'MORA',
  testID,
}: MoraLogoProps) {
  const t = useTheme();
  const dim = typeof size === 'number' ? size : SIZE[size];

  // SVG fill 은 className 이 닿지 않는 지점이다 → useTheme (N-6).
  // 다크에서 tone='brand' 는 brand 토큰의 다크값(밝은 네이비)을 받는다.
  const color = tone === 'inverse' ? t.text.inverse : t.brand.base;

  // typography.logo = Patua One 24/28/letterSpacing 3. 심볼 크기에 비례시킨다.
  const wordSize = Math.round((fontScale.stat.size * dim) / SIZE.md);

  return (
    <View
      testID={testID}
      className="flex-row items-center gap-2"
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {variant === 'wordmark' ? null : (
        <Svg width={dim} height={dim} viewBox="0 0 36 36" fill="none">
          <Path d={MARK_BODY} fill={color} stroke={color} strokeWidth={0.5} />
          <Path d={MARK_LINES} fill={color} stroke={color} strokeWidth={0.5} />
        </Svg>
      )}

      {variant === 'mark' ? null : (
        // Patua One 은 latin subset 만 있다 — 'MORA' 워드마크에만 쓴다(§5-1)
        <Text
          className="font-logo"
          style={{
            fontSize: wordSize,
            lineHeight: Math.round(wordSize * 1.16),
            letterSpacing: 3,
            color,
          }}
          maxFontSizeMultiplier={1.2}
        >
          MORA
        </Text>
      )}
    </View>
  );
}
