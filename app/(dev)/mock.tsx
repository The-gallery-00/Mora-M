import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { variant } from '@/config/env';
import { TYPE_LABELS } from '@/features/scan/types';
import {
  hasMockOverride,
  isMockBuild,
  isMockEnabled,
  setMockEnabled,
} from '@/mocks/config';
import { readDb, resetDb } from '@/mocks/db';
import { peekMockScanPlan, resetMockScanCycle, type MockScanPlan } from '@/mocks/scan';

/**
 * 목 모드 (개발 빌드 전용).
 *
 * 서버(Spring·OCR·LLM·Postgres) 없이 앱만 켜서 전 화면을 돌려보기 위한 스위치와 상태판이다.
 * 팀원이 백엔드 세팅 없이 APK 만 받아도 여기서 목 모드를 켜면 바로 전 화면이 동작한다.
 *
 * `(tabs)` 가 아니라 `(dev)` 그룹에 둔다 — 탭에 파일을 만들면 탭이 하나 늘어난다.
 * 화면 구조·토큰 사용은 `(dev)/diagnostics.tsx` 와 맞췄다. HEX 리터럴 0개.
 */

type MockCounts = {
  cards: number;
  posters: number;
  tickets: number;
  receipts: number;
  notifications: number;
  unread: number;
  seededOn: string;
  dirty: boolean;
};

/** 목 DB 는 가변 상태다. 화면은 필요할 때마다 세어서 스냅샷으로 들고 있는다. */
function readCounts(): MockCounts {
  const db = readDb();
  return {
    cards: db.cards.length,
    posters: db.posters.length,
    tickets: db.tickets.length,
    receipts: db.receipts.length,
    notifications: db.notifications.length,
    unread: db.notifications.filter((row) => !row.read).length,
    seededOn: db.seededOn,
    dirty: db.dirty,
  };
}

export default function MockModeScreen() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState<boolean>(isMockEnabled);
  const [counts, setCounts] = useState<MockCounts>(readCounts);
  const [plan, setPlan] = useState<MockScanPlan>(peekMockScanPlan);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const refresh = useCallback(() => {
    setEnabled(isMockEnabled());
    setCounts(readCounts());
    setPlan(peekMockScanPlan());
  }, []);

  const toggle = useCallback(() => {
    const next = !isMockEnabled();
    setMockEnabled(next);
    setEnabled(next);
    // 쿼리 캐시(gcTime 30분)에 이전 모드의 응답이 남아 있어 재시작 없이는 화면이 섞인다.
    setRestartNeeded(true);
  }, []);

  const reset = useCallback(() => {
    Alert.alert(
      '목 데이터를 초기화할까요?',
      '스캔으로 저장한 목 문서가 모두 사라지고 씨드 데이터로 되돌아갑니다. 스캔 유형 순환도 명함부터 다시 시작합니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '초기화',
          style: 'destructive',
          onPress: () => {
            resetDb();
            resetMockScanCycle();
            refresh();
          },
        },
      ],
    );
  }, [refresh]);

  const total =
    counts.cards + counts.posters + counts.tickets + counts.receipts;

  return (
    <ScrollView
      className="flex-1 bg-bg-base"
      contentContainerStyle={{
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 40,
        paddingHorizontal: 20,
      }}
    >
      <Text className="text-stat font-w700 text-text-primary">목 모드</Text>
      <Text className="mt-1 text-sm text-text-secondary">
        서버를 켜지 않고 앱만으로 전 화면을 확인합니다. 네트워크 계층에서만 응답을 바꾸므로 화면
        코드는 실서버와 동일하게 동작합니다.
      </Text>

      {/* ── 현재 상태 ── */}
      <View
        className={
          enabled
            ? 'mt-6 rounded-card border border-success bg-bg-elevated p-4'
            : 'mt-6 rounded-card border border-border-subtle bg-bg-elevated p-4'
        }
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-text-primary">현재 상태</Text>
          <Text className={enabled ? 'text-sm text-success-text' : 'text-sm text-text-muted'}>
            {enabled ? '목 모드 ON' : '실서버 모드'}
          </Text>
        </View>
        <View className="mt-2">
          <Row label="빌드 플래그" value={isMockBuild() ? 'EXPO_PUBLIC_MOCK=1' : '없음 (기본 0)'} />
          <Row label="런타임 토글" value={hasMockOverride() ? '저장됨 (빌드값 무시)' : '없음'} />
          <Row label="빌드 변형" value={variant} />
          <Row
            label="다음 스캔 유형"
            value={`${TYPE_LABELS[plan.type]}${plan.lowConfidence ? ' · 저신뢰' : ''}`}
          />
          <Row label="다음 신뢰도" value={plan.confidence.toFixed(2)} />
        </View>
      </View>

      {/* ── 토글 ── */}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        className={
          enabled
            ? 'mt-6 items-center justify-center rounded-btn border border-border-strong px-4 py-4'
            : 'mt-6 items-center justify-center rounded-btn bg-action px-4 py-4'
        }
        testID="mock-toggle"
      >
        <Text className={enabled ? 'text-base text-text-primary' : 'text-base text-text-inverse'}>
          {enabled ? '목 모드 끄기' : '목 모드 켜기'}
        </Text>
      </Pressable>

      {restartNeeded ? (
        <View className="mt-3 rounded-card border border-warn bg-bg-sunken p-4">
          <Text className="text-sm text-text-primary">앱을 다시 실행해 주세요</Text>
          <Text className="mt-1 text-xs leading-5 text-text-secondary">
            토글은 저장됐지만 이미 받아 둔 응답이 쿼리 캐시(30분)에 남아 있습니다. 앱을 완전히
            종료했다가 다시 열어야 전 화면이 새 모드로 그려집니다.
          </Text>
        </View>
      ) : null}

      {/* ── 목 데이터 요약 ── */}
      <Text className="mt-8 text-sm text-text-muted">목 데이터</Text>
      <View className="mt-2 rounded-card border border-border-subtle bg-bg-elevated p-4">
        <Row label="명함" value={`${counts.cards}건`} />
        <Row label="포스터" value={`${counts.posters}건`} />
        <Row label="티켓" value={`${counts.tickets}건`} />
        <Row label="영수증" value={`${counts.receipts}건`} />
        <Row label="알림" value={`${counts.notifications}건 (미읽음 ${counts.unread})`} />
        <View className="mt-2 border-t border-border-subtle pt-2">
          <Row label="문서 합계" value={`${total}건`} />
          <Row label="씨드 생성일" value={counts.seededOn} />
          <Row label="씨드 변경 여부" value={counts.dirty ? '변경됨 (자동 재씨딩 안 함)' : '원본 그대로'} />
        </View>
      </View>

      <View className="mt-4 flex-row gap-2">
        <Pressable
          onPress={reset}
          accessibilityRole="button"
          className="flex-1 items-center justify-center rounded-btn border border-danger px-4 py-4"
          testID="mock-reset"
        >
          <Text className="text-base font-w600 text-danger">데이터 초기화</Text>
        </Pressable>
        <Pressable
          onPress={refresh}
          accessibilityRole="button"
          className="items-center justify-center rounded-btn border border-border-strong px-4 py-4"
          testID="mock-refresh"
        >
          <Text className="text-base text-text-primary">다시 읽기</Text>
        </Pressable>
      </View>

      <View className="mt-8 rounded-card border border-border-subtle bg-bg-sunken p-4">
        <Text className="text-sm text-text-primary">목 모드에서 이렇게 동작합니다</Text>
        <Text className="mt-2 text-xs leading-5 text-text-secondary">
          1. 스캔 문서 유형은 무작위가 아니라 명함 → 포스터 → 영수증 → 티켓 순환입니다{'\n'}
          2. 3번에 1번은 저신뢰(0.55 미만)라 종류 선택 시트가 뜹니다{'\n'}
          3. 업로드는 2~4초 걸립니다 — 진행률 표시를 확인하기 위한 지연입니다{'\n'}
          4. 이미지 파일은 만들지 않습니다 (image_url 이 빈 문자열 → `이미지 없이 저장됨`){'\n'}
          5. 저장한 문서는 목 DB 에 쌓이고, 초기화하면 씨드 상태로 돌아갑니다{'\n'}
          6. 진단 화면(서버 연결)은 두 서버 모두 `목 모드` 문구로 정상 표시됩니다
        </Text>
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-sm text-text-muted">{label}</Text>
      <Text className="text-sm text-text-primary">{value}</Text>
    </View>
  );
}
