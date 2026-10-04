<#
  Remnant World Analyzer - local server.

  Serves the page at http://localhost:8765, reads the saves straight from the game folder
  and lets the page know when the game saves. Nothing is installed and nothing leaves your PC.

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

function Start-Listener {
  for ($p = $Port; $p -lt $Port + 10; $p++) {
    $l = [System.Net.HttpListener]::new()
    $l.Prefixes.Add("http://localhost:$p/")
    try { $l.Start(); return @{ Listener = $l; Port = $p } } catch { $l.Close() }
  }
  throw "No free port between $Port and $($Port + 9)."
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
