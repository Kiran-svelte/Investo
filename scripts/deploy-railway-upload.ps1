# Prod API project: af15cb2b-b9ff-49cf-979d-a34b7c871359 (d21a6fc9 is not a valid project ID here)
# Deploy backend via `railway up` (local upload) using an account/workspace token.
# Account tokens work with GraphQL but not directly with the CLI. This script mints a
# short-lived project token, then uploads from the monorepo root so `backend/railway.toml`
# resolves (service rootDirectory is `backend`).
param(
  [string]$AccountToken = $env:RAILWAY_ACCOUNT_TOKEN,
  [string]$ProjectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359',
  [string]$EnvironmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e',
  [string]$ServiceName = 'investo-backend',
  [string]$Message = 'local upload deploy'
)

$ErrorActionPreference = 'Stop'
$graphql = 'https://backboard.railway.com/graphql/v2'
$repoRoot = Split-Path $PSScriptRoot -Parent

if (-not $AccountToken) {
  $AccountToken = $env:RAILWAY_TOKEN
}
if (-not $AccountToken) {
  throw 'Set RAILWAY_ACCOUNT_TOKEN (or RAILWAY_TOKEN) to your Railway account/workspace API token'
}

function Invoke-RailwayGql($token, $query, $variables = @{}) {
  $headers = @{
    Authorization = "Bearer $token"
    'Content-Type'  = 'application/json'
  }
  $body = @{ query = $query; variables = $variables } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Method Post -Uri $graphql -Headers $headers -Body $body
}

Write-Host 'Minting ephemeral project token for CLI upload...'
$createRes = Invoke-RailwayGql $AccountToken @'
mutation($input: ProjectTokenCreateInput!) {
  projectTokenCreate(input: $input)
}
'@ @{
  input = @{
    projectId     = $ProjectId
    environmentId = $EnvironmentId
    name          = "cli-upload-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  }
}
if ($createRes.errors) {
  throw "projectTokenCreate failed: $($createRes.errors[0].message)"
}
$projectToken = $createRes.data.projectTokenCreate
Write-Host 'Project token minted.'

$env:RAILWAY_TOKEN = $projectToken
Push-Location $repoRoot
try {
  Write-Host "Uploading from $repoRoot (must include backend/railway.toml)..."
  railway up --ci `
    -p $ProjectId `
    -e production `
    -s $ServiceName `
    -m $Message
  if ($LASTEXITCODE -ne 0) { throw "railway up failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
  Remove-Item Env:RAILWAY_TOKEN -ErrorAction SilentlyContinue
}

$health = curl.exe -s 'https://investo-backend-production.up.railway.app/api/health/live'
Write-Host "Health: $health"
Write-Host 'Railway upload deploy complete.'
