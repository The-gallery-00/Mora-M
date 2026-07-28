# API Contract

MORA 모바일 앱이 호출하는 Spring(:8080) · OCR(:8000) 엔드포인트 67개의 전수 계약, 모바일 HTTP 클라이언트 설계, 그리고 웹과 다른 함정 대응.

상위: [[Architecture]]
관련: [[Data Model]] · [[Auth]] · [[Networking]] · [[Offline and State]] · [[ADR-002 Backend Connectivity]] · [[ADR-005 State and Data]]

---

## 1. 이 문서의 전제

| 항목 | 값 | 근거 |
|---|---|---|
| 백엔드 수정 | **금지**. 코드·DTO·상태코드 전부 현행 유지 | 확정 의사결정 2 |
| Spring base URL | `EXPO_PUBLIC_API_URL` (예: `http://192.168.0.10:8080`) | 원본: `frontend/lib/api.ts:3` |
| OCR base URL | `EXPO_PUBLIC_OCR_URL` (예: `http://192.168.0.10:8000`) | 원본: `frontend/lib/api.ts:4` |
| LLM(:8001) | **앱이 직접 호출하지 않음.** 반드시 Spring `/api/chat` 경유 | 원본: `backend/service/LlmService.java` |
| 컨트롤러 수 | **14개** (기획 초안의 "18개"는 오기) | 원본: `backend/src/main/java/com/mora/controller/` 실제 파일 14개 |
| Spring 엔드포인트 | 62개 (API-01~62) | 원본: 컨트롤러 14개 전수 |
| OCR 직접 엔드포인트 | 5개 (API-63~67) | 원본: `ocr/app.py`, `ocr/routers/ocr.py` |
| multipart 한도 | **10MB** (`spring.servlet.multipart.max-file-size`) | 원본: `backend/src/main/resources/application.yml` |
| JWT 만료 | 86,400,000ms = **24시간**, 리프레시 토큰 없음 | 원본: `application.yml` `app.jwt-expiration` |

### 1-1. 이 문서가 참조하는 SCR ID

**화면 ID의 진실 공급원은 [[Screen Specs]] §0-4 화면 인덱스(SCR-01~SCR-30)다.** 아래는 API 표의 "화면" 열에 등장하는 부분집합만 옮긴 것이다. 불일치가 생기면 [[Screen Specs]]가 이긴다.

| ID | 화면 | ID | 화면 | ID | 화면 |
|---|---|---|---|---|---|
| SCR-01 | 스플래시 / 세션 부트 | SCR-12 | 스캔 결과 확인/편집 | SCR-22 | 명함 그룹 관리 |
| SCR-03 | 로그인 | SCR-13 | 저장 완료 | SCR-23 | 검색 |
| SCR-04 | 회원가입 | SCR-15 | 명함 목록 | SCR-24 | 챗봇 |
| SCR-05 | OAuth 콜백 브리지 | SCR-16 | 티켓 목록 | SCR-25 | 설정 |
| SCR-06 | 홈 대시보드 | SCR-17 | 포스터 목록 | SCR-26 | 프로필 편집 |
| SCR-07 | 캘린더 (월간) | SCR-18 | 영수증 목록 | SCR-27 | 비밀번호 변경 |
| SCR-08 | 알림 목록 | SCR-19 | 문서 상세 (바텀시트) | SCR-28 | 계정 · 데이터 삭제 |
| SCR-09 | 스캔 · 카메라 | SCR-20 | 문서 편집 | SCR-29 | 알림 설정 |

---

## 2. 공통 응답 래퍼와 상태코드 규약

### 2-1. 와이어 포맷 (`com.mora.dto.api.ApiResponse<T>`)

`@JsonInclude(NON_NULL)` 이 걸려 있어 **null 필드는 JSON에서 키 자체가 사라진다.**

```jsonc
// 성공 (데이터 있음)
{ "success": true, "data": { /* T */ } }

// 성공 (data == null) — 삭제, 비밀번호 변경 등
{ "success": true }                       // ← "data": null 이 아니다. 키가 없다.

// 부분 성공 — 저장은 됐으나 OpenAI 임베딩 생성 실패
{ "success": true, "data": [ ], "message": "임베딩 생성 실패. Fuzzy 검색만 가능." }

// 실패
{ "success": false, "error": "Login required" }
```

원본: `backend/dto/api/ApiResponse.java`, `backend/dto/api/ServiceResult.java`

**결정**: 앱의 디코더는 `data`를 항상 optional로 취급한다. `Ok<T>` 타입의 `data`가 `undefined`일 수 있음을 전제로 호출부를 작성한다 (§5-3 코드).

### 2-2. 실제 상태코드 매핑 (컨트롤러 코드 직접 확인)

| 상황 | 코드 | 바디 | 해당 컨트롤러 |
|---|---|---|---|
| 정상 (POST `/save` 포함) | **200** (201 미사용) | `{success:true, data:…}` | 전체 |
| 미인증 | **401** | `{success:false, error:"Login required"}` | Card, CardGroup, Dashboard, Notification, NotificationSetting, Poster, Receipt, SearchHistory, Ticket, UserData |
| 미인증 (Auth 계열) | **401** | `error:"Token required"` \| `"Invalid token"` | Auth |
| 도메인 실패 | **400** | `{success:false, error:<문장>}` | Auth, CardGroup, GoogleCalendar, Notification(create/read/delete), NotificationSetting |
| 도메인 실패 | **500** | `{success:false, error:<문장>}` | Card, Dashboard, Llm, Notification(list/unread/read-all/deleteAll), Ocr, Poster, Receipt, SearchHistory, Ticket, UserData |
| 비밀번호 변경 rate limit | **429** | `error:"Too many requests, try again later"` | Auth (Bucket4j, 분당 5회) |
| 404 / 403 | **없음** | 존재하지 않는 리소스는 서비스가 `RuntimeException` → **500** | — |
| 경로 파라미터 타입 오류 | **400** | **`ApiResponse` 포맷 아님.** Spring 기본 `{"timestamp","status","error","path"}` | 전체 (`@ControllerAdvice` 부재) |
| 10MB 초과 업로드 | **500 또는 413** | **`ApiResponse` 포맷 아님.** `MaxUploadSizeExceededException` 미처리 | Ocr |

**결정 — 3가지 절대 규칙**
1. `error` 문자열로 분기하지 않는다. 에러 코드 심볼이 아니라 사람이 읽는 문장이고 한/영이 혼재한다. **HTTP status + `success` 불리언으로만 분기**한다.
2. **`500`을 재시도 대상으로 보지 않는다.** MORA에서 500은 "일시적 서버 장애"가 아니라 "도메인 실패(없는 리소스 등)"의 기본 코드다. 재시도는 `network`/`timeout`/`502`/`503`/`504`에만 건다.
3. `success` 키가 없는 응답(Spring 기본 에러 바디)이 올 수 있으므로 `env?.success !== true` 로 판정한다.

---

## 3. 엔드포인트 전체 표 (API-01 ~ API-67)

인증 열: **필수** = `Authorization: Bearer <jwt>` 없으면 401 / **불필요** = 토큰 없이 호출 가능 / **혼합** = 헤더 또는 쿼리 `userId` / **무방비** = 인증 검사 코드 자체가 없음.

### 3-1. AuthController — `/auth`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-01 | POST | `/auth/signup` | 불필요 | `{email, password}` | `AuthResponse{token,userId,email,name}` | SCR-04 | Phase 2 |
| API-02 | POST | `/auth/login` | 불필요 | `{email, password}` | `AuthResponse` | SCR-03 | Phase 2 |
| API-03 | GET | `/auth/me` | 필수 | — | `UserResponse{id,email,name,picture,provider,createdAt}` | SCR-01, SCR-25 | Phase 2 |
| API-04 | PATCH | `/auth/me` | 필수 | `{name}` | `UserResponse` | SCR-26 | Phase 6 |
| API-05 | PATCH | `/auth/me/password` | 필수 | `{currentPassword, newPassword}` | `null` | SCR-27 | Phase 6 |
| API-06 | DELETE | `/auth/me` | 필수 | `{password}` — `required=false`, 소셜 계정은 `{}` | `null` | SCR-28 | Phase 6 |
| API-07 | GET | `/auth/google/login` | 불필요 | — | **302 + `Location`** (바디 없음) | SCR-03·SCR-04 → SCR-05 | Phase 2 |
| API-08 | GET | `/auth/google/callback` | 불필요 | `?code&state&error` (전부 optional) | **`text/html`** | SCR-05 | Phase 2 |
| API-09 | GET | `/auth/kakao/login` | 불필요 | — | 302 | SCR-03·SCR-04 → SCR-05 | Phase 2 |
| API-10 | GET | `/auth/kakao/callback` | 불필요 | `?code&state&error` | `text/html` | SCR-05 | Phase 2 |
| API-11 | GET | `/auth/naver/login` | 불필요 | — | 302 | SCR-03·SCR-04 → SCR-05 | Phase 2 |
| API-12 | GET | `/auth/naver/callback` | 불필요 | `?code&state&error` | `text/html` | SCR-05 | Phase 2 |

- **API-01은 `name`을 무시한다.** `SignupRequest`에 `name` 필드가 없고 서버가 `email.split("@")[0]`으로 자동 생성한다. 가입 시 닉네임을 받으려면 가입 직후 API-04를 한 번 더 호출해야 한다. 원본: `backend/service/AuthService.java:52`
- **API-05는 429가 나올 수 있다.** rate limit 키 = `IP:토큰뒤8자`, 인메모리 버킷, 분당 5회. 원본: `PasswordChangeRateLimiter`
- **AuthController만 실패 시 400과 401이 섞인다.** 웹은 `if (res.status === 401 || res.status === 400)` 로 둘 다 세션만료 처리한다. 앱도 동일 규칙을 `/auth/me*` 경로에만 적용한다 ([[Auth]] §5).

### 3-2. CardController — `/api/cards` (명함, id = **UUID**)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-13 | POST | `/api/cards/save` | 필수 | `CardRequest{name,company,position,phone,email,rawOcrText,imageUrl,groupId}` | `CardResponse` | SCR-12 → SCR-13 | Phase 3 |
| API-14 | GET | `/api/cards` | 필수 | `?page=0&size=10&groupId&ungrouped=false` | **`Page<CardResponse>`** | SCR-15, SCR-06 | Phase 4 |
| API-15 | GET | `/api/cards/{id}` | 필수 | — | `CardResponse` | SCR-19 | Phase 4 |
| API-16 | PUT | `/api/cards/{id}` | 필수 | `CardRequest` | `CardResponse` | SCR-20, SCR-23 | Phase 4 |
| API-17 | DELETE | `/api/cards/{id}` | 필수 | — | `null` | SCR-15 | Phase 4 |
| API-18 | PATCH | `/api/cards/{id}/group` | 필수 | `{groupId}` — `required=false`, **`null`이면 미분류로 이동** | `CardResponse` | SCR-15 | Phase 4 |
| API-19 | GET | `/api/cards/search` | 필수 | `?q=<필수>&topK=5` | **`List<CardResponse>`** (Page 아님) | SCR-23 | Phase 5 |

`CardResponse`: `{id:UUID, name, company, position, phone, email, rawOcrText, imageUrl, groupId:UUID, createdAt, similarity:Double|null}`
**명함만 `imageUrl`이 정식 컬럼이다.** 나머지 3종은 `parsedJson` 안에 숨어 있다 (§4-6).
**API-19는 앱의 검색 기본 유형이다** — 검색 화면 최초 진입 시 호출되는 검색 API가 이것이다. 4종 검색 API 공통 정책(기본 유형 · `전체` 병렬 호출 · 검색기록 적립)은 **§3-16**이 정본이다.

### 3-3. CardGroupController — `/api/card-groups` (id = UUID)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-20 | GET | `/api/card-groups` | 필수 | — | `List<CardGroupResponse>` | SCR-22 | Phase 4 |
| API-21 | POST | `/api/card-groups` | 필수 | `{name}` | `CardGroupResponse` | SCR-22 | Phase 4 |
| API-22 | PATCH | `/api/card-groups/{groupId}` | 필수 | `{name}` | `CardGroupResponse` | SCR-22 (웹 미사용, **앱 신규**) | Phase 4 |
| API-23 | DELETE | `/api/card-groups/{groupId}` | 필수 | — | `null` | SCR-22 | Phase 4 |

`CardGroupResponse`: `{id:UUID, name, createdAt, updatedAt}`. 그룹 삭제 시 소속 명함은 미분류로 이동한다.
**이 컨트롤러만 실패 시 400을 쓴다** (Card/Ticket/Poster/Receipt는 500).

### 3-4. DashboardController — `/api/dashboard`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-24 | GET | `/api/dashboard` | 필수 | `?date=YYYY-MM-DD&deadlineDays=30` (음수는 0 보정) | `DashboardResponse` | SCR-06 | Phase 6 |

```ts
DashboardResponse {
  date: string; deadlineDays: number;
  todayScheduleCount: number; upcomingDeadlineCount: number;
  storedDocumentCount: number;                       // 명함+티켓+포스터+영수증 count 합
  upcomingDeadlines: { id, type, title, subtitle, date, dDay, imageUrl }[];
  todaySchedules:    { id, type, title, time, date }[];
}
```

**결정 — 앱은 홈 화면을 API-24 하나로 그린다.** 웹은 이 API를 안 쓰고 목록 3개(API-14/43/57)를 클라이언트에서 조립하지만, 서버가 이미 3-way 조립을 해준다. 모바일에서는 요청 3회 → 1회로 줄어들고 `storedDocumentCount`도 공짜로 얻는다. `type`은 `"TICKET"` \| `"POSTER"` 두 값뿐이며 명함/영수증은 대시보드에 나오지 않는다.

### 3-5. GoogleCalendarController — `/api/google-calendar`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-25 | GET | `/api/google-calendar/connect-url` | **혼합** | `?userId` + `Authorization` (둘 다 optional, 헤더 우선) | `{url}` | SCR-25 | Phase 6 |
| API-26 | GET | `/api/google-calendar/callback` | 불필요 | `?code&state&error` | **302** (바디 없음) | 브라우저 | Phase 6 |
| API-27 | GET | `/api/google-calendar/connected/{userId}` | **무방비** | — | `{userId, connected}` | SCR-25 | Phase 6 |
| API-28 | GET | `/api/google-calendar/tokens/{userId}` | **무방비** | — | `{id,userId,googleEmail,expiresAt,scope,connected,createdAt,updatedAt}` | (앱 미사용) | — |
| API-29 | DELETE | `/api/google-calendar/tokens/{userId}` | **무방비** | — | `{userId, connected}` | SCR-25 | Phase 6 |
| API-30 | GET | `/api/google-calendar/month` | **무방비** | `?userId&year&month` (전부 필수) | `{userId,year,month,connected,events:[]}` | SCR-07 (앱 신규) | Phase 6 |

**보안 경고 — API-27/28/29/30은 인증 검사 코드가 아예 없다.** `SecurityConfig`가 `anyRequest().permitAll()`이라 Spring Security도 막지 않는다. 남의 UUID만 알면 연동 상태 조회, 토큰 메타(구글 이메일·scope·만료) 조회, **연동 해제**, 캘린더 이벤트 조회가 전부 가능하다. 백엔드 수정이 금지되어 있으므로 앱 차원의 완화만 가능하다:
- **결정**: 앱은 이 4개 호출 시에도 `Authorization` 헤더를 항상 붙인다(서버가 무시하더라도 향후 서버 보강 시 자동 호환).
- **결정**: `userId`는 반드시 `/auth/me`(API-03) 응답에서 얻은 값만 사용한다. 로컬 캐시나 딥링크 파라미터에서 온 userId를 쓰지 않는다.
- 이 이슈는 [[Risks]]에 릴리스 차단 후보로 등재한다.

### 3-6. LlmController — `/api/chat`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-31 | POST | `/api/chat` | 컨트롤러 검사 없음. 헤더는 LLM 서버로 그대로 전달됨 | **snake_case** `{query, document_type, top_k}` | `{answer, sources:object[], query}` | SCR-24 | Phase 5 |

- 요청 바디는 **반드시 snake_case**. Spring DTO는 camelCase지만 `@JsonAlias("document_type")` / `@JsonAlias("top_k")`로 받는다. 웹도 snake_case로 보낸다. 원본: `frontend/lib/api.ts:35`
- `document_type` 허용값: `BUSINESS_CARD` \| `POSTER` \| `RECEIPT` \| `TICKET` (ETC 불가). **한 요청에 한 타입만.** 크로스 도메인 질의 불가.
- `sources`는 해당 문서 타입의 응답 DTO 배열 **그대로**다 (가공 없음). 챗봇 출처 카드는 이 DTO를 그대로 렌더링한다.
- 결과 0건 시 `sources: []` + 고정 answer: `관련된 데이터를 찾을 수 없어 답변하기 어렵습니다. 다른 키워드로 검색해 보세요.`
- **3홉 순환 호출**: 앱 → Spring `/api/chat` → LLM `:8001/api/chat` → Spring `/api/*/search` → DB. JWT 하나가 3홉을 관통하며, 중간의 httpx 타임아웃은 10초다. 앱 타임아웃은 60초로 잡되 취소 버튼을 반드시 제공한다.

### 3-7. NotificationController — `/api/notifications` (id = UUID)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-32 | GET | `/api/notifications` | 필수 | `?page=0&size=10` (서버 `MAX_PAGE_SIZE=50`) | **`Page<NotificationResponse>`** | SCR-08 | Phase 6 |
| API-33 | GET | `/api/notifications/unread-count` | 필수 | — | **`{"count": 3}`** (Map) | SCR-06 배지 | Phase 6 |
| API-34 | POST | `/api/notifications` | 필수 | `{type,title,message,linkUrl}` | `NotificationResponse` | (앱 미사용) | — |
| API-35 | PATCH | `/api/notifications/{id}/read` | 필수 | 바디 없음 | `NotificationResponse` | SCR-08 | Phase 6 |
| API-36 | PATCH | `/api/notifications/read-all` | 필수 | 바디 없음 | **`{"updatedCount": 7}`** (Map) | SCR-08 | Phase 6 |
| API-37 | DELETE | `/api/notifications/{id}` | 필수 | — | `null` | SCR-08 | Phase 6 |
| API-38 | DELETE | `/api/notifications` | 필수 | — | **숫자 스칼라** (`Long`) | SCR-08 | Phase 6 |

`NotificationResponse`: `{id:UUID, type, title, message, linkUrl, read:boolean, readAt, createdAt}`. `read`는 `readAt != null` 파생값이고 `sourceType/sourceId/targetDate`는 응답에 없다.
**웹에는 알림 UI가 존재하지 않는다** (api.ts에 함수 5개가 있으나 어떤 화면도 import하지 않음). SCR-08은 앱 신규 화면이며 서버는 이미 준비되어 있다.

### 3-8. NotificationSettingController — `/api/notification-settings`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-39 | GET | `/api/notification-settings` | 필수 | — | `NotificationSettingResponse` | SCR-29 | Phase 6 |
| API-40 | PUT | `/api/notification-settings` | 필수 | `{deadlineReminderDays?, deadlineReminderEnabled?, scheduleReminderEnabled?}` — 전부 래퍼 타입이라 **부분 업데이트 가능** | `NotificationSettingResponse` | SCR-29 | Phase 6 |

`NotificationSettingResponse`: `{deadlineReminderDays:int, deadlineReminderEnabled:boolean, scheduleReminderEnabled:boolean, createdAt, updatedAt}`. 기본값 `3 / true / true`.
웹은 알림 토글을 localStorage에만 저장한다. **앱은 이 API에 정식 연결한다** (서버 저장 = 기기 간 동기화).

### 3-9. OcrController — `/api/scan` (Spring 경유)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-41 | POST | `/api/scan` | **불필요** (비회원 스캔 허용) | `multipart/form-data`, 파트명 **`file`** 1개 | **이중 래핑된** Python OCR 응답 (§4-4) | SCR-09 → SCR-11 | Phase 3 |

앱도 웹과 동일하게 `Authorization` 헤더를 붙여 보낸다(서버가 검증하지 않아도 무해). **`Content-Type`은 절대 직접 지정하지 않는다.**

### 3-10. PosterController — `/api/posters` (id = **Integer**)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-42 | POST | `/api/posters/save` | 필수 | `PosterRequest` | `PosterResponse` | SCR-12 → SCR-13 | Phase 3 |
| API-43 | GET | `/api/posters` | 필수 | `?page=0&size=10` | **`Page<PosterResponse>`** | SCR-17, SCR-06 | Phase 4 |
| API-44 | GET | `/api/posters/{id}` | 필수 | — | `PosterResponse` | SCR-19 | Phase 4 |
| API-45 | PUT | `/api/posters/{id}` | 필수 | `PosterRequest` | `PosterResponse` | SCR-20, SCR-23 | Phase 4 |
| API-46 | DELETE | `/api/posters/{id}` | 필수 | — | `null` | SCR-17 | Phase 4 |
| API-47 | GET | `/api/posters/search` | 필수 | `?q=<필수>&topK=5` | `List<PosterResponse>` | SCR-23 | Phase 5 |

API-47은 유형 `포스터` 선택 시, 또는 유형 `전체` 선택 시 병렬 4콜의 한 갈래로 호출된다 — 공통 정책은 §3-16.

### 3-11. ReceiptController — `/api/receipts` (id = **Integer**)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-48 | POST | `/api/receipts/save` | 필수 | `ReceiptSaveRequest` (+ `items[]`) | `ReceiptResponse` | SCR-12 → SCR-13 | Phase 3 |
| API-49 | GET | `/api/receipts` | 필수 | `?page=0&size=10` | **`Page<ReceiptResponse>`** | SCR-18 (**앱 신규**) | Phase 4 |
| API-50 | GET | `/api/receipts/{id}` | 필수 | — | `ReceiptResponse` | SCR-19 | Phase 4 |
| API-51 | PUT | `/api/receipts/{id}` | 필수 | `ReceiptSaveRequest` | `ReceiptResponse` | SCR-20, SCR-23 | Phase 4 |
| API-52 | GET | `/api/receipts/search` | 필수 | `?q=<필수>&topK=5` | `List<ReceiptResponse>` | SCR-23 (**앱 신규**) | Phase 5 |
| API-53 | DELETE | `/api/receipts/{id}` | 필수 | — | `null` | SCR-18 (**앱 신규**) | Phase 4 |

**웹의 영수증 보관함은 API를 하나도 호출하지 않는 순수 목업이고, 검색 화면에는 RECEIPT 분기 자체가 없다.** 서버 API-49/52/53은 정상 동작한다 → 앱에서는 연결만 하면 되는 사실상 무료 기능. 단 **영수증은 임베딩이 생성되지 않으므로 API-52는 벡터 검색이 영구히 0건이고 fuzzy만 동작한다** (원본: `ReceiptService.save()`가 `embeddingService`를 호출하지 않음). 검색 품질 기대치를 명함/포스터/티켓과 다르게 잡아야 한다.
API-52는 유형 `영수증` 선택 시, 또는 유형 `전체` 선택 시 병렬 4콜의 한 갈래로 호출된다 — 공통 정책은 §3-16. `전체` 검색에서 영수증 결과가 유독 빈약한 것은 버그가 아니라 이 임베딩 부재 때문이며, `similarity`가 전부 fuzzy 점수라 관련도순 정렬에서 하위로 밀린다.

### 3-12. SearchHistoryController — `/api/search-histories`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-54 | GET | `/api/search-histories` | 필수 | — | `List<{id:UUID, documentType, query, createdAt}>` | SCR-23 `전체 기록 보기` (**앱 신규**) | Phase 5 |
| API-55 | DELETE | `/api/search-histories` | 필수 | — | **숫자 스칼라** (삭제 건수) | SCR-23, SCR-25, SCR-28 | Phase 6 |

- **이 테이블에 쓰는 주체는 앱이 아니라 서버다.** 앱에는 검색기록 생성 엔드포인트가 없다 — 검색 API 4종(API-19/47/52/61)이 검색 실행 **전에** `searchHistoryService.record(...)`를 무조건 호출하는 것이 유일한 적립 경로다. 따라서 **검색 API 호출 1회 = 기록 1건**이고, 앱이 이를 끌 수단은 없다. 적립량을 줄이는 유일한 레버는 **호출 횟수 자체**다 → §3-16.
- **API-54는 화면의 최근 검색어 1차 소스가 아니다.** 최근 검색어는 로컬 MMKV `search.recent`(최대 10건)를 쓰고, API-54는 `전체 기록 보기`에서만 호출한다. 이유: 즉시 표시 + 서버 왕복 절감, 그리고 `전체` 검색이 만든 4건을 로컬에서는 애초에 1건으로 적립할 수 있다 ([[Offline and State]] ST-06, ST-12).
- **API-54 응답은 렌더 단계에서 병합한다.** 동일 `query` + `createdAt` **2초 이내** 항목은 1건으로 묶어 표시한다. `전체` 검색 1회가 서버에 남긴 4행을 사용자에게 4줄로 보여주지 않기 위한 처리다 ([[Offline and State]] ST-13).
- API-55 성공 시 **로컬 `search.recent`도 함께 비운다.** 두 소스가 어긋나면 "삭제했는데 남아 보인다"가 된다 ([[Offline and State]] ST-07).

### 3-13. TicketController — `/api/tickets` (id = **Integer**)

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-56 | POST | `/api/tickets/save` | 필수 | `TicketRequest` | `TicketResponse` | SCR-12 → SCR-13 | Phase 3 |
| API-57 | GET | `/api/tickets` | 필수 | `?page=0&size=10` | **`Page<TicketResponse>`** | SCR-16, SCR-06 | Phase 4 |
| API-58 | GET | `/api/tickets/{id}` | 필수 | — | `TicketResponse` | SCR-19 | Phase 4 |
| API-59 | PUT | `/api/tickets/{id}` | 필수 | `TicketRequest` | `TicketResponse` | SCR-20, SCR-23 | Phase 4 |
| API-60 | DELETE | `/api/tickets/{id}` | 필수 | — | `null` | SCR-16 | Phase 4 |
| API-61 | GET | `/api/tickets/search` | 필수 | `?q=<필수>&topK=5` | `List<TicketResponse>` | SCR-23 | Phase 5 |

`similarity` 산식(JavaDoc 원문): **하이브리드 최종 점수 = Fuzzy × 0.6 + Vector × 0.4**, 일반 조회 시 null.
API-61은 유형 `티켓` 선택 시, 또는 유형 `전체` 선택 시 병렬 4콜의 한 갈래로 호출된다 — 공통 정책은 §3-16.

### 3-14. UserDataController — `/api/me`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 data | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-62 | DELETE | `/api/me/documents` | 필수 | — | `{deletedBusinessCards, deletedTickets, deletedPosters, deletedReceipts, deletedSearchHistories, deletedGoogleCalendarMappings, deletedNotifications}` (전부 long) | SCR-28 | Phase 6 |

### 3-15. OCR FastAPI 직접 호출 — `:8000`

| ID | 메서드 | 경로 | 인증 | 요청 | 응답 | 화면 | 페이즈 |
|---|---|---|---|---|---|---|---|
| API-63 | POST | `:8000/api/commit` | **없음 (무방비)** | multipart: `file`, `document_type`, `raw_blocks`(JSON 문자열), `corrected_fields`(JSON 문자열) | `{success, data:{image_url, count}}` — **단일 래핑** | SCR-12 | Phase 3 |
| API-64 | GET | `:8000/uploads/{TYPE}/{filename}` | 없음 | — | 이미지 바이너리 (`StaticFiles`) | SCR-06, SCR-15~SCR-19, SCR-21 | Phase 4 |
| API-65 | GET | `:8000/` | 없음 | — | `{"service":"MORA OCR Service","version":"3.0","docs":"/docs"}` | 연결 진단 | Phase 0 |
| API-66 | POST | `:8000/api/ner-label` | 없음 | JSON `{document_type,image_url,raw_blocks,corrected_fields}` | 200인데 `{"success":false,...}`일 수 있음 | **앱 미사용** | — |
| API-67 | POST | `:8000/api/scan` | 없음 | multipart `file` | 단일 래핑 스캔 결과 | **앱 미사용** (Spring 경유 API-41 사용) | — |

- **API-63은 부작용이 있는 유일한 OCR 호출이다.** 이미지를 `ocr/uploads/{TYPE}/`에 영구 저장하고 `ner_dataset`에 학습 라벨을 누적한다. `/api/scan`(API-41)은 임시파일로 처리 후 즉시 삭제하므로 부작용이 없다.
- API-63은 Spring을 우회하므로 **앱이 base URL 2개와 방화벽 포트 2개를 알아야 한다** ([[Networking]] §1).
- **API-64가 OCR 서버(:8000)에 있다는 사실이 base URL 2개의 이유다.** 이미지 URL을 Spring(:8080) 기준으로 조립하면 **모든 문서 이미지가 깨진다.** 원본: `ocr/app.py` 의 `app.mount("/uploads", StaticFiles(...))`. 조립 규칙 정본은 §5-2 `toAbsoluteImageUrl` — 상대경로에는 **`OCR_BASE`** 를 붙인다 (2026-07-27 재확인).
- API-65는 [[Networking]]의 연결 진단 체크리스트에서 "OCR 서버 도달 가능" 판정에 쓴다.

#### 헬스 프로브 — 전용 엔드포인트가 양쪽 다 없다 (2026-07-27 재확인)

| 서버 | 프로브 | 기대 응답 | 근거 |
|---|---|---|---|
| **OCR** `:8000` | **API-65** `GET /` | `{"service":"MORA OCR Service","version":"3.0","docs":"/docs"}` — 고정 | 원본 `ocr/app.py:122` |
| **Spring** `:8080` | **API-03** `GET /auth/me` (토큰 없이) | **HTTP 401** + 래핑된 본문. **본문에 `success` 필드가 있으면 MORA Spring임이 확정된다** | **actuator가 포함되어 있지 않다** → `/actuator/health` 없음. `SecurityConfig` 가 `anyRequest().permitAll()` 이고 인증은 **각 컨트롤러가 JWT로 직접 검증**하므로, 토큰 없는 요청이 필터에서 튕기지 않고 컨트롤러까지 도달해 래핑된 401을 만든다 |

**따라서 API-03은 두 가지 용도를 겸한다**: (a) 세션 복원(FR-029) — 200을 기대, (b) **연결 진단** — 401도 성공으로 판정. 진단 용도에서는 **status와 `success` 필드 존재만 읽고 본문을 렌더하지 않는다**(NFR-015, SCR-31 금지 사항). 401을 실패로 처리하면 "서버는 살아 있는데 앱이 죽었다고 말하는" 오진이 된다 — 검증은 QA-195·QA-196.

### 3-16. 검색 4종 공통 정책 — 기본 유형 · `전체` 병렬 호출 · 검색기록 적립

검색 엔드포인트는 4개(API-19 명함 / API-61 티켓 / API-47 포스터 / API-52 영수증)이고 **통합 검색 엔드포인트는 없다.** 4개 모두 시그니처가 같다: `?q=<필수>&topK`, 응답은 `ApiResponse<List<T>>` (Page 아님), `similarity`는 하이브리드 점수(`Fuzzy × 0.6 + Vector × 0.4`). 서버 기본 `topK=5`이나 **앱은 항상 `topK=50`을 명시 전송**한다(원본 웹 고정값 계승). 화면 정본은 [[Screen Specs]] SCR-23.

**1. 기본 문서유형 — 마지막 사용 유형 복원, 최초 실행 `BUSINESS_CARD`**

| 항목 | 내용 |
|---|---|
| 결정 | 검색 화면의 문서유형 초기 선택은 MMKV `search.lastDocType`에서 복원한다. 값이 없거나 열거형(`BUSINESS_CARD`/`TICKET`/`POSTER`/`RECEIPT`/`ALL`)에 없으면 **`BUSINESS_CARD`** |
| 갱신 시점 | **검색 실행 성공 시**에 그때의 선택 유형을 기록한다(칩 탭 시점이 아니다) |
| 근거(명함) | 명함이 핵심 도메인이다 — 그룹(명함첩)·전용 목록/검색 API를 온전히 갖춘 유일한 유형이고 저장 데이터가 가장 많다 |
| 근거(`전체` 배제) | `전체`를 기본값으로 두면 **첫 검색부터 요청 4배 + 검색기록 4건**이다. Hikari `maximum-pool-size: 3`인 서버에 기본값으로 얹을 부하가 아니다 |
| 정본 | [[Offline and State]] §10-1 ST-09~ST-11 (키 정의는 §1-4) |

**2. `전체` 선택 시 — 4종 병렬 호출 + 클라이언트 머지**

| 규칙 | 내용 |
|---|---|
| 호출 | API-19 · API-61 · API-47 · API-52를 **동일 `q`, `topK=50`으로 병렬 4회**. `Promise.allSettled`로 묶어 일부 실패를 허용한다 — 서버는 존재하지 않는 리소스에도 500을 던지므로(§2-1) 한 종류의 실패로 전체를 버릴 수 없다 |
| 쿼리 키 | **하나로 둔다**: `['search','ALL',q,topK]`. 4개 키로 쪼개면 로딩·에러·무효화 상태가 4벌이 되어 화면이 4번 흔들린다 |
| 머지 | 응답 4개를 한 배열로 합치고 정렬한다. 관련도순 `(b.similarity ?? 0) - (a.similarity ?? 0)` / 최신순 `createdAt` 내림차순. 유형별 DTO 형태가 다르므로 **유형 태그를 붙인 판별 유니온으로 감싼 뒤** 머지한다 |
| 동시성 | 4콜이 동시에 나가므로 Hikari pool 3을 넘긴다. §4-8 #9의 동시 요청 제한을 이 경로에도 적용한다(최대 동시 4, 그 외 요청은 큐잉) |
| 부분 실패 | 성공분은 노출하고 실패 유형만 배너로 알린다 (문구는 [[Screen Specs]] 부록 C) |

**3. 검색기록 적립 — 사용자에게 보이는 것은 항상 1건**

| 계층 | `단일 유형` 검색 | `전체` 검색 | 근거 |
|---|---|---|---|
| 서버 `search_histories` | 1건 | **4건 (막을 수 없다)** | 검색 API가 실행 전에 무조건 `record()`를 호출한다. 백엔드 수정 금지(§1) |
| 로컬 `search.recent` (MMKV) | 1건 | **1건만** (`{q, docType:'ALL', at}`) | 4건으로 적립하면 최근 검색어 10칸이 한 번의 검색으로 40% 차버린다 (ST-12) |
| API-54 표시 | 그대로 | 동일 `query` + `createdAt` 2초 이내를 **1건으로 병합 표시** | 서버 4행을 사용자에게 4줄로 보여주지 않는다 (ST-13) |

**적립을 줄이는 두 가지 레버 (둘 다 필수)**
1. **자동 검색 금지.** 명시적 제출(키보드 `search` 키 / 검색 버튼 / 검색어가 있는 상태의 칩 탭)에서만 호출한다 — §4-8 #4, FR-071.
2. **`staleTime` 5분.** 동일 `(type, q, topK)` 재검색이 캐시로 응답되면 서버 기록이 늘지 않는다. 뒤로가기 후 재진입에서 기록이 또 쌓이는 것을 막는 장치이며, `전체`는 캐시 히트 1회가 기록 4건을 막으므로 가치가 4배다 — §6-2, [[Offline and State]] ST-05.

---

## 4. 알려진 함정과 대응 (웹과 다른 지점 우선)

### 4-1. RN의 FormData 파일 객체는 웹과 다르다 — **가장 자주 깨지는 지점**

웹은 `<input type="file">`이 준 `File`(=`Blob`) 인스턴스를 그대로 `append`한다. **React Native에는 `File` 객체가 없다.** RN의 `FormData`는 `{uri, name, type}` 세 키를 가진 **plain object**를 파일로 인식하도록 특수 처리되어 있다.

```ts
// ❌ 웹 코드를 그대로 옮기면 안 된다 — RN에는 File이 없고, blob을 만들면 메모리에 전체를 올린다
// formData.append('file', file)

// ✅ RN 정답
const asset = result.assets[0];                 // expo-image-picker / expo-camera 결과
const form = new FormData();
form.append('file', {
  uri: asset.uri,          // Android: 'file:///...' 또는 'content://...' 둘 다 동작
  name: 'scan.jpg',        // ★ 확장자 필수. 없으면 OCR의 suffix 추출이 실패한다
  type: 'image/jpeg',      // ★ MIME 필수. 없으면 Spring이 파트를 파일로 인식 못 할 수 있다
} as unknown as Blob);     // TS: RN 타입 정의가 Blob만 허용하므로 캐스팅이 필요하다
```

부가 규칙 5개:
1. **`Content-Type` 헤더를 직접 설정하지 않는다.** 런타임이 `multipart/form-data; boundary=...`를 붙여야 한다. 직접 넣으면 boundary가 빠져 Spring이 파트를 파싱하지 못한다.
2. **`name`의 확장자가 저장 경로에 영향을 준다.** OCR의 `_persist_image()`가 `Path(filename).suffix`로 저장 파일 확장자를 정한다.
3. **iOS의 `ph://` URI는 업로드되지 않는다.** `expo-image-picker`는 기본적으로 `file://`로 복사해 주지만, `expo-media-library`에서 직접 얻은 asset은 `copyAsync`로 캐시 디렉터리에 복사한 뒤 업로드해야 한다.
4. **파일 크기는 앱에서 먼저 줄인다.** Spring 한도가 10MB이고 초과 시 `ApiResponse` 포맷도 아닌 에러가 온다. `expo-image-manipulator`로 **전송 장변 1280px + JPEG quality 0.85**(목표 ≤1.2MB, 규격 정본 [[Camera and Scan]] IMG-01~07)로 리사이즈한다 — 어차피 OCR 서버가 `MAX_IMAGE_SIDE = 1280`으로 줄이므로 화질 손실이 없고, 전송량·타임아웃·10MB 문제가 동시에 해결된다.
5. **`fetch`는 업로드 진행률을 주지 않는다.** 진행률과 취소가 필요한 API-41/63은 XHR 기반 업로더를 쓴다 (§5-5).

### 4-2. Spring `Page<>` 언랩 — 목록은 Page, 검색은 배열

```jsonc
// 목록 API (API-14/32/43/49/57)
{ "success": true, "data": { "content": [...], "totalElements": 42, "totalPages": 3,
                             "number": 0, "size": 20, "first": true, "last": false,
                             "numberOfElements": 20, "empty": false, "pageable": {...}, "sort": {...} } }

// 검색 API (API-19/47/52/61) 및 API-20/54
{ "success": true, "data": [ ... ] }        // ← data가 바로 배열
```

웹은 어느 쪽인지 확신하지 못해 `Array.isArray(json.data) ? json.data : (json.data?.content ?? [])`를 세 군데 복붙해 놓았다. **앱은 위 표를 근거로 확정 파싱한다** (`unwrapPage` / `unwrapList` 분리, §5-4).

**페이지네이션은 사실상 미사용 상태다.** 웹은 항상 `page=0&size=20`만 부르고 `totalPages`를 쓰지 않아 문서가 20개를 넘으면 보관함에서 사라진다. **서버는 페이징을 완전히 지원하므로 앱은 무한 스크롤을 정상 구현한다** (Phase 4). `size`는 알림만 서버 상한 50이 있고 나머지는 상한이 없으나, **결정: 앱은 모든 목록에서 `size=20`을 사용한다** (모바일 1스크린 분량 + 이미지 프리페치 비용 균형).

### 4-3. `LocalDateTime` 배열 직렬화 정규화

웹 `api.ts`의 타입 시그니처가 `string | number[]`라는 것 자체가 증거다. Jackson이 `WRITE_DATES_AS_TIMESTAMPS` 상태로 직렬화하면 `[2026,7,27,14,30,15,123456789]` 배열이 나온다. `application.yml`에 `spring.jackson.*` 설정이 하나도 없고 `ObjectMapper` 커스터마이즈 `@Bean`도 없다.

```ts
/** 서버 날짜/시각 값을 항상 문자열로 정규화한다. 문자열·숫자배열 둘 다 받는다. */
export function normalizeDateTime(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length >= 3) {
    const [y, mo, d, h = 0, mi = 0, s = 0] = v as number[];
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`;
  }
  return undefined;
}
```

**웹은 `createdAt` 하나에만 이 정규화를 적용한다.** `updatedAt`, `readAt`, `expiresAt`, `eventStartDate`, `purchaseTime` 등은 배열로 오면 그대로 깨진다.
**결정 — 앱은 서버 응답의 모든 날짜/시각 필드에 예외 없이 정규화를 적용한다.** 어댑터 계층에서 일괄 처리한다 ([[Data Model]] §5).

부가 함정: 배열→문자열 변환 결과에 **타임존이 없다**(`2026-07-27T14:30:15`). 서버는 `Asia/Seoul` 로컬시를 가정한다.
**결정 — 앱은 서버가 준 벽시계 시각을 `Asia/Seoul` 로 해석해 표시한다.** `new Date(str)`에 그대로 넣으면 기기 타임존으로 해석되어 해외 사용자에게 어긋난다.

### 4-4. `/api/scan` 이중 래핑 + snake_case 유지

`OcrService.scan()`이 Python 응답 JSON 전체를 `Map`으로 받아 다시 `ApiResponse.ok()`로 감싸므로:

```jsonc
{ "success": true, "data": { "success": true, "data": { "type": "...", "parsed": {...} } } }
```

그리고 안쪽 키는 **Spring을 거쳐도 snake_case 그대로 통과한다** (`raw_blocks`, `image_url`, `image_size`). 언랩 함수는 §5-6.

`raw_blocks[]`의 `bbox`(4점 폴리곤)와 `block_index`는 스캔 편집 화면의 바운딩박스 오버레이에 쓴다. 좌표계는 `image_size` 기준이므로 렌더 크기와의 단순 비율 계산만 하면 된다.

### 4-5. 한글 에러 메시지 인코딩 → **상태코드 기반 문구만 사용**

웹 `runSearch`만 유일하게 서버 `json.error`를 **완전히 무시**하고 고정 문구를 쓴다. 원본 주석: `// 검색 실패 메시지는 백엔드 인코딩 이슈가 있어도 깨지지 않도록 상태 코드 기반의 고정 문구를 우선 사용한다.` 백엔드 에러 문자열은 영문(`"Login required"`)과 한글(`"사용자 ID가 필요합니다."`)이 혼재하고, `application.yml`에 `server.tomcat.uri-encoding` 설정이 없다.

**결정 — 앱은 서버 `error` 문자열을 UI에 절대 노출하지 않는다.** 로그/Sentry breadcrumb에만 남기고, 사용자에게는 `kind`/`status` 기반 문구 테이블만 보여준다.

| kind | status | 사용자 문구 |
|---|---|---|
| `network` | 0 | `서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.` |
| `timeout` | 0 | `응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.` |
| `canceled` | 0 | (토스트 없음 — 사용자가 취소한 것) |
| `unauthorized` | 401 / `/auth/me*` 400 | `로그인 세션이 만료되었습니다. 다시 로그인해 주세요.` |
| `ratelimited` | 429 | `요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.` |
| `payload_too_large` | 413 | `이미지 용량이 너무 큽니다. 다시 촬영해 주세요.` |
| `client` | 400·404 등 | `요청을 처리하지 못했습니다. (${status})` |
| `server` | 5xx | `서버에서 문제가 발생했습니다. (${status})` |
| `parse` | 2xx이나 파싱 실패 | `응답을 해석하지 못했습니다.` |

검색어 등 쿼리 파라미터는 반드시 `encodeURIComponent`로 명시 인코딩한다(§5-2 `buildUrl`).

### 4-6. `imageUrl`이 DTO 컬럼이 아니라 `parsedJson` 문자열 안에 있다

| 문서 | imageUrl 위치 |
|---|---|
| 명함 | `CardResponse.imageUrl` — **정식 컬럼** |
| 포스터 / 영수증 / 티켓 | `JSON.parse(parsedJson).imageUrl` — **jsonb 문자열 내부** |

저장 시에도 대칭: `parsedJson: JSON.stringify({ ...fields, imageUrl })`. 파싱 실패는 `''`로 폴백한다. 어댑터 함수 위치는 [[Data Model]] §5.

### 4-7. 요청/응답 타입 비대칭 — 요청·응답 공용 모델 금지

| 필드 | 요청 타입 | 응답 타입 |
|---|---|---|
| `rawText` (Poster/Ticket/Receipt) | `List<String>` | `String` (서버가 공백 JOIN) |
| `eventStartDate` / `departureDate` / `purchaseDate` | `String` | `LocalDate` |
| `departureTime` / `purchaseTime` | `String` | `LocalTime` |
| 명함 `rawOcrText` | `String` (개행 JOIN) | `String` |

**명함만 저장 스키마 계열이 완전히 다르다.** Ticket/Poster/Receipt는 `docType + classificationConfidence + rawText[] + parsedJson + rawJson` 5종 세트를 공통으로 갖지만, 명함은 그중 아무것도 보내지 않고 `imageUrl + rawOcrText + 5개 필드`만 보낸다. "문서 저장" 추상화는 이 비대칭을 판별 유니온으로 흡수해야 한다 ([[Data Model]] §3-6).

### 4-8. 그 외 확정 함정 목록

| # | 함정 | 앱 대응 |
|---|---|---|
| 1 | `POST /save`가 **200** 반환 (201 아님, `Location` 헤더 없음) | 성공 판정에 201을 넣지 않는다 |
| 2 | `data`가 스칼라인 엔드포인트: API-38·API-55는 숫자, API-33·API-36은 `{count}`/`{updatedCount}` Map | 제네릭 디코더가 객체를 가정하지 않도록 `unknown`으로 받고 호출부에서 좁힌다 |
| 3 | 경로 파라미터 타입이 리소스마다 다름 — 명함/그룹/알림 = **UUID**, 티켓/포스터/영수증 = **Integer** | 모델의 `id`를 통일하지 않는다. 타입 오류 시 `ApiResponse` 포맷이 아닌 Spring 기본 에러가 온다 |
| 4 | 검색 API 호출 = 검색기록 자동 1건 적립 (`searchHistoryService.record()`가 검색 실행 **전에** 무조건 호출됨). **유형 `전체` 검색은 4콜 = 4건**이다 | **타이핑 debounce 자동검색 금지.** 명시적 제출(엔터/검색 버튼/검색어가 있는 상태의 칩 탭)에서만 호출한다. 추가로 **`전체`를 기본 유형으로 두지 않고**(기본은 마지막 사용 유형, 최초 실행 `BUSINESS_CARD`) 로컬 최근 검색어는 `전체`도 1건만 적립한다 — §3-16 |
| 5 | 저장 시 이미지가 **2번 업로드**된다 (API-41 스캔 + API-63 커밋) | 셀룰러에서 비용/지연. 리사이즈로 완화하고 두 요청 모두 진행률·취소를 노출한다 |
| 6 | API-63 실패는 웹에서 무시된다 → `imageUrl`이 빈 레코드가 생김 | 앱은 API-63 실패 시 **사용자에게 "이미지 없이 저장할까요?"를 묻고 선택**하게 한다 |
| 7 | 보상 트랜잭션 없음 — API-63 성공 후 `/save` 실패 시 고아 이미지·고아 NER 라벨이 남음 | 앱에서 롤백 불가. 저장 실패 시 동일 `file`로 재시도하도록 draft를 유지한다 (재커밋 시 이미지가 하나 더 쌓이는 것은 감수) |
| 8 | `ETC`로 분류된 문서는 저장 경로가 없음 | 편집 화면에서 문서 타입 수동 변경 UI를 제공한다 (`ETC` → 4종 중 선택) |
| 9 | `RestTemplate`에 타임아웃 없음 + Hikari `maximum-pool-size: 3` | 앱이 자체 타임아웃과 취소를 반드시 건다. 커넥션 고갈이 쉬우므로 동시 요청 수를 제한한다 |
| 10 | Swagger(`/swagger-ui.html`, `/v3/api-docs`)가 인증 없이 열려 있음 | 앱과 무관하나 [[Risks]] 등재. 개발 중에는 계약 확인용으로 유용 |

---

## 5. 모바일 API 클라이언트 설계

### 5-1. 파일 구성

```
src/lib/api/
  env.ts        # baseURL 주입 (EXPO_PUBLIC_* → 정규화)
  errors.ts     # ApiError, 정규화, 사용자 문구 테이블
  session.ts    # 토큰 getter + 401 브로드캐스트 (순환 import 차단용 얇은 레이어)
  client.ts     # apiFetch (JSON), 타임아웃/재시도/언랩
  upload.ts     # uploadMultipart (XHR, 진행률·취소)
  unwrap.ts     # unwrapPage / unwrapList / unwrapScan
  endpoints/    # 도메인별 함수 (cards.ts, posters.ts, ...) — apiFetch만 호출
```

**결정 — HTTP 코어는 `fetch` + `AbortController` 자체 래퍼, 진행률이 필요한 multipart만 XHR.** 근거: axios를 추가하지 않아도 인터셉터(래퍼 함수)·타임아웃(AbortController)·취소(AbortSignal)·진행률(XHR `upload.onprogress`)이 전부 확보된다. 의존성 하나를 줄이는 것이 APK 크기와 Expo SDK 업그레이드 리스크에 유리하다.

### 5-2. baseURL 주입과 URL 조립

```ts
// src/lib/api/env.ts
const strip = (u: string) => u.replace(/\/+$/, '');

/** Spring 백엔드. 예: http://192.168.0.10:8080 */
export const API_BASE = strip(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080');
/** OCR 서버 겸 이미지 호스트. 예: http://192.168.0.10:8000 */
export const OCR_BASE = strip(process.env.EXPO_PUBLIC_OCR_URL ?? 'http://localhost:8000');

export type QueryValue = string | number | boolean | null | undefined;

/** 쿼리 값은 UTF-8 percent-encoding을 명시 적용한다 (한글 검색어 대응, §4-5). */
export function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}?${qs}` : url;
}

/** 서버가 주는 상대 image_url을 절대 URL로 조립한다. 이미지는 :8000이 서빙한다. */
export function toAbsoluteImageUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${OCR_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}
```

### 5-3. 에러 정규화 타입

```ts
// src/lib/api/errors.ts
export type ApiErrorKind =
  | 'network' | 'timeout' | 'canceled'
  | 'unauthorized' | 'ratelimited' | 'payload_too_large'
  | 'client' | 'server' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;          // 0 = 전송 자체 실패
  readonly url: string;
  /** 서버가 준 원문. 로그 전용 — UI에 절대 노출하지 않는다 (§4-5). */
  readonly serverMessage?: string;

  constructor(kind: ApiErrorKind, status: number, url: string, serverMessage?: string) {
    super(`[${kind}/${status}] ${url}`);
    this.name = 'ApiError';
    this.kind = kind; this.status = status; this.url = url; this.serverMessage = serverMessage;
  }

  /** 사용자에게 보여줄 문구. 상태코드 기반 고정 테이블. */
  get userMessage(): string {
    switch (this.kind) {
      case 'network':           return '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.';
      case 'timeout':           return '응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
      case 'canceled':          return '';
      case 'unauthorized':      return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.';
      case 'ratelimited':       return '요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.';
      case 'payload_too_large': return '이미지 용량이 너무 큽니다. 다시 촬영해 주세요.';
      case 'parse':             return '응답을 해석하지 못했습니다.';
      case 'server':            return `서버에서 문제가 발생했습니다. (${this.status})`;
      default:                  return `요청을 처리하지 못했습니다. (${this.status})`;
    }
  }
}

/** AuthController는 도메인 실패를 400으로 내므로 /auth/me* 의 400도 세션만료로 취급한다. */
function isAuthPath(url: string) { return /\/auth\/me(\/|$|\?)/.test(url); }

export function normalizeHttpError(status: number, url: string, serverMessage?: string): ApiError {
  if (status === 401 || (status === 400 && isAuthPath(url))) return new ApiError('unauthorized', status, url, serverMessage);
  if (status === 429) return new ApiError('ratelimited', status, url, serverMessage);
  if (status === 413) return new ApiError('payload_too_large', status, url, serverMessage);
  if (status >= 500) return new ApiError('server', status, url, serverMessage);
  return new ApiError('client', status, url, serverMessage);
}
```

### 5-4. 코어 클라이언트 (인터셉터 · 401 · 타임아웃 · 재시도)

```ts
// src/lib/api/client.ts
import { API_BASE, buildUrl, type QueryValue } from './env';
import { ApiError, normalizeHttpError } from './errors';
import { getAccessToken, notifySessionExpired } from './session';

export type ApiEnvelope<T> = { success?: boolean; data?: T; error?: string; message?: string };
/** 성공 결과. data는 항상 optional (§2-1). message는 부분성공 경고. */
export type Ok<T> = { data: T | undefined; message?: string };

export const TIMEOUT = {
  read: 10_000, write: 15_000, scan: 60_000, upload: 60_000, chat: 60_000,
} as const;

const RETRYABLE_STATUS = new Set([502, 503, 504]);   // 500은 도메인 실패이므로 제외 (§2-2)

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  base?: string;                 // 기본 API_BASE. OCR 직접 호출 시 OCR_BASE 주입
  auth?: boolean;                // 기본 true
  timeoutMs?: number;
  signal?: AbortSignal;          // 화면 unmount / 사용자 취소
  retry?: boolean;               // 기본: GET만 true (멱등)
  maxRetries?: number;           // 기본 2
};

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<Ok<T>> {
  const {
    method = 'GET', body, query, base = API_BASE, auth = true,
    timeoutMs = method === 'GET' ? TIMEOUT.read : TIMEOUT.write,
    signal, retry = method === 'GET', maxRetries = 2,
  } = opts;

  const url = buildUrl(base, path, query);
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendOnce<T>(url, method, body, auth, timeoutMs, signal);
    } catch (e) {
      const err = e as ApiError;
      const canRetry =
        retry && attempt < maxRetries &&
        (err.kind === 'network' || err.kind === 'timeout' || RETRYABLE_STATUS.has(err.status));
      if (!canRetry) throw err;
      await sleep(Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200);   // 지수 백오프 + 지터
    }
  }
}

async function sendOnce<T>(
  url: string, method: string, body: unknown, auth: boolean,
  timeoutMs: number, external?: AbortSignal,
): Promise<Ok<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const relay = () => controller.abort();
  external?.addEventListener('abort', relay);

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = await getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;   // ★ Bearer + 공백 1개 고정
    }

    const res = await fetch(url, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    // 빈 바디 / 비-JSON(Spring 기본 에러 바디) 모두 견디도록 text로 먼저 받는다.
    const text = await res.text();
    let env: ApiEnvelope<T> | null = null;
    try { env = text ? (JSON.parse(text) as ApiEnvelope<T>) : null; } catch { env = null; }

    if (!res.ok || env?.success !== true) {
      const err = normalizeHttpError(res.status, url, env?.error ?? (text || undefined));
      if (err.kind === 'unauthorized') notifySessionExpired();   // 401 일괄 처리
      throw err;
    }
    return { data: env.data, message: env.message };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (timedOut) throw new ApiError('timeout', 0, url);
    if (external?.aborted) throw new ApiError('canceled', 0, url);
    throw new ApiError('network', 0, url, (e as Error)?.message);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', relay);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

```ts
// src/lib/api/session.ts — 순환 import를 막는 얇은 레이어
type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter = async () => null;
let onExpired: () => void = () => {};

export function registerSession(g: TokenGetter, expired: () => void) { tokenGetter = g; onExpired = expired; }
export const getAccessToken = () => tokenGetter();

let lastNotifiedAt = 0;
/** 동시 요청 여러 개가 401을 받아도 로그아웃 처리는 1회만 실행한다. */
export function notifySessionExpired() {
  const now = Date.now();
  if (now - lastNotifiedAt < 3000) return;
  lastNotifiedAt = now;
  onExpired();
}
```

401 처리 정책 전체(정리 대상, 라우팅)는 [[Auth]] §5.

### 5-5. multipart 업로더 (진행률 · 취소)

```ts
// src/lib/api/upload.ts
import { ApiError } from './errors';
import { getAccessToken } from './session';

export type UploadFile = { uri: string; name: string; type: string };
export type UploadHandle<T> = { promise: Promise<T>; cancel: () => void };

/** RN 전용 multipart 업로더. Content-Type을 절대 직접 설정하지 않는다 (§4-1). */
export function uploadMultipart<T>(args: {
  url: string;                              // 절대 URL (API_BASE 또는 OCR_BASE 조합)
  file: UploadFile;
  fields?: Record<string, string>;          // API-63의 document_type / raw_blocks / corrected_fields
  auth?: boolean;
  timeoutMs?: number;
  onProgress?: (ratio: number) => void;     // 0 ~ 1
  parse: (json: unknown) => T;              // 이중 언랩 등 엔드포인트별 파서
}): UploadHandle<T> {
  const { url, file, fields, auth = true, timeoutMs = 60_000, onProgress, parse } = args;
  const xhr = new XMLHttpRequest();

  const promise = (async () => {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);

    const token = auth ? await getAccessToken() : null;

    return new Promise<T>((resolve, reject) => {
      xhr.open('POST', url);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // ★ Content-Type은 설정하지 않는다. boundary를 런타임이 붙여야 한다.

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.ontimeout = () => reject(new ApiError('timeout', 0, url));
      xhr.onerror   = () => reject(new ApiError('network', 0, url));
      xhr.onabort   = () => reject(new ApiError('canceled', 0, url));
      xhr.onload = () => {
        let json: unknown = null;
        try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { json = null; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(xhr.status >= 500 ? 'server' : 'client', xhr.status, url, xhr.responseText));
          return;
        }
        try { resolve(parse(json)); } catch { reject(new ApiError('parse', xhr.status, url)); }
      };
      xhr.send(form);
    });
  })();

  return { promise, cancel: () => xhr.abort() };
}
```

### 5-6. 언랩 헬퍼

```ts
// src/lib/api/unwrap.ts
import type { ScanResult, RawBlock } from '@/types/api';

/** 목록 API (API-14/32/43/49/57) — Spring Page<> */
export type PageMeta = { totalElements: number; totalPages: number; number: number; size: number; last: boolean };
export function unwrapPage<T>(data: unknown): { items: T[]; page: PageMeta } {
  const d = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(d.content) ? (d.content as T[]) : [];
  return {
    items,
    page: {
      totalElements: Number(d.totalElements ?? items.length),
      totalPages: Number(d.totalPages ?? 1),
      number: Number(d.number ?? 0),
      size: Number(d.size ?? items.length),
      last: Boolean(d.last ?? true),
    },
  };
}

/** 검색·그룹·검색기록 API (API-19/20/47/52/54/61) — data가 바로 배열 */
export function unwrapList<T>(data: unknown): T[] { return Array.isArray(data) ? (data as T[]) : []; }

/** API-41 — Spring이 Python 응답을 한 번 더 감싼 이중 래핑 + snake_case (§4-4) */
export function unwrapScan(json: unknown): ScanResult {
  const root  = (json ?? {}) as Record<string, any>;
  const inner = root.data?.data ?? root.data ?? {};
  const raw: RawBlock[] = Array.isArray(inner.raw_blocks) ? inner.raw_blocks : [];
  return {
    type:       inner.type ?? 'ETC',
    confidence: typeof inner.confidence === 'number' ? inner.confidence : 0,
    parsed:     (inner.parsed ?? {}) as Record<string, string>,
    fields:     (inner.fields ?? {}) as Record<string, string>,
    items:      Array.isArray(inner.items) ? inner.items : [],
    rawTexts:   raw.map((b) => b.text),
    rawBlocks:  raw,
    imageUrl:   inner.image_url ?? '',        // 스캔 단계에서는 항상 ''
    imageSize:  inner.image_size ?? null,
  };
}

/** API-63 — 단일 래핑 */
export function unwrapCommit(json: unknown): { imageUrl: string; count: number } {
  const d = ((json as any)?.data ?? {}) as Record<string, unknown>;
  return { imageUrl: String(d.image_url ?? ''), count: Number(d.count ?? 0) };
}
```

### 5-7. 엔드포인트 함수 예시 (규약)

```ts
// src/lib/api/endpoints/cards.ts
import { apiFetch, TIMEOUT } from '../client';
import { unwrapPage, unwrapList } from '../unwrap';
import { toCard, toCardRequest } from '@/lib/adapters/card';   // 서버 DTO ↔ 앱 모델 (Data Model §5)

export async function listCards(params: { page: number; size?: number; groupId?: string; ungrouped?: boolean }) {
  const { data } = await apiFetch<unknown>('/api/cards', {
    query: { page: params.page, size: params.size ?? 20, groupId: params.groupId, ungrouped: params.ungrouped },
  });
  const { items, page } = unwrapPage<unknown>(data);
  return { items: items.map(toCard), page };
}

export async function searchCards(q: string, topK = 50) {                    // API-19
  const { data, message } = await apiFetch<unknown>('/api/cards/search', { query: { q, topK } });
  return { items: unwrapList<unknown>(data).map(toCard), warning: message };  // message = 임베딩 실패 경고
}

export async function deleteCard(id: string) {                               // API-17, data 없음
  await apiFetch<null>(`/api/cards/${id}`, { method: 'DELETE', timeoutMs: TIMEOUT.write });
}
```

규약 4가지:
1. 엔드포인트 함수는 **앱 모델**을 반환한다. 서버 DTO를 화면까지 흘려보내지 않는다.
2. 실패는 **throw**한다 (React Query가 `error`로 받는다). `{success:false}` 객체를 리턴하지 않는다.
3. `message`(부분성공 경고)는 버리지 말고 `warning`으로 올려 저장/검색 화면 토스트에 쓴다.
4. 쿼리 파라미터 기본값은 서버 기본값과 다를 수 있으므로 **항상 명시**한다 (`size=20`, `topK=50`).

---

## 6. React Query 키 설계

### 6-1. 키 팩토리

```ts
// src/lib/query/keys.ts
export const qk = {
  auth:  { me: () => ['auth', 'me'] as const },

  dashboard: (p: { date?: string; deadlineDays?: number } = {}) => ['dashboard', p] as const,

  cards: {
    all:    () => ['cards'] as const,
    list:   (p: { groupId?: string; ungrouped?: boolean; size?: number }) => ['cards', 'list', p] as const,
    detail: (id: string) => ['cards', 'detail', id] as const,
  },
  cardGroups: () => ['cardGroups'] as const,

  posters:  { all: () => ['posters'] as const,  list: (p: { size?: number } = {}) => ['posters', 'list', p] as const,  detail: (id: number) => ['posters', 'detail', id] as const },
  tickets:  { all: () => ['tickets'] as const,  list: (p: { size?: number } = {}) => ['tickets', 'list', p] as const,  detail: (id: number) => ['tickets', 'detail', id] as const },
  receipts: { all: () => ['receipts'] as const, list: (p: { size?: number } = {}) => ['receipts', 'list', p] as const, detail: (id: number) => ['receipts', 'detail', id] as const },

  // 검색 키에는 문서유형이 반드시 포함된다 — 같은 q라도 유형이 다르면 다른 결과다.
  // 'ALL'(유형 `전체`)도 이 자리에 들어가는 하나의 값이며, 4콜을 내부에서 합치는 단일 키다 (§3-16).
  search:        (type: SearchDocType, q: string, topK: number) => ['search', type, q, topK] as const,
  searchHistory: () => ['searchHistory'] as const,

  chat: (sessionId: string) => ['chat', sessionId] as const,

  notifications: {
    all:    () => ['notifications'] as const,
    list:   () => ['notifications', 'list'] as const,
    unread: () => ['notifications', 'unreadCount'] as const,
    settings: () => ['notificationSettings'] as const,
  },

  calendar: {
    connected: (userId: string) => ['calendar', 'connected', userId] as const,
    month:     (userId: string, year: number, month: number) => ['calendar', 'month', userId, year, month] as const,
  },
} as const;

// 검색 전용 유형. DocType(4종) + 'ALL'. 'ETC'는 검색 대상이 아니다(저장 자체가 불가).
export type SearchDocType = DocType | 'ALL';
```

> **키에 유형이 들어가는 이유** — 검색 4종은 서로 다른 엔드포인트이고 같은 `q`에 대해 전혀 다른 결과를 준다. 유형을 키에서 빼면 명함 결과가 티켓 탭에 그대로 노출된다. `topK`도 키에 포함한다(앱은 항상 50을 보내지만 키 형태를 파라미터와 1:1로 유지해 `topK`를 바꿨을 때 캐시가 저절로 갈리게 한다).
> **`'ALL'`은 4개 키가 아니라 1개 키다.** `qk.search('ALL', q, 50)` 하나가 4콜을 `Promise.allSettled`로 묶은 결과를 캐시한다. 4개 키로 쪼개면 로딩·에러·무효화가 4벌이 되어 화면이 4번 흔들리고, 검색기록 억제(캐시 히트 1회 = 기록 4건 회피)의 단위도 무너진다 — §3-16, [[Offline and State]] ST-14.
> **유형별 캐시와 `'ALL'` 캐시는 공유되지 않는다.** `전체`로 검색한 뒤 `명함` 칩을 누르면 `['search','BUSINESS_CARD',q,50]`가 비어 있으므로 재호출된다(기록 1건 추가). 이를 막으려고 `'ALL'` 응답을 유형별 키에 씨딩하는 것은 **금지** — `'ALL'` 결과는 4종을 머지·정렬한 뒤 잘린 목록이라 유형별 원본과 순서·건수가 다르고, 잘못된 캐시가 정상 결과처럼 보인다.

### 6-2. 쿼리별 옵션

| 키 | API | 유형 | staleTime | gcTime | 비고 |
|---|---|---|---|---|---|
| `['auth','me']` | API-03 | query | 5분 | 30분 | 앱 포그라운드 복귀 시 refetch |
| `['dashboard',p]` | API-24 | query | 60초 | 10분 | pull-to-refresh로 강제 무효화 |
| `['cards','list',p]` | API-14 | **infiniteQuery** | 30초 | 10분 | `getNextPageParam: (last) => last.page.last ? undefined : last.page.number + 1` |
| `['posters'\|'tickets'\|'receipts','list',p]` | API-43/57/49 | infiniteQuery | 30초 | 10분 | 동일 |
| `['*','detail',id]` | API-15/44/58/50 | query | 60초 | 10분 | 목록 캐시에서 `initialData` 주입 |
| `['cardGroups']` | API-20 | query | 5분 | 30분 | 변경 빈도 낮음 |
| `['search',type,q,topK]` | API-19/47/52/61 (`type` 1종) | query | **5분** | 10분 | `enabled: q.trim().length > 0`, **debounce 자동실행 금지** (§4-8 #4). `staleTime`이 0이 아닌 이유: 재요청 1회가 곧 검색기록 1건이므로 캐시가 억제 장치다 ([[Offline and State]] ST-05) |
| `['search','ALL',q,topK]` | API-19+47+52+61 **병렬 4콜** | query (`allSettled` 1키) | **5분** | 10분 | 유형 `전체` 전용. 캐시 히트 1회가 검색기록 4건을 막으므로 가치가 4배다. 부분 실패 시에도 성공분을 캐시한다 (§3-16) |
| `['searchHistory']` | API-54 | query | 0 | 5분 | `전체 기록 보기`에서만 사용. 화면의 최근 검색어 1차 소스는 로컬 MMKV `search.recent`다 (§3-12) |
| `['notifications','list']` | API-32 | infiniteQuery | 30초 | 10분 | |
| `['notifications','unreadCount']` | API-33 | query | 30초 | 5분 | 포그라운드 복귀 시 refetch (푸시 없음, 폴링뿐) |
| `['notificationSettings']` | API-39 | query | 5분 | 30분 | |
| `['calendar','connected',uid]` | API-27 | query | 5분 | 30분 | |
| `['calendar','month',uid,y,m]` | API-30 | query | 5분 | 30분 | |
| `['chat',sessionId]` | API-31 | **mutation + 로컬 상태** | — | — | 서버에 대화 저장이 없으므로 캐시 대상 아님 |

전역 기본값 (`QueryClient`):
```ts
defaultOptions: {
  queries: {
    retry: false,                    // 재시도는 apiFetch가 담당 (멱등 GET + 특정 상태코드만)
    refetchOnWindowFocus: false,     // RN에는 window focus가 없다. AppState로 명시 제어
    staleTime: 30_000,
  },
  mutations: { retry: false },
}
```

### 6-3. 무효화 규칙표

| 트리거 (mutation) | API | 무효화 대상 | 낙관적 업데이트 |
|---|---|---|---|
| 명함 저장 | API-13 | `['cards']`, `['dashboard']` | X (신규 id가 서버 발급) |
| 명함 수정 | API-16 | `['cards','detail',id]`, `['cards','list']` | **O** — detail 캐시 즉시 patch, 실패 시 롤백 |
| 명함 삭제 | API-17 | `['cards']`, `['dashboard']` | **O** — 목록에서 즉시 제거 |
| 명함 그룹 이동 | API-18 | `['cards']`, `['cardGroups']` | **O** |
| 그룹 생성/수정/삭제 | API-21/22/23 | `['cardGroups']`, `['cards']` | 생성만 X |
| 포스터/티켓/영수증 저장 | API-42/56/48 | 해당 `['<type>']`, `['dashboard']` | X |
| 포스터/티켓/영수증 수정 | API-45/59/51 | `['<type>','detail',id]`, `['<type>','list']` | **O** |
| 포스터/티켓/영수증 삭제 | API-46/60/53 | `['<type>']`, `['dashboard']` | **O** |
| 검색 실행 | API-19/47/52/61 (`전체`면 4콜) | `['searchHistory']` **만**. `['search',…]` 자기 키는 무효화하지 않는다 — 무효화하면 재요청이 곧 검색기록 1건(`전체`는 4건)이라 억제 장치를 스스로 깨뜨린다 | — (성공 시 로컬 `search.recent` 1건 적립 · `search.lastDocType` 갱신) |
| 알림 읽음 | API-35 | `['notifications','list']`, `['notifications','unreadCount']` | **O** |
| 알림 전체읽음 | API-36 | 위와 동일 | **O** |
| 알림 삭제 / 전체삭제 | API-37/38 | `['notifications']` | **O** |
| 알림 설정 변경 | API-40 | `['notificationSettings']` | **O** (토글 즉시 반영) |
| 닉네임 변경 | API-04 | `['auth','me']` | **O** |
| 캘린더 연동/해제 | API-25→26 / API-29 | `['calendar']` | 해제만 O |
| 검색기록 전체삭제 | API-55 | `['searchHistory']` | **O** |
| 내 문서 전체삭제 | API-62 | `['cards']`,`['posters']`,`['tickets']`,`['receipts']`,`['searchHistory']`,`['notifications']`,`['dashboard']` | X |
| 회원탈퇴 | API-06 | `queryClient.clear()` 전체 | X |
| 로그아웃 / 401 세션만료 | — | `queryClient.clear()` 전체 | X |

낙관적 업데이트 구현 규약은 [[Offline and State]]를 따른다.

---

## 7. 타임아웃 값 (요약, 전체는 [[Networking]] §6)

| 대상 | 값 | 근거 |
|---|---|---|
| GET 조회 | 10s | LAN 환경 기준 여유 3배 |
| POST/PUT/PATCH/DELETE | 15s | 임베딩 생성(OpenAI 왕복)이 저장 경로에 포함됨 |
| API-41 `/api/scan` | 60s | PaddleOCR + ResNet18 추론. `RestTemplate` 무제한이라 앱이 상한을 정해야 함 |
| API-63 `/api/commit` | 60s | 이미지 재업로드 + 정규화 |
| API-31 `/api/chat` | 60s | 3홉 순환 호출 (앱→Spring→LLM→Spring→DB) |
| 이미지 다운로드 (API-64) | 20s | |
