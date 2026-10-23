$AgentJumpstart = @{ Profile = 'default'; Debug = $false }

# Agent Jumpstart's bootstrap. A team member pastes one line into Windows PowerShell:
#
#   irm <address of this file> | iex
#
# york.ps1, install.ps1 and york-debug.ps1 are this same file with a different top line.
# It asks nothing. It downloads the pinned Node.js zip, checks it against its published
# checksum, unpacks it into local AppData, fetches the installer program from the same
# Portall item as this file, and runs it. The program does everything else.
#
# It runs through iex on Windows PowerShell 5.1, perhaps in Constrained Language Mode, so:
# plain ASCII with no byte-order mark; no exit (it would close the person's window); no
# Add-Type, New-Object or .NET method calls; -UseBasicParsing on every web request. The
# Node.js version and checksums must match manifest.json. installer/test/pasted-lines.test.js
# checks all of this.

function Start-AgentJumpstart {
  param([string]$ProfileId, [bool]$DebugOn)

  $ErrorActionPreference = 'Stop'
  # Windows PowerShell 5.1 downloads many times slower while drawing a progress bar.
  $ProgressPreference = 'SilentlyContinue'

  $nodeVersion = '26.12.1'
  $nodeSha256 = @{
    x64 = 'b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4'
    arm64 = '34567581ee63967b37afb6b7a0cc63a2d550a43d5d838adb75982d7e356f2e2c'
  }
  # The Portall item this file is published from (npm run publish:portall).
  $portall = 'https://jumpstart-install.arcforge.uk'

  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
  $nodeName = "node-v$nodeVersion-win-$arch"
  $nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeName.zip"
  $programUrl = "$portall/installer.zip"

  $root = Join-Path $env:LOCALAPPDATA 'agent-jumpstart'
  $downloads = Join-Path $root 'downloads'
  $unpacking = Join-Path $root 'unpacking'
  $nodeHome = Join-Path $root 'node'
  $nodeDir = Join-Path $nodeHome $nodeName
  $nodeExe = Join-Path $nodeDir 'node.exe'
  $programDir = Join-Path $root 'program'

  function Save-Download([string]$Url, [string]$Path, [string]$What) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path
    } catch {
      throw "Couldn't download $What from $Url. Check that you're connected to the internet, then paste the line again. ($($_.Exception.Message))"
    }
  }

  function Get-Sha256([string]$Path) {
    try {
      return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    } catch {
      if ($DebugOn) { Write-Host "Debug: Get-FileHash failed, so using certutil instead ($($_.Exception.Message))" }
    }
    foreach ($line in (& certutil.exe -hashfile $Path SHA256)) {
      $hex = $line -replace '\s', ''
      if ($hex -match '^[0-9a-fA-F]{64}$') { return $hex }
    }
    return 'none'
  }

  function Expand-Zip([string]$Zip, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path -LiteralPath $tar) {
      & $tar -xf $Zip -C $Destination
      if ($LASTEXITCODE -eq 0) { return }
      if ($DebugOn) { Write-Host "Debug: tar.exe returned $LASTEXITCODE, so using Expand-Archive instead" }
      Remove-Item -LiteralPath $Destination -Recurse -Force
      New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    }
    Expand-Archive -LiteralPath $Zip -DestinationPath $Destination -Force
  }

  Write-Host ''
  Write-Host 'Agent Jumpstart' -ForegroundColor Magenta
  if ($DebugOn) {
    Write-Host "Debug: profile $ProfileId, PowerShell $($PSVersionTable.PSVersion), $($ExecutionContext.SessionState.LanguageMode), $arch"
    Write-Host "Debug: Node.js from $nodeUrl into $nodeDir"
    Write-Host "Debug: the installer from $programUrl into $programDir"
    Write-Host "Debug: downloads are kept in $downloads"
  }

  try {
    New-Item -ItemType Directory -Force -Path $downloads | Out-Null

    if (Test-Path -LiteralPath $nodeExe) {
      Write-Host "Node.js $nodeVersion is already here."
    } else {
      $nodeZip = Join-Path $downloads "$nodeName.zip"
      Write-Host "Downloading Node.js $nodeVersion. This can take a minute..."
      Save-Download $nodeUrl $nodeZip 'Node.js'
      Write-Host 'Checking the download...'
      $actual = Get-Sha256 $nodeZip
      if ($DebugOn) { Write-Host "Debug: SHA-256 $actual, expected $($nodeSha256[$arch])" }
      if ($actual -ne $nodeSha256[$arch]) {
        Remove-Item -LiteralPath $nodeZip -Force -ErrorAction SilentlyContinue
        throw "The Node.js download didn't match its published checksum, so nothing was installed. Please paste the line again later. If this keeps happening, tell the person who sent you the line."
      }
      Write-Host 'Unpacking Node.js...'
      Expand-Zip $nodeZip $unpacking
      New-Item -ItemType Directory -Force -Path $nodeHome | Out-Null
      Move-Item -LiteralPath (Join-Path $unpacking $nodeName) -Destination $nodeDir
      Remove-Item -LiteralPath $unpacking -Recurse -Force
      if (-not $DebugOn) { Remove-Item -LiteralPath $nodeZip -Force }
      # Versions left behind by an earlier pin; one still in use is left for next time.
      Get-ChildItem -LiteralPath $nodeHome -Directory | Where-Object { $_.Name -ne $nodeName } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Downloading the installer...'
    $programZip = Join-Path $downloads 'installer.zip'
    Save-Download $programUrl $programZip 'the installer'
    Expand-Zip $programZip $unpacking
    if (Test-Path -LiteralPath $programDir) { Remove-Item -LiteralPath $programDir -Recurse -Force }
    Move-Item -LiteralPath $unpacking -Destination $programDir
    if (-not $DebugOn) { Remove-Item -LiteralPath $programZip -Force }
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    return
  }

  $arguments = @((Join-Path $programDir 'installer\src\main.js'), '--profile', $ProfileId)
  if ($DebugOn) { $arguments += '--debug' }
  & $nodeExe @arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'If you need help, paste this line to copy your installer log, then send it on:'
    Write-Host "  irm $portall/share-log.ps1 | iex"
  }
}

Start-AgentJumpstart -ProfileId $AgentJumpstart.Profile -DebugOn $AgentJumpstart.Debug
