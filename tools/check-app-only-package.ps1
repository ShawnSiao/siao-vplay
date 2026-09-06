[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceRoot,

    [Parameter()]
    [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
if ($null -ne [Console]::OutputEncoding) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Join-Path $PSScriptRoot '..'
}

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label does not exist: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Get-RelativePath([string]$Root, [string]$Path) {
    $rootWithSeparator = $Root.TrimEnd('\') + '\'
    if (-not $Path.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the expected root: $Path"
    }
    return $Path.Substring($rootWithSeparator.Length).Replace('\', '/')
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

function Assert-NoForbiddenPayload([string]$Root, [string]$Label) {
    $forbiddenFileNames = @(
        'ffmpeg.exe',
        'ffprobe.exe',
        'yt-dlp.exe',
        'whisper-cli.exe',
        'ggml-silero-v6.2.0.bin',
        'ggml-base.bin',
        'ggml-small.bin'
    )
    $forbiddenDirectoryNames = @('runtimes', 'runtime', 'models', 'downloads', 'staging')
    $violations = @()

    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
        $relativePath = Get-RelativePath $Root $file.FullName
        $segments = $relativePath.Split('/')
        if ($forbiddenFileNames -contains $file.Name.ToLowerInvariant()) {
            $violations += $relativePath
            continue
        }
        if ($file.Name -match '^(?i:ggml-.+\.(bin|dll))$') {
            $violations += $relativePath
            continue
        }
        if ($segments | Where-Object { $forbiddenDirectoryNames -contains $_.ToLowerInvariant() }) {
            $violations += $relativePath
        }
    }

    if ($violations.Count -gt 0) {
        throw "$Label contains forbidden runtime or model payloads:`n$($violations -join "`n")"
    }
}

$sourceRootPath = Resolve-ExistingDirectory $SourceRoot 'Source root'
$tauriConfigPath = Join-Path $sourceRootPath 'src-tauri\tauri.conf.json'
$catalogPath = Join-Path $sourceRootPath 'src-tauri\resources\local-resource-catalog.json'
$providerCatalogPath = Join-Path $sourceRootPath 'src-tauri\resources\ai-provider-catalog.json'
$noticePath = Join-Path $sourceRootPath 'src-tauri\resources\third-party-notices\THIRD-PARTY-NOTICES.md'

foreach ($requiredPath in @($tauriConfigPath, $catalogPath, $providerCatalogPath, $noticePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required app-only package file is missing: $requiredPath"
    }
}

$tauriConfig = [System.IO.File]::ReadAllText($tauriConfigPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$catalog = [System.IO.File]::ReadAllText($catalogPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

if ($catalog.packageProfile -ne 'app-only') {
    throw "Catalog packageProfile must be app-only, got: $($catalog.packageProfile)"
}
if (@($catalog.bundlePolicy.allowlistedResourceIds).Count -ne 0) {
    throw 'The first app-only release must have an empty bundled-resource allowlist.'
}
$resourceIds = @($catalog.resources | ForEach-Object { $_.id })
if (@($resourceIds | Sort-Object -Unique).Count -ne $resourceIds.Count) {
    throw 'Catalog resource IDs must be unique.'
}
$profileIds = @($catalog.profiles | ForEach-Object { $_.id })
if (@($profileIds | Sort-Object -Unique).Count -ne $profileIds.Count) {
    throw 'Catalog profile IDs must be unique.'
}
if (@($catalog.profiles | Where-Object { $_.recommended }).Count -ne 1) {
    throw 'Catalog must have exactly one recommended transcription profile.'
}
foreach ($capability in @($catalog.capabilities)) {
    foreach ($resourceId in @($capability.resourceIds)) {
        if ($resourceIds -notcontains $resourceId) {
            throw "Capability references an unknown resource: $($capability.id) -> $resourceId"
        }
    }
    foreach ($profileId in @($capability.profileIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        if ($profileIds -notcontains $profileId) {
            throw "Capability references an unknown profile: $($capability.id) -> $profileId"
        }
    }
}
foreach ($profile in @($catalog.profiles)) {
    foreach ($resourceId in @($profile.resourceIds)) {
        if ($resourceIds -notcontains $resourceId) {
            throw "Profile references an unknown resource: $($profile.id) -> $resourceId"
        }
    }
}
foreach ($resource in @($catalog.resources)) {
    if ($resource.bundled -ne $false) {
        throw "Catalog resource must not be bundled: $($resource.id)"
    }
    if ($null -ne $resource.artifact) {
        if ($resource.artifact.size -le 0) {
            throw "Artifact size must be positive: $($resource.id)"
        }
        if ($resource.artifact.sha256 -notmatch '^[0-9a-f]{64}$') {
            throw "Artifact SHA-256 is invalid: $($resource.id)"
        }
        if ($resource.artifact.url -notmatch '^https://') {
            throw "Artifact URL must use HTTPS: $($resource.id)"
        }
    }
}

$allowedResources = @(
    'resources/ai-provider-catalog.json',
    'resources/local-resource-catalog.json',
    'resources/third-party-notices/THIRD-PARTY-NOTICES.md',
    'resources/third-party-notices/SiaoVPlay-MIT.txt',
    'resources/third-party-notices/LobeHub-MIT.txt',
    'resources/third-party-notices/DEPENDENCIES.txt'
)
$configuredResources = @($tauriConfig.bundle.resources) | ForEach-Object { $_.Replace('\', '/') }
if (@($configuredResources).Count -ne $allowedResources.Count) {
    throw "Unexpected number of bundled resources: $(@($configuredResources).Count)"
}
foreach ($resourcePath in $configuredResources) {
    if ($allowedResources -notcontains $resourcePath) {
        throw "Unexpected bundled resource in tauri.conf.json: $resourcePath"
    }
}

$sourceResourceRoot = Resolve-ExistingDirectory (Join-Path $sourceRootPath 'src-tauri\resources') 'Source resource root'
$sourceResourceFiles = @(Get-ChildItem -LiteralPath $sourceResourceRoot -Recurse -File -Force | ForEach-Object {
    'resources/' + (Get-RelativePath $sourceResourceRoot $_.FullName)
})
if ($sourceResourceFiles.Count -ne $allowedResources.Count) {
    throw "Unexpected files exist under src-tauri/resources: $($sourceResourceFiles -join ', ')"
}
foreach ($resourcePath in $sourceResourceFiles) {
    if ($allowedResources -notcontains $resourcePath) {
        throw "Unexpected source resource file: $resourcePath"
    }
}
Assert-NoForbiddenPayload $sourceResourceRoot 'src-tauri/resources'

$installFileCount = $null
if (-not [string]::IsNullOrWhiteSpace($InstallRoot)) {
    $installRootPath = Resolve-ExistingDirectory $InstallRoot 'Install root'
    $applicationPath = Join-Path $installRootPath 'siao-vplay.exe'
    if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
        throw "Installed application executable is missing: $applicationPath"
    }
    Assert-NoForbiddenPayload $installRootPath 'Installed application'
    $installedCatalogPath = Join-Path $installRootPath 'resources\local-resource-catalog.json'
    $installedProviderCatalogPath = Join-Path $installRootPath 'resources\ai-provider-catalog.json'
    $installedNoticePath = Join-Path $installRootPath 'resources\third-party-notices\THIRD-PARTY-NOTICES.md'
    foreach ($pair in @(
        @($catalogPath, $installedCatalogPath),
        @($providerCatalogPath, $installedProviderCatalogPath),
        @($noticePath, $installedNoticePath),
        @((Join-Path $sourceResourceRoot 'third-party-notices\SiaoVPlay-MIT.txt'), (Join-Path $installRootPath 'resources\third-party-notices\SiaoVPlay-MIT.txt')),
        @((Join-Path $sourceResourceRoot 'third-party-notices\LobeHub-MIT.txt'), (Join-Path $installRootPath 'resources\third-party-notices\LobeHub-MIT.txt')),
        @((Join-Path $sourceResourceRoot 'third-party-notices\DEPENDENCIES.txt'), (Join-Path $installRootPath 'resources\third-party-notices\DEPENDENCIES.txt'))
    )) {
        if (-not (Test-Path -LiteralPath $pair[1] -PathType Leaf)) {
            throw "Installed app-only resource is missing: $($pair[1])"
        }
        if ((Get-Sha256 $pair[0]) -ne (Get-Sha256 $pair[1])) {
            throw "Installed app-only resource differs from the source: $($pair[1])"
        }
    }
    $installFileCount = @(Get-ChildItem -LiteralPath $installRootPath -Recurse -File -Force).Count
}

[pscustomobject]@{
    packageProfile = $catalog.packageProfile
    catalogResources = @($catalog.resources).Count
    bundledResourceAllowlist = @($catalog.bundlePolicy.allowlistedResourceIds).Count
    sourceResourceFiles = $sourceResourceFiles.Count
    installedFiles = $installFileCount
    status = 'passed'
} | ConvertTo-Json -Depth 4
