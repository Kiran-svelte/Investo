$ErrorActionPreference = "Stop"
$base = "https://frontend-jn7k9msdy-traderlighter11-7085s-projects.vercel.app/"
$debug = & vercel curl / --deployment $base --debug 2>&1 | Out-String
$regex = [regex]::new("x-vercel-protection-bypass:\s*([^\s\r\n]+)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$m = $regex.Match($debug)
if (!$m.Success) { throw "Could not extract bypass token from debug output" }
$token = $m.Groups[1].Value
$u = ($base.TrimEnd("/") + "/?x-vercel-set-bypass-cookie=true")
$hdrLines = & curl.exe -sS -D - -o NUL -H "x-vercel-protection-bypass: $token" -H "Accept: text/html" $u
$lines = $hdrLines -split "\r?\n"
$statusMatches = $lines | Select-String -Pattern "^HTTP/\\S+\\s+(\\d{3})" | ForEach-Object { $_.Matches[0].Groups[1].Value }
$finalStatus = if ($statusMatches.Count) { $statusMatches[-1] } else { $null }
$cookieNames = $lines | Where-Object { $_ -match "^(?i)Set-Cookie:" } | ForEach-Object { ($_ -replace "^(?i)Set-Cookie:\s*","") } | ForEach-Object { ($_ -split ";")[0] } | ForEach-Object { ($_ -split "=")[0] } | Sort-Object -Unique
[pscustomobject]@{ url=$u; finalStatus=$finalStatus; cookieNames=$cookieNames; tokenLength=$token.Length } | ConvertTo-Json -Depth 4
