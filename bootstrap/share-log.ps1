# Agent Jumpstart: copy the newest installer log. A team member pastes one line:
#
#   irm <address of this file> | iex
#
# It puts the newest log on the clipboard and opens the log folder with that log selected, and
# says who to send it to: the person and email in the profile the installer ran with. That is
# the "profile" in the installer's settings.json, and the profile's own file is in program\profiles.
# Same rules as the bootstrap: plain ASCII, no byte-order mark, no exit, no Add-Type,
# New-Object or .NET method calls.

# Who this profile sends the log to, as "Jacob at jacob.hamood@york.ac.uk", or nothing at all
# when the installer never saved its settings or the profile names nobody.
function Get-AgentJumpstartRecipient {
  param([string]$State)
  try {
    $settings = Get-Content -LiteralPath (Join-Path $State 'settings.json') -Raw | ConvertFrom-Json
    $id = $settings.profile
    if ($id -notmatch '^[A-Za-z0-9-]+$') { return '' }
    $person = Get-Content -LiteralPath (Join-Path $State "program\profiles\$id.json") -Raw | ConvertFrom-Json
    if ($person.logGoesTo -and $person.logEmail) { return "$($person.logGoesTo) at $($person.logEmail)" }
  } catch {
    return ''
  }
  return ''
}

function Copy-AgentJumpstartLog {
  $ErrorActionPreference = 'Stop'
  $state = Join-Path $env:LOCALAPPDATA 'agent-jumpstart'
  $logs = Join-Path $state 'logs'

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

  $recipient = Get-AgentJumpstartRecipient $state
  if (-not $recipient) { $recipient = 'the person helping you' }

  Write-Host ''
  Write-Host 'Your newest installer log is on the clipboard.' -ForegroundColor Cyan
  Write-Host "Paste it into a message to $recipient. Its folder is open too, in case they want the file."
  Write-Host "  $($newest.FullName)"
}

Copy-AgentJumpstartLog
