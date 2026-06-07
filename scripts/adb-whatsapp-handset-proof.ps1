# Physical handset proof via ADB - sends WhatsApp messages and captures replies from UI dump.
param(
  [string]$Adb = $env:ADB,
  [string]$DeviceSerial = $env:ADB_DEVICE_SERIAL,
  [string]$BusinessPhone = $(if ($env:PALM_WHATSAPP_PHONE) { $env:PALM_WHATSAPP_PHONE } else { '15551642552' }),
  [int]$ReplyWaitSec = 22
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script:ADB_STDERR_NONFATAL = $true

if (-not $Adb) {
  $default = Join-Path $env:USERPROFILE 'Downloads\platform-tools-latest-windows (1)\platform-tools\adb.exe'
  if (Test-Path $default) { $Adb = $default }
}
if (-not (Test-Path $Adb)) { throw 'adb not found. Set env:ADB to adb.exe path.' }

function Invoke-Adb {
  param([string]$Serial, [string[]]$CmdArgs)
  $all = @()
  if ($Serial) { $all += '-s', $Serial }
  $all += $CmdArgs
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $Adb @all 2>&1
  $ErrorActionPreference = $prev
  @($out | ForEach-Object { "$_" })
}

function Get-Devices {
  $lines = Invoke-Adb -Serial '' -CmdArgs @('devices')
  $out = @()
  foreach ($line in $lines) {
    if ($line -match '^(\S+)\s+(device|unauthorized)\b') {
      $out += [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
    }
  }
  return $out
}

function Resolve-BusinessPhone {
  if ($BusinessPhone) { return ($BusinessPhone -replace '\D','') }
  Push-Location (Join-Path $Root 'backend')
  try {
    $json = npx tsx scripts/resolve-palm-whatsapp.mjs 2>$null | Out-String
  } finally {
    Pop-Location
  }
  $obj = $json | ConvertFrom-Json
  $phone = ($obj.whatsappPhone -replace '\D','')
  if (-not $phone) { throw 'Could not resolve Palm whatsappPhone from prod DB' }
  return $phone
}

function Send-WhatsAppMessage {
  param([string]$Serial, [string]$Package, [string]$BusinessDigits, [string]$Text)
  $encoded = [uri]::EscapeDataString($Text)
  $uri = "https://wa.me/$BusinessDigits`?text=$encoded"
  Invoke-Adb -Serial $Serial -CmdArgs @('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', $uri, $Package) | Out-Null
  Start-Sleep -Seconds 4
  Invoke-Adb -Serial $Serial -CmdArgs @('shell', 'input', 'keyevent', '66') | Out-Null
}

function Get-LastMessagesFromDump {
  param([string]$Serial)
  $remote = '/sdcard/window_dump.xml'
  Invoke-Adb -Serial $Serial -CmdArgs @('shell', 'uiautomator', 'dump', $remote) | Out-Null
  $local = Join-Path $env:TEMP "wa-dump-$Serial.xml"
  if (Test-Path $local) { Remove-Item $local -Force }
  Invoke-Adb -Serial $Serial -CmdArgs @('pull', $remote, $local) | Out-Null
  if (-not (Test-Path $local)) { return @() }
  [xml]$xml = Get-Content $local -Raw
  $nodes = $xml.SelectNodes('//node[@class="android.widget.TextView"]') | ForEach-Object { $_.text }
  return @($nodes | Where-Object { $_ -and $_.Length -gt 2 })
}

Write-Host ''
Write-Host '=== ADB WhatsApp Handset Proof ===' -ForegroundColor Cyan
$devices = Get-Devices
if ($devices.Count -eq 0) { throw 'No adb devices. Plug in phone and enable USB debugging.' }

Write-Host 'Devices:'
$devices | ForEach-Object { Write-Host "  $($_.Serial)  $($_.State)" }

$unauth = @($devices | Where-Object { $_.State -eq 'unauthorized' })
if ($unauth.Count -gt 0) {
  $ids = ($unauth | ForEach-Object { $_.Serial }) -join ', '
  throw "Unauthorized: $ids. Unlock phone and tap Allow USB debugging."
}

if (-not $DeviceSerial) { $DeviceSerial = $devices[0].Serial }

$biz = Resolve-BusinessPhone
Write-Host "Palm business WhatsApp: +$biz"
Write-Host "Device: $DeviceSerial (staff=com.whatsapp, buyer=com.whatsapp.w4b)"
Write-Host ''

$results = @()
$timestamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'

function Test-Handset {
  param([string]$Role, [string]$Serial, [string]$Package, [string[]]$Messages)
  foreach ($msg in $Messages) {
    Write-Host "[$Role] SEND: $msg"
    Send-WhatsAppMessage -Serial $Serial -Package $Package -BusinessDigits $biz -Text $msg
    Write-Host "[$Role] waiting ${ReplyWaitSec}s for AI reply..."
    Start-Sleep -Seconds $ReplyWaitSec
    $dump = Get-LastMessagesFromDump -Serial $Serial
    $tail = ($dump | Select-Object -Last 10) -join ' | '
    $pass = $tail -match 'visit|lead|help|Welcome|Palm|scheduled|budget|brochure|Sorry|agent|matching|saved'
    $color = if ($pass) { 'Green' } else { 'Red' }
    Write-Host "[$Role] UI tail: $tail" -ForegroundColor $color
    $results += [pscustomobject]@{
      role = $Role; serial = $Serial; sent = $msg; pass = [bool]$pass; uiTail = $tail; at = $timestamp
    }
    Start-Sleep -Seconds 4
  }
}

Test-Handset -Role 'staff' -Serial $DeviceSerial -Package 'com.whatsapp' -Messages @('visits today', 'new leads today', 'help')
Test-Handset -Role 'buyer' -Serial $DeviceSerial -Package 'com.whatsapp.w4b' -Messages @('Hi', 'My budget is 1.2 crore in Bangalore 3BHK', 'When is my visit?')

$outPath = Join-Path $Root 'scripts\adb-handset-proof-results.json'
$results | ConvertTo-Json -Depth 4 | Set-Content $outPath -Encoding utf8
$passed = @($results | Where-Object { $_.pass }).Count
$total = $results.Count
Write-Host ''
Write-Host "=== Done: $passed/$total heuristic pass ===" -ForegroundColor Green
Write-Host "Results: $outPath"
