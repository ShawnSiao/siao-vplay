[CmdletBinding()]
param(
    [Parameter()]
    [string]$AssetRoot = 'W:\SiaoVPlay',

    [Parameter()]
    [string]$BuildRoot = 'W:\SiaoVPlay\build\component-store-bundle'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRootPath = [System.IO.Path]::GetFullPath($BuildRoot)
if ($buildRootPath -match '^(?i)C:\\') {
    throw "Installer build directory cannot be on the C drive: $buildRootPath"
}

New-Item -ItemType Directory -Force -Path $buildRootPath | Out-Null
$configPath = Join-Path $buildRootPath 'tauri.component-store-bundle.json'
$cargoTargetPath = Join-Path $buildRootPath 'cargo-target'

& (Join-Path $PSScriptRoot 'prepare-component-store-bundle.ps1') `
    -AssetRoot $AssetRoot `
    -OutputConfig $configPath

$previousCargoTarget = $env:CARGO_TARGET_DIR
try {
    $env:CARGO_TARGET_DIR = $cargoTargetPath
    Set-Location -LiteralPath $repoRoot
    $tauriCli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
    & $tauriCli build --config $configPath
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri app-only bundle build failed with exit code $LASTEXITCODE"
    }
}
finally {
    if ($null -eq $previousCargoTarget) {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    } else {
        $env:CARGO_TARGET_DIR = $previousCargoTarget
    }
}

$installers = Get-ChildItem -LiteralPath (Join-Path $cargoTargetPath 'release\bundle\nsis') -Filter '*.exe' -File -ErrorAction SilentlyContinue
if (-not $installers) {
    throw "No NSIS installer found in $(Join-Path $cargoTargetPath 'release\bundle\nsis')"
}

Write-Host 'Generated app-only NSIS installer:'
$installers | ForEach-Object { Write-Host ("- {0} ({1} bytes)" -f $_.FullName, $_.Length) }
