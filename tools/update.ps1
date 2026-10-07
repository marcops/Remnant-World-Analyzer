<#
  Rebuilds every generated data file in one go:

    1. downloads the Completionist's Checklist sheet         -> tools/source/sheet-*.csv
    2. builds the item / event data                          -> js/data.js        (tools/build-data.mjs)
    3. finds the Fextralife wiki page of every item, keeps
       the page and a small icon of the item                 -> js/wiki.js, img/items/*.png
    4. downloads the weapon tables and builds the stats      -> js/stats.js       (tools/build-stats.mjs)

  Pages and icons already downloaded are reused, so running it again is quick.
  Downloads are done here (PowerShell); the two .mjs scripts only read local files.
  Node is taken from PATH, or from VS Code when Node isn't installed.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\update.ps1            # update what's missing
    powershell -ExecutionPolicy Bypass -File tools\update.ps1 -Refresh   # download everything again
    powershell -ExecutionPolicy Bypass -File tools\update.ps1 -Offline   # rebuild from the cache only
#>
param([switch]$Refresh, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path $PSScriptRoot -Parent
$Src = Join-Path $Root 'tools\source'
$WikiDir = Join-Path $Src 'wiki'
$IconDir = Join-Path $Root 'img\items'
$Base = 'https://remnantfromtheashes.wiki.fextralife.com/'
$SheetId = '1rmmwn-kaVS44qWgub7ubXqL26fAgM7TBIi-dNc7VGdI'
$Utf8 = New-Object Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force $WikiDir, $IconDir | Out-Null

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Yellow }

# ---- node ----------------------------------------------------------------------
function Get-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if ($n) { return @{ Exe = $n.Source; Electron = $false } }
  foreach ($c in @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe", "$env:ProgramFiles\Microsoft VS Code\Code.exe")) {
    if (Test-Path $c) { return @{ Exe = $c; Electron = $true } }
  }
  throw 'Node not found: install Node.js (or VS Code, whose bundled Node is used).'
}
$Node = Get-Node
function Run-Node([string]$script) {
  if ($Node.Electron) { $env:ELECTRON_RUN_AS_NODE = '1' }
  Push-Location $Root
  try {
    $out = & $Node.Exe $script 2>&1 | Out-String
    Write-Host $out.TrimEnd()
    if ($LASTEXITCODE) { throw "$script failed" }
  } finally { Pop-Location; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
}

function Read-Json([string]$file) {
  $text = [IO.File]::ReadAllText((Join-Path $Root $file), [Text.Encoding]::UTF8)
  ($text -replace '^(\s*//[^\n]*\n)*[^{]*', '' -replace ';\s*if \(typeof[\s\S]*$', '') | ConvertFrom-Json
}

# ---- 1. sheet ------------------------------------------------------------------
Step 'Sheet'
$tabs = 'Armor', 'Weapons', 'Amulets', 'Rings', 'Weapon Mods', 'Traits', 'Emotes', 'Skins', 'Consumables'
foreach ($tab in $tabs) {
  $file = Join-Path $Src ('sheet-' + ($tab.ToLower() -replace ' ', '-') + '.csv')
  if ($Offline -or ((Test-Path $file) -and -not $Refresh)) { continue }
  $url = "https://docs.google.com/spreadsheets/d/$SheetId/gviz/tq?tqx=out:csv&sheet=" + [Uri]::EscapeDataString($tab)
  $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 60
  [IO.File]::WriteAllText($file, $r.Content, $Utf8)
  Write-Host "  downloaded $tab"
}

# ---- 2. items ------------------------------------------------------------------
Step 'Items (js/data.js)'
Run-Node 'tools/build-data.mjs'

# ---- 3. wiki pages and icons ---------------------------------------------------
Step 'Wiki pages and icons'
$fileFor = { param($slug) Join-Path $WikiDir (($slug -replace '[^A-Za-z0-9_\-]', '_') + '.html') }

# Downloads a page (following redirects); returns @{ Slug; Html } or $null when it doesn't exist.
function Get-Page([string]$slug) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ($Base + $slug) -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { return @{ Slug = $slug; Html = $r.Content } }
  } catch {
    $res = $_.Exception.Response
    if ($res -and [int]$res.StatusCode -ge 300 -and [int]$res.StatusCode -lt 400 -and $res.Headers['Location']) {
      $to = ([string]$res.Headers['Location']) -replace '^https?://[^/]+/', '' -replace '^/', ''
      if ($to -and $to -ne $slug) { return (Get-Page $to) }
    }
  }
  return $null
}

# The wiki spells names inconsistently: "Butchers_Flail", "Stone_Of_Balance", "Cold_as_Ice", "Voice_of_The_Tempest".
function Get-Candidates([string]$name) {
  $n = $name.Trim() -replace '\s+', ' '
  $title = (Get-Culture).TextInfo.ToTitleCase($n)
  $small = [regex]::Replace($n, '(?<=\s)(Of|The|As|And|A)(?=\s)', { $args[0].Value.ToLower() })
  $list = @($n, ($n -replace ' Emote$', ''), ($n -replace '^The ', ''), ($n -replace "'", [string][char]0x2019),
    ($n -replace "'", ''), $title, $small, ($n -creplace ' the ', ' The '))
  $list | Select-Object -Unique | ForEach-Object { [Uri]::EscapeUriString(($_ -replace ' ', '_')) -replace "'", '%27' }
}

# Item picture: the first image of the page's infobox, scaled to fit 64x64 (transparent PNG).
Add-Type -AssemblyName System.Drawing
function Save-Icon([string]$html, [string]$file) {
  $i = $html.IndexOf('id="infobox"'); if ($i -lt 0) { return $false }
  $m = [regex]::Match($html.Substring($i, [Math]::Min(6000, $html.Length - $i)), '<img[^>]+src="([^"]+)"')
  if (-not $m.Success) { return $false }
  $url = $m.Groups[1].Value; if ($url.StartsWith('/')) { $url = $Base.TrimEnd('/') + $url }
  $bytes = (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30).Content
  $ms = New-Object IO.MemoryStream(, [byte[]]$bytes)
  $src = New-Object Drawing.Bitmap ([Drawing.Image]::FromStream($ms))
  try {
    $box = Get-ContentBox $src
    # Light pictures go on a dark disc, a little smaller so they fit inside it.
    $light = [RwaIcon]::IsLight($src); $size = if ($light) { 44 } else { 64 }
    $scale = [Math]::Min($size / $box.Width, $size / $box.Height)
    $w = [Math]::Max(1, [int]($box.Width * $scale)); $h = [Math]::Max(1, [int]($box.Height * $scale))
    $bmp = New-Object Drawing.Bitmap 64, 64
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.Clear([Drawing.Color]::Transparent)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
    if ($light) {
      $brush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 58, 54, 49))
      $g.FillEllipse($brush, 0, 0, 63, 63); $brush.Dispose()
    }
    $g.DrawImage($src, (New-Object Drawing.Rectangle ([int]((64 - $w) / 2)), ([int]((64 - $h) / 2)), $w, $h), $box, [Drawing.GraphicsUnit]::Pixel)
    $g.Dispose(); $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  } finally { $src.Dispose(); $ms.Dispose() }
  return $true
}

# The part of the picture that isn't transparent (wiki images of guns have wide empty margins).
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class RwaIcon {
  public static Rectangle ContentBox(Bitmap bmp) {
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var bytes = new byte[data.Stride * bmp.Height];
    Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
    bmp.UnlockBits(data);
    int minX = bmp.Width, minY = bmp.Height, maxX = -1, maxY = -1;
    for (int y = 0; y < bmp.Height; y++)
      for (int x = 0; x < bmp.Width; x++)
        if (bytes[y * data.Stride + x * 4 + 3] > 16) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    return maxX < 0 ? rect : new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
  }
  // White pictures on a transparent background (trait icons) that vanish on a light page.
  public static bool IsLight(Bitmap bmp) {
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var bytes = new byte[data.Stride * bmp.Height];
    Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
    bmp.UnlockBits(data);
    double sum = 0; long n = 0;
    for (int y = 0; y < bmp.Height; y++)
      for (int x = 0; x < bmp.Width; x++) {
        int p = y * data.Stride + x * 4;
        if (bytes[p + 3] > 16) { sum += 0.114 * bytes[p] + 0.587 * bytes[p + 1] + 0.299 * bytes[p + 2]; n++; }
      }
    return n > 0 && sum / n > 200;
  }
}
'@
function Get-ContentBox([Drawing.Bitmap]$bmp) { [RwaIcon]::ContentBox($bmp) }

$data = Read-Json 'js\data.js'
$known = @{}
if (Test-Path (Join-Path $Root 'js\wiki.js')) {
  $old = Read-Json 'js\wiki.js'
  if ($old.items) { $old.items.PSObject.Properties | ForEach-Object { $known[$_.Name] = $_.Value } }
}
$noPageFile = Join-Path $WikiDir '_no-page.txt'
$noPage = @{}
if ((Test-Path $noPageFile) -and -not $Refresh) { Get-Content $noPageFile | ForEach-Object { if ($_) { $noPage[$_] = $true } } }

$items = [ordered]@{}; $icons = [ordered]@{}; $missing = @(); $noIcon = @(); $fetched = 0
# Also the upgrade materials and the Dragon Heart shown on the character page (not collection items).
$Materials = 'Scrap', 'Simple Iron', 'Forged Iron', 'Galvanized Iron', 'Hardened Iron', 'Lumenite Crystal', 'Simulacrum', 'Glowing Fragment', 'Dragon Heart'
$names = @($data.items | ForEach-Object { $_.name }) + $Materials | Select-Object -Unique
# Pages named differently from the game (Scrap has no page at all).
$PageOf = @{ 'Simple Iron' = 'Iron' }
foreach ($name in $names) {
  $slug = $known[$name]; $html = $null
  if ($slug -and -not $Refresh -and (Test-Path (& $fileFor $slug))) {
    $html = [IO.File]::ReadAllText((& $fileFor $slug), [Text.Encoding]::UTF8)
  } elseif (-not $Offline -and -not $noPage[$name]) {
    foreach ($c in (Get-Candidates $(if ($PageOf[$name]) { $PageOf[$name] } else { $name }))) { $p = Get-Page $c; if ($p) { break } }
    if ($p) { $slug = [Uri]::UnescapeDataString($p.Slug); $html = $p.Html; [IO.File]::WriteAllText((& $fileFor $slug), $html, $Utf8); $fetched++ }
    else { $slug = $null; $noPage[$name] = $true }
  }
  if (-not $slug -or -not $html) { $missing += $name; continue }
  $items[$name] = $slug
  $iconFile = Join-Path $IconDir (($name -replace '[^A-Za-z0-9]+', '_').Trim('_').ToLower() + '.png')
  if (-not (Test-Path $iconFile) -or $Refresh) {
    if ($Offline) { $noIcon += $name; continue }
    try { if (-not (Save-Icon $html $iconFile)) { $noIcon += $name; continue } } catch { $noIcon += $name; continue }
  }
  $icons[$name] = 'img/items/' + (Split-Path $iconFile -Leaf)
}
[IO.File]::WriteAllLines($noPageFile, [string[]]@($noPage.Keys | Sort-Object), $Utf8)
# The character page lists the heart's upgrades as "Dragon Heart upgrades".
if ($icons['Dragon Heart']) { $icons['Dragon Heart upgrades'] = $icons['Dragon Heart']; $items['Dragon Heart upgrades'] = $items['Dragon Heart'] }

$out = "// Generated by tools/update.ps1 - do not edit by hand.`n" +
  "// items: Fextralife wiki page (path after remnantfromtheashes.wiki.fextralife.com/) of each item, by item name.`n" +
  "// icons: small picture of the item (from that page), by item name.`n" +
  "var RWA_WIKI = { items: " + ($items | ConvertTo-Json -Compress) + ", icons: " + ($icons | ConvertTo-Json -Compress) + " };`n" +
  "if (typeof module !== 'undefined') module.exports = RWA_WIKI;`n"
[IO.File]::WriteAllText((Join-Path $Root 'js\wiki.js'), $out, $Utf8)
Write-Host "  js/wiki.js: $($items.Count) of $($names.Count) items have a wiki page ($fetched downloaded now), $($icons.Count) icons"
if ($missing.Count) { Write-Host "  without a page: $($missing.Count) (skins and a few others)" }
if ($noIcon.Count) { Write-Host "  without an icon: $($noIcon -join ', ')" }

# ---- 4. stats ------------------------------------------------------------------
Step 'Stats (js/stats.js)'
foreach ($page in 'Hand_Guns', 'Long_Guns', 'Melee_Weapons') {
  $file = & $fileFor $page
  if ($Offline -or ((Test-Path $file) -and -not $Refresh)) { continue }
  $p = Get-Page $page
  if ($p) { [IO.File]::WriteAllText($file, $p.Html, $Utf8); Write-Host "  downloaded $page" }
}
Run-Node 'tools/build-stats.mjs'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
