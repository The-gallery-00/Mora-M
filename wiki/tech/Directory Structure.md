# Directory Structure

MORA 모바일 앱의 폴더 트리, 폴더별 책임과 반입 금지 목록, 파일 네이밍 규칙, `@/` 별칭 설정, 배럴 파일 정책.

상위: [[Home]]
관련: [[Architecture]] · [[Tech Stack]] · [[Conventions]] · [[Navigation Map]] · [[Component Library]] · [[Screen Specs]]

---

## 1. 전체 트리

라우트 파일 목록의 정본은 [[Navigation Map]]이다. 아래 `app/` 트리는 그 목록과 1:1로 대응한다.

```
mora-mobile/
├─ app/                                # L1 라우트 (expo-router). 화면 조립만.
│  ├─ _layout.tsx                      # 루트: Provider 스택, 폰트 로드, 스플래시 제어, 세션 부트스트랩
│  ├─ +not-found.tsx                   # 존재하지 않는 딥링크 폴백
│  ├─ index.tsx                        # SCR-01 스플래시 / 세션 부트 (분기 전용)
│  ├─ (onboarding)/
│  │  └─ index.tsx                     # SCR-02 온보딩 4장 페이저
│  ├─ (auth)/
│  │  ├─ _layout.tsx                   # 인증 스택 (로그인 상태면 (tabs)로 replace)
│  │  ├─ login.tsx                     # SCR-03
│  │  ├─ signup.tsx                    # SCR-04
│  │  └─ callback.tsx                  # SCR-05 OAuth 콜백 브리지
│  ├─ (tabs)/
│  │  ├─ _layout.tsx                   # 탭 4개(홈/보관함/검색/설정) + 중앙 스캔 액션 = 5슬롯
│  │  ├─ index.tsx                     # SCR-06 홈 대시보드
│  │  ├─ archive/
│  │  │  ├─ index.tsx                  # SCR-14 보관함 허브 (?type= 필터 칩)
│  │  │  ├─ cards.tsx                  # SCR-15
│  │  │  ├─ tickets.tsx                # SCR-16
│  │  │  ├─ posters.tsx                # SCR-17
│  │  │  └─ receipts.tsx               # SCR-18
│  │  ├─ scan.tsx                      # 플레이스홀더 (tabPress 가로채 /scan push)
│  │  ├─ search.tsx                    # SCR-23 검색
│  │  └─ settings/
│  │     └─ index.tsx                  # SCR-25 설정
│  ├─ scan/                            # fullScreenModal 스택
│  │  ├─ _layout.tsx
│  │  ├─ index.tsx                     # SCR-09 카메라/앨범
│  │  ├─ crop.tsx                      # SCR-10 크롭·회전
│  │  ├─ analyzing.tsx                 # SCR-11 업로드·분석 진행
│  │  ├─ review.tsx                    # SCR-12 분류 결과 + 필드 편집 + 저장
│  │  └─ done.tsx                      # SCR-13 저장 완료 (연속 스캔)
│  ├─ doc/
│  │  └─ [type]/
│  │     ├─ [id].tsx                   # SCR-19 문서 상세
│  │     └─ [id]/edit.tsx              # SCR-20 문서 편집
│  ├─ settings/
│  │  ├─ profile.tsx                   # SCR-26 닉네임 변경
│  │  ├─ password.tsx                  # SCR-27 비밀번호 변경
│  │  ├─ danger.tsx                    # SCR-28 회원 탈퇴 / 데이터 전체 삭제
│  │  ├─ notifications.tsx             # SCR-29 알림 설정
│  │  └─ legal/[doc].tsx               # SCR-30 약관/개인정보/라이선스/앱정보
│  ├─ (dev)/
│  │  └─ diagnostics.tsx               # SCR-31 서버 연결·진단 (개발 빌드 전용)
│  ├─ calendar.tsx                     # SCR-07 월간 캘린더
│  ├─ notifications.tsx                # SCR-08 알림 목록 (modal)
│  ├─ groups.tsx                       # SCR-22 명함첩(그룹) 관리
│  ├─ chat.tsx                         # SCR-24 AI 모라냥 (modal)
│  └─ viewer.tsx                       # SCR-21 이미지 뷰어 (transparentModal)
│
├─ src/
│  ├─ components/                      # 도메인 무관 프리미티브 (CMP-## 정본: [[Component Library]])
│  │  ├─ ui/
│  │  │  ├─ Button.tsx
│  │  │  ├─ IconButton.tsx
│  │  │  ├─ TextField.tsx
│  │  │  ├─ Card.tsx
│  │  │  ├─ Chip.tsx
│  │  │  ├─ Badge.tsx
│  │  │  ├─ Avatar.tsx
│  │  │  ├─ Divider.tsx
│  │  │  ├─ Skeleton.tsx
│  │  │  ├─ SegmentedControl.tsx
│  │  │  ├─ ProgressBar.tsx
│  │  │  ├─ Switch.tsx
│  │  │  └─ ListRow.tsx
│  │  ├─ layout/
│  │  │  ├─ Screen.tsx                 # SafeArea + 배경 + 스크롤 정책 래퍼
│  │  │  ├─ AppBar.tsx
│  │  │  ├─ BottomSheet.tsx            # @gorhom/bottom-sheet 프로젝트 표준 래퍼
│  │  │  └─ KeyboardAwareView.tsx
│  │  └─ feedback/
│  │     ├─ ErrorBoundary.tsx
│  │     ├─ ErrorView.tsx
│  │     ├─ EmptyState.tsx
│  │     ├─ OfflineBanner.tsx
│  │     ├─ ToastHost.tsx
│  │     └─ ConfirmDialog.tsx
│  │
│  ├─ features/                        # L2/L3 기능 단위. 아래 §5 예시 참조
│  │  ├─ onboarding/
│  │  ├─ auth/
│  │  ├─ dashboard/
│  │  ├─ scan/
│  │  ├─ storage/
│  │  ├─ search/
│  │  ├─ chat/
│  │  ├─ notifications/
│  │  └─ settings/
│  │
│  ├─ hooks/                           # 도메인 무관 훅만
│  │  ├─ useAppState.ts                # 포그라운드 복귀 감지 (웹의 focus/pageshow 대체)
│  │  ├─ useDebouncedValue.ts
│  │  ├─ useHaptics.ts
│  │  ├─ useOnlineStatus.ts
│  │  ├─ useSafeAreaPadding.ts
│  │  └─ useBackHandler.ts
│  │
│  ├─ lib/                             # L4/L5 서버 통신 인프라. 정본: [[API Contract]] · [[Data Model]]
│  │  ├─ api/
│  │  │  ├─ env.ts                     # EXPO_PUBLIC_* 정규화 + buildUrl + toAbsoluteImageUrl
│  │  │  ├─ client.ts                  # apiFetch: baseURL, Bearer, timeout(AbortController), 재시도
│  │  │  ├─ upload.ts                  # uploadMultipart (XHR, 진행률·취소)
│  │  │  ├─ unwrap.ts                  # unwrapPage / unwrapList / unwrapScan(이중 래핑)
│  │  │  ├─ errors.ts                  # ApiError 종류 + 상태코드 매핑
│  │  │  ├─ session.ts                 # 토큰 getter + 401 브로드캐스트 (순환 import 차단용)
│  │  │  └─ endpoints/
│  │  │     ├─ auth.ts                 # API-01~API-12
│  │  │     ├─ cards.ts                # API-13~API-19
│  │  │     ├─ cardGroups.ts           # API-20~API-23
│  │  │     ├─ dashboard.ts            # API-24
│  │  │     ├─ googleCalendar.ts       # API-25~API-30
│  │  │     ├─ chat.ts                 # API-31
│  │  │     ├─ notifications.ts        # API-32~API-40
│  │  │     ├─ scan.ts                 # API-41 (/api/scan) + API-63 (OCR /api/commit)
│  │  │     ├─ posters.ts              # API-42~API-47
│  │  │     ├─ receipts.ts             # API-48~API-53
│  │  │     ├─ searchHistory.ts        # API-54~API-55
│  │  │     ├─ tickets.ts              # API-56~API-61
│  │  │     └─ userData.ts             # API-62
│  │  ├─ adapters/                     # 와이어 타입 ↔ 도메인 모델 변환 (유일한 변환 지점)
│  │  │  ├─ common.ts                  # 날짜(string|number[]) · 금액 · id 정규화
│  │  │  ├─ card.ts / ticket.ts / poster.ts / receipt.ts
│  │  │  ├─ notification.ts
│  │  │  └─ save.ts                    # snake_case OCR 필드 → 문서 4종 저장 바디
│  │  └─ query/
│  │     ├─ client.ts                  # QueryClient 인스턴스 + 기본 옵션 + MMKV persister
│  │     └─ keys.ts                    # 쿼리 키 팩토리
│  │
│  ├─ services/                        # 기기·OS 기능 어댑터 (네트워크가 아닌 I/O 경계)
│  │  ├─ secureStore.ts                # mora_token / mora_user
│  │  ├─ kv.ts                         # MMKV 인스턴스 + 타입드 접근자
│  │  ├─ imagePipeline.ts              # IMG-01~07: 장변 1280 · q0.85 · EXIF 제거 · 재압축 사다리
│  │  ├─ mediaPicker.ts                # expo-camera / expo-image-picker 통합 진입
│  │  ├─ localNotifications.ts         # expo-notifications 스케줄링
│  │  ├─ linking.ts                    # mora:// 파싱, tel:/mailto:, 앱 설정 열기
│  │  ├─ haptics.ts                    # 프로젝트 표준 햅틱 프리셋
│  │  └─ errors.ts                     # AppError (permission / validation / unsupported)
│  │
│  ├─ store/                           # zustand 전역 클라이언트 상태
│  │  ├─ authStore.ts
│  │  ├─ themeStore.ts
│  │  ├─ toastStore.ts
│  │  └─ scanDraftStore.ts             # 카메라 → 리뷰 두 라우트가 공유하는 스캔 1회분
│  │
│  ├─ constants/
│  │  ├─ tokens.ts                     # 디자인 토큰 원천값 (tailwind preset이 여기서 읽음)
│  │  ├─ documentTypes.ts              # BUSINESS_CARD/TICKET/POSTER/RECEIPT ↔ 한글 라벨 ↔ 색 ↔ 라우트
│  │  ├─ routes.ts                     # 라우트 경로 상수
│  │  ├─ limits.ts                     # IMG-01~07 상수, 요청 종류별 타임아웃 ([[API Contract]] §7)
│  │  └─ copy.ts                       # 재사용 문구 (에러/빈상태/확인 다이얼로그)
│  │
│  ├─ types/
│  │  ├─ api.ts                        # 서버 와이어 타입 (Spring DTO 대응, camelCase)
│  │  ├─ domain.ts                     # 앱 내부 모델 (id 타입 통일, 날짜 정규화 후)
│  │  ├─ ocr.ts                        # /api/scan 응답, snake_case 필드 키
│  │  ├─ navigation.ts                 # 라우트 파라미터 타입
│  │  └─ env.d.ts                      # process.env.EXPO_PUBLIC_* 타입 선언
│  │
│  └─ utils/                           # 순수 함수만 (I/O·React 금지)
│     ├─ date.ts                       # D-Day 계산, MM.DD (요일), 상대 시간 표기
│     ├─ money.ts                      # 원화 포맷, 자릿수 구분
│     ├─ string.ts                     # 제목 접미사 제거 정규식, 이니셜 추출, 하이라이트 분할
│     ├─ mask.ts                       # 로그용 토큰/이메일/전화 마스킹
│     ├─ logger.ts                     # scope 기반 로거 (CV-34~CV-40)
│     ├─ cn.ts                         # className 병합 (clsx + tailwind-merge)
│     └─ guards.ts                     # 타입 가드 모음
│
├─ assets/
│  ├─ fonts/                           # Pretendard-{Regular,Medium,SemiBold,Bold}.otf, PatuaOne-Regular.ttf
│  ├─ images/                          # 스플래시, 온보딩 일러스트, 빈 상태 일러스트
│  └─ icons/                           # 앱 아이콘, 적응형 아이콘, 챗봇 로고, 문서유형 아이콘 4종
│
├─ app.config.js                       # Expo 설정 (스킴 mora, owner, 권한, plugin, extra)
│                                      #   ★ .ts 가 아니다 — eas-cli 가 TS 6 로 트랜스파일하다 죽는다
│                                      #     ([[APK Build]] §2, [[Risks]] RSK-34). 타입 보조는 JSDoc
├─ eas.json                            # development / preview(APK) / production 프로파일
├─ .easignore                          # EAS 업로드 제외 목록 (있으면 .gitignore 대신 이것이 쓰인다)
├─ tailwind.config.js                  # NativeWind preset (tokens.ts를 읽어 확장)
├─ global.css                          # @tailwind 지시자 (NativeWind 4 진입점) — 생성물
├─ metro.config.js                     # withNativeWind
├─ babel.config.js                     # babel-preset-expo + nativewind/babel
├─ nativewind-env.d.ts                 # className prop 타입 확장
├─ tsconfig.json                       # strict + paths
├─ .eslintrc.js / eslint.config.js     # Phase 1에서 추가
├─ .prettierrc                         # Phase 1에서 추가
├─ .env.local                          # EXPO_PUBLIC_* (git 미추적)
└─ .env.example                        # 키 이름만 담은 템플릿 (git 추적)
```

**루트 설정 파일 4개에 대한 주의 (Phase 0 실측)**

| 파일 | 규칙 |
|---|---|
| `app.config.js` | **확장자를 `.ts` 로 바꾸지 않는다.** eas-cli ↔ TypeScript 6 충돌([[Risks]] RSK-34). `projectId` 하드코딩도 의도다 |
| `babel.config.js` | `presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel']`. **`babel-preset-expo` 를 devDependency로 명시**해야 bare name이 해석된다([[Tech Stack]] PKG-42). `react-native-worklets/plugin` 을 직접 넣지 않는다(프리셋이 자동 주입) |
| `global.css` | **생성물이다.** 손으로 고치지 않고 `npm run theme:css` 로만 만든다([[Design Tokens]] §13-0) |
| `.easignore` | **`wiki/` 와 `/android` 를 반드시 제외**한다. 없으면 위키 16k행이 업로드되고, `/android` 가 올라가면 EAS가 원격 prebuild를 하지 않는다([[APK Build]] §1-4) |

---

## 2. 폴더별 책임과 반입 금지 목록

| ID | 폴더 | 책임 | **여기에 두면 안 되는 것** |
|---|---|---|---|
| DIR-01 | `app/` | 라우트 정의, 레이아웃 중첩, 네비게이션 옵션, URL 파라미터 파싱 후 화면에 전달 | 화면 본문 JSX(50줄 넘으면 `features/*/screens`로), API 호출, 폼 상태, 스타일 정의, 재사용 컴포넌트 |
| DIR-02 | `src/components/ui/` | 도메인을 모르는 시각 프리미티브. props로만 동작 | "명함", "영수증" 같은 도메인 단어, API 타입 import, React Query 훅 |
| DIR-03 | `src/components/layout/` | 화면 골격(SafeArea/AppBar/시트/키보드) | 특정 화면 전용 헤더 구성 |
| DIR-04 | `src/components/feedback/` | 에러·빈상태·토스트·오프라인·확인 다이얼로그 | 도메인별 에러 문구(→ `constants/copy.ts`) |
| DIR-05 | `src/features/<f>/screens/` | 한 화면의 전체 조립. 훅 호출 + 섹션 배치 | `fetch`, 다른 feature의 내부 파일 import |
| DIR-06 | `src/features/<f>/components/` | 그 기능에서만 쓰는 UI | 2개 이상 feature가 쓰기 시작하면 즉시 `components/`로 승격 |
| DIR-07 | `src/features/<f>/hooks/` | React Query 훅, 화면 로직 훅 | JSX, 하드코딩 문구 |
| DIR-08 | `src/features/<f>/model/` | 그 기능의 순수 로직: 매퍼, 필드 스키마, 유효성, 슬라이스 | 네트워크 호출, `react` import |
| DIR-09 | `src/hooks/` | **도메인 무관** 훅만 | 도메인 이름이 들어간 훅(`useCards`는 `features/storage/hooks`) |
| DIR-10 | `src/lib/api/` (`client`·`upload`·`unwrap`·`errors`·`env`·`session`) | 전송 계층. 헤더·타임아웃·봉투 해석·에러 정규화 | 도메인 타입 인지, 토스트/네비게이션 직접 호출 |
| DIR-11 | `src/lib/api/endpoints/` | 엔드포인트 1:1 함수. 쿼리 조립 + 어댑터 호출 | `react`/`react-native` import, React Query 사용, 캐시 접근, 인라인 변환 로직 |
| DIR-12 | `src/lib/adapters/` | **유일한** 와이어↔도메인 변환 지점 | 네트워크 호출, 화면 문구 |
| DIR-13 | `src/lib/query/` | QueryClient 인스턴스, 기본 옵션, persister, 키 팩토리 | 도메인 훅(그건 `features/*/hooks`) |
| DIR-13b | `src/services/` | **기기·OS** 어댑터(SecureStore, MMKV, 이미지 압축, 미디어 선택, 로컬 알림, 딥링크, 햅틱) | 서버 통신(그건 `src/lib/api`), 비즈니스 판단(“로그인됐는지”는 store가 판단) |
| DIR-13c | `src/store/` | zustand 스토어 (세션·테마·토스트·스캔 드래프트) | 서버 데이터 사본(그건 React Query 캐시의 몫), QueryClient 인스턴스(`src/lib/query`) |
| DIR-14 | `src/constants/` | 절대 변하지 않거나 앱 전체가 공유하는 상수 | 함수 로직, 화면 1곳만 쓰는 값(그건 그 파일 상단 `const`) |
| DIR-15 | `src/types/` | 타입/인터페이스 선언만 | 런타임 값(`enum` 대신 `as const` + union) |
| DIR-16 | `src/utils/` | 부작용 없는 순수 함수 (예외: `logger.ts` — 콘솔 출력만 허용) | `fetch`/`Alert`/저장소 접근/`Date.now()` 직접 사용(현재 시각은 인자로 주입해 테스트 가능하게) |
| DIR-17 | `assets/` | 정적 리소스 | 코드, 3MB 초과 원본 이미지(사전 최적화 후 반입) |

### 승격/강등 규칙

1. `features/A/components/X.tsx`를 feature B가 쓰고 싶어지면 → **복사 금지**, `src/components/ui|layout|feedback/`으로 승격하고 도메인 단어를 props로 밀어낸다.
2. `src/components/`에 있는 것이 결국 한 feature에서만 쓰이면 → 다음 정리 커밋에서 해당 feature로 강등한다.
3. `src/utils/`의 함수가 특정 문서 타입 지식을 요구하기 시작하면 → `features/<f>/model/`로 옮긴다.

---

## 3. 파일 네이밍 규칙

원본 팀 규칙(`MORA_wiki/Naming.md`)을 계승하되, expo-router가 강제하는 부분만 예외로 둔다.

| 대상 | 규칙 | 올바른 예 | 잘못된 예 |
|---|---|---|---|
| React 컴포넌트 (`.tsx`) | PascalCase | `StorageCard.tsx`, `FieldEditorRow.tsx` | `storage-card.tsx` |
| 훅 (`.ts`) | `use` + camelCase | `useScanImage.ts`, `useCardList.ts` | `UseScanImage.ts`, `scanHook.ts` |
| 서비스/유틸/모델 (`.ts`) | camelCase | `cardGroups.ts`, `saveBodyMappers.ts` | `CardGroups.ts`, `save_body_mappers.ts` |
| 타입 전용 파일 | camelCase | `domain.ts`, `navigation.ts` | `Types.ts` |
| **expo-router 라우트 파일** | **프레임워크 고정** — 소문자 kebab-case | `review.tsx`, `account-delete.tsx`, `_layout.tsx`, `+not-found.tsx`, `[id].tsx`, `(tabs)/` | `Review.tsx`, `AccountDelete.tsx` |
| 폴더 | 소문자 한 단어. 복수형은 모음일 때만 | `components/`, `features/`, `scan/` | `Components/`, `scan-feature/` |
| 상수 | UPPER_SNAKE | `MAX_UPLOAD_BYTES`, `SCAN_TIMEOUT_MS` | `maxUploadBytes` |
| 타입/인터페이스 | PascalCase, 접두사 `I` 금지 | `CardResponse`, `ScanDraft` | `ICardResponse`, `TCard` |
| 변수·함수 | camelCase, 함수는 동사로 시작 | `getMyCards()`, `handleSubmit()` | `cards()`, `card_data` |
| boolean | `is/has/can` 접두 | `isSaving`, `hasImage`, `canEdit` | `saving`, `image` |
| 에셋 | kebab-case | `chatbot-logo.svg`, `empty-cards.png` | `ChatbotLogo.svg` |
| 테스트 | 대상 파일명 + `.test.ts` | `saveBodyMappers.test.ts` | `test-mappers.ts` |

**동사 통일 (원본 `Naming.md` 계승):** 조회 `get`, 생성 `create`/`save`, 수정 `update`, 삭제 `delete`. `fetch`/`retrieve`/`modify`/`remove` 혼용 금지. 단 React Query 훅은 관례상 `useXxxQuery` / `useXxxMutation` 접미사를 허용한다.

**한 파일 한 컴포넌트.** 파일명과 default export 이름이 반드시 일치한다(라우트 파일 제외 — 라우트는 기본 export 이름이 자유).

---

## 4. import 별칭과 배럴 정책

### 4-1. `@/` 별칭

`tsconfig.json`:

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

`app.config.js`:

```js
module.exports = ({ config }) => ({
  ...config,
  experiments: { typedRoutes: true, tsconfigPaths: true },
  // ...
});
```

| 규칙 | 내용 |
|---|---|
| ALS-1 | `src/` 안의 모든 상호 참조는 `@/`를 쓴다. `../../..` 3단계 이상 상대경로 금지 |
| ALS-2 | 같은 폴더 안 형제 파일은 `./Xxx`로 쓴다(별칭 남용 금지) |
| ALS-3 | `app/`은 별칭을 만들지 않는다. 라우트 파일끼리는 서로 import하지 않는다 |
| ALS-4 | 별칭은 `@/` **하나뿐**이다. `~/`, `@components/` 같은 추가 별칭을 만들지 않는다 |
| ALS-5 | `experiments.tsconfigPaths`가 Metro 해석을 담당하므로 `babel-plugin-module-resolver`를 **추가하지 않는다**(중복 해석은 캐시 문제의 원인) |

import 정렬 순서(Prettier + ESLint `import/order`):

```
1) react, react-native
2) expo-*, 서드파티
3) @/constants, @/types
4) @/lib, @/services, @/store, @/hooks, @/utils
5) @/components
6) @/features
7) 상대경로 ./
8) 타입 전용 import (import type)
```

### 4-2. 배럴 파일 정책

**원칙: 배럴(`index.ts` 재export)을 만들지 않는다.**

이유 3가지:
1. Metro는 웹 번들러처럼 tree-shaking을 하지 않는다. 배럴 하나를 import하면 그 폴더 전부가 초기 번들에 끌려와 **콜드 스타트가 느려진다**.
2. `components/ui/index.ts` ↔ `features/*/index.ts` 사이에 **순환 참조**가 생기면 RN에서는 `undefined is not a function` 형태로 런타임에 터진다(컴파일 에러로 안 잡힌다).
3. 파일 경로가 곧 소유 폴더를 알려주는 효과가 사라져 [[Architecture]] §2-2의 레이어 규칙 위반을 눈으로 잡기 어려워진다.

**유일한 예외:** `src/features/<f>/index.ts` — 그 기능의 **공개 API(화면 컴포넌트 + 필요한 타입)만** 재export한다. `app/` 라우트 파일은 이 배럴만 통해 feature에 접근한다.

```ts
// src/features/scan/index.ts  — 허용되는 유일한 형태
export { CameraScreen } from './screens/CameraScreen'
export { ScanReviewScreen } from './screens/ScanReviewScreen'
export type { ScanDraft, ScanFieldKey } from './types'
```

```ts
// ❌ 금지
// src/components/ui/index.ts
export * from './Button'
export * from './Card'
// ... 13개
```

ESLint로 강제: `no-restricted-imports`에 `@/components/*/index`, `@/lib/**/index`, `@/services/index`, `@/utils/index` 패턴을 등록한다.

---

## 5. 기능 폴더 구성 예시 — `src/features/scan/`

Phase 3(스캔 파이프라인)에서 실제로 생성되는 파일 전량이다. 다른 feature도 이 형태를 따른다.

```
src/features/scan/
├─ screens/
│  ├─ CameraScreen.tsx              # 촬영 UI. 권한 상태 3분기(granted/denied/undetermined)
│  └─ ScanReviewScreen.tsx          # 분류 결과 + 필드 편집 + 저장 CTA
├─ components/
│  ├─ CaptureFrameGuide.tsx         # 문서 정렬 가이드 프레임 (문서유형별 비율 힌트)
│  ├─ ShutterBar.tsx                # 셔터 + 갤러리 + 플래시 토글
│  ├─ ScanProgressOverlay.tsx       # 업로드 진행률 + "인식 중" 단계 표시
│  ├─ DocumentTypeSwitcher.tsx      # 분류 결과 수동 변경 칩 4종 (ETC 구제 경로)
│  ├─ ConfidenceBadge.tsx           # confidence 0~1 → 배지 (0.8 미만 경고 톤)
│  ├─ FieldEditorList.tsx           # fields(전체 필드+라벨) 순서대로 렌더
│  ├─ FieldEditorRow.tsx            # 라벨 + TextField, 키보드 타입/멀티라인 분기
│  └─ ScanImagePreview.tsx          # expo-image + 재촬영 버튼
├─ hooks/
│  ├─ useCameraPermission.ts        # 권한 요청 + 설정앱 이동 CTA 상태
│  ├─ usePickImage.ts               # 카메라/갤러리 통합 진입
│  ├─ useCompressImage.ts           # IMG-01~07: 장변 1280 / q0.85 / 목표 1.2MB / 8MB 하드 가드
│  ├─ useScanMutation.ts            # POST /api/scan (API-41) + 이중 언랩
│  ├─ useCommitMutation.ts          # POST {OCR}/api/commit → imageUrl 확보
│  ├─ useSaveDocumentMutation.ts    # 4종 save 분기 + invalidate
│  └─ useScanFlow.ts                # commit→save 순서 보장, imageUrl 재사용, 부분성공 처리
├─ model/
│  ├─ fieldSchema.ts                # 문서 4종 필드 순서·한국어 라벨·입력 타입 (OCR fields 응답 보강용)
│  ├─ draftReducer.ts               # 편집 중 필드 변경/되돌리기 (순수 함수)
│  └─ validators.ts                 # 이메일/전화/금액 형식 경고 (차단 아님)
├─ constants.ts                     # 스캔 단계 라벨, 가이드 프레임 비율, 재촬영 문구
├─ types.ts                         # ScanResult, ScanFieldKey, SaveOutcome
└─ index.ts                         # 배럴(예외): 화면 2개 + 타입만 export
```

**이 예시가 규칙을 보여주는 지점**

| 관찰 | 규칙 |
|---|---|
| 저장 바디 매핑이 여기 없고 `src/lib/adapters/save.ts`에 있다 | 와이어 변환은 **한 곳에서만** 한다. feature가 각자 매핑하면 4종 비대칭 스키마가 다시 흩어진다 (DIR-12) |
| 스캔 임시 상태가 `model/`이 아니라 `src/store/scanDraftStore.ts`에 있다 | 카메라 화면과 리뷰 화면 **두 라우트**가 공유하므로 전역 스토어 (상태 배치 4번 규칙) |
| `useScanFlow.ts`가 commit→save 순서를 소유한다 | 여러 mutation의 조율은 화면이 아니라 훅의 책임 (LYR-3) |
| `fieldSchema.ts`가 서버 `fields` 응답과 별도로 존재한다 | 서버는 `{키: 한국어라벨}`만 준다. 입력 타입·정렬·멀티라인 여부는 클라이언트 지식 |
| `ScanImagePreview`가 `components/ui/`가 아니라 여기에 있다 | 재촬영 버튼이라는 스캔 도메인 지식을 갖는다 (DIR-06) |
| 업로드 한도(`MAX_UPLOAD_BYTES`)가 feature `constants.ts`가 아니라 `src/constants/limits.ts`에 있다 | 압축 서비스(`services/imagePipeline.ts`)도 같은 값을 쓴다. 두 곳이 참조하면 전역 (DIR-14) |

---

## 6. git 미추적 / 산출물 경로

| 경로 | 상태 | 비고 |
|---|---|---|
| `.env.local` | 미추적 | LAN IP가 사람마다 다르다. `.env.example`만 추적 |
| `node_modules/`, `.expo/`, `dist/`, `.export/` | 미추적 | `.export/` 는 `expo export` 산출물(번들 크기 확인용) |
| `android/`, `ios/` | 미추적 | **CNG(Continuous Native Generation) 유지.** `expo prebuild`로 언제든 재생성. 네이티브 설정은 `app.config.js` plugin으로만 표현 → [[APK Build]] |
| `*.apk`, `*.aab`, `*.keystore`, `credentials.json` | **미추적 필수** | keystore 보관 정책은 [[APK Build]] |
| `.eas/` | 미추적 | |
| **`app.config.js`, `eas.json`, `.easignore`, `package-lock.json`** | **추적 필수** | `app.config.js` 에는 `projectId`·`owner` 가 하드코딩되어 있어 없으면 팀원이 빌드할 때 새 EAS 프로젝트가 만들어진다([[APK Build]] §1-1·§1-2). `.easignore` 가 없으면 업로드에 `wiki/`·`/android` 가 섞인다. `package-lock.json` 은 [[Risks]] RSK-25·RSK-36의 유일한 되돌림 지점이다 |

> **`.easignore` 와 `.gitignore` 의 관계** — 둘은 합쳐지지 않는다. **`.easignore` 가 존재하면 EAS는 그것만 본다.** 그래서 `.gitignore` 에만 적어 둔 `node_modules/`·`.expo/` 도 `.easignore` 에 **다시** 적어야 한다([[APK Build]] §1-4). 한쪽만 고치는 것이 이 파일 쌍의 대표적 사고다.
