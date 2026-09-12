[CmdletBinding()]
param(
    [Parameter()]
    [string]$BuildRoot,

    [Parameter()]
    [string]$OutputDirectory,

    [Parameter()]
    [string]$TauriConfig
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'build-policy.ps1')
& node (Join-Path $PSScriptRoot 'release-metadata.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release metadata check failed' }
$metadata = Get-Content -LiteralPath (Join-Path $repoRoot 'release.json') -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    $BuildRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot 'src-tauri\target' }
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = if ($env:SIAOVPLAY_ARTIFACT_DIR) { $env:SIAOVPLAY_ARTIFACT_DIR } else { Join-Path $repoRoot ('artifacts\' + $metadata.version) }
}
$buildRootPath = [System.IO.Path]::GetFullPath($BuildRoot)
$outputDirectoryPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$sourceCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Build from a Git checkout to retain source provenance' }
$dirty = [bool](& git -C $repoRoot status --porcelain --untracked-files=normal)
Assert-CandidateSourceState $metadata.channel $dirty
if ($TauriConfig) {
    $signingConfig = Get-Content -LiteralPath (Resolve-Path -LiteralPath $TauriConfig).Path -Raw | ConvertFrom-Json
    Assert-SigningConfig $signingConfig
}

$tauriCli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw "Tauri CLI is missing. Run npm ci in the worktree first: $tauriCli"
}

& (Join-Path $PSScriptRoot 'check-app-only-package.ps1') -SourceRoot $repoRoot

New-Item -ItemType Directory -Force -Path $buildRootPath | Out-Null
$cargoTargetPath = $buildRootPath
$previousCargoTarget = $env:CARGO_TARGET_DIR
$previousLocation = Get-Location

try {
    $env:CARGO_TARGET_DIR = $cargoTargetPath
    Set-Location -LiteralPath $repoRoot
    $tauriArguments = @('build')
    if ($TauriConfig) { $tauriArguments += @('--config', (Resolve-Path -LiteralPath $TauriConfig).Path) }
    & $tauriCli @tauriArguments
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
$installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter ("SiaoVPlay_" + $metadata.version + "_x64-setup.exe") -File -ErrorAction SilentlyContinue)
if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in $installerDirectory, found $($installers.Count)"
}

$installer = $installers[0]
$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
$appExecutable = Join-Path $cargoTargetPath 'release\siao-vplay.exe'
$appSignature = Get-AuthenticodeSignature -LiteralPath $appExecutable
Assert-CandidateSignatures $metadata.channel @($signature, $appSignature)
New-Item -ItemType Directory -Force -Path $outputDirectoryPath | Out-Null
$candidatePath = Join-Path $outputDirectoryPath $installer.Name
if (Test-Path -LiteralPath $candidatePath) {
    throw "Candidate installer already exists and will not be overwritten: $candidatePath"
}
Copy-Item -LiteralPath $installer.FullName -Destination $candidatePath
$candidate = Get-Item -LiteralPath $candidatePath
$hash = Get-Sha256 $candidate.FullName
$manifest = [pscustomobject]@{
    schemaVersion = 1
    artifact = $candidate.Name
    version = $metadata.version
    channel = $metadata.channel
    sourceCommit = $sourceCommit
    sourceDirty = $dirty
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    sizeBytes = $candidate.Length
    sha256 = $hash
    signatureStatus = $signature.Status.ToString()
    appSignatureStatus = $appSignature.Status.ToString()
    packageProfile = 'app-only'
    catalogSha256 = Get-Sha256 (Join-Path $repoRoot 'src-tauri\resources\local-resource-catalog.json')
    npmLockSha256 = Get-Sha256 (Join-Path $repoRoot 'package-lock.json')
    cargoLockSha256 = Get-Sha256 (Join-Path $repoRoot 'src-tauri\Cargo.lock')
    releaseReady = $false
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($candidatePath + '.manifest.json') -Encoding UTF8
($hash.ToLowerInvariant() + '  ' + $candidate.Name) | Set-Content -LiteralPath ($candidatePath + '.sha256') -Encoding ASCII
Copy-Item -LiteralPath (Join-Path $repoRoot 'src-tauri\resources\local-resource-catalog.json') -Destination (Join-Path $outputDirectoryPath 'local-resource-catalog.json')
$manifest | Add-Member -NotePropertyName path -NotePropertyValue $candidate.FullName
$manifest | ConvertTo-Json -Depth 4
