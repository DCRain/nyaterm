[CmdletBinding()]
param(
  [string]$RuntimeDirectory = (Join-Path $PSScriptRoot "..\..\src-tauri\webview2-fixed-runtime"),
  [string]$DownloadDirectory = $env:RUNNER_TEMP
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$runtimeVersion = "109.0.1518.78"
$runtimeFolderName = "Microsoft.WebView2.FixedVersionRuntime.$runtimeVersion.x64"
$archiveName = "$runtimeFolderName.cab"

# Microsoft no longer exposes this old fixed runtime through a stable first-party
# permalink. Keep the URL and hash pinned, then verify the extracted runtime's
# Microsoft Authenticode signature before it can enter the bundle.
$runtimeUrl = "https://github.com/westinyang/WebView2RuntimeArchive/releases/download/$runtimeVersion/$archiveName"
$runtimeSha256 = "7622281cf83de1a35e3a471f432f7a897d65f0a7d3975df08512b7b253dd45c7"

if ([string]::IsNullOrWhiteSpace($RuntimeDirectory)) {
  throw "A WebView2 fixed runtime directory is required."
}

if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
  $DownloadDirectory = [System.IO.Path]::GetTempPath()
}

New-Item -ItemType Directory -Force -Path $DownloadDirectory | Out-Null
$archivePath = Join-Path $DownloadDirectory $archiveName

if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
  $cachedHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($cachedHash -ne $runtimeSha256) {
    Write-Host "Removing cached WebView2 runtime with unexpected SHA256: $cachedHash"
    Remove-Item -LiteralPath $archivePath -Force
  }
}

if (!(Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  Write-Host "Downloading WebView2 fixed runtime $runtimeVersion for Windows 7..."
  Invoke-WebRequest -Uri $runtimeUrl -OutFile $archivePath -UseBasicParsing
}

$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $runtimeSha256) {
  throw "WebView2 fixed runtime SHA256 mismatch. Expected $runtimeSha256, got $actualHash."
}

$extractDirectory = Join-Path $DownloadDirectory "nyaterm-webview2-fixed-runtime-$runtimeVersion"
if (Test-Path -LiteralPath $extractDirectory) {
  Remove-Item -LiteralPath $extractDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $extractDirectory | Out-Null

$expand = Join-Path $env:SystemRoot "System32\expand.exe"
& $expand $archivePath "-F:*" $extractDirectory
if ($LASTEXITCODE -ne 0) {
  throw "Failed to extract WebView2 fixed runtime archive (exit code $LASTEXITCODE)."
}

$extractedRuntime = Join-Path $extractDirectory $runtimeFolderName
$runtimeExe = Join-Path $extractedRuntime "msedgewebview2.exe"
if (!(Test-Path -LiteralPath $runtimeExe -PathType Leaf)) {
  throw "Extracted WebView2 runtime is missing msedgewebview2.exe."
}

$signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
  throw "Extracted WebView2 runtime executable is not signed by Microsoft Corporation: $runtimeExe"
}

if (Test-Path -LiteralPath $RuntimeDirectory) {
  Remove-Item -LiteralPath $RuntimeDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeDirectory) | Out-Null
Move-Item -LiteralPath $extractedRuntime -Destination $RuntimeDirectory

$installedVersion = (Get-Item -LiteralPath (Join-Path $RuntimeDirectory "msedgewebview2.exe")).VersionInfo.ProductVersion
Write-Host "Prepared WebView2 fixed runtime:"
Write-Host "  Version: $installedVersion"
Write-Host "  Directory: $RuntimeDirectory"
Write-Host "  Archive SHA256: $actualHash"
