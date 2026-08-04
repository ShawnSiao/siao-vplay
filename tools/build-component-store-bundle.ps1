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
$bundleLinkPath = Join-Path $repoRoot 'src-tauri\component-store-assets'
$bundleLinkCreated = $false

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

try {
    if (Test-Path -LiteralPath $bundleLinkPath) {
        throw "Temporary component-store bundle link already exists; refusing to overwrite: $bundleLinkPath"
    }
    New-Item -ItemType Junction -Path $bundleLinkPath -Target ((Resolve-Path -LiteralPath $AssetRoot).Path) | Out-Null
    $bundleLinkCreated = $true

    & (Join-Path $PSScriptRoot 'prepare-component-store-bundle.ps1') `
        -AssetRoot $AssetRoot `
        -OutputConfig $configPath `
        -ResourceRoot 'component-store-assets'

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

Write-Host 'Generated app-only NSIS installer:'
$installers | ForEach-Object { Write-Host ("- {0} ({1} bytes)" -f $_.FullName, $_.Length) }
