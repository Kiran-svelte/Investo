# Run Investo's dedicated eval suites.
#
# Local default:
#   .\scripts\run-investo-evals.ps1
#
# Include browser and production handset/webhook proof when credentials are available:
#   .\scripts\run-investo-evals.ps1 -IncludeFrontend -IncludeE2E -IncludeProduction

param(
  [switch]$IncludeFrontend,
  [switch]$IncludeE2E,
  [switch]$IncludeProduction,
  [string]$Base = 'https://investo-backend-production.up.railway.app',
  [string]$Email = $env:E2E_EMAIL,
  [string]$Password = $env:E2E_PASSWORD
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Run-Step($label, $cwd, $script) {
  Write-Host ""
  Write-Host "=== $label ===" -ForegroundColor Cyan
  Push-Location $cwd
  try {
    & $script
    if ($LASTEXITCODE -ne 0) {
      throw "$label failed with exit $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Run-Step 'Backend AI/product evals' $backend {
  npm run eval
}

if ($IncludeFrontend) {
  Run-Step 'Frontend component eval/proof tests' $frontend {
    npm test
  }
}

if ($IncludeE2E) {
  Run-Step 'Browser E2E evals' $frontend {
    npm run test:e2e -- e2e/core-routes-regression.spec.ts e2e/auth-regression.spec.ts e2e/password-reset-smoke.spec.ts
  }
}

if ($IncludeProduction) {
  Write-Host ""
  Write-Host "=== Production workflow/webhook evals ===" -ForegroundColor Cyan
  $args = @('-Base', $Base)
  if ($Email) { $args += @('-Email', $Email) }
  if ($Password) { $args += @('-Password', $Password) }
  & "$PSScriptRoot\verify-workflow-scenarios-production.ps1" @args
  if ($LASTEXITCODE -ne 0) {
    throw "Production workflow/webhook evals failed with exit $LASTEXITCODE"
  }
}

Write-Host ""
Write-Host "Investo evals completed." -ForegroundColor Green
