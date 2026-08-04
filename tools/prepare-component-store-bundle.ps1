[CmdletBinding()]
param(
    [Parameter()]
    [string]$AssetRoot = 'W:\SiaoVPlay',

    [Parameter()]
    [string]$OutputConfig = 'W:\SiaoVPlay\build-configs\tauri.component-store-bundle.json'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

function Resolve-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$assetRootPath = (Resolve-Path -LiteralPath $AssetRoot).Path
$outputConfigPath = Resolve-FullPath $OutputConfig

if ($assetRootPath -match '^(?i)C:\\') {
    throw "Optional component-store evidence root cannot be on the C drive: $assetRootPath"
}
if ($outputConfigPath -match '^(?i)C:\\') {
    throw "Component-store bundle config cannot be written to the C drive: $outputConfigPath"
}

$noticePath = (Resolve-Path (Join-Path $repoRoot 'src-tauri\component-store-notice.txt')).Path
$resourceMap = [ordered]@{
    $noticePath = 'component-store-notice.txt'
}
$licensePath = Join-Path $assetRootPath 'licenses'
if (Test-Path -LiteralPath $licensePath -PathType Container) {
    $resourceMap[$licensePath] = 'third-party-notices/'
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

Write-Host "Generated app-only component-store bundle config: $outputConfigPath"
Write-Host 'Bundled: catalog/provenance notice and optional third-party notices only.'
Write-Host 'Excluded: FFmpeg, yt-dlp, Whisper runtimes, Whisper models, and local media.'
