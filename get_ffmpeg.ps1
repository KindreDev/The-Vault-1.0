$ErrorActionPreference = 'Stop'
$ffmpegDest = Join-Path $PSScriptRoot 'tools\ffmpeg.exe'
$ffprobeDest = Join-Path $PSScriptRoot 'tools\ffprobe.exe'

if ((Test-Path $ffmpegDest) -and (Test-Path $ffprobeDest)) {
    Write-Host "    ffmpeg.exe and ffprobe.exe already present in tools\"
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
$ffprobe = Get-ChildItem -Recurse $extr -Filter 'ffprobe.exe' | Select-Object -First 1
if (-not $ffmpeg -or -not $ffprobe) { Write-Host "ERROR: ffmpeg.exe or ffprobe.exe not found in archive"; exit 1 }

if (-not (Test-Path $ffmpegDest)) { Copy-Item $ffmpeg.FullName $ffmpegDest }
if (-not (Test-Path $ffprobeDest)) { Copy-Item $ffprobe.FullName $ffprobeDest }
Remove-Item $zip, $extr -Recurse -Force
Write-Host "    FFmpeg and FFprobe ready."
