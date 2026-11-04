# Takes the two raw screenshots of T3 Code for the setup page, from the T3 Code window that's open:
#   layout.png         the window as it is
#   new-workspace.png  the box the "Add project" button opens, at its Sources step
# It opens that box through Windows' accessibility interface (no mouse or keyboard of yours is
# used), picks "This device" if the box asks which device first, then closes it with Esc, so
# nothing is added. Leave T3 Code open, not minimised, on a thread; it may be behind other windows.
#
#   powershell -ExecutionPolicy Bypass -File page\screenshots\take.ps1 -Out <folder>
#
# The raw shots show whatever is in T3 Code, so keep them out of the repo: run redact.ps1 on them
# (see page/README.md), which writes the two pictures the page shows.
param([Parameter(Mandatory)] [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class T3Shot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
[T3Shot]::SetProcessDPIAware() | Out-Null
$ui = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]::Descendants

$window = (Get-Process | Where-Object { $_.ProcessName -like 'T3 Code*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle
if (-not $window) { throw 'T3 Code is not open.' }
if ([T3Shot]::IsIconic($window)) { throw 'T3 Code is minimised: restore its window first.' }
$root = $ui::FromHandle($window)
New-Item -ItemType Directory -Force $Out | Out-Null

# The whole window, drawn by T3 Code itself (PW_RENDERFULLCONTENT, for Electron's GPU surface),
# so other windows on top of it don't matter.
function Shoot([string]$file) {
  $r = New-Object T3Shot+RECT; [T3Shot]::GetWindowRect($window, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [T3Shot]::PrintWindow($window, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save((Join-Path $Out $file), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  "$file $($r.R - $r.L)x$($r.B - $r.T)"
}
function Find([System.Windows.Automation.Condition]$condition) { $root.FindFirst($scope, $condition) }
function Named([string]$name) { New-Object System.Windows.Automation.PropertyCondition($ui::NameProperty, $name) }
function Invoke($element) { $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 1200 }
function Palette { Find (New-Object System.Windows.Automation.AndCondition((Named 'Command palette'), (New-Object System.Windows.Automation.PropertyCondition($ui::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))) }

Shoot 'layout.png'

$add = Find (Named 'Add project')
if (-not $add) { throw "T3 Code has no 'Add project' button: its layout has changed, so the page's labels need checking too." }
Invoke $add
try {
  $device = $root.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -and $_.Current.Name -like '* This device' } |
    Select-Object -First 1
  if ($device) { Invoke $device }
  Shoot 'new-workspace.png'
}
finally {
  # Esc, sent to the page inside T3 Code's window, closes the box without adding anything.
  $pages = New-Object System.Collections.ArrayList
  [T3Shot]::EnumChildWindows($window, { param($h, $l)
      $name = New-Object System.Text.StringBuilder 256; [T3Shot]::GetClassName($h, $name, 256) | Out-Null
      if ($name.ToString() -eq 'Chrome_RenderWidgetHostHWND') { [void]$pages.Add($h) }; $true }, [IntPtr]::Zero) | Out-Null
  for ($try = 0; $try -lt 3 -and (Palette); $try++) {
    foreach ($h in $pages) {
      [T3Shot]::PostMessage($h, 0x0100, [IntPtr]0x1B, [IntPtr]0x00010001) | Out-Null
      [T3Shot]::PostMessage($h, 0x0101, [IntPtr]0x1B, [IntPtr]([int64]0xC0010001)) | Out-Null
    }
    Start-Sleep -Milliseconds 600
  }
  if (Palette) { Write-Warning "The box is still open in T3 Code: press Esc there to close it. Nothing was added." }
}
