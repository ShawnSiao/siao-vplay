$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-policy.ps1')
function Expect-Rejection([scriptblock]$Action) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected policy rejection' }
}
Assert-CandidateSourceState 'development' $true
Assert-CandidateSourceState 'beta' $false
Expect-Rejection { Assert-CandidateSourceState 'beta' $true }
Expect-Rejection { Assert-CandidateSourceState 'stable' $true }
Assert-SigningConfig ('{"bundle":{"windows":{"certificateThumbprint":"example","timestampUrl":"https://example.com"}}}' | ConvertFrom-Json)
Expect-Rejection { Assert-SigningConfig ('{"version":"9.9.9","bundle":{"windows":{}}}' | ConvertFrom-Json) }
Expect-Rejection { Assert-SigningConfig ('{"bundle":{"resources":["private.db"],"windows":{}}}' | ConvertFrom-Json) }
Expect-Rejection { Assert-SigningConfig ('{"bundle":{"windows":{"nsis":{}}}}' | ConvertFrom-Json) }
Expect-Rejection { Assert-SigningConfig ('{}' | ConvertFrom-Json) }
$valid = [pscustomobject]@{Status='Valid';TimeStamperCertificate='present'}
$unsigned = [pscustomobject]@{Status='NotSigned';TimeStamperCertificate=$null}
$untimestamped = [pscustomobject]@{Status='Valid';TimeStamperCertificate=$null}
Assert-CandidateSignatures 'beta' @($unsigned,$unsigned)
Assert-CandidateSignatures 'stable' @($valid,$valid)
Expect-Rejection { Assert-CandidateSignatures 'stable' @($valid,$unsigned) }
Expect-Rejection { Assert-CandidateSignatures 'stable' @($valid,$untimestamped) }
Expect-Rejection { Assert-CandidateSignatures 'stable' @($valid) }
Write-Output 'Build policy tests passed (source state, signing-only config, both signatures and timestamps).'
