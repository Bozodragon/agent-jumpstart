$AgentJumpstart = @{ Profile = 'default'; Debug = $false }

# Agent Jumpstart's bootstrap. A team member pastes one line into Windows PowerShell:
#
#   irm <address of this file> | iex
#
# york.ps1, install.ps1 and york-debug.ps1 are this same file with a different top line.
# It asks nothing. It downloads the pinned Node.js zip, checks it against its published
# checksum and unpacks it to %LOCALAPPDATA%\agent-jumpstart\node, a folder of the
# installer's own that is never on PATH, so a Node.js the person already has (in
# %LOCALAPPDATA%\Programs\nodejs or anywhere else) is never moved, replaced or shadowed.
# It then fetches the installer program from the same Portall item as this file and starts
# it with that Node.js, hidden, and opens the Installer page the program serves. Once a page
# has connected, it closes this window. The program does everything else.
#
# If an Installer is already running (its page's address file, holding its process id, is
# the lock), it only opens that page again: before anything else, so a second paste never
# replaces the program folder under a running Installer. If no page connects (the program
# stops by itself after about 20 seconds without one), it runs the program in this window
# with --terminal instead, and says why.
#
# It runs through iex on Windows PowerShell 5.1, perhaps in Constrained Language Mode, so:
# plain ASCII with no byte-order mark; one exit only, which closes the person's window once
# the page has connected; no Add-Type, New-Object or .NET method calls; -UseBasicParsing on
# every web request. The Node.js version and checksums must match manifest.json.
# installer/test/pasted-lines.test.js checks all of this.

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
  $portall = 'https://jumpstart-install.portall.dev'

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
  $main = Join-Path $programDir 'installer\src\main.js'
  # Written by the program (installer/src/places.js): the page's address, then its process id,
  # while it runs; and, once a page has connected, the address that page connected to.
  $addressFile = Join-Path $root 'page-address.txt'
  $connectedFile = Join-Path $root 'page-connected.txt'

  # The Installer page opens as an app window, with no address bar or tabs, of the person's
  # own Chrome, or else Edge, in their own profile, found where each one's installer registers
  # it (App Paths, for this person or for the whole laptop). With neither, it opens as a tab of
  # the default browser. Opened from this window, which is in front, it comes to the front.
  function Open-InstallerPage([string]$Address) {
    foreach ($name in @('chrome.exe', 'msedge.exe')) {
      foreach ($hive in @('HKCU:', 'HKLM:')) {
        $browser = (Get-ItemProperty -LiteralPath "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$name" -ErrorAction SilentlyContinue).'(default)'
        if ($browser) { $browser = $browser -replace '"', '' }
        if ($browser -and (Test-Path -LiteralPath $browser)) {
          try {
            Start-Process -FilePath $browser -ArgumentList "--app=$Address"
            if ($DebugOn) { Write-Host "Debug: the Installer page opened in $browser" }
            return
          } catch {
            if ($DebugOn) { Write-Host "Debug: $browser didn't start ($($_.Exception.Message))" }
          }
        }
      }
    }
    try {
      Start-Process -FilePath $Address
    } catch {
      Write-Host "Open this address in your browser: $Address"
    }
  }

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
  Write-Host 'Agent Jumpstart' -ForegroundColor Cyan
  if ($DebugOn) {
    Write-Host "Debug: profile $ProfileId, PowerShell $($PSVersionTable.PSVersion), $($ExecutionContext.SessionState.LanguageMode), $arch"
    Write-Host "Debug: Node.js from $nodeUrl into $nodeDir"
    Write-Host "Debug: the installer from $programUrl into $programDir"
    Write-Host "Debug: downloads are kept in $downloads"
  }

  # A running Installer first, before anything is changed. Its address file is its lock: the
  # page's address, then its process id. While that process runs, its page is opened again and
  # nothing else is done. A lock left by an Installer that has stopped is no lock.
  if (Test-Path -LiteralPath $addressFile) {
    $lock = @(Get-Content -LiteralPath $addressFile -ErrorAction SilentlyContinue)
    $running = $null
    try {
      if ($lock.Count -ge 2) { $running = Get-Process -Id $lock[1] -ErrorAction SilentlyContinue }
    } catch {
      $running = $null
    }
    if ($running -and $running.Path -eq $nodeExe) {
      Write-Host 'The Installer is already running, so its page is opening again.'
      Open-InstallerPage $lock[0]
      return
    }
    if ($DebugOn) { Write-Host "Debug: $addressFile was left by an Installer that has stopped" }
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
          throw "The installer's Node.js $have needs replacing with $nodeVersion, but something is using it. If the installer is still running, let it finish or stop it, then paste the line again."
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

  # The Installer runs hidden, and its page takes over from this window. Started with a hidden
  # window, Node has a console of its own that nobody sees: the programs it runs share it, so
  # none flashes a window, and it carries on once this window has closed. Not detached (with no
  # console at all, each console program it ran would flash a window), and not through a hidden
  # powershell.exe, which leaves a window showing (microsoft/terminal#12464). Any address or
  # connected file left from a run that has stopped is cleared first, never to be read as this
  # run's. Start-Process joins its arguments with spaces, so the program's path is quoted.
  $arguments = @("`"$main`"", '--profile', $ProfileId)
  if ($DebugOn) { $arguments += '--debug' }
  Remove-Item -LiteralPath $addressFile, $connectedFile -Force -ErrorAction SilentlyContinue
  $installer = $null
  try {
    $installer = Start-Process -FilePath $nodeExe -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
    if ($DebugOn) { Write-Host "Debug: the installer started out of sight, as process $($installer.Id)" }
  } catch {
    if ($DebugOn) { Write-Host "Debug: the installer couldn't start out of sight ($($_.Exception.Message))" }
  }

  # Its page is opened once its address is written, then this waits for a page to connect. The
  # Installer stops by itself if none has within about 20 seconds; this gives it longer (about
  # 90 seconds), for a slow start, before giving up on it.
  $address = $null
  $connected = $false
  if ($installer) { Write-Host 'Opening the Installer page...' }
  for ($tries = 0; $installer -and $tries -lt 360; $tries++) {
    # Looked at first: once it has exited, its files say all they ever will.
    $exited = $installer.HasExited
    if (-not $address) {
      $address = @(Get-Content -LiteralPath $addressFile -ErrorAction SilentlyContinue)[0]
      if ($address) { Open-InstallerPage $address }
    }
    $connected = $address -and @(Get-Content -LiteralPath $connectedFile -ErrorAction SilentlyContinue)[0] -eq $address
    if ($connected -or $exited) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($connected) {
    Write-Host 'The Installer page is open, so this window closes now.'
    exit
  }

  # No page: the Installer runs in this window instead, as it always used to. One that never
  # stopped by itself is stopped first, so two never run at once.
  if ($installer -and -not $installer.HasExited) {
    Stop-Process -Id $installer.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $addressFile -Force -ErrorAction SilentlyContinue
  }
  if (-not $installer) {
    $why = "The installer couldn't start out of sight, so it carries on in this window instead."
  } elseif (-not $address) {
    $why = "The Installer page couldn't be started, so the installer carries on in this window instead."
  } else {
    $why = "The Installer page didn't open within 20 seconds, so the installer carries on in this window instead."
  }
  Write-Host $why -ForegroundColor Yellow
  $fallback = @($main, '--profile', $ProfileId, '--terminal')
  if ($DebugOn) { $fallback += '--debug' }
  & $nodeExe @fallback
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'If you need help, paste this line to copy your installer log, then send it on:'
    Write-Host "  irm $portall/share-log.ps1 | iex"
  }
}

Start-AgentJumpstart -ProfileId $AgentJumpstart.Profile -DebugOn $AgentJumpstart.Debug
