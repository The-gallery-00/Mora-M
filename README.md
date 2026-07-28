# MORA Mobile

기존 MORA 웹 서비스(명함·포스터·영수증·티켓 OCR 보관함)를 **Android 네이티브 앱**으로 이식하는 프로젝트. 종이를 카메라로 찍으면 즉시 OCR·분류·구조화되어 저장되고, 자연어로 다시 찾을 수 있다.

**현재 상태: 요구사항 정의 완료 · Phase 0 실행 완료 (2026-07-27) · 잔여 확인 3건.**

Expo 앱 소스가 존재하고 `preview` APK가 EAS에 빌드 제출되었다. 남은 것은 **실기기 설치 확인**과 **진단 화면에서 두 서버 응답 확인** 두 건이며(폰 + 서버 기동 + 같은 Wi-Fi가 동시에 필요), Pretendard 폰트 번들은 Phase 1로 이관되었다. 상세는 [wiki/delivery/Phases.md](wiki/delivery/Phases.md) Phase 0 "실행 결과".

---

## 1. 왜 만드는가

원본 MORA 웹앱은 대시보드 루트에 `minWidth: 1200`이 걸린 **데스크톱 전용**이고, 업로드 입력에 `capture` 속성이 없어 **폰 카메라 경로가 아예 없다.** 즉 사용자가 종이를 손에 든 바로 그 순간에는 쓸 수 없다. 모바일 앱은 그 격차를 메우는 것이 존재 이유다.

부수적으로, 백엔드에 이미 있는데 웹이 안 쓰는 기능(영수증 실 API, 알림 7종, 대시보드 조립 API, 최근 검색어, 무한 스크롤)을 앱이 **먼저 구현**한다. 서버 수정 없이 가능하다.

---

## 2. 산출물 디렉토리 구조

```
MORA_mobile/
├─ README.md                    ← 이 파일. 프로젝트 진입점
├─ app/                         ← expo-router 라우트 (Phase 0: 루트 레이아웃 + SCR-01 + SCR-31)
├─ src/                         ← 앱 코드 (구조 정본: wiki/tech/Directory Structure.md)
├─ assets/                      ← 아이콘·스플래시·폰트
├─ scripts/                     ← gen-theme-css.ts 등
├─ app.config.js                ← Expo 동적 설정 (★ .ts 가 아니다 — RSK-34)
├─ eas.json                     ← development / preview / production 3프로파일
├─ .easignore                   ← EAS 업로드 제외 (wiki/·/android 필수)
├─ babel.config.js              ← babel-preset-expo + nativewind/babel
├─ metro.config.js · tailwind.config.js · tsconfig.json · nativewind-env.d.ts
└─ wiki/                        ← 설계 산출물 29개 문서 (Obsidian 위키링크)
   ├─ Home.md                   ← ★ 위키 진입점. 여기부터 읽는다
   ├─ product/                  무엇을 왜 만드는가
   │  ├─ PRD.md                 문제·페르소나·KPI
   │  ├─ Requirements.md        FR-001~130 / NFR-001~029  ← FR·NFR 정본
   │  ├─ User Stories.md        US-01~40 (에픽 8개)
   │  └─ Scope.md               In / Out / Deferred
   ├─ design/                   무엇을 그리는가
   │  ├─ Screen Specs.md        SCR-01~31 전 화면 정의서  ← 화면 정본
   │  ├─ Component Library.md   CMP-01~52 컴포넌트 인벤토리
   │  ├─ Design Tokens.md       색(라이트·다크 2벌)·타이포·간격·elevation 정본
   │  ├─ Navigation Map.md      라우트 트리(경로 정본)·탭·딥링크 DL-01~10
   │  └─ Mobile UX Guide.md     웹→네이티브 변환 규범 UX-##
   ├─ tech/                     어떻게 만드는가
   │  ├─ Architecture.md        시스템 경계·레이어·데이터 흐름
   │  ├─ Tech Stack.md          PKG-## 패키지 전수·버전 규칙
   │  ├─ Directory Structure.md 앱 폴더 트리·네이밍·별칭
   │  ├─ API Contract.md        API-01~67 전수 계약      ← API 정본
   │  ├─ Data Model.md          엔티티↔TS타입↔OCR 필드 키
   │  ├─ Auth.md                로그인·OAuth 딥링크·세션
   │  ├─ Camera and Scan.md     촬영→압축→OCR→저장 파이프라인
   │  ├─ Offline and State.md   상태 4계층·캐시·낙관적 업데이트
   │  ├─ Networking.md          LAN 연결·프로파일·타임아웃·재시도
   │  └─ Conventions.md         CV-## 코딩 규약
   ├─ delivery/                 언제 어떻게 내는가
   │  ├─ Phases.md              Phase 0~8 실행 대본      ← 페이즈 정본
   │  ├─ QA Checklist.md        테스트 시나리오·기기 매트릭스
   │  ├─ APK Build.md           EAS·keystore·서명·배포
   │  └─ Risks.md               RSK-## 리스크 등록부
   └─ adr/                      왜 그렇게 정했나 (전부 Accepted)
      ├─ ADR-001 Framework.md
      ├─ ADR-002 Backend Connectivity.md
      ├─ ADR-003 Navigation.md
      ├─ ADR-004 Styling.md
      └─ ADR-005 State and Data.md
```

Phase 0이 시작되면 여기에 Expo 앱 소스(`app/`, `src/`, `assets/`, `app.config.ts`, `eas.json`)가 추가된다. 앱 내부 폴더 구조는 [wiki/tech/Directory Structure.md](wiki/tech/Directory%20Structure.md)에 확정되어 있다.

---

## 3. 위키 진입점

**[`wiki/Home.md`](wiki/Home.md) 부터 읽는다.** 읽는 순서 가이드, 문서 색인, 관계도, ID 체계가 전부 거기 있다.

Obsidian으로 `wiki/` 폴더를 vault로 열면 위키링크와 그래프 뷰가 동작한다. 링크는 폴더 경로 없이 파일명으로만 쓴다(`[[Screen Specs]]`).

급할 때의 최소 경로: `Requirements` §0 → `Screen Specs` §0 → `API Contract` §2 → `Phases` Phase 0.

---

## 4. 확정 스택 · 의사결정 요약

| 축 | 확정값 | 근거 |
|---|---|---|
| 프레임워크 | **Expo(React Native) 관리형 + TypeScript strict**, Expo SDK 54+, New Architecture ON | ADR-001 |
| 산출물 | 개발·내부 테스트 **release APK**(사이드로드) / 스토어 제출 **AAB** | ADR-001 |
| 백엔드 | 기존 Spring `:8080` · Python OCR `:8000` **무수정**. LLM `:8001`은 Spring `/api/chat` 경유만 | ADR-002 |
| 서버 연결 | 개발 PC **LAN IP 평문 HTTP 직결** + 앱 내 런타임 주소 오버라이드. 클라우드/HTTPS는 v1 이후 | ADR-002 |
| 라우팅 | **expo-router** — 탭 4개(홈·보관함·검색·설정) + 중앙 스캔 액션 = 5슬롯. 스캔은 fullScreenModal 플로우 | ADR-003 |
| 스타일 | **NativeWind v4** + `theme/tokens.ts` 단일 출처 + CSS 변수 2벌(`:root`/`.dark:root`). 브랜드 `#15293D`, 액션 `#0077B6`. 화면 코드 HEX 리터럴 금지, `dark:` 색 분기 금지 | ADR-004 |
| 테마 | **라이트/다크 두 테마를 v1에 출시.** `시스템 따름`(기본값)/`라이트`/`다크` 3택, 설정(SCR-25)에서 변경, MMKV `theme.mode`에 영속 | ADR-004 §4 |
| 상태 | **TanStack Query v5**(서버) + **zustand**(전역) + react-hook-form·zod(폼) + MMKV(영속) | ADR-005 |
| 인증 | JWT 24h 고정(리프레시 토큰 없음) · `expo-secure-store` · OAuth는 `openAuthSessionAsync` + `mora://` 딥링크 | Auth |
| 대상 | **Android 출시**(iOS 는 출시 안 하되 코드 호환 유지) · 최소 API 26(8.0) · 타깃 API 35 · 세로 고정 · 320~480dp · 한국어 단일 | Scope |
| 배포 | **Google Play Store 확정**(2026-07-28). **백엔드 클라우드 HTTPS 배포가 선행 필수** | ADR-002 §0 |

**범위 규모**: 화면 31(제품 30 + 개발 전용 1) · FR 130(P0 81 / P1 42 / P2 7) · NFR 29 · US 40 · 컴포넌트 52 · 호출 API 67개 중 57개.

**2026-07-27 범위 변경**: 다크모드가 Deferred D-17 → **v1 In scope**로 승격됐다. 종전 "v1 라이트 고정"은 폐기(경위는 [ADR-004 Styling](wiki/adr/ADR-004%20Styling.md) 개정 이력). 영향 — FR +8 · NFR +1 · US +2 · CMP +2 · 총 UoW 136 → 146.

**명시적 제외**: iOS 빌드·검증·등록(코드 호환은 유지), **홈 화면 위젯**(1차 앱 사용 후 판단), **기기 캘린더 쓰기**, 푸시 알림(FCM), 오프라인 쓰기, 실시간 동기화, 프로필 사진 업로드, 영수증 품목 입력, 가계부 수입/지출 원장. 사유는 전부 [Scope](wiki/product/Scope.md) §2에 서버 근거와 함께 기록되어 있다.

---

## 5. Phase 0~8 로드맵

| Phase | 이름 | 핵심 산출물 | 완료 판정(DoD 요약) | 의존 | UoW |
|---|---|---|---|---|---|
| **0** | 기반 셋업 & APK 파이프라인 관통 | Expo 프로젝트, expo-router, NativeWind, env, EAS 3 프로필 | 빈 껍데기 APK가 실기기에 설치되고 LAN IP의 두 서버에 도달 | — | 8 |
| **1** | 디자인 시스템 & 공통 컴포넌트 | Pretendard, **테마 시스템(라이트+다크 토큰 2벌 · `useTheme()` · `themeStore`)**, 공통 컴포넌트 21종, 아이콘 세트 | 갤러리 화면에서 21종이 **라이트/다크 양쪽**으로 렌더되고 HEX 리터럴 0건, 재실행 시 선택 테마가 첫 프레임부터 복원 | 0 | **18** |
| **2** | 인증 | 온보딩, 로그인, 회원가입, OAuth 3종, SecureStore 세션 | 앱 재실행 후 자동 로그인, 401/400 시 로그인 화면 복귀 | 1 | 16 |
| **3** | 스캔 파이프라인 | 카메라/갤러리, 크롭·압축, 업로드 진행률, 분류→필드편집→저장 | 촬영 1장이 DB 레코드 1건 + 서버 이미지 **1장**으로 귀결 | 2 | 20 |
| **4** | 보관함 | 문서 4종 목록·상세·수정·삭제, 명함 그룹, 무한 스크롤 | 4종 전부 목록→상세→수정→삭제가 실서버로 왕복 | 3 | 24 |
| **5** | 검색 & 챗봇 | 검색, 최근 검색어, 타입 필터, 챗봇 전체화면, 출처 카드 | 4종 검색 결과가 나오고 챗봇이 출처 카드와 함께 답한다 | 4 | 14 |
| **6** | 대시보드 & 설정 | 홈(마감/일정/통계), 알림 목록·읽음, 프로필/계정, 캘린더 연동, **설정 테마 3택 UI** | 홈이 `GET /api/dashboard` 1콜로 그려지고 설정 액션이 서버에 반영되며 테마 3택이 실제로 동작 | 2, 4 | 18 |
| **7** | 상용 품질 마감 | 모션/제스처/햅틱, a11y, 에러·오프라인, 가상화, 아이콘/스플래시(라이트+다크), **전 화면 라이트/다크 검수** | QA Checklist 비정상 경로 전 항목 통과 + 성능 예산 충족 + **31화면 × 2테마 순회 완료** | 5, 6 | **20** |
| **8** | 릴리스 | keystore, release APK, R8, 서명 검증, 배포 문서 | 서명된 release APK가 실기기 3대에 설치·구동 | 7 | 8 |

합계 **146 UoW ≈ 73 person-day**. 1인 풀타임 약 15주, 2인 병렬 약 9주. 종전 136 UoW / 68 person-day에서 다크모드 v1 편입분 +10(Phase 1 +6, Phase 7 +4)이 반영된 값이다. 페이즈 이름은 [Phases](wiki/delivery/Phases.md)가 정본이며 다른 문서는 이 이름을 글자 그대로 참조한다.

각 페이즈는 **사용자가 직접 확인하는 종료 게이트 3개**를 통과해야 다음으로 넘어간다.

---

## 6. 지금 다음에 할 일 — Phase 0 시작

### 선행 조건 체크

- [ ] Node 20 LTS + npm + Git 설치
- [ ] Expo 계정 생성 후 `npx eas login` 성공
- [ ] 개발 PC에서 Spring(`:8080`) · Python OCR(`:8000`) 기동 중
- [ ] **개발 PC 방화벽에서 8080 / 8000 인바운드 허용** (첫 연결 실패의 최빈 원인)
- [ ] 실기기와 개발 PC가 **같은 Wi-Fi**, AP 격리(client isolation) 꺼짐
- [ ] 개발 PC의 LAN IP 확인 (`ipconfig` → `192.168.x.x`)

### 착수 명령

```bash
# 1) 프로젝트 생성 (이 저장소 루트에서)
npx create-expo-app@latest . --template default

# 2) 필수 패키지 — 반드시 expo install 로 (Tech Stack VR-1)
npx expo install expo-router expo-secure-store expo-font expo-splash-screen \
  expo-camera expo-image-picker expo-image-manipulator expo-image \
  expo-haptics expo-linking expo-web-browser expo-application expo-constants \
  react-native-safe-area-context react-native-screens react-native-reanimated \
  react-native-gesture-handler expo-build-properties
npx expo install nativewind tailwindcss@3 --
npm i @tanstack/react-query zustand react-hook-form zod

# 3) 환경변수 — 두 값을 반드시 분리한다 (합치면 이미지가 전부 깨진다)
cat > .env <<'EOF'
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080
EXPO_PUBLIC_OCR_URL=http://192.168.0.10:8000
EOF

# 4) 상태 점검
npx expo-doctor

# 5) 첫 APK 관통
npx eas build -p android --profile preview
```

세부 절차·`eas.json` 프로필 3종·cleartext 설정은 [APK Build](wiki/delivery/APK%20Build.md), 착수 범위와 DoD 전문은 [Phases](wiki/delivery/Phases.md) Phase 0을 그대로 따른다.

### Phase 0 종료 게이트

1. 폰에 APK가 설치되고 크래시 없이 첫 화면이 뜬다.
2. 앱 내 진단 화면에서 `GET {OCR}/`가 `{"service":"MORA OCR Service","version":"3.0"}`를 출력한다.
3. EAS 빌드 링크를 팀에 공유했다.

---

## 7. 주의 (착수 전 반드시 인지)

| 항목 | 내용 |
|---|---|
| 평문 HTTP | 이 빌드는 **개발·데모 전용**이다. 같은 Wi-Fi에서 JWT·문서 내용이 도청 가능하다. 스토어 배포 금지 |
| 서버 보안 부채 | 구글 캘린더 4개 엔드포인트와 OCR `/api/commit`에 **인증 검사가 없다.** 앱에서 고칠 수 없으므로 [Risks](wiki/delivery/Risks.md)에 등재만 되어 있다 |
| 이미지 2회 전송 | `POST /api/scan`(인식) + `POST /api/commit`(저장) 구조상 같은 이미지가 두 번 올라간다. 백엔드 무수정 제약상 회피 불가 |
| OAuth | 소셜 로그인은 백엔드 `app.frontend-url`을 `mora://oauth`로 지정한 **모바일 개발 프로파일**을 전제한다. 그 프로파일이 켜진 동안 웹 프론트의 소셜 로그인은 동작하지 않는다 |
| 원본 웹의 버그 | 영수증 화면 목업, 알림 죽은 코드, 하드코딩 개인정보 등은 **이식하지 않는다**. 목록은 [Requirements](wiki/product/Requirements.md) §3-5 |
