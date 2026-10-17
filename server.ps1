<#
  Remnant World Analyzer - local server.

  Serves the page at http://localhost:8765 (and to other PCs on your home network), reads the
  saves straight from the game folder and lets the page know when the game saves.
  Nothing is installed and nothing is sent to the internet.

  Normal use: double-click Start.bat.
  Options:  Start.bat -SaveDir "D:\other\folder" -Port 9000 -NoBrowser
#>
param(
  [string]$SaveDir = (Join-Path $env:LOCALAPPDATA 'Remnant\Saved\SaveGames'),
  [int]$Port = 8765,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($PSScriptRoot)
$SaveFilePattern = '^(profile|save_\d+)\.(sav|bak)$'
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.xml' = 'application/xml; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}

# Listens on the whole network so other PCs at home can open the page. Windows only allows that
# after a one-time permission (see the message printed below); until then it serves this PC only.
function Start-Listener {
  foreach ($name in '+', 'localhost') {
    for ($p = $Port; $p -lt $Port + 10; $p++) {
      $l = [System.Net.HttpListener]::new()
      $l.Prefixes.Add("http://${name}:$p/")
      try { $l.Start(); return @{ Listener = $l; Port = $p; Lan = ($name -eq '+') } } catch { $l.Close() }
    }
  }
  throw "No free port between $Port and $($Port + 9)."
}

# This PC's addresses on the home network (Wi-Fi / Ethernet).
function Get-LanAddresses {
  try {
    @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
      $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|VirtualBox|VMware'
    } | ForEach-Object { $_.IPAddress })
  } catch {
    @([Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('127.') } | ForEach-Object { $_.ToString() })
  }
}

function Send($ctx, [int]$status, [string]$type, [byte[]]$bytes) {
  $res = $ctx.Response
  $res.StatusCode = $status
  $res.ContentType = $type
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Close()
}
function Send-Text($ctx, [int]$status, [string]$text) { Send $ctx $status 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($text)) }
function Send-Json($ctx, $obj) { Send $ctx 200 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 5 -Compress))) }

function Get-Listing {
  $found = Test-Path -LiteralPath $SaveDir -PathType Container
  $files = @()
  if ($found) {
    $files = @(Get-ChildItem -LiteralPath $SaveDir -File | Where-Object { $_.Name -match $SaveFilePattern } | ForEach-Object {
      [ordered]@{
        name     = $_.Name.ToLower()
        size     = $_.Length
        modified = [long]($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds
      }
    })
  }
  [ordered]@{ dir = $SaveDir; found = $found; files = $files }
}

# The game may be writing the file right now: open it shared and retry a few times.
function Read-Shared([string]$path) {
  for ($try = 0; $try -lt 6; $try++) {
    try {
      $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
      try {
        $ms = New-Object IO.MemoryStream
        $fs.CopyTo($ms)
        return , $ms.ToArray()
      } finally { $fs.Dispose() }
    } catch { Start-Sleep -Milliseconds 300 }
  }
  throw "Could not read $path"
}

# A copy of the whole save folder, next to it: SaveGames_backup_<yyyyMMdd_HHmmss>. Each file is read
# shared (the game may be writing), so a backup works with the game open too.
function Backup-Saves([string]$suffix = '') {
  $backup = Join-Path (Split-Path $SaveDir -Parent) ((Split-Path $SaveDir -Leaf) + '_backup_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + $suffix)
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Get-ChildItem -LiteralPath $SaveDir -File | ForEach-Object { [IO.File]::WriteAllBytes((Join-Path $backup $_.Name), (Read-Shared $_.FullName)) }
  $backup
}
# The backups next to the save folder, newest first. The copies a restore makes of what it replaced
# (…_before_restore) are kept but never offered as "the last backup".
function Get-Backups {
  $pattern = '^' + [regex]::Escape((Split-Path $SaveDir -Leaf)) + '_backup_(\d{8})_(\d{6})$'
  @(Get-ChildItem -LiteralPath (Split-Path $SaveDir -Parent) -Directory | Where-Object { $_.Name -match $pattern } |
    Sort-Object Name -Descending | ForEach-Object {
      $m = [regex]::Match($_.Name, $pattern)
      [ordered]@{ name = $_.Name; path = $_.FullName; when = [datetime]::ParseExact($m.Groups[1].Value + $m.Groups[2].Value, 'yyyyMMddHHmmss', $null).ToString('yyyy-MM-dd HH:mm:ss'); files = @(Get-ChildItem -LiteralPath $_.FullName -File).Count }
    })
}
function Test-GameRunning { [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Remnant' }) }

function Handle($ctx) {
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

  if ($path -eq '/api/saves') { return Send-Json $ctx (Get-Listing) }

  if ($path -eq '/api/file') {
    $name = [string]$ctx.Request.QueryString['name']
    if ($name -notmatch $SaveFilePattern) { return Send-Text $ctx 400 'invalid file name' }
    $full = Join-Path $SaveDir $name
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return Send-Text $ctx 404 'file not found' }
    return Send $ctx 200 'application/octet-stream' (Read-Shared $full)
  }

  # Save editor: Backup copies the whole save folder to SaveGames_backup_<date_time> next to it.
  if ($path -eq '/api/backup') {
    if ($ctx.Request.HttpMethod -ne 'POST') { return Send-Text $ctx 405 'POST only' }
    if (-not $ctx.Request.IsLocal) { return Send-Text $ctx 403 'Backups only work on the PC that runs Start.bat. Use "Download" instead.' }
    $origin = [string]$ctx.Request.Headers['Origin']
    if ($origin -and $origin -ne "http://$($ctx.Request.Url.Authority)") { return Send-Text $ctx 403 'Not allowed from another site.' }
    if (-not (Test-Path -LiteralPath $SaveDir -PathType Container)) { return Send-Text $ctx 404 'Save folder not found.' }
    $backup = Backup-Saves
    Write-Host "  Backup: $backup" -ForegroundColor Green
    return Send-Json $ctx ([ordered]@{ ok = $true; backup = $backup })
  }

  # Save editor: the backups that exist (newest first), for the Restore button.
  if ($path -eq '/api/backups') { return Send-Json $ctx ([ordered]@{ backups = @(Get-Backups) }) }

  # Save editor: Restore puts the newest backup back (game closed only). What it replaces is copied first.
  if ($path -eq '/api/restore') {
    if ($ctx.Request.HttpMethod -ne 'POST') { return Send-Text $ctx 405 'POST only' }
    if (-not $ctx.Request.IsLocal) { return Send-Text $ctx 403 'Restoring only works on the PC that runs Start.bat.' }
    $origin = [string]$ctx.Request.Headers['Origin']
    if ($origin -and $origin -ne "http://$($ctx.Request.Url.Authority)") { return Send-Text $ctx 403 'Not allowed from another site.' }
    if (Test-GameRunning) { return Send-Text $ctx 409 'Remnant is running. Close the game first: it would write over the restored save.' }
    $latest = @(Get-Backups)[0]
    if (-not $latest) { return Send-Text $ctx 404 'There is no backup to restore.' }
    if ([string]$ctx.Request.Headers['X-Backup'] -ne $latest.name) { return Send-Text $ctx 409 'The last backup changed since the page showed it. Wait for the page to update and try again.' }
    $before = Backup-Saves '_before_restore'
    Get-ChildItem -LiteralPath $latest.path -File | ForEach-Object { [IO.File]::WriteAllBytes((Join-Path $SaveDir $_.Name), [IO.File]::ReadAllBytes($_.FullName)) }
    Write-Host "  Restored $($latest.name) (what it replaced: $before)" -ForegroundColor Green
    return Send-Json $ctx ([ordered]@{ ok = $true; restored = $latest.name; when = $latest.when; before = $before })
  }

  # Save editor: writes an edited profile.sav back to the game folder. Only from this PC, only with the
  # game closed, only if the file is still the one the page edited, and after copying the whole folder.
  if ($path -eq '/api/save') {
    if ($ctx.Request.HttpMethod -ne 'POST') { return Send-Text $ctx 405 'POST only' }
    if (-not $ctx.Request.IsLocal) { return Send-Text $ctx 403 'Saving only works on the PC that runs Start.bat. Use "Download" instead.' }
    $origin = [string]$ctx.Request.Headers['Origin']
    if ($origin -and $origin -ne "http://$($ctx.Request.Url.Authority)") { return Send-Text $ctx 403 'Not allowed from another site.' }
    $name = [string]$ctx.Request.QueryString['name']
    if ($name -ne 'profile.sav') { return Send-Text $ctx 400 'Only profile.sav can be saved.' }
    if (Test-GameRunning) {
      return Send-Text $ctx 409 'Remnant is running. Close the game first: it rewrites profile.sav when it saves and when it quits.'
    }
    $full = Join-Path $SaveDir $name
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return Send-Text $ctx 404 'profile.sav not found in the save folder.' }
    $current = Read-Shared $full
    $base = ([string]$ctx.Request.Headers['X-Base-Crc']).ToLower()
    if ($base -ne [BitConverter]::ToUInt32($current, 0).ToString('x8')) {
      return Send-Text $ctx 409 'profile.sav changed since the page read it (the game saved). Wait for the page to update and save again.'
    }
    $ms = New-Object IO.MemoryStream
    $ctx.Request.InputStream.CopyTo($ms)
    $body = $ms.ToArray()
    if ($body.Length -lt 8 -or [BitConverter]::ToUInt32($body, 4) -ne $body.Length) { return Send-Text $ctx 400 'That is not a valid profile.sav.' }
    $backup = Backup-Saves
    [IO.File]::WriteAllBytes($full, $body)
    Write-Host "  Saved edited profile.sav (backup: $backup)" -ForegroundColor Green
    return Send-Json $ctx ([ordered]@{ ok = $true; backup = $backup })
  }

  $rel = $path.TrimStart('/')
  if ($rel -eq '') { $rel = 'index.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
  $ext = [IO.Path]::GetExtension($full).ToLower()
  if (-not $full.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      -not $Mime.ContainsKey($ext) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
    return Send-Text $ctx 404 'not found'
  }
  Send $ctx 200 $Mime[$ext] ([IO.File]::ReadAllBytes($full))
}

$server = Start-Listener
$listener = $server.Listener
$url = "http://localhost:$($server.Port)/"

$Host.UI.RawUI.WindowTitle = "Remnant World Analyzer - $url"
Write-Host ''
Write-Host '  Remnant World Analyzer' -ForegroundColor Yellow
Write-Host "  Page:    $url"
if ($server.Lan) {
  foreach ($ip in (Get-LanAddresses)) { Write-Host "  Other PCs on your network:  http://${ip}:$($server.Port)/" -ForegroundColor Cyan }
} else {
  Write-Host '  Other PCs on your network can''t open it yet. Once, in PowerShell run as administrator:' -ForegroundColor DarkYellow
  Write-Host "    netsh http add urlacl url=http://+:$Port/ ""sddl=D:(A;;GX;;;WD)"""
  Write-Host "    netsh advfirewall firewall add rule name=""Remnant World Analyzer"" dir=in action=allow protocol=TCP localport=$Port profile=private"
  Write-Host '  then close this window and open Start.bat again.'
}
if (Test-Path -LiteralPath $SaveDir -PathType Container) {
  Write-Host "  Saves:   $SaveDir" -ForegroundColor Green
} else {
  Write-Host "  Saves:   $SaveDir  (FOLDER NOT FOUND)" -ForegroundColor Red
  Write-Host '           Run:  Start.bat -SaveDir "C:\path\to\folder"'
}
Write-Host ''
Write-Host '  Keep this window open while using the page. To quit: close the window or press Ctrl+C.'
Write-Host ''

if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    # Wait in short slices so Ctrl+C is handled promptly.
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(500)) { }
    $ctx = $task.GetAwaiter().GetResult()
    try { Handle $ctx }
    catch {
      Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
      try { Send-Text $ctx 500 $_.Exception.Message } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
