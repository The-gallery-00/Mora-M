# Offline and State

앱의 상태를 4계층으로 나누고 각 계층의 도구·설정값·MMKV 키·오프라인 동작·낙관적 업데이트 규칙을 확정한다.

상위: [[Architecture]]
관련: [[ADR-005 State and Data]] · [[Networking]] · [[API Contract]] · [[Camera and Scan]] · [[Auth]] · [[Conventions]] · [[Data Model]] · [[Design Tokens]] · [[Mobile UX Guide]] · [[Tech Stack]]

---

## 0. 이 문서의 ID 체계

| 접두사 | 대상 |
|---|---|
| `ST-##` | 상태 계층 정책 · MMKV 키 정책 · 검색 상태 특례 (ST-01 ~ ST-14) |
| `QK-##` | 쿼리 키 · 캐시 정책 |
| `OPT-##` | 낙관적 업데이트 대상 |
| `RVL-##` | 포그라운드 복귀 재검증 대상 |
| `OFF-##` | 오프라인 동작 규칙 |

---

## 1. ST-01 상태 분류 정책표

| 계층 | 정의 | 도구 | 영속 | 대표 예 |
|---|---|---|---|---|
| **서버 상태** | 서버가 소유하고 앱은 캐시만 갖는 데이터 | **TanStack Query v5** | 선택적 (§6) | 명함·티켓·포스터·영수증 목록/상세, 대시보드, 알림, 검색 결과, `GET /auth/me` |
| **전역 클라이언트 상태** | 여러 화면이 공유하고 서버에 없는 데이터 | **zustand** (+`persist` 미들웨어) | 스토어별 | 세션(토큰·유저), 스캔 초안, 테마·목록/그리드 토글, 최근 검색어 로컬 미러, 전역 토스트/시트 |
| **화면 로컬 상태** | 한 화면 밖으로 안 나가는 임시 상태 | `useState` / `useReducer` | 없음 | 탭 인덱스, 시트 열림, 필터 칩 선택, 스켈레톤 플래그 |
| **폼 상태** | 입력·검증·더티 추적 | **react-hook-form + zod** | 스캔 초안만 | 로그인/회원가입, 스캔 필드 편집, 문서 인라인 수정, 프로필 변경 |

### 1-2. ST-02 분류 원칙 (경계가 애매할 때의 판단 기준)

1. **서버에서 다시 가져올 수 있으면 서버 상태다.** zustand에 복사해 두지 않는다. 중복 소스는 반드시 어긋난다.
2. **서버 상태를 파생한 값은 저장하지 않는다.** `useMemo`로 계산한다(예: 문서 총 개수, D-Day, 그룹별 명함 수).
3. **화면 3개 이상이 읽으면 전역, 아니면 로컬.** 두 화면이면 라우트 파라미터로 넘긴다.
4. **폼 값은 폼 라이브러리 밖으로 새어 나가지 않는다.** 유일한 예외가 스캔 초안(§7-3)이다.
5. **토큰은 어떤 스토어에도 평문으로 남기지 않는다.** `expo-secure-store`가 정본이고 zustand에는 `hasSession: boolean`과 유저 표시 정보만 둔다 — 상세는 [[Auth]].

### 1-3. ST-03 zustand 스토어 목록

| 스토어 | 내용 | persist | 저장소 |
|---|---|---|---|
| `authStore` | `status: 'loading'\|'authed'\|'guest'`, `user: {id,email,name,picture}` | 부분 (`user`만) | MMKV `default`. 토큰은 SecureStore |
| `scanDraftStore` | `{ imageUri, imageBytes, documentType, confidence, parsed, fields, rawBlocks, editedFields, committedImageUrl, updatedAt }` | 전체 | MMKV `default` |
| `themeStore` | `mode: 'system'\|'light'\|'dark'`, `scheme: 'light'\|'dark'`(파생) | `mode`만 | MMKV `default` — 키 `theme.mode` |
| `prefsStore` | `storageViewMode: Record<DocTypeKey,'list'\|'grid'>`, `lastDocType: DocTypeKey\|'ALL'`, `recentQueries: {q,docType,at}[]`(최대 10) | 전체 | MMKV `default` |
| `uiStore` | 토스트 큐, 전역 시트, 오프라인 배너 표시 여부 | 없음 | — |

`scanDraftStore`가 persist인 이유는 §5-4에서 설명한다. 테마가 `prefsStore`가 아니라 **별도 스토어**인 이유는 §1-4 결정 2에서 설명한다.

**결정: 영속 저장소는 AsyncStorage가 아니라 MMKV다.** 근거 — [[Tech Stack]]이 AsyncStorage를 기각한 이유가 그대로 적용된다: AsyncStorage는 비동기라 부팅 첫 프레임에 테마·뷰모드·필터가 늦게 적용되어 **깜빡인다.** MMKV는 동기 읽기라 스토어 초기화 함수 안에서 값을 바로 꺼낼 수 있고, rehydrate 단계 자체가 없다. 인스턴스는 `default`(설정·플래그, 영구)와 `cache`(React Query persist, 폐기 가능) 2개다 ([[Data Model]] §6-2).

> **버전 주의 — `react-native-mmkv` v4.3.2 (Nitro)** — 인스턴스 생성이 `new MMKV({...})` 가 아니라 **`createMMKV({ id })`**, 키 삭제가 `.delete()` 가 아니라 **`.remove()`** 다. `react-native-nitro-modules` 피어가 필요하다. API 표 정본은 [[Data Model]] §6-2. **이 문서와 다른 문서의 옛 예시가 v3 문법으로 남아 있으면 그것이 틀린 것이다.**

### 1-4. ST-08 MMKV 키 목록 (상태 계층이 소유하는 키)

저장소 전체 인벤토리(SecureStore·이미지 캐시 포함)의 정본은 [[Data Model]] §6-2다. 아래는 **이 문서의 상태 정책이 직접 소유·갱신하는 키**만 타입·기본값·수명까지 확정한 표다.

| 키 | 인스턴스 | 타입 | 기본값 | 수명 / 정리 시점 | 소유 정책 |
|---|---|---|---|---|---|
| `theme.mode` | `default` | `'system' \| 'light' \| 'dark'` (문자열 그대로. JSON 래핑 안 함) | **`'system'`** | **영구.** 로그아웃·계정 전환·캐시 삭제에도 유지. 앱 삭제 시에만 소멸 | [[Design Tokens]] §13-4 · [[Mobile UX Guide]] UX-29 |
| `search.lastDocType` | `default` | `'BUSINESS_CARD' \| 'TICKET' \| 'POSTER' \| 'RECEIPT' \| 'ALL'` | **`'BUSINESS_CARD'`** (최초 실행) | **영구.** 검색 실행마다 덮어쓴다. 로그아웃 시 삭제 — 계정마다 주로 찾는 문서가 다르다 | §10-1 ST-09 |
| `storage.viewMode` | `default` | JSON `Record<DocTypeKey, 'list'\|'grid'>` | `{BUSINESS_CARD:'list', RECEIPT:'list', POSTER:'grid', TICKET:'grid'}` | 영구 | [[Mobile UX Guide]] UX-06 |
| `search.recent` | `default` | JSON `{q: string; docType: DocTypeKey\|'ALL'; at: number}[]` (최대 10) | `[]` | **30일** 경과 항목 부팅 시 정리. 로그아웃 시 삭제 | §10 ST-06/ST-07 |
| `scan.draft` | `default` | JSON `ScanDraft \| null` | `null` | **24시간**(§5-4 유효성 판정 기준). 저장 성공·사용자 폐기 시 삭제 | §5-4 OFF-08 |
| `cache.query` | `cache` | 문자열 (React Query persister 직렬화) | 없음 | **24시간** (§6 `maxAge`). `buster` 불일치 시 전량 폐기 | §6 QK-04 |

**기존 문서와의 값 충돌 정리** — 위 표를 쓰면서 발견한 어긋남 2건을 여기서 확정한다.
1. `scan.draft` 수명: 이 문서 §5-4는 **24시간**, [[Data Model]] §6-2는 72시간. → **24시간 채택.** JWT 수명이 24시간이고 리프레시 토큰이 없으므로(§5-2 이유 3) 그 이상 보관한 초안은 복구 시점에 전량 401로 실패한다. 사용자에게 "이어서 저장"을 제안했는데 로그인부터 다시 하게 만드는 것이 더 나쁘다.
2. `search.recent` 상한: ST-06과 [[Conventions]]는 **10건**, [[Data Model]] §6-2는 20건. → **10건 채택.** 최근 검색어는 화면에 칩으로 노출되며 11건 이상은 스크롤 없이 보이지 않아 저장 의미가 없다.
두 값은 [[Data Model]] 쪽 표기를 이 표에 맞춰 정정해야 한다.

**결정 1 — 값을 JSON으로 감싸지 않는다(`theme.mode`, `search.lastDocType`).** 두 키는 단일 스칼라이므로 `kv.getString(key)` 한 번으로 끝난다. `zustand/persist`를 쓰면 값이 `{state:{...},version:n}`으로 감싸여 (a) 첫 프레임에 rehydrate가 한 틱 늦고, (b) 키 하나에 값 하나라는 계약이 깨진다. 읽을 때 `isMode()` 같은 좁히기 가드로 오염된 값을 기본값으로 되돌린다 — MMKV 파일은 사용자가 손댈 수 없지만 **앱 버전 간 열거형 변경**으로 옛 값이 남을 수 있다.

**결정 2 — `theme.mode`를 묶음 JSON(`mora.settings.prefs`)에서 분리해 평면 키로 둔다.** 이유: 묶음 JSON은 한 필드만 바꿀 때도 전체를 읽고 다시 쓴다. 테마 변경과 뷰모드 변경이 인접해 발생하면 나중 쓰기가 앞선 쓰기를 덮어써 한쪽이 유실된다(read-modify-write 경쟁). 테마는 앱 크롬 전체(StatusBar·NavigationBar·스플래시 배경)를 좌우하는 값이라 유실 비용이 가장 크다. → [[Data Model]] §6-2의 `mora.settings.prefs.theme` 필드는 이 키로 대체된다.

**결정 3 — 로그아웃 시 `theme.mode`는 유지하고 `search.lastDocType`은 삭제한다.** 테마는 기기 취향(사람이 아니라 눈의 문제)이고, 마지막 검색 유형은 계정별 사용 패턴이다. 다른 계정으로 로그인했을 때 앞 사람의 검색 기본값이 남아 있으면 "왜 명함이 아니라 영수증이 선택돼 있지?"가 된다. [[Data Model]] §6-5 로그아웃 정리 표에 두 키를 각각 유지/삭제 열로 반영해야 한다.

---

## 2. QK-01 TanStack Query 전역 설정 (확정값)

```ts
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,              // 30초. 키별 재정의는 §3 표
      gcTime: 30 * 60_000,            // 30분. persist maxAge(24h)와 별개
      retry: (failureCount, error) => {
        const s = (error as ApiError).status;
        if (s === 401 || s === 403) return false;   // 세션 문제는 전역 핸들러가 처리
        if (s !== undefined && s >= 400 && s < 500) return false; // 4xx 재시도 무의미
        return failureCount < 2;                     // 네트워크/5xx 만 최대 2회
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000), // 1s → 2s → 4s(상한 8s)
      refetchOnWindowFocus: true,     // focusManager 를 AppState 에 연결해 동작 (§8)
      refetchOnReconnect: true,       // onlineManager 를 NetInfo 에 연결 (§8)
      refetchOnMount: true,
      networkMode: 'online',          // 오프라인이면 fetch 를 시도조차 하지 않고 캐시를 노출
      throwOnError: false,            // 화면별 ErrorState 로 처리. 전역 ErrorBoundary 는 렌더 오류 전용
      structuralSharing: true,
    },
    mutations: {
      retry: 0,                       // §2-1
      networkMode: 'online',
      gcTime: 5 * 60_000,
    },
  },
});
```

### 2-1. 각 값의 근거

| 값 | 이유 |
|---|---|
| `staleTime: 30_000` | 문서 보관함은 사용자 본인만 쓰는 단일 소유 데이터라 서버에서 몰래 바뀌지 않는다. 탭을 오가며 매번 재요청하면 Hikari pool `maximum-pool-size: 3`인 서버를 불필요하게 압박한다. 30초는 "저장 직후 다른 탭에서 보면 이미 반영되어 있다"를 무효화 호출로 보장하고, 그 외 이동은 캐시로 처리하는 균형점 |
| `gcTime: 30분` | 탭 전환·상세 진입/이탈을 반복해도 목록이 살아 있게 한다. 메모리 상한은 이미지가 지배하므로(§7) 쿼리 캐시 30분은 안전 |
| `retry` 4xx 차단 | 서버가 404를 쓰지 않고 존재하지 않는 리소스도 500으로 던지는 구조라(04-api §2-3) 5xx 재시도는 의미가 있지만 4xx는 100% 재현된다 |
| `retry` 최대 2회 | LAN 직결 환경에서 Wi-Fi 로밍으로 인한 순간 단절이 주된 실패 원인이다. 3번째 시도까지 가면 7초가 넘어 사용자가 먼저 이탈한다 |
| `refetchOnWindowFocus: true` | RN에는 window focus가 없으므로 `focusManager`를 `AppState`에 연결한다(§8). staleTime이 게이트 역할을 하므로 30초 내 재진입은 요청이 나가지 않는다 |
| `networkMode: 'online'` | `'always'`로 두면 오프라인에서 fetch가 실패하며 쿼리가 `error`가 되어 **캐시가 화면에서 사라진다.** `'online'`은 요청을 `paused` 상태로 두고 마지막 데이터를 계속 노출한다 — 오프라인 읽기 정책(§5)의 핵심 |
| `mutations.retry: 0` | 서버에 멱등키가 없다. `POST /save`는 200만 반환하고 중복을 감지하지 않으며(`.hash_index.json`은 "기록만, 차단은 안 함"), `POST /api/commit`은 호출할 때마다 이미지와 NER 라벨을 하나씩 더 만든다. **자동 재시도는 곧 데이터 중복이다.** 재시도는 항상 사용자가 명시적으로 트리거한다 |
| `throwOnError: false` | 목록 실패 시 화면 전체를 날리는 대신 인라인 재시도 UI를 보여준다 |

---

## 3. QK-02 쿼리 키와 키별 캐시 정책

키는 배열 형태로 통일하고, 첫 요소는 리소스명, 두 번째부터 필터 객체를 둔다.

| 쿼리 키 | 엔드포인트 | 형태 | staleTime | 영속 | 비고 |
|---|---|---|---|---|---|
| `['auth','me']` | API-03 | 단건 | 5분 | O | 401/400이면 세션 만료 처리(§9) |
| `['dashboard', dateKey]` | API-24 | 단건 | 60초 | O | 웹은 미사용. 앱은 목록 3개 대신 이것 1개로 홈을 그린다 |
| `['cards', filters]` | API-14 | **무한** | 30초 | O | `filters = {groupId?, ungrouped?}` |
| `['card-groups']` | API-20 | 배열 | 5분 | O | 변경 빈도 매우 낮음 |
| `['tickets']` | API-57 | 무한 | 30초 | O | |
| `['posters']` | API-43 | 무한 | 30초 | O | |
| `['receipts']` | API-49 | 무한 | 30초 | O | 웹은 목업이었으나 API는 정상 동작 |
| `['search', type, query]` | API-19/47/52/61 | 배열 | 5분 | **X** | 검색 호출이 곧 서버 검색기록 적립이므로 캐시를 길게 잡는다(§10) |
| `['search-histories']` | API-54 | 배열 | 60초 | X | 최근 검색어 화면 |
| `['notifications']` | API-32 | 무한 | 15초 | X | |
| `['notifications','unread-count']` | API-33 | 단건 | 15초 | X | 탭 배지. 포그라운드 복귀 시 항상 재검증 |
| `['notification-settings']` | API-39 | 단건 | 5분 | O | |
| `['google-calendar','connected', userId]` | API-27 | 단건 | 5분 | O | |
| 챗봇 답변 | API-31 | **뮤테이션** | — | X | 대화는 캐시하지 않고 `uiStore`가 아닌 화면 로컬 배열로 보관 |

### 3-1. Spring `Page<T>` 파싱 규약

목록 API(API-14/43/49/57/32)는 `ApiResponse<Page<T>>`이고, 검색 API(API-19/47/52/61/20/54)는 `ApiResponse<List<T>>`다. 웹은 확신이 없어 양쪽을 모두 방어하지만, 앱은 이 표를 근거로 **확정 파싱**한다.

```ts
// 무한 쿼리 표준형
useInfiniteQuery({
  queryKey: ['tickets'],
  queryFn: ({ pageParam = 0 }) => api.getTickets({ page: pageParam, size: PAGE_SIZE }),
  initialPageParam: 0,
  getNextPageParam: (last) => (last.last ? undefined : last.number + 1), // Spring Page 필드
});
```

`PAGE_SIZE = 20` (결정). 서버 기본은 10이고 알림만 `MAX_PAGE_SIZE = 50` 상한이 있다. 20은 카드 높이 기준 화면 2.5장 분량으로, 첫 페이지에서 스크롤 여유를 주면서 응답 크기(문서당 `rawText`/`parsedJson`이 큼)를 억제한다.

> 웹은 항상 첫 페이지만 가져오고 `totalPages`를 쓰지 않아 문서가 20개를 넘으면 보관함에 보이지 않았다. 앱은 무한 스크롤로 이 결함을 해소한다.

### 3-2. 날짜 파싱 관대 규칙

Jackson이 `LocalDateTime`을 `[2026,7,27,14,30,15,123456789]` **숫자 배열**로 직렬화할 수 있다(웹 `api.ts`에 실제 우회 코드가 있고 타입이 `string | number[]`다). 앱은 **모든 날짜/시간 필드**에 관대한 파서를 적용한다 — 웹은 `createdAt`에만 적용해 `updatedAt`/`readAt`/`expiresAt`은 깨진 채로 남아 있다.

```ts
// lib/date.ts — 정규화는 API 레이어에서 1회만 수행하고 캐시에는 정규화된 값만 넣는다
export function toIsoLocal(v: string | number[] | null | undefined): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length >= 3) {
    const [y, m, d, h = 0, mi = 0, s = 0] = v;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(m)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`;
  }
  return undefined;
}
```

변환 결과에 타임존이 없다(`2026-07-27T14:30:15`). 서버 `LocalDateTime`은 서버 로컬시(Asia/Seoul 전제)이므로 **표시는 항상 `Asia/Seoul` 고정**으로 포맷한다. 기기 타임존을 따르면 해외 사용자에게 어긋난다.

---

## 4. QK-03 무효화(invalidate) 매트릭스

| 변경 액션 | 무효화 대상 |
|---|---|
| 문서 저장 (SCAN-11) | 해당 종류 목록 + `['dashboard']` + `['notifications','unread-count']`(포스터/티켓만) |
| 문서 수정 | 해당 종류 목록 + `['search']` 전체 |
| 문서 삭제 | 해당 종류 목록 + `['dashboard']` + `['search']` 전체 |
| 명함 그룹 생성/삭제/이름변경 | `['card-groups']` + `['cards']` 전체 |
| 명함 그룹 이동 | `['cards']` 전체 (필터별 페이지가 전부 어긋남) |
| 알림 읽음/전체읽음/삭제 | `['notifications']` + `['notifications','unread-count']` |
| 검색 기록 전체 삭제 | `['search-histories']` |
| 내 문서 전체 삭제 (API-62) | **`queryClient.clear()`** 후 홈으로 |
| 닉네임/비밀번호 변경 | `['auth','me']` |
| 회원 탈퇴 · 로그아웃 | `queryClient.clear()` + persist 저장소 제거 |

`['search']` 전체 무효화는 접두사 매칭(`queryClient.invalidateQueries({ queryKey: ['search'] })`)으로 처리하되, `refetchType: 'none'`을 줘서 **백그라운드 재검색을 트리거하지 않는다.** 검색 API 호출은 서버에 검색기록을 한 건 더 쌓기 때문이다(§10).

---

## 5. OFF-01 오프라인 정책

### 5-1. 결정

| 구분 | v1 동작 |
|---|---|
| **읽기** | **오프라인에서도 캐시로 열람 가능.** 마지막으로 본 보관함 목록/상세/대시보드가 그대로 보인다 |
| **쓰기** | **큐잉하지 않는다.** 오프라인에서 저장·수정·삭제·그룹이동을 시도할 수 없다 |

### 5-2. 쓰기를 큐잉하지 않는 이유

1. **저장이 원자적이지 않다.** 한 문서 저장은 `POST :8000/api/commit` → `POST :8080/.../save` 2단계이고 서버에 보상 API가 없다. 큐 재생 중 1단계만 성공하면 고아 이미지와 고아 NER 라벨이 남는다.
2. **멱등키가 없다.** 서버는 중복 저장을 감지하지 않는다(`.hash_index.json`은 기록만 하고 차단하지 않는다). "전송했는지 확실하지 않은 요청"을 재생하면 문서가 2개가 된다.
3. **토큰 수명이 24시간이고 리프레시 토큰이 없다.** 큐가 하루를 넘기면 전량 401로 실패한다. 만료된 큐를 사용자에게 설명하는 UX 비용이 기능 가치보다 크다.
4. **이미지 파일을 함께 큐잉해야 한다.** 캐시 디렉터리는 OS가 임의로 비울 수 있으므로 문서 디렉터리로 옮기고 수명 관리를 해야 한다 — v1 예산 초과.

### 5-3. 대신 사용자에게 보이는 처리

| ID | 상황 | 처리 |
|---|---|---|
| OFF-02 | 오프라인 진입 | 상단 세이프에어리어 아래에 40dp 배너: `오프라인 · 저장된 내용을 보고 있어요` (결정). 배경 `surface #F8FAFC`, 텍스트 `mute #64748B` |
| OFF-03 | 오프라인에서 목록 열람 | 캐시 렌더 + pull-to-refresh 시 스피너 대신 토스트 `오프라인 상태입니다.` (결정) |
| OFF-04 | 캐시가 없는 화면 진입 | EmptyState 대신 OfflineState: `연결되면 불러올게요` + `다시 시도` (결정) |
| OFF-05 | 쓰기 버튼 | `disabled` + `opacity 0.5`. 탭 시 토스트 `오프라인 상태에서는 저장할 수 없습니다.` (결정) |
| OFF-06 | 스캔 진입 | 카메라·크롭·압축까지는 허용한다(로컬 작업). 업로드 직전에 OFF-05로 막고 초안을 저장한다 |
| OFF-07 | 온라인 복귀 | 배너가 `연결됨`으로 1.5초 표시 후 사라짐. `onlineManager`가 paused 쿼리를 자동 재개. 스캔 초안이 있으면 §5-4 배너 |

### 5-4. 스캔 초안 이어서 저장 (OFF-08)

큐잉을 하지 않는 대신 **작업 중이던 스캔 결과 1건**은 잃지 않는다. `scanDraftStore`가 MMKV `default`의 `scan.draft` 키(§1-4)에 초안을 영속하고, 다음 조건에서 복구 배너를 띄운다.

- 트리거: 앱 시작 또는 스캔 탭 진입 시 `scanDraftStore.draft !== null`
- 배너 문구: `저장하지 않은 스캔 결과가 있어요` + `이어서 저장` / `삭제` (결정)
- 유효성: `updatedAt`이 **24시간** 이내이고 `imageUri` 파일이 실제로 존재할 때만 복구한다. 캐시 디렉터리가 비워졌으면 초안을 폐기한다
- 복구 후에는 `committedImageUrl`이 이미 있으면 커밋을 건너뛰고 `/save`부터 재개한다 (중복 커밋 금지 — [[Camera and Scan]] R1)
- 초안은 **동시에 1건만** 유지한다. 새 스캔을 시작하면 기존 초안을 덮어쓰기 전에 확인을 받는다

---

## 6. QK-04 캐시 영속화

```ts
// MMKV `cache` 인스턴스 기반 persister (§1-4 `cache.query`). 화이트리스트 방식.
const PERSISTED = new Set([
  'auth', 'dashboard', 'cards', 'card-groups', 'tickets', 'posters', 'receipts',
  'notification-settings', 'google-calendar',
]);

// MMKV 는 동기 API 이므로 createSyncStoragePersister 를 쓴다.
// ★ v4 는 삭제가 remove() 다 (v3 의 delete() 는 없다 — [[Data Model]] §6-2).
const mmkvStorage = {
  getItem: (k: string) => cacheKv.getString(k) ?? null,
  setItem: (k: string, v: string) => cacheKv.set(k, v),
  removeItem: (k: string) => cacheKv.remove(k),
};

persistQueryClient({
  queryClient,
  persister: createSyncStoragePersister({ storage: mmkvStorage, key: 'cache.query', throttleTime: 2_000 }),
  maxAge: 24 * 60 * 60_000,          // 24시간. JWT 만료와 동일 주기
  buster: `${APP_VERSION}`,          // 앱 버전이 바뀌면 캐시 전량 폐기
  dehydrateOptions: {
    shouldDehydrateQuery: (q) =>
      q.state.status === 'success' && PERSISTED.has(String(q.queryKey[0])),
  },
});
```

| 결정 | 이유 |
|---|---|
| 화이트리스트 방식 | 검색 결과·알림·챗봇은 신선도가 생명이라 오래된 값을 되살리면 오히려 혼란스럽다 |
| `maxAge: 24h` | 토큰 수명과 같다. 토큰이 죽은 시점의 캐시는 어차피 갱신할 수 없다 |
| `buster: APP_VERSION` | DTO 형태가 바뀐 채 옛 캐시를 되살리면 렌더가 깨진다 |
| `throttleTime: 2s` | 무한 스크롤로 페이지를 늘릴 때마다 직렬화하면 저사양 기기에서 프레임이 튄다 |
| MMKV `cache` 인스턴스 분리 | 캐시가 손상되면 `cacheKv.clearAll()`로 통째로 지워 복구한다. `default` 인스턴스(테마·뷰모드·초안)는 살아남는다 — 캐시 복구가 사용자 설정을 날리면 안 된다 ([[Data Model]] §6-2) |
| **로그아웃 시 `queryClient.clear()` + persister 제거** | 계정 전환 시 이전 사용자 문서가 보이면 심각한 사고다. `theme.mode`는 이때도 유지한다(§1-4 결정 3). [[QA Checklist]] 필수 항목 |

---

## 7. 이미지 캐싱과 목록 가상화

### 7-1. `expo-image` 정책

```tsx
<Image
  source={{ uri: toAbsoluteImageUrl(item.imageUrl) }}
  cachePolicy="memory-disk"
  recyclingKey={String(item.id)}
  transition={150}
  contentFit="cover"
  placeholderContentFit="cover"
  placeholder={{ blurhash: undefined }}   // 단색 surface 배경으로 대체
  priority={inList ? 'normal' : 'high'}
  onError={handleImageError}
  accessibilityIgnoresInvertColors
/>
```

| 항목 | 결정 | 이유 |
|---|---|---|
| `cachePolicy` | `memory-disk` | 이미지 URL이 `uuid4().hex` 파일명이라 **불변**이다. 무효화를 고민할 필요가 없으므로 디스크 캐시가 순이득 |
| URL 절대화 | `imageUrl`이 `http`로 시작하지 않으면 **`OCR_BASE`**(:8000)를 붙인다 | 이미지는 Spring이 아니라 OCR 서버가 `StaticFiles`로 서빙한다. API base와 다른 호스트다 |
| 실패 폴백 | `onError` → 문서 종류별 아이콘 + `이미지가 없습니다` (원문) | 티켓/포스터/영수증은 `imageUrl`이 `parsedJson` 안에 있어 누락이 흔하다 |
| 프리페치 | 목록 첫 화면 진입 시 상위 6건 `Image.prefetch` | 스크롤 시작 전 첫 화면만 미리 채운다 |
| 디스크 캐시 상한 | OS 기본에 위임. 설정 화면의 `캐시 삭제`에서만 `Image.clearDiskCache()` 호출 | 자체 LRU 구현은 과설계 |
| 상세 화면 | `contentFit="contain"` + `aspectRatio` 고정 | 원본 웹 드로어가 `objectFit: contain`이었다. 명함 가로/영수증 세로가 섞여 있어 crop은 정보 손실 |
| **플레이스홀더 색** | 고정 HEX 금지. `useTheme().surface.alt`를 컨테이너 배경으로 쓴다 (라이트 `#F1F5F9` / 다크 `#232E3E`) | `className`을 못 쓰는 런타임 소비처다. 흰색으로 고정하면 다크에서 로드 순간 흰 사각형이 번쩍인다 ([[Mobile UX Guide]] §14-3) |
| **다크 눈부심** | 이미지 픽셀에 밝기/틴트 필터를 걸지 않는다. 컨테이너 매트로만 처리 | 문서를 **읽으려고** 저장한 이미지다. 어둡게 하면 명함 작은 글씨·영수증 금액 판독성이 떨어진다 ([[Mobile UX Guide]] §14-3, [[Design Tokens]] §10-5) |

### 7-2. 목록 가상화 기준

| 기준 | 규칙 |
|---|---|
| 가상화 필수 | 항목 수에 **상한이 없는 모든 목록** — 보관함 4종, 검색 결과, 알림, OCR 원문 블록 칩 |
| 가상화 불필요 | 상한이 고정된 목록 — 명함 그룹(수십 개), 설정 항목, 문서 종류 칩 4개, 최근 검색어 10개 |
| 라이브러리 | `@shopify/flash-list` | |
| `estimatedItemSize` | 리스트 뷰 96, 그리드 카드 220, 알림 76 | 실측 후 [[Component Library]]에 고정 |
| 그리드 | `numColumns={2}` + `storageViewMode` 토글로 리스트/그리드 전환 | |
| 무한 스크롤 | `onEndReachedThreshold={0.5}` + `isFetchingNextPage` 푸터 스피너 | |
| pull-to-refresh | `refetch()` 호출. 낙관적 업데이트 중이면 무시 | |
| 이미지 언마운트 | `recyclingKey`로 셀 재사용 시 이전 이미지 잔상 방지 | FlashList 필수 조합 |

---

## 8. RVL 앱 생명주기 훅

### 8-1. 배선 코드 (앱 루트 1회)

```ts
// app/_layout.tsx
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected && s.isInternetReachable !== false))),
);

useEffect(() => {
  const sub = AppState.addEventListener('change', (status) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  });
  return () => sub.remove();
}, []);
```

`isInternetReachable !== false`로 판정하는 이유: LAN 직결 개발 환경에서는 인터넷이 없어도 사설망 서버에 도달할 수 있다. `isInternetReachable`이 `null`(판정 중)일 때 오프라인으로 오판하면 정상 요청이 막힌다.

### 8-2. 포그라운드 복귀 시 재검증 대상표

`refetchOnWindowFocus: true` + 키별 `staleTime`이 실제 재검증 여부를 결정한다. 아래는 그 결과를 정리한 것으로, 별도 코드가 아니라 **staleTime 설계의 의도**다.

| ID | 대상 | 재검증 | 근거 |
|---|---|---|---|
| RVL-01 | `['notifications','unread-count']` | **항상** (staleTime 15초) | 탭 배지가 틀리면 즉시 눈에 띈다. 서버 스케줄러가 매일 09:00 KST에 알림을 만든다 |
| RVL-02 | `['notifications']` | 15초 초과 시 | |
| RVL-03 | `['dashboard', dateKey]` | 60초 초과 시. **날짜가 바뀌었으면 키 자체가 달라져 무조건 새로 요청** | 자정을 넘겨 복귀하면 "오늘 일정"이 어제 기준이면 안 된다 |
| RVL-04 | 보관함 4종 목록 | 30초 초과 시 | |
| RVL-05 | `['auth','me']` | 5분 초과 시 | 세션 유효성 확인 겸용. 401/400이면 §9 |
| RVL-06 | `['search', ...]` | **하지 않음** (staleTime 5분) | 재검색 = 서버 검색기록 1건 적립 |
| RVL-07 | `['card-groups']`, `['notification-settings']`, `['google-calendar','connected']` | 5분 초과 시 | 변경 빈도 낮음 |
| RVL-08 | 진행 중인 스캔 업로드 | 재검증 대상 아님. 태스크 생존 여부를 확인해 UI를 복원한다 | [[Camera and Scan]] §8 |

추가 규칙:
- **백그라운드 30분 초과 후 복귀**: 캐시가 대부분 stale이므로 현재 화면의 쿼리만 우선 재검증하고 나머지는 진입 시점에 맡긴다. 전체 `invalidateQueries()`는 호출하지 않는다(요청 폭주 + pool 3 고갈).
- **날짜 경계 감지**: 복귀 시 `todayKey()`를 재계산해 `['dashboard', dateKey]` 키를 갱신한다.

---

## 9. 세션 만료 전역 처리

```ts
// lib/http.ts — 모든 요청이 통과하는 단일 지점
if (res.status === 401) {
  await sessionExpired();      // SecureStore 토큰 삭제 → authStore.status='guest'
                               // → queryClient.clear() → 로그인 화면으로 replace
}
```

| 규칙 | 내용 |
|---|---|
| 401 | 무조건 세션 만료로 처리 |
| **400은 `/auth/me` 응답에 한해서만** 세션 만료로 처리 | `AuthController`만 도메인 실패를 400으로 내리고 다른 컨트롤러는 500을 쓴다. 웹은 `status === 401 \|\| status === 400`을 전역으로 적용하는데, 이를 그대로 옮기면 닉네임 변경 실패 같은 정상 400에서도 로그아웃된다 |
| 만료 시 스캔 초안 | **파기하지 않는다.** 재로그인 후 §5-4 복구 배너로 이어서 저장 |
| 만료 시 캐시 | `queryClient.clear()` + persister 제거 |
| 사용자 문구 | `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` (원문) |

---

## 10. 검색 상태 특례

검색 API(API-19/47/52/61)는 호출될 때마다 서버가 `searchHistoryService.record(...)`를 **검색 실행 전에 무조건** 실행한다. 즉 **검색 호출 1회 = 검색기록 1건 적립**이다.

| ID | 결정 | 이유 |
|---|---|---|
| ST-04 | **입력 중 자동 검색(debounce) 금지.** 제출(키보드 `search` 키 또는 검색 버튼)에서만 쿼리를 실행한다 | 디바운스 300ms를 걸면 "김민우"를 치는 동안 서버에 3~5건의 검색기록이 쌓인다 |
| ST-05 | 동일 `(type, query)` 재검색은 5분간 캐시로 응답한다 | 뒤로가기 후 재진입에서 기록이 또 쌓이는 것을 막는다 |
| ST-06 | 최근 검색어는 **로컬(`prefsStore.recentQueries`, 최대 10건)**을 1차 소스로 쓰고, `GET /api/search-histories`(API-54)는 "전체 기록 보기" 화면에서만 호출한다 | 즉시 표시 + 서버 왕복 절감 |
| ST-07 | 설정의 검색기록 전체 삭제(API-55) 성공 시 `prefsStore.recentQueries`도 함께 비운다 | 두 소스가 어긋나면 삭제했는데 남아 보인다 |

### 10-1. ST-09 검색 문서유형 기본값 (확정)

**결정: 마지막으로 사용한 문서 유형을 MMKV `search.lastDocType`(§1-4)에 기억해 복원한다. 최초 실행 시 기본값은 `BUSINESS_CARD`(명함).**

| 근거 | 내용 |
|---|---|
| 명함이 핵심 도메인 | 명함만 그룹(명함첩) 기능·전용 목록 API·검색 API를 온전히 갖추고 있고 저장 데이터가 가장 많다. 검색 진입 시 가장 자주 찾는 대상이다 |
| **`전체`를 기본값으로 두면 비용이 4배** | 서버에 통합 검색 엔드포인트가 없다. `전체`는 4종 검색 API(API-19/47/52/61)를 **병렬로 4회** 호출하는 것이며, 서버는 호출마다 `searchHistoryService.record(...)`를 검색 실행 전에 무조건 실행한다 → **요청 4배 + 서버 검색기록 4건 적립**. Hikari pool `maximum-pool-size: 3`인 서버에 기본값으로 얹을 부하가 아니다 |
| 그래도 `전체`를 없애지 않는다 | 유형을 모르고 찾는 상황이 실재한다. **사용자가 명시 선택했을 때만** 동작하는 옵션으로 유지한다 |

| ID | 규칙 | 구현 |
|---|---|---|
| ST-09 | 검색 화면 진입 시 유형 칩의 초기 선택은 `search.lastDocType`. 값이 없거나 오염되면 `BUSINESS_CARD` | 좁히기 가드로 열거형 검증(§1-4 결정 1) |
| ST-10 | 검색 **실행 성공 시** 선택 유형을 `search.lastDocType`에 기록한다. 칩을 탭한 시점이 아니라 실행 시점이다 | 칩만 눌러 보고 나간 사용자의 다음 진입을 바꾸지 않는다 |
| ST-11 | `전체` 선택 시에도 이 값을 그대로 저장한다(`'ALL'`) | 명시적으로 전체를 고른 사용자에게 다음 진입에서 명함으로 되돌리면 선택이 무시된 것처럼 느껴진다 |
| ST-12 | `전체` 검색의 **로컬** 최근 검색어(`search.recent`)는 **1건만** 적립한다 (`{q, docType:'ALL', at}`) | 4종 호출을 4건으로 적립하면 최근 검색어 10칸이 한 번의 검색으로 40% 차버린다 |
| ST-13 | `전체` 검색의 **서버** 검색기록은 4건이 쌓이는 것을 막을 수 없다 | 서버가 호출마다 무조건 기록하고 앱이 끌 수단이 없다. 이것이 ST-09에서 `전체`를 기본값으로 두지 않는 직접적 근거다. 전체 기록 보기 화면(API-54)에서는 **동일 `q` + `at` 2초 이내** 항목을 1건으로 **병합 표시**해 사용자에게 4줄로 보이지 않게 한다 |
| ST-14 | `전체` 검색 쿼리 키는 `['search','ALL', query]` 하나로 두고 내부에서 4개 호출을 `Promise.allSettled`로 묶는다. 일부 유형이 실패해도 성공한 결과는 노출한다 | 4개 키로 쪼개면 무효화·캐시·로딩 상태가 4벌이 되어 화면이 4번 흔들린다. `allSettled`인 이유: 서버가 존재하지 않는 리소스에도 500을 던지므로(§2-1) 한 종류의 실패로 전체를 버리면 안 된다 |

`['search','ALL', query]`의 `staleTime`도 5분(ST-05)을 그대로 적용한다 — 재검색 1회가 서버 기록 4건이므로 캐시 히트의 가치가 4배다. RVL-06(포그라운드 복귀 시 재검증 안 함)도 동일하게 적용된다.

---

## 11. OPT 낙관적 업데이트

### 11-1. 대상 목록

| ID | 액션 | API | 낙관적 조작 |
|---|---|---|---|
| OPT-01 | 문서 삭제 (명함/티켓/포스터/영수증) | API-17/60/46/53 | 해당 항목을 모든 페이지에서 제거 |
| OPT-02 | 명함 그룹 이동 | API-18 | `groupId` 교체 + 현재 필터와 불일치하면 목록에서 제거 |
| OPT-03 | 알림 읽음 | API-35 | `read=true`, `readAt=now`, unread-count −1 |
| OPT-04 | 알림 전체 읽음 | API-36 | 전 항목 `read=true`, unread-count 0 |
| OPT-05 | 알림 삭제 | API-37 | 항목 제거, 미읽음이었으면 count −1 |
| OPT-06 | 문서 필드 수정 (인라인/상세 편집) | API-16/59/45/51 | 캐시의 해당 항목 필드 병합 |
| OPT-07 | 명함 그룹 삭제 | API-23 | 그룹 목록에서 제거 + 소속 명함을 미분류로 이동 표시 |

### 11-2. 표준 구현

```ts
useMutation({
  mutationFn: (id: string) => api.deleteTicket(id),

  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['tickets'] });        // ① 진행 중 refetch 취소
    const snapshot = queryClient.getQueriesData({ queryKey: ['tickets'] }); // ② 전 페이지 스냅샷
    queryClient.setQueriesData({ queryKey: ['tickets'] }, (old: Infinite<Ticket>) =>
      old && {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          content: p.content.filter((t) => String(t.id) !== id),
          totalElements: Math.max(0, p.totalElements - 1),
        })),
      });                                                              // ③ 낙관적 반영
    return { snapshot };
  },

  onError: (_e, _id, ctx) => {
    ctx?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data)); // ④ 전량 복원
    toast.error('삭제하지 못했습니다. 다시 시도해 주세요.');                        // (결정)
  },

  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['tickets'] });          // ⑤ 성공·실패 무관 정합화
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  },
});
```

### 11-3. 롤백 규칙 (전 케이스 공통)

| # | 규칙 |
|---|---|
| R1 | `onMutate` 첫 줄은 반드시 `cancelQueries`. 취소하지 않으면 진행 중이던 refetch 응답이 낙관적 상태를 덮어쓴다 |
| R2 | 스냅샷은 **`getQueriesData`(복수형)** 로 뜬다. 무한 쿼리는 페이지가 여럿이고, 명함은 필터별로 캐시가 여러 개다 |
| R3 | 롤백은 스냅샷 **전량 복원**. 부분 복원은 페이지 경계가 어긋난다 |
| R4 | 롤백 시 반드시 토스트로 알린다. 조용한 롤백은 "삭제했는데 다시 나타남" 버그로 신고된다 |
| R5 | `onSettled`는 성공/실패 모두 `invalidateQueries`. 낙관적 계산(`totalElements` 등)이 서버 값과 어긋나도 다음 응답에서 정정된다 |
| R6 | **UI 되돌림에 애니메이션을 쓰지 않는다.** 롤백은 즉시 반영하고 토스트로 설명한다. 슬라이드 인 애니메이션은 사용자가 다시 삭제 버튼을 누르게 만든다 |
| R7 | 연속 삭제 시 각 뮤테이션이 독립 스냅샷을 갖는다. 마지막 스냅샷만 복원하면 앞선 삭제가 되살아나므로 **뮤테이션 키를 항목 id로 분리**한다 |

### 11-4. 낙관적 업데이트 금지 목록

| 액션 | 금지 이유 |
|---|---|
| 문서 저장 (`/commit` + `/save`) | 2단계 비원자 트랜잭션 + 서버 생성 `id`/`imageUrl`이 필요. 낙관적 항목의 id를 위조하면 롤백 시 유령 카드가 남는다 |
| 명함 그룹 **생성** | 서버가 UUID를 생성한다. 임시 id로 만든 그룹에 명함을 이동시키면 되돌릴 수 없다 |
| 비밀번호 변경 | 429 rate limit(분당 5회)이 있고 실패가 흔하다 |
| 회원 탈퇴 · 내 문서 전체 삭제 | 파괴적이고 되돌릴 수 없다. 서버 응답(삭제 건수)을 확인한 뒤 화면을 갱신한다 |
| 검색 기록 전체 삭제 | 화면이 서버가 반환한 삭제 건수를 표시한다 |
| 구글 캘린더 연동/해제 | 외부 OAuth 왕복이 개입한다 |

---

## 12. Phase 매핑

| 항목 | Phase |
|---|---|
| MMKV 인스턴스 2개(`default`/`cache`) + 타입드 접근자(`services/kv.ts`), `themeStore` + `theme.mode` 키(§1-4), 테마 3택 배선 | **Phase 1 — 디자인 시스템** (테마가 토큰의 첫 소비자. 배선 코드는 [[Design Tokens]] §13) |
| QueryClient 설정, http 래퍼, 401 전역 처리, zustand 스토어 골격 | **Phase 2 — 인증** (세션이 첫 소비자) |
| `scanDraftStore` persist, OFF-06/08 | **Phase 3 — 스캔 파이프라인** |
| 무한 쿼리, FlashList 가상화, OPT-01/02/06/07, expo-image 캐시 | **Phase 4 — 보관함** |
| ST-04~07 검색 특례, **ST-09~14 문서유형 기본값 + `search.lastDocType` 키** | **Phase 5 — 검색 & 챗봇** |
| OPT-03/04/05 알림, RVL-01~03, 설정 화면 테마 세그먼트(SCR-25) 연결 | **Phase 6 — 대시보드 & 설정** |
| persistQueryClient, OFF-02~05 배너/오프라인 상태, 캐시 삭제 설정 | **Phase 7 — 상용 품질 마감** |

> 테마 스토어가 Phase 1인 이유 — 토큰 2벌을 만드는 시점에 이미 "지금 어느 테마인가"를 아는 주체가 필요하다. 설정 화면(SCR-25)이 없는 Phase 1 단계에서는 개발용 갤러리 화면(`app/(dev)/gallery.tsx`)의 토글이 `setMode`를 호출한다. 사용자 노출 UI는 Phase 6에서 붙인다.
