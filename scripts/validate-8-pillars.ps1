# Validates 8 capability pillars against production API (unauthenticated + optional auth)
param(
  [string]$ApiBase = 'https://investo-backend-v2.onrender.com/api',
  [string]$Frontend = 'https://biginvesto.online',
  [string]$BearerToken = $env:INVESTO_TEST_TOKEN
)

$results = @()

function Add-Result($pillar, $test, $pass, $evidence) {
  $script:results += [pscustomobject]@{ Pillar = $pillar; Test = $test; Pass = $pass; Evidence = $evidence }
}

Write-Host "=== Investo 8-Pillar Production Validation ===" -ForegroundColor Cyan

# Pillar 8 / 7 — health
try {
  $health = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 30
  Add-Result 8 'GET /health' ($health.status -eq 'ok' -or $health.ok -eq $true) ($health | ConvertTo-Json -Compress)
} catch {
  Add-Result 8 'GET /health' $false $_.Exception.Message
}

# Pillar 1 — readiness (AI stack, requires auth)
if ($BearerToken) {
  try {
    $ready = Invoke-RestMethod -Uri "$ApiBase/readiness" -Headers @{ Authorization = "Bearer $BearerToken" } -TimeoutSec 30
    Add-Result 1 'GET /readiness' ($null -ne $ready.data) ($ready | ConvertTo-Json -Compress -Depth 2)
  } catch {
    Add-Result 1 'GET /readiness' $false $_.Exception.Message
  }
} else {
  Add-Result 1 'GET /readiness' 'SKIP' 'Set INVESTO_TEST_TOKEN'
}

# Frontend up
try {
  $fe = Invoke-WebRequest -Uri $Frontend -UseBasicParsing -TimeoutSec 30
  Add-Result 2 'Frontend HTTPS' ($fe.StatusCode -eq 200) "status=$($fe.StatusCode)"
} catch {
  Add-Result 2 'Frontend HTTPS' $false $_.Exception.Message
}

if ($BearerToken) {
  $headers = @{ Authorization = "Bearer $BearerToken" }
  foreach ($path in @(
    @{ p = 2; t = 'leads?limit=1'; n = 'Leads list (lead_score)' },
    @{ p = 5; t = 'analytics/extended'; n = 'Extended analytics' },
    @{ p = 3; t = 'leads/export/json?limit=1'; n = 'JSON export route' },
    @{ p = 6; t = 'assignment-settings'; n = 'Assignment settings' },
    @{ p = 8; t = 'error-logs?days=7'; n = 'Error logs' }
  )) {
    try {
      $r = Invoke-RestMethod -Uri "$ApiBase/$($path.t)" -Headers $headers -TimeoutSec 30
      Add-Result $path.p $path.n $true '200 + JSON body'
    } catch {
      Add-Result $path.p $path.n $false $_.Exception.Message
    }
  }
} else {
  Add-Result 5 'Auth endpoints' 'SKIP' 'Set INVESTO_TEST_TOKEN for authenticated checks'
}

$results | Format-Table -AutoSize
$fail = @($results | Where-Object { $_.Pass -eq $false })
if ($fail.Count) {
  Write-Host "`nFAILED: $($fail.Count)" -ForegroundColor Red
  exit 1
}
Write-Host "`nAll runnable checks passed." -ForegroundColor Green
