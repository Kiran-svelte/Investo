# Investo production proof gate.
#
# Runs the checks that can be automated locally, then optionally runs production
# webhook, handset, and chaos probes when credentials/environment are available.
#
# Default mode is local-safe:
#   .\scripts\run-full-a-plus-gate.ps1
#
# Full production mode:
#   $env:RAILWAY_ACCOUNT_TOKEN = '<token>'
#   $env:E2E_EMAIL = 'admin@investo.in'
#   $env:E2E_PASSWORD = '<password>'
#   .\scripts\run-full-a-plus-gate.ps1 -RunE2E -RunProduction -RunHandset -RunChaos

param(
  [switch]$RunE2E,
  [switch]$RunProduction,
  [switch]$RunHandset,
  [switch]$RunChaos,
  [string]$Base = 'https://investo-backend-production.up.railway.app',
  [string]$AccountToken = $env:RAILWAY_ACCOUNT_TOKEN,
  [string]$Email = $env:E2E_EMAIL,
  [string]$Password = $env:E2E_PASSWORD,
  [int]$HandsetStepDelaySec = 8
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

$script:Rows = @()

function Add-Result {
  param(
    [string]$Area,
    [string]$Check,
    [bool]$Ok,
    [string]$Evidence
  )

  $script:Rows += [pscustomobject]@{
    Area = $Area
    Check = $Check
    Result = if ($Ok) { 'PASS' } else { 'FAIL' }
    Evidence = $Evidence
  }

  $color = if ($Ok) { 'Green' } else { 'Red' }
  $mark = if ($Ok) { 'PASS' } else { 'FAIL' }
  Write-Host "[$mark] $Area - $Check :: $Evidence" -ForegroundColor $color
}

function Invoke-Step {
  param(
    [string]$Area,
    [string]$Check,
    [string]$WorkingDirectory,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "=== $Area / $Check ===" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Command
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    Add-Result $Area $Check ($exitCode -eq 0) "exit=$exitCode"
  } catch {
    Add-Result $Area $Check $false $_.Exception.Message
  } finally {
    Pop-Location
  }
}

function Invoke-Optional {
  param(
    [bool]$Enabled,
    [string]$Area,
    [string]$Check,
    [scriptblock]$Command,
    [string]$SkipReason
  )

  if (-not $Enabled) {
    $script:Rows += [pscustomobject]@{
      Area = $Area
      Check = $Check
      Result = 'SKIP'
      Evidence = $SkipReason
    }
    Write-Host "[SKIP] $Area - $Check :: $SkipReason" -ForegroundColor Yellow
    return
  }

  Write-Host ""
  Write-Host "=== $Area / $Check ===" -ForegroundColor Cyan
  try {
    & $Command
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    Add-Result $Area $Check ($exitCode -eq 0) "exit=$exitCode"
  } catch {
    Add-Result $Area $Check $false $_.Exception.Message
  }
}

Write-Host "=== Investo A+ Proof Gate ===" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host "Production API: $Base"
Write-Host ""

Invoke-Step 'Functional' 'backend TypeScript contract' $backend {
  npx tsc --noEmit
}

Invoke-Step 'Functional' 'backend unit/integration/regression suite' $backend {
  npx jest --runInBand
}

Invoke-Step 'AI-specific' 'workflow scenario matrix and confidence gates' $backend {
  npm run eval
  npx jest src/tests/unit/workflow-scenario-matrix.test.ts src/tests/unit/workflow-confidence.test.ts src/tests/unit/mutationLanguageGuard.service.test.ts src/tests/unit/buyerMemoryRecall.service.test.ts --runInBand
}

Invoke-Step 'Security and compliance' 'authz, sanitization, GDPR, rate limit, audit log tests' $backend {
  npx jest src/tests/unit/auth.routes.test.ts src/tests/unit/rbac.test.ts src/tests/unit/sanitizeInput.middleware.test.ts src/tests/unit/lead-gdpr.routes.test.ts src/tests/unit/rate-limiter.test.ts src/tests/unit/agent-action-log.routes.test.ts --runInBand
}

Invoke-Step 'Reliability and data' 'idempotency, saga, visit state, queue, circuit breaker' $backend {
  npx jest src/tests/unit/workflow-engine.service.test.ts src/tests/unit/visitState.service.test.ts src/tests/unit/deduplication.service.test.ts src/tests/unit/automation-queue.test.ts src/tests/unit/circuit-breaker.test.ts --runInBand
}

Invoke-Step 'Performance' 'health route load smoke' $root {
  node scripts/load-health-smoke.mjs
}

Invoke-Step 'Infrastructure' 'backend production build' $backend {
  npm run build
}

Invoke-Step 'Functional' 'frontend component/unit tests' $frontend {
  npm test
}

Invoke-Step 'Infrastructure' 'frontend production build' $frontend {
  npm run build
}

Invoke-Optional $RunE2E 'E2E and UX' 'Playwright browser regression pack' {
  Push-Location $frontend
  try {
    npm run test:e2e -- e2e/core-routes-regression.spec.ts e2e/auth-regression.spec.ts e2e/password-reset-smoke.spec.ts
  } finally {
    Pop-Location
  }
} 'Pass -RunE2E with E2E_EMAIL/E2E_PASSWORD for browser proof'

Invoke-Optional ($RunProduction -and $AccountToken) 'Infrastructure and deployment' 'Railway env fetch' {
  & "$PSScriptRoot\railway-fetch-vars.ps1" -AccountToken $AccountToken
} 'Pass -RunProduction and set RAILWAY_ACCOUNT_TOKEN'

Invoke-Optional $RunProduction 'Smoke and webhook' 'production health plus workflow webhook smoke' {
  $args = @('-Base', $Base)
  if ($Email) { $args += @('-Email', $Email) }
  if ($Password) { $args += @('-Password', $Password) }
  & "$PSScriptRoot\verify-workflow-scenarios-production.ps1" @args
} 'Pass -RunProduction with staging/prod credentials'

Invoke-Optional $RunHandset 'Conversational flow' 'production handset matrix' {
  & "$PSScriptRoot\run-handset-matrix-prod.ps1" -Base $Base -StepDelaySec $HandsetStepDelaySec
} 'Pass -RunHandset for async buyer/staff WhatsApp scenario proof'

Invoke-Optional $RunChaos 'Reliability and resilience' 'inbound chaos webhook simulation' {
  Push-Location $backend
  try {
    $env:API_BASE = "$Base/api"
    npx tsx scripts/chaos-monkey-inbound.mjs
  } finally {
    Pop-Location
  }
} 'Pass -RunChaos against a safe staging/prod phone'

$failed = @($script:Rows | Where-Object { $_.Result -eq 'FAIL' })

Write-Host ""
Write-Host "=== Gate Summary ===" -ForegroundColor Cyan
$script:Rows | Format-Table -AutoSize

if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "A+ proof gate failed: $($failed.Count) failing check(s)." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "A+ proof gate passed for all enabled checks. Skipped checks still require separate evidence." -ForegroundColor Green
