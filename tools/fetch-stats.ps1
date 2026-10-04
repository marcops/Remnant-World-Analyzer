<#
  Downloads the Fextralife wiki pages that tools/build-stats.mjs reads into
  tools/source/wiki/: the weapon tables plus the page of every trait, ring,
  amulet, weapon mod and one piece of every armor set (for the set bonus).
  Run it, then: node tools/build-stats.mjs

  Usage:  powershell -ExecutionPolicy Bypass -File tools\fetch-stats.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Out = Join-Path $Root 'tools\source\wiki'
$Base = 'https://remnantfromtheashes.wiki.fextralife.com/'
New-Item -ItemType Directory -Force $Out | Out-Null

function Read-Json([string]$file, [string]$prefix) {
  $text = [IO.File]::ReadAllText((Join-Path $Root $file), [Text.Encoding]::UTF8)
  ($text -replace '^[^{]*', '' -replace ';\s*if \(typeof[\s\S]*$', '') | ConvertFrom-Json
}
$data = Read-Json 'js\data.js'
$wiki = (Read-Json 'js\wiki.js').items

$pages = [ordered]@{ 'Hand_Guns' = 1; 'Long_Guns' = 1; 'Melee_Weapons' = 1 }
$seenGroups = @{}
foreach ($it in $data.items) {
  $slug = $wiki.($it.name)
  if (-not $slug) { continue }
  switch ($it.category) {
    { $_ -in 'Trait', 'Ring', 'Amulet', 'Mod' } { $pages[$slug] = 1 }
    'Armor' {
      # One piece per set is enough: every piece shows the whole set bonus.
      if ($it.group -and -not $seenGroups[$it.group]) { $seenGroups[$it.group] = 1; $pages[$slug] = 1 }
    }
  }
}

$i = 0; $failed = @()
foreach ($slug in $pages.Keys) {
  $i++
  Write-Progress -Activity 'Downloading wiki pages' -Status $slug -PercentComplete (100 * $i / $pages.Count)
  $file = Join-Path $Out (($slug -replace "[^A-Za-z0-9_\-]", '_') + '.html')
  try {
    $url = $Base + ([Uri]::EscapeUriString($slug) -replace "'", '%27')
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30
    [IO.File]::WriteAllText($file, $r.Content, (New-Object Text.UTF8Encoding($false)))
  } catch { $failed += $slug }
}
Write-Host "tools/source/wiki: $($pages.Count - $failed.Count) of $($pages.Count) pages"
if ($failed.Count) { Write-Host "-- Failed:"; $failed | ForEach-Object { Write-Host "  $_" } }
