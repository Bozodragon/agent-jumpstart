$AgentJumpstart = @{ Profile = 'york'; Debug = $true }

# Agent Jumpstart's bootstrap. A team member pastes one line into Windows PowerShell:
#
#   irm <address of this file> | iex
#
# york.ps1, install.ps1 and york-debug.ps1 are this same file with a different top line.
# It asks nothing. It downloads the pinned Node.js zip, checks it against its published
# checksum and unpacks it to %LOCALAPPDATA%\agent-jumpstart\node, a folder of the
# installer's own that is never on PATH, so a Node.js the person already has (in
# %LOCALAPPDATA%\Programs\nodejs or anywhere else) is never moved, replaced or shadowed.
# It then fetches the installer program from the same Portall item as this file and runs
# it with that Node.js. The program does everything else.
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
  $replaced = Join-Path $root 'replaced-node'
  $nodeDir = Join-Path $root 'node'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  $programDir = Join-Path $root 'program'

  function Get-NodeVersion {
    if (-not (Test-Path -LiteralPath $nodeExe)) { return 'none' }
    try {
      return (& $nodeExe --version)
    } catch {
      return 'none'
    }
  }

  # Each download is one line: what it is, its size and a percentage, redrawn in place.
  # Windows' own curl.exe downloads at full speed (Invoke-WebRequest's own bar makes it crawl,
  # so that stays off) and writes its progress meter to stderr, a line about once a second,
  # which is read here as it comes. If curl.exe isn't there or fails (it doesn't use the proxy
  # Windows is set to), Invoke-WebRequest tries, and the line gets its size once it's done.
  function Save-Download([string]$Url, [string]$Path, [string]$What) {
    $label = "Downloading $What"
    $units = @{ '' = 'bytes'; 'k' = 'KB'; 'M' = 'MB'; 'G' = 'GB' }
    $shown = $false
    Write-Host -NoNewline "$label..."
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path -LiteralPath $curl) {
      $said = ''
      $line = ''
      # With 2>&1 each of curl's lines arrives as an error record, which mustn't stop the run.
      $ErrorActionPreference = 'Continue'
      & $curl --fail --location --output $Path $Url 2>&1 | ForEach-Object {
        $meter = "$_"
        # A meter line starts: percent, total size, percent received... The total stays 0 if
        # the server doesn't say how big the file is.
        if ($meter -match '^\s*(\d+)\s+(\d+(\.\d+)?)([kMG]?)\s') {
          if ($Matches[2] -ne '0') {
            $size = "$($Matches[2]) $($units[$Matches[4]])"
            $percent = '{0,3}' -f $Matches[1]
            $line = "$label ($size) $percent%"
            # A redirect's short reply is finished the moment it starts, so a finished line is
            # drawn only once curl ends, and the redirect never shows.
            if ($Matches[1] -ne '100') {
              Write-Host -NoNewline "`r$line"
              $shown = $true
            }
          }
        } elseif ($meter -match '^curl: ') {
          $said = $meter
        }
      }
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      if ($code -eq 0) {
        if ($line) { Write-Host "`r$line" } else { Write-Host '' }
        return
      }
      if ($shown -or $DebugOn) {
        Write-Host ''
        if ($DebugOn) { Write-Host "Debug: curl.exe returned $code ($said), so downloading without curl.exe instead" }
        Write-Host -NoNewline "$label..."
      }
    }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path
    } catch {
      Write-Host ''
      throw "Couldn't download $What from $Url. Check that you're connected to the internet, then paste the line again. ($($_.Exception.Message))"
    }
    $bytes = (Get-Item -LiteralPath $Path).Length
    $size = '{0:N1} KB' -f ($bytes / 1KB)
    if ($bytes -ge 1MB) { $size = '{0:N2} MB' -f ($bytes / 1MB) }
    Write-Host "`r$label ($size) 100%"
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

    $have = Get-NodeVersion
    if ($DebugOn) { Write-Host "Debug: Node.js already in $nodeDir is $have" }
    if ($have -eq "v$nodeVersion") {
      Write-Host "Node.js $nodeVersion is already here."
    } else {
      $nodeZip = Join-Path $downloads "$nodeName.zip"
      Save-Download $nodeUrl $nodeZip "Node.js $nodeVersion"
      Write-Host 'Checking the download...'
      $actual = Get-Sha256 $nodeZip
      if ($DebugOn) { Write-Host "Debug: SHA-256 $actual, expected $($nodeSha256[$arch])" }
      if ($actual -ne $nodeSha256[$arch]) {
        Remove-Item -LiteralPath $nodeZip -Force -ErrorAction SilentlyContinue
        throw "The Node.js download didn't match its published checksum, so nothing was installed. Please paste the line again later. If this keeps happening, tell the person who sent you the line."
      }
      Write-Host 'Unpacking Node.js...'
      Expand-Zip $nodeZip $unpacking
      # Set the installer's old Node.js aside in one move, so one still in use is left whole.
      if (Test-Path -LiteralPath $replaced) { Remove-Item -LiteralPath $replaced -Recurse -Force }
      if (Test-Path -LiteralPath $nodeDir) {
        try {
          Move-Item -LiteralPath $nodeDir -Destination $replaced
        } catch {
          throw "The installer's Node.js $have needs replacing with $nodeVersion, but something is using it. Close any other window running the installer, then paste the line again."
        }
      }
      Move-Item -LiteralPath (Join-Path $unpacking $nodeName) -Destination $nodeDir
      Remove-Item -LiteralPath $unpacking -Recurse -Force
      if (Test-Path -LiteralPath $replaced) { Remove-Item -LiteralPath $replaced -Recurse -Force -ErrorAction SilentlyContinue }
      if (-not $DebugOn) { Remove-Item -LiteralPath $nodeZip -Force }
    }

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
