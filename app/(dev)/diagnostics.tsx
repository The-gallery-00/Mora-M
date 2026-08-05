import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearServerOverride,
  getApiBaseUrl,
  getOcrBaseUrl,
  normalizeBaseUrl,
  setServerOverride,
  variant,
  willClearChangeApiHost,
} from '@/config/env';
import { isMockEnabled } from '@/mocks/config';
import {
  decideSpringAuth,
  getApiUrlSource,
  getOcrUrlSource,
  probeAll,
  springAuthLabel,
  URL_SOURCE_LABEL,
  type ProbeResult,
  type ProbeStatus,
  type SpringAuthMode,
} from '@/services/health';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * 인증 부착 규칙을 사용자 말로 옮긴 문구. 상태값별 한 문장씩만 둔다 —
 * 화면이 규칙을 다시 해석해서 문장을 조립하면 `services/health.ts` 의 판정과 갈라진다.
 * (판정 자체는 `decideSpringAuth`, 결과 한 줄 요약은 `springAuthLabel` 이 소유한다.)
 *
 * ⚠️ 2026-08-05 4차 — `withheld-untrusted` 문구가 **거짓이었다.**
 * "오타 난 호스트나 남의 호스트로 세션이 넘어가는 것을 막습니다" 라고 단언했지만, 종전 [연결 확인]
 * 은 프로브 전에 그 주소를 MMKV 에 영구 저장했고, 화면을 나가는 순간부터 명함첩·스캔 등 모든
 * 인증 요청이 그 호스트로 JWT 를 실어 보냈다(`services/http.ts:183-185`).
 * 프로브 1회만 막고 나머지 전부를 흘려보내면서 "막았다" 고 말한 셈이다.
 * → 실제 방어선은 이제 **저장 시점의 세션 파기**다(`config/env.ts` `setServerOverride`).
 *   이 문구들은 그 사실에 맞춰 다시 썼다. **이 요청 한 건에 대한 사실만** 말한다.
 */
const AUTH_INTRO: Record<SpringAuthMode, string> = {
  'sent-trusted':
    '빌드가 정한 주소라 로그인 토큰을 붙여 확인합니다 — 이때만 DB(Cloud SQL) 조회까지 검증됩니다.',
  'sent-user-approved':
    '직접 입력한 주소이지만 아래 스위치로 토큰 전송을 허용했습니다. 이 주소가 우리 서버가 맞는지 다시 확인해 주세요.',
  'withheld-untrusted':
    '지금 쓰는 주소는 이 화면에서 직접 입력해 저장한 값입니다. 이 프로브는 기본적으로 토큰을 붙이지 않습니다(대신 DB 경로는 검증되지 않습니다). 다만 이 상태로 로그인하면 명함첩·스캔 등 다른 요청은 모두 이 주소로 토큰을 보냅니다 — 주소를 바꿔 저장할 때 로그아웃되는 것이 실제 방어선입니다.',
  'withheld-no-token':
    '로그인 전이라 붙일 토큰이 없습니다. 무인증으로만 확인하므로 DB(Cloud SQL) 상태는 알 수 없습니다.',
};

/**
 * [저장]/[초기화] 직후 한 줄 알림. **저장이 일어나지 않은 경우까지 반드시 문장으로 남긴다** —
 * 침묵은 "저장됐겠지" 로 읽히고, 그러면 아래 프로브 결과가 무슨 주소를 잰 것인지 알 수 없다.
 *
 * `signedOut` 을 따로 들고 다니는 이유(2026-08-05): "로그아웃했습니다" 는 실제로 세션이 있던
 * 경우에만 참이다. 로그인 전 상태에서도 같은 문장을 띄우면, 라벨이 약속한 동작이 일어나지 않은
 * 또 하나의 거짓 신호가 된다. `apiSwitched` 도 같은 이유다 — OCR 주소만 바꾼 저장은 세션을
 * 건드리지 않으므로 그 사실을 그대로 적는다.
 */
type SaveNotice =
  | { kind: 'saved'; apiSwitched: boolean; signedOut: boolean }
  | { kind: 'cleared'; apiSwitched: boolean; signedOut: boolean }
  | { kind: 'unchanged' }
  | { kind: 'nothing-to-clear' }
  /** 어느 칸이 비었는지까지 적는다. 둘 다 비었는데 "한쪽이 비어 있어" 라고 말하면 안 된다. */
  | { kind: 'empty'; missing: 'api' | 'ocr' | 'both' };

const EMPTY_NOTICE: Record<'api' | 'ocr' | 'both', string> = {
  api: 'API 서버 주소가 비어 있습니다. 두 주소는 한 쌍으로만 저장되므로 아무것도 저장하지 않았습니다.',
  ocr: 'OCR 서버 주소가 비어 있습니다. 두 주소는 한 쌍으로만 저장되므로 아무것도 저장하지 않았습니다.',
  both: '두 칸이 모두 비어 있습니다. 아무것도 저장하지 않았습니다 — API·OCR 주소를 모두 입력해 주세요.',
};

function noticeText(notice: SaveNotice): string {
  switch (notice.kind) {
    case 'saved':
      if (notice.signedOut) {
        return '새 주소를 저장하고 로그인 세션을 파기했습니다. 새 서버에서 다시 로그인해 주세요. 되돌리려면 [초기화] 를 누르세요.';
      }
      if (notice.apiSwitched) {
        return '새 주소를 저장했습니다. (로그인 상태가 아니어서 파기할 세션은 없었습니다.) 되돌리려면 [초기화] 를 누르세요.';
      }
      return '새 주소를 저장했습니다. API 주소는 그대로고 OCR 주소만 바뀌었으므로 세션은 유지됩니다 — OCR 로 나가는 요청에는 로그인 토큰이 실리지 않기 때문입니다.';
    case 'cleared':
      if (notice.signedOut) {
        return '오버라이드를 지우고 빌드 기본 주소로 되돌렸습니다. 서버가 바뀌었으므로 로그인 세션도 파기했습니다.';
      }
      if (notice.apiSwitched) {
        return '오버라이드를 지우고 빌드 기본 주소로 되돌렸습니다. (로그인 상태가 아니어서 파기할 세션은 없었습니다.)';
      }
      return '오버라이드를 지웠습니다. API 주소는 결과적으로 같아서 세션은 유지됩니다.';
    case 'unchanged':
      return '입력한 주소가 지금 쓰는 주소와 같아 저장할 것이 없었습니다. 로그아웃도 하지 않았습니다.';
    case 'nothing-to-clear':
      return '저장된 오버라이드가 없어 지울 것이 없었습니다. 지금도 빌드 기본 주소를 쓰고 있습니다.';
    case 'empty':
      return EMPTY_NOTICE[notice.missing];
  }
}

/** 위험/주의 톤 구분. 저장 실패(=아무 일도 안 일어남)는 놓치면 안 되므로 danger 로 띄운다. */
function noticeClass(notice: SaveNotice): string {
  return notice.kind === 'empty' ? 'mt-3 text-xs text-danger-strong' : 'mt-3 text-xs text-warn';
}

/**
 * SCR-31 — 서버 연결 · 진단 (FR-121, FR-122)
 *
 * APK 를 다시 빌드하지 않고 개발 PC 의 LAN IP 변경에 대응하기 위한 화면.
 * ADR-002 의 최대 리스크(IP 변동으로 앱이 서버를 못 찾음)를 사용자 손으로 복구할 수 있게 한다.
 *
 * ── 2026-08-05 4차: [연결 확인] 과 [저장] 을 분리했다 ──────────────────────────
 * 종전 [연결 확인] 은 프로브를 돌리기 **전에** 입력값을 MMKV 에 영구 저장했다. 그래서
 * "확인만 해 보자" 는 동작이 앱의 서버 주소를 바꿔 버렸고, 그 뒤 모든 인증 요청이 새 주소로
 * JWT 를 실어 나갔다. 화면은 프로브 한 건에 토큰을 안 붙였다는 이유로 "세션이 넘어가는 것을
 * 막습니다" 라고 단언했다 — 막지 못했다.
 *
 * 그래서 이 화면의 규칙은 이제 셋이다:
 *  1. **[연결 확인] 은 아무것도 쓰지 않는다.** 언제나 "지금 유효한 주소" 만 잰다.
 *  2. **저장은 명시적 [저장] + 확인 대화상자**다. API 주소가 바뀌면 그 자리에서 로그아웃한다
 *     (`config/env.ts` 가 토큰 정본을 지우고, 여기서 스토어·캐시까지 정리한다).
 *  3. 입력칸이 저장된 주소와 다르면 **그 사실을 상시 노출**한다. 무엇을 쟀는지 헷갈리게
 *     만드는 것이 이 화면 최악의 실패다.
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
  const [saving, setSaving] = useState(false);
  const [net, setNet] = useState<string>('확인 중');
  /** 직전 [저장]/[초기화] 가 실제로 무엇을 했는지 (`SaveNotice` 주석 참조). */
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  /**
   * 세션 상태를 **구독**한다. 저장이 로그아웃을 일으키면 `decideSpringAuth` 의 판정이
   * `withheld-no-token` 으로 바뀌는데, 구독하지 않으면 이 화면이 다시 그려지지 않아
   * "토큰을 붙입니다" 라는 옛 미리보기가 그대로 남는다 — 표시와 동작이 갈라지는 순간이다.
   */
  const signedIn = useAuthStore((s) => s.status === 'authenticated');
  const signOut = useAuthStore((s) => s.signOut);
  /**
   * "이 주소로 로그인 토큰(JWT)을 보내도 된다" 는 **명시적 옵트인**. 기본은 꺼짐이다.
   *
   * 프로브가 때리는 주소는 **저장된 오버라이드**일 수 있다 — 즉 언젠가 사람이 손으로 넣은
   * 호스트다. 거기에 세션 토큰을 자동으로 얹지 않는다. 그렇다고 영영 안 붙이면 Spring 프로브가
   * DB 경로를 검증할 수단을 잃는다 (무인증 `GET /auth/me` 는 DB 를 거치지 않고 401 을 낸다
   * — `services/health.ts` 머리말). → 빌드가 정한 주소에는 자동으로 붙이고,
   * **오버라이드 주소에만** 이 스위치를 요구한다.
   *
   * ⚠️ 이 스위치는 **세션 유출을 막는 장치가 아니다.** 이 프로브 한 건에만 적용된다 —
   * 오버라이드가 걸린 상태로 로그인하면 다른 모든 요청은 어차피 그 주소로 토큰을 보낸다.
   * 세션을 지키는 것은 저장 시점의 로그아웃이다(`config/env.ts` `setServerOverride`).
   * 이 구분을 뭉갠 문구가 4차에서 잡힌 거짓 안심 문구였다.
   *
   * MMKV 에 저장하지 않는다. 화면을 나갔다 오면 다시 꺼진 상태로 시작해야
   * "예전에 켜 둔 걸 잊고 새 호스트를 넣는" 사고가 생기지 않는다.
   */
  const [allowOverrideAuth, setAllowOverrideAuth] = useState(false);
  const t = useTheme();

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (!state.isConnected) setNet('오프라인');
      else setNet(`${state.type}${state.isInternetReachable === false ? ' (인터넷 불가)' : ''}`);
    });
    return unsub;
  }, []);

  /**
   * [연결 확인] — **아무것도 저장하지 않는다.** 지금 유효한 주소(`getApiBaseUrl()`)만 잰다.
   *
   * 입력칸의 값은 여기서 쓰이지 않는다. 저장 전 입력을 프로브 대상으로 삼으려면 그 주소를
   * 어디선가 유효 주소로 취급해야 하는데, 그 순간 "무엇을 쟀는가" 가 다시 흐려진다.
   * 입력이 저장값과 다르면 아래 `unsaved` 배너가 그 사실을 상시로 말해 준다.
   */
  const run = useCallback(async () => {
    setRunning(true);
    // 인증 옵트인은 미리보기 `authPreview` 와 **같은 판정 함수**로 흘러간다 (`decideSpringAuth`).
    setResults(await probeAll({ allowOverrideAuth }));
    setRunning(false);
  }, [allowOverrideAuth]);

  /**
   * 저장/해제 공통 마무리. 순서가 중요하다:
   *  1. `config/env.ts` 가 **토큰 정본(SecureStore)을 먼저 지우고** 주소를 쓴다.
   *  2. 여기서 `signOut()` 으로 스토어 상태·React Query 캐시·이미지 캐시까지 정리한다.
   * 1 이 실패하면 주소도 안 바뀌고, 2 가 실패해도 토큰은 이미 없다 — 어느 쪽으로 깨져도
   * 유효한 세션이 새 주소를 향해 남아 있는 상태는 만들어지지 않는다.
   *
   * `signOut()` 은 `expiredNotice` 를 세우지 않으므로 루트의 세션 만료 이펙트가 우리를
   * 로그인 화면으로 밀어내지 않는다(`app/_layout.tsx` `SessionBootstrap`) — 저장한 주소를
   * 바로 [연결 확인] 으로 확인할 수 있어야 하므로 그 동작이 맞다. 탭으로 돌아가면
   * `(tabs)/_layout` 가드가 로그인 화면으로 보낸다.
   */
  const afterAddressChange = useCallback(
    async (apiSwitched: boolean, wasSignedIn: boolean) => {
      if (apiSwitched) await signOut();
      setApiUrl(getApiBaseUrl());
      setOcrUrl(getOcrBaseUrl());
      // 결과는 **이전 주소**를 잰 값이다. 주소가 바뀐 화면에 그대로 두면 새 서버의 상태로 읽힌다.
      setResults(null);
      // 옵트인은 "그때 그 주소" 에 대한 허가였다. 주소가 바뀌었으면 허가도 회수한다.
      setAllowOverrideAuth(false);
      return { apiSwitched, signedOut: apiSwitched && wasSignedIn };
    },
    [signOut],
  );

  /**
   * [저장] — 입력한 주소를 오버라이드로 영구 저장한다. **여기가 유일한 저장 경로**다.
   *
   * API 주소가 바뀌면 로그아웃을 동반하므로, 그 사실을 **저장 전에** 대화상자로 알린다.
   * 문구는 실제 동작과 1:1 이어야 한다 — 로그인 상태가 아니거나 OCR 주소만 바뀌는 경우에는
   * 로그아웃을 예고하지 않는다(그 경우 실제로 로그아웃하지 않는다).
   */
  const save = useCallback(() => {
    const nextApi = normalizeBaseUrl(apiUrl);
    const nextOcr = normalizeBaseUrl(ocrUrl);
    if (!nextApi || !nextOcr) {
      setSaveNotice({
        kind: 'empty',
        missing: !nextApi && !nextOcr ? 'both' : !nextApi ? 'api' : 'ocr',
      });
      return;
    }
    if (nextApi === getApiBaseUrl() && nextOcr === getOcrBaseUrl()) {
      setSaveNotice({ kind: 'unchanged' });
      return;
    }

    const apiSwitched = nextApi !== getApiBaseUrl();
    const wasSignedIn = signedIn;
    const body = apiSwitched
      ? `API 주소가 ${getApiBaseUrl()} 에서 ${nextApi} 로 바뀝니다.\n\n저장한 뒤에는 명함첩·스캔 등 모든 요청이 이 주소로 나가고 로그인 토큰도 함께 실립니다. 그래서 저장하는 순간 ${
          wasSignedIn ? '지금 로그인 세션을 파기합니다(로그아웃됩니다).' : '기존 로그인 세션을 파기합니다.'
        } 새 서버에서 다시 로그인해 주세요.`
      : `OCR 주소만 ${getOcrBaseUrl()} 에서 ${nextOcr} 로 바뀝니다. OCR 요청에는 로그인 토큰이 실리지 않으므로 세션은 유지됩니다.`;

    Alert.alert(apiSwitched ? '서버 주소를 바꾸고 로그아웃할까요?' : 'OCR 주소를 바꿀까요?', body, [
      { text: '취소', style: 'cancel' },
      {
        text: '저장',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            // 로그인 여부는 **누른 시점**에 다시 읽는다. 대화상자가 떠 있는 사이에 세션이
            // 만료됐다면 "로그아웃했습니다" 는 더 이상 사실이 아니다.
            const hadSession = useAuthStore.getState().status === 'authenticated';
            // 반환값이 실제 세션 파기 여부다. 화면 문구는 이 값만 따른다 —
            // 화면이 따로 계산하면 "로그아웃했습니다" 가 사실과 어긋날 수 있다.
            const cleared = await setServerOverride(nextApi, nextOcr);
            const notice = await afterAddressChange(cleared, hadSession);
            setSaveNotice({ kind: 'saved', ...notice });
            setSaving(false);
          })();
        },
      },
    ]);
  }, [afterAddressChange, apiUrl, ocrUrl, signedIn]);

  /** [초기화] — 오버라이드를 지우고 빌드 기본 주소로 되돌린다. 이것도 주소 교체라 같은 규칙이다. */
  const reset = useCallback(() => {
    if (getApiUrlSource() !== 'override' && getOcrUrlSource() !== 'override') {
      setSaveNotice({ kind: 'nothing-to-clear' });
      return;
    }

    const apiSwitches = willClearChangeApiHost();
    const wasSignedIn = signedIn;
    const body = apiSwitches
      ? `API 주소가 ${getApiBaseUrl()} 에서 빌드 기본값으로 되돌아갑니다. 서버가 바뀌므로 ${
          wasSignedIn ? '지금 로그인 세션을 파기합니다(로그아웃됩니다).' : '기존 로그인 세션을 파기합니다.'
        }`
      : '저장된 오버라이드를 지웁니다. 결과적으로 API 주소는 같아서 세션은 유지됩니다.';

    Alert.alert(apiSwitches ? '빌드 기본 주소로 되돌리고 로그아웃할까요?' : '오버라이드를 지울까요?', body, [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            // [저장] 과 같은 이유로 누른 시점의 세션 상태를 다시 읽는다.
            const hadSession = useAuthStore.getState().status === 'authenticated';
            const cleared = await clearServerOverride();
            const notice = await afterAddressChange(cleared, hadSession);
            setSaveNotice({ kind: 'cleared', ...notice });
            setSaving(false);
          })();
        },
      },
    ]);
  }, [afterAddressChange, signedIn]);

  /**
   * 주소 입력이 바뀌면 인증 옵트인을 끄고, 직전 저장 알림도 지운다.
   *
   * 옵트인은 "내가 지금 보고 있는 이 주소로 토큰을 보내도 된다" 는 뜻이지, 이 화면에 머무는 동안
   * 무엇을 입력하든 보내도 된다는 뜻이 아니다. (지금은 [연결 확인] 이 저장된 주소만 재므로
   * 입력 변경이 프로브 대상을 바꾸지는 않지만, 스위치는 "내가 승인한 주소" 에 묶여 있어야 한다.)
   *
   * 알림을 지우는 이유: `empty`/`unchanged` 같은 문구는 **그때의 입력**에 대한 판정이라
   * 입력이 바뀐 뒤에도 남아 있으면 사실과 어긋난다.
   */
  const changeApiUrl = useCallback((v: string) => {
    setApiUrl(v);
    setAllowOverrideAuth(false);
    setSaveNotice(null);
  }, []);

  const changeOcrUrl = useCallback((v: string) => {
    setOcrUrl(v);
    setAllowOverrideAuth(false);
    setSaveNotice(null);
  }, []);

  /**
   * [연결 확인] 을 지금 누르면 Spring 프로브가 토큰을 붙일지 미리 판정한다.
   * 프로브가 재는 대상은 **언제나 지금 유효한 주소**이므로 미리보기도 그 주소로만 판정한다
   * (종전에는 "저장된 뒤의 출처" 를 흉내 내야 했다 — 저장을 분리하면서 그 보정이 사라졌다).
   */
  const targetApiUrl = getApiBaseUrl();
  const authPreview = decideSpringAuth(allowOverrideAuth);
  /** 스위치를 보여 줄 필요가 있는 상태인가. 빌드 주소만 쓸 때는 선택지 자체가 없다. */
  const authOptInApplies =
    authPreview === 'withheld-untrusted' || authPreview === 'sent-user-approved';

  /**
   * 입력칸이 **저장된 주소와 다른가.** 다르면 [연결 확인] 결과는 입력한 주소가 아니라
   * 저장된 주소를 잰 것이므로 그 사실을 상시로 알린다 — 이 화면 최악의 실패는
   * "무엇을 쟀는지 착각하게 만드는 것" 이다. (빈 칸도 다름으로 친다.)
   */
  const unsaved =
    normalizeBaseUrl(apiUrl) !== getApiBaseUrl() || normalizeBaseUrl(ocrUrl) !== getOcrBaseUrl();
  const busy = running || saving;

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
        {'\n'}
        [연결 확인] 은 저장하지 않습니다. [주소 저장] 으로 API 주소를 바꾸면 앱이 다른 서버를 보게
        되므로 로그인 세션은 그 자리에서 파기됩니다.
      </Text>

      <View className="mt-6 rounded-card border border-border-subtle bg-bg-elevated p-4">
        <Row label="빌드 변형" value={variant} />
        <Row label="Expo SDK" value={String(Constants.expoConfig?.sdkVersion ?? '—')} />
        <Row label="네트워크" value={net} />
        {/* 오버라이드 여부의 기준을 **아래 `출처:` 줄과 하나로 통일한다** (2026-08-05).
            종전에는 이 줄이 `hasServerOverride()`(= MMKV `contains`), 아래가 `getApiUrlSource()`
            (= `getString` truthiness)를 써서 기준이 갈렸다. 키에 빈 문자열이 남아 있으면
            `contains` 만 true 가 되어 같은 화면에서 "사용 중" 과 "출처: 빌드 주입" 이 동시에 떴다.
            정본은 `config/env.ts` 의 `getApiBaseUrl()` 이고 그쪽은 `if (override)` 로 판단하므로,
            **실제로 요청이 나가는 주소를 결정하는 쪽**인 truthiness 기준을 택한다. */}
        <Row
          label="주소 오버라이드"
          value={getApiUrlSource() === 'override' ? '사용 중' : '없음 (빌드 기본값)'}
        />
      </View>

      {/* 주소 밑에 출처를 같이 적는다. 주소만 봐서는 그게 남아 있는 오버라이드인지
          빌드 기본값인지 알 수 없고, 그 구분이 안 돼서 이번 OOM 조사가 길어졌다. */}
      <Field
        label="API 서버 (Spring)"
        hint="예: http://192.168.0.10:8080"
        sub={`출처: ${URL_SOURCE_LABEL[getApiUrlSource()]}`}
        value={apiUrl}
        onChange={changeApiUrl}
      />
      <Field
        label="OCR 서버 (Python)"
        hint="예: http://192.168.0.10:8000"
        sub={`출처: ${URL_SOURCE_LABEL[getOcrUrlSource()]}`}
        value={ocrUrl}
        onChange={changeOcrUrl}
      />

      {/* ── 인증 포함 여부 (2026-08-05) ─────────────────────────────────────
          이 화면은 "임의의 호스트에 요청을 보내는 화면" 이다. 그 요청에 로그인 토큰이
          실리는지 아닌지는 **누르기 전에** 보여야 한다. 결과 카드에도 같은 문장이 남는다. */}
      <View className="mt-5 rounded-card border border-border-subtle bg-bg-sunken p-4">
        <Text className="text-sm text-text-primary">API 프로브 인증</Text>
        <Text className="mt-1 text-xs leading-5 text-text-secondary">{AUTH_INTRO[authPreview]}</Text>
        {authOptInApplies ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: allowOverrideAuth }}
            accessibilityLabel="이 주소로 로그인 토큰 전송"
            onPress={() => setAllowOverrideAuth((prev) => !prev)}
            className="mt-3 flex-row items-center justify-between rounded-btn border border-border-strong px-3 py-3"
          >
            <Text className="flex-1 pr-3 text-sm text-text-primary">
              이 주소로 로그인 토큰 전송
            </Text>
            {/* 스위치 컴포넌트가 디자인 시스템에 없어 텍스트 상태로 표시한다.
                `켬/끔` 대신 실제 동작을 적어 라벨과 동작이 어긋날 여지를 없앤다. */}
            <Text className={allowOverrideAuth ? 'text-sm text-warn' : 'text-sm text-text-muted'}>
              {allowOverrideAuth ? '보냄' : '보내지 않음'}
            </Text>
          </Pressable>
        ) : null}
        {/* 실제로 무슨 일이 일어나는지 한 문장. 평문(HTTP) 여부도 여기서 드러난다. */}
        <Text className="mt-2 text-xs text-text-muted">
          {springAuthLabel(authPreview, targetApiUrl)}
        </Text>
      </View>

      {/* 입력이 저장값과 다르면 **누르기 전에** 그 사실을 말한다. 이 배너가 없으면
          [연결 확인] 결과를 "방금 입력한 주소의 상태" 로 읽게 된다. */}
      {unsaved ? (
        <Text className="mt-5 text-xs leading-5 text-warn">
          입력한 주소는 아직 저장되지 않았습니다. [연결 확인] 은 언제나 지금 저장된 주소를 잽니다 —
          입력한 주소를 확인하려면 먼저 [주소 저장] 을 누르세요. (저장은 API 주소가 바뀌면 로그아웃을
          동반합니다.)
        </Text>
      ) : null}

      <View className="mt-4">
        {/* loading 상태는 채움색 유지 + opacity 0.6 (Component Library §3-1 variant×state) */}
        <Pressable
          onPress={run}
          disabled={busy}
          className={
            busy
              ? 'flex-row items-center justify-center rounded-btn bg-action px-4 py-4 opacity-60'
              : 'flex-row items-center justify-center rounded-btn bg-action px-4 py-4'
          }
        >
          {running ? <ActivityIndicator color={t.text.inverse} /> : null}
          <Text className="ml-2 text-base text-text-inverse">
            {running ? '확인 중…' : '연결 확인 (저장하지 않음)'}
          </Text>
        </Pressable>

        {/* 저장은 별도 동작이다. 확인 대화상자에서 로그아웃 여부까지 알린 뒤에만 쓴다. */}
        <View className="mt-2 flex-row gap-2">
          <Pressable
            onPress={save}
            disabled={busy}
            className={
              busy
                ? 'flex-1 items-center justify-center rounded-btn border border-border-strong px-4 py-4 opacity-60'
                : 'flex-1 items-center justify-center rounded-btn border border-border-strong px-4 py-4'
            }
          >
            <Text className="text-text-primary">주소 저장</Text>
          </Pressable>
          <Pressable
            onPress={reset}
            disabled={busy}
            className={
              busy
                ? 'flex-1 items-center justify-center rounded-btn border border-border-strong px-4 py-4 opacity-60'
                : 'flex-1 items-center justify-center rounded-btn border border-border-strong px-4 py-4'
            }
          >
            <Text className="text-text-primary">초기화</Text>
          </Pressable>
        </View>
      </View>

      {/* 직전 [저장]/[초기화] 가 **실제로 무엇을 했는지**. 아무 일도 일어나지 않은 경우까지
          문장으로 남긴다 — 침묵은 "됐겠지" 로 읽힌다. 문구 소유자는 `noticeText` 하나뿐이다. */}
      {saveNotice ? (
        <Text className={noticeClass(saveNotice)}>{noticeText(saveNotice)}</Text>
      ) : null}

      {results?.map((r) => (
        <ProbeCard key={r.target} result={r} />
      ))}

      {/* 목 모드에서는 mockProbe 가 무조건 'ok' 를 주므로 이 문구를 띄우면 안 된다 —
          아무것도 검사하지 않은 채로 "추론까지 통과" 라고 말하는 꼴이 된다.
          `every(status === 'ok')` 라 Spring 이 'reachable'(도달만 확인)이면 이 올클리어는 뜨지 않는다.
          그게 의도다 — DB 를 확인하지 못한 상태에서 "모두 정상" 을 내는 것이 이 화면의 고질병이었다. */}
      {results && !isMockEnabled() && results.every((r) => r.status === 'ok') ? (
        // success 는 본문 텍스트 금지(라이트 3.30:1). 문구는 success.text 를 쓴다 (§10-3 결정)
        <Text className="mt-6 text-center text-sm text-success-text">
          두 서버 모두 정상입니다. OCR 은 추론 셀프테스트까지, Spring 은 인증 조회(DB 사용자 조회)까지
          통과했습니다.
        </Text>
      ) : null}

      <View className="mt-8 rounded-card border border-border-subtle bg-bg-sunken p-4">
        <Text className="text-sm text-text-primary">연결이 안 될 때 확인 순서 (LAN 모드)</Text>
        <Text className="mt-2 text-xs leading-5 text-text-secondary">
          1. 폰과 PC 가 같은 Wi-Fi 인가 (게스트망 분리 주의){'\n'}
          2. PC 에서 Spring(:8080), OCR(:8000) 이 실제로 떠 있는가{'\n'}
          3. 두 서버가 127.0.0.1 이 아니라 0.0.0.0 에 바인딩됐는가{'\n'}
          4. Windows 방화벽 인바운드에서 8080 / 8000 이 허용됐는가{'\n'}
          5. PC 의 IP 가 바뀌지 않았는가 (ipconfig)
        </Text>
        <Text className="mt-3 text-sm text-text-primary">Cloud Run 을 볼 때</Text>
        <Text className="mt-2 text-xs leading-5 text-text-secondary">
          첫 요청은 콜드스타트라 스캔 경로 실측 18~33초가 걸리고, OCR `/health` 는 그 위에 추론
          셀프테스트가 더 붙는다. 위 지연시간이 그 범위면 정상이다.{'\n'}
          `OCR 불가`/`구버전` 은 네트워크 문제가 아니라 서버 문제다 — Cloud Run 로그를 봐야 한다.
          {'\n'}
          `도달만 확인` 은 Spring 프로세스까지만 닿았다는 뜻이다. 로그인한 상태로 다시 눌러야 DB
          조회까지 검증된다 — 저장/불러오기가 안 되는 증상이면 Cloud SQL 을 확인한다.
          {'\n'}
          주소가 오버라이드면 로그인만으로는 부족하다. 위 [이 주소로 로그인 토큰 전송] 도 켜야 토큰이
          실리고, 그래야 DB 경로가 검증된다.
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
  sub,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  /** 라벨 옆 보조 문구. 여기서는 이 주소가 어디서 왔는지(출처)를 적는다. */
  sub: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();

  return (
    <View className="mt-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-text-muted">{label}</Text>
        <Text className="text-xs text-text-muted">{sub}</Text>
      </View>
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

/**
 * 상태 뱃지 문구. `실패` 한 단어로 뭉치면 "네트워크가 안 되나 보다" 로 읽혀서
 * 원인이 서버라는 사실이 가려진다. 상태값마다 다르게 적어 원인 방향을 바로 준다.
 */
const STATUS_LABEL: Record<ProbeStatus, string> = {
  ok: '정상',
  // '정상' 과 절대 같은 단어를 쓰지 않는다. 이 상태의 존재 이유가 "정상이라고 단정할 수 없음" 이다.
  reachable: '도달만 확인',
  degraded: 'OCR 불가',
  'stale-server': '구버전',
  'wrong-server': '다른 서버',
  unreachable: '연결 불가',
  timeout: '타임아웃',
  // 'error' 는 여기 있었지만 `services/health.ts` 가 그 상태를 만드는 경로가 없었다(죽은 라벨).
  // 상태값 자체를 지웠으므로 이 표도 함께 줄인다 — Record 타입이라 빠뜨리면 tsc 가 잡아 준다.
};

/**
 * 초록/노랑/빨강 3단. 노랑(warn)은 **서버에 닿았는데 서버가 문제**인 상태 전용이다 —
 * 이 두 칸이 예전에는 초록으로 칠해졌고, 그래서 진단 화면이 장애 내내 올클리어를 냈다.
 */
function toneOf(status: ProbeStatus): 'ok' | 'warn' | 'bad' {
  if (status === 'ok') return 'ok';
  // 'reachable' 도 노랑이다. 초록으로 칠하면 DB 장애에 올클리어를 내고(이 화면의 고질병),
  // 빨강으로 칠하면 멀쩡한 서버를 로그인 전마다 장애로 신고한다.
  if (status === 'reachable' || status === 'degraded' || status === 'stale-server') return 'warn';
  return 'bad';
}

const CARD_CLASS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'mt-4 rounded-card border border-success bg-bg-elevated p-4',
  warn: 'mt-4 rounded-card border border-warn-border bg-bg-elevated p-4',
  bad: 'mt-4 rounded-card border border-danger bg-bg-elevated p-4',
};

// success 는 본문 텍스트 금지(라이트 3.30:1) → success.text 를 쓴다 (§10-3 결정).
// warn.base / danger.strong 은 본문 대비를 만족해 그대로 쓴다.
const BADGE_CLASS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-sm text-success-text',
  warn: 'text-sm text-warn',
  bad: 'text-sm text-danger-strong',
};

function ProbeCard({ result }: { result: ProbeResult }) {
  const tone = toneOf(result.status);
  const title = result.target === 'spring' ? 'API 서버 (Spring)' : 'OCR 서버 (Python)';

  return (
    <View className={CARD_CLASS[tone]}>
      <View className="flex-row items-center justify-between">
        <Text className="text-base text-text-primary">{title}</Text>
        <Text className={BADGE_CLASS[tone]}>{STATUS_LABEL[result.status]}</Text>
      </View>
      {/* 실제로 때린 URL 과 그 출처. 폴백이 일어나면 url 도 /health 가 아니라 / 로 찍힌다. */}
      <Text className="mt-1 text-xs text-text-muted">{result.url}</Text>
      <Text className="mt-0.5 text-xs text-text-muted">
        출처: {URL_SOURCE_LABEL[result.source]}
      </Text>
      {/* 이 요청에 로그인 토큰이 실렸는지. 프로브가 실제 헤더를 만들면서 같이 정한 값이라
          표시와 동작이 갈라질 수 없다. OCR·목 프로브는 토큰을 다루지 않으므로 null → 줄 없음.
          이 줄이 없으면 'ok'/'도달만 확인' 이 어떤 조건에서 나온 판정인지 알 수 없다. */}
      {result.auth !== null ? (
        <Text className="mt-0.5 text-xs text-text-muted">
          {springAuthLabel(result.auth, result.url)}
        </Text>
      ) : null}
      <Text className="mt-2 text-sm text-text-primary">{result.detail}</Text>
      <Text className="mt-1 text-xs text-text-muted">
        HTTP {result.httpStatus ?? '—'}
        {result.latencyMs !== null ? ` · 왕복 ${result.latencyMs}ms` : ''}
        {/* 서버가 스스로 잰 추론 시간. 왕복과 크게 벌어지면 그 차이가 콜드스타트/네트워크다.
            `/health` 는 TTL 캐시가 적중하면 셀프테스트를 다시 돌리지 않고 예전 값에
            `cached:true` 를 붙여 준다. 그 사실을 적지 않으면 묵은 숫자가
            "지금 잰 추론 시간" 으로 읽힌다 — 재배포 직후 확인에서 특히 위험하다.
            **초 단위 숫자는 적지 않는다**: TTL 이 성공 30초 / 실패 5초로 달라서
            "최대 30초 전" 은 503 캐시에 대해 거짓이 된다 (health.ts ProbeResult 주석). */}
        {result.serverLatencyMs !== null
          ? ` · 서버 추론 ${result.serverLatencyMs}ms${
              result.serverLatencyCached ? ' (서버 캐시 값)' : ''
            }`
          : ''}
      </Text>
    </View>
  );
}
