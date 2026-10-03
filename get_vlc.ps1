$ErrorActionPreference = 'Stop'
$vlcVersion = '3.0.21'
$vlcRoot = Join-Path $PSScriptRoot 'tools\vlc'
if ((Test-Path -LiteralPath (Join-Path $vlcRoot 'libvlc.dll')) -and
    (Test-Path -LiteralPath (Join-Path $vlcRoot 'plugins')) -and
    (Test-Path -LiteralPath (Join-Path $vlcRoot 'libvlccore.dll')) -and
    (Test-Path -LiteralPath (Join-Path $vlcRoot 'COPYING.txt'))) {
    Write-Host 'Bundled VLC runtime is ready.'
    exit 0
}
$vlcStage = Join-Path $PSScriptRoot 'tools\vlc-download'
New-Item -ItemType Directory -Force -Path $vlcStage | Out-Null
$vlcArchive = Join-Path $vlcStage "vlc-$vlcVersion-win64.zip"
$vlcUrl = "https://download.videolan.org/pub/videolan/vlc/$vlcVersion/win64/vlc-$vlcVersion-win64.zip"
if (-not (Test-Path -LiteralPath $vlcArchive)) { Invoke-WebRequest -Uri $vlcUrl -OutFile $vlcArchive }
$vlcChecksum = (Invoke-WebRequest -Uri "$vlcUrl.sha256").Content
if ($vlcChecksum -is [byte[]]) { $vlcChecksum = [Text.Encoding]::UTF8.GetString($vlcChecksum) }
$vlcExpected = [regex]::Match([string]$vlcChecksum, '[a-fA-F0-9]{64}').Value
if (-not $vlcExpected -or (Get-FileHash -LiteralPath $vlcArchive -Algorithm SHA256).Hash -ne $vlcExpected) {
    throw 'VLC archive checksum verification failed'
}
Expand-Archive -LiteralPath $vlcArchive -DestinationPath $vlcStage -Force
$vlcExtracted = Join-Path $vlcStage "vlc-$vlcVersion"
if (-not (Test-Path -LiteralPath (Join-Path $vlcExtracted 'libvlc.dll'))) {
    throw 'The verified VLC archive did not contain its playback engine'
}
# Keep the full official runtime, including plugins, notices, and license files.
# Never replace an existing runtime folder silently.
if (Test-Path -LiteralPath $vlcRoot) { throw 'Incomplete tools/vlc exists; inspect it before retrying' }
$vlcToolsPrefix = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'tools')) + [IO.Path]::DirectorySeparatorChar
foreach ($vlcTarget in @($vlcExtracted, $vlcRoot)) {
    if (-not [IO.Path]::GetFullPath($vlcTarget).StartsWith($vlcToolsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'VLC runtime move escaped the workspace tools directory'
    }
}
Move-Item -LiteralPath $vlcExtracted -Destination $vlcRoot
if ([IO.Path]::GetFullPath($vlcStage) -eq [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'tools\vlc-download'))) {
    Remove-Item -LiteralPath $vlcStage -Recurse -Force
}
Write-Host "Bundled VLC $vlcVersion downloaded and verified."
