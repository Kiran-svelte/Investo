# Full Railway backend deploy from Git: stop active deployments, redeploy, wait for health.
# Uses account/workspace token (GraphQL) or project token ({ projectToken }).
# For local upload instead of git, use scripts/deploy-railway-upload.ps1 (mint project token + railway up from repo root).
param(
  [string]$RailwayToken = $env:RAILWAY_TOKEN,
  [string]$ServiceId = $env:RAILWAY_SERVICE_ID,
  [string]$EnvironmentId = $env:RAILWAY_ENVIRONMENT_ID,
  [int]$MaxWaitMinutes = 15
)

$ErrorActionPreference = 'Stop'
$graphql = 'https://backboard.railway.com/graphql/v2'

if (-not $RailwayToken) {
  throw 'Set RAILWAY_TOKEN (project token from Railway dashboard)'
}

function Invoke-RailwayGql($query, $variables = @{}) {
  $headers = @{
    Authorization = "Bearer $RailwayToken"
    'Content-Type'  = 'application/json'
  }
  $body = @{ query = $query; variables = $variables } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Method Post -Uri $graphql -Headers $headers -Body $body
}

Write-Host 'Resolving Railway project context...'
$projectId = $null
$environmentId = if ($EnvironmentId) { $EnvironmentId } else { $null }

$ctx = Invoke-RailwayGql '{ projectToken { projectId environmentId } }'
if (-not $ctx.errors -and $ctx.data.projectToken) {
  $projectId = $ctx.data.projectToken.projectId
  if (-not $environmentId) { $environmentId = $ctx.data.projectToken.environmentId }
} else {
  # Account/workspace token: list projects and pick Investo with backend services.
  $projectsRes = Invoke-RailwayGql '{ projects { edges { node { id name } } } }'
  if ($projectsRes.errors) {
    throw "Railway token error: $($projectsRes.errors[0].message)"
  }
  $candidates = $projectsRes.data.projects.edges | ForEach-Object { $_.node } | Where-Object { $_.name -match 'investo' }
  foreach ($proj in $candidates) {
    $detail = Invoke-RailwayGql @'
query($projectId: String!) {
  project(id: $projectId) {
    id name
    environments { edges { node { id name } } }
    services { edges { node { id name } } }
  }
}
'@ @{ projectId = $proj.id }
    $services = $detail.data.project.services.edges | ForEach-Object { $_.node }
    if ($services.Count -gt 0) {
      $projectId = $detail.data.project.id
      if (-not $environmentId) {
        $envNode = $detail.data.project.environments.edges | ForEach-Object { $_.node } | Where-Object { $_.name -eq 'production' } | Select-Object -First 1
        $environmentId = $envNode.id
      }
      break
    }
  }
  if (-not $projectId) { throw 'No Railway Investo project with services found for this token' }
}

Write-Host "Project: $projectId Environment: $environmentId"

if (-not $ServiceId) {
  $svcRes = Invoke-RailwayGql @'
query($projectId: String!) {
  project(id: $projectId) {
    services { edges { node { id name } } }
  }
}
'@ @{ projectId = $projectId }
  $services = $svcRes.data.project.services.edges | ForEach-Object { $_.node }
  $backend = $services | Where-Object { $_.name -match 'investo-backend|backend|api' } | Select-Object -First 1
  if (-not $backend) { $backend = $services | Select-Object -First 1 }
  if (-not $backend) { throw 'No Railway service found in project' }
  $ServiceId = $backend.id
  Write-Host "Using service: $($backend.name) ($ServiceId)"
}

Write-Host 'Stopping in-progress deployments...'
$deployQuery = @"
query(`$serviceId: String!, `$environmentId: String!) {
  deployments(input: { serviceId: `$serviceId, environmentId: `$environmentId }, first: 5) {
    edges { node { id status } }
  }
}
"@
$deps = Invoke-RailwayGql $deployQuery @{ serviceId = $ServiceId; environmentId = $environmentId }
foreach ($edge in $deps.data.deployments.edges) {
  $d = $edge.node
  if ($d.status -in @('BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED')) {
    Write-Host "Stopping deployment $($d.id) ($($d.status))"
    Invoke-RailwayGql 'mutation($id: String!) { deploymentStop(id: $id) }' @{ id = $d.id } | Out-Null
  }
}

Write-Host 'Triggering fresh deploy...'
$deployMut = @"
mutation(`$serviceId: String!, `$environmentId: String!) {
  serviceInstanceDeployV2(serviceId: `$serviceId, environmentId: `$environmentId)
}
"@
$deployId = (Invoke-RailwayGql $deployMut @{ serviceId = $ServiceId; environmentId = $environmentId }).data.serviceInstanceDeployV2
Write-Host "Deploy started: $deployId"

$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
do {
  Start-Sleep -Seconds 20
  $statusRes = Invoke-RailwayGql 'query($id: String!) { deployment(id: $id) { status } }' @{ id = $deployId }
  $status = $statusRes.data.deployment.status
  Write-Host "Status: $status"
  if ($status -in @('SUCCESS', 'SLEEPING', 'ACTIVE', 'CRASHED')) { break }
  if ($status -in @('FAILED', 'REMOVED', 'CANCELLED')) { throw "Railway deploy failed: $status" }
} while ((Get-Date) -lt $deadline)

$healthUrl = 'https://investo-backend-production.up.railway.app/api/health/live'
$health = curl.exe -s $healthUrl
Write-Host "Health: $health"
Write-Host "Backend URL: https://investo-backend-production.up.railway.app"

Write-Host 'Railway deploy complete.'
