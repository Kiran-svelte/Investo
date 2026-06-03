# Redeploy Investo backend to Render (full deploy, not just trigger)
# Requires: $env:RENDER_API_KEY and git push access to Kiran-svelte/Investo

param(
  [string]$ServiceId = 'srv-d79itik50q8c73fjqi7g',
  [string]$BackendUrl = 'https://investo-backend-v2.onrender.com'
)

$ErrorActionPreference = 'Stop'

if (-not $env:RENDER_API_KEY) {
  throw 'Set RENDER_API_KEY (Render Dashboard -> Account Settings -> API Keys)'
}

Write-Host 'Triggering Render deploy...'
$headers = @{
  Authorization = "Bearer $($env:RENDER_API_KEY)"
  'Content-Type'  = 'application/json'
}
$deploy = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$ServiceId/deploys" -Headers $headers -Body '{}'
$deployId = $deploy.id
Write-Host "Deploy started: $deployId"

for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 20
  $status = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/deploys/$deployId" -Headers $headers
  Write-Host "Status: $($status.status)"
  if ($status.status -in @('live', 'deactivated')) { break }
  if ($status.status -in @('build_failed', 'update_failed', 'canceled')) {
    throw "Deploy failed: $($status.status)"
  }
}

$health = curl.exe -s "$BackendUrl/api/health"
Write-Host "Health: $health"
if ($health -notmatch '^\{') {
  throw 'Health endpoint did not return JSON — backend may still be on stale stub'
}

Write-Host 'Production redeploy verified.'
