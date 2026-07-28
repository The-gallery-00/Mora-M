// src/components/auth/AuthScreen.tsx
//
// SCR-03 로그인 / SCR-04 회원가입 공용 레이아웃.
// Screen Specs SCR-04 모바일 변경점 1: "레이아웃 컴포넌트를 공유하고 카피만 분기" — 원본
// `components/shared/AuthForm.tsx` 의 controlled 구조를 그대로 유지한 이식이다.
//
// 원본 → 모바일 재설계 (SCR-03 변경점 표)
//  - `h-[560px] w-[880px]` 절대 캔버스 + 좌우 absolute 자식 → **세로 스택 1열**
//  - `w-[415.5px]` 고정 폭 → `width:100%` + 좌우 24dp
//  - `Hero` 일러스트(1.2MB, w-750px) 폐기 → 로고 + 워드마크만. 키보드가 올라오면 어차피 안 보인다
//  - `<form onSubmit>` → 제출 버튼 onPress + 비밀번호 필드 onSubmitEditing
//  - 하단 전환 링크 `<span onClick>` → Pressable + accessibilityRole="link"
//
// 키보드 (Mobile UX Guide §5)
//  - KeyboardAvoidingView 는 **화면 루트에 1개**. iOS padding / Android height.
//  - ScrollView + `keyboardShouldPersistTaps="handled"` — 입력 중 버튼을 한 번에 누를 수 있어야 한다.
//  - 포커스 스크롤: 필드가 포커스되면 제목~제출 버튼 묶음의 상단으로 스크롤해, 키보드 위에
//    폼 전체가 남게 한다(규칙 3의 "하단이 키보드 위 16dp 이상" 을 블록 단위로 보장하는 방식).
import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { variant } from '@/config/env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoraLogo } from '@/components/brand/MoraLogo';
import { Button, Divider } from '@/components/ui';
import type { SocialProvider } from '@/features/auth';

import { SocialButtons } from './SocialButtons';

/** 필드 렌더러가 받는 배선. 각 입력의 `onFocus` 에 그대로 연결한다. */
export interface AuthFieldsApi {
  onFieldFocus: () => void;
}

export interface AuthScreenProps {
  /** `로그인` / `회원가입` */
  title: string;
  /** 입력 필드 블록. 필드 간 간격은 이 컴포넌트가 16dp 로 준다. */
  renderFields: (api: AuthFieldsApi) => ReactNode;
  /** 서버/네트워크 실패 문구. 필드 검증 오류는 각 필드가 직접 표시한다 (§7-1 폼 검증 규칙). */
  errorMessage?: string | undefined;
  submitLabel: string;
  submitLoadingLabel: string;
  submitting: boolean;
  onSubmit: () => void;
  /** 진행 중인 소셜 provider (없으면 null). */
  socialBusy?: SocialProvider | null;
  onSocialPress: (provider: SocialProvider) => void;
  /** 하단 전환 링크 — `계정이 없으신가요?` + `회원가입` */
  footerText: string;
  footerLinkLabel: string;
  onFooterLinkPress: () => void;
  testID?: string;
}

/** 키보드가 뜬 뒤에 스크롤해야 목표 위치가 맞는다. KAV 정착 시간. */
const FOCUS_SCROLL_DELAY_MS = 120;

export function AuthScreen({
  title,
  renderFields,
  errorMessage,
  submitLabel,
  submitLoadingLabel,
  submitting,
  onSubmit,
  socialBusy = null,
  onSocialPress,
  footerText,
  footerLinkLabel,
  onFooterLinkPress,
  testID,
}: AuthScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const formTopRef = useRef(0);

  const onFieldFocus = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, formTopRef.current - 12), animated: true });
    }, FOCUS_SCROLL_DELAY_MS);
  }, []);

  return (
    <View className="flex-1 bg-bg-base" style={{ paddingTop: insets.top }} testID={testID}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 24,
          }}
        >
          {/* 헤더 — 원본 Hero 를 로고 + 워드마크로 축약 */}
          <View className="items-center pb-6 pt-8">
            <MoraLogo variant="mark" size={64} accessibilityLabel="MORA" />
            {/* 워드마크 px = 24 × dim/36 이고 CMP-50 이 dim 을 24|36|64|96 으로 제한한다.
                와이어프레임의 28px 에 가장 가까운 값이 dim 36(=24px)이다. */}
            <MoraLogo variant="wordmark" size={36} style={{ marginTop: 10 }} />
          </View>

          {/* 폼 블록 — 포커스 스크롤의 기준점 */}
          <View
            onLayout={(event) => {
              formTopRef.current = event.nativeEvent.layout.y;
            }}
          >
            {/* 원본 24/700 → 스케일 토큰 h1(22/30). 색은 brand(#15293D) */}
            <Text
              className="mb-5 text-center text-h1 font-w700 text-brand"
              accessibilityRole="header"
            >
              {title}
            </Text>

            <View className="gap-4">{renderFields({ onFieldFocus })}</View>

            {errorMessage ? (
              <Text
                className="mt-4 text-center text-base text-danger"
                accessibilityLiveRegion="polite"
              >
                {errorMessage}
              </Text>
            ) : null}

            <Button
              label={submitLabel}
              loadingLabel={submitLoadingLabel}
              loading={submitting}
              onPress={onSubmit}
              variant="primary"
              size="lg"
              fullWidth
              style={{ marginTop: 16 }}
            />
          </View>

          <Divider label="또는" style={{ marginTop: 24, marginBottom: 16 }} />

          <SocialButtons onPress={onSocialPress} busy={socialBusy} disabled={submitting} />

          {/* 하단 전환 링크 — 터치 타겟 44dp 확보 (§11-1) */}
          <View className="mt-6 flex-row items-center justify-center">
            <Text className="text-base text-text-secondary">{footerText} </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={footerLinkLabel}
              onPress={onFooterLinkPress}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              className="min-h-11 justify-center"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text className="text-base font-w600 text-action">{footerLinkLabel}</Text>
            </Pressable>
          </View>

          {/*
            개발 빌드 전용 — 서버 주소를 여기서도 바꿀 수 있어야 한다 (FR-121).
            진단 화면이 설정 탭에만 있으면 **로그인 전에는 도달할 수 없다.** 그런데 주소가 틀렸을 때
            막히는 지점이 바로 로그인이라, 서버 주소를 고치려면 로그인해야 하고 로그인하려면
            주소를 고쳐야 하는 교착이 생긴다. 인증 화면에서 직접 진입로를 연다.
            production 프로파일에서는 렌더되지 않는다.
          */}
          {variant !== 'production' ? (
            <View className="mt-4 items-center">
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="서버 연결 진단 열기"
                onPress={() => router.push('/(dev)/diagnostics')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                className="min-h-11 justify-center"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Text className="text-sm text-text-muted">서버 연결 진단</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
