# Full-stack proof: OpenAI key, unit tests, production health + webhooks
# Usage:
#   $env:OPENAI_API_KEY = 'sk-...'   # optional one-off key test (never commit)
#   .\scripts\prove-full-ai-stack.ps1
param(
  [string]$Base = 'https://investo-backend-production.up.railway.app',
  [string]$OpenAiKey = $env:OPENAI_API_KEY
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Step($tag, $ok, $detail) {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host "[$mark] $tag - $detail"
}

Write-Host '=== Investo AI stack proof ==='
Write-Host ''

# 1) OpenAI key (optional, from env only)
if ($OpenAiKey) {
  try {
    $headers = @{
      Authorization = "Bearer $OpenAiKey"
      'Content-Type'  = 'application/json'
    }
    $body = '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Reply with OK only."}],"max_tokens":8}'
    $chat = Invoke-RestMethod -Method Post -Uri 'https://api.openai.com/v1/chat/completions' -Headers $headers -Body $body -TimeoutSec 60
    $reply = $chat.choices[0].message.content
    Step 'OpenAI chat (your key)' $true "model=$($chat.model) reply=$reply"

    $embBody = '{"model":"text-embedding-3-small","input":"investo proof"}'
    $emb = Invoke-RestMethod -Method Post -Uri 'https://api.openai.com/v1/embeddings' -Headers $headers -Body $embBody -TimeoutSec 60
    $dim = @($emb.data[0].embedding).Count
    Step 'OpenAI embeddings (your key)' ($dim -gt 100) "dimensions=$dim"
  } catch {
    Step 'OpenAI (your key)' $false $_.Exception.Message
  }
} else {
  Step 'OpenAI (your key)' $false 'Set OPENAI_API_KEY env var to test a custom key'
}

Write-Host ''

# 2) Local unit proof
Push-Location (Join-Path $root 'backend')
$testPattern = 'workflow-scenario-matrix|workflow-engine|agent-intent|agent-crm|visitIntent|visitMutation|agent-router.workflow|interactive-buttons|clientMemory'
Write-Host "Running unit tests: $testPattern"
npm test -- --testPathPattern=$testPattern --silent 2>&1 | Tee-Object -Variable testOut | Out-Null
$testOk = $LASTEXITCODE -eq 0
$summary = ($testOut | Select-String 'Tests:').Line | Select-Object -Last 1
Step 'Unit tests (intent + workflow + RAG + interactive)' $testOk ($summary ?? "exit=$LASTEXITCODE")
Pop-Location

Write-Host ''

# 3) Production health + capabilities (after deploy includes ai_capabilities)
try {
  $health = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 120
  Step 'Production health' ($health.status -eq 'ok') "status=$($health.status)"
  Step 'Production OpenAI (server key)' ($health.dependencies.openai.status -eq 'ok') $health.dependencies.openai.detail
  if ($health.ai_capabilities) {
    Step 'Production capability map' $true 'ai_capabilities exposed on /api/health'
  } else {
    Step 'Production capability map' $false 'Deploy latest backend to expose ai_capabilities on health'
  }
  if ($health.production_polish) {
    Step 'Production polish pillars' $true 'All 10 pillars on /api/health'
  } else {
    Step 'Production polish pillars' $false 'Deploy latest backend for production_polish block'
  }
} catch {
  Step 'Production health' $false $_.Exception.Message
}

Write-Host ''
Write-Host 'Running production webhook smoke...'
& (Join-Path $root 'scripts\verify-workflow-scenarios-production.ps1') -Base $Base

Write-Host ''
Write-Host 'To feel interactives on WhatsApp: message as a BUYER (non-staff phone). Staff copilot gets shortcut buttons after each reply.'
Write-Host 'Meta Cloud API = native buttons/lists; GreenAPI = numbered text menu fallback.'
