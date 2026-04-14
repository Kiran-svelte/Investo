$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rootPath = Join-Path (Resolve-Path ..) "test-results/whatsapp-prod-ui-proof-$timestamp"
New-Item -ItemType Directory -Force $rootPath | Out-Null
$urls = @(
  "https://frontend-jn7k9msdy-traderlighter11-7085s-projects.vercel.app",
  "https://frontend-odws6d7ic-traderlighter11-7085s-projects.vercel.app",
  "https://frontend-lhssctdt3-traderlighter11-7085s-projects.vercel.app"
)
$env:E2E_EMAIL = "admin@investo.in"
$env:E2E_PASSWORD = "admin@123"
$allResults = @()
foreach ($base in $urls) {
  $hostUrl = ([uri]$base).Host
  $evidenceDir = Join-Path $rootPath $hostUrl
  New-Item -ItemType Directory -Force $evidenceDir | Out-Null
  $env:EVIDENCE_DIR = $evidenceDir
  $env:E2E_BASE_URL = $base
  $debugOutput = vercel curl / --deployment $base --debug 2>&1 | Out-String
  $match = [regex]::Match($debugOutput, 'x-vercel-protection-bypass:\s*([^\s\r\n]+)', 'IgnoreCase')
  if ($match.Success) { $env:VERCEL_PROTECTION_BYPASS = $match.Groups[1].Value } else { Remove-Item Env:VERCEL_PROTECTION_BYPASS -ErrorAction SilentlyContinue }
  node .\_tmp_whatsapp_providers_runtime_proof.mjs *>> (Join-Path $evidenceDir 'stdout.txt')
  $exitCode = $LASTEXITCODE
  $resFile = Join-Path $evidenceDir 'result.json'
  if (Test-Path $resFile) {
      $r = Get-Content -Raw $resFile | ConvertFrom-Json
      $allResults += [pscustomobject]@{
        baseURL = $r.baseURL; exitCode = $exitCode; loginOk = $r.login.ok; providerSelectPresent = $r.whatsapp.providerSelectPresent;
        metaWebhookUrlLooksCorrect = $r.whatsapp.meta.webhookUrlLooksCorrect; greenapiWebhookUrlLooksCorrect = $r.whatsapp.greenapi.webhookUrlLooksCorrect;
        evidenceDir = $r.evidenceDir
      }
  } else { $allResults += [pscustomobject]@{ baseURL = $base; exitCode = $exitCode; error = "No result.json" } }
}
$allResults | ConvertTo-Json -Depth 10 | Out-File -FilePath "$rootPath/summary.json"
$allResults | ConvertTo-Json -Depth 10
Write-Host "Output Directory: $rootPath"
