// src/components/settings/Avatar.tsx
//
// CMP-10 Avatar — Component Library §2 정본.
//
// **아바타 업로드 기능은 없다.** 원본 웹은 base64 를 localStorage 에만 저장하고
// `TODO: POST to /me/avatar once endpoint exists` 라고 적어 두었다(SCR-25 변경점 표).
// 서버 엔드포인트가 없는 채로 기기 저장소에만 남는 프로필 사진은 기기를 바꾸는 순간 사라진다 —
// 사용자를 속이는 UI 라 **이식하지 않는다.** 그래서 이 컴포넌트는 이니셜만 그린다.
//
// `uri` 는 남겨 둔다. 소셜 로그인 사용자는 서버 `UserResponse.picture` 에 구글/카카오 프로필
// URL 이 실려 오므로(로컬 계정은 null) **읽기 전용으로는 지금도 쓸 수 있다.**
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontScale } from '@/theme/scale';

/** 원본 실측 크기 — 헤더 32 / 목록 40 / 설정 카드 64 / 프로필 편집 80. */
export type AvatarSize = 32 | 40 | 64 | 80;

export interface AvatarProps {
  /** 이니셜 산출용. 없거나 비면 'U' (원본 폴백). */
  name?: string;
  /** 프로필 사진 URL. 실패하면 조용히 이니셜로 되돌아간다. */
  uri?: string;
  size?: AvatarSize; // default 64
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * 크기별 이니셜 타이포 — SCR-25(64dp = 24/700) · SCR-26(80dp = 32/700) 와이어프레임 수치.
 * 32/40 은 같은 비율(≈0.4×)로 내린 값이다.
 */
const INITIAL_SIZE: Record<AvatarSize, number> = {
  32: fontScale.label.size, //   12
  40: fontScale.button.size, //  15
  64: fontScale.stat.size, //    24
  80: fontScale.display.size, // 32
};

/**
 * 이니셜 한 글자. 한글은 그대로, 라틴은 대문자로 올린다.
 *
 * `charAt(0)` 이 아니라 스프레드로 자르는 이유 — 이모지·일부 한자는 UTF-16 서로게이트 페어라
 * `charAt(0)` 이 반쪽만 잘라 깨진 글리프(�)를 만든다. `[...str]` 은 코드포인트 단위로 끊는다.
 */
export function avatarInitial(name?: string): string {
  const trimmed = name?.trim() ?? '';
  const first = [...trimmed][0];
  return first ? first.toUpperCase() : 'U';
}

export function Avatar({ name, uri, size = 64, style, testID }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(uri) && !imageFailed;

  return (
    <View
      testID={testID}
      // 사진이 없으면 브랜드 네이비 원판 + 흰 이니셜 (SCR-25 와이어프레임 `⬤ 64dp #15293D`).
      className="items-center justify-center overflow-hidden rounded-full bg-brand"
      style={[{ width: size, height: size }, style]}
      // 이름/이메일은 옆 텍스트가 이미 읽어 준다. 아바타까지 읽으면 같은 정보가 두 번 나온다.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Text
          className="font-w700 text-text-inverse"
          style={{ fontSize: INITIAL_SIZE[size], lineHeight: INITIAL_SIZE[size] * 1.2 }}
          // 큰 글씨 설정에서 이니셜이 원판을 넘치면 글자가 잘린다 — 원판은 고정 크기다.
          allowFontScaling={false}
        >
          {avatarInitial(name)}
        </Text>
      )}
    </View>
  );
}
