# Production backend hardening: deploy code + env + smoke tests.
param(
  [string]$AccountToken = $env:RAILWAY_ACCOUNT_TOKEN,
  [string]$ProjectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359',
  [string]$EnvironmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e',
  [string]$ServiceId = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7',
  [string]$ServiceName = 'investo-backend',
  [string]$ApiBase = 'https://investo-backend-production.up.railway.app',
  [string]$MetricsBearerToken = $env:METRICS_BEARER_TOKEN,
  [string]$SentryDsn = $env:SENTRY_DSN,
  [switch]$SkipDeploy,
  [switch]$SkipEnv
)

$ErrorActionPreference = 'Stop'

if (-not $AccountToken) { $AccountToken = $env:RAILWAY_TOKEN }
if (-not $AccountToken) {
  Write-Host 'Set RAILWAY_ACCOUNT_TOKEN, or after railway login use CLI: link project af15cb2b, railway up, set METRICS_BEARER_TOKEN, delete SKIP_IP_WHITELIST, set SENTRY_DSN.'
  throw 'Missing Railway token.'
}

function Invoke-RailwayGql($token, $query, $variables = @{}) {
  $headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
  $body = @{ query = $query; variables = $variables } | ConvertTo-Json -Depth 8 -Compress
  return Invoke-RestMethod -Method Post -Uri 'https://backboard.railway.com/graphql/v2' -Headers $headers -Body $body
}

if (-not $SkipDeploy) {
  & (Join-Path $PSScriptRoot 'deploy-railway-upload.ps1') -AccountToken $AccountToken -ProjectId $ProjectId -EnvironmentId $EnvironmentId -ServiceName $ServiceName -Message 'prod hardening'
}

if (-not $SkipEnv) {
  if (-not $MetricsBearerToken) {
    $MetricsBearerToken = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[+/=]',''
  }
  $upsert = 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }'
  $del = 'mutation($input: VariableDeleteInput!) { variableDelete(input: $input) }'
  $redeploy = 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }'
  $base = @{ projectId = $ProjectId; environmentId = $EnvironmentId; serviceId = $ServiceId }
  Invoke-RailwayGql $AccountToken $upsert @{ input = ($base + @{ name = 'METRICS_BEARER_TOKEN'; value = $MetricsBearerToken }) } | Out-Null
  Invoke-RailwayGql $AccountToken $del @{ input = ($base + @{ name = 'SKIP_IP_WHITELIST' }) } | Out-Null
  if ($SentryDsn) {
    Invoke-RailwayGql $AccountToken $upsert @{ input = ($base + @{ name = 'SENTRY_DSN'; value = $SentryDsn }) } | Out-Null
  } else {
    Write-Warning 'SENTRY_DSN not set.'
  }
  Invoke-RailwayGql $AccountToken $redeploy @{ serviceId = $ServiceId; environmentId = $EnvironmentId } | Out-Null
  Start-Sleep -Seconds 90
}

curl.exe -s "$ApiBase/api/health/live"; Write-Host ''
curl.exe -s -o NUL -w "metrics no auth: %{http_code}`n" "$ApiBase/api/metrics"
if ($MetricsBearerToken) {
  curl.exe -s -o NUL -w "metrics bearer: %{http_code}`n" -H "Authorization: Bearer $MetricsBearerToken" "$ApiBase/api/metrics"
}
Write-Host 'Worker: optional second Railway service with startCommand npm run start:worker; same env; avoid duplicate cron on API+worker.'
