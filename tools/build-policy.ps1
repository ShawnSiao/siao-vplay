function Assert-CandidateSourceState([string]$Channel, [bool]$Dirty) {
    if ($Channel -ne 'development' -and $Dirty) {
        throw 'Beta and stable candidates require a clean Git tree'
    }
}
function Assert-SigningConfig($Config) {
    if ($null -eq $Config.bundle.windows -or
        @($Config.PSObject.Properties.Name | Where-Object { $_ -ne 'bundle' }).Count -or
        @($Config.bundle.PSObject.Properties.Name | Where-Object { $_ -ne 'windows' }).Count) {
        throw 'The optional config may only override Windows signing settings'
    }
    $allowed = @('certificateThumbprint', 'digestAlgorithm', 'timestampUrl', 'tsp', 'signCommand')
    if (@($Config.bundle.windows.PSObject.Properties.Name | Where-Object { $_ -notin $allowed }).Count) {
        throw 'The optional config may not override package identity, payloads or build commands'
    }
}
function Assert-CandidateSignatures([string]$Channel, [object[]]$Signatures) {
    if ($Channel -ne 'stable') { return }
    if ($Signatures.Count -ne 2) { throw 'Both installer and application signatures are required' }
    foreach ($signature in $Signatures) {
        if ($signature.Status -ne 'Valid' -or $null -eq $signature.TimeStamperCertificate) {
            throw 'Stable artifacts require valid Authenticode signatures and trusted timestamps'
        }
    }
}
