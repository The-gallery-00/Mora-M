# Data Model

서버 엔티티 · 앱 TypeScript 타입 · OCR 파싱 필드 키 · 서버↔앱 변환 규칙 · 로컬 저장 스키마의 단일 진실 공급원.

상위: [[Architecture]]
관련: [[API Contract]] · [[Camera and Scan]] · [[Offline and State]] · [[Screen Specs]] · [[Conventions]] · [[ADR-005 State and Data]]

---

## 1. 서버 엔티티 (PostgreSQL 16 + pgvector 0.8.2)

원본: `backend/src/main/java/com/mora/entity/`

### 1-1. `BusinessCard` → `business_cards`

| 필드 | 타입 | null | 컬럼 정의 / 의미 |
|---|---|---|---|
| `id` | `UUID` | X | `GenerationType.UUID` PK |
| `userId` | `UUID` | X | 소유자 |
| `name` / `company` / `position` / `phone` / `email` | `String` | O | 이름 / 회사 / 직책 / 전화 / 이메일 |
| `rawOcrText` | `String` | O | `TEXT` — OCR 원본 텍스트 전체 (개행 JOIN) |
| `imageUrl` | `String` | O | **4종 중 유일한 정식 이미지 컬럼.** 실제 값은 `/uploads/BUSINESS_CARD/xxx.jpg` 상대경로 |
| `groupId` | `UUID` | O | 그룹 FK. null = 미분류 |
| `embedding` | `String` | O | `vector(1536)`, `@ColumnTransformer(write="?::vector")` |
| `createdAt` | `LocalDateTime` | O | `updatable=false`, `@PrePersist` |

**`updatedAt`이 없다 — 4종 중 명함만 예외.**

### 1-2. `BusinessCardGroup` → `business_card_groups`

| 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `UUID` | X | PK |
| `userId` | `UUID` | X | 소유자 |
| `name` | `String(60)` | X | 그룹명. `UNIQUE(user_id, name)` |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

### 1-3. `Poster` → `posters`

| 필드 | 타입 | null | 컬럼 정의 / 의미 |
|---|---|---|---|
| `id` | `Integer` | X | **`IDENTITY`** (UUID 아님) |
| `userId` | `UUID` | X | |
| `docType` | `String(30)` | X | 프론트가 `"POSTER"` 전송 (서버 검증 없음) |
| `classificationConfidence` | `BigDecimal(4,3)` | O | 예 `0.950` |
| `title` | `String(255)` | O | |
| `organizerName` | `String(150)` | O | |
| `eventStartDate` / `eventEndDate` | `LocalDate` | O | |
| `contactPhone` `String(50)` / `contactEmail` `String(150)` | | O | |
| `location` | `String(255)` | O | |
| `fee` | `String(100)` | O | **OCR 미추출 — 수기 입력 전용** |
| `websiteUrl` | `TEXT` | O | |
| `description` | `TEXT` | O | **OCR 미추출 — 수기 입력 전용** |
| `rawText` | `TEXT` | O | 요청 배열을 `" "` join |
| `parsedJson` | `jsonb` | O | **`imageUrl`이 여기 숨어 있다** |
| `rawJson` | `jsonb` | O | OCR raw_blocks 전체 |
| `embedding` | `vector(1536)` | O | `rawText` 임베딩 |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

### 1-4. `Receipt` → `receipts`

| 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `Integer` | X | `IDENTITY` |
| `userId` | `UUID` | X | |
| `docType` | `String(30)` | X | 자바 기본값 `"RECEIPT"` |
| `classificationConfidence` | `BigDecimal(4,3)` | O | |
| `merchantName` | `String(255)` | O | 상호명 |
| `merchantAddress` | `TEXT` | O | **OCR 미추출** |
| `purchaseDate` | `LocalDate` | O | |
| `purchaseTime` | `LocalTime` | O | **OCR 미추출** |
| `paymentMethod` `String(50)` / `cardCompany` `String(100)` | | O | **OCR 미추출** |
| `totalAmount` | `BigDecimal(12,2)` | O | |
| `currencyCode` | `String(10)` | O | 자바 기본값 `"KRW"` |
| `rawText` `TEXT` / `parsedJson` `jsonb` / `rawJson` `jsonb` | | O | |
| `embedding` | `vector(1536)` | O | **저장 로직이 채우지 않음 → 항상 NULL** |
| `items` | `List<ReceiptItem>` | — | `cascade=ALL, orphanRemoval=true`, `@OrderBy("id ASC")` |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

**`receipts.embedding`이 항상 NULL이므로 영수증 벡터 검색은 구조적으로 0건이다.** `vectorSearch`의 `WHERE embedding IS NOT NULL` 조건에 걸린다. 영수증 검색은 pg_trgm fuzzy만 동작한다.

### 1-5. `ReceiptItem` → `receipt_items`

| 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `Integer` | X | `IDENTITY` |
| `receipt` | `Receipt` | X | `@ManyToOne(LAZY, optional=false)`, `receipt_id` |
| `itemName` | `String(255)` | X | |
| `quantity` `BigDecimal(10,2)` / `unitPrice` `BigDecimal(12,2)` / `totalPrice` `BigDecimal(12,2)` | | O | |
| `category` | `String(100)` | O | |
| `createdAt` | `LocalDateTime` | O | |

**현재 이 테이블은 비어 있다.** OCR의 품목 파서(`_build_receipt_items`)가 구현되어 있지 않아 `/api/scan`의 `items`가 항상 `[]`이고, 웹은 저장 시 `items: []`를 하드코딩한다. 앱도 동일하게 `items: []`를 보내되, 사용자가 편집 화면에서 품목을 **수기로 추가**하면 그 값은 정상 저장된다(서버 저장 경로는 완성되어 있음).

### 1-6. `Ticket` → `tickets`

| 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `Integer` | X | `IDENTITY` |
| `userId` | `UUID` | X | |
| `docType` | `String(30)` | X | |
| `classificationConfidence` | `BigDecimal(4,3)` | O | 키워드 감지 성공 시 **`1.0` 하드코딩** (실측 아님) |
| `transportType` | `String(50)` | O | 정규화값 `KTX`/`SRT`/`ITX`/`무궁화`/`고속버스`/`비행기` |
| `departureLocation` / `arrivalLocation` | `String(255)` | O | |
| `departureDate` / `arrivalDate` | `LocalDate` | O | |
| `departureTime` / `arrivalTime` | `LocalTime` | O | |
| `rawText` `TEXT` / `parsedJson` `jsonb` / `rawJson` `jsonb` | | O | |
| `embedding` | `vector(1536)` | O | |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

### 1-7. `Notification` → `notifications`

| 필드 | 타입 | null | 실제 사용값 |
|---|---|---|---|
| `id` | `UUID` | X | |
| `userId` | `UUID` | X | |
| `type` | `String(50)` | X | `"DEADLINE"`, `"SCHEDULE"`, 수동생성 기본 `"GENERAL"` |
| `title` | `String(120)` | X | `"마감 임박"`, `"일정 임박"` |
| `message` | `TEXT` | X | `"{제목} 마감이 3일 남았습니다입니다."` (원본에 문법 오류 존재) |
| `linkUrl` | `TEXT` | O | `"/dashboard/storage/posters"`, `"/dashboard/storage/tickets"` — **웹 경로다.** 앱은 이 값을 그대로 쓰지 않고 §5-6 매핑으로 변환 |
| `sourceType` / `sourceId` / `targetDate` | `String(50)` / `String(100)` / `LocalDate` | O | **응답 DTO에 포함되지 않음** |
| `readAt` | `LocalDateTime` | O | null = 미읽음 |
| `createdAt` | `LocalDateTime` | O | |

중복 방지 키 = `(userId, type, sourceType, sourceId, targetDate)` 5-튜플 → 같은 마감에 대해 알림은 **1회만** 생성된다(D-3/D-2/D-1 반복 없음). 생성 배치는 매일 **09:00 KST** 1회.

### 1-8. `NotificationSetting` → `notification_settings`

| 필드 | 타입 | null | 기본값 |
|---|---|---|---|
| `userId` | `UUID` | X | **PK 자체가 userId** (별도 id 없음) |
| `deadlineReminderDays` | `int` | X | `3` |
| `deadlineReminderEnabled` | `boolean` | X | `true` |
| `scheduleReminderEnabled` | `boolean` | X | `true` |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

`deadlineReminderDays`는 "며칠 앞까지 훑을지"의 **윈도우**이지 "며칠 전에 알릴지"가 아니다. 설정 화면 카피는 이 의미로 써야 한다.

### 1-9. `SearchHistory` → `search_histories`

| 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `UUID` | X | |
| `userId` | `UUID` | X | |
| `documentType` | `String(30)` | X | `"BUSINESS_CARD"` \| `"TICKET"` \| `"POSTER"` \| `"RECEIPT"` |
| `query` | `TEXT` | X | |
| `createdAt` | `LocalDateTime` | O | |

검색 API 호출 1회 = 기록 1건 자동 적립. **debounce 자동검색 금지** ([[API Contract]] §4-8 #4).

### 1-10. `User` → `users` / `UserAuthProvider` → `user_auth_providers`

| `users` 필드 | 타입 | null | 의미 |
|---|---|---|---|
| `id` | `UUID` | X | |
| `provider` | `String` | O | `'local'` \| `'google'` \| `'kakao'` \| `'naver'` |
| `email` | `String` | X, **unique** | |
| `passwordHash` | `String` | O | BCrypt. 소셜 계정은 NULL |
| `name` | `String` | O | 가입 시 `email.split("@")[0]` 자동 생성 |
| `picture` | `String` | O | OAuth 프로필에서만 채워짐 (업로드 엔드포인트 없음) |
| `createdAt` / `updatedAt` | `LocalDateTime` | O | |

| `user_auth_providers` 필드 | 타입 | null |
|---|---|---|
| `id` `UUID` / `userId` `UUID` / `provider` `String` / `providerUserId` `String` | | X |
| `providerEmail` / `providerName` / `picture` / `createdAt` | | O |

### 1-11. `GoogleCalendarToken` / `GoogleCalendarEvent`

| `google_calendar_tokens` | 타입 | null | 비고 |
|---|---|---|---|
| `id` `UUID` / `userId` `UUID` | | X | `userId` **unique** (유저당 1개) |
| `googleEmail` `String(255)` / `refreshToken` `TEXT` / `expiresAt` `LocalDateTime` / `scope` `TEXT` | | O | |
| `accessToken` `TEXT` | | X | |

| `google_calendar_events` | 타입 | null |
|---|---|---|
| `id` `UUID` / `userId` `UUID` / `documentType` `String(30)` / `documentId` `String(64)` / `googleEventId` `String(255)` / `calendarId` `String(255)`(기본 `"primary"`) | | X |
| `createdAt` / `updatedAt` | | O |

### 1-12. PK 타입 불일치 (앱 모델 설계에 직결)

| 리소스 | id 타입 |
|---|---|
| 명함, 명함그룹, 알림, 사용자, 검색기록, 구글캘린더 | **UUID (string)** |
| 포스터, 티켓, 영수증, 영수증품목 | **Integer (number)** |

**결정 — 앱은 id 타입을 통일하지 않는다.** `Uuid = string`, `IntId = number` 두 별칭을 두고 모델별로 정확히 쓴다. 잘못된 타입을 보내면 Spring이 `MethodArgumentTypeMismatchException`을 던지고 `ApiResponse` 포맷이 아닌 기본 에러 바디가 온다.

---

## 2. 문서 4종 파싱 필드 키 (스캔 편집 화면 렌더링 기준표)

단일 진실 공급원: `ocr/src/classifier/field_schema.py`의 `DOCUMENT_FIELDS`(내부 라벨 → 외부 필드명)와 `FIELD_LABELS_KO`.

**렌더링 규칙**: 서버가 `/api/scan` 응답의 `fields`(= `{필드키: 한국어라벨}`)를 내려주면 그것을 우선 사용하고, 비어 있으면 아래 표에서 폴백한다. 값은 `parsed`에서 찾고, 없으면 빈 문자열로 렌더링한다(OCR은 빈 값을 아예 누락시키므로 폼에는 모든 키가 떠야 한다).

### 2-1. BUSINESS_CARD (12필드)

| # | field key | 한국어 라벨 | 입력 타입 | 검증 규칙 | 저장 여부 |
|---|---|---|---|---|---|
| 1 | `name` | 이름 | text | 1~40자. 공백 포함 한글이름은 OCR이 이미 공백 제거(`이 응 환`→`이응환`) | → `name` |
| 2 | `english_name` | 영문 이름 | text | 영문/공백/`.`/`-`만. 숫자 포함 시 경고 (OCR이 숫자 포함을 드롭함) | **저장 안 됨** |
| 3 | `company_name` | 회사명 | text | 1~100자. 멀티라인 병합 대상 | → `company` |
| 4 | `department` | 부서 | text | 0~60자. 멀티라인 병합 대상 | **저장 안 됨** |
| 5 | `job_title` | 직책 | text | 0~60자. 영문 1~3자는 OCR이 드롭 | → `position` |
| 6 | `mobile_phone` | 휴대폰 | tel | `^01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}$` 권장. `+82` 입력 시 `0`으로 환원 | → `phone` (1순위) |
| 7 | `office_phone` | 사무실 전화 | tel | `^0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}$` | **저장 안 됨** |
| 8 | `fax` | 팩스 | tel | 유선 패턴 동일 | **저장 안 됨** |
| 9 | `email` | 이메일 | email | `^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$` | → `email` (1순위) |
| 10 | `address` | 주소 | textarea | 0~200자. 선두 5자리 우편번호는 `zip_code`로 분리 권장 | **저장 안 됨** |
| 11 | `website` | 웹사이트 | url | 스킴 없으면 `https://` 자동 보정. 유효 TLD 확인 | **저장 안 됨** |
| 12 | `zip_code` | 우편번호 | text (numeric) | `^\d{5}$` | **저장 안 됨** |

**명함은 12필드 중 5개만 DB에 들어간다.** 나머지 7개(`english_name`, `department`, `office_phone`, `fax`, `address`, `website`, `zip_code`)는 편집 화면에 뜨지만 `BusinessCard` 엔티티에 컬럼이 없어 저장 시 버려지고 `rawOcrText`에 원문으로만 남는다.
**결정 — 앱은 저장되지 않는 7개 필드를 "읽기 보조 정보" 섹션으로 접어서 보여주고, 라벨 옆에 `저장 안 됨` 배지를 단다.** 사용자가 열심히 고쳐도 사라지는 것을 숨기면 신뢰가 깨진다. 근거: 백엔드 수정 금지 제약.
폴백 규칙: `phone`은 `mobile_phone` → `contact_phone`, `email`은 `email` → `contact_email` 순으로 채운다(웹과 동일).

### 2-2. POSTER (OCR 8필드 + 수기 2필드)

| # | field key | 한국어 라벨 | 입력 타입 | 검증 규칙 | 저장 필드 |
|---|---|---|---|---|---|
| 1 | `title` | 제목 | text | 1~255자 (DB 상한). 포스터는 bbox 상단 큰 글자 밴드를 title로 묶음 | `title` |
| 2 | `organizer_name` | 주최자 | text | 0~150자 | `organizerName` |
| 3 | `event_start_date` | 행사 시작일 | date | **`YYYY-MM-DD` 강제** (§4-1) | `eventStartDate` |
| 4 | `event_end_date` | 행사 종료일 | date | `YYYY-MM-DD`. 시작일 ≤ 종료일 검증 | `eventEndDate` |
| 5 | `contact_phone` | 연락처 전화 | tel | 휴대폰/유선 패턴 | `contactPhone` |
| 6 | `contact_email` | 연락처 이메일 | email | 이메일 패턴 | `contactEmail` |
| 7 | `location` | 장소 | text | 0~255자 | `location` |
| 8 | `website_url` | 웹사이트 URL | url | 스킴 보정 | `websiteUrl` |
| 9 | `fee` | 참가비 | text | 0~100자. **OCR 미추출 — 항상 빈 값으로 시작** | `fee` |
| 10 | `description` | 설명 | textarea | 0~1000자(앱 상한). **OCR 미추출** | `description` |

포스터 날짜 주의: OCR이 연도 없는 날짜를 **올해로 가정**한다(`datetime.date.today().year`). 연말/연초 포스터에서 오답이 발생하므로 편집 화면에서 연도를 반드시 확인하게 한다.

### 2-3. RECEIPT (OCR 3필드 + 수기 5필드 + 품목)

| # | field key | 한국어 라벨 | 입력 타입 | 검증 규칙 | 저장 필드 |
|---|---|---|---|---|---|
| 1 | `store_name` | 가게 이름 | text | 1~255자 | `merchantName` (폴백 `merchant_name`) |
| 2 | `purchase_date` | 구매일자 | date | **`YYYY-MM-DD` 강제.** OCR은 ISO 변환을 하지 않고 `'06-02 21:13'` 같은 값을 낸다 → 편집 화면에서 date picker로 재입력 유도 | `purchaseDate` |
| 3 | `total_amount` | 합계금액 | money | 숫자만 추출(`₩12,300` → `12300`). 0 이상 | `totalAmount` (BigDecimal) |
| 4 | `merchant_address` | 주소 | textarea | **OCR 미추출** | `merchantAddress` (폴백 `address`) |
| 5 | `purchase_time` | 구매시각 | time | `HH:MM`. **OCR 미추출** | `purchaseTime` |
| 6 | `payment_method` | 결제수단 | select(`카드`/`현금`/`간편결제`/`기타`) | **OCR 미추출** | `paymentMethod` |
| 7 | `card_company` | 카드사 | text | 0~100자. **OCR 미추출** | `cardCompany` |
| 8 | `currency_code` | 통화 | select | 기본 `KRW`. **OCR 미추출** | `currencyCode` |
| — | `items[]` | 구매 품목 | 반복 필드 | `itemName` 필수, 나머지 숫자 | `items[]` |

품목 행 필드: `itemName`(text, 1~255자, 필수) · `quantity`(number ≥ 0) · `unitPrice`(money ≥ 0) · `totalPrice`(money ≥ 0) · `category`(text 0~100자).
**결정 — 앱은 품목 수기 추가 UI를 제공한다.** OCR 품목 파서는 미구현이지만 서버 저장 경로(`ReceiptItem`)는 완성되어 있어, 웹이 버리고 있던 기능을 앱에서 살릴 수 있다.

### 2-4. TICKET (7필드)

| # | field key | 한국어 라벨 | 입력 타입 | 검증 규칙 | 저장 필드 |
|---|---|---|---|---|---|
| 1 | `transport_type` | 교통수단 | select + 자유입력 | 프리셋 `KTX`/`SRT`/`ITX`/`무궁화`/`고속버스`/`비행기` | `transportType` |
| 2 | `departure_location` | 출발지 | text | 0~255자 | `departureLocation` |
| 3 | `departure_date` | 출발일 | date | **`YYYY-MM-DD` 강제** | `departureDate` |
| 4 | `departure_time` | 출발 시간 | time | **`HH:MM` 강제** (§4-1) | `departureTime` |
| 5 | `arrival_location` | 도착지 | text | 0~255자 | `arrivalLocation` |
| 6 | `arrival_date` | 도착일 | date | `YYYY-MM-DD`. 출발일 ≤ 도착일 | `arrivalDate` |
| 7 | `arrival_time` | 도착 시간 | time | `HH:MM` | `arrivalTime` |

`ETC`: `DOCUMENT_FIELDS["ETC"] = {}` — 필드 없음. **`ETC`는 저장 경로 자체가 없으므로** 편집 화면에서 문서 타입을 4종 중 하나로 바꾸도록 강제한다.

### 2-5. 입력 타입 → 컴포넌트 매핑

| 입력 타입 | 컴포넌트 | 키보드 | 비고 |
|---|---|---|---|
| `text` | `TextField` | default | |
| `textarea` | `TextField multiline` | default | 최소 3줄 |
| `tel` | `TextField` | `phone-pad` | 입력 중 하이픈 자동 삽입 |
| `email` | `TextField` | `email-address` | `autoCapitalize="none"` |
| `url` | `TextField` | `url` | `autoCapitalize="none"` |
| `date` | `DateField` → 네이티브 date picker | — | 출력은 항상 `YYYY-MM-DD` |
| `time` | `TimeField` → 네이티브 time picker | — | 출력은 항상 `HH:MM` |
| `money` | `TextField` | `numeric` | 표시 `12,300원` / 전송 `12300` |
| `select` | `Chip` 그룹 또는 바텀시트 피커 | — | |

---

## 3. 앱 TypeScript 타입 정의

원본 `frontend/types/index.ts` · `frontend/types/storage.ts`를 기반으로 정리·확장했다. 원본의 이름 충돌(`BusinessCard`가 두 파일에 서로 다르게 존재)과 어휘 분열(`ItemType` 소문자 4종 vs `DocumentType` 대문자 5종)을 해소한다.

### 3-1. 기본 별칭과 어휘 (`src/types/common.ts`)

```ts
/** 서버 PK 타입이 리소스마다 다르므로 별칭을 분리한다 (§1-12). */
export type Uuid = string;
export type IntId = number;

/** 서버 날짜/시각 문자열. 배열로 올 수 있어 어댑터에서 정규화된 뒤의 형태다 (§5-2). */
export type IsoDate = string;      // 'YYYY-MM-DD'
export type IsoTime = string;      // 'HH:MM' 또는 'HH:MM:SS'
export type IsoDateTime = string;  // 'YYYY-MM-DDTHH:MM:SS' (타임존 없음 = Asia/Seoul 로컬시)

/** API 문서 타입 (대문자). 서버와 주고받는 유일한 어휘. */
export type DocType = 'BUSINESS_CARD' | 'POSTER' | 'RECEIPT' | 'TICKET' | 'ETC';
/** 챗봇·검색이 지원하는 타입 (ETC 제외). */
export type ChatDocType = Exclude<DocType, 'ETC'>;

/** 라우트/스토어 세그먼트 (소문자). 화면 경로와 탭 키에만 쓴다. */
export type DocSlug = 'cards' | 'posters' | 'receipts' | 'tickets';

/** 한글 라벨 / 소문자 슬러그 / 대문자 API 타입 3자 매핑 — 단 한 곳에만 둔다. */
export const DOC_META: Record<ChatDocType, { slug: DocSlug; labelKo: string }> = {
  BUSINESS_CARD: { slug: 'cards',    labelKo: '명함' },
  POSTER:        { slug: 'posters',  labelKo: '포스터' },
  RECEIPT:       { slug: 'receipts', labelKo: '영수증' },
  TICKET:        { slug: 'tickets',  labelKo: '티켓' },
};
export const SLUG_TO_DOC: Record<DocSlug, ChatDocType> = {
  cards: 'BUSINESS_CARD', posters: 'POSTER', receipts: 'RECEIPT', tickets: 'TICKET',
};
```

### 3-2. API 봉투

```ts
/** 서버 원본 봉투. data는 null일 때 키 자체가 사라진다 ([[API Contract]] §2-1). */
export type ApiEnvelope<T> = { success?: boolean; data?: T; error?: string; message?: string };

/** Spring Page<> 언랩 결과. */
export type PageMeta = { totalElements: number; totalPages: number; number: number; size: number; last: boolean };
export type Paged<T> = { items: T[]; page: PageMeta };
```

### 3-3. 서버 DTO 타입 (`src/types/dto.ts`) — 어댑터 입력 전용

**규칙: 이 타입들은 어댑터 함수의 인자로만 등장한다. 화면·스토어에 직접 노출 금지.** 날짜 필드가 `unknown`인 이유는 문자열/숫자배열 둘 다 올 수 있기 때문이다(§5-2).

```ts
export type CardDto = {
  id: Uuid; name?: string; company?: string; position?: string; phone?: string; email?: string;
  rawOcrText?: string; imageUrl?: string; groupId?: Uuid | null;
  createdAt?: unknown; similarity?: number | null;
};

export type CardGroupDto = { id: Uuid; name: string; createdAt?: unknown; updatedAt?: unknown };

export type PosterDto = {
  id: IntId; userId?: Uuid; docType?: string; classificationConfidence?: number | string | null;
  title?: string; organizerName?: string;
  eventStartDate?: unknown; eventEndDate?: unknown;
  contactPhone?: string; contactEmail?: string; location?: string; fee?: string;
  websiteUrl?: string; description?: string;
  rawText?: string; parsedJson?: string; rawJson?: string;
  createdAt?: unknown; updatedAt?: unknown; similarity?: number | null;
};

export type TicketDto = {
  id: IntId; userId?: Uuid; docType?: string; classificationConfidence?: number | string | null;
  transportType?: string;
  departureLocation?: string; departureDate?: unknown; departureTime?: unknown;
  arrivalLocation?: string;   arrivalDate?: unknown;   arrivalTime?: unknown;
  rawText?: string; parsedJson?: string; rawJson?: string;
  createdAt?: unknown; updatedAt?: unknown; similarity?: number | null;
};

export type ReceiptItemDto = {
  id: IntId; itemName?: string;
  quantity?: number | string | null; unitPrice?: number | string | null; totalPrice?: number | string | null;
  category?: string; createdAt?: unknown;
};

export type ReceiptDto = {
  id: IntId; userId?: Uuid; docType?: string; classificationConfidence?: number | string | null;
  merchantName?: string; merchantAddress?: string;
  purchaseDate?: unknown; purchaseTime?: unknown;
  paymentMethod?: string; cardCompany?: string;
  totalAmount?: number | string | null; currencyCode?: string;
  rawText?: string; parsedJson?: string; rawJson?: string;
  items?: ReceiptItemDto[];
  createdAt?: unknown; updatedAt?: unknown; similarity?: number | null;
};

export type UserDto = { id: Uuid; email: string; name?: string; picture?: string; provider?: string; createdAt?: unknown };
export type AuthDto = { token: string; userId: Uuid; email: string; name?: string };
export type NotificationDto = {
  id: Uuid; type?: string; title?: string; message?: string; linkUrl?: string | null;
  read?: boolean; readAt?: unknown; createdAt?: unknown;
};
export type NotificationSettingDto = {
  deadlineReminderDays?: number; deadlineReminderEnabled?: boolean; scheduleReminderEnabled?: boolean;
  createdAt?: unknown; updatedAt?: unknown;
};
export type SearchHistoryDto = { id: Uuid; documentType?: string; query?: string; createdAt?: unknown };
export type DashboardDto = {
  date?: unknown; deadlineDays?: number;
  todayScheduleCount?: number; upcomingDeadlineCount?: number; storedDocumentCount?: number;
  upcomingDeadlines?: { id: string; type: string; title: string; subtitle: string; date: string; dDay: number; imageUrl: string }[];
  todaySchedules?: { id: string; type: string; title: string; time: string; date: string }[];
};
```

### 3-4. 앱 도메인 모델 (`src/types/models.ts`)

```ts
/** 모든 문서 카드가 공유하는 최소 형태. 리스트/그리드/검색 결과가 이걸로 렌더링된다. */
export type DocSummary = {
  kind: ChatDocType;
  key: string;              // `${kind}:${id}` — 혼합 리스트의 안정 키
  id: Uuid | IntId;
  title: string;            // 카드 상단 큰 글씨
  subtitle?: string;        // 보조 한 줄
  imageUrl?: string;        // 절대 URL로 변환된 값 (§5-3)
  createdAt?: IsoDateTime;
  similarity?: number;      // 검색 결과에만 존재 (0~1)
};

export type Card = {
  kind: 'BUSINESS_CARD';
  id: Uuid;
  name: string; company: string; position: string; phone: string; email: string;
  rawOcrText?: string;
  imageUrl?: string;                  // 절대 URL
  groupId: Uuid | null;               // null = 미분류
  createdAt?: IsoDateTime;
  similarity?: number;
};

export type CardGroup = { id: Uuid; name: string; createdAt?: IsoDateTime; updatedAt?: IsoDateTime };

export type Poster = {
  kind: 'POSTER';
  id: IntId;
  title: string; organizerName: string;
  eventStartDate?: IsoDate; eventEndDate?: IsoDate;
  contactPhone: string; contactEmail: string;
  location: string; fee: string; websiteUrl: string; description: string;
  rawText?: string;
  imageUrl?: string;                  // parsedJson.imageUrl → 절대 URL
  confidence?: number;
  createdAt?: IsoDateTime; updatedAt?: IsoDateTime;
  similarity?: number;
};

export type Ticket = {
  kind: 'TICKET';
  id: IntId;
  transportType: string;
  departureLocation: string; departureDate?: IsoDate; departureTime?: IsoTime;
  arrivalLocation: string;   arrivalDate?: IsoDate;   arrivalTime?: IsoTime;
  rawText?: string;
  imageUrl?: string;
  confidence?: number;
  createdAt?: IsoDateTime; updatedAt?: IsoDateTime;
  similarity?: number;
};

export type ReceiptItem = {
  id?: IntId;
  itemName: string;
  quantity?: number; unitPrice?: number; totalPrice?: number;
  category?: string;
};

export type Receipt = {
  kind: 'RECEIPT';
  id: IntId;
  merchantName: string; merchantAddress: string;
  purchaseDate?: IsoDate; purchaseTime?: IsoTime;
  paymentMethod: string; cardCompany: string;
  totalAmount?: number; currencyCode: string;
  items: ReceiptItem[];
  rawText?: string;
  imageUrl?: string;
  confidence?: number;
  createdAt?: IsoDateTime; updatedAt?: IsoDateTime;
  similarity?: number;
};

export type AnyDoc = Card | Poster | Ticket | Receipt;

export type UserProfile = {
  id: Uuid; email: string; name: string;
  picture?: string;
  provider: 'local' | 'google' | 'kakao' | 'naver';
  isLocalAccount: boolean;            // provider === 'local' 파생값. 비번변경/탈퇴 UI 분기용
  createdAt?: IsoDateTime;
};

export type AppNotification = {
  id: Uuid;
  type: 'DEADLINE' | 'SCHEDULE' | 'GENERAL' | string;
  title: string; message: string;
  target?: { slug: DocSlug };         // linkUrl을 앱 라우트로 변환한 결과 (§5-6)
  read: boolean;
  readAt?: IsoDateTime; createdAt?: IsoDateTime;
};

export type NotificationSetting = {
  deadlineReminderDays: number;
  deadlineReminderEnabled: boolean;
  scheduleReminderEnabled: boolean;
};

export type SearchHistoryEntry = { id: Uuid; docType: ChatDocType; query: string; createdAt?: IsoDateTime };

export type DashboardSummary = {
  date: IsoDate; deadlineDays: number;
  todayScheduleCount: number; upcomingDeadlineCount: number; storedDocumentCount: number;
  upcomingDeadlines: { id: string; kind: 'TICKET' | 'POSTER'; title: string; subtitle: string; date: IsoDate; dDay: number; imageUrl?: string }[];
  todaySchedules:    { id: string; kind: 'TICKET' | 'POSTER'; title: string; time: string; date: IsoDate }[];
};
```

### 3-5. 스캔 파이프라인 타입 (`src/types/scan.ts`)

```ts
export type RawBlock = { text: string; confidence: number; bbox: number[][]; block_index: number };
export type OcrImageSize = { width: number; height: number };

/** API-41 이중 언랩 결과. 키는 서버 snake_case를 그대로 유지한 부분이 있다. */
export type ScanResult = {
  type: DocType;
  confidence: number;                     // 0~1. TICKET 키워드 감지 시 1.0 하드코딩
  parsed: Record<string, string>;         // 값이 추출된 필드만 (snake_case 키)
  fields: Record<string, string>;         // {필드키: 한국어라벨} 전체 목록. 폼 렌더링용
  items: unknown[];                       // 영수증 품목. 현재 항상 []
  rawTexts: string[];
  rawBlocks: RawBlock[];
  imageUrl: string;                       // 스캔 단계에서는 항상 ''
  imageSize: OcrImageSize | null;
};

/** 편집 화면의 작업 상태. 저장 완료 전까지 MMKV draft로 보존한다 (§6-2). */
export type ScanDraft = {
  draftId: string;                        // uuid v4
  localUri: string;                       // 리사이즈 후 캐시 파일 경로
  scan: ScanResult;
  docType: ChatDocType;                   // 사용자가 ETC에서 변경했을 수 있음
  values: Record<string, string>;         // 사용자가 편집한 최종 필드값 (snake_case 키)
  receiptItems: ReceiptItem[];            // RECEIPT 전용 수기 품목
  committedImageUrl?: string;             // API-63 성공 시 받은 상대경로
  createdAt: number;                      // Date.now()
};
```

### 3-6. 저장 요청 타입 (판별 유니온) — 명함의 비대칭을 흡수

```ts
/** Ticket/Poster/Receipt 공통 5종 세트. 명함에는 존재하지 않는다. */
type CommonSavePayload = {
  docType: ChatDocType;
  classificationConfidence: number;
  rawText: string[];                      // ★ 요청은 배열 (응답은 String)
  parsedJson: string;                     // JSON.stringify({ ...values, imageUrl })
  rawJson: string;                        // JSON.stringify(rawBlocks)
};

export type SaveCardInput = {
  kind: 'BUSINESS_CARD';
  imageUrl: string;                       // ★ 명함만 정식 필드로 전달
  rawOcrText: string;                     // ★ 배열이 아니라 '\n' JOIN 문자열
  name: string; company: string; position: string; phone: string; email: string;
  groupId?: Uuid | null;
};

export type SavePosterInput = CommonSavePayload & {
  kind: 'POSTER';
  title: string; organizerName: string;
  eventStartDate: string; eventEndDate: string;     // ★ 'YYYY-MM-DD' 문자열
  contactPhone: string; contactEmail: string;
  location: string; fee: string; websiteUrl: string; description: string;
};

export type SaveTicketInput = CommonSavePayload & {
  kind: 'TICKET';
  transportType: string;
  departureLocation: string; departureDate: string; departureTime: string;   // 'HH:MM'
  arrivalLocation: string;   arrivalDate: string;   arrivalTime: string;
};

export type SaveReceiptInput = CommonSavePayload & {
  kind: 'RECEIPT';
  merchantName: string; merchantAddress: string;
  purchaseDate: string; purchaseTime: string;
  paymentMethod: string; cardCompany: string;
  totalAmount: number | null; currencyCode: string;
  items: ReceiptItem[];
};

export type SaveDocumentInput = SaveCardInput | SavePosterInput | SaveTicketInput | SaveReceiptInput;
```

---

## 4. 값 정규화 규칙 (저장 전 필수)

### 4-1. 날짜·시각을 반드시 서버가 파싱 가능한 형태로 보낼 것

서버는 문자열을 받아 `LocalDate`/`LocalTime`으로 파싱하는데, **파싱 실패 시 예외가 아니라 조용히 `null`을 넣는다.** 즉 "저장은 성공했는데 날짜만 사라지는" 무성 실패가 발생한다.

원본: `PosterService.parseDate` / `TicketService.parseDate` / `ReceiptService.parseDate`

| 대상 | 서버가 받아들이는 형식 | 앱이 보내야 하는 형식 |
|---|---|---|
| 날짜 | `yyyy-MM-dd`, `yyyy.MM.dd`, `yyyy/MM/dd`, `yyyy년 MM월 dd일`, `M.d`(올해), `M월 d일`(올해). 괄호 안 요일 `(월)`은 제거 후 파싱 | **`yyyy-MM-dd` 고정** |
| 시각 | `H:mm`, `H:mm:ss`, `오전/오후 H시 M분`, `am/pm` | **`HH:mm` 고정** |
| 실패 시 | **`null` 저장 (에러 없음)** | 앱이 date/time picker로만 입력받아 형식을 보장한다 |

**결정 — 편집 화면의 날짜/시각은 자유 텍스트 입력을 허용하지 않는다.** OCR 원문(`'06-02 21:13'`, `'2026.03.15(토)'`)은 힌트로만 표시하고 실제 값은 picker로 확정한다. `M.d`처럼 연도 없는 값을 그대로 보내면 서버가 **올해**로 채워 넣어 조용히 틀린 데이터가 된다.

### 4-2. 금액 정규화

```ts
/** '₩12,300원' → 12300. 숫자를 못 찾으면 null. 원본 api.ts parseMoney 동작과 동일. */
export function parseMoney(v?: string | null): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
/** 12300 → '12,300원' (표시 전용) */
export const formatMoney = (n?: number | null) => (n == null ? '' : `${n.toLocaleString('ko-KR')}원`);
```

### 4-3. 전화번호

```ts
/** '+82 10-1234-5678' → '010-1234-5678'. OCR의 _normalize_phone과 같은 의도. */
export function normalizePhone(v?: string | null): string {
  if (!v) return '';
  let s = String(v).trim().replace(/^\+82[-.\s]?/, '0');
  const d = s.replace(/[^\d]/g, '');
  if (/^01[016789]\d{7,8}$/.test(d)) return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^0\d{8,10}$/.test(d))         return d.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return s;
}
```

### 4-4. 길이 상한 (DB 컬럼 기준, 앱에서 선차단)

| 필드 | 상한 | 필드 | 상한 |
|---|---|---|---|
| 그룹명 | 60 | 포스터 `title` / `location` / 티켓 `*Location` / 영수증 `merchantName` | 255 |
| 포스터 `organizerName` / 포스터·명함 이메일 | 150 | 포스터 `fee` / 영수증 `cardCompany` | 100 |
| 티켓 `transportType` / 포스터 `contactPhone` / 영수증 `paymentMethod` | 50 | `docType` | 30 |
| 닉네임 | **2~20자**, `^[a-zA-Z0-9가-힣_.\-]+$` | 통화 | 10 |

닉네임 규칙은 서버 `AuthService.changeName`에도 동일하게 구현되어 있다(원본: `trimmed.length < 2 || > 20`, `^[a-zA-Z0-9가-힣_.\\-]+$`). 앱은 같은 규칙을 클라이언트에서 선검증한다.

---

## 5. 서버 응답 ↔ 앱 모델 매핑

### 5-1. 계층 배치 (변환 함수가 어디에 있어야 하는가)

```
화면 (app/**)            ← 앱 모델만 본다
  └ 훅 (src/hooks/**)                       React Query · 낙관적 업데이트
      └ 엔드포인트 (src/lib/api/endpoints/) ← 여기서 어댑터를 호출한다
          ├ 어댑터 (src/lib/adapters/)      ★ 유일한 변환 지점
          │    card.ts / poster.ts / ticket.ts / receipt.ts /
          │    user.ts / notification.ts / dashboard.ts / common.ts
          └ 클라이언트 (src/lib/api/client.ts)
```

**규칙 5가지**
1. **어댑터는 순수 함수**다. 네트워크·스토리지·전역 상태에 접근하지 않는다 → 단위 테스트 대상 1순위.
2. 방향별로 함수를 나눈다: `toCard(dto): Card` (응답→앱) / `toCardRequest(input): object` (앱→요청). 요청·응답 타입이 비대칭이므로 하나의 함수로 왕복시키지 않는다.
3. **날짜/시각 정규화는 어댑터 진입부에서 전 필드에 일괄 적용**한다. 화면에서 `normalizeDateTime`을 부르는 코드가 있으면 리뷰에서 반려한다.
4. **`imageUrl` 절대화도 어댑터에서 끝낸다.** 화면은 `toAbsoluteImageUrl`을 모른다.
5. 서버가 준 알 수 없는 필드는 버린다. 앱 모델은 서버 DTO의 부분집합 + 파생값이다.

### 5-2. 날짜/시각 정규화 (`src/lib/adapters/common.ts`)

```ts
/** 서버 LocalDateTime/LocalDate/LocalTime을 문자열로 정규화. 숫자배열 직렬화 대응. */
export function normDateTime(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const p = (n: number) => String(n).padStart(2, '0');
    const a = v as number[];
    if (a.length >= 3) {                       // [y,mo,d,(h,mi,s,ns)]
      const [y, mo, d, h = 0, mi = 0, s = 0] = a;
      return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`;
    }
    if (a.length === 2) return `${p(a[0])}:${p(a[1])}`;          // LocalTime [h,mi]
  }
  return undefined;
}
export const normDate = (v: unknown) => normDateTime(v)?.slice(0, 10);
export function normTime(v: unknown): string | undefined {
  const s = normDateTime(v);
  if (!s) return undefined;
  return s.includes('T') ? s.slice(11, 16) : s.slice(0, 5);
}
export const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
};
export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
```

### 5-3. `parsedJson`에서 imageUrl 꺼내기

```ts
// src/lib/adapters/common.ts
export function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}
/** Poster/Ticket/Receipt 전용. 명함은 dto.imageUrl을 직접 쓴다. */
export function imageUrlFromParsedJson(parsedJson?: string | null): string | undefined {
  const v = parseJsonObject(parsedJson).imageUrl;
  return typeof v === 'string' && v ? toAbsoluteImageUrl(v) : undefined;
}
```

### 5-4. 어댑터 예시 (응답 → 앱)

```ts
// src/lib/adapters/poster.ts
export function toPoster(dto: PosterDto): Poster {
  return {
    kind: 'POSTER',
    id: dto.id,
    title: str(dto.title), organizerName: str(dto.organizerName),
    eventStartDate: normDate(dto.eventStartDate), eventEndDate: normDate(dto.eventEndDate),
    contactPhone: str(dto.contactPhone), contactEmail: str(dto.contactEmail),
    location: str(dto.location), fee: str(dto.fee),
    websiteUrl: str(dto.websiteUrl), description: str(dto.description),
    rawText: dto.rawText ?? undefined,
    imageUrl: imageUrlFromParsedJson(dto.parsedJson),
    confidence: num(dto.classificationConfidence),
    createdAt: normDateTime(dto.createdAt), updatedAt: normDateTime(dto.updatedAt),
    similarity: dto.similarity ?? undefined,
  };
}

// src/lib/adapters/card.ts
export function toCard(dto: CardDto): Card {
  return {
    kind: 'BUSINESS_CARD', id: dto.id,
    name: str(dto.name), company: str(dto.company), position: str(dto.position),
    phone: str(dto.phone), email: str(dto.email),
    rawOcrText: dto.rawOcrText ?? undefined,
    imageUrl: toAbsoluteImageUrl(dto.imageUrl),   // ★ 명함만 정식 컬럼
    groupId: dto.groupId ?? null,
    createdAt: normDateTime(dto.createdAt),
    similarity: dto.similarity ?? undefined,
  };
}

/** 혼합 리스트(검색 결과 등)를 위한 요약 변환. */
export const cardToSummary = (c: Card): DocSummary => ({
  kind: 'BUSINESS_CARD', key: `BUSINESS_CARD:${c.id}`, id: c.id,
  title: c.name || c.company || '(이름 없음)',
  subtitle: [c.company, c.position].filter(Boolean).join(' · ') || undefined,
  imageUrl: c.imageUrl, createdAt: c.createdAt, similarity: c.similarity,
});
```

### 5-5. 어댑터 예시 (앱 → 요청) — OCR snake_case → Spring camelCase

이 매핑표가 웹에서는 `api.ts`에 하드코딩되어 있었다. 앱은 어댑터에 격리한다.

```ts
// src/lib/adapters/save.ts
export function toSaveBody(input: SaveDocumentInput): { path: string; body: unknown } {
  switch (input.kind) {
    case 'BUSINESS_CARD':                                  // API-13 — 5종 세트 없음
      return { path: '/api/cards/save', body: {
        imageUrl: input.imageUrl,
        rawOcrText: input.rawOcrText,
        name: input.name, company: input.company, position: input.position,
        phone: input.phone, email: input.email,
        ...(input.groupId ? { groupId: input.groupId } : {}),
      }};
    case 'POSTER':                                         // API-42
      return { path: '/api/posters/save', body: {
        docType: 'POSTER', classificationConfidence: input.classificationConfidence,
        title: input.title, organizerName: input.organizerName,
        eventStartDate: input.eventStartDate, eventEndDate: input.eventEndDate,
        contactPhone: input.contactPhone, contactEmail: input.contactEmail,
        location: input.location, fee: input.fee,
        websiteUrl: input.websiteUrl, description: input.description,
        rawText: input.rawText, parsedJson: input.parsedJson, rawJson: input.rawJson,
      }};
    case 'TICKET':                                         // API-56
      return { path: '/api/tickets/save', body: {
        docType: 'TICKET', classificationConfidence: input.classificationConfidence,
        transportType: input.transportType,
        departureLocation: input.departureLocation, departureDate: input.departureDate, departureTime: input.departureTime,
        arrivalLocation: input.arrivalLocation, arrivalDate: input.arrivalDate, arrivalTime: input.arrivalTime,
        rawText: input.rawText, parsedJson: input.parsedJson, rawJson: input.rawJson,
      }};
    case 'RECEIPT':                                        // API-48
      return { path: '/api/receipts/save', body: {
        docType: 'RECEIPT', classificationConfidence: input.classificationConfidence,
        merchantName: input.merchantName, merchantAddress: input.merchantAddress,
        purchaseDate: input.purchaseDate, purchaseTime: input.purchaseTime,
        paymentMethod: input.paymentMethod, cardCompany: input.cardCompany,
        totalAmount: input.totalAmount, currencyCode: input.currencyCode || 'KRW',
        rawText: input.rawText, parsedJson: input.parsedJson, rawJson: input.rawJson,
        items: input.items.map((it) => ({
          itemName: it.itemName, quantity: it.quantity ?? null,
          unitPrice: it.unitPrice ?? null, totalPrice: it.totalPrice ?? null,
          category: it.category ?? null,
        })),
      }};
  }
}
```

편집 화면의 `values`(snake_case 키) → 위 입력 타입으로 옮기는 필드 매핑은 §2의 "저장 필드" 열이 진실 공급원이다.

### 5-6. 알림 `linkUrl` → 앱 라우트

서버가 주는 값은 **웹 경로**(`/dashboard/storage/posters`)다. 그대로 `router.push` 하면 404다.

```ts
// src/lib/adapters/notification.ts
const LINK_TO_SLUG: Record<string, DocSlug> = {
  '/dashboard/storage/posters':  'posters',
  '/dashboard/storage/tickets':  'tickets',
  '/dashboard/storage/cards':    'cards',
  '/dashboard/storage/receipts': 'receipts',
};
export function toNotification(dto: NotificationDto): AppNotification {
  const slug = dto.linkUrl ? LINK_TO_SLUG[dto.linkUrl] : undefined;
  return {
    id: dto.id, type: str(dto.type, 'GENERAL'),
    title: str(dto.title), message: str(dto.message),
    target: slug ? { slug } : undefined,      // 매칭 실패 시 탭 이동 없이 알림만 읽음 처리
    read: Boolean(dto.read),
    readAt: normDateTime(dto.readAt), createdAt: normDateTime(dto.createdAt),
  };
}
```

---

## 6. 로컬 저장 스키마

### 6-1. SecureStore (`expo-secure-store`) — 기밀만

| 키 | 값 | TTL | 비고 |
|---|---|---|---|
| `mora.auth.token` | JWT 문자열 | 서버 만료 24h. 앱은 저장 시각을 함께 기록해 자체 만료 판정 | Android Keystore / iOS Keychain. 상세는 [[Auth]] §4 |
| `mora.auth.tokenIssuedAt` | `Date.now()` 문자열 | 위와 동일 | 리프레시 토큰이 없어 만료 예측에 필요 |
| `mora.auth.userId` | UUID | 토큰과 동일 수명 | API-25/27/29/30이 요구하는 userId |

**SecureStore에 넣지 않는 것**: 이메일·닉네임·프로필 이미지(기밀 아님, MMKV로 충분), 문서 데이터(용량 문제로 SecureStore 부적합 — 값 크기 제한이 있다).

### 6-2. MMKV (`react-native-mmkv` **v4.3.2**) — 비기밀 로컬 상태

**v4는 Nitro 기반으로 재작성되어 API가 바뀌었다 (2026-07-27 실측).** v2/v3 예시를 그대로 쓰면 런타임에 죽는다.

```ts
// src/services/kv.ts — 인스턴스 2개 (아래 "결정" 참조)
import { createMMKV } from 'react-native-mmkv';   // ★ 클래스가 아니라 팩토리 함수다

export const kv      = createMMKV({ id: 'mora.default' });   // 설정·플래그 (영구)
export const cacheKv = createMMKV({ id: 'mora.cache' });     // React Query persist (폐기 가능)
```

| 항목 | v2 / v3 (**폐기**) | **v4.3.2** |
|---|---|---|
| 인스턴스 생성 | `new MMKV({ id })` | **`createMMKV({ id })`** |
| 키 삭제 | `storage.delete(key)` | **`storage.remove(key)`** |
| 읽기·쓰기 | `set` / `getString` / `getNumber` / `getBoolean` | 동일 (+ `getBuffer`) |
| 그 외 | `contains` / `getAllKeys` / `clearAll` | 동일 |
| 네이티브 피어 | 없음 | **`react-native-nitro-modules 0.36.1` 필수.** 전이 설치되지만 **명시 dependency로 선언**한다 |

전체 인스턴스 API: `set` / `getString` / `getNumber` / `getBoolean` / `getBuffer` / `contains` / `remove` / `getAllKeys` / `clearAll`.

**암호화는 설정하지 않는다** — 이 인스턴스들에는 기밀이 없다(토큰은 SecureStore, §6-1). 암호화를 켜면 동기 읽기 이점이 줄고 키 관리 문제가 새로 생긴다.

| 키 | 타입 | 내용 | TTL / 정리 시점 |
|---|---|---|---|
| `mora.auth.user` | JSON `UserProfile` | 부팅 시 즉시 헤더/설정 렌더링용 스냅샷 | 로그아웃 시 삭제. `/auth/me` 성공 시 갱신 |
| `mora.onboarding.seen` | boolean | 랜딩/온보딩 1회 노출 플래그 | 영구 (앱 삭제 시까지) |
| `mora.settings.prefs` | JSON `{ theme: 'system'\|'light'\|'dark', haptics: boolean, gridView: Record<DocSlug, boolean> }` | 기기 로컬 UI 취향 | 영구 |
| `mora.search.recent` | JSON `{ q: string; docType: ChatDocType; at: number }[]` (최대 20) | 오프라인에서도 보이는 최근 검색어. 서버 API-54와 병합 표시 | 30일 경과 항목 부팅 시 정리 |
| `mora.scan.draft` | JSON `ScanDraft \| null` | 저장 미완료 스캔 1건 | 저장 성공 또는 사용자 폐기 시 삭제. **72시간 경과 시 부팅 때 자동 폐기** |
| `mora.env.override` | JSON `{ apiBase?: string; ocrBase?: string }` | 개발 빌드 전용 LAN IP 수동 입력 | 릴리스 빌드에서는 읽지 않음 ([[Networking]] §3) |
| `mora.cache.query` | 문자열 (React Query persister 직렬화) | 목록·대시보드 캐시 | **maxAge 24시간**. 버전 키 불일치 시 전체 폐기 |
| `mora.notifications.lastSeenAt` | number | 알림 배지 계산 보조 | 영구 |

**결정 — MMKV 인스턴스는 2개로 분리한다.** `default`(설정·플래그, 영구)와 `cache`(React Query persist, 폐기 가능). 캐시 손상 시 `cache` 인스턴스만 통째로 지워 복구할 수 있다.

### 6-3. 이미지 캐시

| 항목 | 값 | 근거 |
|---|---|---|
| 라이브러리 | `expo-image` 내장 디스크/메모리 캐시 | 별도 캐시 구현 불필요 |
| `cachePolicy` | `'memory-disk'` | 보관함 스크롤 재방문이 잦다 |
| 캐시 키 | 절대 URL (`{OCR_BASE}/uploads/...`) | **주의: LAN IP가 바뀌면 캐시가 전부 미스된다.** 프로파일 전환 시 `Image.clearDiskCache()` 호출 |
| 디스크 상한 | 200MB (초과 시 LRU) | 문서 이미지가 장당 1280px JPEG ≈ 200~400KB |
| 수동 삭제 | 설정 화면 "이미지 캐시 비우기" | Phase 6 |

### 6-4. 캐시 TTL 요약

| 대상 | 저장소 | TTL |
|---|---|---|
| React Query 메모리 캐시 | RAM | `staleTime` 30초 / `gcTime` 10분 ([[API Contract]] §6-2) |
| React Query 영속 캐시 | MMKV `cache` | 24시간 |
| 스캔 draft | MMKV `default` | 72시간 |
| 최근 검색어 | MMKV `default` | 30일 |
| 이미지 | expo-image 디스크 | LRU 200MB, 명시적 만료 없음 |
| JWT | SecureStore | 24시간 (서버 고정) |

### 6-5. 로그아웃 시 정리 대상

| 삭제 | 유지 |
|---|---|
| `mora.auth.*` (SecureStore 3키) | `mora.onboarding.seen` |
| `mora.auth.user` | `mora.settings.prefs` |
| `mora.scan.draft` | `mora.env.override` |
| `mora.search.recent` | — |
| `mora.cache.query` + `queryClient.clear()` | — |
| `expo-image` 디스크 캐시 | — |

회원 탈퇴(API-06) 시에는 `mora.onboarding.seen`까지 포함해 **전부** 삭제한다.
