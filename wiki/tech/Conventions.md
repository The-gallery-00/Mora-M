# Conventions

MORA 모바일 앱의 코딩 규약, 상태 배치 기준, 에러·로깅 규약, Git 규칙, 린트/포맷/타입 엄격도. 규칙마다 `CV-##` ID가 붙어 있으며 PR 리뷰에서 이 번호로 지적한다.

상위: [[Home]]
관련: [[Architecture]] · [[Directory Structure]] · [[Tech Stack]] · [[Design Tokens]] · [[API Contract]] · [[Data Model]] · [[Networking]] · [[Offline and State]] · [[QA Checklist]]

---

## 1. TypeScript 엄격도

`tsconfig.json` 확정값:

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

| ID | 규칙 | 이유 |
|---|---|---|
| CV-01 | `strict: true`. 개별 플래그를 끄지 않는다 | 서버 응답에 optional 필드가 많다(`similarity`, `imageUrl`, 날짜 전부 nullable). null 안전성이 이 앱의 주 결함 방지선이다 |
| CV-02 | `noUncheckedIndexedAccess: true` | `Page.content[0]`, `raw_blocks[i]`가 실제로 비어 있을 수 있다. 인덱스 접근 결과를 항상 `T \| undefined`로 취급 |
| CV-03 | `any` 금지. 모르면 `unknown` + 타입 가드 | 서버 `sources: Record<string, unknown>[]`처럼 진짜 모르는 값이 존재한다. `any`는 그 지점을 지워버린다 |
| CV-04 | `enum` 금지. `as const` 객체 + union 타입 | `DocumentType`은 서버 문자열과 1:1이어야 한다. TS enum은 런타임 객체를 만들고 문자열과 미묘하게 어긋난다 |
| CV-05 | non-null 단언(`!`) 금지. `??`, 옵셔널 체이닝, 조기 return 사용 | 서버는 `data` 키 자체를 생략한다(`@JsonInclude(NON_NULL)`). `!`는 그 지점에서 바로 터진다 |
| CV-06 | **와이어 타입과 도메인 타입을 분리**한다. `types/api.ts`(서버 그대로) → 매퍼 → `types/domain.ts`(앱 모델) | 같은 필드가 요청 `List<String>` / 응답 `String`이고, PK가 `UUID`(명함)와 `Integer`(티켓/포스터/영수증)로 갈린다. 하나의 타입으로 합치면 반드시 깨진다 |
| CV-07 | 날짜는 도메인 모델에서 **항상 `string`(ISO) 또는 `null`**. 서버의 `string \| number[]`는 매퍼에서만 다룬다 | `api.ts`에 `normalizeDateTime(value?: string \| number[])` 우회 코드가 실존한다(Jackson 타임스탬프 배열 직렬화 대비) |

---

## 2. 컴포넌트 · 훅

| ID | 규칙 | 예 |
|---|---|---|
| CV-08 | **인라인 `style={{}}`은 3가지 경우에만 허용**: ① Reanimated `useAnimatedStyle` 결과 ② 런타임 계산값(측정된 높이, SafeArea inset, 진행률 width) ③ 서드파티가 style prop만 받는 경우. 그 외 전부 `className` | 정적 스타일이 인라인으로 들어가면 원본 웹의 파편화(팔레트 5벌)를 그대로 재현하게 된다 |
| CV-09 | **색상·간격·반경·폰트 크기의 리터럴 하드코딩 금지.** 토큰 클래스(`bg-navy`, `text-mute`, `rounded-card`)만 사용. `#15293D`, `bg-[#0077B6]`, `p-[13px]` 전부 금지 | 원본은 HEX를 54회(`#15293D`), 69회(`#CBD5E1`) 하드코딩했고 페이지마다 다른 `const C = {...}`를 뒀다. 토큰 정본은 [[Design Tokens]] |
| CV-10 | 컴포넌트는 **함수 선언 + named export**. `React.FC` 금지, arrow 상수 금지 | `export function StorageCard(props: Props) {}`. `React.FC`는 children 타입을 암묵 주입해 실수를 숨긴다 |
| CV-11 | props 타입은 파일 상단 `type Props = { ... }`. 인라인 객체 타입 금지. 4개 초과면 그룹핑 검토 | 제네릭이 필요하면 `type Props<T extends BaseItem> = { ... }` (원본 `StorageCard<T>` 패턴 계승) |
| CV-12 | 이벤트 핸들러 prop은 `on` + 동사, 내부 함수는 `handle` + 동사 | `onDeleteClick` (prop) ↔ `handleDeleteClick` (구현). 원본 규약 계승 |
| CV-13 | **레이어 단방향 import.** L1→L2→L3→L4→L5. 역방향과 건너뛰기(L2가 L4 직접 호출) 금지 | ESLint `import/no-restricted-paths`로 강제. 레이어 정의는 [[Architecture]] §2-2 |
| CV-14 | 배럴 파일 금지 (예외: `src/features/<f>/index.ts`) | 근거는 [[Directory Structure]] §4-2 |
| CV-15 | 훅은 조건부·반복문 안에서 호출하지 않는다. `eslint-plugin-react-hooks` 규칙을 warn이 아니라 **error**로 | RN에서 훅 순서 붕괴는 재현 어려운 크래시로 나타난다 |
| CV-16 | 한 훅은 한 책임. 여러 mutation을 조율해야 하면 **조율 전용 훅**을 따로 만든다 | 예: `useScanFlow`가 `useCommitMutation` + `useSaveDocumentMutation`의 순서를 소유 |
| CV-17 | 훅 반환은 **객체**. 배열 반환은 인자 2개 이하의 프리미티브 훅만 | `const { data, isLoading, refetch } = useCardList()` |
| CV-18 | 사용자에게 보이는 문자열은 컴포넌트에 하드코딩하지 않고 `src/constants/copy.ts` 또는 feature `constants.ts`에 둔다 | Phase 7 다국어 준비의 전제. 원본 카피(예: `이미지가 없습니다`, `삭제하시겠습니까?`)를 문자 단위로 보존하기 쉬워진다 |
| CV-19 | 모든 터치 가능 요소에 `accessibilityRole` + `accessibilityLabel`, 최소 터치 타깃 44dp(`hitSlop` 허용) | 원본 삭제 버튼은 32×32였다. 모바일에서 그대로 두면 오조작 |
| CV-20 | 리스트는 `FlashList` + 안정적인 `keyExtractor`. `index`를 key로 쓰지 않는다 | 삭제/낙관적 업데이트 시 잘못된 행이 사라진다 |

---

## 3. 상태 배치 규칙

### 3-1. 판단 기준표 (위에서부터 순서대로 확인, 처음 걸리는 곳이 정답)

| # | 질문 | 예이면 | 도구 |
|---|---|---|---|
| 1 | 서버가 소유한 데이터인가? (목록·상세·검색결과·대시보드·알림) | **React Query** | `useQuery` / `useInfiniteQuery` / `useMutation` |
| 2 | 민감한가? (JWT, 유저 식별정보) | **SecureStore** + `authStore` 미러 | `expo-secure-store` |
| 3 | 앱 재시작 후에도 남아야 하고 민감하지 않은가? (테마, 뷰 모드, 최근 검색어, 필터) | **MMKV** (+ 필요 시 zustand persist) | `react-native-mmkv` **v4** — 인스턴스는 `createMMKV({ id })`, 삭제는 `remove()`. `new MMKV(...)`·`delete()` 는 v3 API이며 **동작하지 않는다** ([[Tech Stack]] PKG-17) |
| 4 | 서로 다른 라우트 2개 이상이 **동시에** 읽는가? | **zustand** | `src/store/` |
| 5 | 한 화면(또는 그 하위 트리) 안에서만 살아 있는가? | **useState / useReducer** | — |
| 6 | 값이 바뀌어도 다시 그릴 필요가 없는가? (타이머 id, 이전 값, 측정 오프셋) | **useRef** | — |

**금지:** 서버 데이터를 zustand에 복사해 두는 것. 캐시가 두 벌이 되는 순간 어느 쪽이 최신인지 아무도 모른다. 화면 간 전달이 필요하면 **id만 라우트 파라미터로 넘기고 각 화면이 같은 query key로 읽는다**.

### 3-2. MORA 실제 상태 배치표

| 상태 | 배치 | 키/스토어 | 비고 |
|---|---|---|---|
| JWT 토큰 | SecureStore | `mora_token` | 원본 키 이름 유지. 메모리 캐시는 `authStore.token` |
| 유저 프로필(id/email/name) | SecureStore | `mora_user` | 서버 최신값은 `useMe()`(API-03)가 별도로 가짐 |
| 로그인 여부 / 부팅 완료 | zustand | `authStore.status: 'booting'\|'authed'\|'guest'` | 스플래시 해제 조건 |
| 명함/티켓/포스터/영수증 목록 | React Query | `['documents', type, {groupId}]` | `useInfiniteQuery`, `Page.content` 사용 |
| 문서 상세 | React Query | `['document', type, id]` | 목록 캐시에서 `initialData` 시딩 |
| 명함 그룹 | React Query | `['cardGroups']` | API-20 |
| 대시보드 | React Query | `['dashboard', dateKey, deadlineDays]` | API-24 단일 호출 (원본 웹은 3개 조합) |
| 검색 결과 | React Query | `['search', type, q, topK]` | `staleTime` 짧게(60s) |
| 최근 검색어 | MMKV | `recent-search` (최대 10건) | 서버 히스토리(API-54)는 삭제(API-55)만 연결 |
| 알림 목록 / 미읽음 수 | React Query | `['notifications', page]`, `['notifications','unread']` | 폴링 간격은 [[Offline and State]] |
| 챗봇 대화 | useState (화면 로컬) | — | 서버에 세션 개념이 없다. 화면 이탈 시 폐기(원본 동작 동일) |
| 선택된 문서 유형 칩(챗봇) | useState | — | 미선택이면 전송 불가(원본 규칙 유지) |
| 스캔 1회분 임시 데이터 | zustand slice | `scanDraft` | 카메라 화면 → 리뷰 화면 두 라우트가 공유하므로 4번 규칙 |
| 보관함 뷰 모드(그리드/리스트) | MMKV | `storage-view-mode` | 재시작 후에도 유지 |
| 테마(light/dark) | MMKV + zustand | `themeStore` | 원본 `mora_settings_prefs.theme` 대응 |
| 알림 토글 설정 | React Query (서버) | `['notificationSettings']` | 원본 웹은 localStorage에만 저장했으나 **API-39/40이 이미 존재**하므로 서버로 승격 |
| 토스트 큐 | zustand | `toastStore` | 화면 밖(훅/서비스)에서도 띄워야 함 |
| 폼 입력값 | useState | — | 필드 12개까지는 `useReducer` 없이 단일 객체 state로 충분 |

### 3-3. React Query 기본 옵션 (확정)

```ts
// src/lib/query/client.ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (count, error) => isRetriable(error) && count < 3,
      retryDelay: (i) => Math.min(300 * 2 ** i, 4_000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: false, // RN에는 window focus가 없다. AppState는 useAppState가 담당
    },
    mutations: { retry: 0 }, // CV-25
  },
})
```

| ID | 규칙 |
|---|---|
| CV-21 | 쿼리 키는 `src/lib/query/keys.ts`의 팩토리로만 만든다. 문자열 배열을 화면에서 직접 조립하지 않는다 |
| CV-22 | 뮤테이션 성공 시 **무효화 대상을 명시적으로 나열**한다. `queryClient.invalidateQueries()`(전체 무효화) 금지 |
| CV-23 | 낙관적 업데이트는 삭제·토글·인라인 수정에만 적용하고, `onError`에서 반드시 롤백한다 |
| CV-24 | 목록 응답은 `Page`(`data.content`), 검색 응답은 배열(`data`)이다. 판별은 서비스 레이어에서 끝내고 훅 위로는 항상 `T[]`만 올린다 |
| CV-25 | **뮤테이션 자동 재시도 금지.** 서버가 중복 저장을 차단하지 않는다(`.hash_index.json`은 기록만 함). 재시도는 사용자가 버튼으로 |

---

## 4. 에러 처리 규약

### 4-1. 계약

- `src/lib/api/endpoints/*`는 **성공값을 반환하고, 실패는 예외를 throw**한다. 원본 웹 `api.ts`처럼 `{success:false,error}`를 반환하지 않는다 — React Query가 예외를 잡아 `isError`로 바꿔주기 때문에 호출부의 분기 코드가 사라진다.
- 예외 타입은 두 종류뿐이다.

| 타입 | 정의 위치 | 담당 범위 | 정본 문서 |
|---|---|---|---|
| `ApiError` | `src/lib/api/errors.ts` | 전송/HTTP 실패. kind: `network` `timeout` `canceled` `unauthorized` `ratelimited` `payload_too_large` `client` `server` `parse` | [[API Contract]] §5-3 |
| `AppError` | `src/services/errors.ts` | 기기·입력 실패. kind: `permission`(카메라/사진 거부) `validation`(클라이언트 검증) `unsupported`(ETC 등 저장 불가 유형) | 이 문서 |

| ID | 규칙 |
|---|---|
| CV-25a | HTTP 상태 → `ApiError.kind` 매핑은 `src/lib/api/errors.ts` **한 곳에서만** 수행한다. 화면·훅에서 `status === 401` 같은 숫자 비교를 하지 않는다 |
| CV-25b | `ApiError.serverMessage`는 **로그 전용** 필드다. UI 렌더 트리에 넘기지 않는다 (CV-26) |
| CV-25c | 새 에러 종류가 필요하면 kind를 늘리지 말고 기존 kind + `meta`로 표현할 수 있는지 먼저 검토한다. kind는 화면 분기 수와 1:1이다 |

### 4-2. 사용자 문구 매핑 (서버 문자열 절대 금지)

| ID | 규칙 |
|---|---|
| CV-26 | **서버 `error` 문자열을 UI에 그대로 노출하지 않는다.** 영/한이 혼재하고(`Login required` ↔ `사용자 ID가 필요합니다.`), mojibake 전례가 있다(원본 `runSearch` 주석). 상태코드 → 자체 문구로만 매핑 |
| CV-27 | 문구는 `src/constants/copy.ts`의 `ERROR_COPY`에 모은다 |
| CV-28 | 개발 빌드에서만 서버 원문을 토스트 하단에 회색 소자로 덧붙인다(디버깅용). 릴리스에서는 로그로만 |

| kind / status | 사용자 문구 | 표현 |
|---|---|---|
| `network` (Spring) | `서버에 연결할 수 없습니다. 네트워크와 서버 주소를 확인해 주세요.` | 오프라인 배너 + 재시도 |
| `network` (OCR) | `OCR 서버에 연결할 수 없습니다.` | 화면 내 에러 뷰 |
| `timeout` | `응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.` | 토스트 + 재시도 |
| `canceled` | (문구 없음) | 사용자가 취소한 것이므로 아무것도 표시하지 않는다 |
| `unauthorized` | `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` | 세션 파기 → `(auth)` replace |
| `ratelimited` | `요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.` | 토스트 |
| `payload_too_large` | `이미지 용량이 너무 큽니다. 다시 촬영해 주세요.` | 인라인 에러 (압축 가드가 뚫린 경우) |
| `client` | `요청을 처리할 수 없습니다.` | 인라인 에러 |
| `server` | `서버에서 문제가 발생했습니다.` | 에러 뷰 + 재시도 |
| `parse` | `응답을 이해하지 못했습니다.` | 에러 뷰 (로그 필수) |
| `permission` | `카메라 권한이 필요합니다.` + 설정 열기 CTA | 화면 상태 |
| `unsupported` | `지원하지 않는 문서 유형입니다.` (원본 문구 유지) | 인라인 안내 + 유형 변경 칩 |
| 부분 성공 (`success:true` + `message`) | 서버 `message` **그대로 노출** | 경고 톤 토스트 |

부분 성공만 서버 문자열을 그대로 쓴다. 이유: `임베딩 생성에 실패하여 Fuzzy 검색 결과만 반환합니다` 같은 안내는 서버만 아는 사실이고, 저장 자체는 성공이라 흐름을 끊으면 안 되기 때문이다(원본 `upload/page.tsx handleSave` 동작 계승).

### 4-3. 표현 위치

| ID | 규칙 |
|---|---|
| CV-29 | **화면 전체가 못 그려지면** `ErrorView`(재시도 버튼 포함), **일부만 실패하면** 인라인 에러, **동작 실패면** 토스트 |
| CV-30 | 파괴적 동작(삭제, 탈퇴, 전체 삭제)은 반드시 확인 다이얼로그 + `destructive` 스타일 + 성공 시 햅틱 `notificationAsync(Warning)` |
| CV-31 | 이미지 로드 실패는 **에러로 취급하지 않는다.** 플레이스홀더 + 문구 `이미지가 없습니다`(원본 문구 유지). 토스트 금지 |
| CV-32 | 각 탭 루트와 챗봇·스캔에 `ErrorBoundary`를 둔다. 앱 전체가 흰 화면이 되는 경로를 만들지 않는다 |
| CV-33 | `try { } catch {}` 빈 삼킴 금지. 최소한 `logger.warn(scope, err)` |

---

## 5. 로깅 규약

```ts
// src/utils/logger.ts 사용 형태
logger.info('scan', 'classify done', { type, confidence })
logger.warn('http', 'retrying', { path, attempt })
logger.error('save', err, { documentType })
```

| ID | 규칙 |
|---|---|
| CV-34 | `console.log` **금지**(ESLint error). `logger`만 사용. `console.warn`/`console.error`도 직접 호출 금지 |
| CV-35 | 레벨: `debug`(개발만) / `info`(주요 흐름 전이) / `warn`(회복된 이상) / `error`(사용자에게 실패로 보인 것). 릴리스 빌드는 `warn` 이상만 출력 |
| CV-36 | 첫 인자는 **scope 문자열** 고정: `auth` `http` `scan` `storage` `search` `chat` `dashboard` `settings` `notify` `boot` |
| CV-37 | **마스킹 필수.** JWT는 앞 4자+`…`, 이메일은 로컬파트 첫 글자만, 전화번호는 뒷 4자리만. OAuth 콜백 URL은 `token=` 파라미터를 통째로 `token=***`로 치환 | 
| CV-38 | OCR 원문(`rawOcrText`, `raw_blocks`)과 이미지 base64를 로그에 넣지 않는다. 개인정보이자 로그를 수백 KB로 부풀린다 |
| CV-39 | 네트워크 로그는 `method / path / status / ms`만. 요청·응답 바디는 `debug` 레벨에서만, 그것도 길이만 |
| CV-40 | 타이밍이 필요한 구간(스캔 전체, 압축, 업로드)은 `logger.time(scope, label)`로 감싼다. 성능 예산 검증([[QA Checklist]])의 입력 자료가 된다 |

---

## 6. Git

> 이 저장소의 브랜치 생성·커밋·푸시·머지는 **담당 팀원이 직접 수행**한다. 자동화 도구는 변경안 제안까지만 한다.

### 6-1. 브랜치

원본 팀 규칙(`MORA_wiki/Git Rules.md`)을 그대로 따른다.

| 브랜치 | 분기 | 머지 대상 | 용도 |
|---|---|---|---|
| `main` | — | — | 릴리스. 직접 push 금지 |
| `dev` | `main` | `main` | 개발 통합 |
| `feat/*` | `dev` | `dev` | 새 기능 |
| `fix/*` | `dev` | `dev` | 버그 수정 |
| `style/*` | `dev` | `dev` | UI/스타일 |
| `hotfix/*` | `main` | `main` + `dev` | 긴급 |

네이밍: **소문자 + 하이픈 + 영어**, `type/` 접두사 필수, 끝에 `-` + 영어 성 + 이름 첫 자.
예: `feat/scan-camera-kimm`, `fix/storage-infinite-scroll-kimm`, `style/tokens-migration-kimm`

머지 전략: `feat|fix|style → dev`는 **Squash and Merge**, `dev → main`과 `hotfix → main`은 **Merge Commit**.

### 6-2. 커밋 메시지

형식 `type(scope): subject` — 제목 50자 이내, 명령형, 한글 허용.

**type** (원본 `Commit Style.md` ∪ `Git Rules.md`)

| type | 용도 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 |
| `style` | UI/포맷 (로직 변경 없음) |
| `refactor` | 동작 동일, 구조 개선 |
| `perf` | 성능 |
| `test` | 테스트 |
| `chore` | 의존성/설정 |
| `ci` | 빌드/배포 |

**scope** — 원본 scope 중 모바일에도 존재하는 개념은 **이름을 그대로 계승**하고, 모바일 전용만 신설한다.

| scope | 대상 | 원본 대응 |
|---|---|---|
| `landing` | 랜딩/온보딩 | 동일 (`landing`) |
| `auth` | 로그인·회원가입·OAuth·세션 | 동일 (`auth`) |
| `dashboard` | 홈 대시보드 | 동일 (`dashboard`) |
| `upload` | 카메라·스캔·필드 편집·저장 | 동일 (`upload`) |
| `list` | 보관함 4종·상세·수정·삭제 | 동일 (`list`) |
| `search` | 통합 검색·최근 검색어 | 동일 (`search`) |
| `config` | 설정 파일, env, app.config | 동일 (`config`) |
| `chat` | AI 모라냥 | 신설 |
| `settings` | 설정 화면·프로필·데이터 삭제 | 신설 |
| `notify` | 알림 목록·로컬 알림 | 신설 |
| `ui` | 공통 컴포넌트·디자인 토큰 | 신설 |
| `nav` | 라우팅·딥링크·탭 구조 | 신설 |
| `net` | http 클라이언트·에러·재시도 | 신설 |
| `build` | EAS·keystore·APK·아이콘/스플래시 | 신설 (`ci`와 구분: 산출물 설정) |
| `a11y` | 접근성 | 신설 |
| `deps` | 패키지 버전 | 신설 |

여러 영역에 걸치면 scope 생략 가능.

예시:
```
feat(upload): 카메라 촬영 후 1280px 압축 파이프라인 추가
fix(net): scan 응답 이중 래핑 언랩 누락 수정
style(ui): 하드코딩 HEX를 토큰 클래스로 치환
chore(deps): expo install --fix 로 SDK 정렬
build(config): preview 프로파일 APK 산출 설정
```

### 6-3. PR 체크리스트

원본 5개 항목을 유지하고 모바일 항목을 추가한다.

```markdown
### 원본 공통
- [ ] 커밋 메시지가 컨벤션에 맞는가
- [ ] 기능이 정상 동작하는지 직접 테스트했는가
- [ ] 다른 기능에 영향을 주지 않는지 확인했는가
- [ ] 새 파일이 네이밍 컨벤션을 따르는가
- [ ] 불필요한 console.log / 주석을 제거했는가

### 모바일 추가
- [ ] `npx tsc --noEmit` 통과
- [ ] `npx eslint .` 통과 (warning 0)
- [ ] `npx expo-doctor` 통과 (의존성 변경이 있었다면)
- [ ] **실기기 1대**에서 해당 화면을 직접 확인했는가 (에뮬레이터만으로는 불충분)
- [ ] 색상/간격/폰트 리터럴 하드코딩이 없는가 (CV-09)
- [ ] 새 터치 요소에 accessibilityLabel과 44dp 타깃이 있는가 (CV-19)
- [ ] 로딩/빈 상태/에러 상태 3종을 모두 구현했는가
- [ ] 토큰·이메일이 로그에 노출되지 않는가 (CV-37)
- [ ] 네이티브 설정 변경 시 `app.config.js`에만 반영했는가 (`android/` 직접 수정 금지)
- [ ] app config를 `app.config.ts`로 되돌리지 않았는가 (eas-cli ↔ TypeScript 6 충돌 — [[Risks]] RSK-34)
- [ ] 의존성을 추가했다면 `npx expo install`로 넣었는가. `tailwindcss`가 3.4.x인가 (RSK-33)
- [ ] `.easignore`에 새 대용량 디렉터리를 추가해야 하는 변경인가 ([[APK Build]] §1-4)
```

**PR 크기:** 한 PR에 하나의 기능 또는 하나의 버그. 파일 변경 300줄 이하 권장(원본 규칙 계승). 초과하면 쪼갠다.

---

## 7. 린트 · 포맷 방침

### 7-1. ESLint

베이스: `eslint-config-expo`. 그 위에 프로젝트 규칙만 얇게 얹는다.

| 규칙 | 설정 | 이유 |
|---|---|---|
| `react-hooks/rules-of-hooks` | `error` | CV-15 |
| `react-hooks/exhaustive-deps` | `error` (기본 warn에서 승격) | RN에서 stale closure는 "가끔 저장이 안 됨" 형태로 나타나 재현이 어렵다 |
| `no-console` | `error` | CV-34 |
| `@typescript-eslint/no-explicit-any` | `error` | CV-03 |
| `@typescript-eslint/no-non-null-assertion` | `error` | CV-05 |
| `@typescript-eslint/consistent-type-imports` | `error` | `verbatimModuleSyntax`와 짝 |
| `import/order` | `error` (그룹 순서는 [[Directory Structure]] §4-1) | 디프 노이즈 제거 |
| `import/no-restricted-paths` | `error` | CV-13 레이어 강제 |
| `no-restricted-imports` | `error` — 배럴 경로, `react-native`의 `Text`/`Image` 직접 import 금지 | 텍스트는 토큰이 적용된 `@/components/ui/Text`, 이미지는 `expo-image` 사용 강제 |
| `no-restricted-syntax` | `error` — 문자열 리터럴 색상(`/#[0-9a-fA-F]{3,8}/`)이 `className`/`style` 위치에 나타나면 거부 | CV-09를 사람이 아니라 도구가 잡게 한다 |

**경고를 남기지 않는다.** `--max-warnings=0`으로 실행한다. 억제가 필요하면 `// eslint-disable-next-line <rule> -- 이유` 형태로 **이유를 반드시 적는다**(이유 없는 disable은 리뷰에서 반려).

### 7-2. Prettier

```jsonc
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "all",
  "arrowParens": "always",
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindFunctions": ["cn", "clsx", "cva"]
}
```

- `semi: false` / `singleQuote: true`: 원본 프론트엔드 다수 파일의 스타일과 일치시켜 이식 시 디프를 줄인다.
- `printWidth: 100`: RN의 className 문자열이 길다. 80은 줄바꿈이 과하다.
- `prettier-plugin-tailwindcss`: 클래스 순서를 도구가 결정해 리뷰에서 다투지 않는다.

### 7-3. 스크립트

```jsonc
// package.json
"scripts": {
  "lint": "eslint . --max-warnings=0",
  "format": "prettier --write .",
  "typecheck": "tsc --noEmit",
  "verify": "npm run typecheck && npm run lint && npx expo-doctor",
  "android": "expo run:android",
  "build:apk": "eas build -p android --profile preview"
}
```

`npm run verify`가 PR 전 필수 게이트다. Git hook은 강제하지 않는다 — 팀원이 소스트리로 직접 커밋하므로, 훅으로 커밋을 막기보다 **PR 체크리스트로 확인**하는 편이 실제 워크플로와 맞는다.

---

## 8. 주석 규약

| ID | 규칙 |
|---|---|
| CV-41 | 주석은 **"왜"**를 적는다. "무엇"은 코드가 이미 말한다 (원본 규약 계승) |
| CV-42 | 서버 기벽에 대응하는 우회 코드에는 **반드시** 근거 주석을 남긴다. 예: `// Spring이 Python 응답을 다시 감싸 이중 래핑됨 (OcrService.scan)` |
| CV-43 | `TODO`는 이슈 번호와 함께만 남긴다: `// TODO(#123): ...`. 번호 없는 TODO 금지 — 원본에는 번호 없는 TODO가 9건 방치되어 있다 |
| CV-44 | 원본 웹에서 문구·정규식·상수를 그대로 옮긴 경우 출처를 한 줄로: `// 원본: frontend/components/.../StorageCard.tsx` |
