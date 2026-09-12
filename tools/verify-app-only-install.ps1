[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter()]
    [string]$ValidationRoot,

    [Parameter()]
    [switch]$UseExistingInstall,

    [Parameter()]
    [switch]$Cleanup,

    [Parameter()]
    [string[]]$ProtectedFile = @()
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
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([string]::IsNullOrWhiteSpace($ValidationRoot)) {
    $ValidationRoot = Join-Path (Split-Path -Parent $installer) ('validation-' + [Guid]::NewGuid().ToString('N') + '\installed')
}
$validationRootPath = [System.IO.Path]::GetFullPath($ValidationRoot)
if (Test-Path -LiteralPath $validationRootPath) {
    $existing = @(Get-ChildItem -LiteralPath $validationRootPath -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0 -and -not $UseExistingInstall) {
        throw "Validation install directory is not empty: $validationRootPath"
    }
}

$protectedSnapshots = @($ProtectedFile | ForEach-Object {
    $protectedPath = [System.IO.Path]::GetFullPath($_)
    $installRootWithSeparator = $validationRootPath.TrimEnd('\') + '\'
    if ($protectedPath.Equals($validationRootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $protectedPath.StartsWith($installRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Protected resource file must be outside the validation install directory: $protectedPath"
    }
    if (-not (Test-Path -LiteralPath $protectedPath -PathType Leaf)) {
        throw "Protected resource file does not exist: $protectedPath"
    }
    [pscustomobject]@{
        path = $protectedPath
        sha256 = Get-Sha256 $protectedPath
    }
})

if (-not $UseExistingInstall) {
    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    $registeredProduct = @($uninstallRoots | Where-Object { Test-Path -LiteralPath $_ } |
        ForEach-Object { Get-ChildItem -LiteralPath $_ -ErrorAction SilentlyContinue } |
        Get-ItemProperty -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'SiaoVPlay*' })
    if ($registeredProduct.Count -gt 0) {
        throw 'An existing SiaoVPlay installation is registered. Use a disposable Windows environment for lifecycle validation.'
    }
    New-Item -ItemType Directory -Force -Path $validationRootPath | Out-Null
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$validationRootPath") -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Silent NSIS installation failed with exit code $($process.ExitCode)"
    }
}

$checkJson = & (Join-Path $PSScriptRoot 'check-app-only-package.ps1') `
    -SourceRoot $repoRoot `
    -InstallRoot $validationRootPath

$evidenceRoot = Split-Path -Parent $validationRootPath
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$inventoryPath = Join-Path $evidenceRoot 'installed-file-inventory.json'
$files = Get-ChildItem -LiteralPath $validationRootPath -Recurse -File -Force | ForEach-Object {
    [pscustomobject]@{
        path = $_.FullName.Substring($validationRootPath.Length).TrimStart('\').Replace('\', '/')
        sizeBytes = $_.Length
        sha256 = Get-Sha256 $_.FullName
    }
}
$files | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $inventoryPath -Encoding UTF8

$result = [pscustomobject]@{
    installer = $installer
    installRoot = $validationRootPath
    fileCount = @($files).Count
    inventory = $inventoryPath
    packageCheck = $checkJson | ConvertFrom-Json
    usedExistingInstall = [bool]$UseExistingInstall
    cleanupRequested = [bool]$Cleanup
}

if ($Cleanup) {
    $uninstaller = Get-ChildItem -LiteralPath $validationRootPath -Filter 'uninstall*.exe' -File | Select-Object -First 1
    if ($null -eq $uninstaller) {
        throw "Cleanup was requested but no uninstaller was found in $validationRootPath"
    }
    $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($uninstallProcess.ExitCode -ne 0) {
        throw "Silent uninstall failed with exit code $($uninstallProcess.ExitCode)"
    }
}

foreach ($snapshot in $protectedSnapshots) {
    if (-not (Test-Path -LiteralPath $snapshot.path -PathType Leaf)) {
        throw "Install lifecycle removed a protected resource file: $($snapshot.path)"
    }
    if ((Get-Sha256 $snapshot.path) -ne $snapshot.sha256) {
        throw "Install lifecycle changed a protected resource file: $($snapshot.path)"
    }
}

$result | Add-Member -NotePropertyName protectedFiles -NotePropertyValue $protectedSnapshots.Count
$result | Add-Member -NotePropertyName protectedHashesUnchanged -NotePropertyValue $true

$result | ConvertTo-Json -Depth 6
