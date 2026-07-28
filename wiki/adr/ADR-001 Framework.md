# ADR-001 Framework

MORA 모바일 앱을 Expo(React Native) + TypeScript로 구현하고 EAS Build로 APK를 산출한다.

상위: [[Architecture]]
관련: [[Tech Stack]] · [[ADR-003 Navigation]] · [[ADR-004 Styling]] · [[ADR-005 State and Data]] · [[APK Build]] · [[Phases]]

---

## 상태

**Accepted** — 2026-07-27. 사용자가 직접 선택. [[Phases]]의 Phase 0이 이 결정을 전제로 구성되어 있다.
**Validated** — 2026-07-27. **Phase 0 실행으로 이 결정이 실물에서 성립함이 확인되었다**: Expo 프로젝트 생성 → NativeWind 연쇄 검증(번들 1753 모듈) → `tsc --noEmit` 통과 → EAS 연결·keystore 생성 → `preview` APK 빌드 제출. 확정 버전과 그 과정에서 드러난 제약은 §결정·§결과에 반영했다.

---

## 맥락

| 사실 | 내용 | 근거 |
|---|---|---|
| 기존 자산 | Next.js(App Router) + React + TypeScript 웹 프론트엔드 9화면. 컴포넌트 18개, `lib/api.ts`에 API 래퍼 전량 | 원본: `Mora/frontend/` |
| 백엔드 | Spring Boot(:8080) / Python OCR(:8000) / Python LLM(:8001). **무수정 사용이 전제** | [[ADR-002 Backend Connectivity]] |
| 산출물 | 배포 가능한 **APK 1개** (iOS는 범위 밖) | 사용자 확정 |
| 품질 목표 | 상업앱 수준 — 하단 탭, 바텀시트, 제스처, 세이프에어리어, 햅틱, 스켈레톤, 낙관적 업데이트 | 사용자 확정 |
| 핵심 기능 | 카메라 촬영 → 이미지 압축 → 멀티파트 업로드 → OCR 결과 폼 편집 → 저장 | [[Camera and Scan]] |
| 팀 | React/TypeScript 경험 보유. Dart/Kotlin/Swift 자산 없음 | 원본 코드베이스 구성 |
| 제약 | 기간·인원이 한정된 팀 프로젝트. 네이티브 빌드 환경(Xcode/Android Studio) 유지 비용을 최소화해야 함 | |

해결해야 할 질문: **어떤 프레임워크가 (a) 기존 React/TS 자산 재사용률이 가장 높고, (b) 카메라·이미지 처리·멀티파트 업로드를 1급으로 지원하며, (c) 네이티브 툴체인 없이 APK를 뽑을 수 있는가.**

---

## 검토한 대안

| 대안 | 장점 | 단점 | 기각 이유 |
|---|---|---|---|
| **Expo (React Native, managed)** | React/TS 그대로. `expo-camera`·`expo-image-picker`·`expo-image-manipulator`·`expo-file-system`·`expo-secure-store`가 모두 1급 모듈. EAS Build가 클라우드에서 APK 산출 → 로컬 Android SDK 불필요. OTA 업데이트. expo-router로 파일 기반 라우팅(Next.js App Router와 사고방식 동일) | 네이티브 모듈을 추가하면 prebuild/dev client가 필요. JS 런타임 오버헤드. Expo SDK 업그레이드 주기를 따라가야 함. EAS 무료 티어는 빌드 큐 대기 발생 | **채택** |
| **Flutter** | 렌더링 성능·애니메이션 품질 최상. 단일 코드베이스로 iOS/Android 동등. 카메라·이미지 플러그인 성숙 | **Dart 재작성 = React/TS 자산 0% 재사용.** 타입 정의(`ApiResponse<T>`, `ScanResult`, `RawBlock`, 4종 문서 DTO), API 래퍼, 한국어 카피, 필드 스키마·검증 규칙까지 전부 다시 짜야 한다. 팀 학습 곡선 | **자산 재사용 0%**. 9화면 + OCR 필드 스키마 4종 + 검증 규칙을 Dart로 재작성하는 비용이 전체 일정을 지배한다 |
| **Capacitor (웹 래핑)** | 기존 Next.js 화면을 거의 그대로 담을 수 있음. 가장 빠른 1차 산출 | 화면이 전부 **데스크톱 고정폭**이라 그대로 담아도 못 쓴다(`minWidth:1200` 루트, `880×560` 절대좌표 로그인, `w-[415.5px]` 폼). 결국 재작성. 웹뷰 카메라는 `<input capture>` 수준이라 가이드 프레임·플래시·`pictureSize` 제어 불가. 스크롤/제스처/키보드 회피가 네이티브 관례와 어긋남 | **"상업앱 수준"과 정면 충돌.** 재사용의 이점이 재레이아웃 필요성으로 소멸하고, 남는 건 웹뷰 UX 페널티뿐 |
| **Bare React Native (Expo 없이)** | 네이티브 모듈 자유. 빌드 파이프라인 완전 통제 | 카메라·이미지 조작·보안 저장소·파일 업로드를 개별 커뮤니티 패키지로 조립하고 링킹·권한·ProGuard를 직접 관리해야 함. 로컬 Android SDK/NDK 환경 필수 | **Expo가 제공하는 것을 직접 조립하는 비용**만 추가되고 이득이 없다. 필요해지면 `expo prebuild`로 언제든 내려갈 수 있으므로 미리 내려갈 이유가 없다 |
| **PWA (설치형 웹)** | 배포 비용 0. 코드 1벌 | APK 산출물 요구사항 불충족. Android PWA는 카메라 세밀 제어·백그라운드 업로드·SecureStore 등가물이 없다. 평문 HTTP LAN 서버 접근 시 서비스워커/보안 컨텍스트 제약 | **산출물 요구(APK)를 만족하지 못한다** |

---

## 결정

**Expo (React Native) 관리형 워크플로 + TypeScript**를 채택한다.

| 구성요소 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | **Expo SDK 57.0.8** (RN 0.86.0 / React 19.2.3) — Phase 0에서 실측 고정 | 버전 정본은 [[Tech Stack]] §2-0. **New Architecture는 SDK 57에서 강제**이며 `newArchEnabled` 키 자체가 제거되었다 |
| 언어 | TypeScript **6.0.3** strict | 웹 `types/index.ts`의 DTO 타입을 이식. **부작용: eas-cli가 `app.config.ts` 를 트랜스파일하다 죽어 app config를 `.js` 로 두게 되었다**([[Risks]] RSK-34) |
| 라우팅 | `expo-router` **57.0.8** | [[ADR-003 Navigation]] |
| 스타일 | NativeWind **4.2.6** + tailwindcss **3.4.x 고정** | [[ADR-004 Styling]]. Tailwind 4는 쓸 수 없다([[Risks]] RSK-33) |
| 상태/데이터 | TanStack Query v5 + zustand | [[ADR-005 State and Data]] |
| 빌드 | EAS Build → `.apk` (`buildType: apk`) — **클라우드 빌드가 유일한 경로** | [[APK Build]]. 개발 PC에 Android SDK·JDK가 없다([[Risks]] RSK-35) |
| 타깃 | Android 우선. iOS는 코드 호환만 유지하고 빌드/심사는 범위 밖 | |

**재사용하는 웹 자산 (재작성하지 않는 것):**
- 타입: `ApiResponse<T>`, `DocumentType`, `ScanResult`, `RawBlock`, 4종 문서 DTO
- API 계약 지식과 우회 로직: 이중 래핑 언랩, Spring `Page<>` 파싱, `LocalDateTime` 배열 정규화, `parseMoney`
- 도메인 상수: `DOCUMENT_FIELD_SCHEMAS`, `COMMON_FIELD_MAP`, `TYPE_LABELS`, 문서 종류 색상
- 한국어 UI 카피 전량

**재작성하는 것:** 레이아웃·인터랙션 전부. 원본 화면은 데스크톱 고정폭 설계이므로 픽셀 단위 이식 대상이 아니다.

---

## 결과

### 긍정
1. React/TS 사고방식과 타입 자산이 그대로 이어져 학습 비용이 사실상 0이다.
2. `expo-camera` + `expo-image-manipulator` + `expo-file-system` 조합만으로 [[Camera and Scan]]의 파이프라인 전체(촬영·압축·진행률 있는 멀티파트 업로드·취소)를 커버한다. 서드파티 조립이 없다.
3. EAS Build 덕분에 로컬에 Android Studio/SDK가 없어도 APK가 나온다. **이 이점은 Phase 0에서 실증되었다** — 개발 PC에 `ANDROID_HOME`·`JAVA_HOME`·`keytool`·`adb` 가 **하나도 없는 상태로** 프로젝트 생성부터 `preview` APK 빌드 제출까지 통과했다(keystore도 EAS가 클라우드에서 생성). 이 결정을 Flutter나 Bare RN로 했다면 Phase 0의 첫 작업이 15GB 툴체인 설치였을 것이다.
4. `expo-router`가 Next.js App Router와 파일 규약이 유사해 원본 라우트 트리(`/dashboard/storage/cards` 등)를 자연스럽게 매핑한다.
5. 개발 중 Expo Go / dev client로 실기기 핫리로드가 가능해 LAN 직결 백엔드와의 통합 테스트가 빠르다.

### 부정
1. **네이티브 모듈 추가 시 관리형 워크플로를 벗어난다.** 예를 들어 문서 원근 보정 플러그인을 넣으면 `expo prebuild` + dev client 재빌드가 필요하다 → [[Camera and Scan]] §5에서 v1 범위 밖으로 밀어낸 이유.
2. **APK 크기가 커진다.** Hermes + Expo 모듈 번들로 순수 네이티브 대비 수십 MB 크다. 완화: `buildType: apk` + R8/ProGuard + 미사용 Expo 모듈 제거 → [[APK Build]].
3. **Expo SDK 버전에 종속된다.** SDK 53에서 `expo-image-manipulator` 컨텍스트 API 도입, SDK 54에서 `expo-file-system` 신규 API 전환처럼 breaking change가 주기적으로 온다. **SDK 57에서 실제로 만난 것 4건**(Phase 0 실측): `newArchEnabled`·`android.edgeToEdgeEnabled` config 키 **제거**, `babel-preset-expo` 중첩 설치로 bare name 해석 실패, `expo-router` 가 웹 의존(`react-dom`)을 peer로 강제, `react-native-mmkv` v4의 Nitro 전환에 따른 API 파괴(`new MMKV` → `createMMKV`, `delete` → `remove`). 완화: Phase 0에서 SDK 버전을 고정하고([[Tech Stack]] §2-0 스냅샷) 프로젝트 기간 중 올리지 않는다. 최신 라인을 고른 대가는 [[Risks]] RSK-36으로 분리 관리한다.
4. **EAS 무료 티어 빌드 큐 대기**가 릴리스 일정을 흔들 수 있다. **그리고 이 프로젝트에서는 로컬 빌드 대안이 없다** — 개발 PC에 Android SDK·JDK가 설치되어 있지 않아 `eas build --local`·`expo run:android` 가 동작하지 않는다([[Risks]] RSK-35). 완화: 일상 개발을 dev client 1개로 끝내 클라우드 호출을 줄이고, Phase 0에서 1회·Phase 8에서 릴리스 빌드를 미리 예행한다. **실측 큐 대기 약 15분.**
5. Expo Go에서는 일부 네이티브 동작(백그라운드 업로드 세션 등)이 실제 APK와 다르게 동작할 수 있다. 완화: 스캔 파이프라인은 **반드시 실제 APK로 검증**한다 → [[QA Checklist]].

---

## 재검토 트리거

1. 실사용 스캔 재촬영률이 25%를 넘어 **원근 보정 네이티브 모듈**이 필요해질 때 → `expo prebuild`로 내려갈지 결정.
2. 스캔 화면·목록 스크롤에서 **60fps를 지속적으로 못 지킬 때** → 해당 화면만 네이티브로 분리할지 검토.
3. **iOS 출시**가 범위에 들어올 때 → 현 구성 그대로 iOS 빌드가 가능한지 재확인(현 결정은 iOS 호환을 깨지 않는 선택이므로 재검토 강도는 낮다).

---

## 2026-07-28 보강 — iOS 호환 유지 의무

팀 결정: **iOS 는 출시하지 않되, 나중에 켤 수 있도록 코드 호환을 유지한다.** Expo 를 고른 이 결정 덕에 추가 비용은 거의 없지만, 무의식중에 깨질 수 있으므로 규칙으로 못 박는다.

| 의무 | 위반 예 |
|---|---|
| Android 전용 네이티브 모듈 도입 금지 | iOS 미지원 라이브러리를 넣는 순간 iOS 경로가 막힌다. 현재 채택 패키지는 **전부 iOS 지원** |
| `Platform.OS` 분기를 한 곳에 모은다 | 화면 코드 곳곳에 흩뿌리면 나중에 iOS 분기를 추가할 지점을 찾지 못한다 |
| iOS 에서 달라지는 지점에 주석을 남긴다 | SecureStore(Keychain 접근성 옵션), ATS(평문 HTTP 차단 — LAN 개발 불가), OAuth 콜백(`ASWebAuthenticationSession`), 권한 문구(Info.plist), **하드웨어 백버튼 부재**(FR-099 가 iOS 에선 무의미) |

**하지 않는 것**: iOS 빌드·실기기 검증·App Store 등록·Apple 개발자 계정 확보. [[Scope]] Deferred D-4.
4. Expo SDK가 **핵심 모듈을 제거/대체**하는 메이저 변경을 낼 때. (SDK 57이 `newArchEnabled`·`edgeToEdgeEnabled` 키를 제거한 것은 이 범주에 들지 않는다 — 기능이 사라진 것이 아니라 **강제 기본이 되어 플래그가 불필요해진** 것이다.)
5. **EAS 클라우드 빌드가 장기간 막힐 때** → Android 툴체인 설치로 로컬 빌드 경로를 개설할지 결정([[Risks]] RSK-35). 현재는 실측 큐 대기 15분이라 트리거되지 않았다.
