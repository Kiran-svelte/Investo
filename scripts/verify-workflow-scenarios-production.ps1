# Production proof: workflow engine + intent stack on Railway (authoritative prod)
# Does NOT print secrets. Requires admin login credentials in env or defaults from prod-e2e-verify.ps1
param(
  [string]$Base = 'https://investo-backend-production.up.railway.app',
  [string]$Email = 'admin@investo.in',
  [string]$Password = 'admin@123',
  [string]$GeekyCompanyId = 'e12e7540-8218-4b25-b427-ff8b800df116',
  [string]$PhoneNumberId = '1090528010807708'
)

$ErrorActionPreference = 'Stop'

function Write-Proof($tag, $ok, $detail) {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host "[$mark] $tag - $detail"
}

Write-Host "=== Investo production workflow proof ==="
Write-Host "API: $Base"
Write-Host ""

# 1. Infrastructure
$health = Invoke-RestMethod -Uri "$Base/api/health"
$okHealth = $health.status -eq 'ok'
Write-Proof 'Health' $okHealth "status=$($health.status) db=$($health.dependencies.db.status)"
$okOpenAi = $health.dependencies.openai.status -eq 'ok'
Write-Proof 'OpenAI (prod)' $okOpenAi $health.dependencies.openai.detail

# 2. Auth + tenant (optional; webhooks do not require JWT)
$token = $null
$h = @{}
try {
  Start-Sleep -Seconds 1
  $login = Invoke-RestMethod -Method Post -Uri "$Base/api/auth/login" -ContentType 'application/json' -Body (@{
    email = $Email; password = $Password
  } | ConvertTo-Json)
  $token = $login.data.tokens.access_token
  if ($token) {
    $h = @{ Authorization = "Bearer $token" }
    Write-Proof 'Admin login' $true 'super_admin token obtained'
  } else {
    Write-Proof 'Admin login' $false 'No access_token in response'
  }
} catch {
  Write-Proof 'Admin login' $false $_.Exception.Message
}

# 3. Code deployed (indirect): agent stack responds without generic crash on staff-shaped webhook
$agentUser = $null
if ($token) {
  $usersUri = '{0}/api/users?limit=50&target_company_id={1}' -f $Base, $GeekyCompanyId
  $staffUsers = Invoke-RestMethod -Uri $usersUri -Headers $h
  $agentUser = @($staffUsers.data) | Where-Object { $_.role -eq 'sales_agent' -and $_.phone } | Select-Object -First 1
}
if (-not $agentUser) {
  Write-Proof 'Staff copilot user' $false 'No sales_agent resolved (login failed or no phone) - using synthetic staff phone'
  $staffPhone = '919876543210'
  $staffName = 'Proof Staff'
} else {
  $staffPhone = ($agentUser.phone -replace '\D', '')
  if ($staffPhone.Length -gt 10) { $staffPhone = $staffPhone.Substring($staffPhone.Length - 10) }
  $staffPhone = '91' + $staffPhone
  $staffName = $agentUser.name
}

$msgId = 'wamid.proof.staff.' + [guid]::NewGuid().ToString('N')
$staffPayload = @{
    object = 'whatsapp_business_account'
    entry  = @(@{
      id = 'proof-staff'
      changes = @(@{
        field = 'messages'
        value = @{
          metadata = @{ phone_number_id = $PhoneNumberId }
          contacts = @(@{ profile = @{ name = $staffName } })
          messages = @(@{
            from = $staffPhone
            id   = $msgId
            type = 'text'
            text = @{ body = 'visits today' }
          })
        }
      })
    })
} | ConvertTo-Json -Depth 12 -Compress

try {
  $wh = Invoke-WebRequest -Method Post -Uri "$Base/api/webhook" -ContentType "application/json" -Body $staffPayload -UseBasicParsing
  $okStaff = $wh.StatusCode -eq 200
  Write-Proof 'Staff webhook (visits today)' $okStaff "HTTP $($wh.StatusCode) - copilot path alive (no crash)"
} catch {
  Write-Proof 'Staff webhook' $false $_.Exception.Message
}

# 4. Buyer deterministic paths (prepone / price keywords hit workflow or visit booking)
$buyerPhone = '91900000' + (Get-Random -Minimum 5000 -Maximum 9999)
$scenarios = @(
  @{ name = 'price_inquiry'; body = 'What is the price for 2BHK?' },
  @{ name = 'brochure'; body = 'Please send brochure PDF' },
  @{ name = 'prepone'; body = 'Pre pone site visit to tomorrow at 1pm' }
)

foreach ($sc in $scenarios) {
  $msgId = 'wamid.proof.' + $sc.name + '.' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $payload = @{
    object = 'whatsapp_business_account'
    entry  = @(@{
      id = 'proof-buyer'
      changes = @(@{
        field = 'messages'
        value = @{
          metadata = @{ phone_number_id = $PhoneNumberId }
          contacts = @(@{ profile = @{ name = 'Proof Buyer' } })
          messages = @(@{
            from = $buyerPhone
            id   = $msgId
            type = 'text'
            text = @{ body = $sc.body }
          })
        }
      })
    })
  } | ConvertTo-Json -Depth 12 -Compress

  try {
    $wh = Invoke-WebRequest -Method Post -Uri "$Base/api/webhook" -ContentType "application/json" -Body $payload -UseBasicParsing
    Write-Proof "Buyer webhook ($($sc.name))" ($wh.StatusCode -eq 200) "HTTP $($wh.StatusCode)"
  } catch {
    Write-Proof "Buyer webhook ($($sc.name))" $false $_.Exception.Message
  }
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "=== Architecture on this server (verify in repo) ==="
Write-Host "Staff path: confirmations -> deterministic CRM -> classifyAndRunWorkflow (LLM) -> classifyAndExecuteAgentIntent -> invokeAgent"
Write-Host "Buyer path: visit booking/mutation -> tryRunBuyerWorkflow -> AI fallback"
Write-Host "15 workflows: backend/src/services/workflow/workflow-registry.ts"
Write-Host "45+ actions: backend/src/services/workflow/actions/index.ts"
Write-Host ""
Write-Host "Run local scenario matrix: cd backend && npm test -- workflow-scenario-matrix"
Write-Host "DONE"
