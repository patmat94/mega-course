param([string]$BodyFile, [string]$Url = 'https://hq.mega.dev/challenges/where-the-story-begins/api')
# POSTs the exact bytes of $BodyFile as JSON and appends request + response to log.txt
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'log.txt'
$body = [System.IO.File]::ReadAllText((Resolve-Path $BodyFile))
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
try {
  $r = Invoke-WebRequest -Uri $Url -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing
  $status = [int]$r.StatusCode; $resp = $r.Content
} catch {
  $status = [int]$_.Exception.Response.StatusCode
  $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  $resp = $sr.ReadToEnd()
}
$entry = "===== $ts POST $Url`n--- request body ---`n$body`n--- response $status ---`n$resp`n`n"
[System.IO.File]::AppendAllText($log, $entry, [System.Text.Encoding]::UTF8)
"STATUS $status"
$resp
