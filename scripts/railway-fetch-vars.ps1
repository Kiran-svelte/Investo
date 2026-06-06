# Fetch Railway service variables to a local JSON file (gitignored). Does not print secret values.
param(
  [string]$AccountToken = '2a351ccb-820e-485d-94a5-69f79b75ea7c',
  [string]$ProjectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359',
  [string]$EnvironmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e',
  [string]$ServiceId = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7',
  [string]$OutFile = (Join-Path $PSScriptRoot '.railway-prod-vars.json')
)

$ErrorActionPreference = 'Stop'
$gql = 'https://backboard.railway.com/graphql/v2'
$headers = @{ Authorization = "Bearer $AccountToken"; 'Content-Type' = 'application/json' }
$q = 'query($projectId:String!,$environmentId:String!,$serviceId:String!){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }'
$body = @{ query = $q; variables = @{ projectId = $ProjectId; environmentId = $EnvironmentId; serviceId = $ServiceId } } | ConvertTo-Json -Compress
$r = Invoke-RestMethod -Method Post -Uri $gql -Headers $headers -Body $body
if ($r.errors) { throw $r.errors[0].message }
$json = $r.data.variables | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $($r.data.variables.PSObject.Properties.Name.Count) variables to $OutFile"
