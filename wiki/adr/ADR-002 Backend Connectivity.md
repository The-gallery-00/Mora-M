# ADR-002 Backend Connectivity

APK는 개발 PC의 LAN IP로 기존 Spring(:8080)·OCR(:8000) 서버에 평문 HTTP로 직결한다. 클라우드 배포는 후반 선택 페이즈로 분리한다.

상위: [[Architecture]]
관련: [[Networking]] · [[API Contract]] · [[Camera and Scan]] · [[APK Build]] · [[Risks]] · [[ADR-001 Framework]]

---

## 상태

**Accepted · Amended 2026-07-28** — 2026-07-27 사용자가 직접 선택.

### 개정 이력

| 날짜 | 변경 |
|---|---|
| 2026-07-27 | 최초 결정 — 개발 PC LAN IP 평문 HTTP 직결. 클라우드 배포는 "후반 선택 페이즈"로 분리 |
| **2026-07-28** | **Google Play Store 배포가 확정되면서 클라우드 배포가 "선택"에서 "필수 선행조건"으로 승격.** 아래 §0 참조. LAN IP 직결 결정 자체는 **개발·내부 테스트 단계에서 유효하게 유지**된다 |

---

## 0. 개정 — 배포 단계가 2개가 되었다 (2026-07-28)

Play Store 배포 확정으로 **LAN IP 직결만으로는 제품을 끝낼 수 없다.** 스토어에서 앱을 받은 사용자의 폰은 개발 PC 와 같은 네트워크에 존재하지 않는다.

| 단계 | 접속 대상 | 빌드 프로파일 | cleartext | 이 ADR 적용 |
|---|---|---|---|---|
| 개발 · 내부 테스트 | 개발 PC LAN IP `http://192.168.x.x:8080` / `:8000` | `development` · `preview` | 허용 | **그대로 유효** |
| **스토어 배포** | **클라우드 HTTPS 도메인** | `production` | **차단** | 아래 §클라우드 이전 경로 |

**핵심**: 이 ADR 이 만들어 둔 2단 구조(빌드 타임 기본값 + 런타임 오버라이드)는 두 단계 모두에서 그대로 동작한다. 전환에 필요한 것은 `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_OCR_URL` 두 값을 바꾸는 것뿐이다. **앱 코드 변경은 없다.**

**앱 팀의 산출물이 아니다.** Spring · Python OCR · PostgreSQL 을 어디에 어떻게 올릴지는 서버 팀의 과제이며, 앱은 그 결과로 나온 HTTPS 도메인 하나를 받으면 된다.

### 호스팅 확정 — Google Cloud Run (2026-07-28)

팀 결정: **백엔드를 OCR 서버와 같은 방식으로 올린다.** OCR 은 **이미 Cloud Run 배포 구성이 존재한다.**

| 항목 | 실측값 | 원본 |
|---|---|---|
| GCP 프로젝트 | `mora-491911` | `ocr/cloudbuild.yaml` |
| 레지스트리 | `asia-northeast3-docker.pkg.dev` (서울) | `ocr/cloudbuild.yaml` |
| NER 가중치 | `gs://mora-ocr-weights/field_extractor{,_poster}` — **빌드 시 이미지로 rsync** | `ocr/cloudbuild.yaml` |
| 런타임 | `gunicorn -k uvicorn.workers.UvicornWorker --timeout 300`, `PORT=8080` | `ocr/Dockerfile` |
| 모델 사전 로드 | 이미지 빌드 중 `BusinessCardPipeline(lang='korean')` 실행 | `ocr/Dockerfile` |

**앱 관점에서 이것이 해결해 주는 것**

- **HTTPS 가 공짜다.** Cloud Run 은 `*.run.app` 도메인에 TLS 를 자동 제공한다. 인증서·도메인 확보 과제가 사라진다.
- **`usesCleartextTraffic` 이 production 에서 불필요**해진다 (현재 `app.config.js` 가 이미 `production` 에서 `false`).
- PaddleOCR 컨테이너 무게 문제는 **이미 해결된 상태**다.

**앱 관점에서 새로 생기는 문제 2개** — 아래 §0-1.

### 0-1. Cloud Run 전환이 앱에 미치는 영향

| # | 문제 | 앱 측 대응 | 서버 측 필요 조치 |
|---|---|---|---|
| 1 | **이미지가 소실된다.** OCR 이 `/uploads` 를 컨테이너 로컬 디스크에 저장하는데(`ocr/app.py` `StaticFiles` 마운트), Cloud Run 은 stateless 라 인스턴스 교체 시 사라진다. 저장된 문서의 썸네일이 **전부 깨진다** | `resolveImageUrl()` 이 404 를 만나면 플레이스홀더로 폴백. 이미지 없음이 앱 크래시로 이어지지 않게 | **GCS 버킷으로 이전 필수.** [[Scope]] D-6 가 "v2 과제"에서 **스토어 배포 선행조건**으로 승격 |
| 2 | **콜드스타트가 길다.** 이미지에 PaddleOCR + NER 가중치 844MB 가 포함되어 있어 인스턴스 기동에 수십 초가 걸릴 수 있다. `min-instances=0` 이면 첫 스캔이 타임아웃처럼 보인다 | 업로드 타임아웃을 서버 `--timeout 300` 에 맞춰 **60초 → 120초 이상**으로 상향. 진행 표시에 "서버 준비 중" 단계 추가 | `min-instances=1` 검토(비용 발생) 또는 스캔 직전 워밍업 핑 |

> 이 두 개는 **LAN 개발 중에는 절대 재현되지 않는다.** 로컬은 디스크가 살아있고 콜드스타트가 없다. 스토어 배포 직전에 처음 터지는 유형이므로 Phase 8 이전에 클라우드 환경에서 반드시 검증한다.

---

## 맥락

| 사실 | 값 | 근거 |
|---|---|---|
| 백엔드 수정 | **불가.** 기존 Spring / Python OCR / Python LLM을 그대로 사용 | 사용자 확정 |
| 서비스 포트 | Spring `8080`, OCR `8000`, LLM `8001`(앱 직접 호출 없음) | 원본: `application.yml`, `ocr/app.py`, `llm/app.py` |
| 앱이 알아야 할 base URL | **2개.** API(`:8080`)와 이미지/커밋(`:8000`) | 이미지는 OCR 서버가 `StaticFiles`로 `/uploads`를 서빙하고, `POST /api/commit`도 OCR 서버 직행 |
| 기본값 | 웹은 `http://localhost:8080` / `http://localhost:8000` | 원본: `frontend/lib/api.ts:3-4` |
| CORS | 세 서버 모두 `allowedOriginPatterns: ["*"]` / `allow_origins=["*"]` | 네이티브 앱에는 애초에 무관 |
| 보안 상태 | Spring Security `anyRequest().permitAll()`. 401은 컨트롤러 개별 코드가 만든다. 구글 캘린더 4개 엔드포인트는 인증 검사가 아예 없다. `/api/commit`도 무인증 | 04-api §3-3, §6-3 |
| 프로토콜 | 전부 **평문 HTTP** | TLS 종단 없음 |

해결해야 할 질문: **폰에 설치된 APK가 무엇을 향해 요청해야 하는가.** 폰에서 `localhost`는 폰 자기 자신이므로 웹의 기본값을 그대로 쓸 수 없다.

---

## 검토한 대안

| 대안 | 장점 | 단점 | 기각 이유 |
|---|---|---|---|
| **개발 PC LAN IP 직결** (`http://192.168.x.x:8080`) | 서버 코드·인프라 변경 0. 배포·비용·계정 발급 없음. 실제 백엔드로 통합 검증 가능. Docker/DB(pgvector)가 PC에서 이미 돌고 있음 | 평문 HTTP(Android 9+ 기본 차단). IP가 DHCP로 바뀜. 같은 Wi-Fi 밖에서 동작 안 함. 팀원마다 IP가 다름 | **채택** |
| **클라우드 배포 후 HTTPS 도메인 직결** | 어디서나 접속. ATS/cleartext 문제 소멸. 데모·심사에 적합 | 서버 3개 + PostgreSQL(pgvector) + 모델 파일(ResNet18, klue/bert-base 2벌) 배포가 필요. OCR 컨테이너는 PaddleOCR·PyTorch 포함으로 무겁고 콜드스타트가 김. **이미지가 OCR 서버 로컬 디스크(`ocr/uploads/`)에 저장**되므로 재배포 시 소실되고 스케일아웃 불가 → 객체 스토리지 전환이 선행되어야 하는데 그건 백엔드 수정이다. OAuth redirect_uri를 provider 3곳에 재등록해야 함 | **"백엔드 무수정" 전제와 충돌**하고 Phase 0~7의 개발 속도를 떨어뜨린다. 후반 선택 페이즈로 분리 |
| **터널링 (ngrok / Cloudflare Tunnel)** | HTTPS 공개 URL을 즉시 획득. cleartext 문제 해결. 외부 망에서도 접속 | 무료 티어는 재시작마다 URL이 바뀌어 IP 변동 문제가 **URL 변동 문제로 이름만 바뀐다**. 대역폭/동시연결 제한. 이미지 업로드 2회 왕복(§[[Camera and Scan]])이 인터넷을 경유해 느려짐. OAuth 콜백을 위해 3개 provider에 임시 도메인 등록 필요 | LAN보다 느리고 불안정한데 해결하는 문제는 같다. **선택적 보조 수단**으로만 문서화 |
| **목(mock) 데이터 / MSW** | 백엔드 없이 UI 개발 가능. 결정론적 테스트 | OCR 파이프라인은 실제 서버 응답(이중 래핑, snake_case, `raw_blocks` bbox, 신뢰도)이 핵심인데 목으로는 검증 불가. "상업앱 수준"의 실패 처리(타임아웃·부분성공 `message`·인코딩 이슈)를 목으로 재현하는 비용이 실서버 연결보다 크다 | **주 경로로 부적합.** 단, 자동화 테스트와 오프라인 화면 개발용 **보조 수단**으로는 채택 |
| **에뮬레이터 전용 `10.0.2.2`** | 설정 없이 호스트 접근 | 실기기에서 동작하지 않음. APK 배포 검증 불가 | **실기기 테스트가 필수 요구사항** |

---

## 결정 (개발 · 내부 테스트 단계에 적용 — 스토어 배포는 §0)

**개발 PC의 LAN IP로 직결한다.** 서버 주소는 빌드 타임 기본값 + 런타임 오버라이드의 2단 구조로 관리한다.

### 1. 주소 구성

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080     # Spring — 모든 /auth, /api/* (commit 제외)
EXPO_PUBLIC_OCR_URL=http://192.168.0.10:8000     # OCR — POST /api/commit, GET /uploads/*
```

- 두 값은 **반드시 분리 관리**한다. 하나로 합치면 이미지가 뜨지 않는다.
- 이미지 URL 절대화 규칙(웹과 동일): `url.startsWith('http') ? url : `${OCR_BASE}${url.startsWith('/') ? url : '/' + url}``
- **조립 기준은 `OCR_BASE`(:8000)다. Spring(:8080)이 아니다** (2026-07-27 재확인). `ocr/app.py` 가 `app.mount("/uploads", StaticFiles(...))` 로 정적 이미지를 서빙하므로, Spring 기준으로 조립하면 **모든 문서 이미지가 깨진다.** 구현 정본은 [[API Contract]] §5-2 `toAbsoluteImageUrl`.
- LLM(:8001)은 앱이 직접 호출하지 않는다. 반드시 Spring `/api/chat`을 경유한다.

### 2. 런타임 오버라이드 — 개발자 설정 화면

`.env`에 IP를 박고 재빌드하는 순환은 팀 공유에서 무너진다. 따라서:

| 항목 | 규격 |
|---|---|
| 진입 | 설정 화면 하단 `앱 정보`의 버전 라벨 **5회 탭** → `서버 연결` 화면 |
| 입력 | API base URL, OCR base URL 2칸. `http://` 스킴 필수 |
| 저장 | **MMKV** (`react-native-mmkv` v4 — AsyncStorage는 [[Tech Stack]] §4에서 기각되었다). 앱 재시작 없이 즉시 적용. 키 정본은 [[Data Model]] §6-2 |
| 검증 | `연결 테스트` 버튼 → 아래 "헬스 프로브" 표 |

**헬스 프로브 (2026-07-27 재확인 — 전용 헬스 엔드포인트가 양쪽 다 없다)**

| 서버 | 프로브 | 성공 판정 | 근거 |
|---|---|---|---|
| OCR `:8000` | `GET /` | `{"service":"MORA OCR Service","version":"3.0","docs":"/docs"}` | 고정 응답. 원본 `ocr/app.py:122` |
| Spring `:8080` | `GET /auth/me` (토큰 없이) | **HTTP 401** + 본문에 **`success` 필드 존재** | **actuator가 포함되지 않아** `/actuator/health` 가 없다. `SecurityConfig` 가 `anyRequest().permitAll()` 이고 **인증은 각 컨트롤러가 JWT로 직접 검증**하므로, 토큰 없는 요청이 필터에서 튕기지 않고 컨트롤러까지 도달해 래핑된 401을 만든다 — 즉 401이 곧 "MORA Spring이 컨트롤러 레이어까지 살아 있다"의 증거다 |

401을 실패로 처리하면 안 된다. 이 프로브는 인증이 아니라 **도달성**을 확인한다. 반대로 `success` 필드가 없는 응답은 우리 서버가 아닌 것(공유기 관리 페이지 등)에 닿은 것이므로 성공으로 처리하지 않는다. 상세는 [[Networking]] §1-7 · [[API Contract]] §3-15.
| 초기화 | `기본값으로 되돌리기` = `.env` 값 복원 |
| 릴리스 빌드 | `__DEV__ === false` **이고** `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE !== '1'` 이면 화면 자체를 숨긴다 |

이 화면 하나로 **IP 변동**과 **팀원별 서로 다른 IP** 문제를 동시에 해결한다. 각자 자기 PC IP를 앱에 한 번 입력하면 같은 APK를 공유할 수 있다.

### 3. 평문 HTTP 허용 (Android)

Android 9(API 28)부터 cleartext HTTP는 기본 차단이다. **도메인 전체 개방이 아니라 사설 IP 대역으로 한정**한다.

`app.config.js` (확장자가 `.js` 인 이유는 [[APK Build]] §2 결정 2 / [[Risks]] RSK-34):
```js
// app.config.js (발췌)
const ALLOW_CLEARTEXT = (process.env.APP_VARIANT ?? 'development') !== 'production';

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ['expo-build-properties', {
      android: { usesCleartextTraffic: ALLOW_CLEARTEXT, minSdkVersion: 26 },
    }],
  ],
  android: {
    networkSecurityConfig: './android-config/network_security_config.xml',   // preview 전용
  },
});
```

> `networkSecurityConfig` 파일을 **`android/` 안에 두지 않는다** — `android/` 는 `expo prebuild` 로 재생성되는 폴더이고 `.easignore` 로 업로드에서도 제외된다([[APK Build]] §1-4). 경로 정본은 [[Networking]] §2-2의 `./android-config/`.

`network_security_config.xml` (결정 — 사설 대역만 허용):
```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>     <!-- Android 에뮬레이터 → 호스트 -->
    <domain includeSubdomains="false">localhost</domain>
    <!-- 팀 개발망 IP는 빌드 프로파일별로 주입한다. 예: 192.168.0.10 -->
  </domain-config>
</network-security-config>
```

> 와일드카드 사설 대역(`192.168.*`)은 Android network security config 문법이 지원하지 않는다. 개발 프로파일에서는 `usesCleartextTraffic: true`로 전역 허용하고, **릴리스 프로파일에서는 이 플래그를 끄고 HTTPS를 강제**한다 → [[APK Build]]의 빌드 프로파일 표.

iOS는 현재 범위 밖이지만, 붙일 때는 `NSAppTransportSecurity.NSAllowsLocalNetworking`과 로컬 네트워크 권한(`NSLocalNetworkUsageDescription`)이 추가로 필요하다.

### 4. 보안 취급 (개발 전용임을 명시)

| 위험 | 완화 |
|---|---|
| 평문 HTTP → 같은 Wi-Fi에서 JWT·문서 내용 도청 가능 | **개발·데모 전용 빌드**로 못 박는다. 스토어 배포 금지. APK 배포 시 README에 명시 |
| `/api/commit` 무인증 → 누구나 서버 디스크에 파일 적재 가능 | 서버 수정 불가이므로 앱 차원 완화 없음. **[[Risks]]에 등재**하고 클라우드 이전 시 Spring 프록시 추가를 선행 조건으로 지정 |
| 구글 캘린더 4개 엔드포인트 무인증(userId만 알면 연동 해제 가능) | 동일. [[Risks]] 등재 |
| Swagger UI(`/swagger-ui.html`)가 인증 없이 열림 | 개발망 한정이므로 수용. 클라우드 이전 시 차단 |

### 5. 목 데이터의 위치 (보조 수단)

- **자동화 테스트**와 **오프라인 UI 개발**에 한해 MSW/픽스처를 쓴다.
- 픽스처는 **실서버 응답을 그대로 캡처**해서 만든다(이중 래핑, snake_case, 배열형 `createdAt` 포함). 손으로 이상화한 목을 만들면 실서버에서 깨진다.
- 목 모드는 `EXPO_PUBLIC_USE_MOCK=1`로만 켜지며 릴리스 빌드에서는 트리 셰이킹으로 제거한다.

---

## 결과

### 긍정
1. 백엔드·인프라 변경 0. Phase 0부터 **실제 OCR·벡터검색·LLM**과 통합된 상태로 개발한다. 목으로는 못 잡는 계약 오류(이중 래핑, 날짜 배열, 부분성공 `message`)를 초기에 잡는다.
2. LAN 대역폭이 커서 이미지 2회 전송([[Camera and Scan]] §8)의 비용이 개발 단계에서는 체감되지 않는다.
3. 클라우드 비용·계정·배포 파이프라인이 없다. 팀 프로젝트 일정에 맞는다.
4. 개발자 설정 화면 덕분에 **같은 APK를 팀원끼리 그대로 공유**할 수 있다.

### 부정
1. **같은 Wi-Fi 밖에서는 동작하지 않는다.** 발표·시연 장소의 네트워크가 다르면 준비가 필요하다(핫스팟 또는 터널). [[QA Checklist]]에 "시연 환경 사전 점검" 항목을 넣는다.
2. **평문 HTTP를 허용하는 빌드는 스토어에 올릴 수 없다.** 릴리스 트랙과 개발 트랙이 갈라진다.
3. 사내/학교 Wi-Fi의 **AP 격리(client isolation)** 가 켜져 있으면 폰↔PC 통신이 막힌다. 이 경우 PC 핫스팟 또는 유선 테더링으로 우회해야 한다.
4. Windows **방화벽이 8080/8000 인바운드를 막는 것**이 첫 연결 실패의 최빈 원인이다. Phase 0 체크리스트에 인바운드 규칙 추가를 넣는다.
5. IP가 바뀔 때마다 사용자가 설정을 고쳐야 한다(자동 탐색 없음). 완화: 실패 시트에 `PC와 같은 Wi-Fi에 연결되어 있는지 확인해 주세요.` + `서버 주소 확인` 바로가기를 노출한다(SCF-06).

---

## 클라우드 이전 경로 (후반 선택 페이즈)

순서대로 밟는다. 앞 단계를 건너뛰면 이미지가 사라진다.

| # | 작업 | 이유 |
|---|---|---|
| 1 | **이미지 저장소를 객체 스토리지로 이전** | `ocr/uploads/`는 컨테이너 로컬 디스크다. 재배포 시 소실되고 스케일아웃 불가. **백엔드 수정이 필요한 유일한 필수 항목** |
| 2 | Spring에 `/api/commit` 프록시 추가 + JWT 검증 | 앱이 base URL 1개만 알면 되고, 무인증 적재 구멍이 막힌다 |
| 3 | 세 서비스 컨테이너화 + HTTPS 종단(리버스 프록시) | cleartext 설정 전량 제거 가능 |
| 4 | OAuth `redirect_uri`를 google/kakao/naver 콘솔에 재등록, `FRONTEND_URL`을 앱 딥링크 스킴(`mora://`)으로 분기 | 현재 콜백은 `{FRONTEND_URL}/dashboard?token=...` HTML 브리지다 → [[Auth]] |
| 5 | `RestTemplate` 타임아웃 설정, Hikari pool 상향 | 현재 타임아웃 무제한 + pool 3 |
| 6 | Swagger UI 차단, `SecurityConfig` permitAll 축소, 구글 캘린더 4종에 인증 추가 | |
| 7 | 앱: `.env`를 HTTPS 도메인으로 교체, 개발자 설정 화면 비활성, cleartext 플래그 제거 | 앱 변경은 **마지막 1스텝**뿐 |

앱 아키텍처가 base URL 2개를 설정값으로만 다루므로, 7번을 제외한 앱 코드 변경은 없다.

---

## 재검토 트리거

1. **외부 망 시연·배포**가 필요해질 때 → 위 이전 경로 착수(최소 3번까지).
2. 팀 개발망에서 **AP 격리**로 LAN 직결이 반복 실패할 때 → 터널링을 임시 보조 경로로 승격.
3. **스토어 배포**가 범위에 들어올 때 → 평문 HTTP 전량 제거가 선행 조건.
4. 이미지 2회 전송이 실사용 셀룰러 환경에서 문제가 될 때 → `scan`이 임시 토큰을 발급하고 `commit`이 승격하는 서버 변경을 제안.
