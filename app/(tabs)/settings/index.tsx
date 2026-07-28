// app/(tabs)/settings/index.tsx — SCR-25 설정
//
// 원본 `frontend/app/dashboard/settings/page.tsx` 의 2열 그리드 7섹션 → **1열 세로 섹션 리스트**.
// 모달 5종(password/nickname/confirm ×3)은 전용 화면(SCR-26~28)으로 갈라졌고 여기서는 진입만 한다.
//
// 원본에서 **의도적으로 버린 것들** (SCR-25 변경점 표):
//   - StatTile 3개 중 2개 — `integrationsActive:1`, `lastSyncLabel:'6분 전'` 이 하드코딩 목업이었다.
//     실 데이터가 있는 `보관 문서`(API-24 `storedDocumentCount`) 하나만 남긴다.
//   - 기본값 `'leechoeun'` / `'mvp6276@gmail.com'` — 실제 사용자 정보가 코드에 박혀 있었다.
//   - `연락처` 토글 — API 가 없는 로컬 상태 스위치였다.
//   - 아바타 업로드 — 서버 엔드포인트가 없어 기기에만 남는 사진이 된다.
//
// ⚠️ `화면 > 테마`(CMP-51 SegmentedControl 3택)는 **의도적으로 비어 있다.**
//    다크모드가 동결 중이라(`src/store/themeStore.ts` 의 `THEME_DARK_ENABLED = false`,
//    `app.config.js` 의 `userInterfaceStyle: 'light'`) `setMode()` 가 no-op 이고,
//    세그먼트를 넣으면 눌러도 아무 일이 없는 죽은 UI 가 된다.
//    **복구 절차**: `THEME_DARK_ENABLED = true` + `userInterfaceStyle: 'automatic'` 으로 되돌린 뒤
//    아래 `데이터` 섹션 바로 위(주석으로 자리를 표시해 두었다)에 `화면` 섹션을 만들고
//    CMP-12 SegmentedControl 을 `SettingsRow` 의 `segmented` 슬롯에 넣는다
//    (라벨 `시스템 따름`·`라이트`·`다크`, 부제 문구는 Screen Specs SCR-25 "테마 설정" 표).
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatTile } from '@/components/dashboard';
import { Avatar, ChevronIcon, SettingsRow, SettingsSection } from '@/components/settings';
import { Button, Skeleton, toast } from '@/components/ui';
import { variant } from '@/config/env';
import { NOTIFICATION_SETTINGS_COPY, PASSWORD_FORM_COPY } from '@/features/account';
import { useAuth, useMe } from '@/features/auth';
import { CALENDAR_COPY, useCalendarLink, useDashboard } from '@/features/dashboard';
import {
  SEARCH_COPY,
  searchHistoryClearedMessage,
  useClearSearchHistory,
} from '@/features/search';
import { haptics } from '@/lib/haptics';
import { HEADER_HEIGHT, tabScrollBottomPadding } from '@/navigation/shell';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * 하위 화면 경로.
 *
 * **`app/(tabs)/settings/index.tsx`(`/settings`)와 `app/settings/*`(`/settings/profile` …)의
 * 세그먼트 공유는 실제로 문제가 없다.** Navigation Map §2 각주가 Phase 0 실검증 항목으로
 * 남겨 둔 사항인데, `expo export` 로 라우트 트리를 실제 생성해 확인했다 —
 * 생성된 `.expo/types/router.d.ts` 에 `/settings`(탭)와 `/settings/profile|password|danger|
 * notifications|legal/[doc]`(루트 스택)이 **충돌 없이 함께** 들어 있다.
 * → 하위 스택을 `app/account/*` 로 옮길 필요가 없다.
 *
 * 법률 문서는 동적 라우트(`[doc]`)라 리터럴이 아니라 객체 형태로 넘긴다 — typedRoutes 가
 * `doc` 파라미터까지 검사해 준다.
 */
const legalRoute = (doc: 'terms' | 'privacy' | 'licenses' | 'about'): Href => ({
  pathname: '/settings/legal/[doc]',
  params: { doc },
});

/** SCR-25 문구 원문. 화면이 문장을 지어내지 않게 한곳에 모은다. */
const COPY = {
  title: '설정',
  profileFailed: '프로필을 불러오지 못했습니다.',
  retry: '다시 시도',
  joinedUnknown: '가입일 정보 없음',

  accountSection: '계정',
  nickname: '닉네임',
  email: '이메일',
  emailReadonly: '이메일은 변경할 수 없습니다.',
  password: '비밀번호',
  passwordLocal: '비밀번호를 변경합니다.',
  passwordSocial: '소셜 계정은 비밀번호가 없습니다',

  linkSection: '연동',
  notifSection: '알림',
  notifRow: '알림 설정',

  dataSection: '데이터',
  clearHistory: '검색 기록 삭제',
  clearHistoryDesc: '저장된 모든 검색어를 삭제합니다.',
  clearHistoryTitle: '검색 기록을 모두 삭제할까요?',
  clearHistoryBody: '이 작업은 되돌릴 수 없습니다. 계속하려면 확인을 눌러주세요.',
  deleteAll: '내 데이터 전체 삭제',
  deleteAllDesc: '복구할 수 없습니다. 신중히 진행하세요.',

  supportSection: '지원',
  contact: '문의하기',
  contactDesc: '이메일로 문의를 보냅니다.',
  contactFailed: '메일 앱을 열 수 없습니다.',
  terms: '이용약관',
  termsDesc: '서비스 이용약관을 확인합니다.',
  privacy: '개인정보 처리방침',
  privacyDesc: '데이터 처리 방식을 확인합니다.',
  licenses: '오픈소스 라이선스',
  licensesDesc: '사용한 오픈소스 목록입니다.',
  about: '앱 정보',
  aboutDesc: 'MORA 소개와 문의처를 확인합니다.',
  appVersion: '앱 버전',

  devSection: '개발',

  signOut: '로그아웃',
  signOutTitle: '로그아웃할까요?',
  signOutBody: '다시 로그인하려면 이메일과 비밀번호가 필요합니다.',
  leave: '회원 탈퇴',
  cancel: '취소',
  confirm: '삭제',
  copyright: '© 2026 MORA. All rights reserved.',

  storedDocuments: '보관 문서',
  unit: '건',
} as const;

const SUPPORT_MAILTO = 'mailto:support@mora.app';

/** SCR-31 진입: 버전 라벨 5회 탭. 개발 빌드에서는 아래 `개발` 섹션이 같은 곳으로 데려간다. */
const DIAGNOSTICS_TAP_COUNT = 5;

/** 가입일 표시 — 서버 `createdAt` 은 ISO 문자열이다(실측 `2026-07-28T05:06:26.192228`). */
function formatJoinedAt(iso: string | undefined): string {
  if (!iso) return COPY.joinedUnknown;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return COPY.joinedUnknown;
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. 가입`;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{ calendar?: string }>();

  const { user, isSocialAccount, signOut } = useAuth();
  // 캐시된 사용자로 즉시 그리고(SCR-25 "초기" 상태), 포커스 시 서버 값으로 덮는다.
  const meQuery = useMe();
  const me = meQuery.data ?? user;

  const dashboard = useDashboard();
  const calendar = useCalendarLink(me?.id);
  const clearHistory = useClearSearchHistory();

  const appVersion = Constants.expoConfig?.version ?? '—';
  const buildNumber = Constants.expoConfig?.android?.versionCode;
  const versionLabel = buildNumber === undefined ? appVersion : `${appVersion} (${buildNumber})`;
  const isDevBuild = variant !== 'production';

  const [versionTaps, setVersionTaps] = useState(0);

  /* ── DL-02: 구글 캘린더 콜백 착지 (`mora://settings?calendar=connected|failed`) ────────
     인앱 브라우저가 아니라 **외부 브라우저**로 흘러간 경우 `startCalendarConnect()` 의
     `openAuthSessionAsync` 프라미스가 결과를 받지 못하고, 딥링크만 이 화면으로 들어온다.
     그 경로에서도 상태가 갱신되도록 파라미터를 한 번 소비한다. */
  const handledCalendarParam = useRef<string | null>(null);
  // `calendar` 객체는 렌더마다 새로 만들어지므로 의존성에 넣으면 이펙트가 매 렌더 돈다.
  // react-query 의 `refetch` 는 안정적인 참조라 이것만 잡는다.
  const refetchCalendar = calendar.refetch;
  useEffect(() => {
    const status = params.calendar;
    if (status !== 'connected' && status !== 'failed') return;
    // 값 자체를 기억한다. 불리언으로 두면 두 번째 연동 시도(connected → failed)를 놓친다.
    if (handledCalendarParam.current === status) return;
    handledCalendarParam.current = status;

    if (status === 'connected') {
      // 성공의 정본은 서버 DB 다 — 딥링크는 신호일 뿐이라 재조회로 확인한다.
      void refetchCalendar();
    } else {
      toast.error(CALENDAR_COPY.connectFailed);
    }
  }, [params.calendar, refetchCalendar]);

  /* ── 액션 ──────────────────────────────────────────────────────────────── */

  const openPassword = () => {
    if (isSocialAccount) {
      haptics.warning(); // G-6
      Alert.alert(COPY.password, PASSWORD_FORM_COPY.socialBlocked, [{ text: '확인' }]);
      return;
    }
    router.push('/settings/password');
  };

  const toggleCalendar = (next: boolean) => {
    if (!calendar.available) {
      // 되는 척하지 않는다 — 딥링크가 앱으로 착지할 수 없는 빌드/기기다.
      toast.info(CALENDAR_COPY.unavailable);
      return;
    }

    if (next) {
      calendar.connect.mutate(undefined, {
        onSuccess: (outcome) => {
          switch (outcome.status) {
            case 'success':
              haptics.success();
              return;
            case 'canceled':
              return; // 취소는 에러가 아니다 → 무음 복귀
            case 'unavailable':
              toast.info(CALENDAR_COPY.unavailable);
              return;
            default:
              toast.error(outcome.message);
          }
        },
        onError: (error) => toast.error(error.message),
      });
      return;
    }

    haptics.warning(); // G-6
    Alert.alert('구글 캘린더 연동을 해제할까요?', '이미 등록된 일정은 캘린더에 남습니다.', [
      { text: COPY.cancel, style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: () =>
          calendar.disconnect.mutate(undefined, {
            onSuccess: () => toast.success(CALENDAR_COPY.disconnected_toast),
            onError: (error) => toast.error(error.message),
          }),
      },
    ]);
  };

  const confirmClearHistory = () => {
    haptics.warning(); // G-6
    Alert.alert(COPY.clearHistoryTitle, COPY.clearHistoryBody, [
      { text: COPY.cancel, style: 'cancel' },
      {
        text: COPY.confirm,
        style: 'destructive',
        onPress: () =>
          clearHistory.mutate(undefined, {
            onSuccess: (count) => toast.success(searchHistoryClearedMessage(count)),
            onError: () => toast.error(SEARCH_COPY.historyClearFailed),
          }),
      },
    ]);
  };

  const openContact = () => {
    void (async () => {
      try {
        await Linking.openURL(SUPPORT_MAILTO);
      } catch {
        toast.error(COPY.contactFailed);
      }
    })();
  };

  const tapVersion = () => {
    const next = versionTaps + 1;
    if (next >= DIAGNOSTICS_TAP_COUNT) {
      setVersionTaps(0);
      haptics.impact('medium');
      router.push('/(dev)/diagnostics');
      return;
    }
    setVersionTaps(next);
  };

  const confirmSignOut = () => {
    haptics.warning(); // G-6
    Alert.alert(COPY.signOutTitle, COPY.signOutBody, [
      { text: COPY.cancel, style: 'cancel' },
      {
        text: COPY.signOut,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await signOut();
            // 인증 화면으로 되돌아오지 못하게 replace 다 (Navigation Map §6-3 규칙 2).
            router.replace('/(auth)/login');
          })();
        },
      },
    ]);
  };

  /* ── 렌더 ──────────────────────────────────────────────────────────────── */

  // 캐시된 사용자조차 없고 조회도 실패한 상태에서만 에러 카드를 그린다 —
  // 값을 이미 보여 주고 있는데 위에 에러를 얹으면 무엇이 잘못됐는지 알 수 없다.
  const profileFailed = me === null && meQuery.isError;
  const profileLoading = me === null && meQuery.isPending;

  return (
    <View className="flex-1 bg-bg-base">
      {/* ── 헤더 (CMP-20) ── */}
      <View
        className="justify-center px-4"
        style={{ paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }}
      >
        <Text className="text-h1 font-w700 text-text-primary" accessibilityRole="header">
          {COPY.title}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: tabScrollBottomPadding(insets.bottom),
        }}
        showsVerticalScrollIndicator={false}
        testID="settings-scroll"
      >
        {/* ── 프로필 카드 → SCR-26 ── */}
        {profileFailed ? (
          <View
            className="mt-2 items-center gap-3 rounded-card border border-danger-border bg-danger-container p-5"
            accessibilityLiveRegion="polite"
          >
            <Text className="text-center text-base font-w600 text-danger">
              {COPY.profileFailed}
            </Text>
            <Button
              label={COPY.retry}
              onPress={() => void meQuery.refetch()}
              variant="secondary"
              size="sm"
            />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`프로필 편집, ${me?.name ?? ''}`}
            onPress={() => {
              haptics.selection(); // HAP-01
              router.push('/settings/profile');
            }}
            style={({ pressed }) => (pressed ? { transform: [{ scale: 0.99 }] } : null)}
            className="mt-2 flex-row items-center gap-4 rounded-card border border-border-subtle bg-bg-elevated p-4"
            testID="settings-profile-card"
          >
            <Avatar name={me?.name} {...(me?.picture ? { uri: me.picture } : {})} size={64} />

            <View className="flex-1">
              {profileLoading ? (
                <View className="gap-2">
                  <Skeleton width="55%" height={18} />
                  <Skeleton width="75%" height={13} />
                  <Skeleton width="40%" height={11} />
                </View>
              ) : (
                <>
                  <Text className="text-h3 font-w700 text-text-primary" numberOfLines={1}>
                    {me?.name ?? '—'}
                  </Text>
                  <Text className="mt-0.5 text-body-sm text-text-secondary" numberOfLines={1}>
                    {me?.email ?? '—'}
                  </Text>
                  <Text className="mt-1 text-caption text-text-muted">
                    {formatJoinedAt(me?.createdAt)}
                  </Text>
                </>
              )}
            </View>

            <ChevronIcon color={t.text.muted} />
          </Pressable>
        )}

        {/* ── 보관 문서 (API-24). 원본의 나머지 두 타일은 목업이라 버렸다 ── */}
        <StatTile
          icon="📄"
          tone="stored"
          variant="row"
          label={COPY.storedDocuments}
          value={dashboard.data?.storedDocumentCount ?? 0}
          unit={COPY.unit}
          loading={dashboard.isPending}
          onPress={() => router.push('/(tabs)/archive')}
          style={{ marginTop: 12 }}
          testID="settings-stored-count"
        />

        <SettingsSection title={COPY.accountSection}>
          <SettingsRow
            label={COPY.nickname}
            value={me?.name ?? '—'}
            onPress={() => router.push('/settings/profile')}
            testID="row-nickname"
          />
          {/* 이메일은 서버에 변경 흐름이 없어 읽기 전용이다(원본 주석: `Email is read-only until
              /me/email verification flow exists on backend`). SCR-25 표대로 **chevron 을 달지 않고**
              값만 보여 준다 — 다음 화면이 없는데 `›` 를 그리면 거짓말이다.
              그래도 탭은 받는다: 눌러도 아무 일이 없으면 고장으로 읽힌다. */}
          <SettingsRow
            label={COPY.email}
            value={me?.email ?? '—'}
            chevron={false}
            onPress={() => toast.info(COPY.emailReadonly)}
            testID="row-email"
          />
          <SettingsRow
            label={COPY.password}
            description={isSocialAccount ? COPY.passwordSocial : COPY.passwordLocal}
            onPress={openPassword}
            testID="row-password"
          />
        </SettingsSection>

        <SettingsSection title={COPY.linkSection}>
          <SettingsRow
            label={CALENDAR_COPY.rowTitle}
            description={
              calendar.available
                ? calendar.googleEmail || CALENDAR_COPY.rowDescription
                : CALENDAR_COPY.unavailable
            }
            pill={{
              label: calendar.connected ? CALENDAR_COPY.connected : CALENDAR_COPY.disconnected,
              tone: calendar.connected ? 'success' : 'neutral',
            }}
            toggle={{
              value: calendar.connected,
              onValueChange: toggleCalendar,
              busy: calendar.isBusy,
              // 착지 불가 환경에서도 탭은 받는다 — 눌러야 `준비 중입니다.` 를 말해 줄 수 있다.
              disabled: false,
            }}
            testID="row-gcal"
          />
        </SettingsSection>

        <SettingsSection title={COPY.notifSection}>
          <SettingsRow
            label={COPY.notifRow}
            description={NOTIFICATION_SETTINGS_COPY.entryCaption}
            onPress={() => router.push('/settings/notifications')}
            testID="row-notif-settings"
          />
        </SettingsSection>

        {/* ⚠️ 여기(데이터 섹션 바로 위)가 다크모드 복구 시 `화면 > 테마` 섹션 자리다.
            파일 상단 주석의 복구 절차를 참조. 지금 넣으면 눌러도 아무 일이 없는 죽은 UI 가 된다. */}

        <SettingsSection title={COPY.dataSection}>
          <SettingsRow
            label={COPY.clearHistory}
            description={COPY.clearHistoryDesc}
            tone="danger"
            disabled={clearHistory.isPending}
            onPress={confirmClearHistory}
            testID="row-clear-history"
          />
          <SettingsRow
            label={COPY.deleteAll}
            description={COPY.deleteAllDesc}
            tone="danger"
            onPress={() => router.push('/settings/danger')}
            testID="row-delete-all"
          />
        </SettingsSection>

        <SettingsSection title={COPY.supportSection}>
          <SettingsRow
            label={COPY.contact}
            description={COPY.contactDesc}
            onPress={openContact}
            testID="row-contact"
          />
          <SettingsRow
            label={COPY.terms}
            description={COPY.termsDesc}
            onPress={() => router.push(legalRoute('terms'))}
            testID="row-terms"
          />
          <SettingsRow
            label={COPY.privacy}
            description={COPY.privacyDesc}
            onPress={() => router.push(legalRoute('privacy'))}
            testID="row-privacy"
          />
          <SettingsRow
            label={COPY.licenses}
            description={COPY.licensesDesc}
            onPress={() => router.push(legalRoute('licenses'))}
            testID="row-licenses"
          />
          <SettingsRow
            label={COPY.about}
            description={COPY.aboutDesc}
            onPress={() => router.push(legalRoute('about'))}
            testID="row-about"
          />
          {/* 값 행이지만 탭을 받는다 — **5회 탭이 SCR-31 진단 화면의 정식 진입로**다
              (production 빌드에는 아래 `개발` 섹션이 없으므로 이 경로가 유일하다).
              숨은 동작이라 chevron 은 달지 않는다. */}
          <SettingsRow
            label={COPY.appVersion}
            value={versionLabel}
            chevron={false}
            onPress={tapVersion}
            testID="row-app-version"
          />
        </SettingsSection>

        {/* ── 개발 빌드 전용. production 프로파일에서는 섹션 자체가 사라진다 (FR-121) ── */}
        {isDevBuild ? (
          <SettingsSection title={COPY.devSection}>
            <SettingsRow
              label="서버 연결 진단"
              description="백엔드·OCR 주소를 확인하고 바꿉니다."
              onPress={() => router.push('/(dev)/diagnostics')}
              testID="row-diagnostics"
            />
            <SettingsRow
              label="파이프라인 검증"
              description="테마·토큰·빌드 설정을 확인합니다."
              onPress={() => router.push('/(dev)/pipeline')}
              testID="row-pipeline"
            />
          </SettingsSection>
        ) : null}

        <Button
          label={COPY.signOut}
          onPress={confirmSignOut}
          variant="secondary"
          size="lg"
          fullWidth
          haptic="none"
          style={{ marginTop: 32 }}
          testID="settings-sign-out"
        />

        {/* SCR-25 와이어프레임: 로그아웃 아래 danger ghost 로 놓인다 → SCR-28 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY.leave}
          onPress={() => {
            haptics.selection(); // HAP-01
            router.push('/settings/danger');
          }}
          // py-3 만으로는 42dp 라 44dp 하한에 2dp 모자란다 (A11Y §11-1)
          className="mt-4 min-h-11 items-center justify-center py-3"
          testID="settings-leave"
        >
          <Text className="text-body-sm font-w600 text-danger">{COPY.leave}</Text>
        </Pressable>

        <Text className="mt-4 text-center text-caption text-text-muted">{COPY.copyright}</Text>
      </ScrollView>
    </View>
  );
}
