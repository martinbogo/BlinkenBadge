param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath $Path -File | Where-Object { $_.Extension -in '.exe', '.msi' })
if (@($files | Where-Object Extension -eq '.exe').Count -ne 1 -or @($files | Where-Object Extension -eq '.msi').Count -ne 1) {
    throw 'Expected one EXE installer and one MSI installer.'
}
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') {
        throw "Invalid signature for $($file.Name): $($signature.StatusMessage)"
    }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -ne 'Martin Bogomolni') { throw "Unexpected publisher: $publisher" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing timestamp: $($file.Name)" }
    Write-Output "$($file.Name): Valid signature and timestamp; publisher $publisher"
}
