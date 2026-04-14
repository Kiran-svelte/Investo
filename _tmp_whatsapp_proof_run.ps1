$ErrorActionPreference='Stop'
$evidenceDir = 'D:\Investo\test-results\whatsapp-prod-proof-20260413-064709'

function Invoke-CurlCapture {
    param($Name, $Method, $Url, $Headers, $Body)
    $outFile = Join-Path $evidenceDir ($Name + '.txt')
    $curlArgs = @('-sS', '-i', '-X', $Method, $Url)
    if ($null -ne $Headers) {
        foreach ($k in $Headers.Keys) {
            $curlArgs += @('-H', ($k + ': ' + $Headers[$k]))
        }
    }
    if ($null -ne $Body -and $Body -ne '') {
        $curlArgs += @('--data', $Body)
    }
    & curl.exe @curlArgs 2>&1 | Out-File -FilePath $outFile -Encoding utf8
    return $outFile
}

$files = @()
$files += Invoke-CurlCapture -Name '01_health' -Method 'GET' -Url 'https://investo-backend-v2.onrender.com/api/health'
$files += Invoke-CurlCapture -Name '02_meta_verify' -Method 'GET' -Url 'https://investo-backend-v2.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=investo_webhook_verify_token&hub.challenge=test123'
$files += Invoke-CurlCapture -Name '03_greenapi_no_auth' -Method 'POST' -Url 'https://investo-backend-v2.onrender.com/api/greenapi/webhook' -Headers @{ 'Content-Type'='application/json' } -Body '{}'
$files += Invoke-CurlCapture -Name '04_greenapi_dummy_bearer' -Method 'POST' -Url 'https://investo-backend-v2.onrender.com/api/greenapi/webhook' -Headers @{ 'Content-Type'='application/json'; 'Authorization'='Bearer dummy' } -Body '{}'

function Parse-CurlI {
    param($Path)
    $text = Get-Content -Raw -Path $Path -Encoding utf8
    $statusMatches = [regex]::Matches($text, '(?m)^HTTP/\S+\s+(?<code>\d{3})')
    $code = $null
    if ($statusMatches.Count -gt 0) {
        $code = [int]$statusMatches[$statusMatches.Count-1].Groups['code'].Value
    }
    $parts = [regex]::Split($text, '\r?\n\r?\n', 2)
    $body = if ($parts.Count -ge 2) { $parts[1] } else { '' }
    $bodyPreview = if ($body.Length -gt 200) { $body.Substring(0, 200) } else { $body }
    [pscustomobject]@{ file=(Split-Path -Leaf $Path); status=$code; bodyPreview=$bodyPreview }
}

$results = $files | ForEach-Object { Parse-CurlI $_.ToString() }
$summary = [pscustomobject]@{
    timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    requests = $results
}
$summary | ConvertTo-Json -Depth 6 | Out-File -FilePath (Join-Path $evidenceDir 'summary.json') -Encoding utf8
$summary | ConvertTo-Json -Depth 6
