# APK Build

Expo(EAS)로 MORA 안드로이드 APK를 만드는 전 과정. 위에서부터 순서대로 따라 하면 실기기에 설치 가능한 APK가 나온다.

상위: [[Home]]
관련: [[Phases]] · [[Risks]] · [[QA Checklist]] · [[Tech Stack]] · [[ADR-001 Framework]] · [[ADR-002 Backend Connectivity]] · [[ADR-004 Styling]] · [[Design Tokens]] · [[Directory Structure]]

---

## 1. 사전 준비

| 항목 | 요구 사항 | 확인 명령 |
|---|---|---|
| Node.js | 20 LTS (22도 가능, 18 이하 비권장) | `node -v` |
| npm | 10 이상 | `npm -v` |
| Git | **선택.** 저장소가 아니어도 빌드된다 (§1-3) | `git --version` |
| EAS CLI | **`npx eas-cli@latest` 로만 실행** (전역 설치하지 않는다) | `npx eas-cli@latest --version` |
| Expo 계정 | 무료 계정 1개. **접근 가능한 계정이 2개 이상이면 app config에 `owner` 를 명시해야 한다** (§1-2) | `npx eas-cli@latest whoami` |
| 실기기 | Android 8.0(API 26) 이상, 브라우저 다운로드 가능 (USB/adb는 현재 PC에 없다) | — |

```bash
npx eas-cli@latest login     # Expo 계정 이메일/비밀번호
npx eas-cli@latest whoami    # 로그인 확인
```

> **왜 `npx eas-cli` 가 아니라 `npx eas-cli@latest` 인가 (실측)** — 버전을 생략하면 npx가 **캐시된 21.1.0** 을 실행한다. 21.1.0은 이 프로젝트의 TypeScript 6.0.3 때문에 app config를 **읽기 단계에서부터** 실패한다(§2 상단). 검증된 버전은 **21.3.0** 이고, `@latest` 를 붙이는 것이 그 상태를 유지하는 가장 짧은 방법이다. **이 문서의 모든 명령은 `npx eas-cli@latest` 로 적는다.**

**클라우드 빌드에는 Android Studio·JDK·Android SDK가 필요 없다.** EAS 서버가 대신 빌드한다. 그리고 이 프로젝트에서는 그것이 선택이 아니다 — **개발 PC에 Android SDK·JDK가 설치되어 있지 않아 로컬 빌드가 아예 불가능하다**(§6). `keytool` 조차 없어 **keystore도 EAS 클라우드에서 생성**되었다(§7).

### 1-1. 프로젝트 초기 연결 (최초 1회) — 실측 결과

```bash
npx eas-cli@latest init             # Expo 프로젝트 생성
npx eas-cli@latest build:configure  # eas.json 생성 (이미 있으면 건너뜀)
```

현재 연결된 EAS 프로젝트:

| 항목 | 값 |
|---|---|
| 프로젝트 | `@mimimiminus-team/mora-mobile` |
| `projectId` | `27aa700a-3cf0-4ed4-98ab-b4fd2154436a` |
| 대시보드 | `https://expo.dev/accounts/mimimiminus-team/projects/mora-mobile` |

> **동적 config에서는 `eas init` 이 `projectId` 를 자동 기입하지 못한다 (실측).** `app.config.js` 는 함수를 export하는 코드이므로 eas-cli가 값을 되써 넣을 지점이 없다. 따라서 **`extra.eas.projectId` 를 손으로 적는다.** 이 값은 반드시 커밋한다 — 없으면 다른 개발자가 빌드할 때 새 프로젝트가 만들어진다.

### 1-2. `owner` 를 반드시 명시한다

이 계정은 개인(`mimimiminu`)과 팀(`mimimiminus-team`) **두 곳에 접근 권한이 있다.** app config에 `owner` 가 없으면 eas-cli가 어느 계정으로 빌드할지 물어보는데, **CI나 non-interactive 실행에서는 그 질문을 할 수 없어 그대로 실패한다**(실측). 

→ **결정: `owner: 'mimimiminus-team'`.** 팀원이 빌드 링크·keystore를 공유받을 수 있어야 하므로 팀 계정을 선택했다.

### 1-3. git 저장소가 아닌 상태로 빌드하기

현재 이 프로젝트는 git 저장소가 아니다. EAS는 기본적으로 VCS로 업로드 대상을 결정하지만, 다음 두 환경변수로 우회된다(실측 — 이 상태로 빌드가 제출되었다).

```bash
# PowerShell
$env:EAS_NO_VCS = "1"
$env:EAS_PROJECT_ROOT = "C:\Users\user\Desktop\_active\MORA_mobile"
npx eas-cli@latest build --platform android --profile preview
```

| 경로 | 필요한 것 | 비고 |
|---|---|---|
| **A. git 저장소 아님 (현재)** | `EAS_NO_VCS=1` + `EAS_PROJECT_ROOT=<절대경로>` | 두 변수를 매 셸에서 세팅해야 한다. `EAS_PROJECT_ROOT` 를 빼면 업로드 루트를 못 찾는다 |
| **B. git 저장소로 만든 뒤** | 없음 | 두 플래그가 모두 불필요해진다. `.gitignore` 대신 `.easignore` 가 업로드 대상을 정한다(§1-4) |

**권장은 B다.** 다만 브랜치·커밋은 사용자가 직접 수행하므로 이 문서는 두 경로를 모두 남긴다.

### 1-4. `.easignore` — 업로드 아카이브 제어

**`.easignore` 가 존재하면 EAS는 `.gitignore` 를 무시하고 이 파일만 본다.** 그래서 이 파일이 없으면 위키 16k행이 통째로 올라간다.

```
node_modules/
.expo/
.export/
dist/
web-build/

# 로컬 prebuild 산출물 — EAS 가 원격에서 깨끗하게 다시 생성해야 한다
/android
/ios

# 설계 문서. 앱 빌드에 불필요하고 용량만 차지한다
wiki/

# 로컬 환경값 (LAN IP). 빌드 환경변수는 eas.json 의 profile.env 로 주입한다
.env
.env.local
```

| 제외 대상 | 이유 |
|---|---|
| `wiki/` | 설계 문서 16k행. 앱 빌드에 쓰이지 않는다 |
| **`/android`** | **필수.** 로컬 prebuild 산출물이 올라가면 EAS가 그것을 그대로 쓴다. 제외해야 원격에서 `app.config.js` 기준으로 깨끗하게 prebuild한다 |
| `.env`, `.env.local` | LAN IP는 사람마다 다르다. 빌드 환경값은 `eas.json` 의 `profile.env` 가 정본 |

실측 업로드 크기: **2.6MB.**

---

## 2. `app.config.js` 전체 예시

**결정 1:** `app.json` 대신 **동적 config** 를 쓴다. LAN IP·패키지명·cleartext 여부가 빌드 변형에 따라 달라지므로 정적 JSON으로는 표현할 수 없다.

**결정 2 (2026-07-27 실측으로 확정): 확장자는 `.ts` 가 아니라 `.js` 다.**

> eas-cli는 빌드 전에 app config를 **다시 읽고 필요하면 수정**하려 한다. 그 경로에서 `app.config.ts`(TypeScript)를 만나면 **프로젝트의 TypeScript로 트랜스파일**하는데, 이 프로젝트의 `typescript 6.0.3` 에서는 `Cannot read properties of undefined (reading 'CommonJS')` 로 죽는다 — TS 6에서 `ModuleKind` API가 바뀌었기 때문이다. `npx eas-cli`(캐시된 21.1.0)는 **읽기 단계에서도** 같은 이유로 실패한다.
>
> `app.config.js` 로 두면 **트랜스파일 경로 자체가 사라져** 문제가 발생하지 않는다. 타입 보조는 JSDoc(`@type`)으로 유지하므로 편집기 자동완성과 오타 검출은 그대로 남는다. 이 제약은 [[Risks]] RSK-34로 등재했다.

**결정 3: `newArchEnabled` 와 `android.edgeToEdgeEnabled` 를 넣지 않는다.** SDK 57에서 **두 키가 제거**되었다(둘 다 강제 기본값). 남겨 두면 타입 에러가 난다.

```js
// app.config.js
/** @type {'development' | 'preview' | 'production'} */
const VARIANT = process.env.APP_VARIANT ?? 'development';

const IS_DEV = VARIANT === 'development';
const ALLOW_CLEARTEXT = VARIANT !== 'production';

/**
 * EAS 프로젝트 ID (@mimimiminus-team/mora-mobile).
 * 동적 config 는 eas-cli 가 자동 기입할 수 없어 직접 적는다 (§1-1).
 */
const EAS_PROJECT_ID = '27aa700a-3cf0-4ed4-98ab-b4fd2154436a';

/**
 * @param {{ config: import('expo/config').ExpoConfig }} ctx
 * @returns {import('expo/config').ExpoConfig}
 */
module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'MORA (dev)' : 'MORA',
  slug: 'mora-mobile',
  // EAS 계정이 2개라 소유 계정을 명시한다. 없으면 non-interactive 실행이 실패한다 (§1-2).
  owner: 'mimimiminus-team',
  version: '0.1.0',                     // = Android versionName
  orientation: 'portrait',
  scheme: 'mora',                       // 딥링크: mora://

  // 다크모드는 v1 In scope다 ([[ADR-004 Styling]] §4). 구 결정의 'light' 고정은 폐기됐다.
  // 'automatic' 이어야 액션시트·날짜 피커·키보드·시스템 Alert 이 앱 테마와 함께 움직인다(QA THM-08).
  // 주의: 이 값은 OS 테마만 따른다. 앱의 3택(`시스템 따름`/`라이트`/`다크`)은 런타임에서
  //       nativewind `colorScheme.set()` 이 담당한다 — [[Design Tokens]] §13.
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  // ★ newArchEnabled 를 쓰지 않는다 — SDK 57 에서 제거되었고 New Arch 가 강제 기본이다.
  // ★ 최상위 `splash` 키도 쓰지 않는다 — dark 변형을 표현할 수 없다.
  //   스플래시는 아래 plugins 의 expo-splash-screen 항목이 정본이다.

  android: {
    // dev 변형은 패키지명을 분리해 preview 빌드와 한 기기에 공존시킨다.
    package: IS_DEV ? 'com.mora.app.dev' : 'com.mora.app',
    // ★ versionCode 를 여기에 적지 않는다 — eas.json 의 appVersionSource: "remote" 가 정본이다 (§8).
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      // Android 13+ 테마 아이콘용 단색 실루엣. 없으면 런처가 일반 아이콘으로 폴백한다.
      monochromeImage: './assets/images/android-icon-monochrome.png',
      backgroundColor: '#15293D',       // 테마 무관 고정 (Design Tokens §10-5)
    },
    // ★ edgeToEdgeEnabled 를 쓰지 않는다 — SDK 57 / RN 0.86 은 항상 켜져 있어 키가 제거되었다.
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',  // NetInfo 연결 상태 조회
      'android.permission.CAMERA',
      'android.permission.READ_MEDIA_IMAGES',     // Android 13+ 갤러리
      'android.permission.POST_NOTIFICATIONS',    // Android 13+ 알림
      'android.permission.VIBRATE',               // 햅틱
    ],
    // 요청하지 않은 권한이 매니페스트 병합으로 끼어드는 것을 막는다 (아래 표 참조).
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      ...(IS_DEV ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: false,
        data: [{ scheme: 'mora' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  // 시스템 바 — 색을 여기에 박지 않는다. 정적 값은 테마 전환에 반응하지 못해
  // 다크에서 흰 띠(또는 라이트에서 검은 띠)가 남는다. 색은 런타임에서
  // `src/theme/AppChrome.tsx`(expo-status-bar / expo-navigation-bar / expo-system-ui)가
  // 항상 `bg.base` 로 맞춘다 — [[Design Tokens]] §13-6, 검증은 THM-07.
  androidStatusBar: {
    translucent: false,       // 배경색을 앱이 직접 칠하므로 투명이면 안 된다
    // barStyle / backgroundColor 는 의도적으로 비워 둔다 (런타임 소유)
  },
  // `androidNavigationBar` 블록은 **의도적으로 선언하지 않는다.**
  //   - 색을 넣으면 테마 전환에 반응하지 못한다(위와 같은 이유).
  //   - `visible: 'immersive'` 로 숨기면 내비바가 사라져 세이프에어리어 계산이 흔들린다.
  //   기본값(항상 표시) + 런타임 색 설정이 v1의 조합이다.

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      // 스플래시 — 라이트/다크 2벌. 네이티브 리소스라 앱의 `theme.mode` 를 읽지 못하고
      // **OS 테마만** 따른다(Design Tokens §13-7 함정 1). 그래서 배경을 브랜드 네이비 판이 아니라
      // 각 테마의 `bg.base` 로 둔다 — 스플래시→첫 화면 배경색 점프를 없애는 쪽이 우선이다(THM-05).
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',          // 라이트용 — brand #15293D 단색 로고
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',                        // 라이트 bg.base
        dark: {
          image: './assets/images/splash-icon-dark.png',    // 다크용 — brand 다크 변형 #AEC4D8 단색 로고
          backgroundColor: '#0F1621',                      // 다크 bg.base
        },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'MORA가 명함·티켓·포스터·영수증을 촬영하기 위해 카메라를 사용합니다.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '저장된 사진에서 문서 이미지를 선택하기 위해 사진 접근 권한이 필요합니다.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icons/notification-icon.png',   // 96x96 흰색 실루엣 PNG (테마 무관 — OS가 틴트한다)
        color: '#0077B6',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,          // Android 8.0 — 기기 매트릭스 하한
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          // ★ LAN 평문 HTTP(http://192.168.x.x:8080) 허용.
          //   Android 9(API 28)+ 는 기본으로 cleartext 를 차단하므로 이게 없으면
          //   APK 에서 모든 API 호출이 즉시 실패한다. 자세한 배경은 [[ADR-002 Backend Connectivity]].
          //   production 프로파일에서는 반드시 false 로 떨어진다 ([[Networking]] §2-1).
          usesCleartextTraffic: ALLOW_CLEARTEXT,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    ...config.extra,
    variant: VARIANT,
    eas: { projectId: EAS_PROJECT_ID },
  },
});
```

> **LAN base URL은 어디에 있는가** — `app.config.js` 가 아니라 `eas.json` 의 `profile.env` 와 로컬 `.env` 에 있고, 앱은 `process.env.EXPO_PUBLIC_*` 로 직접 읽는다([[Networking]] §3). `extra` 에 복사하면 값의 출처가 둘로 갈린다.

### 2-1. 권한 — 실제 생성된 AndroidManifest.xml로 검증한 최종 목록

`npx expo prebuild` 로 생성된 매니페스트를 직접 읽어 확인했다. **요청하지 않은 권한 2개가 자동으로 유입된다.**

| 권한 | 출처 | 필요 이유 / 처리 |
|---|---|---|
| `INTERNET` | 우리 선언 | 모든 API 호출. 없으면 네트워크 완전 불가 |
| `ACCESS_NETWORK_STATE` | 우리 선언 | NetInfo 연결 상태 조회(PKG-18). 없으면 오프라인 판정이 항상 unknown |
| `CAMERA` | 우리 선언 | 문서 촬영 (Phase 3). 없으면 촬영 진입 시 즉시 실패 |
| `READ_MEDIA_IMAGES` | 우리 선언 | Android 13+ 갤러리 선택 |
| `POST_NOTIFICATIONS` | 우리 선언 | Android 13+ 로컬 알림. 없으면 권한 다이얼로그조차 안 뜨고 조용히 무시됨 |
| `VIBRATE` | 우리 선언 | 햅틱. normal permission이라 런타임 요청 불필요 |
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion="32"`) | `expo-image-picker` 자동 | **정상이므로 제거하지 않는다.** Android 12 이하 갤러리 접근 호환용이고 `maxSdkVersion` 이 붙어 13+ 기기에는 요청되지 않는다 |
| ~~`RECORD_AUDIO`~~ | **`expo-camera` 자동** | **제거한다.** `recordAudioAndroid: false` 를 줘도 매니페스트에 들어온다(실측). 영상 녹화를 쓰지 않으므로 `blockedPermissions` 로 뺀다 |
| ~~`SYSTEM_ALERT_WINDOW`~~ | **`expo-dev-client` 자동** | **development 변형에서만 남긴다.** 개발 메뉴 오버레이용이다. preview/production에서 남으면 사용자에게 "다른 앱 위에 표시" 권한을 요구하는 앱으로 보인다 |

**`blockedPermissions` 는 실제로 어떻게 동작하는가** — Expo가 병합 매니페스트에 `tools:node="remove"` 를 달아 주므로, 플러그인이 넣은 권한이 최종 APK 매니페스트에서 **빠진다**(선언만 무력화하는 것이 아니다). 검증은 QA-208·QA-209.

**검증된 최종 권한 6개(+ maxSdk 32 스토리지 2개)**: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `READ_MEDIA_IMAGES`, `POST_NOTIFICATIONS`, `VIBRATE`.

함께 확인한 매니페스트 항목: cleartext 허용 플래그, 패키지명(`com.mora.app` / dev는 `com.mora.app.dev`), `minSdkVersion 26`, 딥링크 `mora://` intent-filter.

### 테마 관련 네이티브 설정 4곳 (다크모드 v1 In scope)

다크모드가 v1 필수가 되면서 `app.config.js` 에서 손대야 하는 지점은 정확히 아래 4개다. 값의 정본은 [[Design Tokens]] §10·§13이고, 이 문서는 **어느 키에 무엇을 넣는가**만 책임진다.

| 설정 | 값 | 왜 이 값인가 | 정적 vs 런타임 |
|---|---|---|---|
| `userInterfaceStyle` | `'automatic'` | 네이티브 컴포넌트(액션시트·날짜 피커·키보드·공유 시트)가 앱 테마를 따라간다. `'light'` 고정이면 다크 앱에 흰 패널이 튀어나온다 | **정적.** OS 테마만 반영. 앱 3택은 런타임이 별도로 처리 |
| `expo-splash-screen` 의 `dark` | 라이트 `#FFFFFF` + 네이비 로고 / 다크 `#0F1621` + `#AEC4D8` 로고 | 스플래시는 JS가 뜨기 전이라 `theme.mode` 를 읽을 수 없다. OS 테마만 따르는 2벌이 최선이며, 배경을 `bg.base` 로 맞춰 첫 화면 진입 시 점프를 없앤다 | **정적.** 에셋 2장 필수 |
| `adaptiveIcon.monochromeImage` | 단색 실루엣 PNG 1장 | Android 13+ 테마 아이콘. 아이콘 자체 색은 테마 무관 고정이므로(§10-5) **테마에 반응하는 유일한 아이콘 요소**다 | **정적.** 없으면 일반 아이콘 폴백(무해) |
| `androidStatusBar` / `androidNavigationBar` 의 색 | **비워 둔다** | 정적 색은 테마 전환에 반응하지 못한다. 다크로 바꾼 순간 상단에 흰 띠가 남는다. `AppChrome` 이 `bg.base` 로 계속 맞춘다 | **런타임.** 정적 값을 넣으면 오히려 충돌 |

**[[Design Tokens]] §13-6 발췌와의 정합** — 그 문서의 `app.config.js` 발췌에는 `android: { navigationBar: { visible: 'immersive' } }` 가 적혀 있다. **색 값의 정본은 그 문서**이고, **키 이름과 선언 여부의 정본은 이 문서**다: Expo config의 실제 키는 최상위 `androidNavigationBar` 이며, v1은 내비바를 숨기지 않으므로(`immersive` 는 몰입형 전체화면용이고 세이프에어리어 계산을 흔든다) 이 블록을 **선언하지 않는다.** 두 문서가 어긋나는 지점은 이 한 줄뿐이고, 색·로고·배경 HEX는 전부 일치한다.

**추가 에셋 2장** — `assets/images/splash-icon-dark.png`, `assets/icons/adaptive-icon-mono.png`. 둘 다 단색 도형이라 파일당 수~수십 KB이며, 로고 SVG를 **색만 바꿔 내보내면** 되므로 제작 비용도 내보내기 1회다. 앱 로고 자체는 `react-native-svg` 인라인이라 `fill` prop으로 테마를 따라가므로 다크용 파일이 필요 없다([[Design Tokens]] §10-5). 용량 영향은 §9에 적었다.

**검증** — 이 4곳은 [[QA Checklist]] THM-05(스플래시 정조합) · THM-06(역조합 1프레임 점프) · THM-07(시스템 바 색) · THM-08(네이티브 컴포넌트) · QA-168(아이콘·스플래시 2테마)로 확인한다. 네 케이스 중 하나라도 실패하면 원인은 대부분 이 표의 "정적/런타임" 열을 반대로 구현한 것이다.

> **`usesCleartextTraffic: true` 를 릴리스에도 두는가?** — v1은 **둔다.** 백엔드가 LAN의 평문 HTTP이고 클라우드 배포는 후반 선택 페이즈로 분리되어 있기 때문이다([[Phases]] §0). 클라우드 HTTPS로 전환하는 시점에 이 값을 `false` 로 되돌리고 `network_security_config.xml` 로 개발 IP만 예외 처리한다. 이 부채는 [[Risks]] RSK-12에 등록되어 있다.

---

## 3. `eas.json` 전체 예시

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      },
      "env": {
        "APP_VARIANT": "development",
        "EXPO_PUBLIC_API_URL": "http://192.168.0.10:8080",
        "EXPO_PUBLIC_OCR_URL": "http://192.168.0.10:8000"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "APP_VARIANT": "preview",
        "EXPO_PUBLIC_API_URL": "http://192.168.0.10:8080",
        "EXPO_PUBLIC_OCR_URL": "http://192.168.0.10:8000"
      }
    },
    "production": {
      "distribution": "internal",
      "channel": "production",
      "autoIncrement": true,
      "android": {
        "buildType": "apk"
      },
      "env": {
        "APP_VARIANT": "production",
        "EXPO_PUBLIC_API_URL": "https://api.mora.example",
        "EXPO_PUBLIC_OCR_URL": "https://ocr.mora.example"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 3-0. 두 가지 함정 (실측)

| 함정 | 증상 | 규칙 |
|---|---|---|
| **`autoIncrement` 는 boolean이다** | `"autoIncrement": "versionCode"` 를 넣으면 `"build.production.autoIncrement" must be a boolean` 으로 **eas.json 검증 자체가 실패**한다 (빌드 시작 전) | `true` / `false` 만 쓴다. Android에는 증가시킬 대상이 `versionCode` 하나뿐이므로 문자열로 지정할 이유도 없다 |
| **동적 config에는 `appVersionSource: "remote"` 가 필수다** | `app.config.js` 는 코드라서 eas-cli가 값을 되써 넣을 수 없다. `"local"` 이면 버전을 올릴 방법이 없어 `autoIncrement` 가 성립하지 않는다 | `cli.appVersionSource: "remote"` 로 두고 **EAS 서버가 `versionCode` 를 관리**하게 한다. 첫 빌드에서 로컬 값을 기준으로 **1로 초기화**된다(실측) |

`cli.version` 은 `>= 16.0.0` 으로 둔다. 검증 버전은 **21.3.0** 이고, §1의 이유로 항상 `npx eas-cli@latest` 로 부른다.

`APP_VARIANT` 는 `app.config.js` 가 읽는 유일한 분기 키다(§2). `EXPO_PUBLIC_*` 는 앱 코드가 직접 읽는다 — 두 계열의 역할이 다르므로 하나로 합치지 않는다.

### 프로필 3개의 역할

| 프로필 | 산출물 | 용도 | 특징 |
|---|---|---|---|
| `development` | debug APK + dev client | 개발 중 실기기 핫리로드 | JS 번들을 Metro에서 받아온다. 앱만 설치해 두면 코드 수정이 즉시 반영된다. **하루 종일 쓰는 빌드.** |
| `preview` | **release 서명된 APK** | 팀 내부 배포·데모·QA | JS가 번들에 포함되어 PC 없이 단독 실행. `distribution: internal` 이라 Play Store를 거치지 않는다. **가장 자주 만드는 배포용 빌드.** |
| `production` | release APK + 자동 버전 증가 | 정식 릴리스 | `autoIncrement: true` 로 `versionCode` 를 EAS 서버가 관리한다(§9). |

> `"appVersionSource": "remote"` 는 `versionCode` 의 정본을 **EAS 서버**에 둔다는 뜻이다. **동적 config에서는 선택이 아니라 필수다**(§3-0) — `app.config.js` 에는 `versionCode` 를 아예 적지 않고, 첫 빌드에서 EAS가 1로 초기화한 뒤 빌드마다 +1 한다. 로컬 파일을 매번 고칠 필요가 없고 여러 사람이 빌드해도 충돌하지 않는다.
> `distribution: "internal"` 은 세 프로필 모두에 넣는다. 이게 있어야 EAS가 **설치용 QR/링크 페이지**를 만들어 준다. 없으면 스토어 제출용 아티팩트로만 취급된다.
> `channel` 은 향후 EAS Update(OTA)를 붙일 때 쓰이는 배포 채널명이다. v1에서 OTA를 쓰지 않더라도 미리 분리해 두면 나중에 preview 채널만 먼저 갱신하는 운용이 가능하다.

### LAN IP를 바꾸는 방법

`eas.json` 의 `env` 값 3곳(프로필별 2개씩)을 수정하고 다시 빌드한다. 재빌드가 싫다면 FR-121의 **서버 연결/진단 화면(SCR-31)에서 런타임 변경**을 쓴다(개발/preview 빌드 한정).

내 PC의 LAN IP 확인:

```powershell
# Windows PowerShell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' }).IPAddress
```

Spring/OCR 서버가 `0.0.0.0` 이 아니라 `127.0.0.1` 에만 바인딩되어 있으면 폰에서 접근할 수 없다. Spring은 기본이 `0.0.0.0` 이고, FastAPI는 `uvicorn app:app --host 0.0.0.0 --port 8000` 으로 띄워야 한다.

---

## 4. 클라우드 빌드 — 실제 명령어 순서

```bash
# 0) 사전 점검 (권장, 실패 원인의 절반을 여기서 잡는다)
npx expo-doctor
npx tsc --noEmit

# 0-b) git 저장소가 아니면 (§1-3) — PowerShell
#      $env:EAS_NO_VCS = "1"
#      $env:EAS_PROJECT_ROOT = "C:\Users\user\Desktop\_active\MORA_mobile"

# 1) 빌드 큐에 넣기
npx eas-cli@latest build --platform android --profile preview

#    → 처음이면 "Generate a new Android Keystore?" 를 묻는다. Yes.
#      (이 PC 에는 keytool 이 없어 keystore 가 EAS 클라우드에서 생성된다 — §7)
#    → 빌드 로그 URL 이 출력된다. Ctrl+C 로 대기를 끊어도 빌드는 계속된다.

# 2) 상태 확인
npx eas-cli@latest build:list --platform android --limit 5

# 3) 완료된 빌드 다운로드
#    - 출력된 URL 을 브라우저로 열면 QR 과 Download 버튼이 있다.
#    - 또는 CLI 로:
npx eas-cli@latest build:download --platform android --latest
```

빌드 소요 시간: 무료 티어 기준 **큐 대기 0~60분 + 빌드 10~20분**. **Phase 0 실측 큐 대기는 약 15분.** 유료 티어는 큐가 거의 없다.

### 설치 (택 1)

**현재 이 PC에는 `adb` 가 없다**(Android Platform-Tools 미설치 — [[Tech Stack]] §5). 따라서 **경로 B가 기본**이고, A는 Platform-Tools를 설치한 뒤에만 쓸 수 있다.

```bash
# A) USB 연결 + adb (가장 빠르고 확실 — Platform-Tools 설치 필요)
adb devices                       # 기기가 목록에 보여야 한다
adb install -r ./build-xxxx.apk   # -r = 기존 앱 위에 재설치

# B) QR 코드 (현재 기본 경로)
#    EAS 빌드 결과 페이지의 QR 을 폰 카메라로 스캔 → 브라우저 다운로드 → 설치

# C) 파일 전송
#    APK 를 폰으로 복사(USB/드라이브) → 파일 관리자에서 탭 → 설치
```

### "출처를 알 수 없는 앱" 허용

Play Store를 거치지 않은 APK는 Android가 기본 차단한다. **Android 8.0부터는 앱 단위 허용**이다.

1. 설치를 시도하면 "이 출처의 앱은 설치할 수 없습니다" 다이얼로그가 뜬다.
2. **설정** 버튼을 누르면 바로 해당 앱(크롬/파일 관리자/드라이브)의 허용 화면으로 이동한다.
3. **이 소스에서 설치 허용** 을 켠다.
4. 뒤로 돌아와 설치를 계속한다.

수동 경로: `설정 → 앱 → 특별한 앱 접근 → 알 수 없는 앱 설치 → (설치를 시작한 앱 선택) → 허용`
삼성 One UI: `설정 → 보안 및 개인 정보 보호 → 추가 보안 설정 → 알 수 없는 앱 설치`

`adb install` 로 설치할 때는 이 절차가 필요 없다.

---

## 5. 개발 중 일상 루프 (development 프로필)

```bash
# 최초 1회: dev client APK 설치
npx eas-cli@latest build --platform android --profile development
#   → adb 가 없으므로 EAS 빌드 페이지의 QR 로 폰에 직접 설치한다 (§4)

# 이후 매일:
npx expo start --dev-client
#   → 터미널 QR 을 dev client 앱에서 스캔하거나,
#   → 같은 Wi-Fi 라면 앱이 자동으로 개발 서버를 찾는다.
```

> `npx expo run:android` 는 **이 PC에서 동작하지 않는다** (Android SDK·JDK 미설치 — §6-0). dev client는 EAS `development` 프로파일로만 만든다.

**dev client를 다시 빌드해야 하는 경우**는 네이티브가 바뀔 때뿐이다: `plugins` 배열 변경, 새 네이티브 모듈 설치, `app.config.js` 의 `android` 블록 변경, Expo SDK 업그레이드. JS/TS/스타일만 바꿨다면 재빌드가 필요 없다.

**테마 작업에서 특히 헷갈리는 경계** — 팔레트 값·`tokens.ts`·`global.css`·컴포넌트 색은 **전부 JS라 재빌드 없이 즉시 반영**된다. 반면 `userInterfaceStyle`, 스플래시 `dark` 블록, `monochromeImage`, 시스템 바 설정은 **네이티브라 재빌드가 필요하다.** Phase 1에서 다크 팔레트를 조정하는 동안에는 재빌드가 필요 없고, §2 표의 4개 설정을 처음 넣을 때 한 번만 재빌드하면 된다.

---

## 6. 로컬 빌드 (클라우드 대기·쿼터 문제 시)

### 6-0. 현재 상태 — 로컬 빌드는 **불가능하다** (2026-07-27 실측)

이 절은 "쿼터가 마르면 쓰는 대안"이 아니라 **선행 조건이 미충족인 미래 경로**다. Phase 0에서 확인한 개발 PC 상태:

| 확인 항목 | 값 | 귀결 |
|---|---|---|
| `ANDROID_HOME` | **미설정** | Gradle이 SDK를 찾지 못한다 |
| `ANDROID_SDK_ROOT` | **미설정** | 동일 |
| `JAVA_HOME` | **미설정** | Gradle 실행 자체가 불가 |
| `keytool` | **없음** (JDK 미설치) | 로컬 keystore 생성·`apksigner` 검증 불가 → **keystore를 EAS 클라우드에서 생성**했다(§7) |
| `adb` | **없음** (Platform-Tools 미설치) | `adb install`·`adb logcat`·`dumpsys` 전부 불가 |

**따라서 `eas build --local` 과 `npx expo run:android` 는 지금 실행해도 동작하지 않는다.** 아래 6-1~6-3을 쓰려면 **먼저 6-2의 선행 조건을 설치하고 환경변수를 설정해야 한다.** 그 설치는 15GB+ 툴체인 도입 결정이므로 필요해지는 시점에 별도로 판단한다([[Risks]] RSK-35).

**현재의 유일한 빌드 경로는 EAS 클라우드 빌드다** — §1~§4가 그 경로이고 Phase 0에서 실제로 통과했다.

### 6-1. Windows 제약 (중요)

`eas build --local` 은 **macOS / Linux만 공식 지원**한다. Windows에서는 다음 두 경로 중 하나를 쓴다. **둘 다 6-2 선행 조건이 먼저 충족되어야 한다.**

| 경로 | 명령 | 특징 |
|---|---|---|
| WSL2 (Ubuntu) 안에서 EAS 로컬 빌드 | `npx eas-cli@latest build -p android --profile preview --local` | EAS 클라우드와 동일한 산출물. 설정 비용이 큼. WSL 안에 JDK·Android SDK를 **또** 설치해야 한다 |
| **네이티브 프로젝트 직접 빌드** | `npx expo prebuild` → `gradlew assembleRelease` | Windows에서 그대로 동작. EAS 계정·쿼터 불필요 |

### 6-2. 선행 조건 (전부 설치·설정되어야 6-3이 동작한다)

| 항목 | 버전 | 현재 |
|---|---|---|
| JDK | **17 또는 21** (Temurin/Zulu). `JAVA_HOME` 설정 **필수** | **없음** |
| Android Studio | Ladybug 이상 (SDK Manager 용도) | **없음** |
| Android SDK Platform | API 35 | **없음** |
| Android SDK Build-Tools | 35.0.0 (`apksigner` 포함 — §11 서명 검증에 필요) | **없음** |
| Android SDK Platform-Tools | 최신 (`adb` 포함 — [[QA Checklist]] §5 성능 측정에 필요) | **없음** |
| NDK | 불필요 (Expo 기본 모듈만 쓸 경우) | — |
| 환경변수 | `ANDROID_HOME` = `C:\Users\<user>\AppData\Local\Android\Sdk`, `JAVA_HOME` = JDK 경로 | **미설정** |
| 디스크 | 여유 15GB 이상 (Gradle 캐시 포함) | — |
| RAM | 8GB 이상 권장 | — |

설치 후 아래 3줄이 모두 값을 출력해야 6-3으로 넘어간다. **하나라도 비어 있으면 로컬 빌드는 실패한다.**

```powershell
java -version          # 17.x 또는 21.x
$env:ANDROID_HOME      # 경로가 출력되어야 한다
adb version
```

### 6-3. 절차

```bash
# 1) 네이티브 프로젝트 생성 (android/ 폴더가 만들어진다)
npx expo prebuild --platform android --clean

# 2-A) 릴리스 APK — expo 래퍼 사용 (기기가 연결돼 있으면 설치까지 자동)
npx expo run:android --variant release

# 2-B) 릴리스 APK — gradle 직접 (기기 없이 파일만)
cd android
./gradlew assembleRelease          # Windows: .\gradlew.bat assembleRelease
# 산출물: android/app/build/outputs/apk/release/app-release.apk

# 3) 디버그 APK 가 필요하면
./gradlew assembleDebug
```

**주의 1** — `expo prebuild` 로 생성된 `android/` 폴더는 **커밋하지 않고 EAS 업로드에서도 제외한다**(`.gitignore` + **`.easignore` 의 `/android`** — §1-4). 커밋하면 `app.config.js` 변경이 네이티브에 반영되지 않는 이중 진실 상태가 되고, 업로드에 포함되면 EAS가 원격에서 prebuild를 다시 하지 않고 그 폴더를 그대로 쓴다. 필요할 때마다 `--clean` 으로 재생성한다. **매니페스트 권한 검증(§2-1)은 이 로컬 prebuild 산출물을 읽어서 했다** — 검증 목적의 prebuild는 유용하고, 문제는 그것을 업로드·커밋하는 것뿐이다.

**주의 2** — 로컬 릴리스 빌드는 기본적으로 **debug keystore로 서명**된다. 배포용 서명을 하려면 `android/app/build.gradle` 의 `signingConfigs.release` 에 실제 keystore를 연결해야 한다. §8 참조. EAS 클라우드 빌드는 이 과정을 자동으로 처리한다.

**주의 3** — 첫 Gradle 빌드는 의존성 다운로드로 15~30분 걸린다. 두 번째부터는 3~5분.

---

## 7. Keystore 관리

### 7-1. EAS 관리 vs 직접 관리

**현재 상태 (실측)**: 이 PC에 `keytool` 이 없어 **선택지가 하나뿐이었다** — Phase 0의 첫 빌드에서 **EAS가 클라우드에서 keystore를 생성**했다. 아래 표의 "직접 관리" 열은 JDK를 설치한 뒤에만 가능한 경로다.

| | EAS 관리 (**현재 사용 중**) | 직접 관리 |
|---|---|---|
| 생성 | 첫 빌드 시 자동 (`Generate a new Android Keystore? Yes`) — **Phase 0에서 이 경로로 생성됨** | `keytool` 로 수동 생성 (**현재 불가 — JDK 없음**) |
| 저장 | Expo 서버 (계정 귀속) | 내 디스크 |
| 팀 공유 | 계정/조직 공유로 자동 | 파일을 직접 전달해야 함 (유출 위험) |
| 백업 책임 | **여전히 나에게 있다** (계정 삭제·탈취 시 소실) | 전적으로 나 |
| 로컬 빌드 | keystore를 내려받아 gradle에 연결해야 함 | 그대로 사용 |
| v1 선택 | **EAS 관리 + 오프라인 백업 병행** | — |

### 7-2. 직접 생성하는 경우

```bash
keytool -genkeypair -v \
  -keystore mora-release.keystore \
  -alias mora-release \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -storetype JKS
# 만료 30년(10950일). 짧게 잡으면 만료 후 업데이트가 막힌다.
```

EAS에 올리기: `npx eas-cli@latest credentials --platform android` → `Set up a new keystore` → 파일·비밀번호·alias 입력.

### 7-3. 백업 (Phase 8 첫 작업, 미완료 시 release 빌드 금지)

```bash
# EAS 관리 keystore 를 내려받는다
npx eas-cli@latest credentials --platform android
#   → Keystore: Download existing keystore
#   → keystore 파일 + keystorePassword + keyAlias + keyPassword 4개 값이 나온다
```

백업 대상은 **파일 1개 + 비밀번호 3개**다. 파일만 백업하고 비밀번호를 잃으면 파일도 쓸모없다.

| 보관 위치 | 형태 | 접근 권한 |
|---|---|---|
| ① EAS 서버 | 원본 | Expo 계정 |
| ② 오프라인 암호화 아카이브 | `mora-keystore-backup.7z` (AES-256, 별도 비밀번호) — USB 또는 팀 금고 | 팀 리드 |
| ③ 비밀번호 3종 | 팀 비밀번호 관리자(1Password/Bitwarden) 항목 | 팀 리드 + 부팀장 |

**절대 금지**: git 저장소 커밋, 슬랙/카톡 전송, 평문 클라우드 드라이브.

### 7-4. 분실 시 무슨 일이 일어나는가

1. **기존 설치 사용자에게 업데이트를 배포할 수 없다.** 다른 서명의 APK는 Android가 "패키지가 기존 패키지와 충돌합니다"로 설치를 거부한다. 사용자는 **앱을 삭제 후 재설치**해야 하고, 그 과정에서 **앱 로컬 데이터(SecureStore의 로그인 세션, 캐시)가 전부 사라진다.**
2. Play Store에 이미 올렸고 **Play App Signing을 쓰지 않았다면** 그 앱 리스팅은 영구히 업데이트 불가다. 새 `package` 이름으로 새 앱을 등록하는 것 외에 방법이 없다(리뷰·설치수 리셋).
3. v1은 사이드로드 배포이므로 피해는 ①에 한정되지만, 그래도 **테스터 전원이 앱을 지우고 다시 깔아야 한다.**

---

## 8. 버전 관리 규칙

| 필드 | 의미 | 규칙 |
|---|---|---|
| `version` (versionName) | 사람이 읽는 버전 | Semantic Versioning `MAJOR.MINOR.PATCH`. 사용자에게 보이는 값 |
| `android.versionCode` | Android가 비교하는 정수 | **단조 증가 정수.** 되돌리거나 건너뛰어도 되지만 **줄이면 안 된다** |

### 증가 규칙 (결정)

| 변경 유형 | versionName | versionCode |
|---|---|---|
| 버그 수정만 | `1.0.0` → `1.0.1` | +1 |
| 기능 추가 (페이즈 완료) | `1.0.1` → `1.1.0` | +1 |
| 호환성 깨지는 변경 / 데이터 구조 변경 | `1.1.0` → `2.0.0` | +1 |
| 같은 코드 재빌드 (빌드 실패 재시도) | 유지 | **+1** (EAS 자동) |

`eas.json` 의 `production` 프로필에 `"autoIncrement": true` + `cli.appVersionSource: "remote"` 를 두었으므로 `versionCode` 는 **손대지 않는다.** `versionName` 만 릴리스 때 `app.config.js` 에서 올린다.

현재 원격 버전 확인·수동 설정:

```bash
npx eas-cli@latest build:version:get  --platform android
npx eas-cli@latest build:version:set  --platform android   # 마이그레이션 등 예외 상황에서만
```

`preview` 프로필에는 `autoIncrement` 를 두지 않았다. 내부 배포용 APK를 하루 5번 만들어도 버전이 튀지 않게 하기 위함이며, `adb install -r` 는 같은 versionCode여도 재설치를 허용한다.

---

## 9. APK 용량 줄이기

목표: **80MB 이하** (NFR-028) — **다크모드 편입 후에도 이 목표는 그대로 유지한다.**

**다크 에셋이 용량에 미치는 영향: 무의미하다.** 추가되는 것은 다크 스플래시 로고 1장 + 테마 아이콘 1장이고 둘 다 단색 도형 PNG라 합쳐 **수십 KB(≈0.03MB)**, 80MB 예산의 0.04% 미만이다. 다크 팔레트는 색 값이라 번들 크기와 무관하고(CSS 변수 한 벌 추가 = 수백 바이트), 라이트/다크 컴포넌트가 따로 존재하지 않으므로 JS 번들도 늘지 않는다([[ADR-004 Styling]] §4 — 색은 변수 뒤로 숨는다). 다크 때문에 예산을 재조정할 근거는 없다.

| 기법 | 적용 방법 | 기대 효과 |
|---|---|---|
| R8 코드 축소 | `expo-build-properties` 의 `enableProguardInReleaseBuilds: true` (§2에 이미 포함) | 5~15MB |
| 리소스 축소 | `enableShrinkResourcesInReleaseBuilds: true` | 2~8MB |
| Hermes 엔진 | Expo SDK 기본값(별도 설정 불필요). JS를 바이트코드로 선컴파일 | JS 파싱 시간 단축, 번들 축소 |
| 폰트 웨이트 제한 | 정본은 **5웨이트 번들**([[Design Tokens]] §5-1). 80MB를 넘길 때에만 400/600/700 3종으로 축소를 검토한다 | 웨이트당 약 1.5MB |
| 이미지 포맷 | PNG → WebP 변환 (아이콘·스플래시 제외) | 30~60% |
| 미사용 에셋 제거 | `assetBundlePatterns` 를 `['**/*']` 대신 실제 사용 경로로 좁힘 | 가변 |
| 미사용 의존성 제거 | `npx depcheck` 후 삭제, `npx expo-doctor` 로 중복 확인 | 가변 |
| 아키텍처 분리 | 아래 참고 | **약 40%** |

### 아키텍처 분리 (ABI split)

기본 APK는 `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` 네이티브 라이브러리를 모두 담은 **universal APK**다. 실제 기기는 그중 하나만 쓴다.

```ts
// app.config.js 의 expo-build-properties 옵션에 추가
['expo-build-properties', {
  android: {
    // ... 기존 옵션
    // 에뮬레이터(x86)를 쓰지 않는다면 arm 계열만 남긴다
    // 주의: x86 을 빼면 대부분의 Android Studio 에뮬레이터에서 실행되지 않는다
    // (실기기 배포 전용 빌드에서만 사용할 것)
  },
}]
```

**결정:** v1은 universal APK를 유지한다. 배포 대상이 팀 내부 몇 대이고, ABI 분리 APK는 "어느 파일을 받아야 하는지"를 사용자가 알아야 해서 사이드로드 배포와 궁합이 나쁘다. 용량이 80MB를 넘기면 그때 `x86`/`x86_64` 제거를 먼저 검토한다(에뮬레이터 테스트 포기 조건).

### 크기 측정

```bash
ls -lh ./build-xxxx.apk                       # 파일 크기
unzip -l ./build-xxxx.apk | sort -k1 -n | tail -30   # 큰 항목 30개
npx expo export --platform android            # JS 번들 크기만 따로 확인
```

**Phase 0 번들 실측 (참고값)** — Android 번들 **1753 모듈**, Hermes 바이트코드 **3.79MB**. 화면이 2개(SCR-01 껍데기 + SCR-31 진단)뿐인 상태의 값이므로 **하한선**으로 읽는다. 이후 페이즈에서 화면·컴포넌트가 늘 때 이 값과 비교해 증가분을 추적하고, JS 번들이 예산(80MB APK)을 압박하는 요인인지 네이티브 라이브러리가 요인인지 구분한다. `react-dom`·`react-native-web`(PKG-45)은 import되지 않아 이 1753 모듈에 포함되지 않는다.

---

## 10. 흔한 빌드 실패 원인과 해결

### 10-0. Phase 0에서 실제로 만난 실패 7건 (전부 재현 가능)

이 표가 §10의 나머지보다 먼저 온다. **이 프로젝트에서 실제로 발생한 것들**이기 때문이다.

| 증상 / 에러 메시지 | 원인 | 해결 |
|---|---|---|
| `Cannot find module 'babel-preset-expo'` (번들 즉시 실패) | SDK 57은 프리셋을 `node_modules/expo/node_modules/` 하위에 **중첩 설치**한다. 우리가 만든 `babel.config.js` 에서 bare name이 해석되지 않는다. NativeWind는 `babel.config.js` 를 요구하므로 **반드시 만난다** | `npm i -D babel-preset-expo` 로 **명시 devDependency 선언** ([[Tech Stack]] PKG-42) |
| `Cannot read properties of undefined (reading 'CommonJS')` (eas-cli 실행 중) | eas-cli가 `app.config.ts` 를 프로젝트의 **TypeScript 6.0.3**으로 트랜스파일하다 죽는다 (TS 6의 `ModuleKind` API 변경) | app config를 **`app.config.js`** 로 바꾼다. 타입 보조는 JSDoc (§2 결정 2) |
| 위 오류가 **읽기 단계**에서 발생 | `npx eas-cli` 가 캐시된 **21.1.0** 을 실행했다 | **`npx eas-cli@latest`** (검증 21.3.0) — §1 |
| `"build.production.autoIncrement" must be a boolean` | `autoIncrement` 에 `"versionCode"` 문자열을 넣었다 | `true` / `false` 만 쓴다 (§3-0) |
| `npm ERESOLVE` — peer `react-dom` 미충족 | `expo-router 57` 이 `vaul`·`@radix-ui/*` 웹 의존을 끌어오고 그들의 peer가 `react-dom` 이다 | `npx expo install react-dom react-native-web` ([[Tech Stack]] PKG-45). Android 전용이라도 필요하다 |
| non-interactive 빌드가 계정 선택에서 실패 | 접근 가능한 EAS 계정이 2개(`mimimiminu`, `mimimiminus-team`)인데 config에 `owner` 가 없다 | `owner: 'mimimiminus-team'` 명시 (§1-2) |
| 타입 에러 — `newArchEnabled` / `android.edgeToEdgeEnabled` 를 모르는 키라고 함 | SDK 57에서 **두 키가 제거**되었다 (둘 다 강제 기본) | app config에서 **삭제** (§2 결정 3) |

### 10-1. 그 외 알려진 실패 원인

| 증상 / 에러 메시지 | 원인 | 해결 |
|---|---|---|
| `Cannot determine which native SDK version your project uses` | `expo` 패키지 버전과 `sdkVersion` 불일치 | `npx expo install --fix` |
| 다크 테마 색이 안 먹거나 Tailwind 설정 파싱 오류 | `tailwindcss` **4.x** 가 설치됨. NativeWind 4.2.6은 Tailwind 4를 지원하지 않는다 | `npm i -D tailwindcss@3.4` 로 되돌린다 ([[Tech Stack]] VR-7, [[Risks]] RSK-33) |
| 워크릿 플러그인 중복 등록 경고 | `babel.config.js` 에 `react-native-worklets/plugin` 을 직접 넣었다 | 제거한다. `babel-preset-expo` 가 자동 주입한다 |
| EAS 업로드가 수십 MB로 커짐 / 위키가 올라감 | `.easignore` 가 없다. **있으면 `.gitignore` 대신 이것만 본다** | §1-4의 `.easignore` 를 추가 (실측 2.6MB) |
| EAS가 원격 prebuild를 하지 않고 옛 네이티브 설정으로 빌드 | `/android` 가 업로드 아카이브에 포함되었다 | `.easignore` 에 `/android` 추가 (§1-4) |
| 설치 후 앱이 "다른 앱 위에 표시" 권한을 요구 | `expo-dev-client` 가 넣은 `SYSTEM_ALERT_WINDOW` 가 preview/production에 남았다 | `blockedPermissions` 에서 development 변형만 예외 처리 (§2-1) |
| 설치 시 마이크 권한이 표시됨 | `expo-camera` 가 `recordAudioAndroid: false` 여도 `RECORD_AUDIO` 를 넣는다 | `blockedPermissions` 에 `RECORD_AUDIO` (§2-1) |
| `[expo-doctor] Expected package @expo/... found invalid version` | 의존성 버전이 SDK 조합에서 벗어남 | `npx expo install --check` 후 제안된 버전 설치 |
| `Error: Cannot find module 'expo-router/entry'` | `main` 필드 누락 | `package.json` 의 `"main": "expo-router/entry"` 확인 |
| Gradle: `Could not resolve all files for configuration ':app:debugRuntimeClasspath'` | 네트워크/캐시 문제 | `cd android && ./gradlew clean`, 그래도 안 되면 `npx expo prebuild --clean` |
| Gradle: `Unsupported class file major version 6x` | JDK 버전 불일치 (21+ 사용) | JDK **17** 로 `JAVA_HOME` 고정 |
| `Execution failed for task ':app:mergeReleaseResources'` | 아이콘/스플래시 PNG 손상 또는 이름에 대문자·공백 | 에셋 파일명을 소문자·하이픈으로, PNG 재저장 |
| `Duplicate class ... found in modules` | 네이티브 모듈 중복 (직접 설치 + 플러그인) | 중복 패키지 하나 제거 후 `--clean` prebuild |
| `Keystore was tampered with, or password was incorrect` | keystore 비밀번호 오류 | `npx eas-cli@latest credentials` 로 값 재확인. 3회 실패 시 백업본 사용 |
| 빌드는 성공했는데 앱이 **즉시 종료** | JS 번들 오류가 release에서만 발생 (보통 `console` 제거 플러그인, 환경변수 undefined) | `adb logcat -s ReactNativeJS:V AndroidRuntime:E` 로 스택 확인 |
| 앱은 뜨는데 **모든 API 실패** (`Network request failed`) | ① `usesCleartextTraffic` 누락 ② LAN IP 오기 ③ PC 방화벽 ④ 서버가 127.0.0.1 바인딩 | §2 cleartext 설정 확인 → 폰 브라우저로 `http://<IP>:8000/` 접속 테스트 → 방화벽 인바운드 허용 → uvicorn `--host 0.0.0.0` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 이전 설치본과 **서명이 다름** (debug ↔ release 혼용) | 앱 삭제 후 재설치. 앞으로는 프로필을 섞지 말 것 |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | versionCode가 설치본보다 낮음 | versionCode를 올리거나 앱 삭제 후 설치 |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | 기기 저장공간 부족 | 공간 확보 후 재시도 |
| EAS: `Build queue is full` / 30분+ 대기 | 무료 티어 큐 | 로컬 빌드(§6)로 전환하거나 다음 슬롯 대기. [[Risks]] RSK-04 |
| EAS: `You have reached your monthly build limit` | 무료 빌드 30회/월 소진 | 로컬 빌드로 전환. 다음 달까지 클라우드는 릴리스 빌드에만 사용 |
| 카메라 화면이 검은 화면 | 권한은 있으나 프리뷰 초기화 실패 (저사양 기기) | 프리뷰 해상도 낮추고 `onCameraReady` 이후에 UI 렌더 |
| 폰트가 시스템 기본으로 보임 | `expo-font` 로딩 완료 전 렌더 | 스플래시 유지 → `useFonts` 완료 후 해제 |
| OS를 다크로 두고 실행해도 **스플래시가 항상 흰 배경** | ① `expo-splash-screen` 플러그인의 `dark` 블록 누락 ② 다크 에셋 파일 경로 오타 ③ **네이티브 리소스라 JS만 고쳐서는 반영되지 않음** | §2 플러그인 설정 확인 → 파일 존재 확인 → `npx expo prebuild --clean` 또는 dev client 재빌드. 스플래시는 `theme.mode`(앱 3택)가 아니라 **OS 테마**만 따른다는 점도 확인 (THM-06은 이 조합의 점프를 "정상"으로 판정한다) |
| 다크에서 상태바/내비바에 **흰 띠**가 남음 | `androidStatusBar.backgroundColor` 또는 `androidNavigationBar.backgroundColor` 에 정적 색이 박혀 있어 런타임 설정과 충돌 | 두 키의 색 필드를 비우고 `AppChrome`([[Design Tokens]] §13-6)에만 맡긴다. `translucent: false` 는 유지 |
| 다크에서 액션시트·날짜 피커만 흰색 | `userInterfaceStyle` 이 `'light'` 로 남아 있음 (구 결정 잔재) | `'automatic'` 으로 고치고 **재빌드**. JS 변경이 아니라 네이티브 설정이다 |

### 디버깅 기본 명령

**`adb` 는 현재 이 PC에 없다**(§6-0). 아래 명령을 쓰려면 Android SDK Platform-Tools 설치가 선행 조건이며, 그 전까지 클라우드 빌드 로그(`build:view`)와 앱 내 진단 화면(SCR-31)이 유일한 관찰 수단이다.

```bash
adb logcat -c                                          # 로그 비우기
adb logcat -s ReactNativeJS:V AndroidRuntime:E EasBuild:V   # 앱 로그만
adb shell dumpsys package com.mora.app | head -40      # 설치 상태·서명·권한
adb shell pm list permissions -d -g                    # 위험 권한 목록
npx eas-cli@latest build:view <BUILD_ID>                              # 클라우드 빌드 상세
```

---

## 11. 서명 검증 (Phase 8 DoD)

**선행 조건**: `apksigner` 는 Android SDK Build-Tools에 포함되어 있고 **현재 PC에 없다**(§6-0). Phase 8 착수 전에 Build-Tools를 설치하거나, 대안으로 EAS 빌드 상세 페이지의 서명 정보(fingerprint)를 기록하는 경로를 택한다. 어느 쪽이든 **Phase 8 DoD 이전에 결정해야 한다.**

```bash
# Android SDK build-tools 에 포함된 apksigner 사용
apksigner verify --verbose --print-certs mora-v1.0.0-release.apk

# 기대 출력
#   Verifies
#   Verified using v1 scheme (JAR signing): true|false
#   Verified using v2 scheme (APK Signature Scheme v2): true
#   Signer #1 certificate SHA-256 digest: <이 값을 릴리스 문서에 기록>
```

`Verified using v2 scheme: true` 가 아니면 서명이 잘못된 것이다. SHA-256 지문은 릴리스마다 **동일해야** 한다. 값이 바뀌었다면 keystore가 바뀐 것이고, 기존 사용자는 업데이트 설치가 불가하다.

---

## 12. Play Store 배포는 v1 범위 밖

[[Scope]] 에 따라 v1은 사이드로드 APK 배포까지다. 향후 Play Store에 올릴 경우, Play는 2021년 8월부터 신규 앱에 **AAB(Android App Bundle)** 를 요구하므로 APK 대신 AAB를 산출해야 한다. 전환은 `eas.json` 의 production 프로필에서 `"buildType": "apk"` 를 지우면 끝난다(EAS의 기본 산출물이 AAB다). 이후 `npx eas-cli@latest submit --platform android` 로 제출하며, 이때 Play Console에서 **Play App Signing**을 활성화하면 업로드 키와 서명 키가 분리되어 §7-4의 keystore 분실 위험이 크게 완화된다. 다만 AAB는 `adb install` 로 직접 설치할 수 없으므로(`bundletool` 필요), 내부 테스트 경로로 preview 프로필의 APK 빌드는 그대로 유지한다.
