[CmdletBinding()]
param(
    [Parameter()]
    [string]$AssetRoot = 'W:\SiaoVPlay',

    [Parameter()]
    [string]$BuildRoot = 'W:\SiaoVPlay\build\runtime-bundle'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

function Remove-BundleLink([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return
    }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
        throw "Refusing to remove a non-reparse path: $Path"
    }
    [System.IO.Directory]::Delete($Path, $false)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRootPath = [System.IO.Path]::GetFullPath($BuildRoot)

if ($buildRootPath -match '^(?i)C:\\') {
    throw "Installer build directory cannot be on the C drive: $buildRootPath"
}

New-Item -ItemType Directory -Force -Path $buildRootPath | Out-Null
$configPath = Join-Path $buildRootPath 'tauri.runtime-bundle.json'
$cargoTargetPath = Join-Path $buildRootPath 'cargo-target'
$bundleLinkPath = Join-Path $repoRoot 'src-tauri\bundle-assets'
$bundleLinkCreated = $false

if (Test-Path -LiteralPath $bundleLinkPath) {
    throw "Temporary bundle link already exists; refusing to overwrite: $bundleLinkPath"
}

try {
    New-Item -ItemType Junction -Path $bundleLinkPath -Target ((Resolve-Path -LiteralPath $AssetRoot).Path) | Out-Null
    $bundleLinkCreated = $true

    & (Join-Path $PSScriptRoot 'prepare-runtime-bundle.ps1') `
        -AssetRoot $AssetRoot `
        -OutputConfig $configPath `
        -ResourceRoot 'bundle-assets'

    $previousCargoTarget = $env:CARGO_TARGET_DIR
    try {
        $env:CARGO_TARGET_DIR = $cargoTargetPath
        Set-Location -LiteralPath $repoRoot
        $tauriCli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
        & $tauriCli build --features bridge --config $configPath
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri installer build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        if ($null -eq $previousCargoTarget) {
            Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
        } else {
            $env:CARGO_TARGET_DIR = $previousCargoTarget
        }
    }
}
finally {
    if ($bundleLinkCreated) {
        Remove-BundleLink $bundleLinkPath
    }
}

$installers = Get-ChildItem -LiteralPath (Join-Path $cargoTargetPath 'release\bundle\nsis') -Filter '*.exe' -File -ErrorAction SilentlyContinue
if (-not $installers) {
    throw "No NSIS installer found in $(Join-Path $cargoTargetPath 'release\bundle\nsis')"
}

Write-Host 'Generated explicit legacy bridge NSIS installer:'
Write-Host 'Bridge mode is compatibility-only and does not represent the shared v2 Store release.'
$installers | ForEach-Object { Write-Host ("- {0} ({1} bytes)" -f $_.FullName, $_.Length) }
