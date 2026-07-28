# Component Library

MORA 모바일 앱의 RN 컴포넌트 **52종(CMP-01~52)** 인벤토리 — ID·원본 대응·**담당 페이즈**·props 인터페이스·variant 매트릭스·서드파티 선정 근거. 테마(라이트/다크)는 별도 variant가 아니라 토큰 참조로 해결되며 그 규범과 예외는 §3-0이 정본이다.

상위: [[Home]]
관련: [[Screen Specs]] · [[Design Tokens]] · [[Mobile UX Guide]] · [[Directory Structure]] · [[Conventions]] · [[Tech Stack]] · [[Phases]] · [[ADR-004 Styling]] · [[Offline and State]]

---

## 0. 규약

### 0-1. 분류

| 종류 | 정의 | 위치 |
|---|---|---|
| `primitive` | 도메인 지식 없음. 토큰만 소비 | `src/components/ui/` |
| `composite` | primitive 조합. 도메인 타입(`DocumentType` 등)을 알 수 있음 | `src/components/common/` |
| `screen-level` | 특정 화면 전용. 서버 상태를 직접 다룸 | `src/features/{domain}/components/` |

### 0-2. 공통 작성 규칙

1. 모든 컴포넌트는 **함수 선언 + named export**. `default export` 금지 (원본이 default/named를 섞어 써서 import가 혼란스러웠다).
2. props 인터페이스 이름은 `{Component}Props`. `export`한다.
3. 스타일은 **NativeWind `className` 우선**, 동적 계산이 필요한 값만 `style`.
4. 모든 인터랙티브 컴포넌트는 `testID`와 `accessibilityLabel`을 받는다.
5. 터치 타깃 최소 **44×44dp**. 미달 시 `hitSlop` 필수.
6. `React.memo` 적용 대상: 리스트 아이템(CMP-29/30/31/34/38/41/44)만. 나머지는 남용 금지.
7. 색·크기 리터럴 하드코딩 금지. `theme` 또는 Tailwind 토큰만 사용. **다크모드가 v1 In scope이므로 이 규칙은 이제 "스타일이 어긋난다"가 아니라 "다크에서 즉시 깨진다"의 문제다** — 하드코딩된 `#FFFFFF` 하나가 다크 화면에 흰 사각형으로 남는다.
8. **테마는 컴포넌트가 모른다.** `className`(의미론적 클래스) 또는 `useTheme()`만 쓴다. 색을 `dark:` variant로 분기하는 것은 금지(`bg-white dark:bg-black`) — [[ADR-004 Styling]] §5-5. `dark:`는 색이 아닌 것(특정 에셋 숨김, `borderWidth` 증감)에만 허용한다.
9. RN의 `useColorScheme()`을 컴포넌트에서 직접 호출 금지. 3택 오버라이드를 모르므로 틀린 값을 준다 — [[ADR-004 Styling]] §5-6.
10. **컴포넌트 PR은 라이트/다크 두 테마 스크린샷을 첨부해야 머지된다** (`app/(dev)/gallery.tsx` 테마 토글, [[ADR-004 Styling]] §5-7). 한 테마만 검수된 컴포넌트는 미완성으로 본다.

### 0-3. 공통 타입 (`src/types/domain.ts`)

```ts
export type DocumentType = 'BUSINESS_CARD' | 'POSTER' | 'RECEIPT' | 'TICKET' | 'ETC'
/** 챗봇·검색이 다루는 유형 (ETC 제외) — 원본 ChatDocumentType 계승 */
export type SearchableType = Exclude<DocumentType, 'ETC'>

/** 색을 뺀 메타. fg/bg 는 테마 토큰에서 온다 — 아래 결정 참조 */
export type DocTypeMeta = { label: string; route: string | null; icon: string }

/** 원본 dashboard/page.tsx TYPE_COLORS + 명함 추가본을 정본으로 삼되, **색은 담지 않는다** */
export const DOC_TYPE_META: Record<DocumentType, DocTypeMeta> = {
  BUSINESS_CARD: { label: '명함',   route: 'card',    icon: 'FileText' },
  TICKET:        { label: '티켓',   route: 'ticket',  icon: 'Calendar' },
  POSTER:        { label: '포스터', route: 'poster',  icon: 'FolderTree' },
  RECEIPT:       { label: '영수증', route: 'receipt', icon: 'ScanText' },
  ETC:           { label: '기타',   route: null,      icon: 'File' },
}

/** 색은 테마에서 꺼낸다. 라이트/다크 값 정본은 [[Design Tokens]] §9 / §10-4 */
// const { docType } = useTheme(); docType.BUSINESS_CARD.fg / .bg

export type Size = 'sm' | 'md' | 'lg'
export type Tone = 'default' | 'danger' | 'success' | 'warn' | 'info'
export type ThemeMode = 'system' | 'light' | 'dark'   // CMP-51 / themeStore 공용

/** OCR 원본 블록 (snake_case 유지 — 서버 응답 그대로) */
export interface RawBlock {
  block_index: number
  text: string
  confidence: number
  bbox: number[][]        // 4점 폴리곤 [[x,y],[x,y],[x,y],[x,y]]
}

export interface ImageSize { width: number; height: number }
```

> **결정 (2026-07-27, 다크모드 편입) — `DOC_TYPE_META`에서 `fg`/`bg`를 제거했다.** 문서 4종 색은 테마별로 값이 다르다([[Design Tokens]] §9 라이트 / §10-4 다크). 타입 모듈이 HEX를 들고 있으면 (a) 다크에서 라이트 색이 그대로 나오고, (b) HEX가 `tokens.ts` 밖에 한 벌 더 생겨 §0-2 규칙 7이 깨진다. 이제 라벨·라우트·아이콘만 이 모듈이 소유하고 **색은 `useTheme().docType[type]`에서만** 나온다. 덤으로 종전 표기의 오류 2건(POSTER `#0077B6`, RECEIPT `#4FB048` — [[Design Tokens]] §9가 대비 미달로 각각 `#0069A0`, `#166534`으로 보정한 값)도 함께 소멸한다.

### 0-4. 페이즈 배정 규칙 (인벤토리 `페이즈` 열의 판정 기준)

**페이즈 이름·번호의 정본은 [[Phases]]다.** 이 문서는 각 CMP를 "어느 페이즈에서 만드는가"만 배정하고, 그 집계는 [[Phases]] §6 요약표와 1:1로 일치해야 한다. 판정 규칙은 아래 4개뿐이며, 충돌 시 위 규칙이 이긴다.

| 규칙 | 내용 | 이유 |
|---|---|---|
| **A. 첫 소비 화면** | 그 컴포넌트를 **처음 필요로 하는 정식 화면(SCR-01~30)이 속한 페이즈**에 배정한다. 화면→페이즈 매핑의 정본은 [[Screen Specs]] 각 화면의 `페이즈` 행 | 쓰이지 않는 컴포넌트를 미리 만드는 것이 이 프로젝트에서 가장 흔한 낭비다. 갤러리에서만 예쁜 컴포넌트는 실화면에서 반드시 시그니처가 바뀐다 |
| **B. 공유 primitive는 Phase 1** | **2개 이상 페이즈의 화면이 공유하는 `primitive`**(및 셸 성격의 layout)는 A를 무시하고 Phase 1 | Phase 1의 존재 이유가 "이후 화면이 색·간격·폰트를 다시 고민하지 않게 한다"이므로, 여러 페이즈가 쓸 부품은 먼저 고정되어야 한다. 한 페이즈만 쓰는 것을 Phase 1에 넣으면 Phase 1이 비대해지고 실사용 검증이 늦어진다 |
| **C. 개발 전용 화면은 판정 대상이 아니다** | SCR-31 진단 화면과 `app/(dev)/gallery.tsx`는 A의 "첫 소비 화면"으로 세지 않는다. 두 화면은 정식 컴포넌트 없이 최소 구현으로 출발하고 Phase 1 이후 교체된다. 예외는 **없으면 화면 자체가 뜨지 않는 셸 2종**(CMP-48 `SafeScreen`, CMP-50 `Logo`) → Phase 0 | SCR-31은 Phase 0 산출물인데 [[Screen Specs]]가 CMP-01/03/15/27을 참조한다. 이것을 A로 판정하면 디자인 시스템 절반이 Phase 0으로 끌려와 Phase 0의 목표("화면이 0개일 때 파이프라인만 뚫는다")가 무너진다 |
| **D. 테마 3택 컨트롤은 Phase 1** | CMP-51 `ThemeModeSegment`는 실제 노출 화면이 SCR-25(Phase 6)뿐이지만 Phase 1에 배정한다 | [[ADR-004 Styling]] §5-7이 **Phase 1부터 모든 컴포넌트 PR에 두 테마 스크린샷을 요구**한다. 테마를 바꿀 수단이 Phase 1에 없으면 그 게이트를 통과할 방법이 없다. Phase 6은 이 컴포넌트를 SCR-25에 **배치**할 뿐 새로 만들지 않는다 |

- `페이즈` 열은 **만드는 시점**이고, `사용 화면` 열은 **소비 지점 전체**다. 두 열이 어긋나 보이는 행(예: CMP-51)은 위 규칙 중 하나가 개입한 것이며 §1-I에 근거를 남긴다.
- 페이즈를 옮기는 PR은 §1-I 집계표와 [[Phases]] §6 요약표를 **함께** 고쳐야 통과한다. 한쪽만 고치면 합계가 어긋난다.

---

## 1. 인벤토리 (CMP-01 ~ CMP-52)

### 1-A. Primitive (CMP-01 ~ CMP-19)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-01 | `Button` | `AuthForm` 제출 버튼 · `StorageDrawer` 저장/취소 · 랜딩 CTA | primitive | 전 화면 | 1 |
| CMP-02 | `IconButton` | 챗봇 헤더 액션 3종 · 드로어 닫기 `×` · 헤더 아이콘 | primitive | 전 화면 | 1 |
| CMP-03 | `TextField` | `shared/TextInput.tsx` (email) | primitive | SCR-03/04/12/20/22/26 | 1 |
| CMP-04 | `PasswordField` | `shared/TextInput.tsx` (password, 눈 토글) | primitive | SCR-03/04/27/28 | 1 |
| CMP-05 | `SearchBar` | `dashboard/layout.tsx` 헤더 검색 form | primitive | SCR-23 | 5 |
| CMP-06 | `Chip` | 랜딩 필터칩 · 챗봇 문서유형 칩 · 검색 Chip 3종 | primitive | SCR-09/12/14/15/23/24 | 1 |
| CMP-07 | `Badge` | 마감 배지 · 개수 배지 · 타입 배지 | primitive | SCR-06/07/08/14~19/23 | 1 |
| CMP-08 | `Surface` | 카드 컨테이너 (`radius 12`, `border #CBD5E1`) | primitive | 전 화면 | 1 |
| CMP-09 | `Divider` | `shared/Divider.tsx` (`또는`) + 필드 구분선 | primitive | SCR-03/04/19/25 | 1 |
| CMP-10 | `Avatar` | 헤더 32dp 아바타 · 설정 80dp 아바타 | primitive | SCR-06/25/26 | **6** |
| CMP-11 | `Toggle` | 설정 토글 (40×22, 노브 16) | primitive | SCR-25/29 | **6** |
| CMP-12 | `SegmentedControl` | 설정 테마 세그먼트 | primitive | SCR-25/29 · CMP-51 | 1 |
| CMP-13 | `Skeleton` | **없음** (원본은 텍스트 `불러오는 중...`) | primitive | 전 목록 화면 | 1 |
| CMP-14 | `EmptyState` | `StorageGrid` 빈 상태(`□` + 문구) | primitive | 전 목록 화면 | 1 |
| CMP-15 | `ErrorState` | 업로드/검색 에러 박스 | primitive | 전 화면 | 1 |
| CMP-16 | `Toast` | **없음** (원본 `window.alert` ×12) | primitive | 전 화면 | 1 |
| CMP-17 | `BottomSheet` | `StorageDrawer` (420px 우측 패널) | primitive | SCR-09/12/15/17/19/22/28 | 1 |
| CMP-18 | `ConfirmDialog` | `ConfirmPopover` · 챗봇 초기화 모달 · `window.confirm` | primitive | 전 파괴적 액션 | 1 |
| CMP-19 | `ActionSheet` | 정렬 `<select>` · 롱프레스 메뉴 | primitive | SCR-14~19/23 | 1 |

### 1-B. Layout / Shell (CMP-20 ~ CMP-23, CMP-47 ~ CMP-49)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-20 | `AppHeader` | `dashboard/layout.tsx` 고정 헤더(1200px) | composite | 전 스택 화면 | 1 |
| CMP-21 | `TabBar` | **없음** (랜딩 목업의 `홈/업로드/보관함/설정`이 유일한 근거) | composite | (tabs) | 1 |
| CMP-22 | `ChatFab` | `ChatbotWidget` 닫힌 상태 FAB 64×64 | composite | 전 탭 화면 | 5 |
| CMP-23 | `ProgressBar` | **없음** | primitive | SCR-11 | 3 |
| CMP-47 | `KeyboardAwareScreen` | **없음** (웹은 불필요) | primitive | SCR-03/04/12/20/22/24/26/27 | 1 |
| CMP-48 | `SafeScreen` | **없음** | primitive | 전 화면 | 0 |
| CMP-49 | `ListFooterLoader` | 페이지네이션 `‹1 2 3›` | primitive | SCR-01 지연 인디케이터 · SCR-08/14~18/23 무한 스크롤 | **1** |

### 1-C. Media (CMP-24 ~ CMP-26)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-24 | `DocImage` | `<img onError>` + `fullImageUrl()` 조합 | composite | 전 이미지 표시 (첫 소비 SCR-02 온보딩 목업) | **2** |
| CMP-25 | `ZoomableImage` | `upload` bbox 오버레이 이미지 | composite | SCR-12(bbox) / SCR-21(뷰어) | **3** |
| CMP-26 | `OcrBlockList` | `upload`/`tickets` OCR 칩 리스트 | composite | SCR-12/19/21 | 3 |

### 1-D. Field / Form (CMP-27 ~ CMP-28)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-27 | `FieldRow` | `StorageDrawer.Field` 읽기 모드 | composite | SCR-19/26 | 4 |
| CMP-28 | `FieldEditor` | `StorageDrawer.Field` 편집 모드 | composite | SCR-12/20 | 3 |

### 1-E. Domain List (CMP-29 ~ CMP-34, CMP-44 ~ CMP-46)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-29 | `DocumentListItem` | `storage/*` 테이블 행 (5~8컬럼) | composite | SCR-14~18 | 4 |
| CMP-30 | `DocumentGridCard` | `StorageCard.tsx` | composite | SCR-14/17 | 4 |
| CMP-31 | `DeadlineCard` | `dashboard/page.tsx` 마감 카드 | screen-level | SCR-06 | 6 |
| CMP-32 | `StatTile` | 대시보드 배너 4칸 · 설정 StatTile | composite | SCR-06/25 | 6 |
| CMP-33 | `Calendar` | `dashboard/page.tsx` 캘린더 | screen-level | SCR-06(week)/07(month) | 6 |
| CMP-34 | `ScheduleListItem` | 일정 목록 패널 행 | composite | SCR-06/07 | 6 |
| CMP-44 | `NotificationItem` | **없음** (API만 존재) | composite | SCR-08 | 6 |
| CMP-45 | `GroupChipRail` | `storage/cards` 220px 사이드바 | composite | SCR-15 | 4 |
| CMP-46 | `SwipeableRow` | 인라인 삭제 확인 2버튼 | primitive | SCR-08/15~18/22 | 4 |

### 1-F. Settings (CMP-35 ~ CMP-36)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-35 | `SettingsRow` | `settings/page.tsx` `Row` + `Chevron` | composite | SCR-25/29 | 6 |
| CMP-36 | `SettingsSection` | `settings/page.tsx` `Card` 섹션 | composite | SCR-25/28/29 | 6 |

### 1-G. Auth / Search / Chat (CMP-37 ~ CMP-43, CMP-50)

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-37 | `SocialLoginButton` | `shared/SocialButtons.tsx` | composite | SCR-03/04 | 2 |
| CMP-38 | `ChatBubble` | `ChatbotWidget` 말풍선 (+ 고양이 귀) | composite | SCR-24 | 5 |
| CMP-39 | `ChatComposer` | `ChatbotWidget` 칩바 + 입력폼 | screen-level | SCR-24 | 5 |
| CMP-40 | `SourceCard` | **없음** (`sources`를 표시하지 않았음) | composite | SCR-24 | 5 |
| CMP-41 | `SearchResultCard` | `search/page.tsx` 결과 카드 3단 | screen-level | SCR-23 | 5 |
| CMP-42 | `RecentQueryList` | **없음** (API-54 미사용) | composite | SCR-23 | 5 |
| CMP-43 | `SortSheet` | 정렬 `<select>` | composite | SCR-14~18/23 | 4 |
| CMP-50 | `Logo` | `mora-logo-lg.svg` + Patua One `MORA` | primitive | SCR-01/02/03/04/05/06 | 0 |

### 1-H. Theme (CMP-51 ~ CMP-52) — 다크모드 편입으로 신설

다크모드가 v1 In scope가 되면서(2026-07-27, [[ADR-004 Styling]] §4) **컴포넌트로 존재해야만 해결되는 두 가지**가 생겼다. 색 대응은 토큰이 처리하므로(§3-0) 신규는 이 2종뿐이다.

| ID | 이름 | 원본 대응 | 종류 | 사용 화면 | 페이즈 |
|---|---|---|---|---|---|
| CMP-51 | `ThemeModeSegment` | 설정 테마 세그먼트(`라이트`/`다크` — **대응 스타일 없는 껍데기**였다) | composite | SCR-25 · `(dev)/gallery` | 1 |
| CMP-52 | `ThemeScope` | **없음** | primitive | SCR-12(이미지 영역) · 필요 시 SCR-21 | 3 |

**CMP-51 `ThemeModeSegment`** — CMP-12 `SegmentedControl`을 `themeStore`에 배선한 3택 컨트롤. 컴포넌트 자체가 `시스템 따름`/`라이트`/`다크`를 소유하고 MMKV `theme.mode`에 즉시 영속한다([[Offline and State]] §1-4). 화면은 이 컴포넌트를 놓기만 하면 되고 테마 상태를 알지 않는다. 원본 웹은 이 세그먼트가 `document.documentElement.dataset.theme`만 세팅하고 대응 스타일이 없어 **아무 일도 일어나지 않는 컨트롤**이었다 — 형상만 계승하고 동작은 신규다.

**CMP-52 `ThemeScope`** — 서브트리의 테마를 강제 고정하는 래퍼. 필요 이유는 하나뿐이다: **스캔 리뷰(SCR-12)의 이미지 영역은 다크에서도 라이트 표면을 유지해야 한다**([[Design Tokens]] §10-5). 화면 절반이 흰 종이 문서 이미지인데 컨테이너를 다크로 만들면 대비 충격이 최대가 되고, 이미지에 밝기 필터를 걸면 문서 판독성이 훼손된다. 즉 이 예외는 테마 전환으로 사라지지 않는 문제이므로 `if (isDark)` 분기를 화면 코드에 흩뿌리는 대신 **컴포넌트 하나로 국소화**한다. 남용 방지를 위해 사용처를 §3-0 예외 목록에 등재된 지점으로 제한한다.

### 1-I. 페이즈 배정 집계 (합계 검증)

**CMP-01~50 = 50종이 빠짐없이 배정되었고 중복이 없다.** 신규 2종을 더한 총계는 52다. 이 표는 [[Phases]] §6 요약표와 **같은 수를 말해야 한다**.

| Phase | 이름([[Phases]] 정본) | 신규 CMP 수 | CMP ID |
|---|---|---|---|
| 0 | 기반 셋업 & APK 파이프라인 관통 | 2 | CMP-48, CMP-50 |
| 1 | 디자인 시스템 & 공통 컴포넌트 | **21** | CMP-01~04, CMP-06~09, CMP-12~21, CMP-47, CMP-49, **CMP-51** |
| 2 | 인증 | 2 | CMP-24, CMP-37 |
| 3 | 스캔 파이프라인 | 5 | CMP-23, CMP-25, CMP-26, CMP-28, **CMP-52** |
| 4 | 보관함 | 6 | CMP-27, CMP-29, CMP-30, CMP-43, CMP-45, CMP-46 |
| 5 | 검색 & 챗봇 | 7 | CMP-05, CMP-22, CMP-38, CMP-39, CMP-40, CMP-41, CMP-42 |
| 6 | 대시보드 & 설정 | 9 | CMP-10, CMP-11, CMP-31, CMP-32, CMP-33, CMP-34, CMP-35, CMP-36, CMP-44 |
| 7 | 상용 품질 마감 | 0 | — (기존 컴포넌트의 상태·모션·a11y·다크 검수만) |
| 8 | 릴리스 | 0 | — |
| | **합계** | **52** | 기존 50 (CMP-01~50) + 신규 2 (CMP-51/52) |

**검산** — 2+21+2+5+6+7+9+0+0 = **52**. 신규 2종을 빼면 **50** = 인벤토리 §1-A~1-G 행 수와 일치.

**페이즈가 교정된 행과 그 근거** (종전 값 → 현재 값)

| CMP | 종전 | 현재 | 교정 근거 |
|---|---|---|---|
| CMP-10 `Avatar` | 1 | **6** | 소비 화면이 SCR-06/25/26으로 **전부 Phase 6**이다. 규칙 B(공유 primitive)에 해당하지 않으므로 규칙 A로 내려간다. CMP-20 `AppHeader`가 아바타를 품는 것처럼 보이지만 헤더는 `left`/`right`를 `ReactNode`로 받으므로 **컴파일 의존이 없다** |
| CMP-11 `Toggle` | 1 | **6** | 소비 화면 SCR-25/29 둘 다 Phase 6. Phase 7의 "햅틱 끄기"(FR-104)도 설정 화면 안이다 |
| CMP-12 `SegmentedControl` | 1 | 1 (유지) | SCR-25/29(Phase 6) 외에 **CMP-51의 내부 부품**으로 Phase 1에서 필요해진다(규칙 D). SCR-12·SCR-23의 "유형 세그먼트"는 실제로는 가로 스크롤 **칩**(CMP-06)이다([[Screen Specs]] SCR-12 변경점) |
| CMP-24 `DocImage` | 1 | **2** | G-9(모든 이미지는 DocImage)의 첫 적용 지점이 SCR-02 온보딩 목업 PNG다([[Screen Specs]] SCR-02). 규칙 A → Phase 2. 이에 맞춰 `expo-image` 도입 시점도 Phase 2로 당긴다(§5-3) |
| CMP-25 `ZoomableImage` | 4 | **3** | FR-046과 [[Phases]] Phase 3 DoD가 "OCR 블록 칩을 탭하면 이미지 위 bbox가 그려진다"를 **Phase 3에서** 요구한다. bbox 오버레이 렌더는 Phase 3, 핀치줌·더블탭·스와이프 닫기(FR-068, SCR-21)는 Phase 4에서 같은 컴포넌트에 얹는다 |
| CMP-32 `StatTile` | 6 | 6 (유지) | `사용 화면`에서 SCR-18을 제거했다. SCR-18의 `이달 지출` KPI는 `icon`/`iconBg`/`iconFg` **필수 props를 채우지 않는다** — CMP-08 `Surface` + `typography.stat` 조합이며 CMP-32가 아니다. 따라서 첫 소비는 SCR-06(Phase 6) |
| CMP-49 `ListFooterLoader` | 4 | **1** | Phase 4/5/6 화면이 공유하는 primitive라 규칙 B. §6 구현 순서표가 이미 Phase 1에 넣고 있어 **표 두 개가 서로 다른 말을 하던 행**이다 |

---

## 2. Props 인터페이스 (RN, 복붙 가능)

### CMP-01 `Button`

```tsx
// src/components/ui/Button.tsx
import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant          // default 'primary'
  size?: ButtonSize                // default 'md'
  disabled?: boolean
  loading?: boolean                // true면 라벨을 loadingLabel로 교체 + 스피너
  loadingLabel?: string            // default '처리 중...'  (원본 AuthForm 문구)
  fullWidth?: boolean              // default false
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  haptic?: 'none' | 'selection' | 'light' | 'medium'   // default 'light'
  style?: StyleProp<ViewStyle>
  testID?: string
  accessibilityLabel?: string      // 미지정 시 label 사용
}

export function Button(props: ButtonProps): JSX.Element
```

### CMP-02 `IconButton`

```tsx
export interface IconButtonProps {
  icon: ReactNode                  // lucide-react-native 아이콘 엘리먼트
  onPress: () => void
  size?: 'sm' | 'md' | 'lg'        // 32 / 40 / 48 dp — 전부 hitSlop으로 44dp 보장
  variant?: 'plain' | 'filled' | 'overlay'  // overlay = rgba(0,0,0,0.4) 원형 (카메라·뷰어)
  tone?: 'default' | 'danger' | 'inverse'
  disabled?: boolean
  badgeCount?: number              // >0이면 우상단 카운트 배지 (99+ 클램프)
  accessibilityLabel: string       // 필수 — 아이콘만 있으므로
  testID?: string
}
```

### CMP-03 `TextField`

```tsx
import type { KeyboardTypeOptions, ReturnKeyTypeOptions, TextInputProps as RNTextInputProps } from 'react-native'

export interface TextFieldProps {
  value: string
  onChangeText: (text: string) => void     // ← 원본 onChange(e) 에서 시그니처 변경
  placeholder?: string
  label?: string                            // 위쪽 caption 라벨
  hint?: string                             // 아래쪽 caption
  error?: string                            // 있으면 hint 대신 danger 색으로 표시
  required?: boolean                        // 라벨에 * 표시 (RN엔 required 속성 없음)
  disabled?: boolean
  multiline?: boolean
  numberOfLines?: number                    // multiline일 때 minHeight 산출용
  maxLength?: number
  clearable?: boolean                       // 우측 ✕ 버튼
  keyboardType?: KeyboardTypeOptions
  autoCapitalize?: RNTextInputProps['autoCapitalize']
  autoComplete?: RNTextInputProps['autoComplete']
  textContentType?: RNTextInputProps['textContentType']
  returnKeyType?: ReturnKeyTypeOptions
  onSubmitEditing?: () => void
  trailing?: ReactNode                      // 캘린더/시계 아이콘 등
  inSheet?: boolean                         // true면 BottomSheetTextInput 사용
  testID?: string
}
```

> `inSheet`가 필요한 이유: `@gorhom/bottom-sheet` 안에서 일반 `TextInput`을 쓰면 키보드와 시트가 충돌한다. 시트 내부에서는 `BottomSheetTextInput`으로 스위칭해야 한다.

### CMP-04 `PasswordField`

```tsx
export interface PasswordFieldProps extends Omit<TextFieldProps,
  'keyboardType' | 'multiline' | 'numberOfLines' | 'clearable' | 'trailing'> {
  /** 눈 아이콘 노출 여부. default true */
  revealable?: boolean
  /** 'password' | 'newPassword' — iOS 자동 강력암호 제안 제어 */
  textContentType?: 'password' | 'newPassword'
}
```
- aria 문구는 원본 그대로: 표시 중 `비밀번호 숨기기`, 숨김 중 `비밀번호 보기`.
- 원본의 4겹 absolute 레이어(배경/보더/input/inset shadow)는 **1겹으로 단순화**. RN은 inset shadow를 지원하지 않는다.

### CMP-05 `SearchBar`

```tsx
export interface SearchBarProps {
  value: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  placeholder?: string             // default '검색어를 입력하세요'  (원본 문구)
  autoFocus?: boolean
  loading?: boolean                // 우측 스피너
  onClear?: () => void
  testID?: string
}
```

### CMP-06 `Chip`

```tsx
export interface ChipProps {
  label: string
  selected?: boolean
  onPress?: () => void
  count?: number                   // 라벨 뒤 개수 (예: '명함 12')
  leadingIcon?: ReactNode
  tone?: 'brand' | 'info' | 'neutral'   // brand=#15293D선택(보관함) / info=#1E3A8A선택(챗봇)
  size?: 'sm' | 'md'               // 28 / 34 dp
  disabled?: boolean
  testID?: string
}
```
> `tone`이 2종인 이유: 원본 보관함 필터칩은 선택 시 `#15293D`, 챗봇 문서유형 칩은 `#1E3A8A`였다. 두 맥락의 시각적 위계가 달라 통합하지 않고 토큰화한다.

### CMP-07 `Badge`

```tsx
export interface BadgeProps {
  label: string
  /** 문서 유형 지정 시 useTheme().docType[type] 의 fg/bg 가 자동 적용된다 (테마별 값 자동 치환) */
  docType?: DocumentType
  tone?: Tone                      // docType 미지정 시 사용
  size?: 'micro' | 'sm'            // 10/700 · 12/600
  testID?: string
}

export interface DDayBadgeProps {
  dDay: number                     // 0이면 'D-DAY', 양수면 'D-{n}'  (원본 규칙)
  /** dDay <= 3 → #DC8540, 그 외 #0077B6  (원본 dashboard/page.tsx:815) */
  testID?: string
}
```

### CMP-08 `Surface`

```tsx
export interface SurfaceProps {
  children: ReactNode
  variant?: 'card' | 'flat' | 'outlined' | 'danger'
  padding?: 0 | 12 | 16 | 20 | 24  // 원본 실측 스케일
  radius?: 8 | 10 | 12 | 16        // default 12 (--radius-card)
  elevation?: 'none' | 'sm' | 'md' | 'lg'
  style?: StyleProp<ViewStyle>
  testID?: string
}
```
> `elevation` 3단계는 원본 boxShadow 13종을 실질 3단으로 축약한 것: `sm` = 드롭다운 `0 4px 12px/0.1`, `md` = 카드 `0 8px 16px/0.12`, `lg` = 플로팅 패널 `0 22px 40px/0.25`. iOS는 `shadow*`, Android는 `elevation`으로 분기한다.

### CMP-09 `Divider`

```tsx
export interface DividerProps {
  /** 가운데 텍스트. 있으면 좌우 선 + 중앙 라벨 (예: '또는') */
  label?: string
  orientation?: 'horizontal' | 'vertical'   // default 'horizontal'
  inset?: number                            // 좌우 여백
  tone?: 'default' | 'soft'                 // #CBD5E1 / #F1F5F9
}
```
> 원본은 흰 배경 텍스트로 선을 **덮는** 방식이었다. 다크 모드에서 즉시 깨지므로 **`flexDirection:'row'` + 양쪽 `flex:1` 선 + 중앙 텍스트** 구조로 교체한다.

### CMP-10 `Avatar`

```tsx
export interface AvatarProps {
  name?: string                    // 이니셜 산출용. 없으면 'U'  (원본 폴백)
  uri?: string                     // 현재 서버 엔드포인트 없음 — 미래 대비
  size?: 32 | 40 | 64 | 80         // 원본 실측 크기
  testID?: string
}
```

### CMP-11 `Toggle`

```tsx
export interface ToggleProps {
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
  busy?: boolean                   // 원본 calendarBusy — 중복 클릭 방지, 스피너 노브
  accessibilityLabel: string
  testID?: string
}
```
- 트랙 40×22, 노브 16, 노브 위치 `left: value ? 21 : 3` (원본 수치 보존). 전환 150ms.
- `accessibilityRole="switch"` + `accessibilityState={{ checked: value }}`.

### CMP-12 `SegmentedControl`

```tsx
export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  scrollable?: boolean             // 5개 초과 시 가로 스크롤 (SCR-29 일수 선택)
  size?: 'sm' | 'md'               // 32 / 36 dp
  testID?: string
}
```

### CMP-13 `Skeleton`

```tsx
export interface SkeletonProps {
  width?: number | `${number}%`
  height?: number
  radius?: number                  // default 8
  style?: StyleProp<ViewStyle>
}

export interface SkeletonGroupProps {
  /** 화면별 프리셋 */
  preset: 'listRow' | 'gridCard' | 'detailFields' | 'statTiles' | 'chatBubble' | 'calendar'
  count?: number                   // default 3
}
```
- shimmer는 `react-native-reanimated`의 `withRepeat(withTiming(...))`로 1200ms 순환. **`react-native-skeleton-placeholder`를 쓰지 않는다** — MaskedView 의존이 Android에서 무겁다.
- **색은 `skeleton.base`(=`surface.alt`) / `skeleton.shimmer` 두 토큰으로 받는다** (라이트 `#F1F5F9`→`#FFFFFF` / 다크 `#232E3E`→`#2E3B4D`, [[Design Tokens]] §10-5). 다크에서 하이라이트를 흰색 상수로 두면 번쩍여서 로딩이 오히려 느리게 느껴진다 — 대비 1.2 근방이 "움직이는 것은 보이지만 시선을 빼앗지 않는" 구간이다. 라이트에서만 검수하면 이 결함이 드러나지 않으므로 §0-2 규칙 10(두 테마 스크린샷)이 필수인 대표 사례다.

### CMP-14 `EmptyState`

```tsx
export interface EmptyStateProps {
  icon?: ReactNode                 // 미지정 시 preset별 기본 lucide 아이콘
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  compact?: boolean                // 섹션 내부 인라인용 (패딩 축소)
  testID?: string
}
```
> 원본 `StorageGrid`의 빈 상태 아이콘은 문자 `□`(폰트 의존)였다. lucide `Inbox` / `FileSearch` / `BellOff` 등 preset 아이콘으로 교체한다.

### CMP-15 `ErrorState`

```tsx
export interface ErrorStateProps {
  title: string
  description?: string
  onRetry?: () => void
  retryLabel?: string              // default '다시 시도'
  variant?: 'block' | 'inline' | 'banner'
  /** banner일 때만: 상단 고정 배너 (오프라인 등) */
  tone?: 'danger' | 'warn' | 'info'
  testID?: string
}
```
- `inline` 스타일은 원본 검색/업로드 에러 박스 값 보존: border `#FECACA`, bg `#FEF2F2`, text `#B91C1C`, radius 12, padding 14.

### CMP-16 `Toast`

```tsx
export type ToastTone = 'success' | 'error' | 'info' | 'warn'

export interface ToastOptions {
  message: string
  tone?: ToastTone                 // default 'info'
  duration?: number                // ms, default 2500
  actionLabel?: string             // 예: '실행 취소'
  onAction?: () => void
  haptic?: boolean                 // default true (tone에 맞는 notificationAsync)
}

/** 전역 명령형 API — 컴포넌트 트리 밖(인터셉터 등)에서도 호출 가능 */
export const toast: {
  show(options: ToastOptions): void
  success(message: string, options?: Omit<ToastOptions, 'message' | 'tone'>): void
  error(message: string, options?: Omit<ToastOptions, 'message' | 'tone'>): void
  hide(): void
}
```
- 위치: 하단. 탭바가 있는 화면은 `tabBarHeight + 12`, 없으면 `safeAreaBottom + 16`.
- 동시에 1개만. 새 토스트가 오면 기존 것을 200ms fade-out 후 교체.

### CMP-17 `BottomSheet`

```tsx
import type { BottomSheetModal } from '@gorhom/bottom-sheet'

export interface AppBottomSheetProps {
  children: ReactNode
  snapPoints?: (string | number)[]     // default ['55%', '92%']
  title?: string                        // 고정 헤더 타이틀
  headerRight?: ReactNode
  onClose?: () => void
  enablePanDownToClose?: boolean        // default true
  scrollable?: boolean                  // true면 BottomSheetScrollView
  keyboardBehavior?: 'interactive' | 'extend' | 'fillParent'  // default 'interactive'
  testID?: string
}

export type AppBottomSheetRef = Pick<BottomSheetModal, 'present' | 'dismiss' | 'snapToIndex'>
```
- 백드롭: `scrim` 토큰 — 라이트 `rgba(0,0,0,0.3)`(원본 `StorageDrawer` 값 그대로) / **다크 `rgba(0,0,0,0.6)`**. 탭 시 닫힘. 다크에서 0.3을 그대로 쓰면 이미 어두운 배경에 얹혀 시트와 뒷배경이 분리되지 않는다(DK-11). backdrop은 `className`을 못 쓰는 지점이라 `useTheme()`으로 색을 얻는다(§3-0 N-6).
- 시트 표면은 `surface.alt`(다크 베이스 대비 1.32) + `elevation.sheet` — 다크에서는 그림자가 아니라 표면 밝기가 고도를 만든다(N-5, [[Design Tokens]] §10-6).
- handle: 36×4, `border` 토큰.

### CMP-18 `ConfirmDialog`

```tsx
export interface ConfirmDialogOptions {
  title: string
  message?: string
  confirmLabel?: string            // default '확인'   (원본 ConfirmPopover)
  cancelLabel?: string             // default '취소'
  destructive?: boolean            // true면 confirm 버튼 danger + Warning 햅틱
  /** 입력한 문자열이 정확히 일치해야 confirm 활성 (원본 '전체삭제' / '탈퇴') */
  requireText?: string
  requireTextLabel?: string        // default '확인 문구'
  requireTextHint?: string         // 예: '계속하려면 "전체삭제"를 정확히 입력하세요.'
  /** 비밀번호 입력을 요구 (원본 회원 탈퇴 로컬 계정) */
  requirePassword?: boolean
  passwordLabel?: string           // default '비밀번호'
}

export interface ConfirmDialogResult {
  confirmed: boolean
  text?: string
  password?: string
}

/** 명령형 — await로 결과를 받는다 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<ConfirmDialogResult>
```
> **`Alert.alert`를 쓰지 않는 이유**: ① 확인 문구·비밀번호 입력을 요구하는 케이스가 있고(Android `Alert`는 입력 필드 미지원) ② 브랜드 타이포·색을 적용할 수 없으며 ③ iOS/Android 문구 순서가 달라 QA 비용이 든다. 단순 2버튼 확인도 같은 컴포넌트로 통일해 시각 일관성을 유지한다.

### CMP-19 `ActionSheet`

```tsx
export interface ActionSheetItem {
  label: string
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
}

export interface ActionSheetOptions {
  title?: string
  message?: string
  items: ActionSheetItem[]
  cancelLabel?: string             // default '취소'
}

export function actionSheet(options: ActionSheetOptions): Promise<void>
```
- iOS는 네이티브 `ActionSheetIOS`, Android는 `CMP-17` 기반 커스텀 시트로 분기한다(각 플랫폼 관례 준수).

---
### CMP-20 `AppHeader`

```tsx
export interface AppHeaderProps {
  title?: string
  /** 뒤로가기 표시. default: 스택 깊이로 자동 판단 */
  showBack?: boolean
  onBack?: () => void
  /** 좌측 커스텀 (예: SCR-06의 워드마크) */
  left?: ReactNode
  right?: ReactNode
  /** 스크롤 위치에 따라 하단 헤어라인(#CBD5E1 1dp) 표시 */
  scrolled?: boolean
  transparent?: boolean            // 카메라/뷰어용 다크 오버레이 헤더
  testID?: string
}
```
> 원본 헤더는 `width:1200` 고정에 로고·검색바·업로드·보관함·알림·프로필·로그아웃 **7요소**를 담았다. 390dp에는 최대 3요소(좌·타이틀·우 2개)만 들어간다 → 검색/업로드/보관함은 탭바로, 로그아웃은 설정으로 이관했다.

### CMP-21 `TabBar`

```tsx
export interface TabItem {
  name: string                     // expo-router segment
  label: string
  icon: (props: { focused: boolean; color: string }) => ReactNode
}

export interface TabBarProps {
  /** 가운데 스캔 버튼을 띄울지. default true */
  showCenterAction?: boolean
  onCenterAction?: () => void
}
```

**탭 구성 (결정)**

| # | segment | 라벨 | 아이콘(lucide) | 근거 |
|---|---|---|---|---|
| 1 | `index` | `홈` | `House` | 랜딩 목업 탭 1 |
| 2 | `archive` | `보관함` | `FolderTree` | 랜딩 목업 탭 3. 원본 검색 화면도 POSTER 아이콘으로 `FolderTree`를 썼다 |
| — | (center) | — | `Camera` 원형 56dp `point` | 랜딩 목업 탭 2 `업로드`를 **중앙 액션 버튼으로 승격** — 스캔이 이 앱의 핵심 행위이고, 탭으로 두면 "돌아올 수 없는 모달"과 성격이 충돌한다 |
| 3 | `search` | `검색` | `Search` | 원본은 헤더 검색바뿐이었다. 모바일 헤더에 검색바를 넣을 공간이 없어 탭으로 승격 |
| 4 | `settings` | `설정` | `Settings` | 랜딩 목업 탭 4 |

- 높이 56 + `safeAreaBottom`. 활성 `point #0077B6`, 비활성 `textMuted #64748B`, 라벨 10/600.
- 활성 배경 하이라이트는 쓰지 않는다(원본 웹 `#F0F9FF` 활성 배경은 데스크톱 nav 관용구).

### CMP-22 `ChatFab`

```tsx
export interface ChatFabProps {
  onPress: () => void
  /** 스크롤 다운 시 축소 (56 → 48dp) */
  collapsed?: boolean
  hidden?: boolean                 // 키보드 표시 중 등
}
```
- 위치 `absolute`, `right: 16`, `bottom: tabBarHeight + 16` (원본 `right:20 / bottom:20`을 탭바 기준으로 조정).
- 아이콘은 `chatbot_logo.svg` — **주의: 이 파일은 540KB짜리 base64 PNG 래퍼**이고 진짜 벡터가 아니다. **결정: APK 크기를 위해 PNG 3배수(`@1x/@2x/@3x`, 각 56/112/168dp)로 재추출**하고 SVG는 번들에 넣지 않는다.
- 그림자: 원본 `drop-shadow(0 10px 20px rgba(15,23,42,0.25))` → `elevation="lg"`.
- **원본의 TOP 버튼(scrollY ≥ 280)은 이식하지 않는다.**

### CMP-23 `ProgressBar`

```tsx
export interface ProgressBarProps {
  /** 0~1. undefined면 indeterminate(무한 슬라이드) */
  progress?: number
  height?: 4 | 6 | 8               // default 6
  tone?: 'point' | 'brand' | 'success'
  showLabel?: boolean              // 우측에 '62%'
  testID?: string
}

export interface StepIndicatorProps {
  steps: { key: string; icon: ReactNode; label: string }[]
  activeIndex: number
  /** 완료 스텝 체크 표시 */
  completedIndices?: number[]
}
```
- `StepIndicator`는 원본 업로드 화면 `처리 과정` 4스텝(44dp 원, border `2px solid #0077B6`, bg `#F0F9FF`, 구분 `···`)의 수치를 그대로 계승한다.

### CMP-24 `DocImage`

```tsx
import type { ImageContentFit } from 'expo-image'

export interface DocImageProps {
  /** 상대경로면 IMAGE_BASE가 자동 prefix된다 (원본 fullImageUrl 규칙) */
  uri?: string | null
  width?: number | `${number}%`
  height?: number
  aspectRatio?: number             // height 대신 사용
  contentFit?: ImageContentFit     // 'cover' | 'contain' — 원본 objectFit 대응
  radius?: number
  /** 실패/부재 시 표시. default 아이콘 + '이미지가 없습니다' */
  fallback?: ReactNode
  fallbackText?: string            // default '이미지가 없습니다'  (원본 문구)
  /** 문서 유형별 기본 폴백 아이콘 선택 */
  docType?: DocumentType
  priority?: 'low' | 'normal' | 'high'
  /** 이미지 사방 4dp 매트 + surface.alt 프레임 + border.subtle 1px. default true */
  mat?: boolean
  testID?: string
}
```
- **이미지 픽셀에는 어떤 필터도 걸지 않는다**(§3-0 예외 7). 다크에서 흰 종이 문서가 배경에 직접 닿으면 경계가 눈부시므로 `mat`이 중간 휘도 완충층 역할을 한다. 밝기를 낮추는 필터는 문서 판독성을 훼손하므로 금지 — [[Design Tokens]] §10-5.
- `cachePolicy="memory-disk"`, `transition={200}`, `placeholder`는 blurhash 또는 `surface.alt` 단색(테마 토큰이므로 다크에서 회색 사각형이 번쩍이지 않는다). placeholder 색은 `className`을 못 쓰는 지점이라 `useTheme()`으로 얻는다(§3-0 N-6).
- `accessibilityIgnoresInvertColors`를 유지한다 — OS "색상 반전" 접근성 기능이 문서 이미지를 뒤집는 것을 막는다(앱 테마와 무관한 별개 기능).
- URL 정규화(원본 규칙 이식):
```ts
const IMAGE_BASE = (process.env.EXPO_PUBLIC_OCR_URL ?? '').replace(/\/+$/, '')
export const toAbsImageUrl = (raw?: string | null) =>
  !raw ? undefined
  : raw.startsWith('http') ? raw
  : `${IMAGE_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`
```
> 이미지는 Spring(:8080)이 아니라 **OCR 서버(:8000)가 정적 서빙**한다. API base와 별도 환경변수로 관리해야 한다. 원본은 보관함 4개 화면이 각자 `IMAGE_BASE`를 중복 선언했다 — 앱은 이 헬퍼 하나로 통일한다.

### CMP-25 `ZoomableImage`

```tsx
export interface BBoxOverlay {
  blockIndex: number
  bbox: number[][]                 // OCR 좌표계 (image_size 기준)
  text: string
  confidence: number
}

export interface ZoomableImageProps {
  uri: string
  /** OCR이 인식한 기준 크기. 없으면 실제 이미지 크기로 폴백 */
  sourceSize?: ImageSize
  overlays?: BBoxOverlay[]
  showOverlays?: boolean
  selectedBlockIndex?: number | null
  onSelectBlock?: (blockIndex: number | null) => void
  /** 오버레이 색 — 티켓은 #6746AF (원본 티켓 화면 값) */
  overlayColor?: string            // default '#0077B6'
  minScale?: number                // default 1
  maxScale?: number                // default 5
  onRequestClose?: () => void      // 아래로 스와이프
  testID?: string
}
```

### CMP-26 `OcrBlockList`

```tsx
export interface OcrBlockListProps {
  blocks: RawBlock[]
  selectedIndex?: number | null
  onSelect?: (blockIndex: number | null) => void
  /** 기본 접힘. 헤더 라벨은 'OCR 원문 {n}개' */
  collapsible?: boolean            // default true
  defaultExpanded?: boolean        // default false
  onCopyAll?: () => void
  testID?: string
}
```
- 칩: `fontFamily: 'monospace'`, 12px. 선택 시 bg `#E8F4FD` / border `#0077B6` / text `#0077B6` / weight 600, 비선택 bg `#F8FAFC` / border `#E2E8F0` / text `#505050` (원본 값 그대로).
- 신뢰도 표기 `{(confidence*100).toFixed(0)}%` (원본 포맷).

### CMP-27 `FieldRow`

```tsx
export type FieldAction = 'copy' | 'call' | 'sms' | 'email' | 'web' | 'map' | 'calendar'

export interface FieldRowProps {
  label: string
  value?: string | null
  /** 빈 값 표시. default '-'  (원본 규칙: (value||'-').trim()||'-') */
  emptyText?: string
  multiline?: boolean              // OCR 원문 등
  collapsible?: boolean            // multiline + 긴 텍스트
  actions?: FieldAction[]
  onAction?: (action: FieldAction, value: string) => void
  /** 우측 chevron + 탭 (명함 그룹 선택 등) */
  onPress?: () => void
  testID?: string
}
```
- 라벨 11/`#999`, 값 14/`#333`/lineHeight 22, 하단 보더 `#F1F5F9` (원본 `StorageDrawer` 값 보존).

### CMP-28 `FieldEditor`

```tsx
export interface FieldEditorSpec {
  key: string
  label: string
  editable: boolean
  multiline?: boolean
  required?: boolean
  kind?: 'text' | 'phone' | 'email' | 'url' | 'date' | 'time' | 'money' | 'zip'
}

export interface FieldEditorProps {
  spec: FieldEditorSpec
  value: string
  onChange: (key: string, value: string) => void
  error?: string
  inSheet?: boolean
  testID?: string
}

export interface FieldEditorGroupProps {
  specs: FieldEditorSpec[]
  values: Record<string, string>
  errors?: Record<string, string>
  onChange: (key: string, value: string) => void
  inSheet?: boolean
}
```
> `FieldEditorSpec`은 원본 `StorageDrawerField`(`{key?, label, value?, editable?, multiline?}`)를 계승하되 **`value`를 분리**했다. 원본은 스펙과 값이 한 객체에 섞여 있어 편집 중 리렌더가 전 필드에 번졌다. `kind`는 신규 — 키보드 타입과 검증 규칙을 결정한다.

**`kind`별 검증 (SCR-20에서 사용)**

| kind | 검증 | 에러 문구 |
|---|---|---|
| `date` | `/^\d{4}-\d{2}-\d{2}$/` | `날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)` |
| `time` | `/^\d{2}:\d{2}$/` | `시간 형식이 올바르지 않습니다. (HH:MM)` |
| `money` | 숫자·콤마·통화기호만 | `숫자만 입력해 주세요.` |
| `email` | 느슨한 이메일 패턴 | `이메일 형식이 올바르지 않습니다.` |
| `zip` | 5자리 숫자 | `우편번호는 5자리 숫자입니다.` |
| `required` | 공백 제거 후 길이 > 0 | `필수 항목을 입력해 주세요.` |

### CMP-29 `DocumentListItem`

```tsx
export interface DocumentListItemProps {
  docType: DocumentType
  imageUri?: string | null
  title: string
  subtitle?: string
  meta?: string
  /** 우측 상단 배지 (D-day, 금액 등) */
  trailingTop?: ReactNode
  trailingBottom?: ReactNode
  selected?: boolean
  onPress: () => void
  onLongPress?: () => void
  swipeActions?: SwipeAction[]
  testID?: string
}
```
- 썸네일 72×48 radius 6 (원본 보관함 행 값 보존), 행 높이 80.
- **제목 정규화 규칙은 원본 그대로 유지**: `title.replace(/\s*(명함|티켓|포스터|영수증)\s*$/, '')` — `'김도윤 명함'` → `'김도윤'`.

### CMP-30 `DocumentGridCard`

```tsx
export interface DocumentGridCardProps {
  docType: DocumentType
  imageUri?: string | null
  title: string
  subtitle?: string
  /** 이미지 우상단 오버레이 (D-day) */
  overlay?: ReactNode
  aspectRatio?: number             // 명함 4:3 / 포스터 3:4 (default 4/3)
  onPress: () => void
  onLongPress?: () => void
  testID?: string
}
```
- 원본 `StorageCard`가 (A)급 이식 대상이었으나 **구 다크 테마 스타일**(`bg-white/[0.02]`, `text-white`, `#FF8A3D`)이라 색을 **의미론적 토큰으로 전면 교체**한다(`bg-elevated` / `text-primary` / `border-subtle`). 구조(썸네일 + 제목 + 부제 + 메타)는 그대로. 원본의 다크 값이 v1 다크 팔레트와 무관한 이유: 그것은 폐기된 오렌지 테마의 잔재이고 우리 다크는 브랜드 hue를 보존한 신규 설계다([[Design Tokens]] §0 규칙 5, §10-1).
- 썸네일은 CMP-24의 `mat` 매트를 켠다 — 다크에서 흰 문서 이미지가 카드 배경에 직접 닿는 것을 막는다(§3-0 예외 7).
- 원본의 우상단 삭제 버튼(32dp, 문자 `X`)과 `ConfirmPopover`는 **제거** → 롱프레스 ActionSheet로 대체. Android에서 `overflow:visible` 팝오버가 부모 밖으로 렌더되지 않는 문제도 함께 해소된다.

### CMP-31 `DeadlineCard`

```tsx
export interface DeadlineCardProps {
  docType: 'POSTER' | 'TICKET'     // 마감 대상은 이 2종뿐 (서버 스케줄러 기준)
  title: string
  subtitle?: string                // 티켓은 transportType
  dateLabel: string                // 'MM.DD (요일)'
  dDay: number
  imageUri?: string | null
  onPress: () => void
  testID?: string
}
```
- 카드 280×120, radius 12, border `#CBD5E1`, elevation `sm`.
- 이미지 부재 시 이모지 폴백: 티켓 `🎫`, 포스터 `📄` (원본 규칙).

### CMP-32 `StatTile`

```tsx
export interface StatTileProps {
  icon: ReactNode | string         // 이모지 문자열 허용 (원본 📅 ⏰ 📄)
  iconBg: string
  iconFg: string
  label: string
  value: string | number
  unit?: string                    // '건'
  hint?: string                    // '예정된 일정'
  loading?: boolean                // true면 value 자리에 '-'  (원본 규칙)
  onPress?: () => void
  variant?: 'tile' | 'row'         // 홈 가로 스크롤 타일 / 설정 행
  testID?: string
}
```

### CMP-33 `Calendar`

```tsx
export interface CalendarEvent {
  id: string
  docType: 'TICKET' | 'POSTER'
  title: string
  /** ISO 'YYYY-MM-DD' */
  startDate: string
  endDate?: string                 // 포스터 기간 이벤트
  time?: string                    // 'HH:MM'
}

export interface CalendarProps {
  mode: 'week' | 'month'
  /** 표시 기준 날짜 'YYYY-MM-DD' */
  anchorDate: string
  selectedDate?: string | null
  events: CalendarEvent[]
  onSelectDate: (date: string) => void
  onChangeAnchor: (date: string) => void
  /** month 모드에서 셀당 최대 dot 수. 초과분은 '+N' */
  maxDots?: number                 // default 3
  loading?: boolean
  testID?: string
}
```
- 요일 헤더 `['일','월','화','수','목','금','토']`, 일요일 `#DC2626` / 토요일 `#2563EB` / 평일 `#999` (원본 `getWeekendColor()`).
- 오늘 셀: 원형 배지, 배경 = 요일 색(일 `#DC2626` / 토 `#2563EB` / 평 `#0077B6`), 흰 글씨 700.
- 선택 셀 배경 `#E8EDF3`. 이번달 아닌 날 `#CBD5E1`.
- 셀 높이 month 56 / week 64. **원본의 120px 셀, 기간 pill 라벨, `labelSpan` 로직은 폐기.**

### CMP-34 `ScheduleListItem`

```tsx
export interface ScheduleListItemProps {
  docType: 'TICKET' | 'POSTER'
  title: string
  time?: string
  dateRange?: string               // 포스터 '07.25~07.30'
  subtitle?: string
  onPress: () => void
  testID?: string
}
```
- 배경 = `useTheme().docType[docType].bg`, 유형 배지는 `bg.elevated` 표면에 `fg` 색 (원본 일정 패널 규칙 — 원본의 "흰 배경"은 라이트에서만 흰색인 표면 토큰으로 옮긴다).

### CMP-35 `SettingsRow`

```tsx
export interface SettingsRowProps {
  label: string
  description?: string
  /** 우측 요소. 셋 중 하나만 */
  value?: string                   // 읽기 전용 값
  chevronLabel?: string            // '변경' | '삭제' | '열기' | '보기'  (원본 라벨)
  toggle?: { value: boolean; onValueChange: (v: boolean) => void; busy?: boolean }
  segmented?: ReactNode
  pill?: { label: string; tone: Tone }   // '연동됨' | '미연동'
  tone?: 'default' | 'danger'      // danger면 배경 #FEFAFA
  disabled?: boolean
  onPress?: () => void
  testID?: string
}
```

### CMP-36 `SettingsSection`

```tsx
export interface SettingsSectionProps {
  title: string
  subtitle?: string
  icon?: ReactNode                 // 원본 titleIcon (UserRoundCog, Link, Database, Bell, Monitor, Info)
  children: ReactNode
  footer?: string
  testID?: string
}
```

### CMP-37 `SocialLoginButton`

```tsx
export type SocialProvider = 'google' | 'kakao' | 'naver'

export interface SocialLoginButtonProps {
  provider: SocialProvider
  onPress: (provider: SocialProvider) => void
  loading?: boolean
  disabled?: boolean
  testID?: string
}
```

**provider별 스펙 (원본 `SocialButtons.tsx` full variant 값 보존)**

| provider | 배경 | 텍스트 | 보더 | 라벨 | 아이콘 path |
|---|---|---|---|---|---|
| `google` | `#FFFFFF` | `#15293D` | `#505050` | `Google로 시작하기` | `p9a95980`(#4285F4) + `pffc4c00`(#34A853) + `p75ae700`(#FBBC05) + `p25a44c00`(#EA4335) |
| `kakao` | `#FEE500` | `#3C1E1E` | 없음 | `카카오로 시작하기` | `p37bfff00` (#3C1E1E) |
| `naver` | `#54CF48` | `#FFFFFF` | 없음 | `네이버로 시작하기` | `p3354e280` (#FFFFFF) |

- 버튼 h56 / radius 14 / gap 12 / 16·600. 아이콘 22×22, `viewBox="0 0 24 24"`.
- `accessibilityLabel` = `` `${providerName} 계정으로 시작하기` `` (원본 패턴).
- SVG path 문자열은 `lib/svgPaths.ts`를 그대로 복사해 `react-native-svg`에서 재사용한다.
- **결정: `variant='icon'`(원형 56dp 3개)은 이식하지 않는다.** 라벨 없는 원형 버튼은 provider 식별성과 접근성이 모두 떨어진다. 로그인·회원가입 모두 full로 통일.
- **[[Risks]]**: iOS App Store는 서드파티 소셜 로그인만 제공하는 앱에 **Sign in with Apple 추가를 사실상 요구**한다. 현재 백엔드에 Apple provider가 없다. APK 우선 프로젝트라 Phase 8 범위 밖이지만, iOS 확장 시 백엔드 작업이 선행되어야 한다.

### CMP-38 `ChatBubble`

```tsx
export type ChatRole = 'assistant' | 'user' | 'system'

export interface ChatBubbleProps {
  role: ChatRole
  text: string
  /** assistant 말풍선 상단의 고양이 귀 장식 (모라냥 아이덴티티) */
  showEars?: boolean               // default: role === 'assistant'
  onLongPress?: () => void         // 복사
  /** system 역할일 때 우측 하단 재시도 칩 */
  onRetry?: () => void
  testID?: string
}

export function TypingBubble(): JSX.Element   // '답변 작성 중...'
```

**말풍선 스펙 (원본 값 보존)**

| role | 정렬 | radius | 배경(토큰) | 텍스트(토큰) | 보더(토큰) |
|---|---|---|---|---|---|
| `user` | flex-end | `14/14/4/14` | `brand` (라이트 `#15293D`) | `text.inverse` | 없음 |
| `assistant` | flex-start | `14/14/14/4` | `bg.elevated` (라이트 `#FFFFFF`) | `text.primary` | `1px info.border` |
| `system` | center | `12` | `danger.faint` | `danger.strong` | `1px danger.border` |

> **원본 HEX 2개를 토큰으로 교체했다.** ① 사용자 말풍선 `#1D4ED8`은 [[Design Tokens]] §2가 **폐기한 값**이다(랜딩·설정에만 산발적으로 쓰인 두 번째 블루). 제출·확정 계열이므로 `brand`로 통일한다. ② 어시스턴트 말풍선 `#FFFFFF`를 리터럴로 두면 다크에서 대화창 절반이 흰 블록이 된다 — `bg.elevated`(다크 `#17202D`)로 받는다. 고양이 귀 장식도 같은 배경·보더 토큰을 상속해야 몸통과 이어져 보인다.

- 공통: `maxWidth: '84%'`, padding `10/12`, 13px, lineHeight 1.55.
- 고양이 귀: `top:0`에 `left:18`/`right:18`, 각 12×12, 배경 `bg.elevated`, `borderLeft`+`borderTop` `1px info.border`, `rotate(45deg)`, radius 2. RN에서는 `transform:[{rotate:'45deg'}]` + `borderTopWidth/borderLeftWidth`로 동일 재현 가능.

### CMP-39 `ChatComposer`

```tsx
export interface ChatComposerProps {
  value: string
  onChangeText: (text: string) => void
  onSend: () => void
  selectedType: SearchableType | null
  onSelectType: (type: SearchableType) => void
  sending?: boolean
  testID?: string
}
```

**placeholder 매핑 (원본 `DOCUMENT_TYPE_PLACEHOLDERS` 원문)**
```ts
export const CHAT_PLACEHOLDERS: Record<SearchableType, string> = {
  BUSINESS_CARD: '명함에서 찾고 싶은 내용을 입력하세요',
  TICKET:        '티켓에서 출발지나 날짜를 검색해보세요',
  POSTER:        '포스터에서 행사명이나 마감일을 검색해보세요',
  RECEIPT:       '영수증에서 가게명이나 금액을 검색해보세요',
}
export const CHAT_PLACEHOLDER_NONE = '문서 유형을 먼저 선택하세요'
```
- 전송 버튼 58×44 radius 12, 활성 `#15293D` / 비활성 `#94A3B8`, 라벨 `전송`.
- 비활성 조건(원본 그대로): `!selectedType || value.trim().length === 0 || sending`.
- 칩 레일은 원본 4열 grid 대신 가로 스크롤. 칩 h34 radius 999, 선택 `#1E3A8A`/흰글씨, 비선택 bg `#EFF6FF`/text `#1E3A8A`/border `#BFDBFE`.

### CMP-40 `SourceCard`

```tsx
export interface SourceCardProps {
  docType: SearchableType
  /** 챗봇 sources[]는 문서 DTO 그대로다. 유형별로 파싱해 title/subtitle을 만든다 */
  source: Record<string, unknown>
  onPress: (docType: SearchableType, id: string | number) => void
  testID?: string
}
```
- 카드 200×72, radius 10, border `#E2E8F0`, bg `#FFFFFF`. 가로 스크롤 레일에 배치.
- title/subtitle 추출 규칙은 [[Screen Specs]] SCR-23 표와 동일 함수를 공유한다.

### CMP-41 `SearchResultCard`

```tsx
export interface SearchFact { label: string; value: string }

export interface SearchResultCardProps {
  docType: SearchableType
  id: string | number
  imageUri?: string | null
  title: string
  subtitle?: string
  facts: SearchFact[]
  preview?: string
  /** 하이라이트할 검색어 — 첫 매칭만 강조 (원본 highlightText 규칙) */
  query?: string
  similarity?: number | null       // 0~1, 있으면 우상단 배지
  onPress: () => void
  testID?: string
}
```
- 하이라이트 스타일: `color #2563EB`, `fontWeight 700` (원본 값).
- 프리뷰는 `"… {preview} …"` 포맷, **2줄** 말줄임(원본은 1줄 nowrap).

### CMP-42 `RecentQueryList`

```tsx
export interface RecentQuery {
  id: string
  query: string
  documentType: SearchableType
  createdAt: string
}

export interface RecentQueryListProps {
  items: RecentQuery[]
  onSelect: (query: string, documentType: SearchableType) => void
  onRemove: (id: string) => void   // 로컬 제거만 (단건 삭제 API 없음)
  onClearAll: () => void
  loading?: boolean
  testID?: string
}
```

### CMP-43 `SortSheet`

```tsx
export interface SortOption<T extends string> {
  value: T
  label: string
}

export interface SortSheetOptions<T extends string> {
  title?: string                   // default '정렬'
  options: SortOption<T>[]
  selected: T
}

export function sortSheet<T extends string>(options: SortSheetOptions<T>): Promise<T | null>
```
- 화면별 옵션은 [[Screen Specs]] 참조. 검색은 원본 라벨 `최신순`/`관련도순`, 명함은 `등록일 순`/`오래된 순`을 그대로 쓴다.

### CMP-44 `NotificationItem`

```tsx
export type NotificationType = 'DEADLINE' | 'SCHEDULE' | 'GENERAL'

export interface NotificationItemProps {
  id: string
  type: NotificationType
  title: string
  message: string
  createdAt: string
  read: boolean
  onPress: () => void
  onDelete: () => void
  testID?: string
}
```
- 미읽음: 좌측 4dp 바 `#0077B6` + 배경 `#F0F9FF`. 읽음: 흰 배경.
- 아이콘: `DEADLINE` `⏰`/`#DC8540`, `SCHEDULE` `🎫`/`#6746AF`, `GENERAL` `🔔`/`#0077B6`.
- **메시지 정규화 필수**: `message.replace(/남았습니다입니다\.$/, '남았습니다.')` — 서버 `formatDDay()` 이중 어미 버그 대응.

### CMP-45 `GroupChipRail`

```tsx
export interface CardGroupChip {
  id: string | 'all' | 'ungrouped'
  name: string
  count?: number
}

export interface GroupChipRailProps {
  groups: CardGroupChip[]
  selectedId: string
  onSelect: (id: string) => void
  onManage: () => void             // 우측 ⚙ → SCR-22
  loading?: boolean
  testID?: string
}
```
- 고정 항목 2개는 항상 앞에: `{ id:'all', name:'전체 명함' }`, `{ id:'ungrouped', name:'미분류' }`. **원본의 `전체명함`(띄어쓰기 없음) 표기는 버그이므로 쓰지 않는다.**

### CMP-46 `SwipeableRow`

```tsx
export interface SwipeAction {
  label: string
  icon?: ReactNode
  tone: 'danger' | 'neutral' | 'point'
  onPress: () => void
}

export interface SwipeableRowProps {
  children: ReactNode
  rightActions?: SwipeAction[]     // 우→좌 스와이프로 노출
  leftActions?: SwipeAction[]
  /** 120dp 넘게 당기면 첫 액션 즉시 실행 */
  enableFullSwipe?: boolean        // default true (danger 액션일 때만)
  onSwipeOpen?: () => void
  testID?: string
}
```
- 액션 버튼 폭 80dp. 열림 시 `Haptics.selectionAsync()`, full swipe 트리거 시 `Haptics.impactAsync(Medium)`.

### CMP-47 `KeyboardAwareScreen`

```tsx
export interface KeyboardAwareScreenProps {
  children: ReactNode
  /** 하단 고정 액션바 (키보드 위로 따라 올라감) */
  footer?: ReactNode
  scrollable?: boolean             // default true
  /** 키보드 위 추가 여백 */
  extraBottomOffset?: number       // default 16
  contentContainerStyle?: StyleProp<ViewStyle>
  testID?: string
}
```
- `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"` + `automaticallyAdjustKeyboardInsets`(iOS). Android는 `android:windowSoftInputMode="adjustResize"` 전제.

### CMP-48 `SafeScreen`

```tsx
import type { Edge } from 'react-native-safe-area-context'

export interface SafeScreenProps {
  children: ReactNode
  edges?: Edge[]                   // default ['top','bottom']
  /** 배경. default theme.bg */
  background?: 'bg' | 'surface' | 'brand' | 'black'
  statusBarStyle?: 'auto' | 'light' | 'dark'
  /** G-5 오프라인 배너 자동 표시. default true */
  showOfflineBanner?: boolean
  testID?: string
}
```

### CMP-49 `ListFooterLoader`

```tsx
export interface ListFooterLoaderProps {
  loading: boolean
  hasMore: boolean
  /** 더 이상 없을 때 표시할 문구. 없으면 미표시 */
  endLabel?: string
  onRetry?: () => void
  error?: boolean
}
```

### CMP-50 `Logo`

```tsx
export interface LogoProps {
  /** mark = 심볼만, wordmark = MORA 텍스트만, full = 둘 다 */
  variant?: 'mark' | 'wordmark' | 'full'   // default 'full'
  size?: 24 | 36 | 64 | 96
  tone?: 'brand' | 'inverse'       // inverse = 흰색 (다크 배경)
  testID?: string
}
```
- 워드마크는 Patua One 400, letterSpacing 3 (원본 `--font-logo` 규격).
- **원본의 `filter: brightness(0) invert(1)` 반전은 RN에서 불가** → `react-native-svg`의 `fill` prop을 `tone`에 따라 분기한다. 라이트/다크 에셋 2벌을 만들지 않아도 된다.
- `tone`은 **테마가 아니라 자기가 놓인 배경**을 뜻한다. 다크 테마에서 `tone='brand'`는 `brand` 다크값(`#AEC4D8`)을 받고, 브랜드 채움 표면 위에서는 양 테마 모두 `tone='inverse'`다 — §3-0 예외 1.

### CMP-51 `ThemeModeSegment`

```tsx
// src/components/common/ThemeModeSegment.tsx
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeModeSegmentProps {
  /** 미지정 시 themeStore 를 직접 구독한다(권장). 지정 시 controlled */
  value?: ThemeMode
  onChange?: (mode: ThemeMode) => void
  /** 하단 힌트 문구 노출. default true */
  showHint?: boolean
  size?: 'sm' | 'md'               // CMP-12 에 그대로 전달. default 'md'
  testID?: string
}

export const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '시스템 따름' },
  { value: 'light',  label: '라이트' },
  { value: 'dark',   label: '다크' },
]
```
- 라벨은 위 3개 문자열이 정본이다([[Design Tokens]] §10-1). 기본값은 `system`.
- 힌트 문구: `system`일 때 `기기 설정을 따릅니다.`, 그 외 `기기 설정과 무관하게 {라벨}로 고정됩니다.` — 원본의 `다크 모드는 준비 중입니다.`는 **폐기**(v1에서 실제로 동작한다).
- 선택 즉시 `themeStore.setMode()` → MMKV `theme.mode` 동기 기록 → NativeWind `colorScheme.set()`. 화면 전체 crossfade 200ms + `Haptics.selectionAsync()`.
- 접근성: `accessibilityRole="radiogroup"`, 각 칸 `radio` + `accessibilityState={{ selected }}`. 세그먼트 3칸이므로 340dp에서도 한 칸 최소 44dp를 만족한다.
- **`Toggle`(CMP-11) 2택으로 만들지 않는다.** 2택은 OS 전역 다크 사용자를 존중하지 못한다 — 3택 채택 근거는 [[ADR-004 Styling]] §4.

### CMP-52 `ThemeScope`

```tsx
export interface ThemeScopeProps {
  children: ReactNode
  /** 이 서브트리에 강제할 스킴. 'light' 만 v1에서 사용한다 */
  force: 'light' | 'dark'
  /** 강제 표면을 배경으로 칠할지. default true (false면 색만 상속, 배경은 부모 유지) */
  paintBackground?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}
```
- 구현: NativeWind v4 `vars()`로 CSS 변수 한 벌을 서브트리에 덮고, 동시에 `ThemeContext`에 같은 `ThemeTokens`를 주입한다. 두 경로를 함께 덮지 않으면 `className`과 `useTheme()`이 서로 다른 색을 낸다([[Design Tokens]] §13-3).
- **사용 허용 지점은 §3-0 예외 목록에 등재된 것뿐이다.** 새 사용처를 늘리려면 그 표를 먼저 고친다 — 이 컴포넌트가 흔해지면 "테마는 토큰이 해결한다"는 규범 자체가 무너진다.
- 내부에 `StatusBar`·바텀시트·모달을 넣지 않는다. 그것들은 화면 루트에 붙어 있어 스코프 밖이며, 강제 스킴을 상속하지 않는다.

---

## 3. Variant / Size / State 매트릭스

### 3-0. 테마 축 규범 — variant가 아니라 토큰 참조

**규범: 테마(라이트/다크)는 컴포넌트의 variant 축이 아니다.** 아래 §3-1~3-5의 매트릭스는 `variant × size × state` **3축뿐이며 테마 축을 곱하지 않는다.** 색은 의미론적 토큰(`bg-elevated`, `text-primary`, `border-subtle` …)을 통과하고, 그 토큰이 CSS 변수 2벌로 테마별 값을 갖는다([[Design Tokens]] §10-3 / §13-2). 즉 **컴포넌트는 테마를 모르고, 테마 대응 작업량은 컴포넌트 수에 비례하지 않는다.**

| 규범 | 내용 |
|---|---|
| N-1 | 매트릭스에 적힌 HEX는 **라이트 값의 표기**다. 다크 값은 [[Design Tokens]] §10-3 대응표가 정본이며 같은 토큰 이름으로 자동 치환된다. **매트릭스를 테마별로 두 벌 쓰지 않는다** — 두 벌이 되는 순간 값이 어긋난다(§0-2 규칙 7) |
| N-2 | variant를 늘려 테마를 표현하지 않는다. `variant='primaryDark'` 같은 이름은 반려 대상이다 |
| N-3 | `dark:` variant로 색을 분기하지 않는다([[ADR-004 Styling]] §5-5). `dark:`는 색이 아닌 것(에셋 숨김, `borderWidth` 증감)에만 쓴다 |
| N-4 | pressed 방향이 테마별로 **반대**다 — 라이트 12% 어둡게 / 다크 12% 밝게(DK-06). 이것도 `*.pressed` 토큰이 흡수하므로 컴포넌트는 `bg-point-pressed` 하나만 쓴다 |
| N-5 | elevation은 라이트=그림자 / 다크=표면 밝기다(DK-02). 따라서 `elevation` prop을 쓰는 컴포넌트는 **배경 토큰을 항상 함께** 지정한다([[Design Tokens]] §10-6 규칙 1). 배경 없이 그림자만 주면 다크에서 고도가 사라진다 |
| N-6 | `className`을 못 쓰는 지점(Reanimated, 네이티브 헤더, `StatusBar`, `expo-image` placeholder, BottomSheet backdrop, SVG `fill`)은 **모듈 최상단 import가 아니라 `useTheme()`**을 통과한다. 최상단 import는 테마 변경에 반응하지 않는다 |

**규범의 예외 — 토큰으로 해결되지 않는 지점 (이 목록이 전부다)**

| # | 대상 | 예외 성격 | 처리 |
|---|---|---|---|
| 1 | CMP-50 `Logo` | `tone` prop | 반전 필터 불가(RN). `tone='brand'`는 테마 토큰을 따라가지만 **브랜드 채움 표면 위에서는 양 테마 모두 `inverse`(흰색)** — 즉 `tone`은 테마가 아니라 배경에 종속된다. 화면이 명시적으로 넘긴다 |
| 2 | CMP-22 `ChatFab` 챗봇 로고 | **항상 원본 래스터** | PNG 3배수(`@1x/@2x/@3x`) 컬러 이미지다. **반전·틴트 금지**(내부가 컬러 래스터라 망가진다). 다크에서는 `brand.container` 원형 배경 위에 올려 배경과 붙는 것을 막는다([[Design Tokens]] §10-5) |
| 3 | CMP-37 `SocialLoginButton` | **브랜드색 테마 무관 고정** | 카카오 `#FEE500`/`#3C1E1E`, 네이버 `#54CF48`, 구글 4색은 다크에서도 그대로다(DK-10, 플랫폼 브랜드 가이드 위반은 스토어 심사 리스크). 다크에서는 컨테이너에 `border.subtle` 1px만 덧댄다 — **N-3이 허용하는 `dark:` 용도(borderWidth)의 유일한 실사용 예** |
| 4 | CMP-01 `Button` 채움 라벨 | **라벨색이 테마별로 역전** | 라이트는 "짙은 채움 + 흰 라벨", 다크는 "밝은 채움 + 어두운 라벨"(DK-05: 다크 `action #4BA3DB` 위 흰 글자는 2.78:1로 무너진다). 토큰(`text.inverse`)이 흡수하지만 **`#FFFFFF` 하드코딩이 남아 있으면 다크에서만 대비 미달**이 된다 → §3-1 참조 |
| 5 | CMP-52 `ThemeScope` 대상 — SCR-12 이미지 영역 | **항상 라이트** | 화면 절반이 흰 종이 문서 이미지다. 컨테이너를 다크로 만들면 대비 충격 최대, 밝기 필터는 판독성 훼손 → 국소 예외([[Design Tokens]] §10-5) |
| 6 | CMP-02 `IconButton` `variant='overlay'` · CMP-20 `AppHeader` `transparent` | **항상 다크** | 카메라(SCR-09)·크롭(SCR-10)·뷰어(SCR-21) 크롬은 이미지 위 `rgba(0,0,0,0.4~0.5)` 오버레이다. 라이트 테마에서도 어둡고, 다크에서도 같다 — 테마를 따르면 라이트에서 아이콘이 사라진다 |
| 7 | CMP-24 `DocImage` 이미지 픽셀 | **필터 금지 + 매트 필수** | 이미지 자체에 밝기/틴트를 걸지 않는다. 대신 컨테이너를 `surface.alt` + `border.subtle` 1px + 사방 4dp 매트로 감싼다(다크에서 흰 종이가 배경에 직접 닿으면 경계가 눈부시다). `mat?: boolean` (default true) prop으로 노출 |
| 8 | CMP-13 `Skeleton` shimmer | 토큰 2개로 해결(예외 아님, 함정) | 하이라이트를 흰색 상수로 두면 다크에서 번쩍인다. `skeleton.base` / `skeleton.shimmer` 두 토큰을 쓰고 다크 대비는 1.21:1을 유지한다([[Design Tokens]] §10-5) |
| 9 | 로그인 일러스트 `illust.png` | **다크에서 렌더 안 함** | 라이트 전용 흰 배경 합성 이미지다. 다크는 로고 + 타이틀만 노출. 화면 레벨(SCR-03/04) 분기이며 컴포넌트가 아니다. UX-24가 이미 "키보드 등장 시 숨김"을 규정해 숨김 경로가 존재한다 |
| 10 | 앱 아이콘 · 적응형 아이콘 | 테마 무관 고정 | OS 관리 영역 |
| 11 | 스플래시 | **OS 테마만 따른다** | 네이티브 리소스라 `theme.mode`를 읽지 못한다. 라이트/다크 2장 번들. "OS=다크 + 사용자 선택=라이트"에서 1프레임 점프를 감수한다([[ADR-004 Styling]] §4) |

- 예외는 **11개가 전부**이고, 이 중 컴포넌트 신규가 필요한 것은 5번(CMP-52) 하나다. 나머지는 기존 prop(`tone`/`variant`/`transparent`/`mat`)으로 흡수된다.
- 예외를 늘리는 PR은 이 표에 행을 추가하고 [[Design Tokens]] §10-5와 일치시켜야 한다. **표에 없는 예외는 버그로 취급한다.**

### 3-1. CMP-01 `Button` — 4 variant × 3 size × 4 state

> **테마 축 없음(N-1).** 아래 HEX는 라이트 값이며 다크는 같은 토큰 이름으로 치환된다. **단 예외 4를 반드시 지킬 것** — `primary`/`danger`의 라벨은 `#FFFFFF` 리터럴이 아니라 `text.inverse` 토큰이어야 한다. 다크에서 채움색이 밝아지므로 라벨은 어두워진다(라이트 `#FFFFFF` / 다크 `#0F1621`, 6.53:1). 하드코딩하면 다크에서만 2.78:1로 무너진다.

**variant × state (배경 / 텍스트 / 보더)**

| variant | default | pressed | disabled | loading |
|---|---|---|---|---|
| `primary` | `#15293D` / `#FFFFFF` / — | `#0F1D2C` / `#FFFFFF` / — | `#CBD5E1` / `#FFFFFF` / — | `#15293D` opacity 0.6 / `#FFFFFF` + 스피너 |
| `secondary` | `#FFFFFF` / `#334155` / `1px #CBD5E1` | `#F8FAFC` / `#334155` / `1px #CBD5E1` | `#F8FAFC` / `#94A3B8` / `1px #E2E8F0` | 동일 + 스피너 |
| `ghost` | 투명 / `#0077B6` / — | `#F0F9FF` / `#0077B6` / — | 투명 / `#94A3B8` / — | 동일 + 스피너 |
| `danger` | `#DC2626` / `#FFFFFF` / — | `#B91C1C` / `#FFFFFF` / — | `#FECACA` / `#FFFFFF` / — | `#DC2626` opacity 0.6 + 스피너 |

> `primary`가 `#15293D`(brand)인 이유: 원본 `AuthForm` 제출 버튼이 `bg-[#15293d]`였고, 랜딩 CTA만 `#1D4ED8`였다. **결정: 제출·확정 액션 = brand 네이비, 보조 강조·링크 = point `#0077B6`.** 원본에 공존하던 두 블루 시스템(`#0077B6` vs `#3B82F6`)은 [[Design Tokens]]에서 `#0077B6`으로 통일했다.

**size (높이 / 좌우 패딩 / 폰트 / radius)**

| size | height | paddingH | 타이포 | radius | 용도 |
|---|---|---|---|---|---|
| `sm` | 36 | 14 | `button` 13/700 | 8 | 헤더 인라인, 칩형 액션 |
| `md` | 44 | 18 | `button` 15/700 | 10 | 시트 내부, 폼 보조 버튼 |
| `lg` | 52 | 20 | `button` 15/700 | 12 | 하단 고정 CTA, 인증 폼 |

- 인증 폼 제출 버튼만 원본 규격(h56 / radius 14)을 유지한다 — `size="lg"` + `authForm` 프리셋.
- `disabled`는 항상 `pointerEvents="none"` + `accessibilityState={{ disabled: true }}`.
- `pressed`는 `Pressable`의 `({pressed})` 콜백. 추가로 `transform: scale(0.98)` 100ms.

### 3-2. CMP-03/04 `TextField` / `PasswordField` — state

> **테마 축 없음(N-1).** 라이트 값 표기. 다크에서 주의할 곳은 `focused`의 보더 하나다 — 다크 `border.strong`/`action`이 표면 대비 3:1을 넘겨야 WCAG 1.4.11(비텍스트 경계)을 만족한다(DK-07). `border.strong #64748B`는 **양 테마 공용**으로 선정된 유일한 값이다.

| state | 배경 | 보더 | 텍스트 | 부가 |
|---|---|---|---|---|
| `default` | `#F8FAFC` | `1px #CBD5E1` | 값 `#111` / placeholder `#999` | — |
| `focused` | `#FFFFFF` | `1.5px #0077B6` | `#111` | 전환 150ms |
| `filled` | `#F8FAFC` | `1px #CBD5E1` | `#111` | clearable이면 ✕ 노출 |
| `error` | `#FEF2F2` | `1.5px #DC2626` | `#111` | hint가 `#DC2626`, 흔들림 200ms(translateX ±4) |
| `disabled` | `#F1F5F9` | `1px #E2E8F0` | `#94A3B8` | `editable={false}` |

- 높이 56(인증 폼) / 48(일반 폼). radius 14(인증) / 10(일반).
- 폰트 16/500/lineHeight 24 — **16 미만으로 내리지 않는다** (iOS가 포커스 시 화면을 확대한다).

### 3-3. CMP-06 `Chip` — tone × state

> **테마 축 없음(N-1).** 라이트 값 표기. `tone` 3종은 **맥락**(보관함/챗봇/중립)을 뜻하며 테마와 무관하다 — 테마를 tone으로 표현하려는 시도는 N-2 위반이다.

| tone | selected | unselected | disabled |
|---|---|---|---|
| `brand` | bg `#15293D` / `#FFFFFF` | bg `#FFFFFF` / `#334155` / border `#E2E8F0` | bg `#F1F5F9` / `#94A3B8` |
| `info` | bg `#1E3A8A` / `#FFFFFF` | bg `#EFF6FF` / `#1E3A8A` / border `#BFDBFE` | 동일 |
| `neutral` | bg `#E8EDF3` / `#15293D` | bg `#F8FAFC` / `#64748B` / border `#E2E8F0` | 동일 |

- size `sm` h28 / paddingH 10 / 12·600, `md` h34 / paddingH 12 / 13·700. radius 999.

### 3-4. CMP-07 `Badge` — docType × size

> **테마 축 없음(N-1).** 아래는 **대비 4.5:1을 통과하도록 보정된 라이트 값**이며([[Design Tokens]] §9), 다크 값은 §10-4가 정본이다. 배지는 이 앱에서 대비 미달이 가장 잘 생기는 지점이라 양 테마 모두 계산값이 표에 박혀 있다 — 값을 바꾸려면 대비비를 다시 계산해야 한다. 종전 이 표에 있던 원본값(POSTER `#0077B6` 4.1:1, RECEIPT `#4FB048` 2.1:1, DEADLINE `#DC8540` 2.6:1)은 **미달이므로 폐기**했다.

| docType | 토큰 | 라이트 fg / bg | 라이트 대비 | 다크 fg / bg | 다크 대비 |
|---|---|---|---|---|---|
| `BUSINESS_CARD` | `doc.card` | `#15293D` / `#E8EDF3` | 12.6:1 | `#AEC4D8` / `#1B2A3C` | 8.10:1 |
| `TICKET` | `doc.ticket` | `#6746AF` / `#E9E5FA` | 5.6:1 | `#C2B3E6` / `#2A2340` | 7.70:1 |
| `POSTER` | `doc.poster` | `#0069A0` / `#E8EDF3` | 5.1:1 | `#73B5DE` / `#12283A` | 6.76:1 |
| `RECEIPT` | `doc.receipt` | `#166534` / `#CFE5D0` | 5.4:1 | `#7BD69A` / `#16301F` | 8.08:1 |
| `ETC` | `text.body` / `surface.alt` | **`#334155`** / `#F1F5F9` | 9.45:1 | `#94A3B8` / `#232E3E` | 5.35:1 |
| (deadline) | `doc.deadline` | `#B45309` / `#FEF3E2` | 4.6:1 | `#E8B172` / `#33240F` | 7.83:1 |

> **결정 (ETC 배지 fg 교정) — 라이트 `#64748B` → `#334155`.** 종전 값 `#64748B`는 흰 배경에서는 4.76:1로 통과하지만([[Design Tokens]] §11-2) **배지 배경 `#F1F5F9` 위에서는 4.35:1로 미달**이다. 배지 텍스트는 10~12px 일반 텍스트라 기준이 4.5:1이므로 통과해야 한다. 새 HEX를 만들지 않고 팔레트에 이미 있는 `textBody #334155`(slate-700)를 재사용했다 — DK-09(새 HEX 최소화). 다크는 `text.muted #94A3B8` on `surface.alt`가 5.35:1로 통과하므로 그대로 둔다.

| size | padding | 타이포 | radius |
|---|---|---|---|
| `micro` | `2px 8px` | 10/700 | 6 |
| `sm` | `4px 8px` | 12/600 | 8 |

> 랜딩 목업의 영수증=빨강(`#FEE2E2`/`#991B1B`), 포스터=앰버(`#FEF3C7`/`#B45309`) 팔레트는 **채택하지 않는다.** 대시보드 `TYPE_COLORS`와 `globals.css` CSS 변수가 서로 일치하므로 그쪽이 정본이다.

### 3-5. CMP-17 `BottomSheet` — 화면별 snapPoints

| 사용처 | snapPoints | 스크롤 |
|---|---|---|
| SCR-19 문서 상세 | `['55%', '92%']` | O |
| SCR-09 촬영 도움말 | `['45%']` | X |
| SCR-15/19 그룹 선택 | `['40%', '70%']` | O |
| SCR-22 그룹 이름 입력 | `['32%']` (키보드 시 확장) | X |
| SCR-28 삭제 확인 | `['48%']` | X |
| SCR-24 챗봇 도움말 | `['58%']` | O |
| CMP-19 ActionSheet(Android) | 콘텐츠 높이 자동 | X |

---

## 4. 원본 컴포넌트 → 모바일 매핑

`frontend/components/` 18개 + 페이지 내부 인라인 컴포넌트 전량에 대한 판정.

### 4-1. `components/common/`

| 원본 | 판정 | 모바일 대응 | 이유 |
|---|---|---|---|
| `ChatbotWidget.tsx` (897줄) | **대체** | SCR-24 화면 + CMP-38/39/40/22 | 드래그 가능한 368×580 플로팅 패널은 모바일에 존재 이유가 없다(화면 폭 = 패널 폭). 드래그·clampPosition·resize·hover 툴팁·TOP 버튼 전량 폐기, 문구·색·말풍선 형상은 100% 보존 |
| `Nav.tsx` (119줄) | **폐기** | CMP-21 `TabBar` + CMP-20 `AppHeader` | 데스크톱 가로 헤더 + 앵커 스크롤은 모바일 IA와 무관. `#features` 오타 버그도 함께 소멸 |

### 4-2. `components/dashboard/storage/`

| 원본 | 판정 | 모바일 대응 | 이유 |
|---|---|---|---|
| `StorageCard.tsx` (68줄) | **이식(색만 교체)** | CMP-30 | 구조·간격 1:1 대응. 구 다크 테마 색(`bg-white/[0.02]`, `text-white`, `#FF8A3D`)을 의미론적 토큰으로 교체하면 라이트·다크가 함께 해결된다. `truncate`→`numberOfLines={1}`, `object-cover`→`contentFit="cover"` |
| `StorageGrid.tsx` (55줄) | **이식** | `FlashList` + CMP-14 | 로직 없이 레이아웃만 담당. `md:grid-cols-2`만 떼면 됨. 빈 상태 문자 `□`는 lucide 아이콘으로 교체 |
| `StorageDrawer.tsx` (313줄) | **대체** | CMP-17 + CMP-27/28 + SCR-19/20 | 420px 우측 드로어가 모바일에선 화면 108%. sticky 헤더(음수 마진)·ESC 닫기는 RN에 없다. **`StorageDrawerField` 타입은 `FieldEditorSpec`으로 계승** |
| `ConfirmPopover.tsx` (43줄) | **대체** | CMP-18 | 176px 앵커드 팝오버는 44dp 터치 타깃 미달 + Android `overflow:visible` 문제. 문구 `삭제하시겠습니까?` / `확인` / `취소`는 보존 |

### 4-3. `components/shared/`

| 원본 | 판정 | 모바일 대응 | 이유 |
|---|---|---|---|
| `AuthForm.tsx` (74줄) | **이식(시그니처 변경)** | SCR-03/04 화면 컴포넌트 | controlled 구조 그대로. `onChange(e)`→`onChangeText(text)`, `onSubmit(e)`→`onSubmit()`, `w-[415.5px]`→`width:'100%'` |
| `TextInput.tsx` (52줄) | **이식(단순화)** | CMP-03/04 | 4겹 absolute 레이어 → 1겹. inset shadow 폐기(RN 미지원). `type` prop 분기 대신 컴포넌트 2개로 분리 |
| `SocialButtons.tsx` (195줄) | **대체(시각은 이식)** | CMP-37 | 시각은 A급이나 OAuth 흐름이 근본적으로 다르다(`window.location.href` → `WebBrowser.openAuthSessionAsync`). SVG path 상수는 그대로 재사용 |
| `Divider.tsx` (21줄) | **이식(구현 변경)** | CMP-09 | 흰 배경으로 선을 덮는 트릭은 다크 모드에서 깨진다 → flex 3분할 |
| `Hero.tsx` (27줄) | **폐기** | CMP-50 `Logo` | `illust.png`가 **1.2MB**. 키보드가 올라오면 보이지도 않는 장식에 APK 1.2MB를 쓸 수 없다. 로고만 계승 |
| `FeatureChip.tsx` (30줄) | **폐기** | — | Hero 하단 플레이스홀더(점 하나). 온보딩에 흡수되며 소멸 |

### 4-4. `components/landing/` (6개)

| 원본 | 판정 | 이유 |
|---|---|---|
| `CTASection.tsx` · `FeatureSection.tsx` · `FooterSection.tsx` · `HeroSection.tsx` · `HowToSection.tsx` · `ProblemSection.tsx` | **전량 폐기** | **어디에서도 import되지 않는 죽은 코드**다. 구 다크 테마(`#FF8A3D` 오렌지 + `bg-white/5`) 잔재로, 현행 `app/page.tsx`와 디자인 언어가 다르다. 단 `FooterSection`의 저작권 문구 `© 2026 MORA. All rights reserved.`와 GitHub URL은 SCR-30으로 보존 |

### 4-5. 페이지 내부 인라인 컴포넌트

| 원본 | 위치 | 판정 | 모바일 대응 |
|---|---|---|---|
| `Row` / `Chevron` / `GhostButton` / `DangerButton` | `settings/page.tsx` | 대체 | CMP-35 (hover state 4종 → pressed) |
| `StatTile` | `settings/page.tsx` | 이식 | CMP-32 |
| `PasswordModal` / `NicknameModal` / `ConfirmModal` | `settings/page.tsx` | 대체 | SCR-26/27/28 화면 + CMP-18 |
| `PasswordInput` (`👁`/`🙈` 이모지) | `settings/page.tsx` | 대체 | CMP-04 (lucide `Eye`/`EyeOff`로 통일) |
| `LedgerHeader` / `LedgerRowComp` / `DetailDrawer` | `storage/receipts/page.tsx` | 폐기 | 8컬럼 테이블 + 목업 전용. CMP-29로 대체 |
| `Toggle` | `settings/page.tsx` | 이식 | CMP-11 (40×22 규격 보존) |
| `PhoneDashboard` / `PhoneReceiptDetail` / `UploadScreen` / `ParseScreen` / `ListScreen` / `LedgerScreen` | `app/page.tsx` | 폐기(에셋화) | 온보딩 목업 정적 PNG로 재촬영 |
| `renderBboxOverlay` | `upload/page.tsx` | 이식 | CMP-25 (스케일 기준을 `image_size`로 통일) |
| `PrimaryCTA` / `SecondaryCTA` / `SectionHead` | `app/page.tsx` | 대체 | CMP-01 |

### 4-6. 판정 요약

| 판정 | 개수 | 목록 |
|---|---|---|
| **그대로 이식(A)** | 7 | StorageCard, StorageGrid, AuthForm, TextInput, Divider, StatTile, Toggle |
| **모바일 관용구로 대체(B)** | 8 | ChatbotWidget, StorageDrawer, ConfirmPopover, SocialButtons, settings 모달 3종, LedgerRow, bbox 오버레이 |
| **폐기(C)** | 9 | Nav, Hero, FeatureChip, landing/* 6개, 랜딩 폰 목업 컴포넌트군 |

---

## 5. 서드파티 라이브러리 선정

### 5-1. 채택 목록

| # | 패키지 | 용도 | 사용 CMP | 대안 대비 근거 (1줄) |
|---|---|---|---|---|
| 1 | `expo-router` | 파일 기반 라우팅 | 전역 | React Navigation 직접 구성 대비 딥링크(`mora://auth/callback`) 설정이 파일 구조로 자동 해결된다 — OAuth 콜백이 이 앱의 핵심 요구사항 |
| 2 | `nativewind@4` | 스타일링 | 전역 | 원본이 Tailwind와 인라인 style을 반반 쓴다. NativeWind는 Tailwind 클래스를 그대로 받아 이식 비용이 가장 낮고, v4는 CSS 변수 기반이라 다크 모드 전환이 리렌더 없이 된다 |
| 3 | `@gorhom/bottom-sheet@5` | 바텀시트 | CMP-17, CMP-19(A), SCR-19/22/28 | RN `Modal` + 수동 PanResponder 대비 키보드 회피(`BottomSheetTextInput`)와 스냅 물리가 검증돼 있다. `react-native-modalize`는 유지보수가 정체됐다 |
| 4 | `react-native-reanimated@3` | 애니메이션 | CMP-13/17/22/46, 전역 전환 | `Animated`(JS 스레드) 대비 UI 스레드 실행이라 리스트 스크롤 중에도 60fps를 유지한다. 원본 `cubic-bezier(0.16,1,0.3,1)`을 `Easing.bezier` 동일 값으로 재현 가능 |
| 5 | `react-native-gesture-handler` | 제스처 | CMP-25/46, SCR-10 | Reanimated의 전제 의존이자, 크롭 핸들·핀치줌·스와이프 삭제가 전부 네이티브 제스처를 요구한다 |
| 6 | `@shopify/flash-list@2` | 리스트 가상화 | CMP-29/30/38/41/44 | `FlatList` 대비 셀 재활용으로 명함 수백 건 스크롤에서 메모리·드롭프레임이 유의미하게 낮다. `recyclerlistview` 직접 사용 대비 API가 `FlatList` 호환이라 학습 비용이 없다 |
| 7 | `expo-image` | 이미지 | CMP-24/25/30 | RN `Image` 대비 디스크 캐시(`memory-disk`)와 `transition` 내장. `react-native-fast-image`는 Expo Go 미지원 + 신규 아키텍처 대응이 늦다 |
| 8 | `@tanstack/react-query@5` | 서버 상태 | 전 데이터 화면 | 수동 `useEffect` 페칭 대비 stale-while-revalidate·낙관적 업데이트·무한 스크롤이 표준화된다. 원본이 화면마다 `isLoading/error/alive` 플래그를 중복 구현하던 문제를 근본 제거 |
| 9 | `zustand` | 클라이언트 상태 | 세션, 스캔 세션, 챗봇 대화 | Redux 대비 보일러플레이트가 없고, Context 대비 선택적 구독으로 리렌더가 좁다. 원본 `useSyncExternalStore` + window 이벤트 4종 구독 패턴의 자연스러운 대체 |
| 10 | `expo-secure-store` | 토큰 저장 | 인증 전역 | `AsyncStorage`는 평문이다. JWT를 Keychain/EncryptedSharedPreferences에 넣는 유일한 Expo 표준 경로 |
| 11 | `react-native-mmkv@3` | 환경설정 영속 | CMP-51, 테마·온보딩·뷰 모드·최근 검색어 | SecureStore는 용량 제한(2KB)·쓰기 비용이 있어 비민감 설정에 과하다. **AsyncStorage 대신 MMKV인 이유는 다크모드가 v1에 들어왔기 때문이다** — MMKV는 동기 읽기라 `theme.mode`가 부팅 **첫 프레임**에 복원되고, AsyncStorage는 rehydrate가 한 틱 늦어 다크 사용자에게 흰 화면이 번쩍인다([[Offline and State]] §1-3, [[Tech Stack]] PKG-17). v3는 New Architecture 필요 |
| 12 | `expo-camera` | 촬영 | SCR-09 | `react-native-vision-camera`가 성능은 낫지만 EAS 빌드 설정과 네이티브 코드 노출이 늘고, 이 앱은 정지 사진 1장만 찍는다 — 요구 대비 과잉 |
| 13 | `expo-image-picker` | 앨범 선택 | SCR-09 | 원본 `<input type="file">`의 유일한 모바일 등가물. 권한 흐름이 Expo 표준 |
| 14 | `expo-image-manipulator` | 크롭·회전·리사이즈 | SCR-10 | **Spring 10MB 한도 때문에 필수.** 별도 크롭 라이브러리(`react-native-image-crop-picker`)는 네이티브 모듈이 무겁고 Expo 관리 워크플로와 충돌 |
| 15 | `expo-web-browser` + `expo-auth-session` | OAuth | SCR-03/04/05, SCR-25(캘린더) | `WebView` 직접 구현 대비 `ASWebAuthenticationSession`/Custom Tabs를 써서 브라우저 세션 쿠키를 공유한다(이미 구글 로그인된 사용자의 재입력 방지) |
| 16 | `expo-linking` | 딥링크 | SCR-01/05 | 콜드 스타트 `getInitialURL()` + 러닝 중 리스너를 한 API로 처리 |
| 17 | `expo-haptics` | 햅틱 | 전역 | RN `Vibration` 대비 iOS Taptic Engine 패턴(selection/impact/notification)을 그대로 노출 |
| 18 | `react-native-safe-area-context` | 세이프에어리어 | CMP-48 | 사실상 표준. `react-navigation`의 전제 의존이기도 하다 |
| 19 | `lucide-react-native` | 아이콘 | 전역 | **원본이 lucide-react를 쓴다.** 18개 아이콘이 동일 이름으로 존재해 import만 바꾸면 된다(`Astroid` 제외 — 존재하지 않는 이름이라 `Sparkles`로 대체) |
| 20 | `react-native-svg` | 벡터 | CMP-37/50 | `lib/svgPaths.ts`의 소셜 로그인 path 문자열과 MORA 로고를 그대로 재사용 |
| 21 | `expo-font` | 폰트 | 전역 | Pretendard 4종 + Patua One. **원본 웹은 Pretendard를 선언만 하고 로드하지 않았다** — 앱이 의도대로 구현하는 개선점 |
| 22 | `expo-splash-screen` | 스플래시 | SCR-01 | 세션 부트가 비동기라 네이티브 스플래시 유지가 필수 |
| 23 | `@react-native-community/netinfo` | 오프라인 감지 | G-5, CMP-48 | react-query의 `onlineManager`와 연동해 오프라인 시 자동 재시도를 끈다 |
| 24 | `expo-clipboard` | 복사 | CMP-27/38 | 필드 값·챗봇 답변 복사. RN 코어에서 분리된 공식 대체 |
| 25 | `expo-application` + `expo-constants` | 앱 버전 | SCR-25 | 원본 하드코딩 `v1.2.3 (build 248)` 제거 |
| 26 | `date-fns` | 날짜 | CMP-33/44, 전역 | `moment` 대비 트리셰이킹으로 번들이 작고, `ko` 로케일로 `MM.DD (요일)`·상대시각 포맷을 원본과 동일하게 재현 |
| 27 | `zod` | 스키마 검증 | API 응답 파싱 | 서버가 `Page<>`/배열/`data` 키 누락을 섞어 내려준다. 런타임 검증 없이 옵셔널 체이닝만 쓰면 파싱 버그가 화면에서 터진다 |

### 5-2. 검토 후 **채택하지 않은** 것

| 패키지 | 대신 채택 | 기각 이유 |
|---|---|---|
| `react-native-toast-message` | 자체 CMP-16 | 토스트는 100줄 미만이고, 이 앱은 하단 탭바 높이에 맞춘 오프셋·햅틱 연동·액션 버튼이 필요해 커스터마이징 비용이 라이브러리 이점을 넘는다 |
| `react-native-vision-camera` | `expo-camera` | 프레임 프로세서·실시간 문서 검출을 쓰지 않는다. 정지 사진 1장에 네이티브 설정 부담을 질 이유가 없다 |
| `react-native-image-crop-picker` | `expo-image-manipulator` + 자체 크롭 UI | Expo 관리 워크플로에서 config plugin 충돌이 잦고, 우리 크롭 UI는 문서 특화 가이드(비율 프리셋)가 필요하다 |
| `redux-toolkit` | `zustand` + `react-query` | 서버 상태는 react-query가, 클라 상태는 6~7개 슬라이스뿐이다. RTK의 구조적 이점이 나올 규모가 아니다 |
| `react-native-skeleton-placeholder` | 자체 CMP-13 | MaskedView 의존이 Android에서 무겁다. opacity 펄스로 동일 효과를 낸다 |
| `react-native-calendars` | 자체 CMP-33 | 원본 캘린더는 문서 유형 dot·기간 이벤트·요일 색 규칙이 고유하다. 라이브러리 테마 오버라이드가 자체 구현보다 오히려 길어진다 |
| `axios` | `fetch` + 얇은 래퍼 | 원본 `lib/api.ts`가 이미 `fetch` 기반이고 로직을 그대로 옮긴다. 인터셉터는 래퍼 함수 하나로 충분하며 번들이 줄어든다 |
| `i18next` | 자체 문자열 상수 모듈 | Phase 7의 "다국어 준비"는 **문자열 외부화까지**가 범위다. 실제 다국어 출시 계획이 확정되기 전에 런타임 의존을 늘리지 않는다 |
| `@react-native-firebase/messaging` | (미채택) | **백엔드에 FCM 토큰 저장 컬럼·전송 코드가 전혀 없다.** 클라이언트만 넣으면 동작하지 않는 껍데기가 된다. [[Risks]]의 후속 과제 |
| `react-native-blur` | 불투명 색 | 원본 `backdropFilter: blur(20px)`는 랜딩 Nav에만 있었고, 배경이 이미 `rgba(11,21,33,0.9)`라 blur 없이도 시각 차이가 거의 없다 |
| `react-native-modal` | `@gorhom/bottom-sheet` + RN `Modal` | 시트가 필요한 곳은 gorhom이 더 낫고, 나머지는 코어 `Modal`로 충분하다 |
| `@react-native-async-storage/async-storage` | `react-native-mmkv` | **다크모드 v1 편입으로 기각되었다.** 비동기 읽기라 `theme.mode` 복원이 첫 프레임보다 늦어 매 실행 흰 섬광이 생긴다. 뷰 모드·필터도 같은 이유로 깜빡인다 |
| `react-native-appearance` | RN 코어 `useColorScheme` + nativewind `colorScheme` | RN 0.63+에 코어로 흡수되어 이미 deprecated다. 3택 오버라이드는 `themeStore`가 갖고 있으므로 OS 값만 읽으면 충분하다 |
| 테마 전용 UI 킷(`react-native-paper` 등) | 자체 CMP 52종 | 원본 디자인 언어(브랜드 네이비 + 액션 블루 + 문서 4종 색)를 덮어쓴다. 다크 팔레트를 새로 설계해야 하는 상황에서 라이브러리 테마 구조에 우리 토큰을 끼워 맞추는 비용이 직접 작성보다 크다 |

### 5-3. 페이즈별 도입 시점

| 페이즈 | 도입 패키지 | 변경 |
|---|---|---|
| **Phase 0** | expo-router, nativewind, react-native-reanimated, react-native-gesture-handler, react-native-safe-area-context, expo-splash-screen, expo-constants | — |
| **Phase 1** | expo-font, lucide-react-native, react-native-svg, @gorhom/bottom-sheet, expo-haptics, **react-native-mmkv**, **zustand** | 테마 3택 영속(`theme.mode`)과 `themeStore`가 Phase 1 산출물이므로 KV와 스토어를 앞으로 당겼다([[Offline and State]] 페이즈 배정표) |
| **Phase 2** | expo-secure-store, expo-web-browser, expo-auth-session, expo-linking, @tanstack/react-query, zod, **expo-image** | async-storage 제거(→ MMKV, §5-2). zustand는 Phase 1로 이동. expo-image는 CMP-24가 SCR-02 온보딩에서 첫 소비되므로 Phase 2 |
| **Phase 3** | expo-camera, expo-image-picker, expo-image-manipulator | — |
| **Phase 4** | @shopify/flash-list, expo-clipboard | expo-image가 Phase 2로 이동 |
| **Phase 5** | (신규 없음 — 기존 조합으로 구현) | — |
| **Phase 6** | date-fns, expo-application | — |
| **Phase 7** | @react-native-community/netinfo | — |

---

## 6. 구현 순서

### 6-1. Phase 0 (2종)

| 순서 | CMP | 선행 의존 |
|---|---|---|
| 1 | CMP-48 `SafeScreen` | react-native-safe-area-context |
| 2 | CMP-50 `Logo` | react-native-svg, expo-font(Patua One) |

이 2종만 Phase 0인 이유는 §0-4 규칙 C에 있다 — 없으면 SCR-01 껍데기와 SCR-31 진단 화면이 아예 뜨지 않는다. Phase 0의 색은 `tokens.ts` **라이트 값만** 있어도 되며(테마 배선은 Phase 1), `Logo`는 이 시점에 `tone` prop을 이미 갖고 시작한다.

### 6-2. Phase 1 (21종)

Phase 1에서 만들 컴포넌트를 의존 순서대로 나열한다. 각 항목은 **스토리북 없이** `app/(dev)/gallery.tsx`(개발 빌드에서만 노출되는 갤러리 화면)에서 전 variant를 **두 테마로** 눈으로 확인하고 완료 처리한다. **테마 시스템(0번)이 첫 항목인 이유: 이후 20종이 전부 그 위에서 검수되어야 하고, 나중에 끼우면 이미 만든 것을 다시 순회해야 한다.**

| 순서 | 산출물 | 선행 의존 |
|---|---|---|
| 0 | **테마 시스템** — `tokens.ts` light/dark 2벌 · `global.css` 생성 스크립트 · `ThemeProvider`/`useTheme()` · `themeStore`(MMKV `theme.mode`) | react-native-mmkv, zustand, nativewind ([[Design Tokens]] §13) |
| 1 | CMP-51 `ThemeModeSegment` (+ 갤러리 테마 토글) | 0번, CMP-12 |
| 2 | CMP-08 `Surface` · CMP-09 `Divider` | 토큰 |
| 3 | CMP-01 `Button` · CMP-02 `IconButton` | CMP-08, expo-haptics |
| 4 | CMP-03 `TextField` · CMP-04 `PasswordField` | lucide |
| 5 | CMP-06 `Chip` · CMP-07 `Badge` | 토큰 |
| 6 | CMP-12 `SegmentedControl` | reanimated |
| 7 | CMP-13 `Skeleton` · CMP-14 `EmptyState` · CMP-15 `ErrorState` | reanimated, lucide |
| 8 | CMP-16 `Toast` | reanimated, safe-area |
| 9 | CMP-17 `BottomSheet` | gorhom, gesture-handler |
| 10 | CMP-18 `ConfirmDialog` · CMP-19 `ActionSheet` | CMP-17, CMP-01, CMP-03 |
| 11 | CMP-20 `AppHeader` · CMP-21 `TabBar` | CMP-02, expo-router |
| 12 | CMP-47 `KeyboardAwareScreen` · CMP-49 `ListFooterLoader` | — |

> 순서 6이 1보다 뒤인데 CMP-51이 CMP-12를 쓰는 것은 모순이 아니다 — CMP-51은 1번에서 **3칸 고정** 형태로 먼저 세우고, 6번에서 `scrollable`·`size`·disabled 칸 등 일반 케이스를 완성한다. 테마를 바꿀 수단을 뒤로 미룰 수 없기 때문이다(§0-4 규칙 D).

**Phase 1에서 빠진 것과 그 이유** (종전 체크리스트에 있었으나 제거)

| CMP | 이동 | 이유 |
|---|---|---|
| CMP-10 `Avatar` · CMP-11 `Toggle` | → Phase 6 | 소비 화면이 전부 Phase 6이다(§1-I) |
| CMP-05 `SearchBar` | → Phase 5 | SCR-23 전용 |
| CMP-23 `ProgressBar` | → Phase 3 | SCR-11 전용 |
| CMP-24 `DocImage` | → Phase 2 | SCR-02가 첫 소비, `expo-image` 도입도 Phase 2(§5-3) |

### 6-3. Phase 1 완료 조건

- [ ] 위 12묶음(21종)이 갤러리 화면에서 **라이트/다크 양쪽**으로 렌더되고, 각 컴포넌트가 `default`·`pressed`·`disabled`·`loading`·`error` 상태를 모두 표시한다.
- [ ] 갤러리 상단 CMP-51로 `시스템 따름`/`라이트`/`다크`를 전환하면 **21종이 한 화면에서 동시에** 바뀐다(하드코딩 색이 남아 있으면 여기서 즉시 드러난다).
- [ ] 두 테마 모두에서 텍스트 조합 대비비가 본문 4.5:1 / 대형·비텍스트 3:1을 넘는다([[Design Tokens]] §10-3, §11-2).
- [ ] 앱을 강제 종료하고 재실행했을 때 선택한 테마가 **첫 프레임부터** 적용된다(흰 화면 깜빡임 0 — MMKV 동기 읽기 확인).
- [ ] `grep -rn "#[0-9A-Fa-f]\{6\}"` 결과가 `src/theme/tokens.ts`·`global.css` 외 0건이다.
- [ ] OLED 실기기 1대에서 갤러리 다크를 1회 육안 검수했다([[ADR-004 Styling]] 결과 부정 8의 완화 조건).
- [ ] `npm run theme:css` 재생성 diff가 0이다([[Design Tokens]] §13-0).

