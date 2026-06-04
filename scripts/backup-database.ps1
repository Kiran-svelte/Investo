# Backup Investo Postgres using pg_dump (requires DATABASE_URL env var)
param(
  [string]$OutputDir = 'backups'
)

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
  throw 'Set DATABASE_URL to your Postgres connection string (do not commit this value).'
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  throw 'pg_dump not found. Install PostgreSQL client tools and add to PATH.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) $OutputDir
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$outFile = Join-Path $dir "investo-$stamp.sql"

Write-Host "Backing up to $outFile ..."
& pg_dump $env:DATABASE_URL --no-owner --no-acl -f $outFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit $LASTEXITCODE" }

$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "Backup complete ($sizeMb MB): $outFile"
