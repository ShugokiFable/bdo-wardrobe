# BDO Wardrobe launcher — private Node runtime + WebView2 desktop shell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LegacyStateRoot = Join-Path $env:LOCALAPPDATA 'BDO Wardrobe'
$StateRoot = Join-Path $env:LOCALAPPDATA 'BDO Wardrobe'
if ((Test-Path -LiteralPath $LegacyStateRoot) -and -not (Test-Path -LiteralPath $StateRoot)) {
  Move-Item -LiteralPath $LegacyStateRoot -Destination $StateRoot
}
$RuntimeRoot = Join-Path $StateRoot 'runtime'
$DataRoot = Join-Path $StateRoot 'data'
$LogRoot = Join-Path $StateRoot 'logs'
$WebViewProfile = Join-Path $StateRoot 'webview-profile'
$NodeVersion = 'v22.16.0'
$NodeFolder = "node-$NodeVersion-win-x64"
$NodeExe = Join-Path (Join-Path $RuntimeRoot $NodeFolder) 'node.exe'
$NodeZipUrl = 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip'
$NodeZipSha256 = '21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd'
$ServerFile = Join-Path $AppRoot 'server.mjs'
$ViewerExe = Join-Path $AppRoot 'BDO Wardrobe UI.exe'
$mutex = $null
$server = $null

function Show-BdoError([string]$Message) {
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($Message, 0, 'BDO Wardrobe', 16)
  } catch {}
}

function Ensure-PrivateNode {
  if (Test-Path -LiteralPath $NodeExe) { return }
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  $zip = Join-Path $env:TEMP "bdo-wardrobe-$NodeVersion-$PID.zip"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $NodeZipUrl -OutFile $zip
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $NodeZipSha256) {
      throw "Private runtime download failed integrity verification. Expected $NodeZipSha256 but received $actual."
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $RuntimeRoot -Force
    if (-not (Test-Path -LiteralPath $NodeExe)) { throw 'Private Node runtime did not extract correctly.' }
  } finally {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  }
}

function Test-WebView2Runtime {
  $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\$guid",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\ClientState\$guid",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\ClientState\$guid"
  )
  foreach ($key in $keys) {
    try {
      $value = (Get-ItemProperty -LiteralPath $key -Name EBWebView -ErrorAction Stop).EBWebView
      if ($value -and (Test-Path -LiteralPath (Join-Path $value 'EBWebView\x64\EmbeddedBrowserWebView.dll'))) { return $true }
    } catch {}
  }
  return $false
}

function Ensure-WebView2Runtime {
  if (Test-WebView2Runtime) { return }
  $setup = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup-$PID.exe"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $setup
    $install = Start-Process -FilePath $setup -ArgumentList @('/silent','/install') -Wait -PassThru
    if ($install.ExitCode -ne 0 -and $install.ExitCode -ne 3010) {
      throw "Microsoft WebView2 Runtime installer exited with code $($install.ExitCode)."
    }
    Start-Sleep -Milliseconds 500
    if (-not (Test-WebView2Runtime)) { throw 'Microsoft WebView2 Runtime is still unavailable after installation.' }
  } finally {
    Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
  }
}

function Get-FreeLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

try {
  New-Item -ItemType Directory -Force -Path $StateRoot,$DataRoot,$LogRoot,$WebViewProfile | Out-Null
  $mutex = [System.Threading.Mutex]::new($false, 'Local\BDOWardrobeDesktop')
  if (-not $mutex.WaitOne(0, $false)) { throw 'BDO Wardrobe is already running.' }

  Ensure-PrivateNode
  Ensure-WebView2Runtime
  if (-not (Test-Path -LiteralPath $ServerFile)) { throw "Missing application server: $ServerFile" }
  if (-not (Test-Path -LiteralPath $ViewerExe)) { throw "Missing native desktop viewer: $ViewerExe" }

  $port = Get-FreeLoopbackPort
  $url = "http://127.0.0.1:$port/"
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$port
  $env:BDO_WARDROBE_DESKTOP = '1'
  $env:BDO_WARDROBE_URL = $url
  $env:BDO_WARDROBE_WEBVIEW_PROFILE = $WebViewProfile

  $stdout = Join-Path $LogRoot 'server-output.log'
  $stderr = Join-Path $LogRoot 'server-error.log'
  $server = Start-Process -FilePath $NodeExe -ArgumentList @("`"$ServerFile`"") -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  $ready = $false
  for ($i=0; $i -lt 100; $i++) {
    if ($server.HasExited) { break }
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri "${url}api/health" -TimeoutSec 1
      if ($health.ok) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) {
    $details = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) } else { '' }
    throw "The local BDO Wardrobe service could not start.`n$details"
  }

  $ui = Start-Process -FilePath $ViewerExe -WorkingDirectory $AppRoot -PassThru
  $ui.WaitForExit()
} catch {
  $message = $_.Exception.Message
  try { Add-Content -LiteralPath (Join-Path $LogRoot 'desktop-launcher.log') -Value "$(Get-Date -Format o) ERROR $message" } catch {}
  Show-BdoError $message
  exit 1
} finally {
  if ($server -and -not $server.HasExited) {
    & taskkill.exe /PID $server.Id /T /F *> $null
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  }
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
  }
}
