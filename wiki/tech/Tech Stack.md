# Tech Stack

MORA 모바일 앱이 채택한 패키지 전체 목록, 버전 확정 규칙, 원본 웹 스택과의 대응, 그리고 **채택하지 않은 것과 그 이유**.

상위: [[Home]]
관련: [[Architecture]] · [[Directory Structure]] · [[Conventions]] · [[Camera and Scan]] · [[APK Build]] · [[ADR-001 Framework]] · [[ADR-004 Styling]] · [[ADR-005 State and Data]]

---

## 1. 버전 확정 규칙 (가장 먼저 읽을 것)

**결정:** 이 문서는 **패키지 버전을 손으로 고정하지 않는다.** 버전의 정본은 언제나 `npx expo install`이 해결한 값이다.

| # | 규칙 | 이유 |
|---|---|---|
| VR-1 | 새 패키지는 반드시 `npx expo install <pkg>`로 설치한다. `npm install`/`yarn add` 금지 | Expo SDK는 각 SDK 버전마다 **호환 검증된 네이티브 패키지 버전 범위**를 갖는다. `npm install`은 그 범위를 무시하고 latest를 넣어 네이티브 빌드가 깨진다 |
| VR-2 | `package.json`에 캐럿/틸드를 임의로 손대지 않는다 | `expo install`이 써 넣은 범위가 SDK 호환 범위다 |
| VR-3 | 버전 검증은 `npx expo-doctor`와 `npx expo install --check` | 두 명령이 SDK 기대 버전과의 불일치를 전부 출력한다. CI/PR 체크리스트 항목 |
| VR-4 | SDK 업그레이드는 `npx expo install --fix` → `npx expo-doctor` → APK 빌드 1회 순으로만 | 개별 패키지만 올리면 SDK 정렬이 깨진다 |
| VR-5 | Expo 소유가 아닌 서드파티(zustand, react-query 등)도 **일단 `expo install`을 먼저 시도**한다. Expo가 모르는 패키지는 그냥 npm으로 넘어간다 | 명령 하나로 통일하면 예외 판단이 필요 없다 |
| VR-6 | 버전을 문서에 적어야 할 때는 **메이저 라인만** 적는다 (`v5`, `v4`). **예외: §2-0 실측 스냅샷 한 곳에만 패치 버전을 적는다** | 패치 버전을 문서에 박으면 즉시 낡는다. 단 "실제로 설치되어 빌드가 성공한 조합"은 재현·롤백의 기준점이므로 날짜를 붙여 한 곳에 기록한다 |
| VR-7 | **`tailwindcss`는 `3.4.x`로 고정한다.** `expo install`/`npm install`이 4.x를 끌어와도 되돌린다 | NativeWind 4.2.6의 peer 범위는 `tailwindcss > 3.3.0`이지만 **실제로 Tailwind 4를 지원하지 않는다.** §2-2 PKG-08 참조 |
| VR-8 | **`babel-preset-expo`를 명시 devDependency로 선언한다** | SDK 57은 이 프리셋을 `node_modules/expo/node_modules/` 하위에 중첩 설치한다. 직접 만든 `babel.config.js`에서 bare name `'babel-preset-expo'`가 해석되지 않아 번들이 죽는다. §2-7 PKG-42 |

**베이스라인 (2026-07-27 Phase 0 실측):** 프로젝트는 `npx create-expo-app@latest`가 설치하는 **그 시점의 stable Expo SDK**로 생성한다. Phase 0에서 실제로 생성·설치·빌드된 조합은 **Expo SDK 57.0.8 (React Native 0.86.0 / React 19.2.3 / TypeScript 6.0.3)** 이다. 종전 이 문단에 적혀 있던 "Expo SDK 54 (RN 0.81 / React 19.1)"는 **집필 시점의 추정이었고 실측과 다르므로 폐기**한다. 전체 실측 목록은 §2-0.

**New Architecture:** **SDK 57에서는 New Architecture가 기본이자 강제이며, `newArchEnabled` config 키 자체가 제거되었다.** app config에 남겨 두면 타입 에러가 난다(실측). 같은 이유로 `android.edgeToEdgeEnabled`도 제거되었다 — edge-to-edge가 항상 켜져 있다. 아래 스택 중 `react-native-reanimated` v4 · `@shopify/flash-list` v2 · `react-native-mmkv` v4가 New Arch를 요구하므로 이 강제는 우리에게 유리하다. 그 귀결로 **Expo Go로는 개발할 수 없다** — 개발은 `npx expo run:android`로 만든 development build 또는 EAS `development` 프로파일 빌드에서 한다. ([[APK Build]])

> **로컬 빌드 전제 주의** — 이 프로젝트의 개발 PC에는 **Android SDK·JDK가 설치되어 있지 않다**(`ANDROID_HOME`·`ANDROID_SDK_ROOT`·`JAVA_HOME` 미설정, `keytool` 부재 — Phase 0 실측). 따라서 `npx expo run:android`와 `eas build --local`은 **현재 동작하지 않으며 EAS 클라우드 빌드가 유일한 경로다.** 선행 조건은 [[APK Build]] §6에 명시했다. 개발 중 dev client는 EAS `development` 프로파일로 만든다.

---

## 2. 확정 스택 매트릭스

버전 열 표기:
- 숫자는 **2026-07-27 Phase 0에서 실제 설치된 값**이다(§2-0 스냅샷과 동일). `package.json`의 `~`/`^` 범위는 생략하고 해결된 버전만 적는다.
- 정본은 여전히 `npx expo install`이 해결하는 값이다(VR-1). 이 표는 **그 결과의 스냅샷**이며, `npx expo install --check`와 어긋나면 명령 쪽이 맞다.
- `— (미설치)` = 위키에서 채택했으나 Phase 0 시점에 아직 설치하지 않은 것. 담당 페이즈에서 `expo install`로 들어온다.

### 2-0. 실측 스냅샷 (2026-07-27, Phase 0 종료)

`tsc --noEmit` 통과 + Android 번들 **1753 모듈** 성공 + `preview` APK 빌드 제출까지 확인된 조합이다. 재현·롤백의 기준점이며, 이 표의 값만 패치 버전을 갖는다(VR-6 예외).

| 구분 | 패키지와 버전 |
|---|---|
| 코어 | `expo 57.0.8` · `react-native 0.86.0` · `react 19.2.3` · `typescript 6.0.3` · `expo-router 57.0.8` |
| 웹 피어(설치 필수, 번들 미포함) | `react-dom 19.2.3` · `react-native-web 0.21.x` |
| 스타일 | `nativewind 4.2.6` · `react-native-css-interop 0.2.6` · `tailwindcss 3.4.19` |
| 빌드 체인 | `babel-preset-expo 57.0.4`(devDependency) |
| 모션·제스처 | `react-native-reanimated 4.5.0` · `react-native-worklets 0.10.0` · `react-native-gesture-handler 2.32.0` |
| 화면 골격 | `react-native-safe-area-context 5.7.0` · `react-native-screens 4.26.0` · `expo-navigation-bar 57.0.2` |
| 스토리지 | `react-native-mmkv 4.3.2` · `react-native-nitro-modules 0.36.1` · `expo-secure-store 57.0.1` |
| 카메라·이미지 | `expo-camera 57.0.3` · `expo-image-picker 57.0.6` · `expo-image-manipulator 57.0.6` · `expo-image 57.0.1` · `expo-file-system 57.0.1` |
| 상태·폼 | `@tanstack/react-query 5.101.4` · `zustand 5.0.14` · `react-hook-form 7.83.0` · `zod 4.4.3` · `@hookform/resolvers 5.5.7` |
| 네트워크 | `@react-native-community/netinfo 12.0.1` |
| 리스트·시트 | `@shopify/flash-list 2.0.2` · `@gorhom/bottom-sheet 5.2.14` |
| 시스템 | `expo-notifications 57.0.7` · `expo-auth-session 57.0.5` · `expo-haptics 57.0.1` · `expo-build-properties 57.0.7` · `expo-dev-client 57.0.9` · `expo-constants 57.0.7` · `expo-linking 57.0.4` · `expo-splash-screen 57.0.5` · `expo-status-bar 57.0.1` · `expo-system-ui 57.0.1` · `expo-web-browser 57.0.2` · `expo-clipboard 57.0.1` · `expo-crypto 57.0.1` · `expo-device 57.0.1` · `expo-font 57.0.1` |
| SVG | `react-native-svg 15.15.4` |

**아직 설치하지 않은 채택 패키지** — `lucide-react-native`(Phase 1) · `react-native-keyboard-controller`(Phase 3) · `eslint` + `eslint-config-expo` · `prettier` + `prettier-plugin-tailwindcss`(Phase 1 착수 시). Phase 0의 정적 게이트는 `tsc --noEmit` 하나로만 돌았다.

**폐기된 선택** — `expo-network`(PKG-18)는 **설치하지 않았다.** [[Networking]] §5-1의 구현이 이미 `@react-native-community/netinfo`를 전제로 작성되어 있어 그쪽으로 통일했다.

### 2-1. 코어 · 런타임

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-01 | 프레임워크 | `expo` | **57.0.8** | RN 런타임, 네이티브 모듈 통합, config plugin | 카메라·SecureStore·폰트·햅틱·딥링크·이미지가 **한 SDK 안에서 버전 정렬**된다. 이 앱이 필요로 하는 네이티브 표면이 정확히 Expo가 잘하는 영역 |
| PKG-02 | 런타임 | `react-native` | **0.86.0** | 네이티브 렌더링 | Expo SDK가 지정 |
| PKG-03 | UI 런타임 | `react` | **19.2.3** | — | RN 버전에 종속 |
| PKG-04 | 라우팅 | `expo-router` | **57.0.8** | 파일 기반 라우팅, 딥링크, 타입드 라우트 | 원본 Next.js App Router의 **파일=라우트 멘탈 모델을 그대로 유지**해 9화면 이식 시 라우트 매핑이 1:1이 된다. 내부적으로 React Navigation을 쓰되 보일러플레이트를 없앤다 |
| PKG-05 | 언어 | `typescript` | **6.0.3** | 정적 타입 | 원본 프론트/백엔드 DTO가 이미 TS/Java 타입으로 정의됨. `strict` 필수 → [[Conventions]]. **부작용: TS 6의 `ModuleKind` API 변경으로 eas-cli가 `app.config.ts`를 트랜스파일하다 죽는다 → app config는 `.js`로 둔다**([[APK Build]] §2) |
| PKG-06 | 빌드 CLI | `eas-cli` (devDependency 아님, npx 실행) | **21.3.0**(검증) | APK 산출, 크리덴셜 관리 | 확정 요구사항: EAS Build로 APK. 로컬 Android 툴체인 없이도 클라우드 빌드 가능. **반드시 `npx eas-cli@latest`로 부른다** — `npx eas-cli`는 캐시된 21.1.0을 실행하고, 21.1.0은 TS 6 프로젝트의 config를 **읽기 단계에서도** 실패한다(실측) |

### 2-2. 스타일 · 디자인

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-07 | 스타일 | `nativewind` | **4.2.6** | Tailwind 문법 → RN 스타일 | 원본이 Tailwind v4 토큰(`@theme inline`)을 쓴다. 클래스명 어휘를 그대로 옮겨 **디자인 언어 이식 비용을 최소화**. NativeWind 4는 CSS 변수 기반이라 다크 테마 2벌을 변수로 주입할 수 있다 ([[ADR-004 Styling]] §4) |
| PKG-08 | 스타일 피어 | `tailwindcss` | **3.4.19 — 고정** | preset/토큰 정의 | **Tailwind 4를 쓸 수 없다.** NativeWind 4.2.6이 선언한 peer 범위는 `tailwindcss > 3.3.0`이어서 4.x도 설치는 되지만, **NativeWind 4 계열은 Tailwind 4를 실제로 지원하지 않는다** — Tailwind 4 지원은 `nativewind@5.0.0-preview.4` 계열에만 있다. peer 범위가 넓다는 사실이 곧 지원이 아니라는 뜻이므로, 여기서는 **`3.4.x`에 고정**한다(VR-7). 웹 원본이 Tailwind 4라는 사실과는 무관하다 — 우리가 이식하는 것은 클래스명 어휘이고 설정 파일 형식은 v3다 |
| PKG-08b | 스타일 런타임 | `react-native-css-interop` | **0.2.6** | NativeWind의 className→style 런타임 | NativeWind가 끌어오는 전이 의존이지만 **번들 실패의 원인이 여기서 나올 수 있어** 버전을 기록해 둔다. 직접 import하지 않는다 |
| PKG-09 | 폰트 | `expo-font` | **57.0.1** | Pretendard / Patua One 번들 로드 | 원본은 Pretendard를 CSS에 선언만 하고 **로드하지 않았다**. 앱에서는 실제로 번들해 의도를 구현. **폰트 파일 번들은 Phase 1로 이관됨**(Phase 0에서는 패키지만 설치) |
| PKG-10 | 아이콘 | `lucide-react-native` | — (미설치, Phase 1) | 아이콘 세트 | 원본이 `lucide-react`를 쓴다(`Camera`, `ScanText`, `FolderTree`, `Search`, `CalendarCheck2`, `CircleHelp`, `RotateCcw`, `X`, `Eye`/`EyeOff`, `CircleChevronLeft/Right`). **아이콘 이름이 그대로 유지**된다 |
| PKG-11 | SVG | `react-native-svg` | **15.15.4** | lucide 피어 의존, 브랜드 로고/체크 path | `lucide-react-native`가 요구. 원본의 인라인 SVG path를 그대로 이식 가능 |
| PKG-12 | 세이프에어리어 | `react-native-safe-area-context` | **5.7.0** | 노치/제스처바 인셋 | 하단 탭·바텀시트·헤더가 전부 인셋에 의존. expo-router가 이미 의존. **SDK 57은 edge-to-edge가 강제**라 인셋 처리가 선택이 아니다 |
| PKG-12b | 네이티브 스택 | `react-native-screens` | **4.26.0** | expo-router의 네이티브 화면 컨테이너 | expo-router 피어. 직접 import하지 않지만 SDK 정렬 대상 |
| PKG-13 | 시스템 바 | `expo-status-bar` | **57.0.1** | 상태바 스타일 | 랜딩(다크 히어로)과 탭 화면(라이트)의 상태바 대비 전환 |
| PKG-13b | 내비게이션 바 | `expo-navigation-bar` | **57.0.2** | 하단 시스템 내비바 색·버튼 스타일 | 테마 전환 시 `bg.base`로 맞춘다 ([[Design Tokens]] §13-6 `AppChrome`) |
| PKG-13c | 시스템 배경 | `expo-system-ui` | **57.0.1** | 루트 뷰 배경색 | 테마 전환 시 흰/검은 띠를 없애는 세 번째 손잡이 |

### 2-3. 상태 · 데이터

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-14 | 서버 상태 | `@tanstack/react-query` | **5.101.4** | 캐시, 무한스크롤, 낙관적 업데이트, 재시도 | 백엔드가 62개 엔드포인트를 가진 순수 REST다. 캐시·무효화·`useInfiniteQuery`를 직접 만들 이유가 없다. 원본 웹은 `useState`+`useEffect`로 전부 수동 처리했고 그래서 **첫 페이지 20건만 보이는 버그**가 있었다 |
| PKG-15 | 클라이언트 상태 | `zustand` | **5.0.14** | 세션, 테마, 전역 UI 플래그 | 전역 상태가 실제로 몇 개 안 된다(세션/테마/토스트큐). Context 재렌더 문제 없이 3줄로 끝난다 |
| PKG-15b | 폼 | `react-hook-form` + `zod` + `@hookform/resolvers` | **7.83.0 / 4.4.3 / 5.5.7** | 로그인·가입·필드 편집 폼 검증 | §4의 "Zod 전면 도입 미채택"과 충돌하지 않는다 — **폼 입력 검증에만** 쓰고 **서버 응답 스키마 검증에는 쓰지 않는다**(서버 응답은 관대한 수동 매퍼가 담당) |
| PKG-16 | 보안 저장소 | `expo-secure-store` | **57.0.1** | `mora_token`, `mora_user` | Android Keystore 기반. 원본 `localStorage`의 직접 대체물. **토큰은 여기 외 어디에도 두지 않는다** |
| PKG-17 | 로컬 KV | `react-native-mmkv` | **4.3.2** | 최근 검색어, 필터/뷰 모드, React Query 영속화 | 동기 API라 첫 프레임에서 바로 읽힌다(AsyncStorage는 async라 깜빡임 발생). **v4는 Nitro 기반으로 재작성되어 API가 바뀌었다 — 아래 표 참조.** New Arch 필요 |
| PKG-17b | KV 런타임 | `react-native-nitro-modules` | **0.36.1** | `react-native-mmkv` v4의 네이티브 브리지 | mmkv의 peer다. 전이 설치되기는 하지만 **명시 dependency로 선언한다** — 전이 의존은 상위 패키지가 범위를 바꾸면 조용히 사라지고, 그때 나는 에러는 "Nitro module not found" 런타임 크래시다 |
| PKG-18 | 네트워크 상태 | `@react-native-community/netinfo` | **12.0.1** | 온라인/오프라인 신호 | React Query `onlineManager`에 물려 전역 단일 소스로 사용 (FD-01). **종전 이 칸은 `expo-network`였으나 실제로는 netinfo를 설치했다** — [[Networking]] §5-1의 `probe()` 구현이 netinfo의 `isConnected`/`isInternetReachable` 구분을 전제로 이미 작성되어 있고, 그 구분이 "인터넷은 없는데 LAN 서버에는 닿는" 이 프로젝트의 기본 상황을 판정하는 핵심이다 |

**MMKV v4 API 변경 (v2/v3 예시 코드는 전부 무효다)**

| 항목 | v2 / v3 | **v4.3.2 (Nitro)** |
|---|---|---|
| 인스턴스 생성 | `new MMKV({ id })` | **`createMMKV({ id })`** — 클래스가 아니라 팩토리 함수다 |
| 키 삭제 | `storage.delete(key)` | **`storage.remove(key)`** |
| 나머지 인스턴스 API | — | `set` / `getString` / `getNumber` / `getBoolean` / `getBuffer` / `contains` / `remove` / `getAllKeys` / `clearAll` |
| 네이티브 피어 | 없음 | `react-native-nitro-modules` **필수** (PKG-17b) |

위키의 MMKV 예시가 `new MMKV(...)`나 `.delete(...)`로 적혀 있으면 그것은 v3 시절 서술이다. 정정 대상: [[Data Model]] §6-2 · [[Offline and State]] §6 · [[Auth]] §6.

### 2-4. 카메라 · 이미지 · 미디어

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-19 | 카메라 | `expo-camera` | **57.0.3** | 촬영, 권한, 플래시, 포커스 | Expo SDK 내장이라 config plugin으로 권한 문구까지 선언적으로 처리. **주의: `recordAudioAndroid: false`를 줘도 매니페스트에 `RECORD_AUDIO`를 추가한다** → `blockedPermissions`로 제거([[APK Build]] §2) |
| PKG-20 | 갤러리 | `expo-image-picker` | **57.0.6** | 앨범 선택 + 시스템 크롭(`allowsEditing`) | 원본 업로드 화면의 "앨범" 경로 대응. `READ/WRITE_EXTERNAL_STORAGE`를 `maxSdkVersion="32"`로 자동 추가하며 이는 Android 12 이하 호환용 정상 동작이다 |
| PKG-21 | 이미지 가공 | `expo-image-manipulator` | **57.0.6** | 회전/크롭/리사이즈/JPEG 압축/EXIF 제거 | **필수** — `spring.servlet.multipart.max-file-size: 10MB`. 전송 장변 1280 / q0.85 / 목표 ≤1.2MB. 규격 정본은 [[Camera and Scan]] IMG-01~07 |
| PKG-22 | 이미지 표시 | `expo-image` | **57.0.1** | 원격 썸네일, 디스크 캐시, placeholder, blurhash | `next/image` 대체물. 보관함 스크롤에서 캐시가 성능을 좌우 |
| PKG-23 | 파일 | `expo-file-system` | **57.0.1** | 임시 파일 크기 확인, 정리 | 8MB 하드 가드 판정에 실제 바이트 수가 필요. 구 API가 필요한 지점은 `expo-file-system/legacy` 서브패스로 들어간다 |

### 2-5. 인터랙션 · 모션

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-24 | 애니메이션 | `react-native-reanimated` | **4.5.0** | 워크릿 기반 60fps 모션, 레이아웃 애니메이션 | 원본의 `IntersectionObserver` 페이드인(`cubic-bezier(0.16,1,0.3,1)`)을 `Easing.bezier(0.16,1,0.3,1)`로 **동일 커브 그대로** 재현 가능. 바텀시트/제스처의 필수 피어 |
| PKG-24b | 워크릿 런타임 | `react-native-worklets` | **0.10.0** | Reanimated 4의 워크릿 실행기 | Reanimated 4에서 워크릿이 별 패키지로 분리됐다. **`babel.config.js`에 `react-native-worklets/plugin`을 직접 넣지 않는다** — `babel-preset-expo`가 이미 자동 주입하므로 중복된다(실측) |
| PKG-25 | 제스처 | `react-native-gesture-handler` | **2.32.0** | 스와이프 삭제, pan-to-close, 탭 제스처 | 바텀시트/스와이프의 필수 피어. 네이티브 스레드에서 처리 |
| PKG-26 | 바텀시트 | `@gorhom/bottom-sheet` | **5.2.14** | 문서 상세, 필터, 챗봇 도움말 | 원본 `StorageDrawer`(420px 우측 패널)의 모바일 대응물. `BottomSheetTextInput`이 키보드 회피를 해결해준다(인라인 편집 필수) |
| PKG-27 | 리스트 | `@shopify/flash-list` | **2.0.2** | 보관함 4종, 검색 결과, 알림 목록 가상화 | 명함이 수백 건이 될 수 있고 각 행에 원격 이미지가 있다. FlatList는 셀 재활용이 약해 스크롤이 끊긴다. v2는 New Arch 필요 |
| PKG-28 | 햅틱 | `expo-haptics` | **57.0.1** | 저장 성공, 삭제, 탭 전환, 셔터 | 상용 앱 품질 요구사항. Android는 `Haptics.impactAsync` |
| PKG-29 | 키보드 | `react-native-keyboard-controller` | — (미설치, Phase 3) | 편집 폼 키보드 회피 | 스캔 필드 편집(최대 12필드) + 챗봇 입력바에서 RN 기본 `KeyboardAvoidingView`는 Android 동작이 불안정하다 |

### 2-6. 인증 · 알림 · 시스템

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-30 | 웹 인증 | `expo-web-browser` | **57.0.2** | `openAuthSessionAsync`로 OAuth 창 + 콜백 URL 수신 | Android Custom Tabs를 쓰므로 사용자의 기존 구글/카카오 세션을 재사용. WebView 방식은 provider가 차단 |
| PKG-31 | 인증 유틸 | `expo-auth-session` | **57.0.5** | redirect URI 생성(`makeRedirectUri`), 파라미터 파싱 | 스킴 조립을 손으로 하지 않기 위해서. **PKCE 흐름은 쓰지 않는다** — 백엔드가 code 교환을 전담하므로 |
| PKG-32 | 딥링크 | `expo-linking` | **57.0.4** | `mora://` 스킴 등록, URL 파싱 | OAuth 착지 URL 파싱 + 알림 탭 → 화면 이동 |
| PKG-33 | 알림 | `expo-notifications` | **57.0.7** | **로컬 알림 스케줄링** | 서버에 FCM 토큰 저장 컬럼이 **없다**(원본 확인). 원격 푸시는 불가. `GET /api/notifications` 폴링 결과를 로컬 알림으로 띄운다 → [[Risks]] |
| PKG-34 | 스플래시 | `expo-splash-screen` | **57.0.5** | 세션 복원 완료까지 유지 | SecureStore 읽기가 async라 스플래시를 수동 hide 해야 깜빡임이 없다 |
| PKG-35 | 앱 상태 | `expo-constants` | **57.0.7** | `app.config.js`의 `extra` 읽기, 빌드 채널 판별 | 환경변수 정규화 지점(`src/lib/api/env.ts`) 한 곳에서만 사용 |
| PKG-36 | 클립보드 | `expo-clipboard` | **57.0.1** | 명함 전화/이메일 복사 | 명함 상세의 기본 기대 동작 |
| PKG-37 | 시스템 열기 | `expo-linking` (재사용) | **57.0.4** | `tel:`, `mailto:`, 외부 URL, 앱 설정 이동 | 권한 거부 복구 CTA(FD-10)에 필요 |
| PKG-37b | 기기 정보 | `expo-device` | **57.0.1** | 기기 모델·Android 버전 (진단 화면 SCR-31, 로컬 알림 채널 분기) | 하드코딩 대신 런타임 조회 |
| PKG-37c | 해시 | `expo-crypto` | **57.0.1** | 스캔 draft 키·요청 ID 생성 | RN에 `crypto.randomUUID`가 없다 |

### 2-7. 개발 도구

| ID | 영역 | 패키지 | 버전 | 용도 | 선정 이유 |
|---|---|---|---|---|---|
| PKG-38 | 린트 | `eslint` + `eslint-config-expo` | — (미설치, Phase 1) | 규칙 기반 정적 검사 | Expo 공식 프리셋이 RN/Expo 특유 규칙(`react-hooks`, `react-native`)을 이미 담고 있다. `package.json`에 `"lint": "expo lint"` 스크립트는 이미 있고, 최초 실행 시 `expo lint`가 설치를 유도한다 |
| PKG-39 | 포맷 | `prettier` + `prettier-plugin-tailwindcss` | — (미설치, Phase 1) | 포맷 + className 정렬 | NativeWind 클래스 순서를 사람이 다투지 않게 |
| PKG-40 | 타입 검사 | `tsc --noEmit` (`npm run typecheck`) | — | CI 게이트 | 별도 패키지 불필요. **Phase 0에서 통과 확인됨** |
| PKG-41 | 아이콘/에셋 | `@expo/vector-icons` (expo 동봉) | expo 동봉 | lucide에 없는 브랜드 아이콘 대체 | 이미 설치되어 있음. 신규 의존 없음 |
| PKG-42 | Babel 프리셋 | `babel-preset-expo` | **57.0.4** (devDependency) | `babel.config.js`의 프리셋 | **명시 선언이 필수다.** SDK 57은 이 프리셋을 `node_modules/expo/node_modules/babel-preset-expo`에 **중첩 설치**하므로, 우리가 만든 `babel.config.js`에서 bare name `'babel-preset-expo'`를 해석하지 못하고 `Cannot find module 'babel-preset-expo'`로 번들이 죽는다(실측). NativeWind는 `babel.config.js`를 요구하므로 **이 문제를 반드시 만난다** |
| PKG-43 | 개발 클라이언트 | `expo-dev-client` | **57.0.9** | 커스텀 dev client 런타임 | New Arch 강제 + 네이티브 모듈 다수라 Expo Go가 불가능하다(§4). **부작용: 매니페스트에 `SYSTEM_ALERT_WINDOW`를 추가**하므로 개발 외 변형에서는 `blockedPermissions`로 제거한다([[APK Build]] §2) |
| PKG-44 | 빌드 속성 | `expo-build-properties` | **57.0.7** | `minSdkVersion`, `usesCleartextTraffic`, R8 옵션 | 네이티브 gradle 값을 config plugin으로만 다루는 유일한 경로 |
| PKG-45 | 웹 피어 (설치 전용) | `react-dom` + `react-native-web` | **19.2.3 / 0.21.x** | **직접 쓰지 않는다** | **없으면 `npm ERESOLVE`로 설치 자체가 실패한다.** `expo-router 57`이 `vaul`·`@radix-ui/*` 같은 웹 의존을 끌어오고 그들의 peer가 `react-dom`이다. Android 전용 앱이라 불필요해 보이지만 설치 성립 조건이다. **Metro는 import된 것만 번들하므로 APK 용량 영향은 없다**(실측 번들 1753 모듈에 포함되지 않는다) |

**Android 전용인데 웹 패키지를 넣는 것이 이상하지 않은가** — 이상하다. 하지만 npm 의존성 해석은 "번들에 들어가는가"가 아니라 "peer 제약을 만족하는가"만 본다. 두 패키지를 빼면 `npm install` 단계에서 멈추므로 선택지가 없다. 대안(`--legacy-peer-deps`)은 다른 peer 위반도 함께 숨기므로 채택하지 않는다.

---

## 3. 원본 웹 스택 ↔ 모바일 스택 대응표

| 원본 웹 (`Mora/frontend`) | 모바일 | 이식 난이도 | 비고 |
|---|---|---|---|
| Next.js 15 App Router | `expo` + `expo-router` | 중 | 파일=라우트 모델 유지, RSC/SSR 소멸 |
| `app/**/page.tsx`, `layout.tsx` | `app/**/index.tsx`, `_layout.tsx` | 하 | 이름만 바뀜 |
| `next/navigation` `useRouter/usePathname` | `expo-router` `useRouter/usePathname` | 하 | API 이름이 거의 동일 |
| `next/link` `<Link href>` | `expo-router` `<Link href>` | 하 | 동일 |
| `next/image` | `expo-image` | 중 | `fill`/`sizes` 개념 없음 → `contentFit` + 고정 비율 |
| `next/font` (Patua One, Noto Sans KR) | `expo-font` + ttf 번들 | 중 | Pretendard를 **실제로** 추가 |
| Tailwind v4 `@theme inline` | NativeWind 4.2.6 + **tailwindcss 3.4.x** `tailwind.config.js` preset | 중 | CSS 변수 → preset 토큰으로 재정의. **버전 번호가 우연히 같아 혼동하기 쉽다**: 원본 웹은 Tailwind **4**, 우리는 NativeWind **4** + Tailwind **3.4**다 (PKG-08) |
| 인라인 `style={{}}` (코드의 약 90%) | NativeWind `className` | 상 | 페이지별 로컬 팔레트 `const C = {...}` 5벌을 토큰 1벌로 통합 |
| `lucide-react` | `lucide-react-native` | 하 | 아이콘 이름 동일. 단 원본의 `Astroid` import는 **lucide에 없는 이름**이므로 대체 지정 필요 |
| `localStorage` (`mora_token`/`mora_user`/`mora_settings_prefs`) | `expo-secure-store`(토큰·유저) + `react-native-mmkv`(prefs) | 중 | 동기 → 비동기 전환 |
| `window.dispatchEvent('mora-session-change')` + `useSyncExternalStore` | `zustand` store 구독 | 중 | window 이벤트 4종(`storage`/`mora-session-change`/`pageshow`/`focus`) 개념 소멸. 포그라운드 복귀는 `AppState` |
| `useState` + `useEffect` 수동 fetch | `@tanstack/react-query` | 상 | 로딩/에러/재요청/페이지네이션이 전부 훅으로 이동 |
| `lib/api.ts` (함수 40여 개, 예외를 던지지 않고 `ApiResponse` 반환) | `src/lib/api/` (`client` + `endpoints/`) + `src/lib/adapters/` | 중 | **반환 규약을 바꾼다**: 성공값을 반환하고 실패는 `ApiError`를 throw → React Query가 처리 |
| `process.env.NEXT_PUBLIC_*` | `process.env.EXPO_PUBLIC_*` + `app.config.js extra` | 하 | 둘 다 빌드 타임 인라인 |
| `<div className="grid">` + `.map()` | `@shopify/flash-list` | 중 | 무한 스크롤/빈 상태/새로고침 신규 구현 |
| `StorageDrawer` (우측 420px 패널) | `@gorhom/bottom-sheet` | 중 | 필드 스키마(`StorageDrawerField`)는 **그대로 재사용 가능** |
| `ConfirmPopover` (176px 팝오버) | `Alert.alert` destructive / 컨펌 시트 | 하 | 문구 `삭제하시겠습니까?` / `확인` / `취소` 유지 |
| `ChatbotWidget` (드래그 가능 플로팅 패널) | FAB + 전체화면 모달 라우트 | 상 | 드래그·clampPosition·resize·hover 툴팁·TOP 버튼 전부 폐기 |
| `Nav` (fixed 상단 + 앵커 스크롤) | 하단 탭 + 화면별 네이티브 헤더 | 상 | 랜딩 앵커(`#how`, `#features`)는 온보딩으로 흡수 |
| 브라우저 OAuth 리다이렉트 | `expo-web-browser` + `mora://` 딥링크 | 상 | [[Architecture]] §3-1 |
| CSS `@keyframes` / `transition` | `react-native-reanimated` | 중 | 커브 값 그대로 이식 가능 |
| — (없음) | `expo-haptics`, `expo-notifications`, `react-native-safe-area-context` | 신규 | 모바일 관용구 |

---

## 4. 채택하지 않은 것과 이유

| 후보 | 판정 | 이유 |
|---|---|---|
| **Redux Toolkit** | 미채택 | 전역 클라이언트 상태가 세션/테마/토스트 3개뿐이다. 서버 상태는 React Query가 가진다. 슬라이스·액션·셀렉터 보일러플레이트가 실익 없이 파일 수만 늘린다 |
| **Redux + RTK Query** | 미채택 | RTK Query를 쓰면 React Query와 역할이 겹친다. 무한스크롤·낙관적 업데이트 문서화 성숙도는 React Query 쪽이 앞선다 |
| **styled-components / emotion** | 미채택 | 원본이 Tailwind 어휘로 되어 있어 클래스명 이식이 곧 스타일 이식이다. 런타임 스타일 객체 생성 비용도 리스트 스크롤에 불리 |
| **StyleSheet.create 전면 사용** | 미채택(부분 허용) | 원본 인라인 style 객체는 기계적 변환이 쉽지만, 5벌로 파편화된 팔레트를 그대로 옮기게 된다. **토큰 강제**를 위해 NativeWind로 단일화. 단 애니메이션 스타일과 동적 계산 스타일은 예외 → [[Conventions]] CV-08 |
| **React Navigation 직접 사용** | 미채택 | expo-router가 내부적으로 React Navigation을 쓴다. 직접 쓰면 원본의 파일=라우트 대응이 깨지고 딥링크 설정(`mora://`)을 손으로 짜야 한다. 저수준 옵션이 필요하면 expo-router의 `Stack.Screen options`로 전부 도달 가능 |
| **Firebase (Auth / Firestore / FCM)** | 미채택 | 백엔드가 이미 JWT 발급·OAuth 교환·데이터 저장을 전부 한다. Firebase Auth를 넣으면 사용자 신원이 두 곳으로 갈라진다. FCM은 **서버에 device token 저장 컬럼이 없어** 지금 붙일 수 없다 → 로컬 알림으로 대체 |
| **Expo Go 개발** | 미채택 | SDK 57은 New Architecture가 강제이고, MMKV v4는 Nitro 네이티브 모듈이라 Expo Go에서 아예 동작하지 않는다. development build(`expo-dev-client`)로 간다 |
| **`tailwindcss` 4.x** | 미채택 | NativeWind 4.2.6의 peer 범위(`> 3.3.0`)는 4.x를 허용하지만 **실제 지원이 없다.** Tailwind 4 지원은 `nativewind@5.0.0-preview.4` 계열뿐이고, preview를 v1 스타일 기반으로 삼으면 페이즈 1~7 전체가 그 위에 쌓인다. → `tailwindcss@3.4.x` 고정(VR-7). **재검토 트리거: nativewind 5 정식 릴리스** ([[Risks]] RSK-33) |
| **`react-native-worklets/plugin` 직접 추가** | 미채택 | `babel-preset-expo 57`이 reanimated/worklets 플러그인을 자동 주입한다. 직접 넣으면 중복 등록된다(실측) |
| **로컬 Android 빌드(`eas build --local` / `expo run:android`)** | 미채택(현재 불가) | 개발 PC에 Android SDK·JDK가 없다(§1 주의). 설치하면 가능해지지만 그것은 15GB+ 툴체인 도입 결정이므로 [[APK Build]] §6에 선행 조건으로만 남기고, v1의 기본 경로는 EAS 클라우드 빌드다 ([[Risks]] RSK-35) |
| **AsyncStorage** | 미채택 | 비동기라 앱 부팅 첫 프레임에 테마/필터가 늦게 적용되어 깜빡인다. MMKV는 동기 |
| **Axios** | 미채택 | RN `fetch`로 충분하고, 인터셉터가 필요한 지점(Bearer 주입·언랩·401)이 명확해 30줄짜리 래퍼로 끝난다. multipart 처리도 fetch가 더 예측 가능 |
| **Zod / Yup 전면 도입** | 미채택(선택적) | 서버 응답 스키마가 컨트롤러마다 불규칙하다(같은 필드가 요청 `List<String>` / 응답 `String`, 날짜가 `string \| number[]`). 전량 스키마 검증을 걸면 실패만 늘어난다. **관대한 수동 매퍼**를 서비스 레이어에 두는 편이 안전 |
| **react-native-vision-camera** | 미채택 | 프레임 프로세서(온디바이스 OCR)가 필요 없다. 서버가 OCR을 한다. `expo-camera`가 SDK 정렬 + config plugin 이점이 크다 |
| **Detox / Maestro E2E** | 미채택(Phase 8 이후 재검토) | 화면 9개 이식이 우선. 수동 QA 체크리스트로 커버 → [[QA Checklist]] |
| **웹뷰로 기존 프론트 감싸기** | 미채택 | 원본이 `minWidth:1200` 하드코딩, 절대좌표 880×560 로그인, 드래그 팝오버 등 데스크톱 전용 UX 투성이다. "실제 상업앱 수준" 목표와 정면 충돌 |
| **Redux Persist / MMKV 전면 오프라인 DB (WatermelonDB, SQLite)** | 미채택 | 목표는 오프라인 열람이지 오프라인 편집이 아니다. React Query persister(MMKV)로 충분 → [[Offline and State]] |

---

## 5. 툴체인 (개발 PC)

| 항목 | 값 | 현재 상태 (2026-07-27 실측) | 근거 |
|---|---|---|---|
| Node.js | LTS(짝수 메이저) | 설치됨 | Expo CLI가 LTS를 요구. 홀수 메이저는 지원 밖 |
| 패키지 매니저 | `npm` | 설치됨 | `create-expo-app` 기본값. 팀에 pnpm/yarn 규약이 없으므로 기본값 유지 |
| JDK | 17 또는 21 | **미설치** (`JAVA_HOME` 없음) | Android Gradle Plugin 요구. 로컬 빌드에만 필요 |
| Android SDK | Platform 35 + Build-Tools + Platform-Tools | **미설치** (`ANDROID_HOME`·`ANDROID_SDK_ROOT` 없음) | 로컬 `expo run:android`·`adb`에 필요. **EAS 클라우드 빌드만 쓰면 불필요** |
| `keytool` | JDK 동봉 | **없음** → keystore가 **EAS 클라우드에서 생성**되었다 | 로컬 keystore 생성·검증(`apksigner`)이 현재 불가 |
| EAS CLI | **`npx eas-cli@latest`** | 21.3.0으로 검증 | 전역 설치 금지. `npx eas-cli`(버전 미지정)는 캐시된 21.1.0을 실행하고 TS 6 프로젝트에서 실패한다(PKG-06) |
| git | 선택 | **저장소 아님** | `EAS_NO_VCS=1` + `EAS_PROJECT_ROOT`로 빌드는 성립한다([[APK Build]] §1) |
| OS | Windows 11 | — | 개발 PC 환경. Android 전용 산출물이므로 macOS 불필요 |

**귀결 —** 현재 PC 상태에서 가능한 것은 **EAS 클라우드 빌드뿐이고, 실기기 설치는 QR/브라우저 다운로드 경로로만 가능하다**(`adb`가 없다). `adb logcat`·`dumpsys`를 쓰는 [[QA Checklist]] §5의 성능 측정 절차는 Platform-Tools 설치가 선행 조건이다.

---

## 6. 설치 순서 (Phase 0 실행 결과 반영)

아래는 **Phase 0에서 실제로 통과한 순서**다. 순서를 바꾸면 §7의 함정을 밟는다.

```bash
# 1. 프로젝트 생성 (SDK 베이스라인 확정 → 실측 결과 SDK 57.0.8)
npx create-expo-app@latest . --template default

# 2. 스타일 — tailwind 는 반드시 3.4 로 고정 (VR-7)
npx expo install nativewind react-native-reanimated react-native-worklets \
                 react-native-safe-area-context react-native-screens
npm install --save-dev tailwindcss@3.4

# 3. Babel 프리셋을 명시 선언 (VR-8) — 이게 없으면 NativeWind 설정 직후 번들이 죽는다
npm install --save-dev babel-preset-expo

# 4. 웹 피어 — Android 전용인데도 필요하다 (PKG-45). 없으면 npm ERESOLVE
npx expo install react-dom react-native-web

# 5. 상태 · 데이터
npx expo install expo-secure-store react-native-mmkv react-native-nitro-modules \
                 @react-native-community/netinfo
npm install @tanstack/react-query zustand react-hook-form zod @hookform/resolvers

# 6. 카메라 · 이미지
npx expo install expo-camera expo-image-picker expo-image-manipulator expo-image expo-file-system

# 7. 인터랙션 · 리스트
npx expo install react-native-gesture-handler expo-haptics
npm install @gorhom/bottom-sheet @shopify/flash-list

# 8. 인증 · 시스템
npx expo install expo-web-browser expo-auth-session expo-linking expo-notifications \
                 expo-splash-screen expo-constants expo-font expo-clipboard \
                 expo-status-bar expo-system-ui expo-navigation-bar expo-device expo-crypto \
                 expo-dev-client expo-build-properties

# 9. SVG
npx expo install react-native-svg

# 10. 검증
npx expo install --check
npx expo-doctor
npx tsc --noEmit                                   # Phase 0에서 통과 확인
npx expo export --platform android                 # 번들 성립 확인 (실측 1753 모듈 / Hermes 3.79MB)
```

**Phase 1 착수 시 추가할 것** — `lucide-react-native`, `eslint`+`eslint-config-expo`, `prettier`+`prettier-plugin-tailwindcss`, Pretendard/Patua One 폰트 파일.

### 6-1. 설치 중 만나는 함정 4개 (전부 실측)

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | `npm ERESOLVE` — peer `react-dom` 없음 | `expo-router 57`이 `vaul`·`@radix-ui/*` 웹 의존을 끌어온다 | `react-dom` + `react-native-web` 설치 (PKG-45). `--legacy-peer-deps`로 덮지 않는다 |
| 2 | `Cannot find module 'babel-preset-expo'` | SDK 57이 프리셋을 `expo/node_modules/` 하위에 중첩 설치한다 | `babel-preset-expo`를 devDependency로 명시 (PKG-42) |
| 3 | 워크릿 플러그인 중복 등록 | `babel-preset-expo`가 이미 자동 주입한다 | `babel.config.js`에서 `react-native-worklets/plugin`을 **빼둔다** (PKG-24b) |
| 4 | 다크 테마 색이 안 먹거나 `@theme` 문법 오류 | `tailwindcss` 4.x가 설치됨 | `tailwindcss@3.4`로 되돌린다 (VR-7 / PKG-08) |

**결정:** 위 순서를 실행한 뒤 `npx expo-doctor`가 경고를 내면 **경고를 없앤 뒤에** Phase 0 완료 판정으로 넘어간다. → [[Phases]]
