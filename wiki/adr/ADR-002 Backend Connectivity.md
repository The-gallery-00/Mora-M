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
| **2026-08-05** | **결정 변경 없음 · 사실 정정.** §호스팅 확정의 인프라 표가 실재하지 않는 `ocr/cloudbuild.yaml`·gunicorn 런타임·빌드 중 모델 사전 로드·NER 가중치 GCS rsync 를 사실로 기술하고 있었고, "PaddleOCR 무게 문제는 이미 해결됨" 선언도 틀렸다. 레포에 실제로 있는 파일만 근거로 재작성하고 OCR 503 장애의 근본원인·실측치를 남겼다 |
| **2026-08-05 (3차)** | **결정 변경 없음 · 실측치 인용 규칙 확립 + 잔존 모순 1건 제거.** ① §호스팅 확정의 성능 표 두 개에 **측정 조건(해상도 + 검출 블록 수 + 콜드/웜)** 을 명기하도록 문장 구조를 정비했다 — 소요 시간은 픽셀 수가 아니라 블록 수에 선형이라, 조건 없이 인용된 시간 값은 서로 다른 것을 비교한 값일 수 있다. **숫자 자체는 유지**하고 `paddle_ocr_engine.py` 재측정과의 대조 필요를 표에 남겼다. ② §대안 비교표에 `ResNet18 · klue/bert-base · PyTorch` 가 남아 있어 같은 문서의 정정 표와 모순이던 것을 지웠다 |
| **2026-08-05 (4차)** | **결정 변경 없음 · 3차가 남긴 "대조 필요"를 닫고 §0 을 실측치 정본으로 확정.** ① `paddle_ocr_engine.py` 재측정과 대조한 결과 **`23.20s → 1.87s` 는 조건이 다른 두 값의 비교**였음이 확인됐다(수정 전은 21블록, 수정 후는 4블록). 같은 21블록끼리의 정직한 비교는 **23.20s → 10.66s** 다. 표를 그 값으로 고치고 모든 행에 `해상도 + 블록 수 + 프로세스 상태` 를 붙였다. ② **소요 시간도 이 문서를 정본으로 확정**했다(종전에는 peak 메모리만 정본이었다). [[Risks]] RSK-41 에 복제돼 있던 같은 숫자를 지우고 이 절을 참조하게 바꿨다 — 양쪽에 숫자를 두면 다음 라운드에 또 갈라진다 |
| **2026-08-05 (2차)** | **결정 변경 없음 · 1차 정정의 오류 수정 2건.** ① 업로드 타임아웃 인용을 죽은 상수 `http.ts` `UPLOAD_TIMEOUT_MS` → 실제 상한인 `features/scan/api.ts` `SCAN_TIMEOUT_MS` 로 정정. ② §2 헬스 프로브 표 전면 개정 — 종전 Spring 판정(토큰 없는 401 = 정상)이 **DB 장애에도 초록불**을 내는 구조였음을 확인하고, 판정 기준과 서버 측 필요 변경을 명시. 아울러 릴리스 빌드 가드 서술을 실제 구현(`app/(dev)/_layout.tsx`)에 맞췄다 |

---

## 0. 개정 — 배포 단계가 2개가 되었다 (2026-07-28)

Play Store 배포 확정으로 **LAN IP 직결만으로는 제품을 끝낼 수 없다.** 스토어에서 앱을 받은 사용자의 폰은 개발 PC 와 같은 네트워크에 존재하지 않는다.

| 단계 | 접속 대상 | 빌드 프로파일 | cleartext | 이 ADR 적용 |
|---|---|---|---|---|
| 개발 · 내부 테스트 | 개발 PC LAN IP `http://192.168.x.x:8080` / `:8000` | `development` · `preview` | 허용 | **그대로 유효** |
| **스토어 배포** | **클라우드 HTTPS 도메인** | `production` | **차단** | 아래 §클라우드 이전 경로 |

**핵심**: 이 ADR 이 만들어 둔 2단 구조(빌드 타임 기본값 + 런타임 오버라이드)는 두 단계 모두에서 그대로 동작한다. 전환에 필요한 것은 `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_OCR_URL` 두 값을 바꾸는 것뿐이다. **앱 코드 변경은 없다.**

**앱 팀의 산출물이 아니다.** Spring · Python OCR · PostgreSQL 을 어디에 어떻게 올릴지는 서버 팀의 과제이며, 앱은 그 결과로 나온 HTTPS 도메인 하나를 받으면 된다.

### 호스팅 확정 — Google Cloud Run (2026-07-28 · 사실 정정 2026-08-05)

팀 결정: **백엔드를 OCR 서버와 같은 방식으로 올린다.** 두 서비스 모두 `asia-northeast3`(서울) Cloud Run 에 있다.

> **2026-08-05 정정 — 이 절은 존재하지 않는 인프라를 사실로 기술하고 있었다.** 종전 표는 `ocr/cloudbuild.yaml` 을 근거로
> 레지스트리·NER 가중치 rsync·gunicorn 런타임·빌드 중 모델 사전 로드를 적어 두었다. **그 파일은 이 레포의 전 이력에 존재한 적이 없다**
> (`git log --all --diff-filter=A -- "*cloudbuild*"` → 0건). gunicorn 도 레포 어디에도 없다(`grep -rni gunicorn server/ocr/` → 0건).
> 이 다섯 줄이 2026-08-05 OCR 장애의 근본원인 추적을 크게 지연시켰다 — 조사가 "빌드에서 워밍하는데 왜 느린가"를 먼저 파고들었기 때문이다.
> 아래 표는 **레포에 실제로 존재하는 파일만** 근거로 다시 썼다.

| 항목 | 값 | 근거 (실재하는 파일) |
|---|---|---|
| 리전 | `asia-northeast3` (서울) | `server/cloudrun/deploy-ocr.ps1:6` · `server/cloudrun/deploy-spring.ps1:7` |
| 서비스 이름 | OCR `mora-mobile-ocr` / Spring `mora-mobile-spring` | 위 두 스크립트의 `$ServiceName` 기본값 |
| 배포 수단 | **`gcloud run deploy` 를 감싼 PowerShell 스크립트 2개.** Cloud Build 설정도 CI 파이프라인도 없다 | `server/cloudrun/deploy-ocr.ps1` · `server/cloudrun/deploy-spring.ps1` |
| OCR 런타임 | `uvicorn app:app --host 0.0.0.0 --port ${PORT}` **단일 프로세스**, `PORT=8000`. gunicorn 을 쓰지 않는다 | `server/ocr/Dockerfile:22,25` |
| Spring 런타임 | `java -jar app.jar`, `PORT=8080` | `server/spring/Dockerfile` |
| OCR 리소스 | `--memory 2Gi --cpu 1 --timeout 300 --max-instances 3` (`--timeout` 은 **Cloud Run 요청 타임아웃**이다) | `server/cloudrun/deploy-ocr.ps1:13-16` |
| Spring 리소스 | `--memory 1Gi --cpu 1 --max-instances 3` (파라미터로 상향 가능) | `server/cloudrun/deploy-spring.ps1:17-18,44` |
| 모델 로드 시점 | **런타임 첫 import.** Dockerfile 에 모델을 미리 받거나 파이프라인을 워밍하는 단계가 **없다** | `server/ocr/Dockerfile` 전문 |
| 문서 분류·필드추출 | **순수 정규식.** NER 가중치도, 그것을 담은 GCS 모델 버킷도 이 레포에 없다. `requirements.txt` 에 torch·transformers 계열 의존이 아예 없다 | `server/ocr/src/classifier/rule_based.py` · `server/ocr/requirements.txt` |
| GCP 프로젝트 | `mora-491911`(프로젝트 ID) / `971562891559`(서비스 URL 안의 프로젝트 번호) — **같은 프로젝트의 두 표기인지 미확인.** 레포 안에 대조 수단이 없다 | — |

**앱 관점에서 이것이 해결해 주는 것**

- **HTTPS 가 공짜다.** Cloud Run 은 `*.run.app` 도메인에 TLS 를 자동 제공한다. 인증서·도메인 확보 과제가 사라진다.
- **`usesCleartextTraffic` 이 production 에서 불필요**해진다 (현재 `app.config.js` 가 이미 `production` 에서 `false`).

**해결해 주지 않은 것 — PaddleOCR 컨테이너 무게 (2026-08-05 정정)**

이 자리에는 "PaddleOCR 컨테이너 무게 문제는 **이미 해결된 상태**다" 가 적혀 있었다. **해결된 적이 없다. 그것이 바로 2026-08-05 OCR 장애의 근본원인이었다.**

`server/ocr/src/ocr/paddle_ocr_engine.py` 의 `PaddleOCR(...)` 생성자가 **검출 모델과 검출 입력 상한을 지정하지 않았다.**
그래서 `lang="korean"` 이 중량 `PP-OCRv5_server_det` 로 해석되고, 기본값이 `text_det_limit_type="min"` 이라 큰 입력이 **축소되지 않은 채** 추론에 들어갔다.
그 결과 **요청당 peak 메모리가 픽셀 수에 선형**(픽셀당 약 5.1KB)으로 증가해, 약 20만 픽셀을 넘는 입력에서 Cloud Run 인스턴스가 죽었다.

**측정 조건을 먼저 읽어야 하는 표다 (조건 명기 2026-08-05 3차).** 아래 두 표는 지금까지 **입력 해상도만** 조건으로 적고 있었는데, 이 파이프라인에서 해상도는 두 축 중 하나에만 걸린다:

- **peak 메모리**는 검출(det) 입력의 픽셀 수에 걸린다 → `text_det_limit_type="max"` 로 상한을 걸면 원본 해상도와 거의 무관해진다(그것이 두 번째 표의 요지다).
- **소요 시간**은 픽셀 수가 아니라 **검출된 블록 수**에 선형이다. 인식(rec)이 검출 크롭마다 1회 돌기 때문이다(근거: `server/ocr/src/ocr/paddle_ocr_engine.py` 의 블록 수 고정 재측정 주석). 같은 1280×960 이라도 블록 4개짜리 합성 이미지와 블록 20여 개짜리 실제 명함은 몇 배 차이가 난다.
- **프로세스 상태**(콜드 프로세스 / 같은 프로세스 재사용)도 따로 적어야 한다. 모델 로드 비용은 `PaddleOCR(...)` 생성자, 즉 **엔진 init** 에서 끝나므로 요청 시간과 분리해서 봐야 한다.

따라서 **수치를 인용할 때는 `해상도 + 블록 수 + 콜드/웜` 세 가지를 함께 적는다.**

> ## 📌 이 절(§0)이 OCR 실측치의 **정본**이다 (2026-08-05 4차 확정)
>
> peak 메모리와 **소요 시간 둘 다** 여기가 정본이다. 3차까지는 peak 메모리만 정본이고 시간은 "대조 필요"로 열려 있었는데, 아래 A-2 에서 대조가 끝났다.
> **다른 문서·주석은 숫자를 복제하지 말고 이 절을 참조한다.** [[Risks]] RSK-41 은 3차까지 같은 숫자를 자기 표에 복제해 두고 여기 붙은 "조건 미기재" 경고만 빠뜨려서, **한 프로젝트에 정본이 두 개 있고 서로 다른 말을 하는** 상태를 만들었다. 그래서 그쪽 표를 지우고 이 절 링크로 바꿨다.
> 코드 주석 중 `server/ocr/src/ocr/paddle_ocr_engine.py`(원측정 기록) · `server/cloudrun/deploy-ocr.ps1` `$Memory` · `server/spring/.../RestTemplateConfig.java` `(2) OCR SCAN READ 90초` 가 이 값을 인용한다.

### A. 생성자 수정 전 → 후 (같은 조건끼리 비교)

**측정 조건**: 입력 1280×960 · **검출 블록 21개**(실제 명함에 준하는 밀도) · 요청마다 **새 프로세스로 격리** · psutil 10ms 간격 RSS 샘플링. 원측정 기록은 `server/ocr/src/ocr/paddle_ocr_engine.py` 의 `__init__` 주석.

| 지표 (1280×960 · 21블록 · 콜드 프로세스) | 생성자 수정 전 | 생성자 수정 후 |
|---|---|---|
| 엔진 init 후 RSS (요청 전, 모델 로드만 끝난 상태) | 826MB | 737MB |
| 요청당 peak 메모리 | **7083MB** | **959MB** |
| 소요 시간 | **23.20s** | **10.66s** |
| 인식된 텍스트 | — | **동일** |

> **A-2. 3차의 "대조 필요"를 여기서 닫는다 — `1.87s` 는 이 표에서 빠져야 할 값이었다.**
> 3차까지 이 표의 "수정 후 소요 시간" 칸에는 **1.87s** 가 적혀 있었고, 표 아래에 "두 열이 같은 조건이 아닐 수 있다"는 경고가 달려 있었다. 대조 결과 **경고가 맞았다**: `23.20s` 는 21블록 값이고 `1.87s` 는 **블록 4개짜리 합성 이미지** 값이다. 즉 `23.20s → 1.87s`(12.4배)는 **개선폭이 아니라 서로 다른 두 이미지를 비교한 수치**였다.
> 같은 21블록끼리의 정직한 비교는 **23.20s → 10.66s (약 2.2배)** 다. peak 메모리 `7083MB → 959MB`(약 7.4배)는 블록 수와 무관하므로 그대로 성립한다.
> 참고로 4블록 조건의 수정 후 값은 **peak 957MB / 1.87s** 이며, 이 값을 인용할 때는 **반드시 "4블록"을 함께 적는다.**

### B. 수정 후 — peak 메모리가 입력 해상도에 반응하지 않는다

이것이 `text_det_limit_type="max"` 의 효과다. **측정 조건**: 생성자 수정 **후** · **검출 블록 21개 고정** · 요청마다 새 프로세스 격리 · psutil 10ms RSS 샘플링.

| 입력 해상도 | 엔진 init 후 RSS | peak 메모리 | 소요 시간 |
|---|---|---|---|
| 1280×960 (1.23Mpx) | 738MB | 959MB | 10.66s |
| 2000×2000 (4.00Mpx) | 737MB | 1035MB | 7.64s |
| 4032×3024 (12.19Mpx) | 738MB | 988MB | 9.95s |
| 6000×4500 (27.00Mpx) | 736MB | 1030MB | 9.75s |

> 1.2Mpx~27Mpx 구간에서 peak 이 약 **1.0GB 로 평평**하다. det 입력이 긴 변 960 으로 clamp 되어 상수 크기가 되기 때문이다. 시간이 해상도 순서대로 늘지 않는 것도 같은 이유다(축소 후에는 세 입력이 사실상 같은 일을 한다).
> **3차까지 이 자리에 있던 `800×500 / 1280×960 / 4032×3024 → 전부 1.5~1.9s` 표는 지웠다.** 블록 수가 기재되지 않은 값이었고, 위 21블록 재측정과 나란히 두면 같은 4032×3024 이 "1.9s" 와 "9.95s" 두 개로 읽혀 정확히 이번에 없애려는 종류의 거짓 신호가 된다.

### C. 소요 시간은 해상도가 아니라 **검출 블록 수**에 선형이다

**측정 조건**: 입력 **1280×960 고정** · 블록 수만 변경 · 조건마다 새 프로세스 · 같은 프로세스 안에서 3회 반복(1차=콜드 요청, 2차=웜 요청) · psutil 10ms RSS 샘플링.

| 검출 블록 수 | 1차(콜드 요청) | 2차(웜 요청) | peak 메모리 |
|---|---|---|---|
| 1 | 1.03s | 0.92s | 1017MB |
| 4 | 1.89s | 1.95s | 1024MB |
| 10 | 3.34s | 3.30s | 1028MB |
| 21 | 6.43s | 6.24s | 1034MB |

> 회귀식 **t ≒ 0.73s + 0.26s × 블록수**. 1차와 2차의 차이는 오차 범위다 — 모델 로드 비용은 `PaddleOCR(...)` 생성자에서 이미 끝나 있고 **엔진 init 2.3s** 로 따로 잡힌다. 그러므로 **요청 단위의 "콜드/웜" 은 이 파이프라인에서 거의 의미가 없고, 사용자가 겪는 콜드스타트는 컨테이너 기동(아래 §0-1, 18~33초)이다.**
> peak 은 블록 수와도 사실상 무관하다(1017~1034MB).
>
> ⚠️ **A·B 표와 C 표는 측정 PC 가 다르다.** 같은 21블록이 A·B 에서는 10.66s, C 에서는 6.4s다. **절대값을 표 사이에서 옮겨 쓰지 말고, 비교는 같은 표 안에서만 한다.** 어느 쪽이 배포 환경(Cloud Run `--cpu 1`)에 가까운지는 **미확인** — Cloud Run 실측이 아직 없다(후속 항목).

### D. 실제 명함 한 장은 몇 초인가

명함은 통상 **15~25블록**이다. C 의 회귀식으로 직접 계산하면 **4.6~7.2초**, 절대값이 느렸던 A·B 측정 환경으로 환산하면 약 **8~12초**다. `paddle_ocr_engine.py` 는 이 구간을 **6~11초**로 적는데, 위 두 값 사이라 모순이 아니다. **어느 측정 환경이 Cloud Run(`--cpu 1`)에 가까운지는 미확인이므로 느린 쪽(약 12초)으로 잡는다.** 여기에 잠든 인스턴스라면 콜드스타트 **18~33초**(§0-1)가 통째로 앞에 붙어 최악 약 **46초**가 된다 — Spring→OCR read 타임아웃 90초와 앱 `SCAN_TIMEOUT_MS` 120초는 이 46초를 기준으로 잡힌 값이다(`RestTemplateConfig.java` 의 타임아웃 표 (2)).

**이때 앱이 받는 503 은 앱 코드가 만든 것이 아니다.** 인스턴스가 죽으면 **Google Frontend 가 `text/plain` 본문의 `Service Unavailable`** 을 대신 반환한다.
FastAPI 는 실패 시 500 + JSON 만 낸다. 즉 **`text/plain` 503 은 "요청이 우리 프로세스에 도달하기 전/도중에 인스턴스가 죽었다"의 증거**이며, 앱이나 응답 계약 쪽에서 조사할 대상이 아니다.

수정은 생성자에 `text_detection_model_name="PP-OCRv5_mobile_det"`, `text_recognition_model_name="korean_PP-OCRv5_mobile_rec"`,
`text_det_limit_side_len=960`, `text_det_limit_type="max"`, `use_textline_orientation=False` 를 **명시**하는 것이다.
→ [[Risks]] RSK-41(2026-08-05 **재개방**).

**앱 관점에서 새로 생기는 문제 2개** — 아래 §0-1.

### 0-1. Cloud Run 전환이 앱에 미치는 영향

| # | 문제 | 앱 측 대응 | 서버 측 필요 조치 |
|---|---|---|---|
| 1 | **이미지가 소실된다.** OCR 이 `/uploads` 를 컨테이너 로컬 디스크에 저장하는데(`ocr/app.py` `StaticFiles` 마운트), Cloud Run 은 stateless 라 인스턴스 교체 시 사라진다. 저장된 문서의 썸네일이 **전부 깨진다** | `resolveImageUrl()` 이 404 를 만나면 플레이스홀더로 폴백. 이미지 없음이 앱 크래시로 이어지지 않게 | **GCS 버킷으로 이전 필수.** [[Scope]] D-6 가 "v2 과제"에서 **스토어 배포 선행조건**으로 승격 |
| 2 | **콜드스타트가 길다.** 모델은 **런타임 첫 import 시** 로드된다 — Dockerfile 에 사전 워밍 단계가 없다(위 표). `min-instances=0` 이면 첫 스캔이 타임아웃처럼 보인다. **실측 18~33초** | 업로드 타임아웃을 Cloud Run 요청 타임아웃(`deploy-ocr.ps1` 의 `--timeout 300`) 안쪽에서 콜드스타트를 덮도록 **60초 → 120초**로 상향. 정본은 **`src/features/scan/api.ts` 의 `SCAN_TIMEOUT_MS`** 다. 진행 표시에 "서버 준비 중" 단계 추가 | `min-instances=1` 검토(비용 발생) 또는 스캔 직전 워밍업 핑 |

> **2026-08-05 2차 정정 — 위 칸의 인용이 한 번 더 틀렸었다.** 1차 정정본은 그 자리에 `src/services/http.ts` 의 `UPLOAD_TIMEOUT_MS` 를 적었는데, **그 상수는 현재 실행되지 않는다.** 유일한 독자인 `request()` 의 `formData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS` 에서 `formData` 를 넘기는 호출부가 `src/`·`app/` 전체에 0건이기 때문이다. 스캔·커밋은 진행률 콜백과 취소가 필요해 XHR 을 직접 구성하며(`src/features/scan/api.ts` `uploadMultipart`) `http.ts` 를 아예 거치지 않는다. 값(120초)은 우연히 같지만 **가리키는 파일이 틀렸다** — "gunicorn `--timeout 300`" 이라는 거짓을 지운 자리에 새 거짓을 넣은 셈이다. → [[Risks]] §5 규칙 7.

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
| **클라우드 배포 후 HTTPS 도메인 직결** | 어디서나 접속. ATS/cleartext 문제 소멸. 데모·심사에 적합 | 서버 3개 + PostgreSQL(pgvector) 배포가 필요. OCR 컨테이너는 PaddleOCR 때문에 무겁고 콜드스타트가 김(실측 18~33초 — §0-1). ~~모델 파일(ResNet18, klue/bert-base 2벌)~~ · ~~PyTorch 포함~~ → **2026-08-05 3차 정정: 둘 다 이 레포에 없다.** 같은 문서 §호스팅 확정 표가 이미 "`requirements.txt` 에 torch·transformers 계열 의존이 아예 없다"로 정정돼 있는데 이 칸만 옛 서술로 남아 **한 문서 안에서 모순**이었다. **이미지가 OCR 서버 로컬 디스크(`ocr/uploads/`)에 저장**되므로 재배포 시 소실되고 스케일아웃 불가 → 객체 스토리지 전환이 선행되어야 하는데 그건 백엔드 수정이다. OAuth redirect_uri를 provider 3곳에 재등록해야 함 | **"백엔드 무수정" 전제와 충돌**하고 Phase 0~7의 개발 속도를 떨어뜨린다. 후반 선택 페이즈로 분리 |
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
| 진입 | **개발·preview 빌드 전용.** 정식 진입로는 설정 > `개발` 섹션의 **[서버 연결 진단]** 행이고, 로그인 화면 하단 링크·스캔 실패 시트의 `서버 주소 확인` 도 같은 화면으로 간다. 버전 라벨 5회 탭 이스터에그는 **개발 빌드에서만** 동작한다(production 은 첫 줄에서 return — 탭 카운트조차 세지 않는다). 진입점 전수는 [[Screen Specs]] SCR-31 |
| 입력 | API base URL, OCR base URL 2칸. `http://` 스킴 필수 |
| 저장 | **MMKV** (`react-native-mmkv` v4 — AsyncStorage는 [[Tech Stack]] §4에서 기각되었다). 앱 재시작 없이 즉시 적용. 키 정본은 [[Data Model]] §6-2 |
| 검증 | `연결 테스트` 버튼 → 아래 "헬스 프로브" 표 |

**헬스 프로브 (2026-08-05 전면 개정 — 종전 판정이 거짓 초록불의 원천이었다)**

| 서버 | 프로브 | `정상` 판정 | 근거 |
|---|---|---|---|
| OCR `:8000` | `GET /health` | `status === "ok"` **그리고** `ocr === "ok"` | `server/ocr/routers/ocr.py` `health()` 가 **192×64 · 1블록** 합성 이미지를 실제 파이프라인에 태우고, **검출 블록이 1개 이상**일 때만 200 을 낸다(0개면 503 `degraded` / `ocr: "no-text"`). 즉 det 뿐 아니라 **rec 까지 실제로 돌았다는 증거**다. 404 가 오면 구버전 서버이므로 `GET /` 로 폴백하되 그 성공은 `구버전` 으로만 표시한다 |
| Spring `:8080` | `GET /auth/me` (**토큰이 있으면 붙여서**) | **HTTP 200 + `success === true`** | 그 200 은 JwtFilter → `AuthController.me()` → `JwtUtil.getUserId` → `AuthService.getUserById`(= `UserRepository` DB 조회) 전 구간을 통과했다는 뜻이다. 앱이 서버 변경 없이 **DB 까지 확인할 수 있는 유일한 경로**다 |
| Spring `:8080` | 위 요청이 200 이 아닐 때 | `도달만 확인` (초록 아님) | 401/400 은 "프로세스가 살아 있다" 까지만 증명한다 |

> **왜 바뀌었나.** 종전 판정은 두 줄 다 **라우트 생존**만 보고 초록을 냈다.
> · OCR: `GET /` 는 dict 하나를 돌려줄 뿐이라 **PaddleOCR 추론이 100% 죽은 상태에서도 200** 이었다. 2026-08-05 OOM 장애 내내 진단 화면은 "두 서버 모두 정상" 이라고 말했다.
> · Spring: 토큰 없는 `GET /auth/me` 는 `AuthController.me()` 첫 줄이 Authorization 헤더 부재를 보고 **DB 를 건드리기 전에** 401 을 만든다(`AuthController.java:117-119`). 즉 **Cloud SQL 이 통째로 죽어 모든 저장이 실패하는 상태에서도 똑같은 401** 이 오고, 화면은 초록을 냈다.
>
> **무인증으로 DB 를 확인할 방법은 이 서버에 없다** (2026-08-05 확인):
> ① actuator 미포함 — `server/spring/pom.xml` 에 `spring-boot-starter-actuator` 의존이 없어 `/actuator/health` 자체가 존재하지 않는다.
> ② 모든 컨트롤러가 첫 줄에서 Authorization 헤더를 검사하고 없으면 DB 접근 전에 401 을 낸다.
> ③ `POST /auth/login` 은 DB 를 타지만 `AuthController.login()` 이 `RuntimeException` 을 통째로 잡아 **DB 장애든 자격증명 오류든 동일한 400 `{"success":false,"error":"Invalid email or password"}`** 를 낸다(:98-106) → 구분 불가.
>
> **서버 측에 필요한 변경(미착수)**: `spring-boot-starter-actuator` 를 추가하고 `management.endpoint.health.show-details` 를 켜 `/actuator/health` 의 `db` 인디케이터를 노출하거나, DB 를 한 번 왕복하는 무인증 `GET /health` 를 추가한다. 어느 쪽이든 **백엔드 수정**이므로 §클라우드 이전 경로 6번(SecurityConfig 축소)과 함께 승인이 필요하다. 그때까지 진단 화면은 Spring 을 `도달만 확인` 으로 남긴다.

401을 실패로 처리하면 안 된다 — `연결 불가` 와는 다르다. 반대로 `success` 필드가 없는 응답은 우리 서버가 아닌 것(공유기 관리 페이지 등)에 닿은 것이므로 `다른 서버` 로 처리한다. 구현 정본은 `src/services/health.ts`, 상세는 [[Networking]] §1-7 · [[API Contract]] §3-15.
| 초기화 | `기본값으로 되돌리기` = `.env` 값 복원 |
| 릴리스 빌드 | **`variant === 'production'` 이면 진입점 4곳이 아예 렌더되지 않고**(1차 방어), 그래도 들어온 요청은 `app/(dev)/_layout.tsx` 가 받아 낸다(심층 방어). 받아 낼 때 **`Redirect` 를 쓰지 않는다** — `Redirect` 는 `router.replace` 라 현재 스택 엔트리를 지워, `/scan` 모달에서 넘어왔다면 압축이 끝난 이미지·실패 상태·재시도 카운트가 통째로 날아간다. 대신 `useFocusEffect` 안에서 되돌아갈 곳이 있으면 **`router.back()`**, 없을 때(딥링크 콜드스타트)만 `/(tabs)` 로 replace 한다 (2026-08-05 신설 → 4차 정정) |

> **`__DEV__` 가 아니라 `variant` 로 판단하는 이유** — 릴리스로 빌드한 `preview` APK 는 `__DEV__ === false` 지만 팀 내부 테스트용이라 진단 화면이 **있어야** 한다. 막아야 하는 것은 스토어에 올라가는 `production` 프로파일뿐이다. 종전 서술의 `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE` 는 코드에 구현된 적이 없다.
>
> **가드를 화면이 아니라 그룹 레이아웃에 거는 이유** — 진입점 4곳(`(tabs)/settings/index.tsx` 의 개발 섹션·버전 라벨 연속 탭, `components/auth/AuthScreen.tsx`, `app/scan/analyzing.tsx` 의 SCF-06 액션) 중 **뒤의 두 곳에 게이트가 없었다.** 특히 스캔 네트워크 실패 액션은 일반 사용자에게 가장 흔한 경로라, 스토어 빌드 사용자가 스캔을 한 번 실패시키면 서버 주소 입력창에 도달해 **임의 호스트를 MMKV 에 영구 저장**할 수 있었다. 화면마다 가드를 흩뿌리면 다음에 추가되는 `(dev)` 화면이 또 빠지므로 `(auth)/_layout` · `(tabs)/_layout` 과 같은 방식으로 레이아웃 한 곳에 건다.

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
