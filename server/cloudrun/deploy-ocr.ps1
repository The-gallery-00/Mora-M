param(
    [Parameter(Mandatory = $true)] [string] $ProjectId,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $BucketName,
    [string] $ServiceAccount,
    [string] $Region = "asia-northeast3",
    [string] $ServiceName = "mora-mobile-ocr",
    [string] $UploadPrefix = "uploads",
    # 메모리 상한. **실측치의 정본은 ADR-002 §0 이다 — 여기에 숫자를 복제하지 않는다.**
    # (숫자를 여러 파일에 복제한 것이 이번 조사에서 같은 입력의 값이 셋으로 갈리게 만든 원인이다.
    #  Risks.md §5 규칙 8 과 ADR-002 §0 의 정본 선언이 같은 취지다.)
    #
    # 이 값을 정한 근거만 요약하면: 생성자 수정 후 상주 RSS 는 약 0.74GB 이고,
    # 요청 peak 는 **입력 해상도와 거의 무관하게** 1GB 미만으로 평탄하다
    # (det 입력이 긴 변 960 으로 clamp 되어 상수 크기가 되기 때문이다).
    # 2Gi 는 그 위의 안전 여유다. 낮추면 인스턴스가 죽고 Cloud Run 이 text/plain 503 을
    # 돌려주는데, 그 503 은 앱이 만든 것이 아니라서 애플리케이션 로그에 원인이 남지 않는다.
    [string] $Memory = "2Gi",
    [string] $Cpu = "1",
    [int] $TimeoutSeconds = 300,
    [int] $MaxInstances = 3,
    # 인스턴스 하나가 동시에 받아들이는 요청 수. 근거는 아래 "──[--concurrency]──" 블록 참조.
    [int] $Concurrency = 4,
    # 앱은 Google IAM 자격증명을 가질 수 없다(스토어에서 받은 APK 다). 따라서 이 서비스는 공개여야 한다.
    #
    # 이 플래그가 없으면 **신규 서비스 최초 배포에서 서비스가 비공개로 뜬다.** 아래 gcloud 호출이
    # --quiet 라 "Allow unauthenticated invocations?" 프롬프트가 기본값(아니오)으로 답해지기 때문이다.
    # 그때 앱이 받는 것은 JSON 이 아니라 **Google 이 낸 HTML 403** 이고, src/services/health.ts 의
    # 판정은 그것을 'wrong-server'("포트를 확인해 주세요")로 칠해 **원인과 정반대 방향**을 가리킨다.
    # (403 은 5xx 가 아니라 isGatewayFailure 에도 걸리지 않는다.)
    # 이미 공개로 떠 있는 서비스에 다시 줘도 무해하다 — 같은 IAM 바인딩을 재적용할 뿐이다.
    # 비공개로 두려면 -AllowUnauthenticated $false 로 명시한다.
    [bool] $AllowUnauthenticated = $true
)

$ErrorActionPreference = "Stop"

# ─────────────────────────────────────────────────────────────────────────────
# ──[--concurrency]── 왜 4 인가 (이전 "지정하지 않는다" 결정을 뒤집는다)
#
# [이전 근거가 왜 부족했나]
# 예전 주석은 "관측된 크래시는 전부 단일 순차 요청이었으므로 동시성은 변수가 아니다" 였다.
# 그 문장 자체는 참이지만 **크래시 얘기이지 큐잉 얘기가 아니다.** 지정하지 않으면
# Cloud Run 기본값 80 이 걸리는데, 80 이 만드는 문제는 OOM 이 아니라 대기열이다.
#
# [왜 80 이 나쁜가 — 이 서비스의 구조 때문]
# routers/ocr.py 의 scan()/commit()/health() 는 셋 다 `async def` 안에서 **동기 blocking
# 추론**을 돈다. 즉 코루틴이 이벤트 루프를 붙잡은 채 끝까지 실행되므로, 한 인스턴스가
# 몇 건을 받든 추론은 **완전히 직렬**이다(그래서 메모리 peak 은 겹치지 않는다 — 2Gi 유지).
# 동시성을 80 으로 두면 그 직렬 큐의 길이만 80 이 된다:
#   · 대기 시간 = 앞선 요청 수 × 요청당 2~11초. 동시 20건이면 마지막 요청은 19×(2~11s)
#     = 38~209초를 기다린다 → Spring OCR read timeout 90초(RestTemplateConfig.java)와
#     앱 SCAN_TIMEOUT_MS 120초를 넘겨 SCF-08 "서버가 느립니다" 가 뜬다.
#     **원인은 동시성 설정인데 화면은 "서버가 느리다"고 말한다 — 전형적인 거짓 신호다.**
#   · 더 나쁜 것: Cloud Run 오토스케일러는 "동시성 대비 사용률" 로 스케일아웃을 판단한다.
#     한 인스턴스가 5/80 을 처리 중이면 6% 사용 중으로 보이므로 **두 번째 인스턴스가 뜨지
#     않는다.** --max-instances 3 이 사실상 죽은 설정이 된다.
#   · 대기 중인 요청은 업로드 본문을 물고 있다. Starlette UploadFile 은 1MB 초과분을
#     디스크로 흘리는데 Cloud Run 의 쓰기 가능 파일시스템은 tmpfs(=메모리)다.
#     80건 × 수 MB 면 수백 MB — "메모리는 안전하다" 는 말도 80 에서는 성립하지 않는다.
#
# [왜 1 이 아닌가]
# 1 이면 인스턴스당 1건이라 대기열이 사라지지만, --max-instances 3 과 곱해 동시 3건이
# 상한이 된다. 4번째 요청은 Cloud Run 쪽 큐에 걸리고 과부하 시 429("no available
# instance")가 나올 수 있다 — 앱에서 보면 또 다른 원인 불명의 실패다.
# 또 콜드스타트 18~33초가 요청마다 노출될 확률이 커진다.
#
# [4 를 고른 산술]
#   · 인스턴스 내 최악 대기 = (4-1) × 요청당 시간. 보수적으로 21블록 10.66초를 쓰면
#     3 × 10.66 = 32초 대기 + 자기 몫 10.66초 ≈ 43초 < Spring read 90초. 마진 47초.
#   · Cloud Run 오토스케일러는 동시성의 약 60%(=2.4건)에서 스케일아웃하므로
#     --max-instances 3 이 실제로 쓰인다. 총 처리 능력 3×4 = 12건.
#   · 추론이 직렬이므로 4 로 올려도 CPU/메모리 peak 은 1건일 때와 같다(약 1.03GB).
#     늘어나는 것은 대기 중 업로드 본문 tmpfs 뿐이고, 4건이면 수 MB 수준이다.
#
# [이 값을 다시 만져야 하는 조건]
# 위 산술의 입력은 "요청당 10.66초"(21블록, 측정 PC 기준)다. Cloud Run 1 vCPU 실측이
# 그보다 크게 느리면 (4-1)×T + T < 90초 를 다시 풀어야 한다. T > 22초면 4 도 위험하다.
# → 배포 후 Cloud Run 로그의 실제 request latency p95 를 보고 확정할 것.
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# ⚠️ 미해결: Cloud Run 이 GET /health 를 보지 않는다 (2026-08-05)
#
# routers/ocr.py 에 추론 셀프테스트까지 도는 /health 를 만들었지만, **이 배포는 그것을
# 사용하지 않는다.** 아래 gcloud 호출에 startup/liveness probe 설정이 없어 Cloud Run 은
# 기본 TCP probe 만 쓴다 — 포트가 열려 있으면 살아 있다고 본다.
# 결과: **PaddleOCR 추론이 죽었어도 인스턴스가 계속 트래픽을 받는다.** 진단 화면에서 없앤
# 거짓 초록불이 인프라 층에 그대로 남아 있는 셈이다.
#
# gcloud run deploy 로 HTTP probe 를 걸 수 있는가 — **미확인.**
#   이 PC 에 gcloud 가 설치돼 있지 않아(`which gcloud` → 없음) 플래그 존재 여부를 확인하지 못했다.
#   추측으로 플래그를 적어 두면 배포가 통째로 실패하므로 적지 않는다.
#   배포 담당자는 먼저 아래를 실행해 확인할 것:
#       gcloud run deploy --help | Select-String -Pattern "probe"
#       gcloud beta run deploy --help | Select-String -Pattern "probe"
#   플래그가 있으면 이 스크립트에 추가하고 이 주석 블록을 지운다.
#
# 플래그가 없다면 `gcloud run services replace <yaml>` 로 가야 한다. 그때 쓸 조각
# (Knative serving v1 스펙. 값은 아래 근거대로 잡았고, Cloud Run 이 강제하는 상한
#  — 예: startupProbe 의 failureThreshold × periodSeconds 총합 제한 — 은 **미확인**이므로
#  거부당하면 periodSeconds/failureThreshold 를 줄일 것):
#
#   apiVersion: serving.knative.dev/v1
#   kind: Service
#   metadata:
#     name: mora-mobile-ocr
#   spec:
#     template:
#       spec:
#         containerConcurrency: 4         # 위 "──[--concurrency]──" 블록과 반드시 같은 값으로 유지할 것
#         containers:
#           - image: <IMAGE>
#             ports:
#               - name: http1
#                 containerPort: 8000
#             startupProbe:
#               httpGet:
#                 path: /health
#               periodSeconds: 10
#               timeoutSeconds: 10
#               failureThreshold: 12      # 10s x 12 = 120s. 콜드스타트 실측 18~33초 + 첫 셀프테스트를 덮는다
#             livenessProbe:
#               httpGet:
#                 path: /health
#               periodSeconds: 60         # /health 캐시 TTL 30초보다 길다 → 매번 실제 셀프테스트가 돈다
#               timeoutSeconds: 30        # ↓ 아래 [timeoutSeconds 를 10 → 30 으로 올린 이유]
#               failureThreshold: 3       # 3연속 실패에서만 재시작. 일시적 지연으로 인스턴스를 죽이지 않는다
#
# 주의: livenessProbe 는 /health 가 503 을 낼 때 컨테이너를 재시작시킨다. 그것이 이 항목의 목적이다
# (추론이 죽은 인스턴스를 트래픽에서 빼는 것). 다만 OOM 으로 프로세스가 통째로 죽는 경우는
# 이 probe 가 아니라 메모리 상한(--memory)이 막아야 한다 — 둘은 다른 방어선이다.
#
# [timeoutSeconds 를 10 → 30 으로 올린 이유]
# /health 자체는 빠르다(글자 1블록 셀프테스트, 로컬 실측 150~270ms; 캐시 히트는 2ms).
# 문제는 **핸들러가 async 안에서 blocking 추론을 돌아 이벤트 루프가 직렬화된다**는 것이다.
# 앞선 scan 이 21블록짜리 명함을 처리 중이면 /health 코루틴은 그것이 끝날 때까지 시작조차
# 못 한다. 대기 최악값은 (containerConcurrency-1)×요청시간 ≈ 3×10.66s ≈ 32초.
# timeout 을 10초로 두면 **정상 처리 중인 바쁜 인스턴스를 probe 가 죽인다** —
# 없애려던 거짓 신호를 인프라 층에서 다시 만드는 셈이다. 30초 × 3연속 실패(180초)로
# "진짜 멈춘 인스턴스" 만 재시작되게 한다.
# (Cloud Run 은 timeoutSeconds <= periodSeconds 를 요구한다. 60 >= 30 이므로 유효하다.)
# ─────────────────────────────────────────────────────────────────────────────

$environment = "GCS_BUCKET_NAME=$BucketName,GCS_UPLOAD_PREFIX=$UploadPrefix"

$deployArgs = @(
    "run", "deploy", $ServiceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--image", $Image,
    "--set-env-vars", $environment,
    "--memory", $Memory,
    "--cpu", $Cpu,
    "--timeout", $TimeoutSeconds,
    "--max-instances", $MaxInstances,
    # 위 "──[--concurrency]──" 블록의 근거로 명시한다. 생략하면 Cloud Run 기본 80 이 걸려
    # 스케일아웃이 사실상 꺼지고 요청이 한 인스턴스에 직렬로 쌓인다.
    "--concurrency", $Concurrency,
    "--quiet"
)

if ($ServiceAccount) {
    $deployArgs += @("--service-account", $ServiceAccount)
}

if ($AllowUnauthenticated) {
    $deployArgs += "--allow-unauthenticated"
} else {
    # 명시적으로 비공개를 택한 경우. 앱에서 보면 Google 이 낸 HTML 403 이 오고
    # 진단 화면은 '다른 서버' 로 표시한다 — 의도한 상태인지 확인할 것.
    $deployArgs += "--no-allow-unauthenticated"
}

gcloud @deployArgs
