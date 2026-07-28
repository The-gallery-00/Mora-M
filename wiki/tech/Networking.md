# Networking

APK가 개발 PC의 Spring(:8080)·OCR(:8000)에 LAN으로 붙는 전체 절차, 환경 프로파일 3종, cleartext HTTP 정책, 오프라인·재시도·타임아웃 규약.

상위: [[Architecture]]
관련: [[API Contract]] · [[Auth]] · [[APK Build]] · [[Offline and State]] · [[Camera and Scan]] · [[Risks]] · [[ADR-002 Backend Connectivity]]

---

## 1. LAN IP 연결 셋업 (개발 PC ↔ 실기기 APK)

### 1-0. 전제 사실 (확인 완료 — 변경 불필요한 항목)

| 항목 | 현재 상태 | 근거 |
|---|---|---|
| Spring 바인딩 | **이미 전체 인터페이스(0.0.0.0)** | `application.yml`에 `server.address`가 없다 → Spring Boot 기본값이 all-interfaces |
| OCR 바인딩 | **이미 `--host 0.0.0.0`** | 원본: `start.bat` — `uvicorn app:app --host 0.0.0.0 --port 8000 --reload` |
| LLM 바인딩 | 이미 `0.0.0.0:8001` (앱은 직접 호출하지 않음) | 원본: `start.bat` |
| CORS | Spring `allowedOriginPatterns=["*"]`, OCR/LLM `allow_origins=["*"]` | **네이티브 앱에는 CORS가 적용되지 않는다.** 신경 쓸 필요 없음 |

**따라서 서버 측에서 바꿀 것은 없다. 남는 작업은 (a) IP 확인 (b) Windows 방화벽 (c) 앱 환경변수 (d) 검증 4단계뿐이다.**

### 1-1. Step 1 — 개발 PC의 LAN IPv4 확인

```powershell
# 기본 게이트웨이가 있는 인터페이스의 IPv4만 뽑는다 (VirtualBox/WSL 가상 어댑터 제외)
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } |
  Select-Object InterfaceAlias, @{n='IPv4';e={$_.IPv4Address.IPAddress}}
```

```powershell
# 간단 버전
ipconfig | Select-String -Pattern "IPv4"
```

출력 예: `Wi-Fi  192.168.0.10`. 이 값을 `<LAN_IP>`라 한다.

**주의 2가지**
1. **`172.x`/`192.168.56.x`는 대개 WSL·Docker·VirtualBox 가상 어댑터다.** 폰에서 접근 불가. 위 명령처럼 게이트웨이가 있는 인터페이스만 골라야 한다.
2. **DHCP라서 재부팅·AP 재접속 시 IP가 바뀐다.** 공유기에서 이 PC의 MAC에 **DHCP 고정 할당(예약)** 을 걸어두는 것을 권장한다. 그게 어려우면 §3-4의 앱 내 런타임 오버라이드로 대응한다.

### 1-2. Step 2 — 네트워크 프로필을 Private로

Windows 방화벽 규칙은 프로필(Domain/Private/Public)별로 적용된다. 공용(Public)으로 잡혀 있으면 인바운드가 대부분 막힌다.

```powershell
Get-NetConnectionProfile
# NetworkCategory 가 Public 이면 Private 으로 변경 (관리자 PowerShell)
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

### 1-3. Step 3 — 인바운드 방화벽 규칙 추가 (관리자 PowerShell)

```powershell
New-NetFirewallRule -DisplayName "MORA Spring 8080" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "MORA OCR 8000" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
```

netsh를 쓰는 경우:
```bat
netsh advfirewall firewall add rule name="MORA Spring 8080" dir=in action=allow protocol=TCP localport=8080 profile=private
netsh advfirewall firewall add rule name="MORA OCR 8000"   dir=in action=allow protocol=TCP localport=8000 profile=private
```

**이미 존재하는 차단 규칙부터 확인한다.** java.exe/python.exe 최초 실행 시 뜬 Windows 방화벽 팝업에서 "취소"를 누르면 **차단 규칙이 자동 생성**되어 있고, 위에서 만든 허용 규칙보다 우선한다.

```powershell
Get-NetFirewallRule -Direction Inbound -Action Block |
  Where-Object { $_.DisplayName -match 'java|python|uvicorn' } |
  Select-Object DisplayName, Profile, Enabled
# 발견되면 제거
# Remove-NetFirewallRule -DisplayName "<위에서 나온 이름>"
```

정리(작업 종료 후):
```powershell
Remove-NetFirewallRule -DisplayName "MORA Spring 8080","MORA OCR 8000"
```

### 1-4. Step 4 — PC에서 자기 LAN IP로 도달 확인

```powershell
# 리슨 상태 확인 — 0.0.0.0:8080 / 0.0.0.0:8000 이어야 한다 (127.0.0.1 만 있으면 안 됨)
netstat -ano | Select-String -Pattern ":8080|:8000" | Select-String "LISTENING"

# OCR 헬스체크 (API-65) — 고정 응답이라 판정이 확실하다
curl.exe http://<LAN_IP>:8000/
# 기대: {"service":"MORA OCR Service","version":"3.0","docs":"/docs"}

# Spring 도달 확인 — 토큰 없이 부르면 401 + JSON 이 정상 응답이다
curl.exe -i http://<LAN_IP>:8080/auth/me
# 기대: HTTP/1.1 401 ... {"success":false,"error":"Token required"}
```

`curl`이 여기서 실패하면 앱 문제가 아니라 방화벽/바인딩 문제다. 앱을 건드리기 전에 이 단계를 통과시킨다.

### 1-5. Step 5 — 폰에서 도달 확인

1. 폰과 PC가 **같은 Wi-Fi(같은 서브넷)** 인지 확인한다. 게스트 네트워크·AP 격리(client isolation)가 켜져 있으면 절대 안 된다.
2. 폰 브라우저에서 `http://<LAN_IP>:8000/` 접속 → OCR JSON이 보이면 통과.
3. `http://<LAN_IP>:8080/swagger-ui.html` 도 열린다(springdoc가 permitAll). 계약 확인용으로 유용하다.

### 1-6. Step 6 — 앱 환경변수 설정

```bash
# .env.development  (프로젝트 루트, git 커밋 금지)
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080
EXPO_PUBLIC_OCR_URL=http://192.168.0.10:8000
EXPO_PUBLIC_PROFILE=dev-lan
```

`EXPO_PUBLIC_` 접두사가 붙은 변수만 클라이언트 번들에 주입된다. **이 값들은 APK 안에 평문으로 들어가므로 비밀을 담지 않는다.**

### 1-7. Step 7 — 앱 내 연결 진단 화면 (개발 빌드 전용)

**결정 — 설정 화면 하단에 개발 빌드에서만 보이는 "연결 진단" 항목을 만든다.** 근거: LAN 개발에서 실패 원인이 IP/방화벽/서브넷/서버미기동 4가지로 갈리는데, 앱이 "서버에 연결할 수 없습니다"만 띄우면 팀원이 원인을 못 좁힌다.

| 진단 항목 | 방법 | 실패 시 안내 |
|---|---|---|
| 현재 프로파일·baseURL 표시 | `API_BASE` / `OCR_BASE` 문자열 | — |
| Wi-Fi 연결 여부 | NetInfo `type === 'wifi'` | `Wi-Fi에 연결해 주세요. 셀룰러로는 개발 서버에 접속할 수 없습니다.` |
| OCR 도달 (API-65) | `GET {OCR_BASE}/` 3초 타임아웃 | `OCR 서버(:8000)에 닿지 않습니다. 방화벽 8000 포트를 확인하세요.` |
| Spring 도달 | `GET {API_BASE}/auth/me` 3초, **401이면 성공 판정** | `백엔드(:8080)에 닿지 않습니다. 방화벽 8080 포트와 PC IP를 확인하세요.` |
| LAN IP 런타임 오버라이드 | `mora.env.override` 저장 후 앱 재시작 | — |

#### 헬스 프로브 확정 근거 (2026-07-27 재확인)

**두 서버 모두 전용 헬스 엔드포인트가 없다.** 그래서 프로브는 "살아 있으면 반드시 이 응답을 준다"가 성립하는 기존 경로를 빌려 쓴다.

| 서버 | 프로브 | 기대 | 왜 이 경로인가 |
|---|---|---|---|
| **Spring** `:8080` | `GET /auth/me` (토큰 없이) | **HTTP 401** + 래핑된 JSON 본문. **본문에 `success` 필드가 있으면 MORA Spring임이 확인된다** | **actuator가 포함되어 있지 않아** `/actuator/health` 가 없다. `SecurityConfig` 는 `anyRequest().permitAll()` 이고 **인증은 각 컨트롤러가 JWT로 직접 검증**하므로, 토큰 없는 `/auth/me` 는 필터에서 튕기는 것이 아니라 **컨트롤러까지 도달한 뒤 래핑된 401** 을 만든다. 즉 401이 오면 "앱이 서버에 닿았고, 그 서버가 MORA Spring이며, 컨트롤러 레이어까지 살아 있다"가 한 번에 증명된다 |
| **OCR** `:8000` | `GET /` | `{"service":"MORA OCR Service","version":"3.0","docs":"/docs"}` | 정적 고정 응답이라 판정이 확실하다. 원본: `ocr/app.py:122` |

**함정 — 401을 실패로 처리하면 안 된다.** 이 프로브는 인증을 확인하는 것이 아니라 **도달성**을 확인한다. 401은 "서버가 살아서 대답했다"는 뜻이므로 **성공**이다(QA-195·QA-196). 반대로 응답 본문에 `success` 필드가 없으면 IP가 우리 서버가 아닌 다른 무언가(공유기 관리 페이지, 프록시)에 닿은 것이므로 **성공으로 처리하지 않는다.**

**금지 —** 진단 화면은 프로브의 **HTTP status와 `success` 필드 존재 여부만** 읽고 응답 본문을 렌더하지 않는다(NFR-015).

---

## 2. Android cleartext(HTTP) 허용 — 개발 프로파일에만

Android 9(API 28)부터 평문 HTTP가 기본 차단된다. 설정 없이 APK를 만들면 모든 요청이 `Cleartext HTTP traffic to 192.168.0.10 not permitted`로 죽는다.

### 2-1. `app.config.js` — 변형별 분기

**확장자는 `.js` 다** — eas-cli가 `app.config.ts` 를 프로젝트의 TypeScript 6.0.3으로 트랜스파일하다 죽는다([[APK Build]] §2 결정 2, [[Risks]] RSK-34). 타입 보조는 JSDoc으로 유지한다. 아래는 cleartext 분기만 발췌한 것이고, **전체 정본은 [[APK Build]] §2** 다.

```js
// app.config.js (발췌 — cleartext 분기)
/** @type {'development' | 'preview' | 'production'} */
const VARIANT = process.env.APP_VARIANT ?? 'development';

const IS_DEV = VARIANT === 'development';
// development: LAN 평문 개발 / preview: 팀 내부 테스트 APK / production: HTTPS 전용
const ALLOW_CLEARTEXT = VARIANT !== 'production';

/**
 * @param {{ config: import('expo/config').ExpoConfig }} ctx
 * @returns {import('expo/config').ExpoConfig}
 */
module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'MORA (dev)' : 'MORA',
  slug: 'mora-mobile',
  owner: 'mimimiminus-team',                         // ★ 계정이 2개라 필수 ([[APK Build]] §1-2)
  scheme: 'mora',                                    // ★ OAuth 딥링크 (Auth §3-4)
  android: {
    package: IS_DEV ? 'com.mora.app.dev' : 'com.mora.app',
    ...(VARIANT === 'preview'
      ? { networkSecurityConfig: './android-config/network_security_config.xml' }
      : {}),
    // ★ edgeToEdgeEnabled 를 쓰지 않는다 — SDK 57 에서 제거되었다 (항상 켜짐)
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-build-properties', {
      android: {
        usesCleartextTraffic: ALLOW_CLEARTEXT,       // ★ 여기 한 곳에서만 제어
        minSdkVersion: 26,
        // 나머지는 [[APK Build]] §2 참조
      },
    }],
  ],
  // ★ newArchEnabled 를 쓰지 않는다 — SDK 57 에서 제거되었다 (New Arch 강제)
  extra: { ...config.extra, variant: VARIANT, eas: { projectId: '27aa700a-3cf0-4ed4-98ab-b4fd2154436a' } },
});
```

- `usesCleartextTraffic`는 **`expo-build-properties` 플러그인으로만 설정한다.** `android/` 디렉터리를 직접 수정하면(prebuild eject) 관리형 워크플로의 이점을 잃는다.
- **production 빌드에서 `true`가 새어 들어가지 않게** CI/체크리스트에서 병합된 `AndroidManifest.xml`을 확인한다 ([[Auth]] §7-3).
- `projectId` 를 **하드코딩하는 것은 의도다.** 동적 config에서는 eas-cli가 이 값을 자동 기입할 수 없다([[APK Build]] §1-1).

### 2-2. `preview` 프로파일 전용 network security config

전체 평문 허용 대신 **사설 IP 대역만** 예외로 둔다. 릴리스 실수의 폭발 반경을 줄이는 조치다.

```xml
<!-- android-config/network_security_config.xml — preview 전용 -->
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- 기본은 평문 금지 -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>

    <!-- 개발 PC 사설 IP만 평문 허용. 팀 환경에 맞춰 IP를 추가한다. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.0.10</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>     <!-- Android 에뮬레이터 → 호스트 -->
        <domain includeSubdomains="false">localhost</domain>    <!-- adb reverse 사용 시 -->
    </domain-config>
</network-security-config>
```

`<domain>`에는 **와일드카드나 CIDR을 쓸 수 없다.** 팀원 PC IP가 바뀌면 이 파일을 갱신해야 한다. 그게 번거로우면 `development` 프로파일(전체 허용)을 쓰고 `preview`는 터널 HTTPS로 붙는 편이 낫다.

### 2-3. iOS 참고 (현재 산출물은 APK뿐)

iOS ATS도 평문을 차단한다. 향후 iOS 빌드를 만들 때 `expo-build-properties`의 `ios.flipper`가 아니라 `infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking`을 개발 변형에만 켠다. **현재 범위(Phase 8 = release APK)에서는 대상 외.**

---

## 3. 환경 프로파일

### 3-1. 프로파일 3종 + 보조 1종

| 프로파일 | API_BASE | OCR_BASE | 용도 | cleartext |
|---|---|---|---|---|
| `dev-lan` | `http://<LAN_IP>:8080` | `http://<LAN_IP>:8000` | **기본.** 실기기 + 개발 PC | 허용 |
| `dev-emulator` | `http://10.0.2.2:8080` | `http://10.0.2.2:8000` | Android 에뮬레이터 (10.0.2.2 = 호스트 루프백) | 허용 |
| `prod-cloud` | `https://api.mora.example` | `https://ocr.mora.example` | 클라우드 배포 (후반 페이즈) | 금지 |
| `dev-adb`(보조) | `http://localhost:8080` | `http://localhost:8000` | USB 연결 실기기. **방화벽·IP 문제를 통째로 우회** | 허용 |

**`dev-adb` 사용법** — Wi-Fi 문제(AP 격리, 게스트망, IP 변동)가 있을 때 가장 확실한 탈출구다.
```bash
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8000 tcp:8000
adb reverse --list        # 확인
```
폰의 `localhost:8080` 요청이 USB를 통해 PC의 8080으로 전달된다. 방화벽 규칙도, LAN IP도 필요 없다. 단 USB 케이블이 연결된 동안만 유효하고, `adb reverse`는 기기 재부팅/재연결 시 다시 걸어야 한다.

### 3-2. `.env` 파일 구성

```
.env.development        # dev-lan 기본값 (git 커밋 금지, .gitignore)
.env.emulator           # dev-emulator
.env.production         # prod-cloud (커밋해도 무방 — 공개 URL만 들어감)
.env.example            # 키 목록만 담은 템플릿 (커밋)
```

```bash
# .env.example
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080
EXPO_PUBLIC_OCR_URL=http://192.168.0.10:8000
EXPO_PUBLIC_PROFILE=dev-lan
```

### 3-3. EAS 프로파일별 환경변수 주입

```jsonc
// eas.json
{
  // appVersionSource: "remote" 는 동적 config 에서 필수다 ([[APK Build]] §3-0).
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "APP_VARIANT": "development",
        "EXPO_PUBLIC_API_URL": "http://192.168.0.10:8080",
        "EXPO_PUBLIC_OCR_URL": "http://192.168.0.10:8000",
        "EXPO_PUBLIC_PROFILE": "dev-lan"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "APP_VARIANT": "preview",
        "EXPO_PUBLIC_API_URL": "http://192.168.0.10:8080",
        "EXPO_PUBLIC_OCR_URL": "http://192.168.0.10:8000",
        "EXPO_PUBLIC_PROFILE": "dev-lan"
      }
    },
    "production": {
      "android": { "buildType": "apk" },
      "env": {
        "APP_VARIANT": "production",
        "EXPO_PUBLIC_API_URL": "https://api.mora.example",
        "EXPO_PUBLIC_OCR_URL": "https://ocr.mora.example",
        "EXPO_PUBLIC_PROFILE": "prod-cloud"
      }
    }
  }
}
```

규칙 5가지:
1. **`EXPO_PUBLIC_*`는 빌드 시점에 번들에 인라인된다.** 런타임에 바꿀 수 없고, 비밀이 아니다. 시크릿은 `eas secret:create`로 관리하되 클라이언트 코드에서 읽지 않는다.
2. `development`/`preview`의 LAN IP는 **팀원마다 다르다.** 팀 공용 값을 넣지 말고, ~~각자 `eas build --local`~~ **로컬 `.env`로 덮어쓰거나 §3-4 런타임 오버라이드를 쓴다** — `eas build --local` 은 이 PC에서 동작하지 않는다(Android SDK·JDK 미설치, [[Risks]] RSK-35). **런타임 오버라이드가 사실상 유일한 실용 경로다.**
3. `buildType: "apk"`를 세 프로파일 모두에 명시한다(기본은 `app-bundle`). 확정 산출물은 APK다.
4. 프로파일이 바뀌면 **이미지 캐시를 반드시 비운다** (§4-3).
5. **`APP_VARIANT` 와 `EXPO_PUBLIC_*` 는 역할이 다르다.** 전자는 `app.config.js` 가 읽는 빌드 타임 분기 키(패키지명·cleartext), 후자는 앱 코드가 읽는 런타임 값(base URL)이다. 하나로 합치면 config가 앱 로직을 알게 된다.

### 3-4. 런타임 오버라이드 (개발/프리뷰 빌드 전용)

```ts
// src/lib/api/env.ts (발췌)
import { storage } from '@/lib/storage';   // MMKV default 인스턴스

const IS_DEV_BUILD = process.env.EXPO_PUBLIC_PROFILE !== 'prod-cloud';
const strip = (u: string) => u.replace(/\/+$/, '');

function resolve(key: 'apiBase' | 'ocrBase', fallback: string): string {
  if (IS_DEV_BUILD) {
    const raw = storage.getString('mora.env.override');
    if (raw) { try { const o = JSON.parse(raw); if (o?.[key]) return strip(String(o[key])); } catch {} }
  }
  return strip(fallback);
}

export const API_BASE = resolve('apiBase', process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080');
export const OCR_BASE = resolve('ocrBase', process.env.EXPO_PUBLIC_OCR_URL ?? 'http://localhost:8000');
```

**릴리스 빌드에서는 오버라이드를 읽지 않는다.** 임의 서버로 트래픽을 돌릴 수 있는 구멍을 남기지 않기 위해서다. 오버라이드 변경 후에는 앱을 완전 재시작해야 하며(모듈 상수), UI에서 그렇게 안내한다.

---

## 4. 이미지 URL 처리

### 4-1. 사실관계

| 항목 | 값 |
|---|---|
| 이미지 서빙 주체 | **OCR 서버(:8000)**. Spring이 아니다. `app.mount("/uploads", StaticFiles(...))` |
| 서버가 주는 값 | **상대경로** `/uploads/POSTER/ab12cd34ef.jpg` |
| 명함 | `CardResponse.imageUrl` (정식 컬럼) |
| 포스터·티켓·영수증 | `JSON.parse(parsedJson).imageUrl` |
| 대시보드 | `DashboardDeadlineResponse.imageUrl` — 서버가 `parsedJson`에서 추출, 실패 시 `""` |
| 스캔 단계(API-41) | `image_url`이 **항상 `""`**. 영구 URL은 커밋(API-63) 응답에서 받는다 |

### 4-2. 절대 URL 조립 규칙

```ts
/** 상대경로면 OCR_BASE를 붙이고, 이미 절대 URL이면 그대로 둔다. 빈 값은 undefined. */
export function toAbsoluteImageUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;             // 클라우드 이전 후 절대 URL 대비
  return `${OCR_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}
```

규칙 3가지:
1. **조립은 어댑터 계층에서만 한다.** 화면 컴포넌트는 항상 완성된 절대 URL을 받는다 ([[Data Model]] §5-1).
2. `OCR_BASE`는 끝 슬래시가 제거된 상태를 전제로 한다(`strip`).
3. `https://`로 시작하는 값을 그대로 통과시키므로, 서버가 나중에 S3/CDN 절대 URL을 주기 시작해도 앱 코드 변경이 필요 없다.

### 4-3. 캐시 키 함정 — 프로파일/IP 변경 시 전량 미스

`expo-image`의 디스크 캐시 키는 **URL 전체**다. LAN IP가 `192.168.0.10` → `192.168.0.42`로 바뀌면 같은 이미지가 전부 새 URL이 되어 캐시가 통째로 무효화되고, 옛 항목이 디스크에 남는다.

```ts
// 프로파일/베이스 URL이 바뀐 것을 감지하면 이미지 캐시를 비운다.
const lastBase = storage.getString('mora.env.lastOcrBase');
if (lastBase && lastBase !== OCR_BASE) {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
}
storage.set('mora.env.lastOcrBase', OCR_BASE);
```

### 4-4. 이미지 로딩 정책

| 항목 | 값 | 근거 |
|---|---|---|
| 컴포넌트 | `expo-image` | 디스크·메모리 캐시, `placeholder`, `transition` 내장 |
| `cachePolicy` | `'memory-disk'` | 보관함 재방문이 잦다 |
| `transition` | 150ms fade | 스켈레톤 → 이미지 전환 |
| `contentFit` | 카드 썸네일 `cover` / 상세 뷰어 `contain` | |
| 실패 폴백 | 문서 타입별 아이콘 플레이스홀더 | `imageUrl`이 빈 레코드가 실제로 존재한다 ([[API Contract]] §4-8 #6) |
| 인증 | **불필요.** `/uploads`는 정적 서빙이라 토큰을 요구하지 않는다 | 원본: `ocr/app.py` |
| 프리페치 | 보관함 리스트에서 다음 화면 분량만 `Image.prefetch` | 과도한 프리페치는 LAN 대역을 잡아먹는다 |

**주의**: `/uploads`가 인증 없이 열려 있으므로 **파일명(UUID hex)을 아는 사람은 누구나 남의 문서 이미지를 볼 수 있다.** 앱이 완화할 수 없는 서버 측 이슈이며 [[Risks]]에 등재한다.

---

## 5. 오프라인 감지 · 재시도 · 취소

### 5-1. NetInfo 사용 규칙 (LAN 개발 특유의 함정)

```bash
npx expo install @react-native-community/netinfo
```

```ts
// src/lib/net/connectivity.ts
import NetInfo from '@react-native-community/netinfo';

export type Reachability = 'online' | 'no-network' | 'server-unreachable';

/**
 * ★ isInternetReachable 로 요청을 막지 않는다.
 * 개발 LAN은 인터넷이 없어도 서버에는 닿는다. isInternetReachable=false 인데
 * 실제로는 API가 정상 동작하는 상황이 흔하다.
 */
export async function probe(): Promise<Reachability> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 'no-network';          // 물리적 미연결만 차단 사유로 본다

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${OCR_BASE}/`, { signal: ctrl.signal });   // API-65, 고정 응답
    clearTimeout(t);
    return res.ok ? 'online' : 'server-unreachable';
  } catch { return 'server-unreachable'; }
}
```

| 상태 | UI | 요청 허용 |
|---|---|---|
| `online` | 배너 없음 | 전부 |
| `no-network` | 상단 고정 배너 `오프라인입니다. 연결되면 자동으로 다시 불러옵니다.` | 캐시 읽기만. 뮤테이션은 큐잉하지 않고 즉시 실패 처리 |
| `server-unreachable` | 배너 `서버에 연결할 수 없습니다.` + (개발 빌드) `연결 진단` 버튼 | 전부 시도 (일시적일 수 있음) |

**결정 — 뮤테이션 오프라인 큐를 만들지 않는다.** 근거: 저장 플로우가 이미지 2회 업로드 + 보상 트랜잭션 부재라서, 오프라인 큐를 만들면 재접속 시 중복 이미지·고아 NER 라벨이 대량 생성된다. 대신 스캔 draft를 MMKV에 보존해 **사용자가 명시적으로 재시도**하게 한다 ([[Offline and State]]).

### 5-2. 온라인 복귀 시 동작

```ts
// React Query 온라인 관리자를 NetInfo에 연결한다
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected)))   // isInternetReachable 아님
);
```
복귀 시: 현재 화면의 활성 쿼리만 refetch한다(`refetchOnReconnect: true`). 백그라운드의 모든 쿼리를 되살리면 LAN 서버(Hikari pool max 3)가 즉시 포화된다.

### 5-3. 재시도·백오프 정책

| 조건 | 재시도 |
|---|---|
| 멱등 **GET** + `network`/`timeout`/`502`/`503`/`504` | **최대 2회** |
| **`500`** | **재시도 안 함.** MORA에서 500은 도메인 실패의 기본 코드다 ([[API Contract]] §2-2) |
| `400`/`401`/`404`/`413`/`429` | 재시도 안 함 |
| POST/PUT/PATCH/DELETE | **자동 재시도 안 함.** 사용자 명시 재시도만 |
| 업로드 (API-41/63) | 자동 재시도 안 함. 실패 시 진행률 UI에 `다시 시도` 버튼 노출 |

백오프: `min(4000, 400 × 2^attempt) + random(0..200)ms` → 대략 0.4s → 0.8s. 지터로 동시 요청 다수의 동기화된 재시도를 흩는다. 구현은 [[API Contract]] §5-4.

**동시 요청 상한**: 서버 Hikari 풀이 `maximum-pool-size: 3`이다. **결정 — 앱은 동시 진행 요청을 4개로 제한한다.** 초과분은 큐잉한다. 홈 화면이 목록 3개 + 대시보드 + 알림 카운트를 한꺼번에 부르면 서버가 실제로 대기에 걸린다.

### 5-4. 업로드 취소

| 상황 | 동작 |
|---|---|
| 사용자가 취소 버튼 탭 | `handle.cancel()` → XHR `abort()` → `ApiError('canceled')`. 토스트 없음 |
| 편집 화면 이탈 | **취소하지 않는다.** 업로드는 계속되고 상단에 진행률 미니바를 띄운다 (스캔은 최대 60초라 이탈이 흔하다) |
| 앱 백그라운드 전환 | OS가 소켓을 끊을 수 있다. 복귀 시 실패로 처리하고 `다시 시도`를 제공한다. **백그라운드 업로드는 구현하지 않는다** (범위 밖) |
| 세션 만료 | 전역 `abortAllInFlight()`가 진행 중 업로드도 취소한다 ([[Auth]] §5-2) |
| 타임아웃 | `xhr.timeout` 60초. `ontimeout` → `ApiError('timeout')` |

### 5-5. 업로드 전 이미지 축소 (필수)

```ts
import * as ImageManipulator from 'expo-image-manipulator';

/** 서버가 어차피 1280px로 줄이므로 앱에서 먼저 줄인다. 화질 손실 없음 + 전송량 대폭 감소. */
export async function prepareForUpload(uri: string) {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],          // 긴 변 기준은 촬영 방향에 맞춰 계산
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },  // IMG-02
  );
}
```

근거: OCR 서버가 `MAX_IMAGE_SIDE = 1280`, `quality=90`으로 정규화한다. 압축 수치의 정본은 [[Camera and Scan]] IMG-01~07(장변 1280 / q0.85 / 목표 ≤1.2MB / 하드 상한 8MB / EXIF 제거)이다. Spring multipart 한도가 10MB이고 초과 시 `ApiResponse` 포맷이 아닌 에러가 오므로, 앱 단계 축소가 유일한 예방책이다. 폰 카메라 원본은 4~12MB다.

---

## 6. 타임아웃 값 표

| 대상 | API | 값 | 근거 |
|---|---|---|---|
| GET 목록·상세·프로필 | API-03/14/15/20/24/32/33/43/44/49/50/54/57/58 | **10s** | LAN 왕복은 수십 ms. 여유 배수 |
| 쓰기 (저장·수정·삭제·설정) | API-04/05/06/13/16/17/18/21~23/34~40/42/45/46/48/51/53/55/56/59/60/62 | **15s** | 저장 경로에 OpenAI 임베딩 왕복이 포함된다 |
| 검색 | API-19/47/52/61 | **20s** | 동적 임계값 fuzzy 반복(1.0→0.3, 8회) + 쿼리 임베딩 생성 |
| 스캔 | API-41 | **60s** | PaddleOCR + ResNet18 추론. Spring `RestTemplate`이 무제한이라 앱이 상한을 정해야 한다 |
| 커밋(이미지 영구저장) | API-63 | **60s** | 이미지 재업로드 + 정규화 + 해시 인덱스 |
| 챗봇 | API-31 | **60s** | 3홉 순환 호출 (앱→Spring→LLM→Spring→DB), 내부 httpx 10s |
| 구글 캘린더 | API-25/27/29/30 | **20s** | 구글 API 왕복 포함 |
| 이미지 다운로드 | API-64 | **20s** | `expo-image` 기본값 대신 명시 |
| 연결 진단 프로브 | API-65 | **3s** | 빠른 판정이 목적 |

**모든 60초 요청에는 취소 버튼을 반드시 노출한다.** 서버 측 타임아웃이 없어서 앱이 유일한 탈출구다.

---

## 7. 클라우드 이전 시 바꿔야 할 것 (후반 페이즈 체크리스트)

`prod-cloud` 프로파일을 실제로 켤 때 확인할 항목. 지금 구현할 필요는 없고, 지금의 구조가 이 전환을 방해하지 않는지를 판단하는 기준이다.

| # | 항목 | 지금 상태 | 이전 시 조치 |
|---|---|---|---|
| 1 | `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_OCR_URL` | `eas.json`의 `production.env`에 자리만 마련 | 실제 HTTPS 도메인으로 교체 |
| 2 | cleartext | production `false` | 유지. 병합 매니페스트로 검증 |
| 3 | `network_security_config.xml` | preview 전용 | production 빌드에 포함되지 않는지 확인 |
| 4 | 이미지 호스트 분리 | `OCR_BASE` 별도 변수로 이미 분리됨 | S3/CDN 도메인으로 교체. `toAbsoluteImageUrl`이 절대 URL을 통과시키므로 **앱 코드 변경 불필요** |
| 5 | 이미지 캐시 | URL 기반 | 도메인 변경 시 `clearDiskCache()` 1회 (§4-3) |
| 6 | OAuth `FRONTEND_URL` | 개발용 `mora://auth` | 앱/웹 동시 지원 필요 → **백엔드에 앱 전용 콜백 분기 추가**가 정석 ([[Auth]] §3-2, [[ADR-002 Backend Connectivity]]) |
| 7 | provider redirect_uri | 터널 HTTPS URL | 운영 도메인으로 교체하고 3개 콘솔에 재등록 |
| 8 | `/api/commit`(API-63) 무인증 | 앱이 OCR 서버를 직접 호출 | 공개 인터넷에 노출되면 **누구나 서버 디스크에 파일을 쌓을 수 있다.** Spring에 인증 프록시를 두고 앱은 base URL 하나만 알게 바꾼다 |
| 9 | 구글 캘린더 무방비 API(API-27~30) | 앱이 완화만 함 | 서버에 인증 검사 추가 (필수) |
| 10 | `/uploads` 정적 서빙 무인증 | 파일명 아는 사람은 열람 가능 | 서명 URL(presigned) 또는 인증 프록시 |
| 11 | Swagger 공개 | permitAll | 운영에서 차단 |
| 12 | 이미지 영구 저장 위치 | OCR 서버 로컬 디스크 | 컨테이너 재배포 시 소실·스케일아웃 불가 → 오브젝트 스토리지 이전 |
| 13 | 타임아웃 | LAN 기준 | 인터넷/셀룰러 기준으로 GET 10s → 15s 상향 검토 |
| 14 | 동시 요청 상한 4 | Hikari pool 3 기준 | 서버 풀 확대 시 상향 |
| 15 | 인증서 | — | 자체 서명 인증서를 쓰지 않는다. Let's Encrypt 등 공인 인증서 사용(피닝은 도입하지 않음 — 운영 부담 대비 이득 없음) |
| 16 | 연결 진단 화면 | 개발 빌드 전용 | production에서 노출되지 않는지 확인 |
