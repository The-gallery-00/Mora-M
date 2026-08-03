// src/components/auth/SocialButtons.tsx
//
// CMP-37 SocialButtons — SCR-03/04 공용. 원본 `components/shared/SocialButtons.tsx` 이식.
//
// 모바일 변경점 (Screen Specs SCR-03 변경점 표)
//  - 원본 로그인은 `variant="icon"`(원형 56×56 3개)였지만 **풀폭 `full` 3개로 통일**한다.
//    라벨 없는 원형 아이콘은 provider 식별성이 낮고 접근성이 취약하다.
//  - `window.location.href = ...` 전체 페이지 이동 → `WebBrowser.openAuthSessionAsync`
//    (호출은 화면이 `useSocialLogin()` 으로 한다. 이 컴포넌트는 표시와 탭 전달만 맡는다).
//  - 배치 순서 `google → kakao → naver` 는 원본 배열 그대로다(`SOCIAL_PROVIDERS`).
//
// 색: 소셜 브랜드 색은 **테마 무관 고정**이다(Design Tokens DK-10). 그래서 tailwind.config.js 에
// `kakao`/`naver` 가 CSS 변수가 아닌 리터럴로 박혀 있고 여기서는 그 클래스를 쓴다.
// SVG fill 은 className 이 닿지 않으므로(§3-0 N-6) 아래 BRAND 상수를 통과한다 —
// 이것은 테마 색이 아니라 타사 브랜드 자산이라 tokens.ts 에 둘 수 없다.
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { SOCIAL_PROVIDERS, type SocialProvider } from "@/features/auth";
import { useTheme } from "@/theme/ThemeProvider";

/** DK-10 — 타사 브랜드 자산. 원본 `lib/svgPaths.ts` 의 fill 값 그대로다. */
const BRAND = {
  kakaoFg: "#3C1E1E",
  googleBlue: "#4285F4",
  googleGreen: "#34A853",
  googleYellow: "#FBBC05",
  googleRed: "#EA4335",
} as const;

/* ── 아이콘: 원본 `lib/svgPaths.ts` 의 path 데이터를 글자 단위로 옮겼다 ────────── */

const P = {
  naver:
    "M9.04698 20H4V4H9.04698L14.7275 12.6286V4H20V20H14.7275L9.04698 12.6286V20Z",
  kakao:
    "M12 3C6.48 3 2 6.36 2 10.5C2 13.17 3.76 15.51 6.41 16.85L5.29 21L10.11 17.82C10.73 17.9 11.35 17.95 12 17.95C17.52 17.95 22 14.59 22 10.45C22 6.31 17.52 3 12 3Z",
  googleBlue:
    "M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.797 14.9334 17.5385 15.5749 17.1604 16.1456C16.7822 16.7162 16.2922 17.2042 15.72 17.58V20.35H19.29C21.37 18.43 22.57 15.61 22.57 12.25H22.56Z",
  googleGreen:
    "M12 23C14.97 23 17.46 22.02 19.28 20.34L15.71 17.57C14.73 18.23 13.48 18.63 12 18.63C9.14 18.63 6.71 16.7 5.84 14.1H2.18V16.94C3.99 20.53 7.7 23 12 23Z",
  googleYellow:
    "M5.84 14.09C5.62 13.43 5.49 12.73 5.49 12C5.49 11.27 5.62 10.57 5.84 9.91V7.07H2.18C1.43 8.55 1 10.22 1 12C1 13.78 1.43 15.45 2.18 16.93L5.03 14.71L5.84 14.09Z",
  googleRed:
    "M12 5.38C13.62 5.38 15.06 5.94 16.21 7.02L19.36 3.87C17.45 2.09 14.97 1 12 1C7.7 1 3.99 3.47 2.18 7.07L5.84 9.91C6.71 7.31 9.14 5.38 12 5.38Z",
} as const;

const ICON_SIZE = 22; // 원본 22×22

function GoogleIcon() {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d={P.googleBlue} fill={BRAND.googleBlue} />
      <Path d={P.googleGreen} fill={BRAND.googleGreen} />
      <Path d={P.googleYellow} fill={BRAND.googleYellow} />
      <Path d={P.googleRed} fill={BRAND.googleRed} />
    </Svg>
  );
}

function KakaoIcon() {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d={P.kakao} fill={BRAND.kakaoFg} />
    </Svg>
  );
}

function NaverIcon({ color }: { color: string }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path d={P.naver} fill={color} />
    </Svg>
  );
}

/* ── provider 별 표시 규격 (원본 `getProviderConfig` full variant 그대로) ────── */

type ProviderStyle = {
  /** 스크린리더용 이름. 원본 `providerName` */
  name: string;
  /** 버튼 라벨. 원본 `label` */
  label: string;
  container: string;
  labelClass: string;
};

const STYLE: Record<SocialProvider, ProviderStyle> = {
  // 흰 배경 + #505050 보더 = bg.elevated + text.secondary(라이트 #505050). 라벨은 brand(#15293D).
  google: {
    name: "구글",
    label: "Google로 시작하기",
    container: "bg-bg-elevated border border-text-secondary",
    labelClass: "text-brand",
  },
  kakao: {
    name: "카카오",
    label: "카카오로 시작하기",
    container: "bg-kakao",
    labelClass: "text-kakao-fg",
  },
  naver: {
    name: "네이버",
    label: "네이버로 시작하기",
    container: "bg-naver-btn",
    labelClass: "text-text-inverse",
  },
};

export interface SocialButtonsProps {
  onPress: (provider: SocialProvider) => void;
  /** 인증 세션이 진행 중인 provider. 그 버튼만 스피너를 돌리고 나머지는 비활성한다. */
  busy?: SocialProvider | null;
  /** 오프라인 등 화면 전체가 쓰기 불가일 때 (G-5). */
  disabled?: boolean;
  testID?: string;
}

export function SocialButtons({
  onPress,
  busy = null,
  disabled = false,
  testID,
}: SocialButtonsProps) {
  return (
    <View className="gap-3" testID={testID}>
      {SOCIAL_PROVIDERS.map((provider) => (
        <SocialButton
          key={provider}
          provider={provider}
          onPress={onPress}
          loading={busy === provider}
          disabled={disabled || (busy !== null && busy !== provider)}
        />
      ))}
    </View>
  );
}

function SocialButton({
  provider,
  onPress,
  loading,
  disabled,
}: {
  provider: SocialProvider;
  onPress: (provider: SocialProvider) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const t = useTheme();
  const style = STYLE[provider];
  const blocked = disabled || loading;

  // 스피너·네이버 아이콘 색은 SVG/네이티브라 className 이 닿지 않는다 (N-6).
  const foreground = provider === "naver" ? t.text.inverse : t.brand.base;

  return (
    <Pressable
      accessibilityRole="button"
      // 원본 aria-label 문구 그대로: `${providerName} 계정으로 시작하기`
      accessibilityLabel={`${style.name} 계정으로 시작하기`}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => onPress(provider)}
      // 웹 hover → 모바일 pressed opacity (G-11)
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : blocked ? 0.6 : 1,
      })}
      className={`h-14 w-full flex-row items-center justify-center gap-3 rounded-xl overflow-hidden ${style.container}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : provider === "google" ? (
        <GoogleIcon />
      ) : provider === "kakao" ? (
        <KakaoIcon />
      ) : (
        <NaverIcon color={foreground} />
      )}
      <Text
        className={`text-button font-w600 ${style.labelClass}`}
        numberOfLines={1}
      >
        {style.label}
      </Text>
    </Pressable>
  );
}
