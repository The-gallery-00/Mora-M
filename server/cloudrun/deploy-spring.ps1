param(
    [Parameter(Mandatory = $true)] [string] $ProjectId,
    [Parameter(Mandatory = $true)] [string] $Image,
    [Parameter(Mandatory = $true)] [string] $CloudSqlInstance,
    [Parameter(Mandatory = $true)] [string] $OcrServiceUrl,
    [Parameter(Mandatory = $true)] [string] $ServiceAccount,
    [string] $Region = "asia-northeast3",
    [string] $ServiceName = "mora-mobile-spring",
    [string] $OpenAiSecret = "mora-openai-api-key",
    [string] $OpenAiSecretVersion = "1",
    [string] $JwtSecret = "mora-jwt-secret",
    [string] $JwtSecretVersion = "1",
    [string] $DatabasePasswordSecret = "mora-database-password",
    [string] $DatabasePasswordSecretVersion = "1",
    # 기본값에 의존하지 않고 명시한다. 리소스를 콘솔에서 손으로 바꾸면
    # 다음 배포가 조용히 되돌려 놓는다.
    [string] $Memory = "1Gi",
    [string] $Cpu = "1",
    # deploy-ocr.ps1 과 같은 이유다. 앱은 Google IAM 자격증명을 가질 수 없으므로 이 서비스도 공개여야 한다.
    # 아래 gcloud 호출이 --quiet 라, 이 플래그가 없으면 **신규 서비스 최초 배포에서 비공개로 뜬다**
    # ("Allow unauthenticated invocations?" 프롬프트가 기본값 아니오로 답해진다).
    # 그때 앱이 받는 것은 봉투 JSON 이 아니라 Google 의 HTML 403 이고, src/services/health.ts 는
    # 그것을 'wrong-server'("포트를 확인해 주세요")로 칠해 원인과 정반대 방향을 가리킨다.
    # 인증은 애초에 Cloud Run IAM 이 아니라 앱 계층 JWT(JwtFilter + 각 컨트롤러)가 담당한다.
    [bool] $AllowUnauthenticated = $true
)

$ErrorActionPreference = "Stop"

# Secret values are deliberately never accepted as script parameters. The
# Cloud Run revision receives them directly from Secret Manager at runtime.
$secretNames = @($OpenAiSecret, $JwtSecret, $DatabasePasswordSecret)
foreach ($secretName in $secretNames) {
    gcloud secrets describe $secretName --project $ProjectId --quiet | Out-Null
}

$databaseUrl = "jdbc:postgresql:///mora?cloudSqlInstance=$CloudSqlInstance&socketFactory=com.google.cloud.sql.postgres.SocketFactory&cloudSqlRefreshStrategy=lazy&stringtype=unspecified"
$environment = "DATABASE_URL=$databaseUrl,DATABASE_USERNAME=mora,OCR_SERVICE_URL=$OcrServiceUrl,JWT_EXPIRATION=1209600000,DB_MAX_POOL_SIZE=3,DB_MIN_IDLE=0"
$secrets = "OPENAI_API_KEY=${OpenAiSecret}:${OpenAiSecretVersion},JWT_SECRET=${JwtSecret}:${JwtSecretVersion},DATABASE_PASSWORD=${DatabasePasswordSecret}:${DatabasePasswordSecretVersion}"

# ─────────────────────────────────────────────────────────────────────────────
# ⚠️ 미해결: Spring 에는 HTTP probe 를 걸 대상이 없다 (2026-08-05)
#
# OCR 쪽(deploy-ocr.ps1)에는 /health 를 만들어 두고 probe 배선만 남았지만, Spring 은
# **엔드포인트 자체가 없다** — server/spring/pom.xml 에 spring-boot-starter-actuator 의존이 없어
# /actuator/health 가 존재하지 않고, 나머지 컨트롤러는 전부 Authorization 헤더를 요구한다.
# 그래서 Cloud Run 은 기본 TCP probe 만 쓰고, **Cloud SQL 이 끊겨 모든 DB 경로가 실패해도
# 인스턴스는 계속 트래픽을 받는다.** 앱 진단 화면이 Spring 을 '정상' 이 아니라 '도달만 확인' 으로
# 표시하는 이유가 이것이다 (src/services/health.ts · ADR-002 §2 헬스 프로브).
#
# 해소하려면 서버 변경이 선행되어야 한다: actuator 추가 → /actuator/health 무인증 노출
# (db 인디케이터 포함) → 여기에 liveness probe 배선. 그 승인 전까지 이 스크립트는 손댈 것이 없다.
# ─────────────────────────────────────────────────────────────────────────────

$deployArgs = @(
    "run", "deploy", $ServiceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--image", $Image,
    "--service-account", $ServiceAccount,
    "--add-cloudsql-instances", $CloudSqlInstance,
    "--set-env-vars", $environment,
    "--set-secrets", $secrets,
    "--memory", $Memory,
    "--cpu", $Cpu,
    "--max-instances", 3,
    "--quiet"
)

if ($AllowUnauthenticated) {
    $deployArgs += "--allow-unauthenticated"
} else {
    $deployArgs += "--no-allow-unauthenticated"
}

gcloud @deployArgs
