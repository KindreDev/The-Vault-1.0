$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot 'tools\ffmpeg.exe'

if (Test-Path $dest) {
    Write-Host "    ffmpeg.exe already present in tools\"
    exit 0
}

$null = New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'tools')
$zip  = Join-Path $env:TEMP 'ffmpeg_build.zip'
$extr = Join-Path $env:TEMP 'ffmpeg_ex'

Write-Host "    Downloading FFmpeg from gyan.dev (~75 MB)..."
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' `
    -OutFile $zip -UseBasicParsing

Write-Host "    Extracting..."
if (Test-Path $extr) { Remove-Item $extr -Recurse -Force }
Expand-Archive $zip -DestinationPath $extr -Force

$ffmpeg = Get-ChildItem -Recurse $extr -Filter 'ffmpeg.exe' | Select-Object -First 1
if (-not $ffmpeg) { Write-Host "ERROR: ffmpeg.exe not found in archive"; exit 1 }

Copy-Item $ffmpeg.FullName $dest
Remove-Item $zip, $extr -Recurse -Force
Write-Host "    FFmpeg ready."
