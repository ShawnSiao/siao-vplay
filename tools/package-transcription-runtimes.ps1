param(
    [Parameter(Mandatory = $true)]
    [string]$CpuRuntimeDirectory,
    [Parameter(Mandatory = $true)]
    [string]$VulkanRuntimeDirectory,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,
    [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$version = '1.9.1-siaocut.1'
$sourceCommit = '080bbbe85230f624f0b52127f1ae1218247989f9'
$fixtureSha256 = 'e2d55c32ca5900c677bf86c541dedd98e7e67c31cc0d967d7509b0eba36871cb'
$verifier = 'tools/test-whisper-vad-timeline.ps1'

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function New-VerifiedRuntimeArchive {
    param(
        [string]$Backend,
        [string]$SourceDirectory,
        [string]$StagingRoot
    )

    $source = (Resolve-Path -LiteralPath $SourceDirectory).Path
    $metadataPath = Join-Path $source 'runtime-metadata.json'
    $metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
    if (
        $metadata.schemaVersion -ne 1 -or
        $metadata.version -ne $version -or
        $metadata.backend -ne $Backend -or
        $metadata.sourceCommit -ne $sourceCommit -or
        $metadata.sourceCapabilities.segmentTimestampDomain -ne 'original_media' -or
        $metadata.sourceCapabilities.tokenApiTimestampDomain -ne 'original_media' -or
        $metadata.sourceCapabilities.cliJsonTokenTimestampDomain -ne 'original_media' -or
        $metadata.vadTimelineVerification.status -ne 'verified' -or
        $metadata.vadTimelineVerification.timeDomain -ne 'original_media' -or
        $metadata.vadTimelineVerification.fixtureSha256 -ne $fixtureSha256 -or
        $metadata.vadTimelineVerification.verifier -ne $verifier
    ) {
        throw "$Backend runtime metadata does not match the verified VAD timeline baseline."
    }

    $stage = Join-Path $StagingRoot $Backend
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -LiteralPath $metadataPath -Destination $stage
    [int64]$installedBytes = (Get-Item -LiteralPath $metadataPath).Length
    foreach ($entry in $metadata.files) {
        if ([IO.Path]::GetFileName($entry.name) -ne $entry.name) {
            throw "Runtime metadata contains an unsafe file name: $($entry.name)"
        }
        $file = Join-Path $source $entry.name
        $item = Get-Item -LiteralPath $file
        $hash = Get-Sha256 $file
        if ($item.Length -ne [int64]$entry.size -or $hash -ne $entry.sha256.ToLowerInvariant()) {
            throw "Runtime file does not match metadata: $file"
        }
        Copy-Item -LiteralPath $file -Destination $stage
        $installedBytes += $item.Length
    }

    $archive = Join-Path $OutputDirectory "whisper-$Backend-$version-windows-x64.zip"
    if (Test-Path -LiteralPath $archive) {
        [IO.File]::Delete($archive)
    }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
    $archiveItem = Get-Item -LiteralPath $archive
    return [pscustomobject]@{
        resourceId = "whisper-$Backend"
        version = $version
        backend = $Backend
        archive = $archiveItem.FullName
        downloadBytes = $archiveItem.Length
        installedBytes = $installedBytes
        sha256 = Get-Sha256 $archive
        metadataSha256 = Get-Sha256 $metadataPath
        sourceCommit = $sourceCommit
        fileCount = 1 + $metadata.files.Count
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stagingRoot = Join-Path $OutputDirectory ".package-staging-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
try {
    $evidence = @(
        New-VerifiedRuntimeArchive -Backend 'cpu' -SourceDirectory $CpuRuntimeDirectory -StagingRoot $stagingRoot
        New-VerifiedRuntimeArchive -Backend 'vulkan' -SourceDirectory $VulkanRuntimeDirectory -StagingRoot $stagingRoot
    )
} finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        [IO.Directory]::Delete($stagingRoot, $true)
    }
}

$json = $evidence | ConvertTo-Json -Depth 5
if ($EvidencePath) {
    $evidenceParent = Split-Path -Parent $EvidencePath
    if ($evidenceParent) {
        New-Item -ItemType Directory -Force -Path $evidenceParent | Out-Null
    }
    [IO.File]::WriteAllText($EvidencePath, $json, [Text.UTF8Encoding]::new($false))
}
$json
