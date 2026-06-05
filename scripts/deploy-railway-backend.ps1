# Full Railway backend deploy: stop active deployments, redeploy, wait for health.
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
$ctx = Invoke-RailwayGql '{ projectToken { projectId environmentId } }'
if ($ctx.errors) {
  throw "Railway token error: $($ctx.errors[0].message)"
}
$projectId = $ctx.data.projectToken.projectId
$environmentId = if ($EnvironmentId) { $EnvironmentId } else { $ctx.data.projectToken.environmentId }
Write-Host "Project: $projectId Environment: $environmentId"

if (-not $ServiceId) {
  $svcQuery = @"
query(`$projectId: String!) {
  project(id: `$projectId) {
    services { edges { node { id name } } }
  }
}
"@
  $svcRes = Invoke-RailwayGql $svcQuery @{ projectId = $projectId }
  $services = $svcRes.data.project.services.edges | ForEach-Object { $_.node }
  $backend = $services | Where-Object { $_.name -match 'investo|backend|api' } | Select-Object -First 1
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

$domainQuery = @"
query(`$serviceId: String!, `$environmentId: String!) {
  service(id: `$serviceId) {
    serviceDomains(environmentId: `$environmentId) { domain }
  }
}
"@
$domainRes = Invoke-RailwayGql $domainQuery @{ serviceId = $ServiceId; environmentId = $environmentId }
$domain = $domainRes.data.service.serviceDomains[0].domain
if ($domain) {
  $health = curl.exe -s "https://$domain/api/health/live"
  Write-Host "Health: $health"
  Write-Host "Backend URL: https://$domain"
}

Write-Host 'Railway deploy complete.'
