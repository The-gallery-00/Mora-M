import Constants from 'expo-constants';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ThemeMode } from '@/store/themeStore';
import { useTheme, useThemeMode } from '@/theme/ThemeProvider';

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '시스템 따름' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/**
 * Phase 0 파이프라인 검증 화면 (개발 빌드 전용).
 * NativeWind 토큰 · 다크 전환 · 세이프에어리어 · Reanimated 워클릿 로드까지 한 번에 확인한다.
 *
 * Phase 2 에서 `app/index.tsx` 가 SCR-01 스플래시/세션 부트로 교체되면서 **라우트만 여기로 옮겼다**.
 * 내용은 그대로다. 접근 경로: `mora://(dev)/pipeline` 또는 SCR-31 진단 화면에서 이동.
 *
 * 다크모드 동결(THEME_DARK_ENABLED=false) 중에는 테마 3택을 눌러도 라이트로 고정된다 —
 * 세그먼트는 동결 해제 시 즉시 살아나도록 남겨 둔다.
 *
 * 클래스명은 Design Tokens §13-1 확정 토큰만 쓴다. HEX 리터럴 0개.
 */
export default function PipelineCheckScreen() {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { mode, setMode } = useThemeMode();

  return (
    <View
      className="flex-1 bg-bg-base px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-stat font-w700 text-text-primary">MORA Mobile</Text>
      <Text className="mt-1 text-base text-text-secondary">Phase 0 — 빌드 파이프라인 검증</Text>

      {/* 겹침이 없는 평면 카드는 그림자 대신 보더 우선 + elevation.flat (§8 규칙 6). */}
      <View className="mt-8 rounded-card border border-border-subtle bg-bg-elevated p-4">
        <Row label="Expo SDK" value={String(Constants.expoConfig?.sdkVersion ?? '—')} />
        <Row label="빌드 변형" value={String(Constants.expoConfig?.extra?.variant ?? '—')} />
        <Row label="적용 테마" value={t.scheme} />
        <Row label="NativeWind" value="토큰 적용됨" />
      </View>

      <Text className="mt-8 text-sm text-text-muted">테마</Text>
      <View className="mt-2 flex-row gap-2">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <Pressable
              key={m.value}
              onPress={() => setMode(m.value)}
              className={
                active
                  ? 'rounded-btn bg-action px-4 py-3'
                  : 'rounded-btn border border-border-strong px-4 py-3'
              }
            >
              <Text className={active ? 'text-text-inverse' : 'text-text-primary'}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-8 flex-row gap-2">
        <Swatch className="bg-brand" name="brand" />
        <Swatch className="bg-action" name="action" />
        <Swatch className="bg-success" name="success" />
        <Swatch className="bg-warn" name="warn" />
        <Swatch className="bg-danger" name="danger" />
        <Swatch className="bg-info" name="info" />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-text-secondary">{label}</Text>
      <Text className="text-text-primary">{value}</Text>
    </View>
  );
}

function Swatch({ className, name }: { className: string; name: string }) {
  return (
    <View className="items-center">
      <View className={`h-10 w-10 rounded-btn ${className}`} />
      <Text className="mt-1 text-[10px] text-text-muted">{name}</Text>
    </View>
  );
}
