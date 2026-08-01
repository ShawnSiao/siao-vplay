[CmdletBinding()]
param(
    [Parameter()]
    [string]$AssetRoot = 'W:\SiaoVPlay',

    [Parameter()]
    [string]$OutputConfig = 'W:\SiaoVPlay\build-configs\tauri.runtime-bundle.json',

    [Parameter()]
    [string]$ResourceRoot = 'bundle-assets'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

function Resolve-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

$assetRootPath = (Resolve-Path -LiteralPath $AssetRoot).Path
$outputConfigPath = Resolve-FullPath $OutputConfig

if ($assetRootPath -match '^(?i)C:\\') {
    throw "Runtime bundle resources cannot come from the C drive: $assetRootPath"
}
if ($outputConfigPath -match '^(?i)C:\\') {
    throw "Runtime bundle config cannot be written to the C drive: $outputConfigPath"
}

$requiredFiles = @(
    'runtimes\whisper\whisper-cli.exe',
    'runtimes\whisper\runtime-metadata.json',
    'runtimes\whisper\ggml-silero-v6.2.0.bin',
    'runtimes\whisper-vulkan\whisper-cli.exe',
    'runtimes\whisper-vulkan\runtime-metadata.json',
    'runtimes\yt-dlp\yt-dlp.exe',
    'licenses\whisper.cpp-LICENSE.txt',
    'licenses\openai-whisper-LICENSE.txt',
    'licenses\yt-dlp-LICENSE.txt',
    'licenses\ffmpeg-GPL-3.0.txt'
)

foreach ($relativePath in $requiredFiles) {
    $path = Join-Path $assetRootPath $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required bundled file is missing: $path"
    }
}

$resourceRootForConfig = $ResourceRoot.Replace('\', '/')
$resourceMap = [ordered]@{
    "$resourceRootForConfig/runtimes/whisper" = 'runtimes/whisper/'
    "$resourceRootForConfig/runtimes/whisper-vulkan" = 'runtimes/whisper-vulkan/'
    "$resourceRootForConfig/runtimes/yt-dlp" = 'runtimes/yt-dlp/'
    "$resourceRootForConfig/licenses" = 'third-party-notices/'
}

$config = [ordered]@{
    bundle = [ordered]@{
        active = $true
        targets = @('nsis')
        resources = $resourceMap
    }
}

$outputParent = Split-Path -Parent $outputConfigPath
New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
$json = $config | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $outputConfigPath -Value $json -Encoding UTF8

Write-Host "Generated lightweight bundle config: $outputConfigPath"
Write-Host 'Bundled: Whisper CPU, Whisper Vulkan, yt-dlp, and third-party licenses.'
Write-Host 'On demand: FFmpeg and Whisper models are excluded from the installer.'
