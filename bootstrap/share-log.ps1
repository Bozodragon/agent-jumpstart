# Agent Jumpstart: copy the newest installer log. A team member pastes one line:
#
#   irm <address of this file> | iex
#
# It puts the newest log on the clipboard and opens the log folder with that log selected.
# Same rules as the bootstrap: plain ASCII, no byte-order mark, no exit, no Add-Type,
# New-Object or .NET method calls.

function Copy-AgentJumpstartLog {
  $ErrorActionPreference = 'Stop'
  $logs = Join-Path $env:LOCALAPPDATA 'agent-jumpstart\logs'

  $newest = Get-ChildItem -LiteralPath $logs -Filter 'install-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $newest) {
    Write-Host "There's no installer log yet. Paste the installer line first, then try this again." -ForegroundColor Red
    return
  }

  $text = Get-Content -LiteralPath $newest.FullName -Raw
  try {
    Set-Clipboard -Value $text
  } catch {
    $text | clip.exe
  }
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $newest.FullName + '"')

  Write-Host ''
  Write-Host 'Your newest installer log is on the clipboard.' -ForegroundColor Magenta
  Write-Host 'Paste it into a message to the person helping you. Its folder is open too, in case they want the file.'
  Write-Host "  $($newest.FullName)"
}

Copy-AgentJumpstartLog
