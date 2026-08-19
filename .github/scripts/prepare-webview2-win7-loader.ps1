[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Newer WebView2 static loaders import EventSetInformation, which is not
# available on Windows 7. The SDK loader entry points used by webview2-com-sys
# are stable enough for this pinned Win7 compatibility build.
$sdkVersion = "1.0.1054.31"
$sdkPackageSha256 = "0afe683aa3d143a5f6330db1ce833c69278b38fe5e1eadec52f26910ad26e22f"
$legacyLoaderSha256 = "76314119685bbf4c2b2423a44e81b57beadc914c943d0e772fd6bc78c8e6b0e8"
$knownWebView2ComSysVersion = "0.38.2"
$knownUpstreamLoaderSha256 = "0659b741bde6348d4c4a6ec4ceb9af50e3d0048ed9cd3c8659bccbb61fde55ee"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tauriManifest = Join-Path $repositoryRoot "src-tauri\Cargo.toml"
$lockFile = Join-Path $repositoryRoot "src-tauri\Cargo.lock"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "nyaterm-win7-webview2-loader-$([Guid]::NewGuid())"
$packagePath = Join-Path $temporaryRoot "Microsoft.Web.WebView2.$sdkVersion.nupkg"
$extractedPath = Join-Path $temporaryRoot "extracted"

function Get-LockedWebView2ComSysVersion {
  $lockText = Get-Content -LiteralPath $lockFile -Raw
  $match = [regex]::Match($lockText, '(?ms)\[\[package\]\]\s+name = "webview2-com-sys"\s+version = "([^"]+)"')
  if (!$match.Success) {
    throw "Unable to find webview2-com-sys in $lockFile."
  }
  $match.Groups[1].Value
}

try {
  $lockedVersion = Get-LockedWebView2ComSysVersion
  if ($lockedVersion -ne $knownWebView2ComSysVersion) {
    throw "Expected webview2-com-sys $knownWebView2ComSysVersion, found $lockedVersion. Revalidate loader layout and hashes before using this script."
  }

  New-Item -ItemType Directory -Path $extractedPath -Force | Out-Null

  $packageUrl = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$sdkVersion"
  Write-Host "Downloading Microsoft.Web.WebView2 SDK $sdkVersion for the Windows 7 loader..."
  Invoke-WebRequest -Uri $packageUrl -OutFile $packagePath -UseBasicParsing

  $actualPackageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualPackageSha256 -ne $sdkPackageSha256) {
    throw "Unexpected WebView2 SDK package SHA256. Expected $sdkPackageSha256, got $actualPackageSha256."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $extractedPath)

  $legacyLoader = Join-Path $extractedPath "build/native/x64/WebView2LoaderStatic.lib"
  if (!(Test-Path -LiteralPath $legacyLoader -PathType Leaf)) {
    throw "WebView2 SDK $sdkVersion does not contain build/native/x64/WebView2LoaderStatic.lib."
  }

  $actualLoaderSha256 = (Get-FileHash -LiteralPath $legacyLoader -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualLoaderSha256 -ne $legacyLoaderSha256) {
    throw "Unexpected Windows 7 WebView2 loader SHA256. Expected $legacyLoaderSha256, got $actualLoaderSha256."
  }

  Push-Location $repositoryRoot
  try {
    & cargo fetch --manifest-path $tauriManifest --locked --target x86_64-win7-windows-msvc
    if ($LASTEXITCODE -ne 0) {
      throw "cargo fetch failed while preparing the Windows 7 WebView2 loader."
    }

    $metadataJson = & cargo metadata --manifest-path $tauriManifest --locked --format-version 1
    if ($LASTEXITCODE -ne 0) {
      throw "cargo metadata failed while locating webview2-com-sys."
    }
  }
  finally {
    Pop-Location
  }

  $metadata = $metadataJson | ConvertFrom-Json
  $webView2Packages = @($metadata.packages | Where-Object {
      $_.name -eq "webview2-com-sys" -and $_.version -eq $lockedVersion
    })
  if ($webView2Packages.Count -ne 1) {
    throw "Expected exactly one webview2-com-sys $lockedVersion package, found $($webView2Packages.Count)."
  }

  $crateRoot = Split-Path -Parent $webView2Packages[0].manifest_path
  $loaderDestination = Join-Path $crateRoot "x64\WebView2LoaderStatic.lib"
  if (!(Test-Path -LiteralPath $loaderDestination -PathType Leaf)) {
    throw "webview2-com-sys static loader does not exist: $loaderDestination"
  }

  $existingLoaderSha256 = (Get-FileHash -LiteralPath $loaderDestination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($existingLoaderSha256 -notin @($knownUpstreamLoaderSha256, $legacyLoaderSha256)) {
    throw "Refusing to replace unknown webview2-com-sys loader SHA256: $existingLoaderSha256"
  }

  Set-ItemProperty -LiteralPath $loaderDestination -Name IsReadOnly -Value $false
  Copy-Item -LiteralPath $legacyLoader -Destination $loaderDestination -Force

  $installedLoaderSha256 = (Get-FileHash -LiteralPath $loaderDestination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($installedLoaderSha256 -ne $legacyLoaderSha256) {
    throw "Windows 7 WebView2 loader replacement failed. Expected $legacyLoaderSha256, got $installedLoaderSha256."
  }

  Write-Host "Prepared Windows 7 compatible WebView2 static loader:"
  Write-Host "  SDK version: $sdkVersion"
  Write-Host "  webview2-com-sys: $lockedVersion"
  Write-Host "  Destination: $loaderDestination"
  Write-Host "  Loader SHA256: $installedLoaderSha256"
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
