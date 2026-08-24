[CmdletBinding()]
param(
  [string]$RuntimeDirectory = (Join-Path $PSScriptRoot "..\..\src-tauri\webview2-fixed-runtime"),
  [string]$ExpectedVersion = "109.0.1518.78"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $RuntimeDirectory -PathType Container)) {
  throw "Expected WebView2 fixed runtime directory does not exist: $RuntimeDirectory"
}

$runtimeExe = Join-Path $RuntimeDirectory "msedgewebview2.exe"
if (!(Test-Path -LiteralPath $runtimeExe -PathType Leaf)) {
  throw "Expected WebView2 runtime executable is missing: $runtimeExe"
}

$actualVersion = (Get-Item -LiteralPath $runtimeExe).VersionInfo.ProductVersion
if ($actualVersion -notlike "$ExpectedVersion*") {
  throw "Unexpected WebView2 runtime version. Expected $ExpectedVersion, actual $actualVersion."
}

$signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
  throw "WebView2 runtime executable is not signed by Microsoft Corporation: $runtimeExe"
}

Write-Host "WebView2 fixed runtime verified:"
Write-Host "  Directory: $RuntimeDirectory"
Write-Host "  Version: $actualVersion"
Write-Host "  Signer: $($signature.SignerCertificate.Subject)"
