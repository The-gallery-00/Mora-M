import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearServerOverride,
  getApiBaseUrl,
  getOcrBaseUrl,
  hasServerOverride,
  setServerOverride,
  variant,
} from '@/config/env';
import { probeAll, type ProbeResult } from '@/services/health';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * SCR-31 — 서버 연결 · 진단 (FR-121, FR-122)
 *
 * APK 를 다시 빌드하지 않고 개발 PC 의 LAN IP 변경에 대응하기 위한 화면.
 * ADR-002 의 최대 리스크(IP 변동으로 앱이 서버를 못 찾음)를 사용자 손으로 복구할 수 있게 한다.
 *
 * 클래스명은 Design Tokens §13-1 확정 토큰만 쓴다. HEX 리터럴 0개 —
 * className 으로 표현 못 하는 색(스피너·플레이스홀더)은 useTheme() 에서 가져온다.
 */
export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl);
  const [ocrUrl, setOcrUrl] = useState(getOcrBaseUrl);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [net, setNet] = useState<string>('확인 중');
  const t = useTheme();

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (!state.isConnected) setNet('오프라인');
      else setNet(`${state.type}${state.isInternetReachable === false ? ' (인터넷 불가)' : ''}`);
    });
    return unsub;
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setServerOverride(apiUrl, ocrUrl);
    setApiUrl(getApiBaseUrl());
    setOcrUrl(getOcrBaseUrl());
    setResults(await probeAll());
    setRunning(false);
  }, [apiUrl, ocrUrl]);

  const reset = useCallback(async () => {
    clearServerOverride();
    setApiUrl(getApiBaseUrl());
    setOcrUrl(getOcrBaseUrl());
    setResults(null);
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-bg-base"
      contentContainerStyle={{
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 40,
        paddingHorizontal: 20,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-stat font-w700 text-text-primary">서버 연결 진단</Text>
      <Text className="mt-1 text-sm text-text-secondary">
        개발 PC 의 IP 가 바뀌면 여기서 주소만 고치면 됩니다. 앱을 다시 설치할 필요 없습니다.
      </Text>

      <View className="mt-6 rounded-card border border-border-subtle bg-bg-elevated p-4">
        <Row label="빌드 변형" value={variant} />
        <Row label="Expo SDK" value={String(Constants.expoConfig?.sdkVersion ?? '—')} />
        <Row label="네트워크" value={net} />
        <Row label="주소 오버라이드" value={hasServerOverride() ? '사용 중' : '없음 (빌드 기본값)'} />
      </View>

      <Field
        label="API 서버 (Spring)"
        hint="예: http://192.168.0.10:8080"
        value={apiUrl}
        onChange={setApiUrl}
      />
      <Field
        label="OCR 서버 (Python)"
        hint="예: http://192.168.0.10:8000"
        value={ocrUrl}
        onChange={setOcrUrl}
      />

      <View className="mt-6 flex-row gap-2">
        {/* loading 상태는 채움색 유지 + opacity 0.6 (Component Library §3-1 variant×state) */}
        <Pressable
          onPress={run}
          disabled={running}
          className={
            running
              ? 'flex-1 flex-row items-center justify-center rounded-btn bg-action px-4 py-4 opacity-60'
              : 'flex-1 flex-row items-center justify-center rounded-btn bg-action px-4 py-4'
          }
        >
          {running ? <ActivityIndicator color={t.text.inverse} /> : null}
          <Text className="ml-2 text-base text-text-inverse">
            {running ? '확인 중…' : '연결 확인'}
          </Text>
        </Pressable>
        <Pressable
          onPress={reset}
          className="items-center justify-center rounded-btn border border-border-strong px-4 py-4"
        >
          <Text className="text-text-primary">초기화</Text>
        </Pressable>
      </View>

      {results?.map((r) => (
        <ProbeCard key={r.target} result={r} />
      ))}

      {results && results.every((r) => r.status === 'ok') ? (
        // success 는 본문 텍스트 금지(라이트 3.30:1). 문구는 success.text 를 쓴다 (§10-3 결정)
        <Text className="mt-6 text-center text-sm text-success-text">
          두 서버 모두 정상입니다. Phase 0 종료 게이트 ② 통과.
        </Text>
      ) : null}

      <View className="mt-8 rounded-card border border-border-subtle bg-bg-sunken p-4">
        <Text className="text-sm text-text-primary">연결이 안 될 때 확인 순서</Text>
        <Text className="mt-2 text-xs leading-5 text-text-secondary">
          1. 폰과 PC 가 같은 Wi-Fi 인가 (게스트망 분리 주의){'\n'}
          2. PC 에서 Spring(:8080), OCR(:8000) 이 실제로 떠 있는가{'\n'}
          3. 두 서버가 127.0.0.1 이 아니라 0.0.0.0 에 바인딩됐는가{'\n'}
          4. Windows 방화벽 인바운드에서 8080 / 8000 이 허용됐는가{'\n'}
          5. PC 의 IP 가 바뀌지 않았는가 (ipconfig)
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

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();

  return (
    <View className="mt-5">
      <Text className="text-sm text-text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={hint}
        placeholderTextColor={t.text.disabled}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        className="mt-2 rounded-btn border border-border-strong bg-surface px-4 py-3 text-base text-text-primary"
      />
    </View>
  );
}

function ProbeCard({ result }: { result: ProbeResult }) {
  const ok = result.status === 'ok';
  const title = result.target === 'spring' ? 'API 서버 (Spring)' : 'OCR 서버 (Python)';

  return (
    <View
      className={
        ok
          ? 'mt-4 rounded-card border border-success bg-bg-elevated p-4'
          : 'mt-4 rounded-card border border-danger bg-bg-elevated p-4'
      }
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-base text-text-primary">{title}</Text>
        <Text className={ok ? 'text-sm text-success-text' : 'text-sm text-danger-strong'}>
          {ok ? '정상' : '실패'}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-text-muted">{result.url}</Text>
      <Text className="mt-2 text-sm text-text-primary">{result.detail}</Text>
      <Text className="mt-1 text-xs text-text-muted">
        HTTP {result.httpStatus ?? '—'}
        {result.latencyMs !== null ? ` · ${result.latencyMs}ms` : ''}
      </Text>
    </View>
  );
}
