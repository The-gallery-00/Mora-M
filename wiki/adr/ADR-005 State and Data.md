# ADR-005 State and Data

서버 상태는 TanStack Query v5, 전역 클라이언트 상태는 zustand, 폼은 react-hook-form + zod로 나눈다.

상위: [[Architecture]]
관련: [[Offline and State]] · [[Networking]] · [[API Contract]] · [[Auth]] · [[Camera and Scan]] · [[Conventions]]

---

## 상태

**Accepted** — 2026-07-27. 사용자가 직접 선택.

---

## 맥락

### 다뤄야 하는 데이터의 성질

| 성질 | 내용 | 근거 |
|---|---|---|
| 서버 상태가 압도적 | 62개 엔드포인트 중 앱이 쓰는 것이 40개 이상. 화면 대부분이 "서버 목록을 보여주고 편집" | 04-api §1 |
| 페이지네이션 필요 | 목록 API는 Spring `Page<T>`를 주는데 **웹은 첫 페이지만 가져오고 `totalPages`를 무시**해 20건 초과 문서가 보이지 않았다. 앱은 무한 스크롤이 필수 | 04-api 함정 1 |
| 응답 형태가 두 갈래 | 목록은 `Page<T>`, 검색은 `List<T>`. 웹은 확신 없이 양쪽을 방어 | 동일 |
| 응답이 지저분함 | `data` 키가 사라지는 성공 응답(`{"success":true}`), 스칼라 `data`, `LocalDateTime` 숫자 배열 직렬화, `/api/scan` 이중 래핑 | 04-api 함정 2·4·14·15 |
| 부분 성공이 있음 | `{success:true, data, message}` = 저장 성공 + 임베딩 실패 | 04-api §2-2 |
| 클라이언트 전용 상태는 소수 | 세션, 스캔 초안, 테마·뷰모드, 최근 검색어 정도 | |
| 폼이 동적 | 스캔 검토 폼은 문서 종류에 따라 필드 3~12개가 런타임에 결정된다 | 05-domain §2 |
| 낙관적 업데이트 요구 | 삭제·그룹이동·읽음처리는 즉시 반응해야 "상업앱 수준" | 사용자 확정 |
| 오프라인 읽기 요구 | 캐시로 열람 가능해야 함. 쓰기 큐잉은 하지 않음 | [[Offline and State]] |
| 서버 부하 취약 | Hikari `maximum-pool-size: 3`, `RestTemplate` 타임아웃 무제한 | 04-api 함정 21 |

### 해결해야 할 질문

**서버 캐시(요청 중복 제거·무효화·재시도·무한 스크롤·낙관적 업데이트·영속화)를 무엇이 담당하고, 나머지 소량의 클라이언트 상태를 무엇으로 담을 것인가.**

---

## 검토한 대안

| 대안 | 장점 | 단점 | 기각 이유 |
|---|---|---|---|
| **TanStack Query v5 + zustand** | Query가 서버 상태 문제(캐시·중복제거·stale·무한스크롤·낙관적 업데이트+롤백·`focusManager`/`onlineManager` 연동·영속화)를 전부 기본 제공. zustand는 API가 작아 세션·초안·설정 4개 스토어에 딱 맞고 보일러플레이트가 사실상 없음. 두 라이브러리의 책임 경계가 명확 | 라이브러리 2개를 배워야 함. "이건 어느 쪽?"의 경계 판단이 필요(→ [[Offline and State]] ST-02에 규칙화). Query 캐시 영속화는 별도 패키지 | **채택** |
| Redux Toolkit + RTK Query | 단일 생태계. DevTools 강력. RTK Query도 캐시·무효화·낙관적 업데이트 제공 | 보일러플레이트가 크다(slice·store·provider·타입). 이 앱의 클라이언트 전역 상태는 스토어 4개뿐인데 Redux 인프라 전체를 지불한다. RTK Query의 `transformResponse`로 Spring `Page`/이중 래핑/날짜 배열을 처리할 수 있으나 엔드포인트 정의 DSL이 장황. 무한 스크롤은 Query 쪽이 성숙 | **비용 대비 이득 없음.** 전역 상태 규모가 Redux를 정당화하지 못한다 |
| Zustand 단독 (직접 fetch) | 의존성 최소. 완전한 통제 | 캐시 무효화·요청 중복 제거·stale-while-revalidate·무한 스크롤·낙관적 롤백·재연결 재검증을 **전부 자작**해야 한다. 40개 엔드포인트에 이걸 손으로 구현하면 버그가 그쪽에서 난다 | **바퀴 재발명.** pool 3짜리 서버에 중복 요청을 보내는 사고가 확실히 난다 |
| Jotai / Recoil (원자 기반) | 세밀한 리렌더 제어. 파생 상태 표현이 우아 | 서버 캐시 기능이 없어 결국 Query와 함께 쓰게 된다. 그러면 zustand 대비 이점은 원자 단위 구독뿐인데, 이 앱의 전역 상태는 그 최적화가 필요할 만큼 크지 않다 | Query와 조합할 거라면 **더 단순한 zustand가 낫다** |
| MobX | 관찰 가능 상태가 직관적. 적은 코드 | RN 생태계 레퍼런스 감소. 데코레이터/프록시 기반이라 디버깅 모델이 팀에 낯설다. 서버 캐시는 여전히 자작 | 학습·유지 비용 대비 이득 없음 |
| React Context만 | 의존성 0 | 값이 바뀔 때 구독 트리 전체 리렌더. 서버 캐시 기능 전무. 세션 하나 정도면 몰라도 스캔 초안·설정까지 담으면 성능·구조 모두 무너짐 | 규모 미달 |
| SWR | 가볍고 API가 단순 | 무한 스크롤·낙관적 업데이트·영속화·mutation 관리가 Query보다 얕다. RN 통합 레퍼런스도 적다 | **필요 기능이 Query에만 있다** |

---

## 결정

### 1. 역할 분담

| 계층 | 도구 | 담당 |
|---|---|---|
| 서버 상태 | **TanStack Query v5** | 문서 4종 목록/상세, 대시보드, 알림, 검색, `/auth/me`, 설정 조회, 모든 뮤테이션 |
| 전역 클라이언트 상태 | **zustand** (스토어 4개) | `authStore`, `scanDraftStore`, `prefsStore`, `uiStore` |
| 화면 로컬 | `useState` / `useReducer` | 시트 열림, 탭 인덱스, 필터 칩 |
| 폼 | **react-hook-form + zod** | 로그인/회원가입, 스캔 검토 폼(동적 스키마), 문서 편집, 프로필 |
| 보안 저장 | **expo-secure-store** | JWT. zustand·AsyncStorage·Query 캐시 어디에도 토큰을 두지 않는다 |
| 일반 영속 | **AsyncStorage** | zustand persist + Query 캐시 영속화 |

설정값·쿼리 키·낙관적 업데이트 규칙의 **정본은 [[Offline and State]]**이다. 이 ADR은 선택의 근거만 다룬다.

### 2. 단일 HTTP 레이어를 둔다

Query의 `queryFn` 안에서 `fetch`를 직접 부르지 않는다. `lib/http.ts` 한 곳이 아래를 전담한다.

| 책임 | 내용 |
|---|---|
| base URL 선택 | API(:8080) / OCR(:8000) 2개 — [[ADR-002 Backend Connectivity]] |
| 인증 헤더 | `Authorization: Bearer <jwt>`. 멀티파트에는 `Content-Type`을 **절대** 붙이지 않는다 |
| 응답 정규화 | `success` 판정, `data` 키 부재 허용, 스칼라 `data` 허용, `message`(부분 성공) 보존, `/api/scan` 이중 언랩 |
| 날짜 정규화 | `string \| number[]` 모두 수용해 ISO 문자열로 — **모든 날짜 필드에 적용** (웹은 `createdAt`에만 적용해 나머지가 깨져 있었다) |
| 에러 표준화 | `ApiError { status, code?, raw }`. **서버 에러 문자열을 UI에 그대로 노출하지 않는다**(한글 인코딩 깨짐 전례) |
| 타임아웃 | 요청군별 상한 + `AbortController` |
| 401 처리 | 전역 세션 만료. **400은 `/auth/me` 응답에 한해서만** 만료로 취급 |

이 레이어 덕분에 Query/zustand는 백엔드의 기형적 응답 형태를 알 필요가 없다. **캐시에는 항상 정규화된 값만 들어간다.**

### 3. 뮤테이션 정책

| 규칙 | 내용 |
|---|---|
| `retry: 0` | 서버에 멱등키가 없다. `/api/commit`은 호출마다 이미지+NER 라벨을 하나 더 만들고, `/save`는 중복을 감지하지 않는다. **자동 재시도 = 데이터 중복** |
| 재시도는 사용자 트리거만 | 실패 시트의 `다시 시도` 버튼 |
| 낙관적 허용 | 삭제, 그룹 이동, 알림 읽음/전체읽음/삭제, 문서 필드 수정, 그룹 삭제 |
| 낙관적 금지 | 문서 저장(2단계 비원자 + 서버 생성 id), 그룹 생성(서버 UUID 필요), 비밀번호 변경(429 rate limit), 탈퇴·전체 삭제, 검색기록 삭제 |
| 롤백 | `cancelQueries` → `getQueriesData` 스냅샷 → 실패 시 전량 복원 + 토스트 → `onSettled` 무효화 |

### 4. zustand 스토어 경계

```
authStore      status / user            ← 토큰은 SecureStore. 스토어에는 없다
scanDraftStore 스캔 초안 1건            ← persist. 오프라인 쓰기 큐를 대신하는 최소 안전망
prefsStore     테마 / 뷰모드 / 최근검색어 ← persist
uiStore        토스트 큐 / 전역 시트     ← 비영속
```

**서버에서 다시 가져올 수 있는 것은 zustand에 복사하지 않는다.** 유일한 예외가 `prefsStore.recentQueries`인데, 이는 서버 검색기록(API-54)의 로컬 미러다. 이유: 검색 API 호출이 곧 서버 검색기록 적립이라 최근 검색어를 서버에서 매번 읽으면 상호작용이 꼬인다.

---

## 결과

### 긍정
1. **웹의 구조적 결함이 라이브러리 수준에서 해소된다.** 20건 상한(무한 쿼리), 목록/검색 파싱 혼란(단일 HTTP 레이어), 날짜 배열 깨짐(전 필드 정규화), 401 처리 비일관(전역 훅) 모두 한 번에 정리된다.
2. 요청 중복 제거와 `staleTime` 게이트가 `maximum-pool-size: 3` 서버를 자연스럽게 보호한다.
3. `focusManager`/`onlineManager` 연결만으로 포그라운드 복귀·재연결 재검증이 완성된다 — RN에서 손으로 짜면 버그의 온상.
4. `networkMode: 'online'` + 영속 캐시로 **오프라인 읽기가 코드 몇 줄로 성립**한다.
5. 낙관적 업데이트 + 롤백이 표준 패턴으로 제공되어 삭제·읽음처리 UX를 일관되게 만들 수 있다.
6. zustand는 스토어당 20~40줄이라 전역 상태 비용이 거의 없다.

### 부정
1. **경계 판단이 필요하다.** "이 값은 Query인가 zustand인가"를 매번 물어야 한다. 완화: [[Offline and State]] ST-02에 5가지 판단 기준을 못 박았다.
2. **캐시 무효화가 새로운 버그 표면**이다. 무효화를 빠뜨리면 저장했는데 목록에 안 뜨는 증상이 난다. 완화: 무효화 매트릭스를 [[Offline and State]] §4에 표로 고정하고, 뮤테이션 훅을 리소스별로 한 파일에 모은다.
3. **Query DevTools가 RN에서 웹만큼 편하지 않다.** 완화: 개발 빌드에서 Flipper/`react-query-native-devtools` 또는 로그 미들웨어를 연결.
4. 캐시 영속화가 **별도 패키지 2개**(persistQueryClient + AsyncStorage persister)를 요구하고, 앱 버전 변경 시 `buster` 관리가 필요하다.
5. zustand `persist`와 Query persister가 **AsyncStorage를 공유**한다. 키 접두사 규약(`mora.*`)을 [[Conventions]]에 정하지 않으면 충돌 위험이 있다.
6. 라이브러리 2개의 메이저 업그레이드 주기를 각각 따라가야 한다.

---

## 재검토 트리거

1. 전역 클라이언트 상태 스토어가 **8개를 넘거나** 스토어 간 상호 의존이 생기면 → 상태 머신(XState) 또는 단일 스토어 재평가.
2. 오프라인 **쓰기 큐잉이 정식 요구**가 되면 → 서버에 멱등키/중복 감지가 선행되어야 한다. 그 뒤 Query의 mutation persistence를 도입할지 판단.
3. 무효화 누락 버그가 **반복 발생**하면 → 리소스별 무효화를 뮤테이션 훅에 강제하는 팩토리 도입.
4. 캐시 영속화가 저사양 기기에서 **직렬화 비용 문제**를 일으키면 → MMKV 기반 persister로 교체.
5. 앱이 다중 계정/조직 개념을 갖게 되면 → 쿼리 키에 계정 스코프를 넣는 전면 리팩터가 필요하므로 이 시점에 재검토.
