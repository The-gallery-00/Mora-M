# Screen Specs

MORA 모바일 앱(Expo/APK) 전 화면 정의서 — 31개 화면(제품 30 + 개발 전용 1)의 라우트·와이어프레임·상태·문구·인터랙션·API 바인딩을 확정한다. **모든 화면은 라이트/다크 양쪽에서 검증한다**(§0-3 G-13). **SCR ID의 정본 문서**다.

상위: [[Home]]
관련: [[Component Library]] · [[Navigation Map]] · [[Design Tokens]] · [[Mobile UX Guide]] · [[API Contract]] · [[Requirements]] · [[Phases]] · [[ADR-004 Styling]] · [[Offline and State]] · [[QA Checklist]]

---

## 0. 이 문서를 읽는 법

### 0-1. ID 체계

| 접두사 | 의미 | 정본 문서 |
|---|---|---|
| `SCR-##` | 화면 | **이 문서** |
| `CMP-##` | 컴포넌트 | [[Component Library]] |
| `API-##` | 엔드포인트 | [[API Contract]] |
| `FR-###` / `NFR-###` | 요구사항 | [[Requirements]] |

**FR 번호는 [[Requirements]]가 정본이다.** 이 문서는 FR을 *참조*만 하고 *발번하지 않는다*. FR-001~FR-120은 **페이즈 순서**로 연속 배정되어 있으므로, 화면별 FR을 찾을 때는 아래 대역에서 역추적한다.

| 대역 | 도메인 | Phase |
|---|---|---|
| FR-001 ~ FR-008 | 앱 셸 · 환경설정 · APK 파이프라인 | 0 |
| FR-009 ~ FR-020 | 디자인 시스템 · 공통 컴포넌트 | 1 |
| FR-021 ~ FR-034 | 인증 · 온보딩 · 세션 | 2 |
| FR-035 ~ FR-052 | 스캔 · OCR · 저장 | 3 |
| FR-053 ~ FR-068 | 보관함 4종 · 그룹 · 상세편집 | 4 |
| FR-069 ~ FR-080 | 검색 · 검색기록 · 챗봇 | 5 |
| FR-081 ~ FR-098 | 대시보드 · 알림 · 설정 · 연동 | 6 |
| FR-099 ~ FR-112 | 모션 · 접근성 · 에러/오프라인 · 성능 | 7 |
| FR-113 ~ FR-120 | 빌드 · 서명 · 배포 | 8 |

**API 번호는 [[API Contract]]가 정본이다** (API-01~67). Spring 컨트롤러 62개(API-01~62) + OCR 서버 직결 5개(API-63~67). 이 문서에서 자주 쓰는 2개만 옮겨 둔다.

| ID | 경로 | 근거 |
|---|---|---|
| `API-63` | `POST {OCR_BASE}/api/commit` (multipart: `file`, `document_type`, `raw_blocks`, `corrected_fields`) → `{image_url, count}` | 원본: `ocr/routers/ocr.py`, 프론트가 Spring 우회 직접 호출 |
| `API-64` | `GET {OCR_BASE}/uploads/{TYPE}/{uuid}.jpg` (정적 이미지) | 원본: `ocr/app.py` `app.mount("/uploads", StaticFiles(...))` |

### 0-2. 와이어프레임 규약

- 기준 뷰포트 **390 × 844** (iPhone 14 / 갤럭시 S23 등가). 프레임 내부 폭 40자 ≈ 390dp.
- `▓` = 상태바/시스템 영역, `═` = 고정(스크롤 안 함) 영역 경계, `┈` = 스크롤 경계, `▒` = 이미지/썸네일.
- 좌우 기본 여백 **16dp** (원본 웹 `padding:'32px 40px'` → 결정: 모바일 16dp. 390dp에서 40dp 여백은 콘텐츠 폭을 310dp로 깎는다).
- 하단 탭바 높이 **56 + safe-area bottom**, 상단 헤더 **56 + safe-area top**.
- **와이어프레임은 라이트 기준으로만 그린다.** 다크 와이어프레임을 별도로 그리지 않는다 — 색은 G-13의 의미론적 토큰 규범과 [[Design Tokens]] §10-3 라이트/다크 대응표로 1:1 유도되기 때문이다. 예외는 **테마와 무관하게 항상 다크인 두 화면**(SCR-09 카메라, SCR-21 이미지 뷰어)이며 그 와이어프레임이 양 테마의 정본이다.
- 와이어프레임 주석에 남아 있는 HEX 표기(`bg#F8FAFC`, `#15293D` 등)는 **라이트 값의 식별자**이지 구현 지시가 아니다. 구현 시에는 [[Design Tokens]] §10-3에서 해당 값의 의미론적 토큰명을 찾아 쓴다 (`#F8FAFC` → `surface`, `#15293D` → `brand`, `#CBD5E1` → `border.subtle`).

### 0-3. 전역 규칙 (모든 화면 공통, 각 화면에서 재기술하지 않음)

| # | 규칙 | 근거 |
|---|---|---|
| G-1 | 모든 화면 루트는 `CMP-48 SafeScreen`. `edges`는 화면별로 지정 | 원본에 safe-area 개념 없음 → 신규 |
| G-2 | 401 응답 수신 시 전역 인터셉터가 SecureStore 토큰 파기 → `(auth)/login`으로 `router.replace` + 토스트 `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` | 원본: `frontend/lib/api.ts` `clearAuthSession()` 문구 그대로 |
| G-3 | 400도 세션 만료로 취급하는 경로는 **`/auth/me`(API-03) 한정** | 원본: `app/dashboard/layout.tsx` `if (res.status === 401 \|\| res.status === 400)` |
| G-4 | 네트워크 실패 문구 기본값 `백엔드 서버에 연결할 수 없습니다.` / OCR 경로는 `OCR 서버에 연결할 수 없습니다.` | 원본: `lib/api.ts` |
| G-5 | 오프라인이면 화면 최상단에 40dp 배너 `오프라인입니다. 네트워크 연결을 확인해 주세요.` (`bg-warn-soft`/`text-warn`), 쓰기 액션 버튼 disabled | 신규(원본 대응 없음) |
| G-6 | 파괴적 액션(삭제·탈퇴)은 `CMP-18 ConfirmDialog` 필수 + `Haptics.notificationAsync(Warning)` | 원본은 `window.confirm`/인라인 버튼 혼재 |
| G-7 | 성공 피드백은 `CMP-16 Toast`(2.5초, 하단 탭바 위 12dp) + `Haptics.notificationAsync(Success)`. 원본의 `window.alert` 12곳은 전부 토스트로 대체 | 원본: `settings/page.tsx`, `storage/cards/page.tsx` |
| G-8 | 목록 로딩은 스피너가 아니라 `CMP-13 Skeleton`. 원본 문구 `불러오는 중...`은 스켈레톤이 3초를 넘길 때만 하단에 노출 | 원본: `dashboard/page.tsx` 등 |
| G-9 | 이미지는 전부 `CMP-24 DocImage`(expo-image, `cachePolicy="memory-disk"`), 실패 시 폴백 문구 `이미지가 없습니다` | 원본: `StorageDrawer.tsx` 폴백 문구 그대로 |
| G-10 | 상대경로 이미지 URL은 `IMAGE_BASE`(= `EXPO_PUBLIC_OCR_URL`) prefix. `http`로 시작하면 그대로 | 원본: `url.startsWith('http') ? url : IMAGE_BASE + url` |
| G-11 | 웹 원본의 hover 상태는 전부 `Pressable`의 `pressed`(opacity 0.7 또는 `bg-surface`)로 치환. 키보드 내비게이션(ArrowUp/Down/Escape) 코드는 전량 폐기 | 원본: `dashboard/layout.tsx` 약 120줄 |
| G-12 | 모든 리스트는 `@shopify/flash-list`. `map()` 렌더 금지 | NFR |
| G-13 | **모든 화면은 라이트/다크 양쪽에서 검증한다.** 색은 반드시 [[Design Tokens]] §10-3의 **의미론적 토큰**(`bg.base` `bg.elevated` `surface.alt` `text.primary` `text.muted` `border.subtle` `brand` `action` …)만 사용하고, 화면 코드의 **HEX 하드코딩을 금지**한다. `dark:` variant로 색을 분기하는 것도 금지 — 색은 CSS 변수가 테마별로 이미 갈리므로 의미론적 클래스 하나로 끝난다 | 다크모드 v1 편입(2026-07-27). [[ADR-004 Styling]] §4 · §5 금지사항 1·5 |
| G-14 | **다크는 화면 상태가 아니다.** 각 화면의 `상태` 표(초기·로딩·성공·빈·에러·오프라인·권한거부)에 `다크` 행을 추가하지 않는다. 테마는 모든 상태에 **직교하게 곱해지는 축**이고, 검증은 [[QA Checklist]]의 테마 매트릭스(화면 × 2테마)가 담당한다 | 상태 축과 테마 축을 섞으면 화면당 케이스가 상태마다 2배로 불어나고 같은 사실이 8줄로 중복된다 |
| G-15 | 테마 선택은 **3택** `시스템 따름`(기본값)/`라이트`/`다크`이며 변경 지점은 **SCR-25 한 곳**뿐이다. 값은 MMKV `theme.mode`에 영속되어 앱 재시작 시 복원되고, `시스템 따름`이면 실행 중 OS 테마 변경이 즉시 반영된다 | [[ADR-004 Styling]] §4, [[Design Tokens]] §10-1, [[Offline and State]] §1-4 |
| G-16 | 고도(elevation)는 **라이트=그림자 / 다크=표면 밝기**다. 카드·시트·토스트는 `elevation.*`와 **배경 토큰을 항상 함께** 지정한다(`bg-elevated` + `elevation.raised`). 배경 없이 그림자만 주면 다크에서 고도가 사라진다 | [[Design Tokens]] DK-02, §10-6 규칙 1 |

**다크에서 국소 예외가 있는 화면 (여기 없는 화면은 전부 G-13으로 자동 대응된다)**

| 화면 | 예외 | 정본 |
|---|---|---|
| SCR-01 스플래시 | 네이티브 스플래시는 `theme.mode`를 읽을 수 없어 **OS 테마만** 따른다. 라이트/다크 2장 번들 | [[ADR-004 Styling]] §4 스플래시 행 |
| SCR-02 온보딩 | 목업 PNG 4장이 **라이트 UI 스크린샷**이다. 반전·틴트 금지, 매트 프레임으로 감싼다 | [[Design Tokens]] §10-5 |
| SCR-09 카메라 | 오버레이 UI가 **테마 무관 항상 다크** | [[Design Tokens]] §10-3 `overlay.image` |
| SCR-12 스캔 결과 | 이미지 스트립·미리보기 영역만 **다크에서도 라이트 표면** 유지 | [[Design Tokens]] §10-5 |
| SCR-21 이미지 뷰어 | **항상 다크 배경**(`bg.sunken`) | [[Design Tokens]] §10-5 |

### 0-4. 화면 인덱스

| ID | 화면 | expo-router 경로 | 인증 | 페이즈 |
|---|---|---|---|---|
| SCR-01 | 스플래시 / 세션 부트 | `app/index.tsx` | 게이트 | 0·2 |
| SCR-02 | 온보딩 | `app/(onboarding)/index.tsx` | 불필요 | 2 |
| SCR-03 | 로그인 | `app/(auth)/login.tsx` | 불필요 | 2 |
| SCR-04 | 회원가입 | `app/(auth)/signup.tsx` | 불필요 | 2 |
| SCR-05 | OAuth 콜백 브리지 | `app/(auth)/callback.tsx` | 불필요 | 2 |
| SCR-06 | 홈 대시보드 | `app/(tabs)/index.tsx` | 필요 | 6 |
| SCR-07 | 캘린더 (월간) | `app/calendar.tsx` | 필요 | 6 |
| SCR-08 | 알림 목록 | `app/notifications.tsx` | 필요 | 6 |
| SCR-09 | 스캔 · 카메라 | `app/scan/index.tsx` | 필요 | 3 |
| SCR-10 | 스캔 · 크롭/보정 | `app/scan/crop.tsx` | 필요 | 3 |
| SCR-11 | 스캔 · 분석 진행 | `app/scan/analyzing.tsx` | 필요 | 3 |
| SCR-12 | 스캔 결과 확인/편집 | `app/scan/review.tsx` | 필요 | 3 |
| SCR-13 | 저장 완료 | `app/scan/done.tsx` | 필요 | 3 |
| SCR-14 | 보관함 허브 | `app/(tabs)/archive/index.tsx` | 필요 | 4 |
| SCR-15 | 명함 목록 | `app/(tabs)/archive/cards.tsx` | 필요 | 4 |
| SCR-16 | 티켓 목록 | `app/(tabs)/archive/tickets.tsx` | 필요 | 4 |
| SCR-17 | 포스터 목록 | `app/(tabs)/archive/posters.tsx` | 필요 | 4 |
| SCR-18 | 영수증 목록 (가계부) | `app/(tabs)/archive/receipts.tsx` | 필요 | 4 |
| SCR-19 | 문서 상세 (바텀시트) | `app/doc/[type]/[id].tsx` | 필요 | 4 |
| SCR-20 | 문서 편집 | `app/doc/[type]/[id]/edit.tsx` | 필요 | 4 |
| SCR-21 | 이미지 뷰어 (OCR 오버레이) | `app/viewer.tsx` | 필요 | 4 |
| SCR-22 | 명함 그룹 관리 | `app/groups.tsx` | 필요 | 4 |
| SCR-23 | 검색 | `app/(tabs)/search.tsx` | 필요 | 5 |
| SCR-24 | 챗봇 (AI 모라냥) | `app/chat.tsx` | 필요 | 5 |
| SCR-25 | 설정 | `app/(tabs)/settings/index.tsx` | 필요 | 6 |
| SCR-26 | 프로필 편집 | `app/settings/profile.tsx` | 필요 | 6 |
| SCR-27 | 비밀번호 변경 | `app/settings/password.tsx` | 필요 | 6 |
| SCR-28 | 계정 · 데이터 삭제 | `app/settings/danger.tsx` | 필요 | 6 |
| SCR-29 | 알림 설정 | `app/settings/notifications.tsx` | 필요 | 6 |
| SCR-30 | 약관 / 개인정보 처리방침 | `app/settings/legal/[doc].tsx` | 불필요 | 7 |
| SCR-31 | 서버 연결 · 진단 (**개발 빌드 전용**) | `app/(dev)/diagnostics.tsx` | 불필요 | 0 |

### 0-5. 원본 9화면 → 모바일 매핑 총괄

| 원본 웹 화면 | 모바일 화면 | 판정 |
|---|---|---|
| `/` 랜딩 (7섹션) | SCR-02 | 4장 페이저로 압축, 목업/스크롤핀 폐기 |
| `/login` | SCR-03 (+SCR-05) | 세로 스택 재설계 |
| `/signup` | SCR-04 (+SCR-05) | 세로 스택 재설계 |
| `/dashboard` | SCR-06 + SCR-07 | 캘린더를 별도 화면으로 분리 |
| `/dashboard/upload` | SCR-09~SCR-13 | **5화면 위저드로 분해** |
| `/dashboard/storage/cards` | SCR-15 + SCR-22 | 사이드바를 그룹 관리 화면으로 분리 |
| `/dashboard/storage/tickets` | SCR-16 | 6컬럼 테이블 → 카드 |
| `/dashboard/storage/posters` | SCR-17 | 6컬럼 테이블 → 카드 |
| `/dashboard/storage/receipts` | SCR-18 | **목업 → 실 API(API-49) 연결** |
| `/dashboard/search` | SCR-23 | 독립 탭으로 승격 |
| `/dashboard/settings` | SCR-25~SCR-30 | **6화면으로 분해** |
| `ChatbotWidget` (전역) | SCR-24 | 드래그 패널 → 전체화면 |
| `dashboard/layout.tsx` 헤더 | (탭바 + 화면별 헤더) | 폐기·재구성 |
| — | SCR-01, SCR-05, SCR-07, SCR-08, SCR-10, SCR-13, SCR-14, SCR-19~22, SCR-29, SCR-31 | **모바일 신규** |

---

## SCR-01 · 스플래시 / 세션 부트

| 항목 | 값 |
|---|---|
| 라우트 | `app/index.tsx` |
| 진입 | 앱 콜드 스타트, 딥링크(`mora://`) 착지 전 |
| 인증 | 게이트 자체 (분기 담당) |
| 원본 | 없음. 웹은 `app/dashboard/layout.tsx`의 인증 가드가 이 역할을 대신했다 |
| 페이즈 | Phase 0 (셸) → Phase 2 (실제 분기) |
| FR | FR-002, FR-010, FR-029, FR-033, FR-110 |

**모바일 변경점**
1. 웹은 페이지 진입마다 `localStorage`를 동기로 읽어 게이트했다. 모바일은 SecureStore가 **비동기**라 "읽는 동안"의 화면이 반드시 필요하다 → 스플래시를 세션 부트 화면으로 승격.
2. `expo-splash-screen`의 `preventAutoHideAsync()`로 네이티브 스플래시를 유지한 채 부트 시퀀스를 돌리고, 분기 직전에 `hideAsync()`. 흰 화면 깜빡임 제거.
3. OAuth 딥링크가 앱을 콜드 스타트시킨 경우 이 화면에서 `Linking.getInitialURL()`을 먼저 확인하고 SCR-05로 넘긴다.

**부트 시퀀스 (결정)**
```
1. 폰트 로드 (Pretendard 4종 + PatuaOne)      ← 실패해도 진행(시스템 폰트 폴백)
2. Linking.getInitialURL()  → mora://auth/* 이면 SCR-05로 replace, 종료
3. SecureStore.getItemAsync('mora_token')
   3-a. 없음  → mora_onboarding_seen 확인 → 없으면 SCR-02, 있으면 SCR-03
   3-b. 있음  → GET /auth/me (API-03, 타임아웃 6초)
        · 200        → 사용자 캐시 갱신 → (tabs)/index (SCR-06)
        · 401 / 400  → 토큰 파기 → SCR-03
        · 그 외/타임아웃/오프라인 → 캐시된 세션으로 SCR-06 진입 + G-5 오프라인 배너
4. SplashScreen.hideAsync()
```

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                                    │
│                                    │
│                                    │
│                                    │
│              ┌──────┐              │
│              │ LOGO │  96×96       │
│              └──────┘              │
│                                    │
│              M O R A               │  logo 32 / letterSpacing 3
│                                    │
│         명함 스캔 & 검색            │  bodySm / textMuted
│                                    │
│                                    │
│                                    │
│              ● ● ●                 │  3초 초과 시에만 노출
│           로딩 중...                │  caption / textDisabled
│                                    │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└────────────────────────────────────┘
       배경 `bg.base` · 로고 `brand`
       (라이트 #FFFFFF/#15293D · 다크 #0F1621/#AEC4D8)
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 중앙 | 로고 마크 | CMP-50 | `mora-logo-lg.svg` 96×96, `brand` |
| 중앙 | 워드마크 `MORA` | CMP-50 | `logo` 롤 32px, letterSpacing 3 |
| 중앙 | 태그라인 `명함 스캔 & 검색` | — | `bodySm`/`text.muted`. 원본 metadata `title: 'MORA — 명함 스캔 & 검색'`에서 추출 |
| 하단 | 지연 인디케이터 | CMP-49 | 3초 경과 후 fade-in 200ms |

> **다크 (국소 예외)** — 네이티브 스플래시는 JS 시작 전에 그려지는 OS 리소스라 MMKV `theme.mode`를 읽을 수 없다. **라이트/다크 2장을 번들해 OS 테마만 따르고**(`expo-splash-screen` `dark` 옵션), JS 부트 이후의 이 화면은 `theme.mode`를 따른다. 따라서 `OS=다크 + 사용자 선택=라이트` 조합에서 네이티브→JS 전환 시 **1프레임 밝기 점프가 발생하며 이를 감수한다**(대안인 "스플래시 라이트 고정"은 OS 다크 사용자 전원에게 매 실행 흰 섬광을 준다). 부트 시퀀스 1단계에 `theme.mode` 동기 읽기를 넣어 JS 첫 프레임부터 올바른 테마로 그린다 — MMKV가 동기이므로 폰트 로드와 병렬로 비용 0이다. 근거: [[ADR-004 Styling]] §4 스플래시 행.

**상태**

| 상태 | 화면 표현 | 문구 |
|---|---|---|
| 초기 | 네이티브 스플래시 이미지(동일 레이아웃) | — |
| 로딩 | 로고 유지, 3초 초과 시 dot 인디케이터 | `로딩 중...` |
| 성공(인증) | 200ms crossfade → SCR-06 | — |
| 성공(미인증) | crossfade → SCR-02 또는 SCR-03 | — |
| 빈 | 해당 없음 (항상 분기 결과가 있음) | — |
| 에러 | 로고 아래 에러 블록 + 재시도 버튼 | `앱을 시작할 수 없습니다.` / `잠시 후 다시 시도해 주세요.` / 버튼 `다시 시도` |
| 오프라인 | 캐시 세션으로 진입, SCR-06에 배너 | `오프라인입니다. 네트워크 연결을 확인해 주세요.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 앱 시작 | 부트 시퀀스 실행 | 없음(무음) | 6초 타임아웃 → 캐시 진입 |
| `다시 시도` 탭 | 부트 시퀀스 재실행 | `Haptics.selectionAsync()` | 3회 연속 실패 시 SCR-03으로 강제 이동 |
| 딥링크 수신 | SCR-05로 `router.replace` | 없음 | 파라미터 없으면 SCR-03 |

**데이터**

| API | 시점 | 캐시 정책 |
|---|---|---|
| API-03 `GET /auth/me` | 부트 3-b, 1회 | `staleTime: 5분`, 결과를 `queryClient`에 `['me']`로 시드 |
| (로컬) SecureStore `mora_token` | 부트 3 | 메모리 캐시 후 스토어 보관 |
| (로컬) AsyncStorage `mora_onboarding_seen` | 부트 3-a | 영구 |

---

## SCR-02 · 온보딩

| 항목 | 값 |
|---|---|
| 라우트 | `app/(onboarding)/index.tsx` |
| 진입 | SCR-01(최초 실행), SCR-25 > 앱 정보 > `온보딩 다시 보기` |
| 인증 | 불필요 |
| 원본 | `frontend/app/page.tsx` (랜딩 7섹션) · `components/common/Nav.tsx` |
| 페이즈 | Phase 2 |
| FR | FR-021 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| `ScrollPinnedShowcase` — 2단 grid + `position:sticky` + 스텝당 `minHeight:85vh` + IntersectionObserver | **가로 스와이프 페이저 4장** (`react-native-pager-view`) | 390dp에서 2단 sticky 불가. STEP 01~04 카피가 이미 4단계라 페이저와 1:1 대응 |
| `ProductMockup` 아이폰 프레임 2개 `rotate(±3deg)`, 300×620 ×2 = 632dp | 페이지당 목업 **1개**, 회전 제거 | 632dp가 390dp에 안 들어감 |
| `Nav` 앵커 링크 `사용법`/`기능` (+ `#features` 오타 버그) | **폐기** | 앵커 스크롤 개념 없음 |
| `StatsStrip` 4칸 / `UseCases` 4카드 / `FeatureGrid` 6카드 / `HowItWorks` 3스텝 / `FinalCTA` | 4번째 페이지에 **핵심 3항목만** 압축 | 15개 카드 스크롤은 온보딩 이탈률을 올린다 |
| `Footer` | 폐기 (SCR-25 앱 정보로 흡수) | 앱에 푸터 없음 |
| 스크롤 위치 dot(활성 w18 / 비활성 w6) | 동일 규격 유지 | 원본 디자인 언어 보존 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 건너뛰기 │  ← 우상단 텍스트 버튼
├────────────────────────────────────┤
│                                    │
│      ┌──────────────────┐          │
│      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│          │
│      │▒  폰 목업 1장    ▒│  240×420 │
│      │▒  (스텝별 화면)  ▒│          │
│      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│          │
│      └──────────────────┘          │
│                                    │
│  STEP 01                           │  micro / point
│  그냥 올리기만 하세요                │  display 28 / brand
│                                    │
│  카메라 촬영, 앨범 선택, 드래그&      │  body / textMuted
│  드롭까지. 어떤 방식이든 사진만       │
│  올리면 MORA가 알아서 분석합니다.     │
│                                    │
│            ▬  ·  ·  ·              │  dot 18/6
│                                    │
│  ┌──────────────────────────────┐  │
│  │        다음                  │  │  Button primary lg
│  └──────────────────────────────┘  │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

4번째 페이지 하단만 버튼 2개:
```
│  ┌──────────────────────────────┐  │
│  │      무료로 시작하기 →        │  │  primary
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │        로그인                │  │  secondary
│  └──────────────────────────────┘  │
│      AI OCR · 문서 정리 자동화      │  caption / textFaint
```

**페이지별 카피 (원본 `app/page.tsx` STEP 배열 그대로)**

| # | eyebrow | 제목 | 본문 | 목업 |
|---|---|---|---|---|
| 1 | `STEP 01` | `그냥 올리기만 하세요` | `카메라 촬영, 앨범 선택, 드래그&드롭까지. 어떤 방식이든 사진만 올리면 MORA가 알아서 분석합니다.` | UploadScreen |
| 2 | `STEP 02` | `MORA가 읽고 분석합니다` | `OCR이 이미지 속 글자를 읽고, AI가 사람·날짜·금액·장소 같은 핵심 정보를 자동으로 추출합니다.` | ParseScreen |
| 3 | `STEP 03` | `유형별로 알아서 정리됩니다` | `명함은 연락처로, 티켓 및 포스터는 캘린더로, 영수증은 가계부로 자동 분류해 보관함에 정리합니다.` | ListScreen |
| 4 | `STEP 04` | `말하듯 검색하고, 한눈에 요약하세요` | `"3월 부산 출장 영수증"처럼 자연어로 검색하면, 관련 기록을 찾아 핵심 내용까지 AI가 정리해줍니다.` | LedgerScreen |

> **결정**: 1페이지 본문의 `드래그&드롭까지`는 모바일에 존재하지 않는 입력 방식이므로 **`카메라 촬영, 앨범 선택, 파일 불러오기까지.`** 로 교체한다. 나머지 3개는 원문 유지.

**구성 요소**

| 영역 | 요소 | CMP |
|---|---|---|
| 헤더 | `건너뛰기` 텍스트 버튼 (우상단, 44dp 터치타깃) | CMP-01(ghost/sm) |
| 본문 | 목업 이미지 (정적 PNG, 페이지별 1장) | CMP-24 |
| 본문 | eyebrow / 제목 / 본문 텍스트 블록 | — |
| 하단 | 페이지 인디케이터 | CMP-13 계열 신규 `PageDots` (CMP-49와 별개, 인라인) |
| 하단 | CTA 버튼 1~2개 | CMP-01 |

> **다크 (국소 예외)** — 페이지별 목업 PNG 4장(`UploadScreen`/`ParseScreen`/`ListScreen`/`LedgerScreen`)은 **원본 웹의 라이트 UI 스크린샷**이라 다크 버전 에셋이 없다. **반전·틴트·밝기 필터를 걸지 않고**(문서 판독성 훼손 금지 규칙과 동일 이유) `surface.alt` 배경 + `border.subtle` 1px + `radius.xl` 프레임에 사방 4dp 매트를 주어 흰 이미지가 다크 배경에 직접 닿지 않게 한다. eyebrow는 `action`, 제목은 `brand`, 본문은 `text.muted`로 두면 나머지는 G-13으로 자동 대응된다. 다크 목업 4장을 새로 그리는 비용은 v1 범위 밖이다 — 근거: [[Design Tokens]] §10-5 썸네일·일러스트 규칙.

**상태**

| 상태 | 표현 | 문구 |
|---|---|---|
| 초기 | 1페이지, 목업 fade-in 400ms + translateY(12→0) | — |
| 로딩 | 없음 (전부 로컬 에셋) | — |
| 성공 | 4페이지에서 CTA 탭 → `mora_onboarding_seen=1` 저장 후 SCR-03/04 | — |
| 빈 | 해당 없음 | — |
| 에러 | 목업 이미지 로드 실패 시 회색 플레이스홀더 + 아이콘 | (문구 없음, 텍스트만으로 온보딩 성립) |
| 오프라인 | 정상 동작 (네트워크 불필요) | — |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 좌/우 스와이프 | 페이지 전환 | dot 폭 애니메이션 300ms `Easing.bezier(0.16,1,0.3,1)` + `Haptics.selectionAsync()` | 첫/마지막에서 rubber-band |
| `다음` 탭 | 다음 페이지 | 동일 | — |
| `건너뛰기` 탭 | `mora_onboarding_seen=1` → SCR-03 | `Haptics.selectionAsync()` | 저장 실패해도 이동은 강행 |
| `무료로 시작하기` | `mora_onboarding_seen=1` → SCR-04 | `Haptics.impactAsync(Light)` | — |
| `로그인` | `mora_onboarding_seen=1` → SCR-03 | `Haptics.selectionAsync()` | — |
| Android 백 | 이전 페이지, 1페이지면 앱 종료 | — | — |

**데이터**: API 호출 **없음**. AsyncStorage `mora_onboarding_seen`만 쓴다. (원본 랜딩도 `lib/api.ts` 미사용)

---

## SCR-03 · 로그인

| 항목 | 값 |
|---|---|
| 라우트 | `app/(auth)/login.tsx` |
| 진입 | SCR-01, SCR-02, G-2 세션 만료, SCR-25 로그아웃 |
| 인증 | 불필요. 토큰 보유 상태로 진입하면 SCR-06으로 `replace` |
| 원본 | `frontend/app/login/page.tsx` · `components/shared/AuthForm.tsx` · `TextInput.tsx` · `SocialButtons.tsx` · `Divider.tsx` · `shared/Hero.tsx` |
| 페이즈 | Phase 2 |
| FR | FR-013, FR-022, FR-025, FR-028, FR-034 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| `h-[560px] w-[880px]` absolute 캔버스 + 좌우 자식 `absolute` | **세로 스택 1열** | 390dp에서 880dp 캔버스는 완전 파괴 |
| `w-[415.5px]` 고정 폼 폭 (소수점) | `width:'100%'` + `paddingHorizontal:24` | 360dp 기기 가로 넘침 |
| `Hero` 일러스트 `illust.png` 1.2MB, `w-[750px]` | **로고 + 워드마크만** 유지, 일러스트 폐기 | 1.2MB 에셋을 APK에 넣을 가치 없음. 키보드 올라오면 어차피 안 보임 |
| `TextInput` 4겹 absolute 레이어 + `inset` box-shadow | 단일 View 1겹 (`bg-surface`, `borderWidth:1`, `radius 14`) | RN inset shadow 미지원 |
| `SocialButtons variant="icon"` (원형 56×56 3개) | **`variant="full"` 풀폭 3개로 통일** | 원형 아이콘은 provider 식별성이 낮고, 라벨 없는 56dp는 접근성 취약 |
| `window.location.href = {api}/auth/{p}/login` | `WebBrowser.openAuthSessionAsync()` + 딥링크 (SCR-05) | 앱에서 전체 페이지 이동 개념 없음 |
| 하단 전환 링크가 `<span onClick>` | `Pressable` + `accessibilityRole="link"` | 접근성 |
| 폼 제출이 `<form onSubmit>` | 버튼 `onPress` + 비밀번호 필드 `onSubmitEditing` | RN에 form 없음 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                                    │
│              ┌────┐                │
│              │LOGO│  64×64         │
│              └────┘                │
│              M O R A               │  logo 28
│                                    │
│  로그인                             │  h1 24/700/#15293d
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 이메일                       │  │  h56 r14 bg#F8FAFC b#CBD5E1
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 비밀번호                 👁   │  │  우측 눈 아이콘 44dp 타깃
│  └──────────────────────────────┘  │
│                                    │
│        (에러 문구 자리 · #DC2626)   │  center / body
│                                    │
│  ┌──────────────────────────────┐  │
│  │           로그인             │  │  h56 r14 bg#15293D
│  └──────────────────────────────┘  │
│                                    │
│  ──────────── 또는 ────────────    │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  [G]  Google로 시작하기      │  │  h56 r14 white/b#505050
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  [K]  카카오로 시작하기      │  │  h56 r14 bg#FEE500
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  [N]  네이버로 시작하기      │  │  h56 r14 bg#54CF48
│  └──────────────────────────────┘  │
│                                    │
│   계정이 없으신가요?  회원가입      │  body / #505050 · #0077B6
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   전체를 KeyboardAwareScreen(CMP-47)으로 감쌈
```

**구성 요소**

| 영역 | 요소 | CMP | 원문 스펙 |
|---|---|---|---|
| 헤더 | 로고 + 워드마크 | CMP-50 | Patua One, `#15293D` |
| 폼 | 제목 `로그인` | — | 24/700/lineHeight 1.1, marginBottom 20 |
| 폼 | 이메일 입력 | CMP-03 | placeholder `이메일`, `keyboardType="email-address"`, `autoCapitalize="none"`, `textContentType="username"` |
| 폼 | 비밀번호 입력 | CMP-04 | placeholder `비밀번호`, `secureTextEntry`, 토글 aria `비밀번호 보기`/`비밀번호 숨기기` |
| 폼 | 에러 텍스트 | — | 14/lineHeight 20/`#DC2626`/center |
| 폼 | 제출 버튼 | CMP-01 | primary/lg, 로딩 시 라벨 `처리 중...` + `disabled`, opacity 0.6 |
| 구분 | `또는` 디바이더 | CMP-09 | 선 `#767676`, 텍스트 `#3C4045` 13px |
| 소셜 | 3버튼 | CMP-37 | 순서 `google → kakao → naver` (원본 배열 그대로) |
| 하단 | 전환 링크 | CMP-01(link) | `계정이 없으신가요? ` + `회원가입`(`#0077B6`, 600) |

**상태**

| 상태 | 화면 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 빈 폼, 제출 버튼 활성(원본은 항상 활성 — 유지) | placeholder `이메일` / `비밀번호` |
| 로딩 | 제출 버튼 라벨 교체 + 스피너 16dp, 전체 폼 `pointerEvents="none"` | `처리 중...` |
| 성공 | 토큰 저장 → SCR-06으로 `replace`, 200ms fade | 토스트 없음(즉시 전환이 피드백) |
| 빈(입력 미충족) | 제출 시 클라이언트 검증 실패 → 해당 필드 보더 `#DC2626` + 흔들림 200ms | 이메일 미입력: `이메일을 입력해 주세요.` / 형식 오류: `이메일 형식이 올바르지 않습니다.` / 비밀번호 미입력: `비밀번호를 입력해 주세요.` (결정: 원본에 클라 검증 없음. `required`만 있었는데 RN엔 없으므로 신규) |
| 에러(인증 실패) | 에러 텍스트 노출 + `Haptics.notificationAsync(Error)` | 서버 메시지 우선, 없으면 `로그인에 실패했습니다` |
| 에러(토큰 누락) | 동일 | `토큰을 받지 못했습니다` |
| 에러(네트워크) | 동일 | `서버와 연결할 수 없습니다` |
| 오프라인 | 상단 G-5 배너 + 제출/소셜 버튼 disabled | `오프라인입니다. 네트워크 연결을 확인해 주세요.` |
| 권한거부 | 해당 없음 | — |

> 위 3개 에러 문구는 원본 `app/login/page.tsx`의 문자열 그대로다. 마침표가 없는 것도 원문 유지.

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 이메일 입력 완료(`onSubmitEditing`) | 비밀번호 필드로 포커스 이동 | — | — |
| 비밀번호 `onSubmitEditing` | 제출 실행 | 키보드 dismiss | — |
| 눈 아이콘 탭 | `secureTextEntry` 토글 | `Haptics.selectionAsync()` | — |
| `로그인` 탭 | `POST /auth/login` (API-02) | 버튼 scale 0.98 100ms, 로딩 라벨 | 에러 텍스트 + Error 햅틱, 폼 값 유지 |
| 소셜 버튼 탭 | SCR-05 흐름 시작 (`WebBrowser.openAuthSessionAsync`) | 버튼 로딩 스피너 | 시트 취소 시 무음 복귀, 실패 시 토스트 `소셜 로그인에 실패했습니다.` |
| `회원가입` 탭 | SCR-04로 `push` | `Haptics.selectionAsync()` | — |
| Android 백 | 온보딩 경유 진입이면 SCR-02, 아니면 앱 종료 | — | — |

**데이터**

| API | 시점 | 요청 | 캐시 |
|---|---|---|---|
| API-02 `POST /auth/login` | 제출 시 | `{ email, password }` | 캐시 안 함(mutation) |
| API-07/09/11 `GET /auth/{provider}/login` | 소셜 버튼 탭 | 302 → 외부 브라우저 | — |

**성공 처리 (원본 로직 이식)**
```ts
const authData = json.data ?? json          // 원본: data.data || data
const token = authData.token
if (!token) throw new Error('토큰을 받지 못했습니다')
await SecureStore.setItemAsync('mora_token', token)
await setUser({
  id: authData.userId ?? authData.id,
  email: authData.email ?? email,
  name: authData.name ?? email.split('@')[0],   // 원본 폴백 그대로
})
router.replace('/(tabs)')
```

---

## SCR-04 · 회원가입

| 항목 | 값 |
|---|---|
| 라우트 | `app/(auth)/signup.tsx` |
| 진입 | SCR-02 CTA, SCR-03 하단 링크 |
| 인증 | 불필요 |
| 원본 | `frontend/app/signup/page.tsx` (`/login`과 구조 동일, 카피·엔드포인트만 상이) |
| 페이즈 | Phase 2 |
| FR | FR-013, FR-023, FR-025, FR-034 |

**모바일 변경점**
1. SCR-03과 동일한 재설계(세로 스택, 풀폭 소셜). **레이아웃 컴포넌트를 공유**하고 `mode` prop으로 카피만 분기 — 원본 `AuthForm`의 controlled 구조를 그대로 유지한다.
2. 원본은 `name`을 `email.split('@')[0]`로 자동 생성해 보냈지만 **서버 `SignupRequest`에 `name` 필드가 없어 무시**된다(원본: `backend/.../AuthService.signup()`이 동일 규칙으로 자체 생성). → **결정(FR-024): 가입 폼에는 닉네임 필드를 두지 않고, 가입 성공 직후 별도의 닉네임 설정 단계(SCR-26 재사용, `건너뛰기` 가능)를 띄운다.** 저장은 `PATCH /auth/me`(API-04). 가입 요청과 분리했으므로 닉네임 저장이 실패해도 가입은 롤백되지 않고, 사용자는 나중에 설정에서 다시 바꿀 수 있다.
3. 비밀번호 규칙 표시 신설: 원본 로그인/가입 화면엔 규칙 안내가 없었으나, 설정 화면의 비밀번호 변경은 `8자 이상`을 요구한다(`새 비밀번호는 8자 이상이어야 합니다.`). **결정: 가입에도 동일하게 8자 이상을 클라이언트 검증으로 적용**하고 힌트를 상시 노출한다.

**와이어프레임** (SCR-03과 동일 골격, 차이만 표기)
```
│  회원가입                           │  h1 24/700
│  ┌──────────────────────────────┐  │
│  │ 이메일                       │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ 비밀번호                 👁   │  │
│  └──────────────────────────────┘  │
│   8자 이상 입력해 주세요.           │  caption / textDisabled (상시)
│                                    │
│  ┌──────────────────────────────┐  │
│  │          가입하기            │  │
│  └──────────────────────────────┘  │
│  ──────────── 또는 ────────────    │
│      [소셜 3버튼 — SCR-03과 동일]   │
│   계정이 있으신가요?  로그인        │
```

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 빈 폼 + 힌트 상시 노출 | `8자 이상 입력해 주세요.` |
| 로딩 | 버튼 라벨 교체 | `처리 중...` |
| 성공 | 토큰 저장 → SCR-06 replace + 토스트 | `가입이 완료되었습니다. MORA를 시작해 보세요.` (결정: 원본엔 성공 피드백이 없었다. 첫 진입 맥락을 주기 위해 신설) |
| 빈 | 필드 보더 danger + 흔들림 | `이메일을 입력해 주세요.` / `비밀번호를 입력해 주세요.` |
| 에러(검증) | 힌트가 danger 색으로 전환 | `비밀번호는 8자 이상이어야 합니다.` / `이메일 형식이 올바르지 않습니다.` |
| 에러(중복/서버) | 에러 텍스트 | 서버 메시지 우선(예: `Email already exists`), 없으면 `회원가입에 실패했습니다` |
| 에러(토큰) | 에러 텍스트 | `토큰을 받지 못했습니다` |
| 에러(네트워크) | 에러 텍스트 | `서버와 연결할 수 없습니다` |
| 오프라인 | G-5 배너 + 버튼 disabled | 공통 문구 |
| 권한거부 | 해당 없음 | — |

> **주의**: 서버는 `error`에 에러 코드가 아니라 사람이 읽는 문장(영문/한글 혼재)을 넣는다. 원본 위키의 `NOT_FOUND` 류 코드 분기는 실제로 존재하지 않는다 → **HTTP status + `success` 불리언으로만 분기**한다.

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| `가입하기` 탭 | `POST /auth/signup` (API-01) body `{ email, password }` | 로딩 라벨 + scale 0.98 | 에러 텍스트 + Error 햅틱 |
| 소셜 버튼 | SCR-05 흐름 (로그인과 동일 엔드포인트 — 서버가 신규/기존을 자동 판별) | 스피너 | 토스트 |
| `로그인` 탭 | SCR-03으로 `replace` (스택 누적 방지) | selection 햅틱 | — |

**데이터**

| API | 시점 | 요청 | 캐시 |
|---|---|---|---|
| API-01 `POST /auth/signup` | 제출 시 | `{ email, password }` — **`name`은 보내지 않는다**(서버가 무시) | mutation |

---

## SCR-05 · OAuth 콜백 브리지

| 항목 | 값 |
|---|---|
| 라우트 | `app/(auth)/callback.tsx` (딥링크 `mora://auth/callback`) |
| 진입 | SCR-03/04 소셜 버튼 → 외부 인증 세션 종료 후 리다이렉트, 또는 콜드 스타트 딥링크(SCR-01 경유) |
| 인증 | 불필요 (토큰 수령 지점) |
| 원본 | `backend/.../AuthController.buildOAuthSuccessHtml()` — `text/html` 브리지 문서 + `{FRONTEND_URL}/dashboard?token=…&userId=…&email=…&name=…` |
| 페이즈 | Phase 2 |
| FR | FR-026, FR-027, FR-028 |

**모바일 변경점 (가장 위험한 이식 지점)**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 콜백이 `text/html` + 인라인 `<script>`로 `localStorage` 쓰기 | HTML을 **해석하지 않는다**. `WebBrowser.openAuthSessionAsync(startUrl, returnUrl)`가 `returnUrl` prefix 매칭으로 리다이렉트를 가로채고 URL만 회수 | 앱에는 localStorage도 opener도 없다 |
| 최종 착지 `{FRONTEND_URL}/dashboard?token=...` | `FRONTEND_URL`을 앱 스킴으로 바꾸면 웹이 죽는다 → **백엔드에 앱 전용 리다이렉트 분기 추가 필요** (`?client=app` 또는 provider별 앱용 `redirect_uri` 추가 등록) | 웹/앱 공존 |
| `window.opener.postMessage('MORA_OAUTH_LOGIN')` | 미사용 (웹 프론트도 수신 코드가 없어 죽은 경로) | — |
| 토큰이 URL 쿼리스트링에 노출 | 그대로 감수하되 **회수 즉시 SecureStore로 옮기고 URL은 메모리에서 폐기**, 로그에 절대 남기지 않음 | 백엔드 무수정 조건 하의 현실적 타협 |

> **[[Risks]] 연계**: 이 화면은 백엔드 변경 없이는 완결되지 않는다. Phase 2 착수 전 백엔드 담당과 리다이렉트 분기 합의가 선행 조건이다. 합의 전까지의 **폴백 = 이메일 로그인만 노출하고 소셜 버튼은 `준비 중입니다.` 토스트**로 막는다.

**와이어프레임** (사용자가 보는 시간 1~2초)
```
┌────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                                    │
│                                    │
│                                    │
│              ┌────┐                │
│              │LOGO│                │
│              └────┘                │
│                                    │
│              ◜◝ ◞◟                 │  스피너 32dp / point
│                                    │
│    로그인 처리 중입니다.            │  body / textBody
│      잠시만 기다려 주세요.          │  bodySm / textMuted
│                                    │
│                                    │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└────────────────────────────────────┘
```
> 문구 `로그인 처리 중입니다. 잠시만 기다려 주세요.` 는 원본 OAuth 브리지 HTML의 `<p>` 원문을 그대로 가져온 것이다.

**처리 시퀀스**
```
1. params = { token, userId, email, name }  ← URL 쿼리 파싱
2. token 없음 → 실패 분기
3. SecureStore.setItemAsync('mora_token', token)
4. setUser({ id: userId ?? '', email: email ?? '', name: name || email?.split('@')[0] || '' })
   ↑ 원본 dashboard/layout.tsx 폴백 규칙 그대로
5. GET /auth/me (API-03)로 provider/createdAt 보정 → ['me'] 캐시 시드
6. router.replace('/(tabs)')
```

**상태**

| 상태 | 표현 | 문구 |
|---|---|---|
| 초기 | 스피너 + 안내 | `로그인 처리 중입니다.` / `잠시만 기다려 주세요.` |
| 로딩 | 동일 | 동일 |
| 성공 | SCR-06 replace + 토스트 | `{provider}로 로그인했습니다.` (예: `Google로 로그인했습니다.`) |
| 빈(파라미터 없음) | 에러 카드 | `로그인 정보를 받지 못했습니다.` + 버튼 `다시 시도` |
| 에러(사용자 취소) | 조용히 SCR-03으로 복귀 | 토스트 없음 (취소는 에러가 아니다) |
| 에러(state 무효/서버) | 에러 카드 | `소셜 로그인에 실패했습니다.` / 부제 `브라우저를 닫고 다시 시도해 주세요.` (원본 실패 HTML 문구) |
| 오프라인 | 에러 카드 | `백엔드 서버에 연결할 수 없습니다.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 인증 세션 종료(성공) | 위 시퀀스 실행 | Success 햅틱 | 에러 카드 전환 |
| 인증 세션 취소 | `router.back()` → SCR-03 | 없음 | — |
| `다시 시도` 탭 | SCR-03으로 replace | selection 햅틱 | — |
| 10초 타임아웃 | 에러 카드 전환 | Error 햅틱 | — |

**데이터**

| API | 시점 | 캐시 |
|---|---|---|
| API-07/08 · API-09/10 · API-11/12 (provider별 login/callback) | 외부 브라우저 세션 | — |
| API-03 `GET /auth/me` | 토큰 저장 직후 | `['me']`, staleTime 5분 |

---
## SCR-06 · 홈 대시보드

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/index.tsx` (탭 1 · `홈`) |
| 진입 | SCR-01/03/04/05 이후 기본 착지, 탭바 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/page.tsx` |
| 페이즈 | Phase 6 (Phase 0에 껍데기) |
| FR | FR-081, FR-082, FR-083, FR-086 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 클라이언트에서 `getMyCards()` + `getMyTickets(0,100)` + `getMyPosters(0,100)` 3콜을 받아 D-day·오늘일정·총계를 **직접 계산** | **API-24 `GET /api/dashboard` 단일 호출**로 교체 | 서버가 이미 `todayScheduleCount / upcomingDeadlineCount / storedDocumentCount / upcomingDeadlines[] / todaySchedules[]`를 조립해 준다. 웹이 안 쓰고 있을 뿐 API는 살아 있다. 3콜 300건 파싱을 모바일에서 반복할 이유가 없다 |
| 배너 `gridTemplateColumns:'1fr 1fr 1fr 1fr'` 4칸 | **날짜 헤더(전폭) + 통계 타일 3개 가로 스크롤** | 390dp 4분할 = 칸당 90dp, 숫자+라벨 불가 |
| 마감 카드 가로 스크롤 + `wheel` 하이재킹(`preventDefault`) | `FlashList horizontal` + `snapToInterval`, wheel 코드 전량 삭제 | 데스크톱 전용 |
| 마감 카드 `minWidth:320 / maxWidth:360`, `cursor:pointer`인데 **onClick 없음** | 폭 `280dp`, **탭 시 SCR-19 상세 시트 오픈** (원본 미구현 기능 완성) | 원본 버그 수정 |
| 월간 캘린더(셀 120px, 폰트 20px) + 선택 시 좌우 `1fr 1fr` 분할 | **홈에는 "이번 주 7일 스트립"만**, 월간 전체는 SCR-07로 분리 | 390dp에서 셀 1개 ≈ 53dp. 포스터 기간 pill 라벨 표시 물리적 불가 |
| 캘린더 화살표 키 내비게이션 (`ArrowLeft/Right/Up/Down`) | 삭제 → SCR-07의 가로 스와이프 | 데스크톱 전용 |
| `title={indicator.label}` hover 툴팁 | 삭제 → 탭 시 SCR-19 | 터치에 hover 없음 |
| 알림 벨 버튼(onClick 없음) | **헤더 우측 벨 + 미읽음 배지 → SCR-08** (신규 구현) | 원본 미구현 완성 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ MORA                      🔔③  👤 │  ═ 헤더 56 (CMP-20)
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │ 오늘의 MORA                    │ │  bg #15293D · r16 · p20
│ │ 07.27 월                       │ │  28/800 white
│ │ 일상의 요약된 정보를 확인하세요 │ │  caption rgba(255,255,255,.5)
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────┐┌────────┐┌────────┐ →  │  가로 스크롤 · 각 w148 h96
│ │📅 2 건 ││⏰ 5 건 ││📄 41건 │    │
│ │오늘일정││마감임박││보관문서│    │
│ │예정된  ││30일 내 ││전체    │    │
│ └────────┘└────────┘└────────┘    │
│                                    │
│ 마감 임박              5건    전체>│  section 16/600 + 배지
│ ┌──────────────────┐┌────────────  │  가로 스크롤 · w280 h120
│ │[포스터]      D-3 ││[티켓]  D-6   │
│ │AI 해커톤 2026 ▒▒ ││수서→부산  ▒▒ │
│ │07.30 (수)     ▒▒ ││08.02 (토) ▒▒ │
│ └──────────────────┘└────────────  │
│                                    │
│ 이번 주               2026년 7월 > │
│ ┌────────────────────────────────┐ │
│ │ 일  월  화  수  목  금  토     │ │
│ │ 26 (27) 28  29  30  31   1     │ │  오늘=원형 배지
│ │  ·   ●   ·   ●●  ·   ·   ·     │ │  이벤트 dot (라벨 없음)
│ └────────────────────────────────┘ │
│                                    │
│ 7월 27일 일정            2건       │
│ ┌────────────────────────────────┐ │
│ │[티켓] 09:00  수서 → 부산       │ │  h56 · bg #E9E5FA
│ ├────────────────────────────────┤ │
│ │[포스터]      AI 해커톤 2026    │ │  bg #E8EDF3
│ └────────────────────────────────┘ │
│                                    │ ┈
│                            ┌────┐  │
│                            │🐱 │  │  CMP-22 FAB 56dp
│                            └────┘  │  bottom = tabbar+16
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═ 탭바 56
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**구성 요소**

| 영역 | 요소 | CMP | 원문 스펙 |
|---|---|---|---|
| 헤더 | 워드마크 / 알림 벨(+배지) / 아바타 | CMP-20, CMP-44배지, CMP-10 | 아바타 32dp 원형 `#15293D` + 이니셜, 없으면 `U` |
| 날짜 배너 | `오늘의 MORA` / `MM.DD 요일` / 설명 | CMP-08 | 배경 `#15293D`, 라벨 13/`rgba(255,255,255,0.6)`, 값 28/800, 설명 12/`rgba(255,255,255,0.5)` |
| 통계 | 타일 3개 | CMP-32 | 오늘일정 `📅` `#E8F4FD`/`#0077B6` · 마감임박 `⏰` `#FEF3E2`/`#DC8540` · 보관문서 `📄` `#DCFCE7`/`#4FB048` |
| 마감 | 섹션 헤더 + 개수 배지 + `전체` 링크 | CMP-07 | 배지 `bg #FEF3E2 / color #DC8540 / r10 / 12·600` |
| 마감 | 카드 리스트 | CMP-31 | D-day 색 `dDay <= 3 ? #DC8540 : #0077B6`, `dDay===0`이면 라벨 `D-DAY` |
| 캘린더 | 주간 스트립 | CMP-33(week 모드) | 일요일 `#DC2626`, 토요일 `#2563EB`, 평일 `#999` |
| 일정 | 선택일 일정 리스트 | CMP-34 | 행 배경 = 타입 bg, 흰 배지에 타입 라벨 |
| 전역 | 챗봇 FAB | CMP-22 | `chatbot_logo.svg` 56dp, `bottom: tabBarHeight + 16`, `right: 16` |

**상태**

| 상태 | 화면 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 스켈레톤 3블록(배너/타일/카드) | — |
| 로딩 | 통계 값 자리 `-`, 마감 섹션 스켈레톤 2장 | 3초 초과 시 `불러오는 중...` |
| 성공 | 전체 렌더, 콘텐츠 fade-in 200ms | — |
| 빈(마감) | 점선 카드 1장, 높이 96 | `30일 이내 마감되는 일정이 없습니다` |
| 빈(일정) | 리스트 자리에 중앙 텍스트, 패딩 32 | `일정이 없습니다` |
| 빈(전체 신규 유저) | 통계 전부 0 + 히어로 EmptyState + CTA | `아직 저장된 문서가 없어요` / `첫 문서를 스캔하고 MORA를 시작해 보세요.` / 버튼 `문서 스캔하기` |
| 에러 | 상단 인라인 에러 카드 + `다시 시도` | `대시보드를 불러오지 못했습니다.` (결정: 원본은 에러를 조용히 삼켰다 — `res.success === false`면 빈 배열. 상용 앱에선 부적절) |
| 오프라인 | G-5 배너 + 마지막 캐시 데이터 표시 + 배너 우측 `새로고침` | `오프라인입니다. 저장된 정보를 표시합니다.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| Pull-to-refresh | API-24 재요청 | 네이티브 리프레시 인디케이터 + `Haptics.impactAsync(Light)` | 토스트 `새로고침에 실패했습니다.`, 기존 데이터 유지 |
| 통계 타일 탭 | 오늘일정→SCR-07, 마감임박→SCR-07(마감 필터), 보관문서→SCR-14 | scale 0.98, selection 햅틱 | — |
| 마감 카드 탭 | SCR-19 상세 시트 (`type`, `id` 전달) | scale 0.98 | 항목 없으면 토스트 `문서를 찾을 수 없습니다.` |
| 마감 `전체 >` 탭 | SCR-07 (마감 탭) | selection | — |
| 주간 스트립 날짜 탭 | 하단 일정 리스트 갱신 (화면 이동 없음) | 셀 배경 `#E8EDF3` + selection 햅틱 | — |
| 주간 스트립 좌우 스와이프 | 주 이동 (±7일) | 슬라이드 200ms | — |
| `2026년 7월 >` 탭 | SCR-07 | selection | — |
| 일정 행 탭 | SCR-19 | scale 0.98 | — |
| 벨 아이콘 탭 | SCR-08 | selection | — |
| 아바타 탭 | SCR-25 | selection | — |
| FAB 탭 | SCR-24 (전체화면 모달) | `Haptics.impactAsync(Medium)` + scale 0.94 | — |
| 스크롤 다운 120dp 초과 | FAB 축소(라벨 없음이라 크기만 48dp) | 150ms spring | — |

**데이터**

| API | 시점 | 파라미터 | 캐시 정책 |
|---|---|---|---|
| API-24 `GET /api/dashboard` | 화면 포커스 시(`useFocusEffect`) | `date`(생략=서버 today), `deadlineDays=30` | 키 `['dashboard', date]`, `staleTime: 2분`, `gcTime: 30분`, `refetchOnWindowFocus` |
| API-33 `GET /api/notifications/unread-count` | 헤더 마운트 + 60초 폴링 | — | 키 `['notif','unread']`, `staleTime: 30초`. 응답이 `Map`이라 **`data.count`로 뜯는다** |
| API-64 이미지 | 카드 렌더 시 | — | expo-image disk 캐시 7일 |

> **폴링 근거**: 백엔드에 FCM/APNs 토큰 저장 컬럼이 없고 WebSocket/SSE도 없다. 알림은 DB row + 클라이언트 폴링이 유일한 경로다. 실시간 푸시는 [[Risks]]의 후속 과제로 분리한다.

---

## SCR-07 · 캘린더 (월간)

| 항목 | 값 |
|---|---|
| 라우트 | `app/calendar.tsx` (스택 push, 헤더 있음) |
| 진입 | SCR-06 통계 타일 / `이번 주` 헤더 / 마감 `전체 >` |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/page.tsx` 캘린더 섹션 |
| 페이즈 | Phase 6 |
| FR | FR-084 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 대시보드 안의 한 섹션 | **독립 화면으로 분리** | 캘린더 + 일정 리스트를 한 화면에 넣으면 홈이 스크롤 3화면 분량이 된다 |
| 선택 시 `1fr 1fr` 좌우 분할, `calendarContentWidth` 1016→508 등 12개 반응형 수치 전환 | **상단 캘린더 고정 + 하단 일정 리스트** 세로 2단. 반응형 수치 전량 폐기 | 좌우 분할 불가 |
| 포스터 기간 이벤트를 `start/middle/end/single` 세그먼트로 셀을 가로질러 연결 + 주 단위 첫 셀에 `labelSpan` 만큼 라벨 1회 | **셀당 최대 3개 dot(4개 이상은 `+N`)**, 기간 연결선은 셀 하단 2dp 바로 축약 | 53dp 셀에 텍스트 라벨 불가 |
| 월 이동 = `CircleChevronLeft/Right` 버튼 + 화살표 키 | 버튼 유지 + **가로 스와이프 제스처 추가**, 키보드 삭제 | 네이티브 관례 |
| 셀 높이 120px / 날짜 20px | 셀 높이 **56dp** / 날짜 15px / dot 영역 8dp | 6주 × 56 = 336dp가 상한 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  캘린더                    오늘  │  ═ 헤더 56
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │  ‹      2026년 7월       ›     │ │  h2 20/700 · chevron 28dp
│ │  일  월  화  수  목  금  토    │ │  caption
│ │  29  30   1   2   3   4   5    │ │  타월 #CBD5E1
│ │   6   7   8   9  10  11  12    │ │  셀 h56
│ │  13  14  15  16  17  18  19    │ │
│ │  20  21  22  23  24  25  26    │ │
│ │ (27) 28  29  30  31   1   2    │ │  27=오늘 원형 #0077B6
│ │   ●●  ·   ·  ●   ·   ·   ·     │ │  dot 6dp
│ └────────────────────────────────┘ │
│ ● 티켓  ● 포스터                   │  범례 caption
├────────────────────────────────────┤
│ 7월 27일 (월)               2건    │  ═ sticky
│ ┌────────────────────────────────┐ │ ┈
│ │ [티켓]  09:00                  │ │
│ │ 수서 → 부산            SRT  ›  │ │  h72
│ ├────────────────────────────────┤ │
│ │ [포스터]                       │ │
│ │ AI 해커톤 2026     07.25~07.30 │ │
│ └────────────────────────────────┘ │ ┈
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 헤더 | 뒤로 / 타이틀 `캘린더` / `오늘` 버튼 | CMP-20 | `오늘`은 현재 월이 아닐 때만 활성 |
| 캘린더 | 월 네비 + 7×6 그리드 | CMP-33(month) | 이번달 아닌 날 `#CBD5E1`, 선택 셀 배경 `#E8EDF3`, 셀 상단 헤어라인 `#CBD5E1` |
| 캘린더 | 이벤트 dot | CMP-33 내부 | 티켓 `#6746AF`, 포스터 `#0077B6` (**결정**: 원본 캘린더 pill 색 `#FCE7F3/#9D174D`·`#DCFCE7/#166534`는 배지 색과 달라 혼선 → 문서 유형 정본 색으로 통일) |
| 범례 | dot + 라벨 2종 | — | `티켓` `포스터` |
| 일정 | sticky 날짜 헤더 + 개수 배지 | CMP-07 | 배지 `bg #E8F4FD / color #0077B6` |
| 일정 | 리스트 | CMP-34 | 행 h72, 우측 chevron |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 이번 달, 오늘 선택 | — |
| 로딩 | 캘린더 셀 스켈레톤 + 리스트 스켈레톤 2행 | — |
| 성공 | 렌더 | — |
| 빈(해당일) | 리스트 자리 중앙 텍스트, 패딩 40 | `일정이 없습니다` |
| 빈(해당월 전체) | dot 없음 + 리스트 EmptyState | `이번 달 등록된 일정이 없습니다.` / 부제 `티켓과 포스터를 스캔하면 자동으로 표시됩니다.` |
| 에러 | 캘린더 자리 에러 카드 + `다시 시도` | `일정을 불러오지 못했습니다.` |
| 오프라인 | G-5 배너 + 캐시 표시 | 공통 문구 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 날짜 셀 탭 | 선택 변경 + 하단 리스트 교체 | 셀 배경 전환 150ms + selection 햅틱 | — |
| 좌/우 스와이프 | 월 이동 | 슬라이드 250ms | — |
| `‹` `›` 탭 | 월 이동 | selection | — |
| `오늘` 탭 | 이번 달 + 오늘 선택으로 복귀 | `Haptics.impactAsync(Light)` | — |
| 일정 행 탭 | SCR-19 | scale 0.98 | — |
| Pull-to-refresh | 재조회 | 인디케이터 | 토스트 |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-57 `GET /api/tickets` | 화면 진입 1회 | `page=0, size=100` | 키 `['tickets','all']`, staleTime 5분. **`data.content` 언랩 필요**(Spring `Page<>`) |
| API-43 `GET /api/posters` | 화면 진입 1회 | `page=0, size=100` | 키 `['posters','all']`, staleTime 5분, 동일 언랩 |

**가공 로직 (원본 이식)**
```ts
// 원본: dashboard/page.tsx
const getDDay = (s?: string) => s ? Math.ceil((new Date(s).getTime() - todayMs) / 86400000) : Infinity
// 티켓: departureDate 기준 / 포스터: eventEndDate ?? eventStartDate 기준
// uniqueById()로 id 중복 제거 (원본에 실제 중복이 있었다)
// 티켓 라벨: `${departureLocation || '출발지'} → ${arrivalLocation || '도착지'}`
//   ↑ 원본은 ASCII '->' 였다. 결정: 모바일은 '→'(U+2192)로 통일
```

---

## SCR-08 · 알림 목록

| 항목 | 값 |
|---|---|
| 라우트 | `app/notifications.tsx` (스택 push) |
| 진입 | SCR-06 헤더 벨 |
| 인증 | 필요 |
| 원본 | **없음.** 웹은 `dashboard/layout.tsx`에 벨 버튼만 있고 `onClick`이 없다. `lib/api.ts`에 함수 5개가 완비돼 있으나 어떤 `.tsx`도 import하지 않는다 |
| 페이즈 | Phase 6 |
| FR | FR-085, FR-087, FR-088 |

**모바일 변경점 / 신설 근거**
1. 백엔드에 `DeadlineNotificationScheduler`(매일 09:00 KST, `@Scheduled(cron="0 0 9 * * *", zone="Asia/Seoul")`)가 이미 돌고 있고 알림 row가 쌓인다. **소비하는 UI가 없어 기능이 통째로 사장돼 있다** → 모바일에서 완성.
2. `type`은 `"DEADLINE"`(포스터 마감) / `"SCHEDULE"`(티켓 일정) / `"GENERAL"` 3종. `linkUrl`이 웹 경로(`/dashboard/storage/posters`)로 저장되므로 **앱에서 그대로 쓸 수 없다** → `sourceType`+`sourceId`가 아니라 `linkUrl` 문자열을 파싱해 라우트 매핑한다.

| `linkUrl` (서버 저장값) | 앱 라우트 |
|---|---|
| `/dashboard/storage/posters` | `/(tabs)/archive/posters` |
| `/dashboard/storage/tickets` | `/(tabs)/archive/tickets` |
| 그 외/없음 | `/(tabs)` |

3. **알려진 서버 문구 버그**: `formatDDay()`가 `"3일 남았습니다"`를 반환하는데 호출부가 `"…입니다."`를 또 붙여 `"AI 해커톤 2026 마감이 3일 남았습니다입니다."`가 실제로 저장된다. **결정: 앱에서 표시 직전 `남았습니다입니다.` → `남았습니다.` 로 치환**한다(백엔드 무수정 원칙 준수). 치환 규칙은 `message.replace(/남았습니다입니다\.$/, '남았습니다.')`.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  알림                  모두 읽음 │  ═ 헤더
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │●│⏰ 마감 임박          오늘    │ │  미읽음 = 좌측 4dp 바 #0077B6
│ │ │AI 해커톤 2026 마감이 오늘    │ │  + 배경 #F0F9FF
│ │ │입니다.                       │ │
│ ├────────────────────────────────┤ │
│ │ │🎫 일정 임박         어제     │ │  읽음 = 흰 배경
│ │ │수서 → 부산 일정이 2일        │ │
│ │ │남았습니다.                   │ │
│ ├────────────────────────────────┤ │
│ │ │⏰ 마감 임박      7월 20일    │ │
│ │ │…                             │ │
│ └────────────────────────────────┘ │ ┈
│           (무한 스크롤)             │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   행 좌스와이프 → [삭제] 빨강 액션
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 헤더 | 뒤로 / `알림` / `모두 읽음` | CMP-20 | 미읽음 0이면 `모두 읽음` disabled |
| 리스트 | 알림 행 | CMP-44 | 좌 아이콘 24dp(`DEADLINE`=`⏰`/`#DC8540`, `SCHEDULE`=`🎫`/`#6746AF`, `GENERAL`=`🔔`/`#0077B6`), 제목 14/600, 본문 13/400 2줄 말줄임, 우상단 상대시각 11/`#94A3B8` |
| 리스트 | 스와이프 삭제 | CMP-46 | 우→좌 스와이프 80dp에서 `삭제` 노출, 120dp 넘기면 즉시 실행 |
| 하단 | 페이지 로더 | CMP-49 | — |

**상대시각 포맷 (결정)**: `< 1분` → `방금 전`, `< 60분` → `N분 전`, 오늘 → `오늘`, 어제 → `어제`, 그 외 → `M월 D일`

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 스켈레톤 5행 | — |
| 로딩(추가 페이지) | 하단 스피너 32dp | — |
| 성공 | 리스트 | — |
| 빈 | 중앙 EmptyState 아이콘 + 2줄 | `알림이 없습니다` / `마감이 다가오면 알려드릴게요.` |
| 에러 | 리스트 자리 에러 카드 | `알림을 불러오지 못했습니다.` + 버튼 `다시 시도` |
| 오프라인 | G-5 배너 + 캐시 목록 (읽음/삭제 버튼 disabled) | 공통 문구 |
| 권한거부 | 해당 없음 (OS 푸시 권한은 SCR-29 소관) | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 행 탭 | ① `PATCH /read`(API-35) 낙관적 갱신 ② `linkUrl` 매핑 라우트로 이동 | 배경이 흰색으로 200ms fade + selection 햅틱 | 읽음 실패해도 이동은 진행, 배지 롤백 |
| `모두 읽음` 탭 | API-36, 응답 `data.updatedCount` | 전 행 fade + 토스트 `알림 {n}건을 읽음으로 표시했습니다.` | 롤백 + 토스트 `읽음 처리에 실패했습니다.` |
| 좌스와이프 → `삭제` | API-37 낙관적 제거 | 행 슬라이드아웃 200ms + `Haptics.impactAsync(Medium)` | 행 복원 + 토스트 `삭제에 실패했습니다.` |
| 스크롤 하단 도달 | 다음 페이지 요청 | 하단 스피너 | 토스트 |
| Pull-to-refresh | 1페이지 재조회 + unread-count 갱신 | 인디케이터 | 토스트 |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-32 `GET /api/notifications` | 진입 + 무한 스크롤 | `page`, `size=20` (서버 `MAX_PAGE_SIZE=50`) | `useInfiniteQuery(['notifications'])`, staleTime 30초. **`data.content`/`data.totalPages` 언랩** |
| API-35 `PATCH /{id}/read` | 행 탭 | — | mutation + `['notif','unread']` invalidate |
| API-36 `PATCH /read-all` | 헤더 버튼 | — | 응답 `data.updatedCount` |
| API-37 `DELETE /{id}` | 스와이프 | — | mutation |

---
## 스캔 파이프라인 개요 (SCR-09 ~ SCR-13)

원본 `/dashboard/upload` **1페이지**를 모바일 **5화면 위저드**로 분해한다.

```
[SCR-09 카메라] ──촬영──▶ [SCR-10 크롭] ──확인──▶ [SCR-11 분석] ──▶ [SCR-12 확인/편집] ──저장──▶ [SCR-13 완료]
       │                       ▲                                          │                     │
       └─앨범 선택─────────────┘                                    다시 스캔 ◀───────────────────┘
```

| 원본 요소 | 모바일 배치 | 이유 |
|---|---|---|
| 좌우 `1fr 1fr` (이미지 \| 폼) | 화면 분리 | 390dp에 2단 불가 |
| 드래그앤드롭 존(`onDragOver/Leave/Drop`, `isDragOver`, `2px dashed`) | **전량 삭제** → 카메라 우선 진입 | 모바일에 파일 드래그 없음 |
| `<input type="file" accept="image/*">` (capture 속성 없음) | expo-camera + expo-image-picker | 원본은 카메라 직행 경로가 아예 없었다 |
| 스캔 버튼 → 폼 표시 | 진행 화면(SCR-11) 삽입 | OCR + 분류가 2~10초 걸린다. 버튼 라벨 `스캔 중...`만으로는 상용 수준 미달 |
| bbox 오버레이 클릭 연동 | SCR-21 이미지 뷰어로 분리 | 핀치줌 없이 좌표 매칭 불가 |
| 저장 완료 패널(같은 페이지) | SCR-13 화면 | 상태 전환보다 화면 전환이 백스택 관리에 유리 |

**공통 진실**

| 항목 | 값 | 근거 |
|---|---|---|
| 업로드 상한 | **10MB** | `spring.servlet.multipart.max-file-size: 10MB`. 원본 UI 문구 `최대 20MB`는 **틀렸다** → 앱 문구는 `최대 10MB`로 수정 |
| 서버측 리사이즈 | 긴 변 1280px, quality 90 | `ocr/services` `MAX_IMAGE_SIDE = 1280`. 단 Spring 10MB 한도를 **통과한 다음** 일이라 클라 리사이즈가 필수 |
| 클라 리사이즈(결정) | **전송 장변 1280px**, JPEG **quality 0.85**, 목표 ≤1.2MB, EXIF 제거 (`expo-image-manipulator`) | 서버가 어차피 `MAX_IMAGE_SIDE=1280`으로 축소하므로 1280 초과 전송은 정확도 이득이 0이다. 규격 정본 = [[Camera and Scan]] IMG-01~07 |
| 필드 키 계층 | OCR = **snake_case**, Spring = **camelCase** | 매핑표는 [[API Contract]] / [[Data Model]] |
| 분류 결과 | `BUSINESS_CARD` / `POSTER` / `RECEIPT` / `TICKET` / `ETC` | 이미지 분류 모델은 3클래스(`namecard`/`poster`/`recipt`)뿐. **TICKET은 OCR 텍스트 키워드 2개 이상 매칭 시에만** 판정되고 이때 confidence는 항상 `1.0` |

---

## SCR-09 · 스캔 · 카메라

| 항목 | 값 |
|---|---|
| 라우트 | `app/scan/index.tsx` (`presentation: 'fullScreenModal'`, 탭바 숨김) |
| 진입 | 탭바 중앙 스캔 버튼, SCR-06 EmptyState CTA, 각 보관함 `등록하기` |
| 인증 | 필요 (단 API-41 자체는 비회원 허용) |
| 원본 | `frontend/app/dashboard/upload/page.tsx` 좌측 드롭존 |
| 페이즈 | Phase 3 |
| FR | FR-035, FR-036, FR-037, FR-052 |

**모바일 변경점**: 드롭존 UI 전체를 라이브 카메라 프리뷰로 교체. 원본 안내 카피(`지원 형식` / `업로드 팁` 3개)는 **카메라 하단 힌트 1줄 + 도움말 시트**로 압축.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  다크 상태바
│ ✕                          ⚡  ?   │  닫기 / 플래시 / 도움말
│                                    │
│   ┌──────────────────────────┐     │
│   ┌ ─                    ─ ┐ │     │  가이드 프레임
│   │                        │ │     │  모서리 24dp L자 · #FFFFFF
│   │                        │ │     │  비율은 마지막 분류 결과 기반
│   │      라이브 프리뷰       │ │     │  (기본 3:2 가로)
│   │                        │ │     │
│   └ ─                    ─ ┘ │     │
│   └──────────────────────────┘     │
│                                    │
│   빛 반사가 없도록 정면에서 촬영하세요 │  bodySm / rgba(255,255,255,.8)
│                                    │
│  ┌──────────────────────────────┐  │
│  │  명함  포스터  영수증  티켓   │  │  선택형 힌트 칩(선택사항)
│  └──────────────────────────────┘  │
│                                    │
│    ▒▒▒        ( ● )         ⟳     │
│   앨범        셔터 72dp     전/후  │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 상단 | 닫기 `✕` / 플래시 토글 / 도움말 `?` | CMP-02 | 44dp 타깃, `rgba(0,0,0,0.4)` 원형 배경 |
| 중앙 | 가이드 프레임 | 인라인 | L자 모서리 24dp, 두께 3dp |
| 중앙 | 힌트 텍스트 | — | 원본 팁 `빛 반사나 그림자가 없는 정면 촬영을 권장합니다.`를 1줄로 압축 |
| 하단 | 문서 유형 힌트 칩 4개 | CMP-06 | **선택 사항**. 선택 시 가이드 프레임 비율만 바뀌고 서버 분류를 강제하지 않음 |
| 하단 | 앨범 썸네일 / 셔터 / 카메라 전환 | CMP-02, 인라인 | 셔터 72dp 흰 원 + 4dp 링 |
| 시트 | 도움말 바텀시트 | CMP-17 | 원본 `업로드 팁` 3개 + `지원 형식` 원문 |

> **다크 (국소 예외)** — 이 화면의 오버레이는 **테마와 무관하게 항상 다크 고정**이다. 프리뷰가 화면 전체를 덮으므로 배경 토큰이 개입할 여지가 없고, 라이트 테마에서 밝은 컨트롤 바를 얹으면 흰 아이콘이 밝은 프리뷰 위에서 사라진다. 상·하단 컨트롤 바는 `overlay.image`, 아이콘·힌트 텍스트·가이드 프레임·셔터는 흰색 고정, 상태바는 `light-content` 고정. 단 **도움말 바텀시트(CMP-17)는 테마를 따른다** — 프리뷰 위가 아니라 시트 표면 위의 읽기 콘텐츠이기 때문이다. 근거: [[Design Tokens]] §10-3 `overlay.image`.

**도움말 시트 문구 (원본 그대로 + 상한 수정)**
- 제목 `촬영 가이드`
- `선명하고 깨끗한 이미지 사용을 권장합니다.`
- `빛 반사나 그림자가 없는 정면 촬영을 권장합니다.`
- `텍스트가 잘 보이도록 고해상도 이미지를 사용하세요.`
- 소제목 `지원 형식` → `JPG, PNG 지원` · `최대 10MB` (**PDF 제거**: expo-camera/picker 경로에 PDF가 들어올 수 없고, 원본 `20MB` 표기는 서버 한도와 불일치)

**상태**

| 상태 | 화면 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 권한 요청 전 → 검은 화면 + 중앙 안내 + 버튼 | `카메라로 문서를 스캔합니다.` / 버튼 `카메라 권한 허용` |
| 로딩 | 프리뷰 준비 중 검은 화면 + 스피너 | — |
| 성공 | 라이브 프리뷰 | — |
| 빈 | 해당 없음 | — |
| 에러(카메라 초기화 실패) | 검은 화면 + 에러 블록 | `카메라를 사용할 수 없습니다.` / `앨범에서 사진을 선택해 주세요.` / 버튼 `앨범 열기` |
| 오프라인 | 촬영은 허용, 상단 배너 | `오프라인입니다. 연결되면 분석을 시작합니다.` (촬영본은 로컬 보관 후 SCR-11에서 재시도) |
| **권한거부** | 검은 화면 + 안내 + 설정 딥링크 | `카메라 권한이 필요합니다.` / `설정에서 카메라 접근을 허용하면 문서를 촬영할 수 있어요.` / 버튼 `설정 열기`(`Linking.openSettings()`) · `앨범에서 선택` |
| 권한거부(앨범) | 앨범 탭 시 동일 패턴 | `사진 접근 권한이 필요합니다.` / `설정에서 사진 접근을 허용해 주세요.` |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 셔터 탭 | `takePictureAsync({quality:0.9, skipProcessing:false})` → SCR-10 | 화면 흰색 플래시 80ms + `Haptics.impactAsync(Medium)` + 셔터음(OS 정책 준수) | 토스트 `촬영에 실패했습니다.` |
| 앨범 탭 | `ImagePicker.launchImageLibraryAsync({mediaTypes:'images', quality:1})` → SCR-10 | selection 햅틱 | 권한거부 안내 |
| 플래시 토글 | `off → on → auto` 순환 | 아이콘 교체 + selection | — |
| 카메라 전환 | 전/후면 | 프리뷰 flip 250ms | — |
| 힌트 칩 탭 | 가이드 프레임 비율 변경(명함 5:3 / 영수증 2:5 / 포스터 3:4 / 티켓 5:2) | 프레임 morph 200ms + selection | — |
| `?` 탭 | 도움말 시트 | 시트 스프링 | — |
| `✕` 탭 / Android 백 | 모달 dismiss | — | — |
| 볼륨 상/하 키 | 셔터 (결정: 네이티브 카메라 관례) | 동일 | — |

**데이터**: API 호출 없음. 결과 파일 URI를 라우트 파라미터로 SCR-10에 전달.

---

## SCR-10 · 스캔 · 크롭/보정

| 항목 | 값 |
|---|---|
| 라우트 | `app/scan/crop.tsx` (`fullScreenModal`) |
| 진입 | SCR-09 촬영/앨범 선택 |
| 인증 | 필요 |
| 원본 | **없음.** 웹은 원본 파일을 그대로 업로드했다 |
| 페이즈 | Phase 3 |
| FR | FR-038, FR-039 |

**신설 근거**: OCR 정확도는 입력 이미지 품질에 직결된다(원본 챗봇 도움말도 `실제 문서 인식 결과는 이미지 품질에 따라 달라질 수 있으니…`라고 명시). 폰 촬영은 여백·기울기가 크므로 크롭/회전 단계가 인식률에 가장 큰 레버다. 또한 여기서 **10MB 상한을 만족시키는 리사이즈**를 수행한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ 취소          자르기          완료  │  ═ 헤더(다크)
├────────────────────────────────────┤
│                                    │
│   ┌─┬────────────────────┬─┐       │
│   ├─┘▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒└─┤       │  8방향 핸들 24dp
│   │  ▒▒▒▒  촬영 이미지 ▒▒▒  │       │  격자 3×3 rgba(255,255,255,.3)
│   │  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │       │  외부 딤 rgba(0,0,0,.6)
│   ├─┐▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┌─┤       │
│   └─┴────────────────────┴─┘       │
│                                    │
├────────────────────────────────────┤
│   ⟲       ⟳       ⤢       ↺       │  ═ 툴바
│ 왼쪽회전  오른쪽  비율맞춤  초기화  │  caption
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 헤더 | `취소` / `자르기` / `완료` | CMP-20 | `완료`는 `point` 색, 처리 중 `처리 중...` |
| 본문 | 크롭 캔버스 | 인라인(`react-native-gesture-handler` Pan/Pinch) | 최소 크롭 크기 80×80px |
| 툴바 | 회전 ×2 / 비율맞춤 / 초기화 | CMP-02 | 회전은 90° 단위 |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 전체 영역 선택된 크롭 박스 | — |
| 로딩 | 이미지 디코딩 중 스켈레톤 | — |
| 성공 | `완료` 탭 → 리사이즈 → SCR-11 | — |
| 빈 | 해당 없음 | — |
| 에러(용량 초과) | 처리 후에도 10MB 초과 시 다이얼로그 | `이미지 용량이 너무 큽니다.` / `10MB 이하 이미지만 업로드할 수 있어요. 화질을 낮춰 다시 시도합니다.` / 버튼 `계속` (자동 재압축 quality 0.6) · `취소` |
| 에러(처리 실패) | 토스트 | `이미지를 처리하지 못했습니다.` |
| 오프라인 | 정상 동작 (로컬 처리) | — |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 핸들 드래그 | 크롭 영역 변경 | 격자 표시 + 경계에서 `Haptics.selectionAsync()` | — |
| 캔버스 핀치/팬 | 확대·이동 (1.0~4.0배) | — | — |
| 회전 탭 | 90° 회전 | 250ms spring + selection | — |
| `비율맞춤` 탭 | 이미지 전체가 보이도록 리셋 | 200ms | — |
| `초기화` 탭 | 크롭·회전 원복 | `Haptics.impactAsync(Light)` | — |
| `완료` 탭 | `manipulateAsync([crop, rotate, resize 1280])` → `SaveFormat.JPEG 0.85` → SCR-11 | 헤더 라벨 `처리 중...`, 캔버스 dim | 에러 다이얼로그 |
| `취소` / 백 | SCR-09로 복귀 (촬영본 폐기) | — | — |

**데이터**: 없음. 결과 URI + 픽셀 크기를 SCR-11에 전달.

---

## SCR-11 · 스캔 · 분석 진행

| 항목 | 값 |
|---|---|
| 라우트 | `app/scan/analyzing.tsx` (`fullScreenModal`, 백 제스처 비활성) |
| 진입 | SCR-10 완료 |
| 인증 | 필요 |
| 원본 | `upload/page.tsx`의 버튼 라벨 `스캔 중...` 및 우측 안내 패널 `처리 과정` 4스텝 |
| 페이즈 | Phase 3 |
| FR | FR-040, FR-041, FR-042 |

**모바일 변경점**: 원본은 `disabled` 버튼 + 텍스트 하나가 전부였다. 실제 처리는 **① 업로드 ② PaddleOCR ③ 분류 ④ 필드 추출** 4단계이고 총 2~10초가 걸린다 → 원본 안내 패널의 4스텝을 **진행 인디케이터로 승격**해 대기 체감을 관리한다.

| 원본 스텝 | 아이콘 | 모바일 진행 라벨 |
|---|---|---|
| `업로드` | `↑` | `이미지를 올리는 중...` (실제 업로드 진행률 %) |
| `OCR 추출` | `◎` | `텍스트를 읽는 중...` |
| `정보 구조화` | `▤` | `정보를 정리하는 중...` |
| `결과 확인` | `✓` | `거의 다 됐어요...` |

> 서버는 단계별 콜백을 주지 않는다(단일 `POST /api/scan`). **결정: 업로드 진행률만 실제 값**(`fetch` upload progress)이고, 이후 3단계는 응답 대기 중 **1.6초 간격 순차 점등**하는 연출이다. 이 사실을 [[Mobile UX Guide]]에 명시해 "가짜 진행률" 오해를 막는다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                              취소  │
├────────────────────────────────────┤
│                                    │
│      ┌──────────────────┐          │
│      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│          │
│      │▒  크롭된 이미지  ▒│  240×160 │
│      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│          │
│      └──────────────────┘          │
│        ═══════════════             │  스캔 라인 상하 왕복 1.2s
│                                    │
│  ●───●───○───○                     │  스텝 인디케이터
│  ↑    ◎   ▤   ✓                    │  활성 원 44dp b2 #0077B6 bg #F0F9FF
│                                    │
│      텍스트를 읽는 중...            │  h3 17/700 / brand
│      잠시만 기다려 주세요            │  bodySm / textMuted
│                                    │
│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  62%         │  ProgressBar h6 r3
│                                    │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 스텝 1 활성, 진행률 0% | `이미지를 올리는 중...` |
| 로딩 | 스텝 순차 점등 | 위 4개 라벨 |
| 성공 | Success 햅틱 → SCR-12로 `replace` | — |
| 빈 | OCR 블록 0개 → SCR-12로 이동하되 빈 폼 안내 | (SCR-12에서 처리) |
| 에러(서버) | 중앙 에러 블록으로 교체 | `문서를 인식하지 못했습니다.` / 서버 메시지 있으면 그대로 노출 / 버튼 `다시 시도` · `다른 사진 선택` |
| 에러(413/용량) | 동일 | `이미지 용량이 너무 큽니다. 10MB 이하로 다시 시도해 주세요.` |
| 에러(타임아웃 60초) | 동일 | `분석이 너무 오래 걸립니다.` / `네트워크 상태를 확인하고 다시 시도해 주세요.` |
| 오프라인 | 즉시 에러 블록 | `OCR 서버에 연결할 수 없습니다.` + 버튼 `다시 시도` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 화면 진입 | `POST /api/scan` (API-41) multipart `file` | 스캔 라인 애니메이션 | 에러 블록 |
| `취소` 탭 | `AbortController.abort()` → SCR-09 복귀 | 확인 다이얼로그 없음(비파괴) | — |
| Android 백 | **차단** (진행 중 이탈 방지). 두 번 누르면 `취소`와 동일 | 토스트 `한 번 더 누르면 분석을 취소합니다.` | — |
| `다시 시도` | 동일 파일로 재요청 (최대 3회) | 진행률 리셋 | 3회 초과 시 `다른 사진 선택`만 노출 |

**데이터**

| API | 시점 | 요청 | 응답 처리 |
|---|---|---|---|
| API-41 `POST /api/scan` | 진입 즉시 | `multipart/form-data`, 파트명 **`file`**. `Content-Type` 헤더를 직접 설정하지 않는다(boundary 자동) | **이중 래핑 언랩 필수**: `json.data?.data ?? json.data` — Spring이 FastAPI 응답을 통째로 감싼다 |

**응답 스키마 (`ScanResult`)**
```ts
{
  type: 'BUSINESS_CARD'|'POSTER'|'RECEIPT'|'TICKET'|'ETC',
  confidence: number,                    // 0~1, TICKET 규칙 판정이면 항상 1.0
  parsed: Record<string,string>,         // 값이 실제로 뽑힌 필드만 (빈 값은 키 자체가 없음)
  fields: Record<string,string>,         // {외부필드명: 한국어라벨} 전체 목록 — 폼 렌더링용
  items: unknown[],                      // 항상 [] (서버 미구현)
  image_url: '',                         // 항상 빈 문자열 — 영구 URL은 API-63에서 받는다
  raw_blocks: { block_index:number; text:string; confidence:number; bbox:number[][] }[],
  image_size?: { width:number; height:number }
}
```
캐시: 저장하지 않는다. 결과 객체는 스캔 세션 스토어(Zustand, 화면 이탈 시 폐기)에 보관.

---

## SCR-12 · 스캔 결과 확인 / 편집

| 항목 | 값 |
|---|---|
| 라우트 | `app/scan/review.tsx` (`fullScreenModal`) |
| 진입 | SCR-11 성공 |
| 인증 | 필요 (저장이 로그인 필수) |
| 원본 | `upload/page.tsx` 우측 파싱 폼 + 하단 OCR 블록 칩 리스트 |
| 페이즈 | Phase 3 |
| FR | FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| `<select>` 문서 유형 드롭다운 (5옵션) | **세그먼트 5칸 가로 스크롤 칩** | 네이티브 피커보다 오분류 정정이 1탭 |
| 라벨 `width:90` 고정 + input 가로 배치 | **라벨 위 / 입력 아래 세로 배치** | 390dp에서 라벨 잘림 |
| 이미지 최대 높이 500px + bbox 오버레이 인라인 | 상단 **120dp 썸네일 스트립**, 탭 시 SCR-21 뷰어 | 폼 공간 확보 |
| OCR 블록 칩 `flexWrap` 전량 나열 | **접힘 섹션**(기본 접힘, `OCR 원문 {n}개` 헤더) | 블록 수십 개면 화면을 다 잡아먹음 |
| 저장 = `saveCard(...)` 1콜 | **2콜: API-63(이미지 영구화) → API-13/42/48/56(도메인 저장)** | 원본 흐름 그대로. `/api/scan`의 `image_url`은 항상 빈 문자열이라 commit이 선행돼야 한다 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  결과 확인                       │  ═ 헤더
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒▒▒▒▒▒ 썸네일 ▒▒▒▒▒▒▒     🔍   │ │  h120 · 탭→SCR-21
│ └────────────────────────────────┘ │
│                                    │
│ 문서 유형              신뢰도 98.7%│  caption / textDisabled
│ ┌──────────────────────────────┐   │
│ │[명함] 포스터 영수증 티켓 기타 │→ │  선택 칩 bg#15293D
│ └──────────────────────────────┘   │
│                                    │
│ 이름                               │  caption 11 / #999
│ ┌────────────────────────────────┐ │
│ │ 이응환                         │ │  h48 r10 bg#FAFBFC b#CBD5E1
│ └────────────────────────────────┘ │
│ 회사명                             │
│ ┌────────────────────────────────┐ │
│ │ 우주관광(주)                   │ │
│ └────────────────────────────────┘ │
│ 직책                               │
│ ┌────────────────────────────────┐ │
│ │                                │ │  빈 값도 필드는 노출
│ └────────────────────────────────┘ │
│           … (유형별 전체 필드) …    │
│                                    │
│ ▸ OCR 원문 24개                    │  접힘 헤더
│                                    │ ┈
├────────────────────────────────────┤
│ ┌───────────┐ ┌──────────────────┐ │ ═ 하단 고정 액션바
│ │ 다시 스캔 │ │    확인 & 저장   │ │  h52 · secondary/primary
│ └───────────┘ └──────────────────┘ │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**필드 스키마 (원본 `DOCUMENT_FIELD_SCHEMAS` 원문 — 순서까지 그대로 유지)**

| 유형 | 필드 키 → 라벨 |
|---|---|
| `BUSINESS_CARD` | `name` 이름 · `english_name` 영문 이름 · `company_name` 회사명 · `department` 부서 · `job_title` 직책 · `mobile_phone` 휴대폰 · `office_phone` 유선 전화 · `fax` 팩스 · `email` 이메일 · `address` 주소 · `website` 웹사이트 · `zip_code` 우편번호 |
| `POSTER` | `title` 제목 · `organizer_name` 주최자 · `event_start_date` 행사 시작일 · `event_end_date` 행사 종료일 · `contact_phone` 연락처 전화 · `contact_email` 연락처 이메일 · `location` 장소 · `website_url` 웹사이트 URL |
| `RECEIPT` | `store_name` 업체 이름 · `purchase_date` 구매일자 · `total_amount` 합계금액 |
| `TICKET` | `transport_type` 교통수단 · `departure_location` 출발지 · `departure_date` 출발일 · `departure_time` 출발 시간 · `arrival_location` 도착지 · `arrival_date` 도착일 · `arrival_time` 도착 시간 |
| `ETC` | (없음) |

> 렌더 규칙(원본 그대로): `labels = Object.keys(res.fields).length > 0 ? res.fields : DOCUMENT_FIELD_SCHEMAS[type]`, 각 키의 초기값은 `parsed[key] ?? ''`.

> **다크 (국소 예외)** — 상단 **120dp 이미지 미리보기 스트립만 다크에서도 라이트 표면**(`#F8FAFC`)을 유지한다. 흰 종이 문서 이미지가 화면 상단을 가로로 꽉 채우므로 그 컨테이너를 다크로 만들면 대비 충격이 이 앱에서 가장 커진다. 이미지 자체에는 필터를 걸지 않고(판독성 훼손 금지), 컨테이너에 `border.subtle` 1px + `radius.card` + 사방 4dp 매트를 준다. 스트립 위 확대 아이콘 `🔍`은 `overlay.image` 배지 위 흰색. **폼·칩·액션바 등 나머지 영역은 정상적으로 테마를 따른다** — 즉 이 화면은 다크에서 "밝은 이미지 띠 + 어두운 폼"이 되며 의도된 것이다. 근거: [[Design Tokens]] §10-5 SCR-12 행, [[ADR-004 Styling]] §결과 부정 9.

**유형 변경 시 값 승계 (원본 `COMMON_FIELD_MAP` 그대로)**
```ts
const COMMON_FIELD_MAP = {
  mobile_phone:  ['contact_phone', 'office_phone'],
  contact_phone: ['mobile_phone', 'office_phone'],
  office_phone:  ['mobile_phone', 'contact_phone'],
  email:         ['contact_email'],
  contact_email: ['email'],
  website:       ['website_url'],
  website_url:   ['website'],
}
// 순서: ① 새 스키마 키에 기존 값이 있으면 유지
//       ② COMMON_FIELD_MAP 매핑 키에 값이 있으면 승계
//       ③ 없으면 ocrScanResult.parsed[key] ?? ''
```

**입력 타입 매핑 (결정 — 원본은 전부 text input이었다)**

| 필드 | keyboardType / 부가 |
|---|---|
| `*_phone`, `fax` | `phone-pad`, 입력 중 하이픈 자동 정규화 안 함(서버 정제 규칙 존중) |
| `email`, `contact_email` | `email-address`, `autoCapitalize="none"` |
| `website`, `website_url` | `url`, `autoCapitalize="none"` |
| `zip_code` | `number-pad`, `maxLength=5` |
| `total_amount` | `numeric`, 표시용 천단위 콤마(전송 시 원문 유지) |
| `*_date` | `default` + 우측 캘린더 아이콘 → 네이티브 DatePicker 시트 (포맷 `YYYY-MM-DD`) |
| `*_time` | `default` + 시계 아이콘 → TimePicker 시트 (포맷 `HH:MM`) |
| `address`, `title` | `multiline`, 최대 3줄 |
| 그 외 | `default` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 분류 결과 칩 선택 + 값 채워진 폼 | 신뢰도 `신뢰도 {(confidence*100).toFixed(1)}%` |
| 로딩(저장) | 하단 버튼 라벨 교체 + 폼 dim | `저장 중...` |
| 성공 | SCR-13으로 `replace` | — |
| 빈(추출 0건) | 폼은 전부 빈 값, 상단 안내 배너 | `인식된 정보가 없습니다.` / `직접 입력하거나 다시 촬영해 주세요.` (bg `#FFFBEB`, border `#FDE68A`, text `#92400E`) |
| 빈(ETC 분류) | 폼 자리에 중앙 안내 + 유형 재선택 유도 | `기타 문서는 아직 필드 스키마가 정의되지 않았습니다.` (원문) — 저장 버튼 disabled |
| 에러(저장 실패) | 상단 인라인 에러 배너 | 서버 메시지 우선, 없으면 `저장 실패` (원문) |
| 에러(이미지 커밋 실패) | 다이얼로그 | `이미지를 저장하지 못했습니다.` / `이미지 없이 저장할까요?` / 버튼 `이미지 없이 저장` · `다시 시도` |
| 부분 성공 | 저장은 되고 `message` 동반 → SCR-13에서 경고 배너 | 서버 `message` 원문 (예: `임베딩 생성에 실패하여 Fuzzy 검색 결과만 반환합니다`) |
| 오프라인 | G-5 배너 + 저장 버튼 disabled + 폼 값 로컬 보존 | `오프라인입니다. 연결되면 저장할 수 있어요.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 유형 칩 탭 | 스키마 교체 + `COMMON_FIELD_MAP` 승계 | 폼 crossfade 200ms + selection 햅틱 | — |
| 필드 입력 | 로컬 상태 갱신 | — | — |
| 날짜/시간 필드 탭 | 네이티브 피커 시트 | 시트 스프링 | — |
| 썸네일 탭 | SCR-21 (bbox 오버레이 포함) | scale 0.98 | — |
| `OCR 원문 {n}개` 탭 | 섹션 펼침/접힘 | `LayoutAnimation` 200ms | — |
| OCR 칩 탭 | SCR-21 열고 해당 블록 하이라이트 | selection | — |
| `확인 & 저장` 탭 | 아래 저장 시퀀스 | 버튼 로딩 + 폼 dim | 에러 배너 + Error 햅틱 |
| `다시 스캔` 탭 | 확인 다이얼로그 → SCR-09 | `Haptics.notificationAsync(Warning)` | — |
| Android 백 / `‹` | 값 변경 있으면 확인 다이얼로그 | — | — |

**이탈 확인 다이얼로그**: 제목 `저장하지 않고 나갈까요?` / 본문 `입력한 내용이 사라집니다.` / 버튼 `나가기`(destructive) · `계속 작성`

**데이터 — 저장 시퀀스**

```
1) API-63  POST {OCR_BASE}/api/commit   multipart
   file=<크롭된 이미지>, document_type=<TYPE>,
   raw_blocks=JSON.stringify(rawBlocks), corrected_fields=JSON.stringify(editFields)
   → { image_url: '/uploads/{TYPE}/{uuid}.jpg', count }
   ※ 인증 헤더 없음(OCR 서버 직결). 실패해도 2)는 진행 가능(imageUrl='')

2) 유형별 도메인 저장 (Authorization: Bearer 필수)
```

| 유형 | API | 바디 (원본 `api.ts` 매핑 그대로) |
|---|---|---|
| `BUSINESS_CARD` | API-13 `POST /api/cards/save` | `{ imageUrl, rawOcrText: rawTexts.join('\n'), name: f.name, company: f.company_name, position: f.job_title, phone: f.mobile_phone \|\| f.contact_phone, email: f.email \|\| f.contact_email }` — **`docType`/`classificationConfidence`/`parsedJson`/`rawJson` 미전송** |
| `TICKET` | API-56 `POST /api/tickets/save` | `{ docType:'TICKET', classificationConfidence, transportType, departureLocation, departureDate, departureTime, arrivalLocation, arrivalDate, arrivalTime, rawText: rawTexts(배열), parsedJson: JSON.stringify({...fields, imageUrl}), rawJson: JSON.stringify(rawBlocks) }` |
| `POSTER` | API-42 `POST /api/posters/save` | 위와 동형 + `title, organizerName, eventStartDate, eventEndDate, contactPhone, contactEmail, location, fee:'', websiteUrl, description:''` |
| `RECEIPT` | API-48 `POST /api/receipts/save` | 위와 동형 + `merchantName, merchantAddress, purchaseDate, purchaseTime, paymentMethod, cardCompany, totalAmount: parseMoney(...), currencyCode:'KRW', items: []` |

> **명함만 스키마 계열이 다르다.** 나머지 3종은 `docType + classificationConfidence + rawText[] + parsedJson + rawJson` 5종 세트를 공유한다. 저장 추상화 함수는 이 비대칭을 분기로 명시해야 한다.
> **`imageUrl`은 Ticket/Poster/Receipt DTO에 컬럼이 없다.** `parsedJson` 문자열 안에 넣는 것이 유일한 경로이고, 조회 시 `JSON.parse(parsedJson).imageUrl`로 꺼낸다. 명함만 정식 컬럼을 가진다.

`parseMoney` (원본 그대로):
```ts
const parseMoney = (v?: string): number | null => {
  if (!v) return null
  const n = v.replace(/[^\d.-]/g, '')
  if (!n) return null
  const a = Number(n)
  return Number.isFinite(a) ? a : null
}
```

캐시: 저장 성공 시 `['dashboard']`, `['cards'|'tickets'|'posters'|'receipts']` invalidate.

---

## SCR-13 · 저장 완료

| 항목 | 값 |
|---|---|
| 라우트 | `app/scan/done.tsx` (`fullScreenModal`, 백 차단) |
| 진입 | SCR-12 저장 성공 |
| 인증 | 필요 |
| 원본 | `upload/page.tsx` 저장 완료 패널 |
| 페이즈 | Phase 3 |
| FR | FR-051 |

**모바일 변경점**: 원본은 같은 페이지의 조건부 패널이었고 버튼이 `다른 이미지 스캔` 하나뿐이었다. 모바일은 **① 저장한 문서 보기 ② 계속 스캔 ③ 완료** 3분기를 제공한다 — 연속 스캔(명함 여러 장)이 모바일의 지배적 사용 패턴이기 때문.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                                    │
│                                    │
│              ┌────┐                │
│              │ ✓  │  56dp 원 #0077B6
│              └────┘                │  체크 28dp white
│                                    │
│          저장되었습니다             │  h2 20/700 #15293D
│                                    │
│      명함 · 이응환 · 우주관광(주)    │  bodySm / textMuted
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ⚠ (부분 성공 메시지 자리)       │ │  bg#FFFBEB b#FDE68A c#92400E
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │        저장한 문서 보기        │ │  primary lg
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │        계속 스캔하기           │ │  secondary lg
│ └────────────────────────────────┘ │
│              완료                  │  ghost
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**서브 텍스트 규칙 (원본 이식)**: `{TYPE_LABELS[documentType]} · {저장된 필드값 중 비어있지 않은 상위 2개를 ' · '로 join}`. 값이 하나도 없으면 유형 라벨만 표시.

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 체크 원 scale 0.6→1.0 spring + Success 햅틱 | `저장되었습니다` |
| 로딩 | 해당 없음 | — |
| 성공 | 위와 동일 | — |
| 빈 | 필드값이 전부 비면 서브텍스트에 유형만 | 예: `기타` |
| 에러 | 이 화면에 도달했으면 저장은 성공한 상태. 에러 없음 | — |
| 부분 성공 | 경고 배너 노출 | 서버 `message` 원문. 예: `임베딩 생성에 실패하여 Fuzzy 검색 결과만 반환합니다` |
| 오프라인 | 도달 불가 | — |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 화면 진입 | 체크 애니메이션 + `Haptics.notificationAsync(Success)` | — | — |
| `저장한 문서 보기` | 모달 dismiss → 해당 보관함 목록(SCR-15~18) → SCR-19 상세 시트 자동 오픈 | selection | 목록 진입까지만 |
| `계속 스캔하기` | SCR-09로 `replace` (스캔 세션 초기화) | `Haptics.impactAsync(Light)` | — |
| `완료` | 모달 전체 dismiss → SCR-06 | selection | — |
| Android 백 | `완료`와 동일 | — | — |

**데이터**: 없음(SCR-12 응답을 그대로 표시). 진입 시 관련 쿼리 invalidate만 수행.

---
## SCR-14 · 보관함 허브

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/archive/index.tsx` (탭 2 · `보관함`) |
| 진입 | 탭바, SCR-06 `보관 문서` 타일 |
| 인증 | 필요 |
| 원본 | `dashboard/layout.tsx`의 **보관함 드롭다운** (4개 라우트 목록) — 독립 화면은 없었다 |
| 페이즈 | Phase 4 |
| FR | FR-053, FR-060, FR-067 |

**모바일 변경점 / 신설 근거**
1. 웹은 헤더 드롭다운에서 4개 라우트로 바로 갔다. 모바일 하단 탭은 드롭다운을 가질 수 없으므로 **허브 화면이 필요**하다.
2. 원본 랜딩 목업 `ListScreen`이 이미 정답을 제시한다: 상단 가로 스크롤 필터 칩 `전체 / 명함 / 티켓 / 영수증 / 포스터` + 단일 리스트. **결정: 허브는 "전체" 뷰 + 유형 칩**으로 만들고, 칩 선택 시 같은 화면에서 필터링하되 **`전체 >` 링크로 유형 전용 화면(SCR-15~18)으로 갈 수 있게** 한다. 유형별 화면은 그룹·정렬·가계부 KPI 등 유형 고유 기능이 있어 없앨 수 없다.
3. 유형 순서는 원본 `STORAGE_ITEMS` 순서(명함 → 티켓 → 포스터 → 영수증)를 따른다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ 보관함                       ⊞ / ☰ │  ═ 헤더 + 그리드/리스트 토글
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │ ═ 필터 칩 (sticky)
│ │[전체 41] 명함12 티켓8 포스터9 │→ │  h34 r999
│ └──────────────────────────────┘   │
├────────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐      │ ┈ 그리드 2열 gap12
│ │▒▒▒▒▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒▒▒▒▒│      │  썸네일 aspect 4:3
│ │▒▒ 썸네일 ▒▒│ │▒▒ 썸네일 ▒▒│      │
│ │────────────│ │────────────│      │
│ │[명함]      │ │[티켓]      │      │  배지 micro
│ │이응환      │ │수서 → 부산 │      │  bodyStrong 1줄
│ │우주관광(주)│ │SRT · 08.02 │      │  caption 1줄
│ └────────────┘ └────────────┘      │
│ ┌────────────┐ ┌────────────┐      │
│ │            │ │            │      │
│ └────────────┘ └────────────┘      │
│         (무한 스크롤)               │ ┈
│                            ┌────┐  │
│                            │🐱 │  │
│                            └────┘  │
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

리스트 모드(`☰`) 행:
```
│ ┌────────────────────────────────┐ │
│ │▒▒▒▒│[명함] 이응환          ›  │ │  썸네일 72×48 r6
│ │▒▒▒▒│우주관광(주) · 07.27      │ │  h72
│ └────────────────────────────────┘ │
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 헤더 | 타이틀 `보관함` / 뷰 토글 | CMP-20, CMP-02 | 토글 상태는 AsyncStorage `mora_archive_view`에 영속 |
| 필터 | 유형 칩 5개 (개수 포함) | CMP-06 | 활성 `bg #15293D / white`, 비활성 `bg #FFFFFF / #334155 / border #E2E8F0` (원본 랜딩 필터칩 스펙 그대로) |
| 본문 | 그리드 카드 / 리스트 행 | CMP-30 / CMP-29 | 그리드 2열, `numColumns={2}` |
| 본문 | 유형 섹션 헤더(전체 뷰에서 `전체 >` 링크) | — | `명함 12` + `전체 >` |
| 전역 | FAB | CMP-22 | — |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 칩 `전체` 선택 + 스켈레톤 6장 | — |
| 로딩 | 스켈레톤 | 3초 초과 시 `불러오는 중...` |
| 성공 | 그리드/리스트 | — |
| 빈(전체) | 중앙 EmptyState | `보관함이 비어 있습니다` / `문서를 스캔하면 여기에 정리됩니다.` / 버튼 `문서 스캔하기` |
| 빈(유형 필터) | 중앙 EmptyState | `아직 저장된 {유형}이 없습니다` (예: `아직 저장된 명함이 없습니다`) / 버튼 `{유형} 스캔하기` |
| 에러 | 에러 카드 + `다시 시도` | `보관함을 불러오지 못했습니다.` |
| 오프라인 | G-5 배너 + 캐시 목록, 삭제 액션 disabled | 공통 문구 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 칩 탭 | 필터 적용(같은 화면) | 리스트 crossfade 150ms + selection 햅틱 | — |
| 칩 롱프레스 | 유형 전용 화면(SCR-15~18)으로 이동 | `Haptics.impactAsync(Medium)` | — |
| `전체 >` 탭 | 유형 전용 화면 | selection | — |
| 카드/행 탭 | SCR-19 | scale 0.98 | 토스트 |
| 카드/행 롱프레스 | ActionSheet: `상세 보기` / `수정` / `삭제`(destructive) / `취소` | `Haptics.impactAsync(Medium)` | — |
| 뷰 토글 탭 | 그리드 ↔ 리스트 | `LayoutAnimation` 250ms + selection | — |
| Pull-to-refresh | 4종 전부 재조회 | 인디케이터 | 토스트 |
| 스크롤 하단 | 다음 페이지 | 하단 로더 | 토스트 |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-14 `GET /api/cards` | 필터가 `전체`/`명함` | `page`, `size=20` | `['cards', {page}]`, staleTime 3분 |
| API-57 `GET /api/tickets` | `전체`/`티켓` | 동일 | `['tickets', …]` |
| API-43 `GET /api/posters` | `전체`/`포스터` | 동일 | `['posters', …]` |
| API-49 `GET /api/receipts` | `전체`/`영수증` | 동일 | `['receipts', …]` — **웹은 이 API를 한 번도 호출하지 않았다**(`getMyReceipts` 부재). 모바일이 최초 소비자 |

> `전체` 뷰는 4개 쿼리를 병렬로 받아 `createdAt` 내림차순 머지한다. **각 응답은 Spring `Page<>`** 이므로 `Array.isArray(data) ? data : data?.content ?? []` 방어가 필요하다(검색 API만 배열이다).

---

## SCR-15 · 명함 목록

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/archive/cards.tsx` |
| 진입 | SCR-14 칩 롱프레스/`전체 >`, SCR-13 `저장한 문서 보기` |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/storage/cards/page.tsx` |
| 페이즈 | Phase 4 |
| FR | FR-054, FR-058, FR-059, FR-063, FR-065 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 좌측 **220px 고정 사이드바**(내 명함 / 명함첩 / 그룹 목록 / `+ 그룹 추가`) + `1fr` 리스트 2단 | **상단 그룹 칩 레일**(가로 스크롤) + 우측 끝 `⚙ 관리` → SCR-22 | 220dp 사이드바 = 390dp의 56% |
| 5컬럼 테이블 행 `80px 1fr 1fr 1fr 1fr` | **2줄 카드 행** (썸네일 + 이름/회사 + 직책/연락처) | 셀당 60dp |
| 삭제 버튼이 `position:absolute right:8`로 이메일 컬럼 위에 겹침 | **좌스와이프 → 삭제** | 겹침 버그 해소 + 네이티브 관례 |
| 인라인 확인 `삭제`/`취소` 2버튼이 행 안에 등장 | `CMP-18 ConfirmDialog` | 오조작 방지 |
| `window.prompt('새 그룹명을 입력하세요.')` | SCR-22의 입력 시트 | RN에 prompt 없음 |
| `window.confirm(...)`, `window.alert(...)` ×3 | ConfirmDialog / Toast | — |
| 정렬 `<select>` (`등록일 순`/`오래된 순`) | 헤더 우측 정렬 버튼 → ActionSheet | — |
| 날짜 그룹 헤더가 `createdAt.split('T')[0]` 원문(`2026-07-27`) | `2026년 7월 27일` 포맷 + sticky | 가독성 |
| 그룹 라벨 불일치 (`전체 명함` vs `전체명함`) | **`전체 명함`으로 통일** | 원본 버그 수정 |
| `명함 관리` 버튼 (onClick 없음) | **폐기**. 기능은 SCR-22가 흡수 | 미구현 유령 버튼 제거 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  명함 12              ⇅   ⊞/☰   │  ═ 정렬 / 뷰 토글
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │ ═ 그룹 칩 (sticky)
│ │[전체 명함] 미분류 거래처 ... │⚙ │  h34 r999 · 우측 관리
│ └──────────────────────────────┘   │
├────────────────────────────────────┤
│ 2026년 7월 27일                    │ ═ sticky 날짜 헤더
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒▒▒│ 이응환                   │ │  썸네일 72×48 r6
│ │▒▒▒▒│ 우주관광(주) · 대표이사  │ │  h80
│ │    │ 010-1234-5678         ›  │ │
│ ├────────────────────────────────┤ │
│ │▒▒▒▒│ 김서연                   │ │
│ │▒▒▒▒│ (주)모라테크놀로지        │ │
│ │    │ 010-9234-5678         ›  │ │
│ └────────────────────────────────┘ │
│ 2026년 7월 26일                    │
│ ┌────────────────────────────────┐ │
│ │  …                             │ │
│ └────────────────────────────────┘ │ ┈
│                            ┌────┐  │
│                            │🐱 │  │
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   좌스와이프 → [그룹 이동] [삭제]
```

**행 데이터 매핑 (원본 필드명 그대로, camelCase = Spring 스키마)**

| 위치 | 값 | 폴백 |
|---|---|---|
| 썸네일 | `imageUrl` (명함만 정식 컬럼) | 사람 실루엣 아이콘 28dp `#CBD5E1` |
| 1행 | `name` | `-` |
| 2행 | `company` · `position` | 각각 `-`, 둘 다 없으면 행 생략 |
| 3행 | `phone` | 없으면 `email`, 둘 다 없으면 행 생략 |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 칩 `전체 명함` 선택 + 스켈레톤 5행 | — |
| 로딩 | 스켈레톤 | 3초 초과 `불러오는 중...` |
| 성공 | 날짜 섹션 리스트 | — |
| 빈(전체) | EmptyState + CTA | `아직 저장된 명함이 없습니다` (원문) / 버튼 `명함 스캔하기` (원문) |
| 빈(그룹 필터) | EmptyState | `이 명함첩에 저장된 명함이 없습니다.` / 버튼 `명함 옮기기` → SCR-22 |
| 에러 | 에러 카드 | `명함을 불러오지 못했습니다.` + `다시 시도` |
| 오프라인 | 배너 + 캐시, 삭제/이동 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 그룹 칩 탭 | 재조회 (`groupId` 또는 `ungrouped=true`) | 리스트 crossfade + selection | 토스트 |
| `⚙` 탭 | SCR-22 | selection | — |
| `⇅` 탭 | ActionSheet `등록일 순` / `오래된 순` (원문 라벨) | 시트 | — |
| 행 탭 | SCR-19 (`type=BUSINESS_CARD`) | scale 0.98 | — |
| 좌스와이프 → `그룹 이동` | 그룹 선택 바텀시트 → API-18 | 낙관적 이동 + 토스트 `{그룹명}(으)로 옮겼습니다.` | 롤백 + 토스트 `그룹 이동에 실패했습니다.` (원문) |
| 좌스와이프 → `삭제` | ConfirmDialog → API-17 | 행 슬라이드아웃 + Warning 햅틱 + 토스트 `명함을 삭제했습니다.` | 행 복원 + 토스트 `삭제에 실패했습니다.` |
| Pull-to-refresh | 재조회 | 인디케이터 | 토스트 |
| 스크롤 하단 | 다음 페이지 | 로더 | 토스트 |

**삭제 확인 다이얼로그**: 제목 `이 명함을 삭제할까요?` / 본문 `삭제한 명함은 복구할 수 없습니다.` / 버튼 `삭제`(destructive) · `취소`

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-20 `GET /api/card-groups` | 진입 1회 | — | `['cardGroups']`, staleTime 10분 |
| API-14 `GET /api/cards` | 진입 + 그룹 변경 + 페이징 | `page`, `size=20`, `groupId?`, `ungrouped?` | `['cards', groupId ?? 'all', page]`, staleTime 3분. `Page<>` 언랩 |
| API-18 `PATCH /api/cards/{id}/group` | 그룹 이동 | body `{ groupId }` — **`null`이면 미분류** | mutation + invalidate |
| API-17 `DELETE /api/cards/{id}` | 삭제 | — | mutation + invalidate |

---

## SCR-16 · 티켓 목록

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/archive/tickets.tsx` |
| 진입 | SCR-14, SCR-08 알림, SCR-13 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/storage/tickets/page.tsx` |
| 페이즈 | Phase 4 |
| FR | FR-057, FR-058, FR-059, FR-063 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 6컬럼 행 `80px 1fr 1fr 1fr 1fr auto` | **티켓형 카드** (출발→도착 큰 글씨 + 날짜/시간 + 교통수단 배지) | 셀당 폭 부족 |
| 440px 우측 드로어 안에서 이미지 + bbox + 필드 + OCR 칩 전부 처리 | SCR-19(상세) + SCR-21(뷰어)로 분리 | 시트 안 스크롤 3중첩 방지 |
| 인라인 삭제 확인 2버튼 | 좌스와이프 + ConfirmDialog | — |
| `scrollIntoView({behavior:'smooth'})` | `scrollTo({animated:true})` | — |
| 드로어 `수정`/`저장` 버튼이 `#0077B6`인데 화면 테마는 보라 `#6746AF` | **티켓 화면 강조색은 `#6746AF`로 통일**하되 CTA 버튼은 `point #0077B6` 유지 | 원본 불일치 정리: 강조는 유형색, 액션은 시스템색 |
| D-day 표시 없음 | **출발일 D-day 배지 추가** | 홈 마감 카드와 일관, 티켓의 핵심 정보 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  티켓 8                      ⇅   │  ═
├────────────────────────────────────┤
│ 다가오는 일정                       │ ═ sticky 섹션
│ ┌────────────────────────────────┐ │ ┈
│ │ [SRT]                    D-6   │ │  배지 #E9E5FA/#6746AF
│ │                                │ │  h120 · 좌측 4dp 바 #6746AF
│ │ 수서  ──────✈──────  부산     │ │  h3 17/700
│ │ 08.02 (토) 09:00   12:35      │ │  bodySm / textMuted
│ │                            ▒▒  │ │  썸네일 48×32 우하단
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ [KTX]                   D-14   │ │
│ │ 서울  ────────────  강릉      │ │
│ └────────────────────────────────┘ │
│ 지난 일정                          │ ═ sticky
│ ┌────────────────────────────────┐ │
│ │ [무궁화]              07.12    │ │  opacity 0.6
│ │ 청량리 ──────────  안동       │ │
│ └────────────────────────────────┘ │ ┈
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**섹션 규칙 (결정 — 원본에는 없던 그룹핑)**: `departureDate >= 오늘` → `다가오는 일정`(오름차순), 그 외 → `지난 일정`(내림차순, opacity 0.6). 원본은 `createdAt` 단일 정렬이라 지난 티켓이 상단을 점유하는 문제가 있었다.

**카드 데이터 매핑**

| 위치 | 값 | 폴백 |
|---|---|---|
| 배지 | `transportType` | 없으면 배지 생략. 값은 `KTX/SRT/ITX/무궁화/고속버스/비행기` 6종으로 정규화되어 옴 |
| D-day | `departureDate` 기준 | 과거면 `MM.DD` 날짜로 대체 |
| 좌 | `departureLocation` | `출발지` |
| 우 | `arrivalLocation` | `도착지` |
| 하단 좌 | `departureDate` `departureTime` | 빈 값은 생략 |
| 하단 우 | `arrivalTime` | 생략 |
| 썸네일 | `imageUrl` ?? `JSON.parse(parsedJson).imageUrl` | 이모지 `🎫` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 스켈레톤 3장 | — |
| 로딩 | 스켈레톤 | 3초 초과 `불러오는 중...` |
| 성공 | 섹션 리스트 | — |
| 빈 | EmptyState + CTA | `아직 저장된 티켓이 없습니다` (원문) / 버튼 `티켓 스캔하기` |
| 빈(지난 일정만 있음) | `다가오는 일정` 섹션에 인라인 문구 | `예정된 일정이 없습니다.` |
| 에러 | 에러 카드 | `티켓을 불러오지 못했습니다.` + `다시 시도` (원본은 페치 실패 시 **에러 UI가 아예 없었다**) |
| 오프라인 | 배너 + 캐시 | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 카드 탭 | SCR-19 (`type=TICKET`) | scale 0.98 | — |
| 좌스와이프 → `삭제` | ConfirmDialog → API-60 | 슬라이드아웃 + 토스트 `티켓을 삭제했습니다.` | 복원 + 토스트 `삭제에 실패했습니다.` (원본은 삭제 실패 시 **아무 피드백도 없었다**) |
| `⇅` 탭 | ActionSheet `출발일 순` / `등록일 순` | 시트 | — |
| Pull-to-refresh / 무한 스크롤 | 재조회 / 다음 페이지 | 표준 | 토스트 |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-57 `GET /api/tickets` | 진입 + 페이징 | `page`, `size=20` | `['tickets', page]`, staleTime 3분, `Page<>` 언랩 |
| API-60 `DELETE /api/tickets/{id}` | 삭제 | `{id}` = **Integer** (명함만 UUID) | mutation |

---

## SCR-17 · 포스터 목록

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/archive/posters.tsx` |
| 진입 | SCR-14, SCR-08 알림, SCR-13 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/storage/posters/page.tsx` |
| 페이즈 | Phase 4 |
| FR | FR-055, FR-058, FR-059, FR-063 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 6컬럼 행 `80px 2fr 1fr 1fr 1fr auto` | **기본 2열 그리드**(포스터 원본 비율 3:4) + 리스트 토글 | 포스터는 이미지 자체가 정보다. 텍스트 행보다 썸네일 그리드가 인지 속도가 빠르다 |
| 썸네일 대체 문자 `P` | 이미지 아이콘 + 제목 텍스트 | `P` 한 글자는 의미 전달 실패 |
| 드로어에서 긴 세로 이미지를 `width:100%`로 그대로 표시 | SCR-21 뷰어(핀치줌) | 포스터는 세로 3000px가 흔하다 |
| 라벨 불일치: 보관함 `주최자/시작일/종료일` vs 검색 `주최/행사 시작일/행사 종료일` | **`주최자` / `행사 시작일` / `행사 종료일`로 통일** | 원본 버그 수정. OCR 스키마 한국어 라벨(`FIELD_LABELS_KO`)과 일치시킨다 |
| 마감 강조 없음 | **D-day 배지** (`endDate = eventEndDate ?? eventStartDate`, D-3 이내 `#DC8540`) | 홈/알림과 일관 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  포스터 9             ⇅   ⊞/☰   │  ═
├────────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐      │ ┈ 2열 gap12
│ │▒▒▒▒▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒▒▒▒▒│      │
│ │▒▒▒▒▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒▒▒▒▒│      │  aspect 3:4
│ │▒▒▒▒▒▒ D-3 ▒│ │▒▒▒▒▒▒▒▒▒▒▒▒│      │  D-day 우상단 오버레이
│ │▒▒▒▒▒▒▒▒▒▒▒▒│ │▒▒▒▒▒▒▒▒▒▒▒▒│      │  bg rgba(0,0,0,.6)
│ │────────────│ │────────────│      │
│ │AI 해커톤   │ │인디뮤직    │      │  bodyStrong 2줄
│ │2026        │ │페스티벌    │      │
│ │07.25~07.30 │ │08.10~08.11 │      │  caption
│ └────────────┘ └────────────┘      │
│ ┌────────────┐ ┌────────────┐      │
│ │            │ │            │      │
│ └────────────┘ └────────────┘      │ ┈
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   카드 롱프레스 → ActionSheet
```

**카드 데이터 매핑**

| 위치 | 값 | 폴백 |
|---|---|---|
| 썸네일 | `JSON.parse(parsedJson).imageUrl` ?? `imageUrl` | 회색 박스 + 이미지 아이콘 32dp `#CBD5E1` |
| D-day | `eventEndDate ?? eventStartDate` | 날짜 없으면 배지 생략 |
| 제목 | `title` | `이벤트` (원본 대시보드 폴백) |
| 기간 | `` `${eventStartDate ?? '-'} ~ ${eventEndDate ?? ''}` `` (원문 규칙) | 둘 다 없으면 `organizerName` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 그리드 스켈레톤 4장 | — |
| 로딩 | 스켈레톤 | 3초 초과 `불러오는 중...` |
| 성공 | 그리드 | — |
| 빈 | EmptyState | `아직 저장된 포스터가 없습니다` (원문) / 버튼 `포스터 스캔하기` |
| 에러 | 에러 카드 | `포스터를 불러오지 못했습니다.` + `다시 시도` |
| 오프라인 | 배너 + 캐시 | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 카드 탭 | SCR-19 (`type=POSTER`) | scale 0.98 | — |
| 카드 롱프레스 | ActionSheet `상세 보기` / `이미지 보기` / `수정` / `삭제` / `취소` | Medium 햅틱 | — |
| `이미지 보기` | SCR-21 | — | 토스트 `이미지가 없습니다` |
| `삭제` | ConfirmDialog → API-46 | 카드 fade-out + 토스트 `포스터를 삭제했습니다.` | 복원 + 토스트 |
| `⇅` | ActionSheet `행사일 순` / `등록일 순` | 시트 | — |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-43 `GET /api/posters` | 진입 + 페이징 | `page`, `size=20` | `['posters', page]`, staleTime 3분, `Page<>` 언랩 |
| API-46 `DELETE /api/posters/{id}` | 삭제 | `{id}` = Integer | mutation |

---

## SCR-18 · 영수증 목록 (가계부)

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/archive/receipts.tsx` |
| 진입 | SCR-14 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/storage/receipts/page.tsx` — **전 화면 목업**. `lib/api`에서 아무 함수도 import하지 않는다 |
| 페이즈 | Phase 4 |
| FR | FR-056, FR-058, FR-059, FR-063 |

**모바일 변경점 — 이 화면은 "이식"이 아니라 "구현"이다**

| 원본 | 모바일 | 근거 |
|---|---|---|
| `MOCK_ROWS` 상수 3건, 예산 `2500000` 하드코딩, `지난달 대비 +8.2%` 하드코딩 | **API-49 `GET /api/receipts` 실 데이터** | 서버 엔드포인트는 완성돼 있는데 웹이 안 쓰고 있을 뿐 |
| `수입`/`지출` 구분 (`type: 'INCOME'|'EXPENSE'`) | **폐기.** 서버 `Receipt` 엔티티에 수입/지출 구분 컬럼이 **없다** | 목업만의 개념. 있지도 않은 필드를 UI에 노출하면 거짓 정보 |
| KPI `이달 지출` / `이달 수입` / `예산 잔액` | **`이달 지출` 단일 KPI + 건수** | 위와 동일. 예산 기능은 서버에 근거가 없다 |
| 8컬럼 테이블 `70px 140px 110px 120px 1fr 140px 1fr 60px` | **날짜 섹션 + 2줄 행** | 최소 700px 필요 |
| 필터 pill 6개 중 3개만 동작(`카테고리`/`결제수단`/`기간` 무동작) | **`월 선택` 1개만 구현.** 카테고리·결제수단 필터는 **미제공** | `Receipt`에 `category` 컬럼이 없고 `paymentMethod`는 OCR이 채우지 못한다(스키마에 없음) |
| `구매 항목 (n)` 상세 테이블 | **표시하되 항상 빈 상태** | `ReceiptItem` 테이블은 있으나 OCR→저장 경로가 끊겨 있다(`items: []` 하드코딩) |
| 드로어 `수정`/`삭제` 버튼 onClick 비어 있음 | SCR-20 / API-53 연결 | 미구현 완성 |
| `mora-slide-in` keyframes 인젝션 | 바텀시트 기본 모션 | — |

> **[[Risks]] 등록**: 영수증은 도메인 전체가 미완성이다. ① 검색 미구현(API-52는 있으나 웹이 호출 안 함) ② 임베딩 미생성(`ReceiptService.save()`가 `embeddingService`를 호출하지 않음 → **벡터 검색 불가, Fuzzy만 동작**) ③ 품목 파이프라인 단절. 앱은 ①③을 표시 수준에서 정직하게 다루고, ②는 [[API Contract]]에 명시한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  가계부                      ⇅   │  ═
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ ‹    2026년 7월    ›           │ │  월 네비 h44
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 이달 지출                      │ │  caption
│ │ ₩ 214,300              14건    │ │  stat 24/800 #DC2626
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ 07.16 (수)              ₩ 20,900  │ ═ sticky 일자 소계
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒│ 스타벅스 강남R점            │ │  h72
│ │▒▒│ 08:45              -₩12,500 │ │  금액 #DC2626 우측정렬
│ ├────────────────────────────────┤ │
│ │▒▒│ GS25 역삼점                 │ │
│ │▒▒│ 19:20               -₩8,400 │ │
│ └────────────────────────────────┘ │
│ 07.15 (화)              ₩ 59,800  │ ═
│ ┌────────────────────────────────┐ │
│ │  …                             │ │
│ └────────────────────────────────┘ │ ┈
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   좌스와이프 → [삭제]
```

**행 데이터 매핑**

| 위치 | 값 | 폴백 |
|---|---|---|
| 썸네일 | `JSON.parse(parsedJson).imageUrl` | 영수증 아이콘 24dp `#4FB048` |
| 1행 | `merchantName` | `-` |
| 2행 좌 | `purchaseTime` (`HH:MM`) | 생략 |
| 2행 우 | `totalAmount` | 없으면 `-`. 표시 포맷 `-₩12,500` (원본 `won()`은 `'₩ ' + n.toLocaleString('en-US')`) |
| 일자 소계 | 같은 `purchaseDate` 합계 | 클라이언트 계산 |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 이번 달 + 스켈레톤 | — |
| 로딩 | KPI `-`, 리스트 스켈레톤 4행 | 3초 초과 `불러오는 중...` |
| 성공 | 일자 섹션 리스트 | — |
| 빈(해당 월) | 리스트 자리 중앙 텍스트 | `해당 조건의 거래가 없습니다` (원문) |
| 빈(전체) | EmptyState + CTA | `아직 저장된 영수증이 없습니다` / 버튼 `영수증 스캔하기` |
| 에러 | 에러 카드 | `영수증을 불러오지 못했습니다.` + `다시 시도` |
| 오프라인 | 배너 + 캐시 | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 월 `‹` `›` | 월 변경(클라이언트 필터) | 슬라이드 200ms + selection | — |
| 월 라벨 탭 | 연·월 피커 시트 | 시트 | — |
| 행 탭 | SCR-19 (`type=RECEIPT`) | scale 0.98 | — |
| 좌스와이프 → `삭제` | ConfirmDialog → API-53 | 슬라이드아웃 + 토스트 `영수증을 삭제했습니다.` | 복원 + 토스트 |
| `⇅` | ActionSheet `구매일 순` / `금액 높은 순` / `등록일 순` | 시트 | — |
| Pull-to-refresh / 무한 스크롤 | 재조회 / 다음 페이지 | 표준 | 토스트 |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-49 `GET /api/receipts` | 진입 + 페이징 | `page`, `size=20` | `['receipts', page]`, staleTime 3분, `Page<>` 언랩. **월 필터는 클라이언트에서** 수행(서버에 기간 파라미터 없음) |
| API-53 `DELETE /api/receipts/{id}` | 삭제 | `{id}` = Integer | mutation |

> **월 필터가 클라이언트 계산인 한계**: 데이터가 수백 건을 넘으면 전 페이지를 받아야 정확한 월 소계가 나온다. **결정: 최대 5페이지(100건)까지 자동 프리페치**하고, 그 이상이면 KPI 옆에 `최근 100건 기준` 캡션을 붙인다. 서버 기간 필터는 [[Risks]]의 백엔드 개선 항목으로 등록.

---
## SCR-19 · 문서 상세 (바텀시트)

| 항목 | 값 |
|---|---|
| 라우트 | `app/doc/[type]/[id].tsx` (`presentation: 'transparentModal'` + `@gorhom/bottom-sheet`) |
| 진입 | SCR-06 마감카드/일정, SCR-07 일정, SCR-14~18 항목, SCR-23 검색 결과, SCR-24 출처 카드 |
| 인증 | 필요 |
| 원본 | `components/dashboard/storage/StorageDrawer.tsx` (420px 우측 슬라이드) + 각 보관함 페이지의 인라인 드로어 |
| 페이즈 | Phase 4 |
| FR | FR-061, FR-066 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 우측 420px 슬라이드 패널 | **바텀시트** `snapPoints ['55%', '92%']`, `enablePanDownToClose` | 390dp에서 420px 드로어는 화면 108%. "우측 슬라이드"라는 의미가 소멸한다 |
| 슬라이드 애니메이션이 **아예 없음** (`if (!open) return null`, transition 속성 없음) | 스프링 진입 `damping 20 / stiffness 200` | 이름만 Drawer였다 |
| `position:sticky, top:-28` 음수 마진 헤더 | 시트 handle + 고정 헤더 View + `BottomSheetScrollView` | RN sticky 없음 |
| ESC 키로 닫기 | Android 하드웨어 백 + pan-down + 백드롭 탭 | — |
| 백드롭 `rgba(0,0,0,0.3)` | 동일 값 유지 (`scrim` 토큰) | 원본 값 보존 |
| 헤더 우측 `수정` 버튼이 인라인 편집 모드로 전환 | **SCR-20 별도 화면으로 push** | 시트 안 인라인 편집은 키보드 회피가 취약하고, 필드가 12개(명함)까지 간다 |
| 이미지 `objectFit:contain` + `height:auto` | 상단 고정 높이 200dp 썸네일 + 탭 → SCR-21 | `height:auto`를 RN에서 재현하려면 `Image.getSize` 왕복이 필요 |
| 필드 빈 값 표시 `-` | 동일 유지 (`(value \|\| '-').trim() \|\| '-'`) | 원본 규칙 보존 |
| OCR 원문이 그냥 긴 텍스트 필드 | **접힘 섹션** + `복사` 버튼 | 수백 자가 시트를 점유 |

**와이어프레임**
```
┌────────────────────────────────────┐
│  (뒤 화면이 scrim rgba(0,0,0,.3))  │
│                                    │
├────────────────────────────────────┤ ← 55% snap
│              ▬▬▬▬                  │  handle 36×4 #CBD5E1
│ 명함 상세              ✏  ⋯   ✕   │  ═ h3 17/700 + 액션
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒▒▒▒▒▒ 이미지 200dp ▒▒▒▒  🔍  │ │  탭 → SCR-21
│ └────────────────────────────────┘ │
│                                    │
│ 이름                               │  caption 11 #999
│ 이응환                             │  body 14 #333 lh22
│ ──────────────────────────────     │  b-bottom #F1F5F9
│ 회사명                             │
│ 우주관광(주)                       │
│ ──────────────────────────────     │
│ 직책                               │
│ -                                  │  빈 값 = '-'
│ ──────────────────────────────     │
│ 전화번호                    📞 📋  │  탭 액션 아이콘
│ 010-1234-5678                      │
│ ──────────────────────────────     │
│ 이메일                      ✉ 📋  │
│ hong@naver.com                     │
│ ──────────────────────────────     │
│ 명함 그룹                          │
│ 거래처                        ›    │  명함 전용
│ ──────────────────────────────     │
│ 저장일                             │
│ 2026. 7. 27.                       │
│ ──────────────────────────────     │
│ ▸ OCR 원문                    📋   │  접힘
│                                    │ ┈
├────────────────────────────────────┤
│ ┌───────────┐ ┌──────────────────┐ │ ═ 하단 고정
│ │   삭제    │ │      수정        │ │  danger-ghost / primary
│ └───────────┘ └──────────────────┘ │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**유형별 필드 구성 (원본 `buildDrawerFields` + 보관함 페이지 필드 배열 통합, 라벨 원문)**

| 유형 | 시트 타이틀 | 필드 순서 (라벨 / key) |
|---|---|---|
| `BUSINESS_CARD` | `명함 상세` | 이름/`name` · 회사명/`company` · 직책/`position` · 전화번호/`phone` · 이메일/`email` · 명함 그룹/`groupId` · 저장일/`createdAt` · OCR 원문/`rawOcrText` |
| `TICKET` | `티켓 상세` | 교통수단/`transportType` · 출발지/`departureLocation` · 출발일/`departureDate` · 출발 시간/`departureTime` · 도착지/`arrivalLocation` · 도착일/`arrivalDate` · 도착 시간/`arrivalTime` · 저장일/`createdAt` · OCR 원문/`rawText` |
| `POSTER` | `포스터 상세` | 제목/`title` · 주최자/`organizerName` · 행사 시작일/`eventStartDate` · 행사 종료일/`eventEndDate` · 장소/`location` · 연락처/`contactPhone` · 이메일/`contactEmail` · 참가비/`fee` · 웹사이트/`websiteUrl` · 설명/`description` · 저장일/`createdAt` · OCR 원문/`rawText` |
| `RECEIPT` | `영수증 상세` | 상호명/`merchantName` · 주소/`merchantAddress` · 구매일/`purchaseDate` · 구매시간/`purchaseTime` · 결제수단/`paymentMethod` · 카드사/`cardCompany` · 총액/`totalAmount` · 통화/`currencyCode` · 구매 항목/`items` · 저장일/`createdAt` · OCR 원문/`rawText` |

> 원본은 보관함(`직책`,`시작일`,`종료일`)과 검색(`직함`,`행사 시작일`,`행사 종료일`)이 서로 다른 라벨을 썼다. **결정: 위 표로 통일**하고 두 진입점 모두 동일 컴포넌트를 쓴다.

**필드 타입별 탭 액션 (결정 — 원본에 없던 모바일 고유 가치)**

| 필드 | 아이콘 | 동작 |
|---|---|---|
| 전화번호 계열 | 📞 / 💬 | `Linking.openURL('tel:...')` / `sms:` |
| 이메일 계열 | ✉ | `mailto:` |
| 웹사이트 | 🔗 | `WebBrowser.openBrowserAsync` |
| 장소·주소 | 📍 | 지도 앱 (`geo:0,0?q=...`) |
| 날짜 | 📅 | 캘린더 앱 이벤트 생성(로컬) |
| 모든 값 있는 필드 | 📋 | 클립보드 복사 + 토스트 `복사했습니다.` |
| 명함 전체 | ⋯ 메뉴 | `연락처에 저장` (`expo-contacts`) |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 목록에서 넘어온 데이터로 즉시 렌더(낙관적) 후 단건 재검증 | — |
| 로딩 | 이미지 스켈레톤 + 필드 스켈레톤 4행 | — |
| 성공 | 전체 렌더 | — |
| 빈(필드 값 없음) | 값 자리 `-` | `-` |
| 빈(이미지 없음) | 이미지 자리 회색 박스 minHeight 160 | `이미지가 없습니다` (원문) |
| 빈(구매 항목) | 섹션에 인라인 문구 | `인식된 구매 항목이 없습니다.` |
| 에러 | 시트 내부 에러 블록 + `다시 시도` | `문서를 불러오지 못했습니다.` |
| 오프라인 | 캐시 렌더 + 하단 버튼 disabled + 배너 | `오프라인입니다. 수정·삭제는 연결 후 가능합니다.` |
| 권한거부 | `연락처에 저장` 탭 시 안내 | `연락처 접근 권한이 필요합니다.` / 버튼 `설정 열기` |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| pan-down / 백드롭 탭 / `✕` / Android 백 | 시트 닫기 | 스프링 250ms | — |
| 시트 상단 드래그 | 55% ↔ 92% snap | 스냅 시 selection 햅틱 | — |
| 이미지 탭 | SCR-21 | scale 0.98 | 토스트 `이미지가 없습니다` |
| 필드 액션 아이콘 탭 | 위 표 동작 | selection + 토스트(복사 시) | 토스트 `실행할 수 있는 앱이 없습니다.` |
| 필드 값 롱프레스 | 복사 | Medium 햅틱 + 토스트 `복사했습니다.` | — |
| `명함 그룹 ›` 탭 | 그룹 선택 시트 → API-18 | 낙관적 갱신 + 토스트 | 롤백 + 토스트 `그룹 이동에 실패했습니다.` |
| `✏ 수정` / 하단 `수정` | SCR-20 push | selection | — |
| `⋯` 탭 | ActionSheet: `이미지 보기` / `연락처에 저장`(명함) / `캘린더에 추가`(티켓·포스터) / `공유` / `취소` | 시트 | — |
| 하단 `삭제` | ConfirmDialog → 유형별 DELETE | Warning 햅틱 → 시트 닫힘 + 목록에서 제거 + 토스트 | 토스트 `삭제에 실패했습니다.` |
| `OCR 원문` 헤더 탭 | 펼침/접힘 | `LayoutAnimation` 200ms | — |

**데이터**

| 유형 | 조회 | 삭제 | 캐시 |
|---|---|---|---|
| `BUSINESS_CARD` | API-15 `GET /api/cards/{id}` (UUID) | API-17 | `['card', id]`, staleTime 3분 |
| `TICKET` | API-58 `GET /api/tickets/{id}` (Integer) | API-60 | `['ticket', id]` |
| `POSTER` | API-44 `GET /api/posters/{id}` (Integer) | API-46 | `['poster', id]` |
| `RECEIPT` | API-50 `GET /api/receipts/{id}` (Integer) | API-53 | `['receipt', id]` |

> 단건 조회 API 4종은 **웹이 한 번도 쓰지 않았다**(목록 데이터를 그대로 드로어에 넘겼다). 모바일은 딥링크·알림·검색 등 목록을 거치지 않는 진입이 있으므로 단건 조회가 필요하다. **`{id}` 타입이 명함만 UUID, 나머지는 Integer**인 비대칭에 주의.

---

## SCR-20 · 문서 편집

| 항목 | 값 |
|---|---|
| 라우트 | `app/doc/[type]/[id]/edit.tsx` (스택 push, 헤더 있음) |
| 진입 | SCR-19 `수정`, SCR-14 롱프레스 `수정` |
| 인증 | 필요 |
| 원본 | `StorageDrawer.tsx` 편집 모드 + 각 보관함 페이지 `EDITABLE_KEYS` |
| 페이즈 | Phase 4 |
| FR | FR-062 |

**모바일 변경점**
1. 시트 안 인라인 편집 → **전용 화면**. `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"`로 키보드 회피를 확실히 잡는다(원본은 데스크톱이라 고려가 없었다).
2. 원본 편집 input은 `bg #FAFBFC / border #CBD5E1 / radius 6`. **radius만 10으로 상향**(터치 UI 표준), 나머지 값 보존.
3. `textarea rows={5}` → `multiline` + `minHeight: 110`.
4. **저장 버튼을 헤더 우측에 고정**(iOS 관례) + 하단에도 풀폭 버튼(도달성). 둘 다 같은 액션.
5. 원본 검색 화면의 **RECEIPT 편집 저장 미완성 버그**(payload만 만들고 API 미호출, `isSaving` 리셋 안 됨 → 영구 로딩)를 **정상 구현**한다(API-51).

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ 취소      명함 수정          저장  │  ═ 저장=point, 변경없으면 disabled
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒▒▒▒▒ 이미지 120dp ▒▒▒▒▒▒▒▒▒▒ │ │  읽기 전용
│ └────────────────────────────────┘ │
│                                    │
│ 이름 *                             │  caption
│ ┌────────────────────────────────┐ │
│ │ 이응환                      ✕ │ │  h48 r10 bg#FAFBFC
│ └────────────────────────────────┘ │
│ 회사명                             │
│ ┌────────────────────────────────┐ │
│ │ 우주관광(주)                ✕ │ │
│ └────────────────────────────────┘ │
│ 직책                               │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ └────────────────────────────────┘ │
│ 전화번호                           │
│ ┌────────────────────────────────┐ │
│ │ 010-1234-5678                  │ │  keyboardType phone-pad
│ └────────────────────────────────┘ │
│           … (편집 가능 필드) …      │
│                                    │
│ OCR 원문 (읽기 전용)               │  편집 불가 명시
│ ┌────────────────────────────────┐ │
│ │ 우주관광(주)                   │ │  bg#F1F5F9 · 6줄 제한
│ │ 이응환 대표이사 …              │ │
│ └────────────────────────────────┘ │
│                                    │
│      (에러 문구 자리 · #DC2626)     │  caption 12
│ ┌────────────────────────────────┐ │
│ │            저장                │ │  primary lg
│ └────────────────────────────────┘ │ ┈
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**편집 가능 필드 (원본 `EDITABLE_KEYS` 그대로)**

| 유형 | 편집 가능 | 읽기 전용 |
|---|---|---|
| `BUSINESS_CARD` | `name` `company` `position` `phone` `email` | `rawOcrText` `createdAt` |
| `TICKET` | `transportType` `departureLocation` `departureDate` `departureTime` `arrivalLocation` `arrivalDate` `arrivalTime` (7개) | `rawText` `createdAt` |
| `POSTER` | `title` `organizerName` `eventStartDate` `eventEndDate` `contactPhone` `contactEmail` `location` `fee` `websiteUrl` `description`(multiline) (10개) | `rawText` `createdAt` |
| `RECEIPT` | `merchantName` `merchantAddress` `purchaseDate` `purchaseTime` `paymentMethod` `cardCompany` `totalAmount` `currencyCode` | `rawText` `createdAt` `items` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 현재 값이 채워진 폼, `저장` disabled(변경 없음) | — |
| 로딩(저장) | 헤더 `저장` → 스피너, 폼 dim, 하단 버튼 라벨 교체 | `저장 중...` (원문) |
| 성공 | pop → SCR-19 갱신 + 토스트 | `수정했습니다.` |
| 빈 | 필수 필드(명함 `name`, 포스터 `title`, 영수증 `merchantName`) 비면 저장 차단 | `필수 항목을 입력해 주세요.` |
| 에러(검증) | 해당 필드 보더 danger + 하단 캡션 | 날짜: `날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)` / 시간: `시간 형식이 올바르지 않습니다. (HH:MM)` / 금액: `숫자만 입력해 주세요.` |
| 에러(저장 실패) | 하단 에러 캡션 12/`#DC2626` | 서버 메시지 우선, 없으면 `수정 실패` (원문) |
| 오프라인 | 배너 + 저장 disabled + 로컬 초안 보존 | `오프라인입니다. 연결되면 저장할 수 있어요.` |
| 권한거부 | 해당 없음 | — |

> **날짜/시간 검증 근거**: 요청 DTO는 전부 `String`인데 응답은 `LocalDate`/`LocalTime`이다. 서버가 파싱 실패하면 500이 떨어지므로 **클라이언트에서 반드시 형식을 강제**해야 한다. 원본에는 이 검증이 없었다.

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 필드 편집 | dirty 플래그 → `저장` 활성 | — | — |
| `✕`(필드 우측) | 값 비우기 | selection | — |
| 날짜/시간 필드 탭 | 네이티브 피커 시트 | — | — |
| `저장` 탭 | 유형별 PUT | 헤더 스피너 + 폼 dim | 에러 캡션 + Error 햅틱, 값 유지 |
| `취소` / 백 | dirty면 ConfirmDialog | Warning 햅틱 | — |
| 키보드 `다음` | 다음 필드 포커스 | — | — |

**이탈 확인**: 제목 `변경 사항을 저장하지 않고 나갈까요?` / 본문 `수정한 내용이 사라집니다.` / 버튼 `나가기`(destructive) · `계속 수정`

**데이터**

| 유형 | API | 주의 |
|---|---|---|
| `BUSINESS_CARD` | API-16 `PUT /api/cards/{id}` | body = `CardRequest` 전체. **부분 업데이트 아님** — 기존 값을 모두 실어 보내야 한다 |
| `TICKET` | API-59 `PUT /api/tickets/{id}` | `rawText`를 함께 보내면 **임베딩이 재생성**된다. 편집 시엔 보내지 않는다(불필요한 OpenAI 호출 방지) |
| `POSTER` | API-45 `PUT /api/posters/{id}` | 동일 |
| `RECEIPT` | API-51 `PUT /api/receipts/{id}` | **웹은 이 함수를 정의만 하고 호출하지 않았다.** 모바일이 최초 소비자 |

캐시: 성공 시 `['{type}', id]` setQueryData 후 목록 쿼리 invalidate.

---

## SCR-21 · 이미지 뷰어 (OCR 오버레이)

| 항목 | 값 |
|---|---|
| 라우트 | `app/viewer.tsx` (`presentation: 'fullScreenModal'`, 상태바 숨김) |
| 진입 | SCR-12 썸네일/OCR 칩, SCR-19 이미지, SCR-17 롱프레스 `이미지 보기` |
| 인증 | 필요 |
| 원본 | `upload/page.tsx` `renderBboxOverlay()` · `storage/tickets/page.tsx` `renderBbox()` |
| 페이즈 | Phase 4 (기본) / Phase 3 (스캔 경로) |
| FR | FR-066, FR-068 |

**모바일 변경점 / 신설 근거**
1. 원본은 이미지를 `maxHeight:500`으로 인라인 표시하고 bbox를 절대좌표로 얹었다. 390dp 폭에서 명함 텍스트는 6~8px로 렌더돼 **읽을 수 없다** → 핀치줌 뷰어가 필수.
2. bbox 좌표계 주의: `upload` 화면은 `img.clientWidth / ocrScanResult.imageSize.width`로 스케일을 냈고, `tickets` 화면은 `img.clientWidth / naturalWidth`를 썼다(**두 화면의 기준이 다르다**). **결정: 항상 `image_size`(OCR가 리사이즈한 1280 기준)를 정본으로 쓰고, 없으면 실제 이미지 크기로 폴백**한다.
3. `bbox`는 `number[][]`(4점 폴리곤)다. min/max로 `left/top/width/height`를 산출하는 원본 로직을 그대로 이식한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│ ✕                        ⊞  ⤓      │  닫기 / OCR토글 / 저장
│                                    │  (다크 오버레이, 3초 후 자동 숨김)
│                                    │
│    ┌──────────────────────────┐    │
│    │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│    │▒▒┌─────┐▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │  bbox 박스
│    │▒▒│이응환│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │  b2 #0077B6
│    │▒▒└─────┘▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │  bg rgba(0,119,182,.12)
│    │▒▒┌────────────┐▒▒▒▒▒▒▒▒▒│    │
│    │▒▒│우주관광(주)│▒▒▒▒▒▒▒▒▒│    │
│    │▒▒└────────────┘▒▒▒▒▒▒▒▒▒│    │
│    │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│    └──────────────────────────┘    │
│                                    │
│  ┌──────────────────────────────┐  │  선택 시에만
│  │ 이응환                99.1%  │  │  하단 정보 바
│  │ 이름                    📋   │  │  h64 bg rgba(0,0,0,.75)
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
   핀치 확대 1.0~5.0 / 더블탭 2.5배 / 아래로 스와이프 닫기
```

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 상단 | 닫기 / OCR 토글 / 저장 | CMP-02 | 40dp 원형 `rgba(0,0,0,0.5)`, 3초 무동작 시 fade-out |
| 본문 | 줌 가능 이미지 + bbox 레이어 | CMP-25 | bbox는 `pointerEvents` 활성(탭 선택), 라벨은 선택된 것만 |
| 하단 | 선택 블록 정보 바 | 인라인 | 텍스트 / 신뢰도 `{(confidence*100).toFixed(1)}%` (원문 포맷) / 복사 |

> **다크 (국소 예외)** — 뷰어 배경은 **양 테마에서 항상 어둡다**: `bg.sunken`(라이트 `#F1F5F9`가 아니라 **다크 값 `#0A0F17` 고정**)이다. 이미지를 판단하는 화면이므로 이미지에는 어떤 필터도 걸지 않고 주변만 어둡게 한다. 이미지 컨테이너는 `surface.alt` 프레임, 상·하단 컨트롤 바는 `overlay.image`(라이트 `rgba(15,23,42,.55)` / 다크 `rgba(0,0,0,.72)`), 상태바는 `light-content` 고정. **bbox 색만 테마를 따른다** — 라이트 `action #0077B6` / 다크 `#4BA3DB`(채움은 각 색 12% 알파), 티켓 경로는 라이트 `#6746AF` / 다크 `#C2B3E6`. 어두운 스캔 이미지 위에서 `#0077B6`는 경계가 사라지기 때문이다. 근거: [[Design Tokens]] §10-5 이미지 뷰어 행 · §10-4.

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 전체 맞춤 배율, bbox 표시 ON(스캔 경로) / OFF(보관함 경로) | — |
| 로딩 | 저해상 블러 → 원본 crossfade (expo-image `placeholder`) | — |
| 성공 | 렌더 | — |
| 빈(bbox 없음) | OCR 토글 버튼 disabled | 토글 탭 시 토스트 `인식된 텍스트 위치 정보가 없습니다.` |
| 에러(이미지 로드 실패) | 중앙 아이콘 + 문구 | `이미지가 없습니다` (원문) |
| 오프라인 | 디스크 캐시 히트면 정상, 미스면 에러 | `이미지를 불러올 수 없습니다.` |
| 권한거부 | `⤓ 저장` 탭 시 안내 | `사진 저장 권한이 필요합니다.` / 버튼 `설정 열기` |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 핀치 | 1.0~5.0배 줌 | 경계에서 rubber-band | — |
| 더블탭 | 2.5배 ↔ 원배율 토글 | 250ms spring | — |
| 팬 | 확대 시 이동 | — | — |
| 아래로 스와이프(원배율) | 닫기 | 배경 opacity 연동 dismiss | — |
| bbox 탭 | 선택 + 하단 정보 바 표시 | 박스 채움 진해짐 200ms + selection 햅틱 | — |
| 빈 영역 탭 | 오버레이 UI 토글 | fade 200ms | — |
| `⊞` 탭 | bbox 레이어 on/off | selection | — |
| `⤓` 탭 | `MediaLibrary.saveToLibraryAsync` | 토스트 `사진에 저장했습니다.` | 권한 안내 / 토스트 `저장에 실패했습니다.` |

**bbox 좌표 변환 (원본 로직 이식)**
```ts
const scaleX = renderedWidth  / (imageSize?.width  ?? naturalWidth)
const scaleY = renderedHeight / (imageSize?.height ?? naturalHeight)
const xs = bbox.map(p => p[0]); const ys = bbox.map(p => p[1])
const box = {
  left:   Math.min(...xs) * scaleX,
  top:    Math.min(...ys) * scaleY,
  width:  (Math.max(...xs) - Math.min(...xs)) * scaleX,
  height: (Math.max(...ys) - Math.min(...ys)) * scaleY,
}
// 스타일: borderWidth 2, borderRadius 4
//   borderColor = useTheme().action, backgroundColor = 같은 색 12% 알파
//   라이트 #0077B6 / rgba(0,119,182,0.12)  ·  다크 #4BA3DB / rgba(75,163,219,0.12)
// 티켓 유형 진입이면 doc.TICKET.fg (원본 티켓 화면의 색 관계 보존, 값만 테마별로 갈림)
//   라이트 #6746AF / rgba(103,70,175,0.12)  ·  다크 #C2B3E6 / rgba(194,179,230,0.12)
// bbox는 className을 못 쓰는 런타임 계산 좌표 레이어이므로 색을 useTheme()에서 받는다 (ADR-004 §4 런타임 소비처)
```

**데이터**: API 호출 없음. 이미지 URL과 `raw_blocks`/`image_size`를 파라미터로 받는다. 보관함 경로에서는 `JSON.parse(rawJson)`으로 블록을 복원한다(티켓/포스터/영수증) — 명함은 `rawJson`이 저장되지 않으므로 **bbox 미지원**(원본 동일).

---

## SCR-22 · 명함 그룹 관리

| 항목 | 값 |
|---|---|
| 라우트 | `app/groups.tsx` (스택 push) |
| 진입 | SCR-15 `⚙`, SCR-19 명함 그룹 필드 |
| 인증 | 필요 |
| 원본 | `storage/cards/page.tsx` 좌측 사이드바 `명함첩` 카드 |
| 페이즈 | Phase 4 |
| FR | FR-064, FR-065 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 220px 사이드바에 상시 노출 | 독립 화면 | 사이드바 불가 |
| `window.prompt('새 그룹명을 입력하세요.')` | **입력 바텀시트** | RN에 prompt 없음. WebView에서도 스타일 불가 |
| `window.confirm('"{name}" 그룹을 삭제할까요?\n그룹 안의 명함은 미분류로 이동됩니다.')` | ConfirmDialog (문구 동일, `\n` → 본문 2줄) | — |
| `window.alert(...)` 3종 | 토스트 | — |
| 그룹 이름 변경 UI 없음 (API-22는 존재하는데 프론트 래퍼조차 없음) | **이름 변경 지원** (API-22 최초 소비) | 살아 있는 API를 쓰지 않을 이유가 없다 |
| `전체 명함` / `미분류` 고정 항목 | 유지 (편집·삭제 불가로 표시) | — |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  명함첩 관리                  +  │  ═
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │ 📇 전체 명함              12   │ │  고정 · 회색 텍스트
│ ├────────────────────────────────┤ │
│ │ 📂 미분류                  3   │ │  고정
│ └────────────────────────────────┘ │
│                                    │
│ 내 명함첩                          │  section
│ ┌────────────────────────────────┐ │
│ │ 📁 거래처                  6  ›│ │  h56
│ ├────────────────────────────────┤ │
│ │ 📁 학회                    3  ›│ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │        + 명함첩 추가           │ │  ghost lg · #0077B6
│ └────────────────────────────────┘ │ ┈
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
   행 좌스와이프 → [이름 변경] [삭제]
```

**입력 바텀시트 (추가/이름 변경 공용)**
```
│              ▬▬▬▬                  │
│ 명함첩 추가                        │  h3
│ ┌────────────────────────────────┐ │
│ │ 명함첩 이름                    │ │  autoFocus · maxLength 20
│ └────────────────────────────────┘ │
│ 최대 20자                          │  caption
│ ┌───────────┐ ┌──────────────────┐ │
│ │   취소    │ │      추가        │ │
│ └───────────┘ └──────────────────┘ │
```

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 고정 2항목 + 그룹 리스트 | — |
| 로딩 | 스켈레톤 3행 | — |
| 성공 | 리스트 | — |
| 빈(그룹 0개) | `내 명함첩` 섹션에 인라인 EmptyState | `명함첩이 없습니다.` / `명함첩을 만들어 명함을 분류해 보세요.` |
| 에러 | 에러 카드 | `명함첩을 불러오지 못했습니다.` + `다시 시도` |
| 에러(추가 실패) | 시트 하단 캡션 | `그룹 추가에 실패했습니다.` (원문) |
| 에러(삭제 실패) | 토스트 | `그룹 삭제에 실패했습니다.` (원문) |
| 에러(이름 중복/빈값) | 시트 하단 캡션 | `이름을 입력해 주세요.` / `같은 이름의 명함첩이 이미 있습니다.` |
| 오프라인 | 배너 + `+` 및 스와이프 액션 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| `+` / `+ 명함첩 추가` | 입력 시트 (`추가` 모드) | 시트 스프링 + 키보드 자동 | — |
| 시트 `추가` | API-21 | 낙관적 추가 + 토스트 `명함첩을 만들었습니다.` | 롤백 + 시트 내 에러 캡션 |
| 행 탭 | SCR-15로 pop + 해당 그룹 필터 적용 | selection | — |
| 좌스와이프 → `이름 변경` | 입력 시트 (`변경` 모드, 기존값 프리필) | 시트 | 토스트 `이름 변경에 실패했습니다.` |
| 좌스와이프 → `삭제` | ConfirmDialog → API-23 | Warning 햅틱 + 행 슬라이드아웃 + 토스트 `명함첩을 삭제했습니다. 명함은 미분류로 이동했습니다.` | 복원 + 토스트 |

**삭제 확인 다이얼로그 (원본 문구 이식)**: 제목 `"{그룹명}" 그룹을 삭제할까요?` / 본문 `그룹 안의 명함은 미분류로 이동됩니다.` / 버튼 `삭제`(destructive) · `취소`

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-20 `GET /api/card-groups` | 진입 | — | `['cardGroups']`, staleTime 10분 |
| API-21 `POST /api/card-groups` | 추가 | `{ name }` | mutation + invalidate |
| API-22 `PATCH /api/card-groups/{groupId}` | 이름 변경 | `{ name }` | mutation + invalidate |
| API-23 `DELETE /api/card-groups/{groupId}` | 삭제 | — | mutation + `['cards']`도 invalidate |

> CardGroupController는 실패 시 **400**을 쓴다(Card/Ticket/Poster/Receipt는 500). 상태코드로 분기하지 말고 `success` 불리언으로만 판단한다.

---

## SCR-23 · 검색

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/search.tsx` (탭 4 · `검색`) |
| 진입 | 탭바, SCR-06 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/search/page.tsx` + `dashboard/layout.tsx` 헤더 검색바 |
| 페이즈 | Phase 5 |
| FR | FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 진입점이 대시보드 헤더 검색바뿐 (카테고리 드롭다운 + input + 아이콘) | **독립 탭** | 헤더에 검색바를 넣을 공간이 없다 |
| `?q=&type=` 쿼리스트링으로 화면 이동 | 같은 화면 내 상태 (네비 파라미터 불필요) | — |
| 카테고리가 **단일 선택 드롭다운**(기본 `BUSINESS_CARD`) | **가로 스크롤 필터 칩 5개** — `전체` `명함` `티켓` `포스터` `영수증`. 초기 선택은 **마지막 사용 유형 복원**, 최초 실행 시 `명함` | 드롭다운 2탭 → 칩 1탭. 원본의 기본값 `BUSINESS_CARD`를 최초 실행 기본값으로 그대로 계승한다 (아래 **문서유형 기본값** 절) |
| 통합(크로스 유형) 검색 없음 | `전체` 칩 = **4종 병렬 호출 + 클라이언트 머지** (서버에 통합 엔드포인트가 없다) | 사용자가 유형을 모르고 찾는 상황이 실재한다. 단 **기본값으로 두지 않는다** — 요청 4배 + 서버 검색기록 4건 |
| 결과 카드 `260px 1fr auto` 3단 | 썸네일 위 / 정보 아래 세로 스택 | — |
| 번호 페이지네이션 `‹ 1 2 3 ›` (30×30, PAGE_SIZE 10) | **무한 스크롤** (클라이언트 페이징, 20개씩) | 30dp 버튼은 터치 타깃 미달 |
| 정렬 `<select>` (`최신순`/`관련도순`) | 헤더 우측 정렬 버튼 → ActionSheet | — |
| 프리뷰 텍스트 `whiteSpace:nowrap + ellipsis` 1줄 | **2줄** + 검색어 하이라이트 | 좁은 폭에서 1줄은 거의 안 보임 |
| **RECEIPT 검색 분기 누락 → 항상 0건** | **API-52 연결로 정상 동작** | 원본 버그 수정 |
| 최근 검색어 없음 (API-54가 있는데 프론트 래퍼조차 없음) | **최근 검색어 리스트** (API-54 최초 소비) | 모바일 타이핑 비용이 높다 |
| 상세는 우측 드로어 | SCR-19 바텀시트 | — |

**와이어프레임 — 초기(쿼리 없음)**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ┌────────────────────────────────┐ │ ═ 검색바 h44 r10 bg#F8FAFC
│ │ 🔍 검색어를 입력하세요      ✕ │ │
│ └────────────────────────────────┘ │
│ ┌──────────────────────────────┐   │ ═ 유형 칩(가로 스크롤)
│ │ 전체 [명함] 티켓 포스터 영수증│→  │  선택 칩 = `search.lastDocType`
│ └──────────────────────────────┘   │  최초 실행 시 [명함]
├────────────────────────────────────┤
│ 최근 검색어              전체 삭제 │ ┈
│ ┌────────────────────────────────┐ │
│ │ 🕐 우주관광               ✕   │ │  h48
│ │ 🕐 3월 부산 출장          ✕   │ │
│ │ 🕐 김서연                 ✕   │ │
│ └────────────────────────────────┘ │
│                                    │
│ 이렇게 찾아보세요                  │
│ ┌────────────────────────────────┐ │
│ │ 이름 일부, 회사명, 직책 등     │ │  안내 카드
│ │ 기억나는 것만으로 찾을 수      │ │
│ │ 있습니다.                      │ │
│ └────────────────────────────────┘ │ ┈
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
└────────────────────────────────────┘
```

**와이어프레임 — 결과**
```
│ ┌────────────────────────────────┐ │ ═
│ │ 🔍 우주관광                 ✕ │ │
│ └────────────────────────────────┘ │
│ ┌──────────────────────────────┐   │ ═
│ │ 전체 [명함] 티켓 포스터 영수증│→  │
│ └──────────────────────────────┘   │
├────────────────────────────────────┤
│ 명함 3건                       ⇅   │ ═ sticky · `전체`면 `전체 12건`
│                                    │   (유형 배지가 카드마다 붙는다)
│ ┌────────────────────────────────┐ │ ┈
│ │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │ │  h150 cover r10
│ │ 이응환                    98%  │ │  h3 + 유사도 배지
│ │ 우주관광(주)                   │ │  bodySm
│ │ 직함 대표이사  연락처 010-…    │ │  facts wrap
│ │ ┌────────────────────────────┐ │ │
│ │ │"…우주관광(주) 이응환 대표…"│ │ │  프리뷰 2줄
│ │ └────────────────────────────┘ │ │  하이라이트 #2563EB/700
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │  …                             │ │
│ └────────────────────────────────┘ │ ┈
```

**유형별 표시 필드 (원본 `normalize*` 함수 그대로)**

| 유형 | 제목 | 부제 | facts (라벨 ← 필드) |
|---|---|---|---|
| `BUSINESS_CARD` | `name` ?? `-` | `company` | 직함←`position` · 회사←`company` · 연락처←`phone` · 이메일←`email` · 저장일←`createdAt` |
| `TICKET` | `` `${departureLocation ?? '-'} → ${arrivalLocation ?? '-'}` `` | `transportType` | 이동수단 · 출발지 · 출발일 · 출발시간 · 도착지 · 도착일 · 도착시간 · 저장일 |
| `POSTER` | `title` ?? `-` | `organizerName` | 주최자 · 행사 시작일 · 행사 종료일 · 장소 · 연락처←`contactPhone` · 이메일←`contactEmail` · 참가비←`fee` · 웹사이트←`websiteUrl` · 저장일 |
| `RECEIPT` | `merchantName` ?? `-` | `merchantAddress` | 상호명 · 주소 · 구매일 · 구매시간 · 결제수단 · 카드사 · 총액←`` `${formatAmount(totalAmount)} ${currencyCode ?? 'KRW'}` `` · 저장일 |

프리뷰 텍스트(원본 규칙): `rawOcrText`/`rawText`가 있으면 그것, 없으면 주요 필드를 ` / `로 조인. 표시는 `"… {preview} …"` 형태이고 **첫 매칭 검색어만** `info`(라이트 `#2563EB` / 다크 `#7FB0EF`) + `fontWeight 700`로 하이라이트한다.

**문서유형 기본값과 `전체` 정책 (확정)**

**결정: 마지막으로 사용한 문서 유형을 MMKV `search.lastDocType`에 기억해 복원한다. 최초 실행 시 `BUSINESS_CARD`(명함).** 규칙 정본은 [[Offline and State]] §10-1 ST-09~ST-14이며, 아래는 이 화면에서의 관찰 가능한 동작이다.

| 상황 | 화면 동작 |
|---|---|
| 최초 실행(키 없음) | `명함` 칩 선택. 근거: 명함이 핵심 도메인이다 — 그룹(명함첩)·전용 목록/검색 API를 온전히 갖춘 유일한 유형이고 저장 데이터가 가장 많다 |
| 재진입 | `search.lastDocType` 값의 칩을 선택. 값이 없거나 열거형에 없는 값이면 `명함`으로 되돌린다(좁히기 가드) |
| 검색 **실행 성공** 직후 | 그때 선택돼 있던 유형을 `search.lastDocType`에 기록. **칩을 탭한 시점이 아니라 실행 시점**이다 — 칩만 눌러 보고 나간 사용자의 다음 진입을 바꾸지 않는다 |
| `전체` 선택 후 실행 | `'ALL'`을 그대로 저장한다. 명시적으로 전체를 고른 사용자를 다음 진입에서 명함으로 되돌리면 선택이 무시된 것처럼 느껴진다 |
| 로그아웃 | 이 키를 **삭제**한다. 다른 계정으로 로그인했을 때 앞 사람의 검색 기본값이 남아 있으면 안 된다 (참고: `theme.mode`는 기기 취향이므로 로그아웃에도 유지) |

**`전체`는 기본값이 아니다 (근거).** 서버에 통합 검색 엔드포인트가 없다. `전체`는 4종 검색 API(API-19/47/52/61)를 **병렬 4회** 호출하고 클라이언트에서 머지하는 것이며, 서버는 호출마다 `searchHistoryService.record(...)`를 검색 실행 **전에** 무조건 수행한다 → **요청 4배 + 서버 검색기록 4건 적립**. Hikari `maximum-pool-size: 3`인 서버에 기본값으로 얹을 부하가 아니다. 그래도 **옵션 자체는 유지**한다 — 유형을 모르고 찾는 상황이 실재하므로, **사용자가 명시 선택했을 때만** 동작하게 둔다.

| ID | `전체` 선택 시 규칙 | 이유 |
|---|---|---|
| 병렬 | 4종을 `Promise.allSettled`로 묶어 **쿼리 키 하나**(`['search','ALL',q,topK]`)로 다룬다. 일부 유형이 실패해도 성공한 결과는 노출하고 실패 유형만 결과 상단에 `{유형} 검색에 실패했습니다.` 배너로 알린다 | 4개 키로 쪼개면 로딩·에러·무효화가 4벌이 되어 화면이 4번 흔들린다. 서버가 없는 리소스에도 500을 던지므로 한 종류의 실패로 전체를 버릴 수 없다 |
| 머지 | 정렬 기준에 따라 4종을 한 목록으로 섞는다. 관련도순 = `(b.similarity ?? 0) - (a.similarity ?? 0)`, 최신순 = `createdAt` 내림차순. 카드마다 **유형 배지 필수**(`전체`가 아닐 때는 헤더에 유형이 이미 있어 생략) | 유형이 섞이면 배지 없이는 무슨 문서인지 알 수 없다 |
| 헤더 | 결과 헤더는 `전체 {n}건` (유형별은 `{유형} {n}건`) | — |
| **검색기록 1건** | **사용자에게 보이는 검색기록은 정확히 1건이다.** 로컬 최근 검색어(`search.recent`)에 `{q, docType:'ALL', at}` **1건만** 적립하고, 서버에 4건이 쌓이는 것은 앱이 막을 수 없으므로 최근 검색어 렌더 단계에서 **동일 `q` + `at` 2초 이내 항목을 1건으로 병합 표시**한다 | 4건으로 적립하면 최근 검색어 10칸이 한 번의 검색으로 40% 차버린다. 병합 표시는 서버를 못 고치는 상태에서 사용자에게 4줄을 보여주지 않는 유일한 수단이다 |
| 캐시 | `staleTime` 5분을 그대로 적용(유형별과 동일) | 재검색 1회가 서버 기록 4건이므로 캐시 히트의 가치가 4배다 |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 유형 칩은 **`search.lastDocType` 값이 선택된 상태**(최초 실행 `명함`)로 그려지고, 그 아래 최근 검색어 + 안내 카드. **검색어가 비어 있으면 요청을 보내지 않는다**(`enabled: q.trim().length > 0`) | placeholder `검색어를 입력하세요` (원문) / 안내 `이름 일부, 회사명, 직책 등 기억나는 것만으로 찾을 수 있습니다.` (원본 랜딩 카피) |
| 로딩 | 결과 자리 스켈레톤 3장. `전체`는 4종이 다 끝날 때까지 스켈레톤 유지(부분 도착마다 목록을 다시 흔들지 않는다) | 3초 초과 시 `검색 중...` (원문) |
| 성공 | 결과 리스트 + `{유형} {n}건` / `전체`면 `전체 {n}건` + 카드별 유형 배지 | — |
| 빈(결과 0) | 중앙 EmptyState | `조건에 맞는 결과가 없습니다.` (원문) / 부제 `다른 키워드나 문서 유형으로 검색해 보세요.` |
| 빈(최근 검색어 0) | 최근 섹션 자체를 숨김 | — |
| 에러 | 인라인 에러 박스 (`danger.border` / `danger.container` / 본문 `danger.strong`) | 서버 `error` 원문, 없으면 `검색에 실패했습니다.` |
| 부분 실패(`전체` 한정) | 성공한 유형 결과는 그대로 노출 + 결과 상단 배너 | `` `{유형} 검색에 실패했습니다.` `` — 실패 유형이 2개 이상이면 `` `{유형}, {유형} 검색에 실패했습니다.` `` 로 합친다 |
| 부분 성공(임베딩 실패) | 결과 상단 안내 배너 | 서버 `message` 원문: `임베딩 생성 실패. Fuzzy 검색만 가능.` |
| 오프라인 | 검색바 disabled + 배너 | `오프라인입니다. 검색은 연결 후 가능합니다.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 검색어 입력 | **요청 없음.** 로컬 상태만 갱신한다 — **디바운스 자동 검색 금지**(FR-071). 서버가 검색 API 호출마다 검색기록을 1건 적립하므로 타이핑 중 실행하면 `search_histories`가 폭증한다 | — | — |
| 키보드 `검색` | **검색 실행**(명시적 제출) + 키보드 dismiss. 성공 시 `search.lastDocType` 갱신 + 로컬 최근 검색어 1건 적립 | selection | 에러 박스 |
| 유형 칩 탭 | 유형 변경. **검색어가 이미 있으면 그 유형으로 즉시 재실행**(칩 탭도 명시적 제출로 취급), 비어 있으면 선택만 바꾸고 요청 없음 | 결과 crossfade + selection | 에러 박스 |
| `전체` 칩 탭 | 위와 동일하되 4종 병렬 실행. 로딩은 4종 완료까지 하나로 묶고, 결과 헤더는 `전체 {n}건` | 결과 crossfade + selection | 실패 유형만 배너, 성공분은 노출 |
| `⇅` 탭 | ActionSheet `최신순` / `관련도순` (원문 라벨) | 시트 | — |
| 결과 카드 탭 | SCR-19 | scale 0.98 | — |
| 최근 검색어 탭 | 검색바에 `q`를 채우고 **그 기록의 `docType`으로 칩까지 되돌린 뒤** 즉시 검색 (기록이 `'ALL'`이면 `전체`로) | selection | 에러 박스 |
| 최근 검색어 `✕` | 로컬 목록에서만 제거 (**단건 삭제 API 없음**) | fade-out | — |
| `전체 삭제` 탭 | ConfirmDialog → API-55 | 토스트 `` `검색 기록 {n}건을 삭제했습니다.` `` (원문) | 토스트 `검색 기록 삭제에 실패했습니다.` (원문) |
| 스크롤 하단 | 다음 20개 렌더 (클라이언트 슬라이스) | — | — |

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-19 `GET /api/cards/search` | 유형 `명함` **또는 `전체`** | `q`(필수), `topK=50` (원본 고정값) | `['search','BUSINESS_CARD',q,50]`, staleTime **5분** |
| API-61 `GET /api/tickets/search` | 유형 `티켓` 또는 `전체` | 동일 | `['search','TICKET',q,50]`, 동일 |
| API-47 `GET /api/posters/search` | 유형 `포스터` 또는 `전체` | 동일 | `['search','POSTER',q,50]`, 동일 |
| API-52 `GET /api/receipts/search` | 유형 `영수증` 또는 `전체` | 동일 | `['search','RECEIPT',q,50]`, 동일. **원본 미연결 → 신규**. 단 `ReceiptService.save()`가 임베딩을 만들지 않으므로 **Fuzzy 결과만** 나온다 |
| (위 4종 병렬) | 유형 `전체` | 동일 | **키는 하나** `['search','ALL',q,50]`. 내부에서 `Promise.allSettled`로 4콜을 묶는다 |
| API-54 `GET /api/search-histories` | **`전체 기록 보기`에서만** | — | `['searchHistory']`, staleTime 0. 화면의 최근 검색어는 로컬 `search.recent`가 1차 소스다 |
| API-55 `DELETE /api/search-histories` | 전체 삭제 | — | 응답 `data`는 스칼라 숫자. 성공 시 로컬 `search.recent`도 함께 비운다 |

> **검색 응답은 `Page<>`가 아니라 배열**이다(`ApiResponse<List<T>>`). 목록 API와 언랩 방식이 다르므로 공용 헬퍼 `unwrapList()`가 양쪽을 모두 처리해야 한다.
> `similarity`는 하이브리드 점수(`Fuzzy × 0.6 + Vector × 0.4`)이며 일반 조회에는 `null`이다. 관련도순 정렬은 `(b.similarity ?? 0) - (a.similarity ?? 0)`.
> **`staleTime` 5분은 검색기록 억제 장치다.** 뒤로가기 후 재진입이나 같은 조건 재검색이 캐시로 응답되면 서버 기록이 늘지 않는다. `전체`는 캐시 히트 1회가 기록 4건을 막으므로 가치가 4배다. 정본: [[Offline and State]] ST-05 · §10-1, [[API Contract]] §6-2.
> 저장 키는 MMKV `search.lastDocType`(마지막 사용 유형) / `search.recent`(로컬 최근 검색어 최대 10건, 30일 경과분 부팅 시 정리) 두 개다 — [[Offline and State]] §1-4.

---

## SCR-24 · 챗봇 (AI 모라냥)

| 항목 | 값 |
|---|---|
| 라우트 | `app/chat.tsx` (`presentation: 'modal'`, 전체화면) |
| 진입 | 전 탭 화면의 FAB (CMP-22) |
| 인증 | 필요 (비로그인이면 FAB 자체가 렌더되지 않음 — 원본 규칙 동일) |
| 원본 | `components/common/ChatbotWidget.tsx` (897줄, 최대 컴포넌트) |
| 페이즈 | Phase 5 |
| FR | FR-076, FR-077, FR-078, FR-079, FR-080 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 368×580 **드래그 이동 가능한** 플로팅 패널 (`onPointerDown` → `clampPosition` → resize 재클램프) | **전체화면 모달.** 드래그·position state·clamp·resize 핸들러 전량 삭제 | 화면 폭이 이미 390dp라 패널 = 전체화면. 드래그의 존재 이유가 없다 |
| 헤더 hover 툴팁 3종(`도움말`/`초기화`/`창 닫기`) | 삭제, `accessibilityLabel`만 유지 | hover 없음 |
| 도움말 모달(패널 내부 오버레이) | **바텀시트** | — |
| 초기화 확인 모달 | **ConfirmDialog** (문구·버튼 라벨 원문 유지) | — |
| 4열 grid 문서유형 칩 34dp | **가로 스크롤 칩 레일** | 4열 34dp는 좁은 폰에서 글자 잘림 |
| 메시지 리스트 `div` + `scrollTo` | `FlashList` + `onContentSizeChange → scrollToEnd` | — |
| TOP 버튼 (scrollY ≥ 280) | **폐기** | 모바일 관용구 아님 |
| assistant 말풍선의 고양이 귀 장식 2개(`rotate(45deg)` 사각형) | **유지** — 모라냥 캐릭터 아이덴티티 | 브랜드 자산 |
| `sources`를 화면에 표시하지 않음 | **출처 카드 노출** (탭 → SCR-19) | RAG 답변의 검증 경로 제공. `sources`는 문서 DTO 배열 그대로 오므로 바로 카드화 가능 |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top (bg #15293D) ▓▓▓▓▓▓▓▓▓▓ │
│ AI 모라냥              ?  ↺   ✕   │  ═ h58 bg#15293D white
├────────────────────────────────────┤
│                                    │  bg gradient
│ ┌────────────────────────┐         │  #EFF6FF → #F8FAFC 55%
│ │◤              ◥        │         │  귀 장식 12dp
│ │ 안녕하세요. MORA 챗봇   │         │  bg white b#DBEAFE
│ │ AI 모라냥입니다.        │         │  r 14/14/14/4
│ │ 업로드, 검색, 일정 등록 │         │  13/1.55 #1E293B
│ │ 관련해서 무엇이든       │         │  maxWidth 84%
│ │ 물어보세요.             │         │
│ └────────────────────────┘         │
│                                    │
│         ┌──────────────────────┐   │
│         │ 우주관광 이응환 연락처│   │  user bg#1D4ED8 white
│         └──────────────────────┘   │  r 14/14/4/14
│                                    │
│ ┌────────────────────────┐         │
│ │ 이응환 대표이사의 연락처│         │
│ │ 는 010-1234-5678입니다. │         │
│ └────────────────────────┘         │
│ ┌──────────────┐┌──────────────┐   │  출처 카드 가로 스크롤
│ │[명함] 이응환 ││[명함] 김서연 ││   │  w200 h72
│ │우주관광(주)  ││(주)모라테크  ││   │
│ └──────────────┘└──────────────┘   │
│                                    │
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │ ═ 칩 레일 h54 bg white
│ │[명함] 티켓  포스터  영수증    │→  │  b-top #DBEAFE
│ └──────────────────────────────┘   │
├────────────────────────────────────┤
│ ┌──────────────────────┐ ┌───────┐ │ ═ 입력바 h68 b-top #CBD5E1
│ │ 명함에서 찾고 싶은…  │ │ 전송  │ │  input h44 r12 bg#F8FAFC
│ └──────────────────────┘ └───────┘ │  버튼 w58 h44 r12
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**문구 원문 (전량 보존)**

| 항목 | 값 |
|---|---|
| 헤더 타이틀 | `AI 모라냥` (20/700 white) |
| 초기 메시지 | `안녕하세요. MORA 챗봇 AI 모라냥입니다. 업로드, 검색, 일정 등록 관련해서 무엇이든 물어보세요.` |
| 타이핑 인디케이터 | `답변 작성 중...` |
| 빈 답변 폴백 | `관련 문서를 찾았지만 답변 내용이 비어 있어요.` |
| 검색 0건 서버 응답 | `관련된 데이터를 찾을 수 없어 답변하기 어렵습니다. 다른 키워드로 검색해 보세요.` |
| 유형 미선택 placeholder | `문서 유형을 먼저 선택하세요` |
| 명함 placeholder | `명함에서 찾고 싶은 내용을 입력하세요` |
| 티켓 placeholder | `티켓에서 출발지나 날짜를 검색해보세요` |
| 포스터 placeholder | `포스터에서 행사명이나 마감일을 검색해보세요` |
| 영수증 placeholder | `영수증에서 가게명이나 금액을 검색해보세요` |
| 전송 버튼 | `전송` |
| 세션 만료 | `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` |
| 호출 실패 | `` `챗봇 답변을 불러오지 못했습니다. (${status})` `` |
| 네트워크 실패 | `백엔드 서버에 연결할 수 없습니다.` |

**도움말 시트 (원문 `HELP_GUIDES` 5개 전량)**
- 제목 `AI 모라냥 이용 안내` / 확인 버튼 `확인`
1. `키워드만 입력하기보다 대화형 문장으로 질문해 주세요.`
2. `저는 MORA의 문서 관리 기능(업로드, OCR, 보관함, 검색) 중심으로 안내해 드려요.`
3. `실제 문서 인식 결과는 이미지 품질에 따라 달라질 수 있으니 저장 전 필드 값을 꼭 확인해 주세요.`
4. `일정/연락처/금액 같은 중요 정보는 원본 이미지와 함께 최종 검토하는 것을 권장해요.`
5. `입력한 대화 내용은 품질 개선과 오류 분석을 위해 서비스 정책에 따라 처리될 수 있어요.`

**초기화 확인 다이얼로그 (원문)**: 제목 `대화 내용 초기화` / 본문 `대화가 처음부터 다시 시작되며 이전 대화 내용은 복구할 수 없습니다. 초기화 하시겠습니까?` / 버튼 `초기화`(destructive, `#DC2626`) · `취소`

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 초기 메시지 1개, 유형 미선택, 전송 disabled(`#94A3B8`) | placeholder `문서 유형을 먼저 선택하세요` |
| 로딩 | 타이핑 말풍선 + 입력 disabled | `답변 작성 중...` |
| 성공 | 답변 말풍선 + 출처 카드 | — |
| 빈(답변 비어있음) | 폴백 말풍선 | `관련 문서를 찾았지만 답변 내용이 비어 있어요.` |
| 빈(출처 0건) | 출처 카드 영역 미렌더 | (서버 답변 문구가 이미 설명) |
| 에러(401) | 시스템 말풍선 + 세션 파기 → SCR-03 | `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` |
| 에러(호출 실패) | 시스템 말풍선 + `다시 시도` 칩 | `` `챗봇 답변을 불러오지 못했습니다. (${status})` `` |
| 에러(타임아웃 30초) | 동일 | `답변이 오래 걸립니다. 잠시 후 다시 시도해 주세요.` |
| 오프라인 | 입력바 disabled + 배너 | `백엔드 서버에 연결할 수 없습니다.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 유형 칩 탭 | 선택 + placeholder 교체 + 전송 활성화 | 칩 배경 전환 150ms + selection 햅틱 | — |
| 입력 | 로컬 상태 | — | — |
| `전송` 탭 / 키보드 전송 | 사용자 말풍선 즉시 추가 → API-31 | 말풍선 slide-in 200ms + `Haptics.impactAsync(Light)`, 리스트 자동 하단 스크롤 | 시스템 말풍선 + Error 햅틱 |
| 출처 카드 탭 | SCR-19 (`sources[i].id` + 선택 유형) | scale 0.98 | 토스트 `문서를 찾을 수 없습니다.` |
| `?` 탭 | 도움말 시트 | 시트 스프링 | — |
| `↺` 탭 | ConfirmDialog → 대화 초기화 | Warning 햅틱, 리스트 fade + 초기 메시지 복원, 유형 선택 해제, 입력 비움 | — |
| `✕` / Android 백 | 모달 dismiss (대화는 메모리에 유지) | — | — |
| 메시지 롱프레스 | 복사 | Medium 햅틱 + 토스트 `복사했습니다.` | — |
| 키보드 표시 | 입력바가 키보드 위로 이동, 리스트 하단 스크롤 유지 | `KeyboardAvoidingView` + `useAnimatedKeyboard` | — |

**데이터**

| API | 시점 | 요청 | 캐시 |
|---|---|---|---|
| API-31 `POST /api/chat` | 전송 시 | **snake_case 필수**: `{ query, document_type, top_k: 5 }`. 헤더 `Authorization: Bearer` 전달(LLM 서버가 Spring 검색 API를 역호출할 때 필요) | 캐시 없음. 대화는 Zustand 메모리 스토어(앱 종료 시 소멸 — 원본 동일) |

**응답 처리**
```ts
// ChatResponseData { answer: string; sources: Record<string,unknown>[]; query: string }
const text = result.data.answer?.trim() || '관련 문서를 찾았지만 답변 내용이 비어 있어요.'
// sources는 검색 API 응답 DTO 배열 그대로 (CardResponse[] | TicketResponse[] | ...)
// → 선택된 document_type으로 어떤 DTO인지 판별해 출처 카드를 렌더
```

> **제약 (사용자에게 알려야 하는 사실)**: 한 요청에 **문서 유형 1종만** 지원한다(`HybridRetriever.SEARCH_ENDPOINTS`가 타입별 엔드포인트로 분기). 크로스 도메인 질의("작년 부산 출장 티켓이랑 영수증")는 불가능하다. 유형 칩이 필수 선택인 이유가 이것이다 — 도움말 시트 2번 항목이 이 제약을 우회적으로 설명한다.

---
## SCR-25 · 설정

| 항목 | 값 |
|---|---|
| 라우트 | `app/(tabs)/settings/index.tsx` (탭 5 · `설정`) |
| 진입 | 탭바, SCR-06 아바타 |
| 인증 | 필요 |
| 원본 | `frontend/app/dashboard/settings/page.tsx` (마이페이지, 7섹션 2열 그리드) |
| 페이즈 | Phase 6 (단 **테마 세그먼트는 Phase 1**에 갤러리 화면과 함께 동작해야 한다 — 두 테마를 눈으로 비교할 수단이 없으면 Phase 1 산출 CMP 21종의 다크 검수가 불가능하다. 누적 52종은 산출 시점 검수로 각 페이즈가 나눠 맡는다 — [[Requirements]] FR-128) |
| FR | FR-011(테마 프로바이더 — 3택 UI의 유일한 변경 지점), FR-032, FR-090, FR-094, FR-095, FR-096, FR-097 |

**모바일 변경점**

| 원본 | 모바일 | 이유 |
|---|---|---|
| 2열 grid `repeat(auto-fit, minmax(440px,1fr))` × 7섹션 | **1열 세로 섹션 리스트** | 440dp 컬럼 불가 |
| 모달 5종(password/nickname/confirm ×3)이 `maxWidth:460` 중앙 다이얼로그 | **비밀번호·프로필·삭제는 별도 화면(SCR-26~28)**, 단순 확인만 ConfirmDialog | 폼이 3필드 이상이면 다이얼로그보다 화면이 낫다 |
| StatTile 3개가 **전부 하드코딩 목업** (`docs:12, integrationsActive:1, lastSyncLabel:'6분 전'`) | **`보관 문서` 1개만 실 데이터**(API-24 `storedDocumentCount`), 나머지 2개 삭제 | 없는 데이터를 지어내지 않는다. 코드 주석에도 `TODO: replace stats with selector on real data once /me/stats endpoint ships`라고 적혀 있다 |
| 기본값 하드코딩 `'leechoeun'` / `'mvp6276@gmail.com'` | **제거** | 실제 사용자 정보가 코드에 박혀 있었다. 반드시 삭제 |
| 아바타를 base64로 localStorage에만 저장 (`TODO: POST to /me/avatar once endpoint exists`) | **아바타 변경 기능 제거**, 이니셜 아바타만 | 서버 엔드포인트가 없다. 기기 저장소에만 남는 프로필 사진은 기기 변경 시 소실 → 사용자 기만 |
| `연락처` 토글 (API 없음, 로컬 상태만) | **제거** | 동작하지 않는 스위치 |
| 알림 토글 3종이 localStorage에만 저장 | **SCR-29로 이동 + API-40 실연동** | `NotificationSettingController`가 놀고 있었다 |
| 테마 세그먼트 `라이트`/`다크`가 `document.documentElement.dataset.theme`만 세팅하고 **대응 스타일이 존재하지 않음** | **`시스템 따름` / `라이트` / `다크` 3택 + 실제 다크 팔레트 적용.** 다크모드는 v1 필수 기능이다 | 2택은 OS 전역 다크 사용자에게 앱이 튄다 — 3택이 모바일 관례. 팔레트 정본은 [[Design Tokens]] §10-3, 결정문은 [[ADR-004 Styling]] §4 |
| `window.open(mailto)` 문의하기 | `Linking.openURL('mailto:support@mora.app')` | — |
| `이용약관` / `개인정보 처리방침` onClick 비어 있음 | **SCR-30 구현** | 앱스토어 심사 필수 |
| 앱 버전 하드코딩 `v1.2.3 (build 248)` | `expo-application`의 실제 값 | — |
| 로그아웃이 서버 미호출 (`TODO: wire to /auth/logout endpoint`) | 동일(엔드포인트 없음) + SecureStore 파기 | 백엔드 무수정 원칙 |
| 구글 캘린더 연동이 `window.location.href` 전체 이동 | `WebBrowser.openAuthSessionAsync` + 딥링크 | — |

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ 설정                               │  ═
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │ ┈
│ │ ⬤   이응환                  ›  │ │  아바타 64dp #15293D
│ │ 64  hong@naver.com             │ │  이니셜 24/700 white
│ │     2026. 7. 1. 가입           │ │  caption #94A3B8
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 📄 보관 문서              41건 │ │  단일 StatTile
│ └────────────────────────────────┘ │
│                                    │
│ 계정                               │  section 16/600
│ ┌────────────────────────────────┐ │
│ │ 닉네임              이응환   › │ │  h56
│ │ 이메일       hong@naver.com    │ │  읽기 전용(chevron 없음)
│ │ 비밀번호                     › │ │  소셜이면 비활성
│ └────────────────────────────────┘ │
│                                    │
│ 연동                               │
│ ┌────────────────────────────────┐ │
│ │ Google Calendar   연동됨  [◉ ] │ │  Pill + Toggle
│ │ 추출된 일정을 캘린더로 자동 전송│ │  caption
│ └────────────────────────────────┘ │
│                                    │
│ 알림                               │
│ ┌────────────────────────────────┐ │
│ │ 알림 설정                    › │ │  → SCR-29
│ └────────────────────────────────┘ │
│                                    │
│ 화면                               │
│ ┌────────────────────────────────┐ │
│ │ 테마                           │ │  bodyStrong
│ │ 시스템 설정을 따릅니다.         │ │  caption / text.muted
│ │ 지금은 다크입니다.              │ │  (선택값에 따라 문구 교체)
│ │ ┌───────────┬────────┬────────┐│ │
│ │ │시스템 따름│ 라이트 │  다크  ││ │  CMP-12 Segmented h36
│ │ └───────────┴────────┴────────┘│ │  즉시 반영 · 저장 버튼 없음
│ └────────────────────────────────┘ │
│                                    │
│ 데이터                             │
│ ┌────────────────────────────────┐ │
│ │ 검색 기록 삭제               › │ │
│ │ 내 데이터 전체 삭제          › │ │  danger tone
│ └────────────────────────────────┘ │
│                                    │
│ 지원                               │
│ ┌────────────────────────────────┐ │
│ │ 문의하기                     › │ │
│ │ 이용약관                     › │ │
│ │ 개인정보 처리방침            › │ │
│ │ 오픈소스 라이선스            › │ │
│ │ 앱 버전            1.0.0 (1)   │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │           로그아웃             │ │  secondary lg
│ └────────────────────────────────┘ │
│           회원 탈퇴                │  danger ghost → SCR-28
│                                    │
│  © 2026 MORA. All rights reserved. │  caption #94A3B8 center
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
├────────────────────────────────────┤
│  홈   보관함   [📷]   검색   설정   │ ═
└────────────────────────────────────┘
```

**섹션·행 문구 (원문 보존 + 결정 표시)**

| 섹션 | 행 | 설명 문구 | 우측 |
|---|---|---|---|
| 계정 | `닉네임` | 현재 닉네임 | `›` → SCR-26 |
| 계정 | `이메일` | 현재 이메일 | 없음(읽기 전용. 원본 주석 `Email is read-only until /me/email verification flow exists on backend`) |
| 계정 | `비밀번호` | 로컬: `비밀번호를 변경합니다.` / 소셜: `소셜 계정은 비밀번호가 없습니다` (원문) | 로컬만 `›` → SCR-27 |
| 연동 | `Google Calendar` | `추출된 일정을 캘린더로 자동 전송` (원문) | Pill `연동됨`/`미연동` + Toggle |
| 알림 | `알림 설정` | `마감·일정 알림 수신 방식을 설정합니다.` | `›` → SCR-29 |
| 화면 | `테마` | 선택값에 따라 교체 — `시스템 따름`: `시스템 설정을 따릅니다.` + 2행 `지금은 {라이트\|다크}입니다.` / `라이트`: `현재 라이트 모드` (원문) / `다크`: `현재 다크 모드` (원문) | Segmented 3칸 (CMP-12) |
| 데이터 | `검색 기록 삭제` | `저장된 모든 검색어를 삭제합니다.` (원문) | `›` danger |
| 데이터 | `내 데이터 전체 삭제` | `복구할 수 없습니다. 신중히 진행하세요.` (원문) | `›` danger → SCR-28 |
| 지원 | `문의하기` | `이메일로 문의를 보냅니다.` (원문) | `›` |
| 지원 | `이용약관` | `서비스 이용약관을 확인합니다.` (원문) | `›` → SCR-30 |
| 지원 | `개인정보 처리방침` | `데이터 처리 방식을 확인합니다.` (원문) | `›` → SCR-30 |
| 지원 | `오픈소스 라이선스` | `사용한 오픈소스 목록입니다.` | `›` → SCR-30 |
| 지원 | `앱 버전` | — | `{version} ({buildNumber})` |

> 하단 저작권 `© 2026 MORA. All rights reserved.`와 GitHub 링크(`https://github.com/lavermeanyou/OCR_FOR_MORA`)는 원본 랜딩 푸터에서 흡수했다. GitHub는 `오픈소스 라이선스` 화면 하단에 배치한다.

**테마 설정 — `화면 > 테마` (확정)**

**이 앱에서 테마를 바꿀 수 있는 지점은 여기 한 곳뿐이다.** 다크모드는 v1 필수 기능이며(2026-07-27 결정, [[ADR-004 Styling]] §4), 팔레트 정본은 [[Design Tokens]] §10-3이다.

| 항목 | 값 |
|---|---|
| 컴포넌트 | CMP-12 `SegmentedControl` 3칸, h36, 트랙 `surface.alt` / 선택 칸 `bg.elevated` + `elevation.raised`, 선택 라벨 `text.primary`(`label` 롤) / 비선택 `text.muted` |
| 세그먼트 라벨 | `시스템 따름` · `라이트` · `다크` (좌→우 고정 순서) |
| 기본값 | **`시스템 따름`** |
| 폭 | 390dp에서 트랙 내부 ≈326dp ÷ 3 = 약 108dp/칸. `시스템 따름`(6자, `label` 12px SemiBold ≈ 72dp)이 줄바꿈 없이 들어간다 — 라벨을 `시스템`으로 축약하지 않는다 |
| 저장 | MMKV **`theme.mode`** (`'system' \| 'light' \| 'dark'`). 앱 재시작 시 첫 프레임에 복원된다 — MMKV는 **동기** 읽기라 흰 화면 깜빡임이 없다 ([[Offline and State]] §1-4) |
| 반영 시점 | **즉시.** 별도 저장 버튼·확인 다이얼로그가 없다. 탭한 칸이 곧 적용 상태다 |
| `시스템 따름` 동작 | nativewind `useColorScheme()`을 추종한다. 앱 실행 중 OS 테마가 바뀌면 화면이 즉시 따라간다(백그라운드에서 바뀐 경우 포그라운드 복귀 프레임에 반영) |
| 부제 문구 | `시스템 따름` = `시스템 설정을 따릅니다.` + 2행 `지금은 라이트입니다.` / `지금은 다크입니다.`(OS 해석 결과를 실시간 갱신) · `라이트` = `현재 라이트 모드`(원문) · `다크` = `현재 다크 모드`(원문) |
| 네이티브 동반 | `app.config.ts` `userInterfaceStyle: "automatic"`. 액션시트·날짜/시간 피커·키보드가 앱 테마와 함께 움직인다 |
| 로그아웃 | `theme.mode`는 **유지**한다. 테마는 계정 취향이 아니라 기기·눈의 문제다 (반대로 `search.lastDocType`은 로그아웃 시 삭제) |
| 접근성 | 세그먼트는 `accessibilityRole="radiogroup"` + 각 칸 `radio`, `accessibilityState={{selected}}`. 선택 시 스크린리더가 `테마, 다크, 선택됨`으로 읽는다 |
| 로컬 전용 | **서버 저장 없음.** 원본 웹에도 테마 저장 엔드포인트가 없고 기기별 취향이므로 동기화하지 않는다 (알림 설정과 대비 — 그쪽은 API-40으로 서버 저장한다) |

**전환 시 지켜야 할 것**
1. **화면 상태가 유실되지 않는다.** 테마 변경은 CSS 변수/`useTheme()` 값 교체이므로 리마운트가 아니다. 스크롤 위치·입력 중인 텍스트·열려 있는 시트가 그대로 유지되어야 한다 ([[QA Checklist]] 회귀 케이스).
2. 전환 애니메이션은 **전체 화면 crossfade 200ms**(`motion.duration.base`) + `Haptics.selectionAsync()`. 색만 페이드하고 레이아웃은 움직이지 않는다.
3. 다크에서도 **테마를 따르지 않는 화면이 있다** — §0-3의 국소 예외 표(SCR-01/02/09/12/21). 이 화면에서 `라이트`를 골라도 이미지 뷰어는 어둡고, `다크`를 골라도 스캔 결과의 이미지 띠는 밝다. 사용자 문의가 예상되지만 **판독성이 취향보다 우선**이라는 판단이며 UI에 별도 설명을 넣지 않는다.

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 캐시된 사용자 정보로 즉시 렌더 | — |
| 로딩 | 프로필 카드 스켈레톤, 행은 그대로 | — |
| 성공 | 전체 렌더 | — |
| 빈 | 가입일 없음 | `가입일 정보 없음` (원문) |
| 에러(프로필) | 프로필 카드 자리 에러 + `다시 시도` | `프로필을 불러오지 못했습니다.` |
| 에러(캘린더 연동) | 토글 원복 + 토스트 | `구글 캘린더 연동에 실패했습니다.` / `구글 캘린더 연동 해제에 실패했습니다.` / `구글 캘린더 연동 URL을 가져오지 못했습니다.` (원문 3종) |
| 오프라인 | 배너 + 토글/삭제 행 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 프로필 카드 탭 | SCR-26 | scale 0.99 + selection | — |
| `닉네임` 행 | SCR-26 | selection | — |
| `비밀번호` 행 | 로컬 계정만 SCR-27. 소셜이면 ConfirmDialog(안내 전용) | Warning 햅틱 | 안내 문구: `소셜 로그인(구글/카카오/네이버) 계정은 비밀번호를 변경할 수 없습니다.` (원문) |
| Google Calendar 토글 ON | API-25 → `WebBrowser.openAuthSessionAsync` → 딥링크 콜백 | 토글 즉시 이동 + 중복 클릭 방지(`calendarBusy`) | 토글 원복 + 토스트 |
| Google Calendar 토글 OFF | ConfirmDialog → API-29 | Warning 햅틱 + 토스트 `연동을 해제했습니다.` | 원복 + 토스트 |
| 테마 세그먼트 탭 | **즉시 적용** + MMKV `theme.mode` 저장 (저장 버튼 없음). `시스템 따름`이면 `useColorScheme()` 추종으로 전환 | 전체 화면 crossfade 200ms + selection 햅틱 + 부제 문구 교체 | MMKV 쓰기 실패해도 **이번 세션의 적용은 강행**한다(다음 실행에서 기본값으로 돌아갈 뿐) |
| OS 테마 변경 (앱 외부) | `theme.mode === 'system'`일 때만 화면 반영. `라이트`/`다크` 선택 상태면 **무시** | crossfade 200ms | — |
| `검색 기록 삭제` | ConfirmDialog → API-55 | 토스트 `` `검색 기록 {n}건을 삭제했습니다.` `` (원문) | 토스트 `검색 기록 삭제에 실패했습니다.` (원문) |
| `문의하기` | `mailto:support@mora.app` | — | 토스트 `메일 앱을 열 수 없습니다.` |
| `로그아웃` | ConfirmDialog → SecureStore 3키 파기 → SCR-03 replace | Warning 햅틱 | — |
| `회원 탈퇴` | SCR-28 | selection | — |

**검색 기록 삭제 확인 (원문)**: 제목 `검색 기록을 모두 삭제할까요?` / 본문 `이 작업은 되돌릴 수 없습니다. 계속하려면 확인을 눌러주세요.` / 버튼 `삭제`(destructive) · `취소`
**로그아웃 확인**: 제목 `로그아웃할까요?` / 본문 `다시 로그인하려면 이메일과 비밀번호가 필요합니다.` / 버튼 `로그아웃` · `취소`

**데이터**

| API | 시점 | 파라미터 | 캐시 |
|---|---|---|---|
| API-03 `GET /auth/me` | 화면 포커스 | — | `['me']`, staleTime 5분. `createdAt`은 **문자열 또는 `[yyyy,M,d,H,m,s,ns]` 배열**(Jackson LocalDateTime) 양쪽을 파싱해야 한다 |
| API-24 `GET /api/dashboard` | 포커스 (홈과 캐시 공유) | — | `storedDocumentCount`만 사용 |
| API-27 `GET /api/google-calendar/connected/{userId}` | 진입 1회 | `{userId}` | `['gcal', userId]`, staleTime 5분 |
| API-25 `GET /api/google-calendar/connect-url` | 토글 ON | `userId` + `Authorization` | 응답 `{ url }` |
| API-29 `DELETE /api/google-calendar/tokens/{userId}` | 토글 OFF | `{userId}` | mutation |
| API-55 `DELETE /api/search-histories` | 검색 기록 삭제 | — | 응답 `data` = 스칼라 숫자 |

> **보안 경고**: API-27/28/29/30은 컨트롤러에 인증 검사가 **전혀 없다**. `userId`(UUID)만 알면 남의 연동 상태 조회·해제가 가능하다. 앱은 자기 `userId`만 넘기지만, 이 사실은 [[Risks]]에 반드시 기록한다. 앱 측 완화책은 없다(서버 수정 필요).
> 로컬 저장 키는 원본 `mora_settings_prefs`를 계승하되 **토큰은 SecureStore**로 분리한다. 나머지 환경설정 중 **부팅 첫 프레임에 값이 필요한 것(`theme.mode`, `search.lastDocType`)은 MMKV**(동기 읽기), 그 외는 AsyncStorage다 — AsyncStorage는 rehydrate가 한 틱 늦어 테마가 라이트로 깜빡인다 ([[Offline and State]] §1-4).

---

## SCR-26 · 프로필 편집

| 항목 | 값 |
|---|---|
| 라우트 | `app/settings/profile.tsx` (스택 push) |
| 진입 | SCR-25 프로필 카드 / `닉네임` 행 |
| 인증 | 필요 |
| 원본 | `settings/page.tsx` `NicknameModal` + `ProfileCard` |
| 페이즈 | Phase 6 |
| FR | FR-091 |

**모바일 변경점**: 460dp 중앙 다이얼로그 → 전용 화면. 아바타 업로드는 서버 엔드포인트가 없어 제거(SCR-25 참조). 검증 규칙은 원본 그대로 유지한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  프로필                    저장  │  ═ 저장=point, 미변경 disabled
├────────────────────────────────────┤
│              ⬤                     │  아바타 80dp #15293D
│             80dp                   │  이니셜 32/700
│                                    │
│ 닉네임                             │  caption
│ ┌────────────────────────────────┐ │
│ │ 이응환                      ✕ │ │  h48 · maxLength 20
│ └────────────────────────────────┘ │
│ 2~20자, 한글·영문·숫자·_.- 사용 가능│  caption #999
│                                    │
│ 이메일                             │
│ ┌────────────────────────────────┐ │
│ │ hong@naver.com                 │ │  disabled bg#F1F5F9
│ └────────────────────────────────┘ │
│ 이메일은 변경할 수 없습니다.        │  caption
│                                    │
│ 로그인 방식              Google    │  읽기 전용 행
│ 가입일               2026. 7. 1.   │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**검증 (원본 그대로)**: `trimmed.length >= 2 && trimmed.length <= 20 && /^[a-zA-Z0-9가-힣_.-]+$/.test(trimmed)`

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 현재 닉네임 프리필, `저장` disabled | 힌트 `2~20자, 한글·영문·숫자·_.- 사용 가능.` (원문 설명문에서 추출) |
| 로딩 | 헤더 스피너 | 하단 버튼 사용 시 `저장 중...` |
| 성공 | pop + 토스트 | `닉네임을 변경했습니다.` |
| 빈 | 저장 disabled | — |
| 에러(검증) | 힌트가 danger 색 | `허용되지 않은 문자가 포함되어 있거나 글자 수가 맞지 않습니다.` (원문) |
| 에러(서버) | 하단 에러 캡션 | `닉네임 변경에 실패했습니다.` (원문) |
| 오프라인 | 배너 + 저장 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 입력 | 실시간 검증, `저장` 활성/비활성 | 힌트 색 전환 | — |
| `저장` 탭 | API-04 `PATCH /auth/me` body `{ name }` | 헤더 스피너 | 에러 캡션 + Error 햅틱 |
| `‹` / 백 | dirty면 이탈 확인 | — | — |
| 이메일 필드 탭 | 토스트 안내 | `이메일은 변경할 수 없습니다.` | — |

**데이터**

| API | 시점 | 캐시 |
|---|---|---|
| API-04 `PATCH /auth/me` | 저장 | 성공 시 `['me']` setQueryData + SecureStore 사용자 캐시 갱신 |

---

## SCR-27 · 비밀번호 변경

| 항목 | 값 |
|---|---|
| 라우트 | `app/settings/password.tsx` (스택 push) |
| 진입 | SCR-25 `비밀번호` 행 (로컬 계정만) |
| 인증 | 필요 |
| 원본 | `settings/page.tsx` `PasswordModal` |
| 페이즈 | Phase 6 |
| FR | FR-092 |

**모바일 변경점**: 다이얼로그 → 화면. `👁`/`🙈` 이모지 토글 → `Eye`/`EyeOff` 아이콘(원본 로그인 폼과 통일). 서버 **429 rate limit**(분당 5회, Bucket4j)을 UI에 명시 — 원본에는 이 처리가 없었다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  비밀번호 변경                   │  ═
├────────────────────────────────────┤
│              ┌────┐                │
│              │ 🔒 │  44dp #DBEAFE  │
│              └────┘                │
│ 보안을 위해 현재 비밀번호를 확인한  │  bodySm center
│ 뒤 새 비밀번호를 설정합니다.        │
│                                    │
│ 현재 비밀번호                      │
│ ┌────────────────────────────────┐ │
│ │ ••••••••                   👁 │ │
│ └────────────────────────────────┘ │
│                                    │
│ 새로운 비밀번호                    │
│ ┌────────────────────────────────┐ │
│ │ 8자 이상                   👁 │ │
│ └────────────────────────────────┘ │
│ 8자 이상                           │  caption (에러 시 danger)
│                                    │
│ 새로운 비밀번호 확인               │
│ ┌────────────────────────────────┐ │
│ │ 한 번 더 입력              👁 │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────────────────────────────┐ │
│ │            변경                │ │  primary lg
│ └────────────────────────────────┘ │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**필드 스펙 (원본 그대로)**

| 필드 | 라벨 | placeholder | 기본 힌트 | `textContentType` |
|---|---|---|---|---|
| 1 | `현재 비밀번호` | `••••••••` | — | `password` |
| 2 | `새로운 비밀번호` | `8자 이상` | `8자 이상` | `newPassword` |
| 3 | `새로운 비밀번호 확인` | `한 번 더 입력` | — | `newPassword` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 빈 폼, `변경` disabled | 설명 `보안을 위해 현재 비밀번호를 확인한 뒤 새 비밀번호를 설정합니다.` (원문) |
| 로딩 | 버튼 라벨 교체 | `변경 중…` (원문, 말줄임표는 `…` 문자) |
| 성공 | pop + 토스트 | `비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.` (원문) |
| 빈 | 버튼 disabled | — |
| 에러(길이) | 2번 필드 힌트 danger | `새 비밀번호는 8자 이상이어야 합니다.` (원문) |
| 에러(불일치) | 3번 필드 힌트 danger | `새 비밀번호가 일치하지 않습니다.` (원문) |
| 에러(동일) | 2번 필드 힌트 danger | `현재 비밀번호와 다르게 설정해주세요.` (원문) |
| 에러(서버) | 하단 에러 캡션 | `비밀번호 변경에 실패했습니다.` (원문) |
| 에러(429) | 하단 에러 캡션 + 버튼 60초 disabled | `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.` |
| 오프라인 | 배너 + 버튼 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 각 필드 눈 아이콘 | 개별 토글 | selection | — |
| 입력 | 3필드 모두 채워지고 검증 통과 시 `변경` 활성 | — | — |
| `변경` 탭 | API-05 `PATCH /auth/me/password` | 버튼 로딩 | 에러 캡션 + Error 햅틱 |
| 성공 | pop → SCR-25 | Success 햅틱 | — |
| 백 | dirty면 이탈 확인 | — | — |

**데이터**

| API | 시점 | 요청 | 특이사항 |
|---|---|---|---|
| API-05 `PATCH /auth/me/password` | 제출 | `{ currentPassword, newPassword }` | **429 가능** (`MAX_REQUESTS_PER_MINUTE = 5`, 키는 `IP:토큰뒤8자`). 인메모리 버킷이라 서버 인스턴스별 카운트 |

---

## SCR-28 · 계정 · 데이터 삭제

| 항목 | 값 |
|---|---|
| 라우트 | `app/settings/danger.tsx` (스택 push) |
| 진입 | SCR-25 `내 데이터 전체 삭제` / `회원 탈퇴` |
| 인증 | 필요 |
| 원본 | `settings/page.tsx` `ConfirmModal`(데이터 삭제 / 회원 탈퇴) |
| 페이즈 | Phase 6 |
| FR | FR-093, FR-094 |

**모바일 변경점**: 확인 문구 입력(`전체삭제` / `탈퇴`)과 비밀번호 입력이 들어가는 파괴적 액션이라 **다이얼로그가 아니라 전용 화면**으로 만든다. 원본의 확인 문구 규칙·경고 카피는 전량 보존한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  계정 및 데이터                  │  ═
├────────────────────────────────────┤
│ 데이터 삭제                        │  section
│ ┌────────────────────────────────┐ │
│ │ ⚠ 내 데이터 전체 삭제          │ │  bg#FEFAFA b#FECACA
│ │ 저장한 명함, 티켓, 포스터,     │ │  body
│ │ 영수증과 검색 기록이 삭제됩니다.│ │
│ │ 구글 캘린더 연동 자체는 유지됩 │ │
│ │ 니다.                          │ │
│ │ ┌────────────────────────────┐ │ │
│ │ │       전체 삭제            │ │ │  danger
│ │ └────────────────────────────┘ │ │
│ └────────────────────────────────┘ │
│                                    │
│ 회원 탈퇴                          │  section
│ ┌────────────────────────────────┐ │
│ │ ⚠ 정말 탈퇴하시겠어요?         │ │
│ │ 이 작업은 되돌릴 수 없습니다.  │ │
│ │ 저장된 계정과 서비스 데이터가  │ │
│ │ 삭제됩니다.                    │ │
│ │ ┌────────────────────────────┐ │ │
│ │ │        회원 탈퇴           │ │ │  danger
│ │ └────────────────────────────┘ │ │
│ └────────────────────────────────┘ │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**확인 시트 — 데이터 전체 삭제 (원문 보존)**
```
│              ▬▬▬▬                  │
│         ⚠  48dp #FEE2E2            │
│  내 데이터 전체를 삭제할까요?      │  h3 center
│  저장한 명함, 티켓, 포스터,        │  body center
│  영수증과 검색 기록이 삭제됩니다.  │
│  구글 캘린더 연동 자체는 유지됩니다.│
│                                    │
│ 확인 문구                          │  caption
│ ┌────────────────────────────────┐ │
│ │ 전체삭제                       │ │  placeholder
│ └────────────────────────────────┘ │
│ 계속하려면 "전체삭제"를 정확히      │  caption
│ 입력하세요.                        │
│ ┌───────────┐ ┌──────────────────┐ │
│ │   취소    │ │    전체 삭제     │ │  danger, 문구 일치 시만 활성
│ └───────────┘ └──────────────────┘ │
```

**확인 시트 — 회원 탈퇴 (원문 보존)**

| 계정 유형 | 본문 | 요구 입력 | 확인 버튼 |
|---|---|---|---|
| 로컬 | `이 작업은 되돌릴 수 없습니다. 계속하려면 계정 비밀번호를 입력하세요.` | 필드 `비밀번호`, placeholder `••••••••` | `탈퇴` |
| 소셜 | `이 작업은 되돌릴 수 없습니다. 저장된 계정과 서비스 데이터가 삭제됩니다.` | 확인 문구 `탈퇴` 입력 | `탈퇴` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 두 위험 카드 | 위 카피 |
| 로딩 | 확인 버튼 스피너, 시트 dismiss 차단 | `삭제 중...` |
| 성공(데이터) | 시트 닫힘 + 토스트 + 전 쿼리 무효화 | `` `저장 문서 {n}건을 삭제했습니다.` `` (원문. `n = deletedBusinessCards + deletedTickets + deletedPosters + deletedReceipts`) |
| 성공(탈퇴) | 토큰·캐시 전량 파기 → SCR-02로 replace + 토스트 | `회원 탈퇴가 완료되었습니다.` (원문) |
| 빈 | 확인 문구 미입력 시 버튼 disabled | — |
| 에러(데이터) | 시트 하단 캡션 | `내 데이터 삭제에 실패했습니다.` (원문) |
| 에러(탈퇴) | 시트 하단 캡션 | `회원 탈퇴에 실패했습니다.` (원문) |
| 에러(비밀번호 오류) | 필드 danger | `비밀번호가 올바르지 않습니다.` |
| 오프라인 | 배너 + 두 버튼 disabled | 공통 |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| `전체 삭제` 탭 | 확인 시트 오픈 | Warning 햅틱 | — |
| 확인 문구 입력 | 정확히 `전체삭제`일 때만 버튼 활성 | — | — |
| 시트 `전체 삭제` | API-62 `DELETE /api/me/documents` | 버튼 로딩 → 성공 시 시트 닫힘 + Success 햅틱 | 캡션 |
| `회원 탈퇴` 탭 | 확인 시트 (계정 유형별 분기) | Warning 햅틱 | — |
| 시트 `탈퇴` | API-06 `DELETE /auth/me` | 로딩 | 캡션 |
| 탈퇴 성공 | SecureStore 3키(`mora_token`,`mora_user`,`mora_settings_prefs`) 파기 + AsyncStorage 초기화 → SCR-02 | — | — |

**데이터**

| API | 시점 | 요청 | 응답 |
|---|---|---|---|
| API-62 `DELETE /api/me/documents` | 데이터 삭제 | — | `{ deletedBusinessCards, deletedTickets, deletedPosters, deletedReceipts, deletedSearchHistories, deletedGoogleCalendarMappings, deletedNotifications }` |
| API-06 `DELETE /auth/me` | 탈퇴 | 로컬: `{ password }` / 소셜: `{}` (바디 `required=false`) | `null` — **`data` 키 자체가 없다**(`@JsonInclude(NON_NULL)`). `success`만 확인 |

---

## SCR-29 · 알림 설정

| 항목 | 값 |
|---|---|
| 라우트 | `app/settings/notifications.tsx` (스택 push) |
| 진입 | SCR-25 `알림 설정` |
| 인증 | 필요 |
| 원본 | `settings/page.tsx` `[알림 설정]` 섹션 (토글 3종, **localStorage 저장만**) |
| 페이즈 | Phase 6 |
| FR | FR-089 |

**모바일 변경점 / 신설 근거**
1. 원본 토글 3종(`OCR 처리 완료`/`일정 등록`/`데이터 동기화`)은 **서버에 저장되지 않고 실제 알림과도 무관**했다. 반면 `NotificationSettingController`(API-39/40)는 완성돼 있는데 아무도 안 쓴다 → **서버 스키마에 맞춰 재구성**한다.
2. 서버 스키마는 3필드다: `deadlineReminderDays`(int, 기본 3) / `deadlineReminderEnabled`(bool) / `scheduleReminderEnabled`(bool). 원본 UI 3토글과 **의미가 다르므로 카피를 새로 쓴다**.
3. **`deadlineReminderDays`의 정확한 의미**를 UI에 반영해야 한다 — "며칠 전에 알릴지"가 아니라 **"며칠 앞까지 훑을지"의 윈도우**이고, 윈도우 내 첫 배치에서 **1회만** 생성된다(5-튜플 유니크). 반복 알림이 아니다.
4. OS 푸시 권한: 현재 백엔드에 FCM/APNs 토큰 저장소가 없어 **실제 푸시는 불가**하다. **결정: 이 화면은 "인앱 알림"만 다루고, OS 푸시 권한은 요청하지 않는다.** 잘못된 기대를 만들지 않도록 안내 문구를 넣는다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  알림 설정                       │  ═
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ ℹ 알림은 앱 안에서 확인할 수   │ │  bg#EFF6FF c#2563EB
│ │ 있습니다. 기기 푸시 알림은     │ │  caption
│ │ 준비 중입니다.                 │ │
│ └────────────────────────────────┘ │
│                                    │
│ 알림 종류                          │  section
│ ┌────────────────────────────────┐ │
│ │ 마감 임박 알림           [◉ ] │ │  h64
│ │ 포스터 행사 마감이 다가오면    │ │  caption
│ │ 알려드립니다.                  │ │
│ ├────────────────────────────────┤ │
│ │ 일정 임박 알림           [◉ ] │ │
│ │ 티켓 출발일이 다가오면         │ │
│ │ 알려드립니다.                  │ │
│ └────────────────────────────────┘ │
│                                    │
│ 알림 시점                          │  section
│ ┌────────────────────────────────┐ │
│ │ 며칠 전부터 알림 받기          │ │
│ │  1일  [3일]  5일  7일  14일    │ │  Segmented 가로 스크롤
│ │ 마감 3일 전부터 알림을 받습니다.│ │  caption
│ └────────────────────────────────┘ │
│ 알림은 매일 오전 9시에 확인합니다.  │  caption #94A3B8
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**필드 매핑**

| UI | 서버 필드 | 기본값 |
|---|---|---|
| `마감 임박 알림` | `deadlineReminderEnabled` | `true` |
| `일정 임박 알림` | `scheduleReminderEnabled` | `true` |
| `며칠 전부터 알림 받기` | `deadlineReminderDays` | `3` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 서버 설정 로드 후 반영 | 안내 `알림은 앱 안에서 확인할 수 있습니다. 기기 푸시 알림은 준비 중입니다.` |
| 로딩 | 토글 자리 스켈레톤 | — |
| 성공 | 토글 반영 | 하단 `알림은 매일 오전 9시에 확인합니다.` |
| 빈 | 서버에 설정 row가 없으면 기본값(서버가 자동 생성) | — |
| 에러(조회) | 에러 카드 | `알림 설정을 불러오지 못했습니다.` + `다시 시도` |
| 에러(저장) | 토글 원복 + 토스트 | `알림 설정을 저장하지 못했습니다.` |
| 오프라인 | 배너 + 전체 disabled | 공통 |
| 권한거부 | 해당 없음 (OS 권한 미요청) | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 토글 탭 | 낙관적 갱신 → API-40 `PUT` (변경 필드만, 나머지 `null` 허용) | 토글 슬라이드 150ms + selection 햅틱 | 원복 + 토스트 |
| 일수 세그먼트 탭 | 낙관적 갱신 → API-40 | 하단 설명 문구 갱신 + selection | 원복 + 토스트 |
| `마감 임박 알림` OFF | 일수 세그먼트 disabled(opacity 0.4) | 200ms fade | — |

**데이터**

| API | 시점 | 요청 | 캐시 |
|---|---|---|---|
| API-39 `GET /api/notification-settings` | 진입 | — | `['notifSettings']`, staleTime 10분 |
| API-40 `PUT /api/notification-settings` | 변경 시 | `{ deadlineReminderDays?, deadlineReminderEnabled?, scheduleReminderEnabled? }` — 전부 래퍼 타입이라 **부분 업데이트 가능** | mutation + setQueryData |

---

## SCR-30 · 약관 / 개인정보 처리방침 / 라이선스

| 항목 | 값 |
|---|---|
| 라우트 | `app/settings/legal/[doc].tsx` — `doc` ∈ `terms` \| `privacy` \| `licenses` |
| 진입 | SCR-25 지원 섹션, SCR-04 가입 화면 하단 링크 |
| 인증 | 불필요 (심사 도구가 비로그인으로 접근할 수 있어야 한다) |
| 원본 | `settings/page.tsx` — **onClick이 비어 있는 미구현 행** (`{/* TODO: navigate to terms */}`) |
| 페이즈 | Phase 7 |
| FR | FR-097, FR-098 |

**신설 근거**: Google Play / App Store 심사 필수 항목이다. 원본에는 행만 있고 화면이 없었다. **결정: 원격 웹뷰가 아니라 앱 번들에 동봉한 Markdown을 렌더**한다 — ① 오프라인에서도 열려야 하고 ② CSP·네트워크 실패에 영향받지 않아야 하며 ③ 심사 시점의 문서가 고정돼야 한다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  이용약관                        │  ═
├────────────────────────────────────┤
│ 시행일 2026년 7월 27일             │ ┈ caption #94A3B8
│                                    │
│ 제1조 (목적)                       │  h3
│ 본 약관은 …                        │  body lh22
│                                    │
│ 제2조 (정의)                       │
│ …                                  │
│                                    │
│          (스크롤)                  │ ┈
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

**문서별 타이틀·내용 소스**

| `doc` | 헤더 타이틀 | 소스 | 비고 |
|---|---|---|---|
| `terms` | `이용약관` | `assets/legal/terms.ko.md` | 법무 검토 필요 — Phase 7 착수 전 확정 |
| `privacy` | `개인정보 처리방침` | `assets/legal/privacy.ko.md` | **필수 고지 항목**: 수집 항목(이메일·닉네임·업로드 이미지·OCR 텍스트), 제3자 처리(OpenAI 임베딩 `text-embedding-ada-002` / `gpt-4o-mini`, Google Calendar), 보관 기간, 삭제 방법(SCR-28) |
| `licenses` | `오픈소스 라이선스` | 빌드 시 생성(`npx license-checker --json`) | 하단에 `© 2026 MORA. All rights reserved.` + GitHub 링크 `https://github.com/lavermeanyou/OCR_FOR_MORA` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 문서 렌더 | 상단 `시행일 {날짜}` |
| 로딩 | 스켈레톤 텍스트 6줄 (번들 파싱 순간) | — |
| 성공 | 전체 렌더 | — |
| 빈 | 해당 없음 (번들 동봉) | — |
| 에러 | 중앙 에러 블록 + 외부 링크 폴백 | `문서를 불러오지 못했습니다.` / 버튼 `웹에서 보기` |
| 오프라인 | 정상 동작 | — |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| 링크 탭 | `WebBrowser.openBrowserAsync` | — | 토스트 `링크를 열 수 없습니다.` |
| 텍스트 선택 | 시스템 복사 메뉴 | — | — |
| 백 | pop | — | — |

**데이터**: API 호출 없음. 번들 에셋만 사용.

---

## SCR-31 · 서버 연결 · 진단 (개발 빌드 전용)

| 항목 | 값 |
|---|---|
| 라우트 | `app/(dev)/diagnostics.tsx` |
| 진입 | **개발·preview 빌드에서만 진입로가 존재한다** (아래 진입점 표). production 빌드에는 **진입로가 하나도 없다** |
| 인증 | 불필요 (토큰 없이도 열려야 한다 — 로그인 자체가 안 되는 상황을 진단하는 화면이다) |
| 원본 | 없음. 웹은 `.env` 빌드타임 상수 2개가 전부였다 |
| 페이즈 | Phase 0 |
| FR | FR-004, FR-006, FR-121, FR-122 |

**왜 필요한가** — APK가 개발 PC의 LAN IP에 붙는 구조라 (1) DHCP로 IP가 바뀌고 (2) 팀원마다 PC IP가 다르다. `.env`를 고쳐 재빌드하는 순환은 EAS 큐 대기(30~60분) 때문에 무너진다. 이 화면 하나로 **같은 APK를 팀원끼리 그대로 공유**할 수 있다. ([[ADR-002 Backend Connectivity]] §2, [[Risks]] RSK-01)

**진입점 (2026-08-05 4차 · 구현 전수 확인)**

| # | 진입점 | 구현 | production 에서는 |
|---|---|---|---|
| 1 | 설정 > 개발 섹션의 **[서버 연결 진단] 행** — **정식 진입점** | `app/(tabs)/settings/index.tsx` (`isDevBuild` 로 감싼 섹션) | 섹션 자체가 렌더되지 않음 |
| 2 | 로그인 화면 하단의 **[서버 연결 진단] 링크** | `src/components/auth/AuthScreen.tsx` | 렌더되지 않음 |
| 3 | 스캔 실패 시트의 **`서버 주소 확인`** 액션 (SCF-06 / SCF-09 업스트림 4xx) | `app/scan/analyzing.tsx` (`DIAGNOSTICS_AVAILABLE`) | 버튼이 그려지지 않음 |
| 4 | 설정 > 앱 정보의 **버전 라벨 5회 탭**(이스터에그) | `app/(tabs)/settings/index.tsx` `tapVersion()` | **아무 일도 일어나지 않는다** — 탭 카운트조차 세지 않음 |

**노출 규칙 (결정 · 구현 일치 확인됨)** — 판정 기준은 **`variant === 'production'`** 이다 (`src/config/env.ts` ← `app.config.js` 의 `extra.variant`).
- **`__DEV__` 가 아니다.** 릴리스로 빌드한 preview APK 는 `__DEV__ === false` 지만 팀 내부 테스트용이라 진단 화면이 **있어야** 한다. 막아야 하는 것은 스토어에 올라가는 production 프로파일뿐이다.
- 방어는 2단이다: **(1) 위 4개 진입점이 애초에 렌더되지 않는다**(1차 방어), **(2) `app/(dev)/_layout.tsx` 가 딥링크(`mora://(dev)/diagnostics`) 같은 미지의 경로를 받아 낸다**(심층 방어). 2번은 `Redirect`(=`router.replace`)가 현재 스택 엔트리를 지워 스캔 진행 상태를 날리므로, 되돌아갈 곳이 있으면 `back` 으로 물러난다.

> **2026-08-05 4차 정정 — 종전 서술 두 곳이 코드와 달랐다.**
> · **진입 행**: "SCR-25 설정 > 앱 정보의 **버전 라벨 5회 탭**" 이 대표 진입로처럼 적혀 있었다. production 에서는 `tapVersion()` 이 **첫 줄에서 즉시 return** 한다(`app/(tabs)/settings/index.tsx`). 종전 구현은 5회 탭이 그대로 `router.push('/(dev)/diagnostics')` 를 불러서, 스토어 사용자가 버전 라벨을 다섯 번 누르면 `(dev)` 레이아웃 가드에 튕겨 **홈으로 나가졌다** — "설정을 눌렀는데 홈으로 나가진다"는 버그로 읽히는 거짓 신호였다. 이제 카운트도 세지 않는다(세어 봤자 도달할 곳이 없고, 햅틱만 울리면 그것도 거짓 신호다). 그리고 실제 정식 진입점은 이스터에그가 아니라 **설정의 [서버 연결 진단] 행**이다.
> · **노출 규칙**: `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE` 라는 환경변수는 **이 레포에 존재하지 않는다** (`src/`·`app/`·`app.config.js` 전체 0건). 판정은 `variant` 하나다. 존재하지 않는 스위치를 "이걸 켜면 열린다"로 적어 두면, 릴리스 빌드에서 진단 화면을 여는 방법을 찾는 사람이 있지도 않은 값을 뒤지게 된다.
> · 종전에 적힌 "**부트 실패 시 SCR-01 에러 카드의 `서버 주소 확인` 버튼**" 도 정확하지 않았다. 실제 로그인 화면 진입로는 에러 카드 안이 아니라 **화면 하단의 상시 링크**이며, 부트 실패 여부와 무관하게 개발 빌드면 항상 보인다. 이유는 교착 회피다 — 주소가 틀리면 막히는 지점이 로그인인데, 진단 화면이 설정 탭에만 있으면 "고치려면 로그인해야 하고 로그인하려면 고쳐야 하는" 상태가 된다.

**와이어프레임**
```
┌────────────────────────────────────┐
│▓▓ safe-top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ‹  서버 연결                        │  ═ 헤더 56
├────────────────────────────────────┤
│ ⚠ 개발 빌드 전용 화면입니다.        │  bg-warn-soft / text-warn
│                                    │
│ API 서버 (Spring · 데이터)          │  label / textMuted
│ ┌──────────────────────────────┐   │
│ │ http://192.168.0.10:8080     │   │  h56 r14 · keyboardType=url
│ └──────────────────────────────┘   │
│                                    │
│ 이미지 서버 (OCR · 업로드/이미지)    │
│ ┌──────────────────────────────┐   │
│ │ http://192.168.0.10:8000     │   │
│ └──────────────────────────────┘   │
│                                    │
│ API 프로브 인증        [ OFF ]     │  Switch (오버라이드일 때만 의미)
│                                    │
│ ⚠ 입력한 주소는 아직 저장되지 않음   │  미저장 배너 (입력 ≠ 저장값일 때)
│                                    │
│ ┌──────────────────────────────┐   │
│ │   연결 확인 (저장하지 않음)   │   │  Button primary
│ └──────────────────────────────┘   │
│  주소 저장          초기화          │  secondary / ghost
│                                    │
│ ⓘ 새 주소를 저장하고 로그인 세션을   │  저장/초기화 결과 알림
│   파기했습니다.                     │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ✓ OCR   MORA OCR v3.0          │ │  결과 카드
│ │         · 서버 추론 212ms       │ │
│ │ ◐ API   도달만 확인 (인증 없음) │ │  'reachable' = 초록도 빨강도 아님
│ │ ✗ OCR   OCR 불가 (추론 실패)    │ │  실패 시 text-danger
│ └────────────────────────────────┘ │
│▓▓ safe-bottom ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
└────────────────────────────────────┘
```

> **이 화면은 production 빌드에서 열리지 않는다.** `app/(dev)/_layout.tsx` 가 진입을 막고,
> `settings/index.tsx` 의 버전 라벨 탭 카운트도 production 에서는 세지 않는다.
> 스캔 실패 화면(SCR-11)의 `서버 주소 확인` 액션도 production 에서는 렌더되지 않는다 —
> **진입점을 노출한 뒤 리다이렉트로 막으면 진행 중이던 스캔 작업이 소실된다.**

**구성 요소**

| 영역 | 요소 | CMP | 스펙 |
|---|---|---|---|
| 상단 | 개발 전용 경고 배너 | CMP-15 | `bg-warn-soft` / `text-warn`, 고정 |
| 정보 | 빌드 변형 / Expo SDK / 네트워크 / 주소 오버라이드 | CMP-27 | 읽기 전용 행 |
| 폼 | API base URL 입력 | CMP-03 | `keyboardType="url"`, `autoCapitalize="none"`, `http://` 스킴 필수. 라벨 아래 **출처**(`override` / `env` / `fallback`) 표시 |
| 폼 | OCR base URL 입력 | CMP-03 | 동일 |
| 폼 | `API 프로브 인증` 스위치 | CMP-03 | 직접 입력한 오버라이드 주소에 JWT 를 붙일지. 기본 OFF |
| 배너 | 미저장 안내 | CMP-15 | 입력값 ≠ 저장값일 때. `[연결 확인] 은 언제나 지금 저장된 주소를 잽니다` |
| 액션 | `연결 확인 (저장하지 않음)` | CMP-01 | primary. **아무것도 쓰지 않는다.** 두 프로브 병렬 |
| 액션 | `주소 저장` | CMP-01 | 확인 다이얼로그 → 저장. API 주소가 바뀌면 **세션 파기** |
| 액션 | `초기화` | CMP-01(ghost) | 오버라이드 삭제 → 빌드 기본값. 같은 규칙(주소 교체이므로 세션 파기) |
| 알림 | 저장/초기화 결과 | CMP-15 | **저장이 일어나지 않은 경우까지 반드시 문장으로 남긴다** |
| 결과 | 프로브 결과 2행 | CMP-15 / CMP-27 | `✓ ok` / `◐ reachable` / `✗ degraded·unreachable·timeout·stale-server·wrong-server` |

**상태**

| 상태 | 표현 | 정확한 문구 |
|---|---|---|
| 초기 | 저장된 오버라이드 값(없으면 `.env` 값)이 입력칸에 채워져 있음 | — |
| 로딩 | `연결 테스트` 버튼 스피너, 결과 카드 자리 스켈레톤 2행 | `확인 중...` |
| 성공 | 두 행 모두 `✓` | `MORA OCR Service v3.0` / `Spring 응답 확인 (HTTP 401)` |
| 빈 | 아직 테스트하지 않음 | `연결 테스트를 눌러 두 서버 도달 여부를 확인하세요.` |
| 에러(OCR) | 해당 행 `✗` | `OCR 서버(:8000)에 닿지 않습니다. 방화벽 8000 포트를 확인하세요.` |
| 에러(API) | 해당 행 `✗` | `백엔드 서버에 연결할 수 없습니다.` |
| 에러(형식) | 입력칸 보더 danger | `http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.` |
| 오프라인 | G-5 배너 + 테스트 버튼 비활성 | `오프라인입니다. 네트워크 연결을 확인해 주세요.` |
| 권한거부 | 해당 없음 | — |

**인터랙션**

| 트리거 | 동작 | 피드백 | 실패 시 |
|---|---|---|---|
| URL 입력 | **아무것도 저장하지 않는다.** 인증 옵트인을 끄고 직전 저장 알림을 지운다 | 미저장 배너 표시 | 형식 오류 문구 |
| `연결 확인` 탭 | **쓰기 없음.** 지금 저장된 주소로 `GET {OCR}/health` + `GET {API}/auth/me` 병렬 | 버튼 스피너 | 행별 상태 아이콘 + 사유 |
| `주소 저장` 탭 | 확인 다이얼로그 → **세션 파기(API 주소가 바뀌는 경우)** → MMKV 저장 | Alert → 결과 알림 문장 | 입력이 불완전하면 저장하지 않고 그 사실을 문장으로 알림 |
| `초기화` 탭 | 확인 다이얼로그 → 세션 파기(같은 규칙) → 오버라이드 키 삭제 | Alert → 결과 알림 문장 | — |
| 백 | pop → SCR-25 | — | — |

**데이터**

| API | 시점 | 타임아웃 | 캐시 |
|---|---|---|---|
| `GET {OCR}/health` | `연결 확인` | 60s | 서버가 30초(성공)/5초(실패) 캐시. 앱은 `cached` 를 읽어 표시 |
| `GET {OCR}/` | 위가 404 일 때만 (구버전 배포 폴백) | 60s | 이 경우 판정은 `ok` 가 아니라 **`stale-server`** — 추론 상태를 확인하지 못했다는 뜻 |
| `GET {API}/auth/me` | `연결 확인` | 60s | 캐시 안 함 |
| (로컬) MMKV `server.apiUrl` / `server.ocrUrl` | `주소 저장` / `초기화` | — | 영구. 토큰이 아니므로 SecureStore 아님 |

> **타임아웃이 3s 가 아니라 60s 인 이유**: Cloud Run 콜드스타트가 실측 18~33초이고 `/health` 는 그 위에
> 셀프테스트 추론을 한 번 더 태운다. 3s 로 두면 **정상 서버를 죽었다고 표시한다.**

**보안 불변식** — 아래는 실제 유출 사고를 막기 위해 도입한 것이다. 스펙을 고칠 때 함께 지켜라.

1. **`연결 확인` 은 절대 저장하지 않는다.** 종전 구현은 프로브 직전에 입력값을 영구 저장했고, 그래서
   "확인만 해 보자" 가 앱의 서버 주소를 바꿔 버렸다. 그 뒤 모든 인증 요청(`services/http.ts`,
   `features/scan/api.ts`)이 **유효한 JWT 를 그 호스트로** 실어 보냈다.
2. **API 주소를 바꾸는 저장·초기화는 세션을 파기한다.** 다른 서버를 가리키게 됐으니 기존 토큰은
   어차피 그 서버에서 무효다 — 보안과 정합성이 같은 방향이다. 저장 전에 로그아웃됨을 명시적으로 알린다.
3. **직접 입력한 오버라이드 주소에는 기본적으로 JWT 를 붙이지 않는다.** 붙이려면 사용자가 스위치를
   켜야 하고, 화면은 매 프로브의 인증 포함 여부를 문장으로 표시한다.
4. **401 을 성공으로 치지 않는다.** 무인증 `GET /auth/me` 의 401 은 프로세스가 떴다는 것만 증명하고
   DB(Cloud SQL)를 거치지 않는다. 그 상태는 `ok` 가 아니라 **`reachable`** 이다 —
   Cloud SQL 이 죽어 모든 저장이 실패하는 상황에서 진단 화면이 초록불을 내던 것이 이 판정 때문이었다.

**금지 사항** — 이 화면은 토큰·이메일을 절대 표시하지 않는다. `/auth/me` 프로브는 **HTTP status만** 읽고 응답 바디를 렌더하지 않는다 (NFR-015).

---

## 부록 A · 화면 ↔ API 매트릭스

| 화면 | 사용 API |
|---|---|
| SCR-01 | API-03 |
| SCR-02 | (없음) |
| SCR-03 | API-02, API-07/09/11 |
| SCR-04 | API-01, API-07/09/11 |
| SCR-05 | API-08/10/12, API-03 |
| SCR-06 | API-24, API-33, API-64 |
| SCR-07 | API-57, API-43 |
| SCR-08 | API-32, API-35, API-36, API-37 |
| SCR-09 | (없음) |
| SCR-10 | (없음) |
| SCR-11 | API-41 |
| SCR-12 | API-63, API-13/42/48/56 |
| SCR-13 | (없음) |
| SCR-14 | API-14, API-57, API-43, API-49 |
| SCR-15 | API-20, API-14, API-18, API-17 |
| SCR-16 | API-57, API-60 |
| SCR-17 | API-43, API-46 |
| SCR-18 | API-49, API-53 |
| SCR-19 | API-15/58/44/50, API-17/60/46/53, API-18 |
| SCR-20 | API-16/59/45/51 |
| SCR-21 | API-64 |
| SCR-22 | API-20, API-21, API-22, API-23 |
| SCR-23 | API-19, API-61, API-47, API-52, API-54, API-55 |
| SCR-24 | API-31 |
| SCR-25 | API-03, API-24, API-27, API-25, API-29, API-55 |
| SCR-26 | API-04 |
| SCR-27 | API-05 |
| SCR-28 | API-62, API-06 |
| SCR-29 | API-39, API-40 |
| SCR-30 | (없음) |
| SCR-31 | API-65, API-03 (연결 프로브 전용, status만 읽음) |

**미사용 엔드포인트 (모바일에서도 호출하지 않음)**

| API | 이유 |
|---|---|
| API-26 `GET /api/google-calendar/callback` | 브라우저 착지점(302). 앱은 딥링크로 가로챈다 |
| API-28 `GET /api/google-calendar/tokens/{userId}` | 토큰 메타(구글 이메일·scope·만료)를 표시할 화면이 없다. **인증 검사가 없어 노출 위험만 크다** |
| API-30 `GET /api/google-calendar/month` | 앱 캘린더는 MORA 문서 기반. 구글 이벤트 병합은 범위 밖 |
| API-34 `POST /api/notifications` | 수동 알림 생성은 클라이언트가 할 일이 아니다 |
| API-38 `DELETE /api/notifications` | 전체 삭제 UI를 두지 않는다(개별 스와이프로 충분, 오조작 위험) |

## 부록 B · 원본 버그 → 모바일 처리 대장

| # | 원본 버그 | 처리 화면 | 처리 |
|---|---|---|---|
| 1 | 검색 화면 RECEIPT 분기 누락 → 영수증 검색 항상 0건 | SCR-23 | API-52 연결로 수정 |
| 2 | 검색 화면 RECEIPT 편집 저장 미완성(API 미호출, `isSaving` 영구 true) | SCR-20 | API-51 연결로 수정 |
| 3 | 영수증 보관함 전체 목업 | SCR-18 | API-49 연결. 수입/지출·예산은 서버 근거 없어 제거 |
| 4 | 명함 화면 `명함 관리` 버튼 무동작 | SCR-15 | 버튼 폐기, 기능은 SCR-22가 흡수 |
| 5 | 헤더 알림 벨 무동작 | SCR-06/08 | SCR-08 신설로 구현 |
| 6 | 대시보드 마감 카드 `cursor:pointer`인데 onClick 없음 | SCR-06 | SCR-19 상세 연결 |
| 7 | 이용약관·개인정보 처리방침 미구현 | SCR-30 | 신설 |
| 8 | 설정 stats 하드코딩(`12`,`1/2`,`6분 전`), 앱 버전 하드코딩 | SCR-25 | 실 데이터 1개만 남기고 제거 |
| 9 | 설정 기본값에 실제 사용자 정보 하드코딩(`leechoeun`, `mvp6276@gmail.com`) | SCR-25 | 제거 |
| 10 | 아바타가 서버 미전송(localStorage base64) | SCR-25/26 | 기능 제거 |
| 11 | 업로드 `최대 20MB` vs 서버 10MB 불일치 | SCR-09/10 | `최대 10MB`로 수정 + 클라 리사이즈 |
| 12 | 라벨 불일치 `전체 명함` vs `전체명함` | SCR-15 | `전체 명함` 통일 |
| 13 | 라벨 불일치 포스터 `주최자/시작일/종료일` vs `주최/행사 시작일/행사 종료일` | SCR-17/19/20 | `주최자/행사 시작일/행사 종료일` 통일 |
| 14 | Nav 앵커 `#features` ↔ 실제 `id="feature"` 불일치 | — | 랜딩 폐기로 소멸 |
| 15 | Nav 앵커 링크 색상이 흰 배경에서 안 보임 | — | 랜딩 폐기로 소멸 |
| 16 | 알림 메시지 `…남았습니다입니다.` 이중 어미 | SCR-08 | 표시 직전 문자열 치환 |
| 17 | 삭제 실패 시 피드백 전무(티켓) | SCR-16 | 토스트 + 롤백 |
| 18 | 데이터 페치 실패를 조용히 빈 배열로 처리(대시보드) | SCR-06 | 에러 상태 + 재시도 |
| 19 | bbox 스케일 기준이 화면마다 다름(`imageSize` vs `naturalWidth`) | SCR-21 | `image_size` 우선으로 통일 |
| 20 | 챗봇 `postMessage` 수신부 부재(죽은 경로) | SCR-05 | 경로 자체를 사용하지 않음 |

## 부록 C · 상태 문구 색인 (신규 정의분)

원본에 대응 문구가 없어 이 문서에서 새로 정한 카피만 모았다. [[Conventions]]의 문체 규칙(존댓말 + 마침표, 사용자 책임 전가 금지)을 따른다.

| 맥락 | 문구 |
|---|---|
| 오프라인 공통 | `오프라인입니다. 네트워크 연결을 확인해 주세요.` |
| 오프라인(캐시 표시) | `오프라인입니다. 저장된 정보를 표시합니다.` |
| 오프라인(쓰기 차단) | `오프라인입니다. 연결되면 저장할 수 있어요.` |
| 부트 실패 | `앱을 시작할 수 없습니다.` / `잠시 후 다시 시도해 주세요.` |
| 카메라 권한 | `카메라 권한이 필요합니다.` / `설정에서 카메라 접근을 허용하면 문서를 촬영할 수 있어요.` |
| 사진 권한 | `사진 접근 권한이 필요합니다.` / `설정에서 사진 접근을 허용해 주세요.` |
| 연락처 권한 | `연락처 접근 권한이 필요합니다.` |
| 사진 저장 권한 | `사진 저장 권한이 필요합니다.` |
| 용량 초과 | `이미지 용량이 너무 큽니다.` / `10MB 이하 이미지만 업로드할 수 있어요. 화질을 낮춰 다시 시도합니다.` |
| 분석 타임아웃 | `분석이 너무 오래 걸립니다.` / `네트워크 상태를 확인하고 다시 시도해 주세요.` |
| 인식 실패 | `문서를 인식하지 못했습니다.` |
| 추출 0건 | `인식된 정보가 없습니다.` / `직접 입력하거나 다시 촬영해 주세요.` |
| 보관함 빈 상태 | `보관함이 비어 있습니다` / `문서를 스캔하면 여기에 정리됩니다.` |
| 홈 빈 상태 | `아직 저장된 문서가 없어요` / `첫 문서를 스캔하고 MORA를 시작해 보세요.` |
| 알림 빈 상태 | `알림이 없습니다` / `마감이 다가오면 알려드릴게요.` |
| 명함첩 빈 상태 | `명함첩이 없습니다.` / `명함첩을 만들어 명함을 분류해 보세요.` |
| 이탈 확인(스캔) | `저장하지 않고 나갈까요?` / `입력한 내용이 사라집니다.` |
| 이탈 확인(편집) | `변경 사항을 저장하지 않고 나갈까요?` / `수정한 내용이 사라집니다.` |
| 복사 완료 | `복사했습니다.` |
| 수정 완료 | `수정했습니다.` |
| 삭제 완료 | `{유형}을(를) 삭제했습니다.` |
| 삭제 실패 | `삭제에 실패했습니다.` |
| 새로고침 실패 | `새로고침에 실패했습니다.` |
| 알림 푸시 안내 | `알림은 앱 안에서 확인할 수 있습니다. 기기 푸시 알림은 준비 중입니다.` |
| 429 | `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.` |
| 테마 `시스템 따름` (SCR-25) | `시스템 설정을 따릅니다.` / 2행 `지금은 라이트입니다.` · `지금은 다크입니다.` (OS 해석 결과로 실시간 갱신) |
| 테마 세그먼트 라벨 (SCR-25) | `시스템 따름` · `라이트` · `다크` |
| `전체` 검색 부분 실패 (SCR-23) | `` `{유형} 검색에 실패했습니다.` `` — 실패 유형 2개 이상이면 `` `{유형}, {유형} 검색에 실패했습니다.` `` |
| `전체` 검색 결과 헤더 (SCR-23) | `` `전체 {n}건` `` (유형별은 `` `{유형} {n}건` ``) |

