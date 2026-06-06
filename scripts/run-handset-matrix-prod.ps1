# Execute handset matrix scenarios against Railway production via Meta webhook simulation.
# Webhook returns 200 immediately; processing is async — script waits between steps.
# DB verification requires prod DATABASE_URL (not available in CI shell).
param(
  [string]$Base = 'https://investo-backend-production.up.railway.app',
  [string]$Frontend = 'https://biginvesto.online',
  [string]$PhoneNumberId = '1090528010807708',
  [string]$CompanyId = 'e12e7540-8218-4b25-b427-ff8b800df116',
  [string]$BuyerPhone = '',
  [string]$StaffPhone = '919876543210',
  [int]$StepDelaySec = 8
)

$ErrorActionPreference = 'Continue'
$results = @()

if (-not $BuyerPhone) {
  $BuyerPhone = '91900000' + (Get-Random -Minimum 7000 -Maximum 8999)
}

function Record($num, $name, $ok, $detail) {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  $row = [pscustomobject]@{ Num = $num; Name = $name; Result = $mark; Detail = $detail }
  $script:results += $row
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host "[$mark] #$num $name - $detail" -ForegroundColor $color
}

function Send-Webhook($from, $body, $msgId, $name = 'Customer') {
  $payload = @{
    object = 'whatsapp_business_account'
    entry  = @(@{
      id = 'handset-matrix'
      changes = @(@{
        field = 'messages'
        value = @{
          metadata = @{ phone_number_id = $PhoneNumberId }
          contacts = @(@{ profile = @{ name = $name } })
          messages = @(@{
            from = $from
            id   = $msgId
            type = 'text'
            text = @{ body = $body }
          })
        }
      })
    })
  } | ConvertTo-Json -Depth 12 -Compress

  try {
    $r = Invoke-WebRequest -Method Post -Uri "$Base/api/webhook" -ContentType 'application/json' -Body $payload -UseBasicParsing -TimeoutSec 60
    return @{ Ok = ($r.StatusCode -eq 200); Status = $r.StatusCode; Error = $null }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    return @{ Ok = ($code -eq 200); Status = $code; Error = $_.Exception.Message }
  }
}

Write-Host "=== Handset Matrix Prod Run ===" -ForegroundColor Cyan
Write-Host "API: $Base"
Write-Host "Buyer: $BuyerPhone | Staff: $StaffPhone"
Write-Host "Step delay: ${StepDelaySec}s (async webhook processing)"
Write-Host ''

# Pre-flight
try {
  $h = Invoke-RestMethod -Uri "$Base/api/health/live" -TimeoutSec 30
  Record 0 'Pre-flight health' ($h.status -eq 'ok') "live=$($h.status)"
} catch {
  Record 0 'Pre-flight health' $false $_.Exception.Message
}

try {
  $full = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 30
  $dbOk = $full.dependencies.db.status -eq 'ok'
  $aiOk = $full.dependencies.openai.status -eq 'ok'
  Record 0 'Pre-flight DB+OpenAI' ($dbOk -and $aiOk) "db=$($full.dependencies.db.status) openai=$($full.dependencies.openai.status)"
} catch {
  Record 0 'Pre-flight DB+OpenAI' $false $_.Exception.Message
}

# 1 — Brochure
$r1 = Send-Webhook $BuyerPhone 'Please send brochure for Lake Vista project' ('wamid.hm.1.' + [guid]::NewGuid().ToString('N'))
Record 1 'Buyer brochure' $r1.Ok "HTTP $($r1.Status); buyer=$BuyerPhone"
Start-Sleep -Seconds $StepDelaySec

# 2 — Book visit
$r2 = Send-Webhook $BuyerPhone 'Book a visit for Saturday 4pm' ('wamid.hm.2.' + [guid]::NewGuid().ToString('N'))
Record 2 'Buyer book visit' $r2.Ok "HTTP $($r2.Status)"
Start-Sleep -Seconds $StepDelaySec

# 3 — Duplicate book (new message_id, same body)
$r3 = Send-Webhook $BuyerPhone 'Book a visit for Saturday 4pm' ('wamid.hm.3.' + [guid]::NewGuid().ToString('N'))
Record 3 'Buyer idempotent duplicate book' $r3.Ok "HTTP $($r3.Status); DB visit count not verified (no prod DB access)"
Start-Sleep -Seconds $StepDelaySec

# 4 — Reschedule
$r4 = Send-Webhook $BuyerPhone 'Push my appointment to next Sunday' ('wamid.hm.4.' + [guid]::NewGuid().ToString('N'))
Record 4 'Buyer reschedule active visit' $r4.Ok "HTTP $($r4.Status)"
Start-Sleep -Seconds $StepDelaySec

# 5a — State budget
$r5a = Send-Webhook $BuyerPhone 'My budget is 1.2 to 1.5 crore for 3BHK in Whitefield' ('wamid.hm.5a.' + [guid]::NewGuid().ToString('N'))
Start-Sleep -Seconds $StepDelaySec
# 5b — Recall budget
$r5b = Send-Webhook $BuyerPhone "What's my budget preference?" ('wamid.hm.5b.' + [guid]::NewGuid().ToString('N'))
Record 5 'Buyer memory recall' ($r5a.Ok -and $r5b.Ok) "HTTP $($r5a.Status)/$($r5b.Status); lead_memory not verified"
Start-Sleep -Seconds $StepDelaySec

# 6 — Visit status query
$r6 = Send-Webhook $BuyerPhone 'When is my visit?' ('wamid.hm.6.' + [guid]::NewGuid().ToString('N'))
Record 6 'Buyer visit status query' $r6.Ok "HTTP $($r6.Status)"
Start-Sleep -Seconds $StepDelaySec

# 7 — Staff visits today
$r7 = Send-Webhook $StaffPhone 'Visits today' ('wamid.hm.7.' + [guid]::NewGuid().ToString('N')) 'Proof Staff'
Record 7 'Staff visits today' $r7.Ok "HTTP $($r7.Status); staff phone may be synthetic if prod login unavailable"
Start-Sleep -Seconds $StepDelaySec

# 8 — Staff update lead status (needs real lead name — generic)
$r8 = Send-Webhook $StaffPhone 'Update lead Proof Buyer status to visited' ('wamid.hm.8.' + [guid]::NewGuid().ToString('N')) 'Proof Staff'
Record 8 'Staff update lead status' $r8.Ok "HTTP $($r8.Status); action log not verified"
Start-Sleep -Seconds $StepDelaySec

# 9 — LLM kill switch (cannot flip prod env from script)
Record 9 'Staff LLM-off degradation' $false 'BLOCKED: cannot set AGENT_AI_LLM_ENABLED=false on Railway from this runner'

# 10 — Dashboard AI action logs page
try {
  $fe = Invoke-WebRequest -Uri "$Frontend/dashboard/ai-action-logs" -UseBasicParsing -TimeoutSec 30
  $spaOk = $fe.StatusCode -eq 200
  Record 10 'Admin AI action logs page' $spaOk "HTTP $($fe.StatusCode); SPA shell (client route /dashboard/ai-action-logs); logged-in data not verified"
} catch {
  Record 10 'Admin AI action logs page' $false $_.Exception.Message
}

# 11 — Saga inject failure (dev-only)
Record 11 'Saga needs_reconciliation inject' $false 'BLOCKED: dev-only injection; not run on prod tenant'

# 12 — Takeover semantics (documented code behavior; no auth for PATCH takeover)
Record 12 'Takeover then buyer inbound' $false 'BLOCKED: product sign-off #17; code re-enables AI on next buyer message (ensureProspectConversationAiActive)'

Write-Host ''
Write-Host '=== Summary ===' -ForegroundColor Cyan
$pass = @($results | Where-Object { $_.Result -eq 'PASS' }).Count
$fail = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
Write-Host "PASS=$pass FAIL=$fail (webhook HTTP gate only; DB/handset UX not fully verified)"
Write-Host "Buyer test phone: $BuyerPhone"
$results | Format-Table -AutoSize

# Export JSON for doc ingestion
$outPath = Join-Path $PSScriptRoot 'handset-matrix-prod-results.json'
$export = @{
  runAt = (Get-Date).ToUniversalTime().ToString('o')
  base = $Base
  buyerPhone = $BuyerPhone
  staffPhone = $StaffPhone
  pass = $pass
  fail = $fail
  scenarios = $results
}
$export | ConvertTo-Json -Depth 5 | Set-Content -Path $outPath -Encoding UTF8
Write-Host "Results written: $outPath"
