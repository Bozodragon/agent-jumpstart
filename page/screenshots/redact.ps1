# Turns take.ps1's raw shots into the two pictures the setup page shows, t3-layout.png and
# t3-new-workspace.png beside this script. It fills everything of the laptop's own (thread titles,
# workspace names, branches, messages, the environment, the model, usage figures, the channel's
# badge) in T3 Code's own colours, draws plain placeholder bars where the text was, crops, and
# scales the layout down.
#
#   powershell -ExecutionPolicy Bypass -File page\screenshots\redact.ps1 -Raw <take.ps1's folder>
#
# The regions below fit the shots taken for the page: a 1721x1399 window (its own area x 8-1712,
# y 0-1390), the sidebar 280 wide, a conversation open and the Thread details card showing. A new
# shot puts things elsewhere: check each region against it, move or drop it, and look at the result
# before committing it, since the page is public. Then move the labels in page/template.html.
param([Parameter(Mandatory)] [string]$Raw)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Brush($hex) { New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Fill($g, $hex, $x, $y, $w, $h) { $g.SmoothingMode = 'None'; $g.FillRectangle((Brush $hex), $x, $y, $w, $h); $g.SmoothingMode = 'AntiAlias' }
function Round($g, $hex, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); $g.FillPath((Brush $hex), $p); $p.Dispose()
}
# A placeholder for a line of text: a rounded bar.
function Bar($g, $hex, $x, $y, $w, $h = 10) { Round $g $hex $x $y $w $h ($h / 2) }

# The layout: everything but T3 Code's own buttons and labels.
function Layout($g) {
  $side = '#191921'; $main = '#1a1b26'; $card = '#16161f'; $composer = '#202029'
  $dim = '#2c2d38'; $mid = '#3a3b47'; $faint = '#26272f'; $bubble = '#42434e'; $inBubble = '#5b5c68'
  # Sidebar: the channel's badge, and every thread (workspace, title, branch, badges).
  Fill $g $side 200 8 56 28
  Fill $g $side 12 94 274 1250
  $widths = @(150, 200, 120, 170, 210, 140, 190, 160, 205, 130, 180, 215, 150, 175)
  for ($k = 0; $k -lt 14; $k++) {
    $y = 98 + 91 * $k
    if ($y + 12 -gt 1336) { break }
    Round $g $dim 28 ($y + 12) 14 14 4
    Bar $g $dim 52 ($y + 14) (60 + ($widths[$k] % 70)) 9
    if ($y + 36 -lt 1330) { Bar $g $mid 28 ($y + 37) $widths[$k] 11 }
    if ($y + 62 -lt 1330) { Bar $g $faint 28 ($y + 64) (70 + ($widths[$k] % 60)) 8 }
  }
  # Header: the thread's workspace and title.
  Fill $g $main 300 4 1150 38
  Round $g $dim 316 15 14 14 4; Bar $g $dim 338 17 48 9; Bar $g $mid 410 16 200 11
  # The conversation and the line under it, redrawn as two messages and two replies.
  Fill $g $main 294 44 1080 1192
  Round $g $composer 346 50 1004 22 8
  Round $g $bubble 544 134 806 150 18
  foreach ($i in 0..3) { Bar $g $inBubble 568 (160 + 26 * $i) (@(740, 700, 720, 420)[$i]) 10 }
  Bar $g $dim 346 344 140 10
  foreach ($l in @(@(392, 600), @(430, 940), @(454, 520), @(491, 960), @(515, 230))) { Bar $g $mid 346 $l[0] $l[1] 10 }
  Round $g $composer 346 548 1004 90 12
  Bar $g $dim 360 562 160 9; Bar $g $faint 380 607 260 8
  Round $g $bubble 972 690 378 210 14
  Round $g $bubble 544 905 806 76 18
  Bar $g $inBubble 568 925 720 10; Bar $g $inBubble 568 951 420 10
  foreach ($l in @(@(1036, 950), @(1061, 520), @(1097, 980), @(1122, 450))) { Bar $g $mid 346 $l[0] $l[1] 10 }
  # Message box: the model's name.
  Fill $g $composer 1100 1324 160 36; Bar $g $dim 1112 1336 130 10
  # Thread details card: the environment, a script row, the branch and every number.
  Fill $g $card 1400 66 250 72
  Round $g $dim 1408 76 16 16 4; Bar $g $dim 1436 80 110 9
  Round $g $dim 1408 113 16 16 4; Bar $g $dim 1436 117 130 9
  Fill $g $card 1400 160 260 30
  Round $g $dim 1408 167 16 16 4; Bar $g $dim 1436 171 150 9
  Fill $g $card 1590 234 90 26; Bar $g $dim 1610 242 60 9
  Fill $g $card 1622 284 60 52; Bar $g $dim 1636 292 36 9; Bar $g $dim 1636 318 36 9
  Fill $g $card 1595 356 86 28; Bar $g $dim 1610 365 62 9
  New-Object System.Drawing.Rectangle 8, 0, 1705, 1391
}

# The new-workspace box: only the box is kept, on a plain margin over the blurred window.
function NewWorkspace($g) {
  $back = '#171720'
  Fill $g $back 535 129 651 9; Fill $g $back 535 600 651 9
  Fill $g $back 535 129 9 480; Fill $g $back 1177 129 9 480
  New-Object System.Drawing.Rectangle 535, 129, 651, 480
}

function Redact([string]$in, [string]$out, [scriptblock]$regions, [int]$width) {
  $src = [System.Drawing.Bitmap]::FromFile($in)
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height); $src.Dispose()
  $g.SmoothingMode = 'AntiAlias'
  $crop = & $regions $g
  $g.Dispose()
  $cut = $bmp.Clone($crop, $bmp.PixelFormat); $bmp.Dispose()
  if ($width -eq 0) { $width = $cut.Width }
  $h = [int][Math]::Round($cut.Height * $width / $cut.Width)
  $small = New-Object System.Drawing.Bitmap $width, $h
  $s = [System.Drawing.Graphics]::FromImage($small)
  $s.InterpolationMode = 'HighQualityBicubic'; $s.PixelOffsetMode = 'HighQuality'
  $s.DrawImage($cut, 0, 0, $width, $h); $s.Dispose(); $cut.Dispose()
  $small.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $small.Dispose()
  "$out ${width}x$h, $((Get-Item $out).Length) bytes"
}

Redact (Join-Path $Raw 'layout.png') (Join-Path $PSScriptRoot 't3-layout.png') ${function:Layout} 1000
Redact (Join-Path $Raw 'new-workspace.png') (Join-Path $PSScriptRoot 't3-new-workspace.png') ${function:NewWorkspace} 0
