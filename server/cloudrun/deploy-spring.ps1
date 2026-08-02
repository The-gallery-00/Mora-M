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
    [string] $DatabasePasswordSecretVersion = "1"
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

gcloud run deploy $ServiceName `
    --project $ProjectId `
    --region $Region `
    --image $Image `
    --service-account $ServiceAccount `
    --add-cloudsql-instances $CloudSqlInstance `
    --set-env-vars $environment `
    --set-secrets $secrets `
    --max-instances 3 `
    --quiet
