[CmdletBinding()]
param(
    [Parameter()]
    [string]$BuildRoot = 'W:\SiaoVPlay\build\app-only-0.3.0'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $hasher.ComputeHash($stream)
        return ([System.BitConverter]::ToString($digest)).Replace('-', '')
    }
    finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Get-SignatureStatus([string]$Path) {
    try {
        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($Path)
        if ($null -ne $certificate) {
            return 'Signed'
        }
    }
    catch [System.Security.Cryptography.CryptographicException] {
        return 'NotSigned'
    }
    return 'NotSigned'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRootPath = [System.IO.Path]::GetFullPath($BuildRoot)
if ($buildRootPath -match '^(?i)C:\\') {
    throw "Installer build directory cannot be on the C drive: $buildRootPath"
}

$tauriCli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw "Tauri CLI is missing. Run npm ci in the worktree first: $tauriCli"
}

& (Join-Path $PSScriptRoot 'check-app-only-package.ps1') -SourceRoot $repoRoot

New-Item -ItemType Directory -Force -Path $buildRootPath | Out-Null
$cargoTargetPath = Join-Path $buildRootPath 'cargo-target'
$previousCargoTarget = $env:CARGO_TARGET_DIR
$previousLocation = Get-Location

try {
    $env:CARGO_TARGET_DIR = $cargoTargetPath
    Set-Location -LiteralPath $repoRoot
    & $tauriCli build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri installer build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Set-Location -LiteralPath $previousLocation
    if ($null -eq $previousCargoTarget) {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    } else {
        $env:CARGO_TARGET_DIR = $previousCargoTarget
    }
}

$installerDirectory = Join-Path $cargoTargetPath 'release\bundle\nsis'
$installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue)
if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in $installerDirectory, found $($installers.Count)"
}

$installer = $installers[0]
$hash = Get-Sha256 $installer.FullName
$signatureStatus = Get-SignatureStatus $installer.FullName

[pscustomobject]@{
    path = $installer.FullName
    version = '0.3.0'
    sizeBytes = $installer.Length
    sha256 = $hash
    signatureStatus = $signatureStatus
    packageProfile = 'app-only'
} | ConvertTo-Json -Depth 4
