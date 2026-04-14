$ErrorActionPreference = "Stop"
$base = "https://frontend-jn7k9msdy-traderlighter11-7085s-projects.vercel.app/"
$debug = & vercel curl / --deployment $base --debug 2>&1 | Out-String
$regex = [regex]::new("x-vercel-protection-bypass:\s*([^\s\r\n]+)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$m = $regex.Match($debug)
if (!$m.Success) { throw "Could not extract bypass token from debug output" }
$token = $m.Groups[1].Value
$u = ($base.TrimEnd("/") + "/?x-vercel-set-bypass-cookie=true")
$hdrTemp = New-TemporaryFile
# Force curl.exe to use IPv4 to avoid potential network variations
& curl.exe -sS -D $hdrTemp.FullName -o NUL -4 -H "x-vercel-protection-bypass: $token" -H "Accept: text/html" $u
$hdrLines = Get-Content -Path $hdrTemp.FullName
$statusMatches = $hdrLines | Select-String -Pattern "^HTTP/\S+\s+(\d{3})" | ForEach-Object { $_.Matches[0].Groups[1].Value }
$finalStatus = if ($statusMatches.Count) { $statusMatches[-1] } else { $null }
$cookieHeaders = $hdrLines | Where-Object { $_ -match "^(?i)Set-Cookie:" }
$cookieNames = $cookieHeaders | ForEach-Object { ($_ -replace "^(?i)Set-Cookie:\s*","").Split(";")[0].Trim().Split("=")[0] } | Sort-Object -Unique
[pscustomobject]@{ url=$u; finalStatus=$finalStatus; cookieNames=$cookieNames; tokenLength=$token.Length; allHeaders=$hdrLines } | ConvertTo-Json -Depth 4
Remove-Item $hdrTemp.FullName
