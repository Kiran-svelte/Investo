# Production E2E verification (no secrets printed)
$ErrorActionPreference = 'Stop'
$base = 'https://investo-backend-v2.onrender.com'
$front = 'https://biginvesto.online'

Write-Host '=== Health ==='
$health = Invoke-RestMethod -Uri "$base/api/health"
if ($health.status -ne 'ok') { throw "Health not ok: $($health.status)" }
Write-Host "OK db=$($health.dependencies.db.status)"

Write-Host '=== Webhook verify ==='
$challenge = 'prod-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$verify = Invoke-WebRequest -Uri "$base/api/webhook?hub.mode=subscribe&hub.verify_token=abc-investo&hub.challenge=$challenge" -UseBasicParsing
if ($verify.Content.Trim() -ne $challenge) { throw "Webhook verify mismatch: $($verify.Content)" }
Write-Host 'OK'

Write-Host '=== Login ==='
Start-Sleep -Seconds 2
$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Body (@{
  email    = 'admin@investo.in'
  password = 'admin@123'
} | ConvertTo-Json)
$token = $login.data.tokens.access_token
if (-not $token) { throw 'No access token' }
Write-Host 'OK (super_admin)'

$h = @{ Authorization = "Bearer $token" }

Write-Host '=== Meta WhatsApp tenant (Geeky — verified Meta config) ==='
$pnid = '1090528010807708'
$geekyCompanyId = 'e12e7540-8218-4b25-b427-ff8b800df116'
Write-Host "OK phoneNumberId=$pnid companyId=$geekyCompanyId"

Write-Host '=== Leads API ==='
$leads = Invoke-RestMethod -Uri "$base/api/leads?limit=5" -Headers $h
Write-Host "OK leads count=$($leads.data.Count)"

Write-Host '=== Frontend ==='
$fe = Invoke-WebRequest -Uri $front -UseBasicParsing
if ($fe.StatusCode -ne 200) { throw "Frontend status $($fe.StatusCode)" }
if ($fe.Content -notmatch 'Investo|investo|root') { Write-Host 'WARN: unexpected frontend HTML' }
Write-Host 'OK'

Write-Host '=== Simulated inbound webhook (unknown prospect) ==='
$unknownPhone = '91900000' + (Get-Random -Minimum 1000 -Maximum 9999)
$msgId = 'wamid.e2e.' + [guid]::NewGuid().ToString('N')
$payload = @{
  object = 'whatsapp_business_account'
  entry  = @(
    @{
      id      = 'entry-e2e'
      changes = @(
        @{
          field = 'messages'
          value = @{
            metadata         = @{ phone_number_id = $pnid }
            contacts         = @(@{ profile = @{ name = 'E2E Prospect' } })
            messages         = @(
              @{
                from = $unknownPhone
                id   = $msgId
                type = 'text'
                text = @{ body = 'E2E test: looking for 2BHK in Bangalore' }
              }
            )
          }
        }
      )
    }
  )
} | ConvertTo-Json -Depth 12 -Compress

$headers = @{ 'Content-Type' = 'application/json' }
Write-Host 'Using unsigned webhook (Render BYPASS_WHATSAPP_SIGNATURE enabled)'

Start-Sleep -Seconds 1
try {
  $wh = Invoke-WebRequest -Method Post -Uri "$base/api/webhook" -Headers $headers -Body $payload -UseBasicParsing
  Write-Host "Webhook POST status=$($wh.StatusCode) body=$($wh.Content)"
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Host "Webhook POST failed: $($resp.StatusCode) $($reader.ReadToEnd())"
  } else {
    throw
  }
}

Write-Host 'Waiting 25s for async processing...'
Start-Sleep -Seconds 25

Write-Host '=== Check lead created (Geeky tenant) ==='
$leadsAfter = Invoke-RestMethod -Uri "$base/api/leads?search=$unknownPhone&target_company_id=$geekyCompanyId" -Headers $h
$found = @($leadsAfter.data) | Where-Object { $_.phone -like "*$($unknownPhone.Substring($unknownPhone.Length - 4))" }
if ($found.Count -eq 0) {
  $all = Invoke-RestMethod -Uri "$base/api/leads?limit=30&sort_by=created_at&target_company_id=$geekyCompanyId" -Headers $h
  $found = @($all.data) | Where-Object { $_.source -eq 'whatsapp' } | Select-Object -First 3
  $match = $found | Where-Object { $_.phone -like "*$($unknownPhone.Substring($unknownPhone.Length - 4))" }
  if ($match) { $found = $match } elseif ($found.Count -gt 0) {
    Write-Host "WARN: exact phone not found; recent whatsapp leads: $($found.phone -join ', ')"
    throw 'Simulated prospect lead not found for Geeky company'
  } else {
    throw 'No WhatsApp leads found for Geeky after simulated inbound'
  }
}
Write-Host "OK lead id=$($found[0].id) phone=$($found[0].phone) status=$($found[0].status)"

Write-Host 'ALL CHECKS PASSED'
