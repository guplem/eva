# Eva's icon in the Windows system tray. src/frontends/cli/tray.ts runs this script and owns
# every decision. Each input line is a JSON view: face, tooltip, title and canOpen. Each menu
# choice writes one output line: open, restart or quit. When the input ends, the icon goes away.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# The colours of src/frontends/web/icons/icon.svg: EVE's visor and her blue eyes, with no glow at this size.
$visorTop = [System.Drawing.Color]::FromArgb(255, 0x1c, 0x25, 0x2d)
$visorBottom = [System.Drawing.Color]::FromArgb(255, 0x00, 0x01, 0x02)
$eyeColour = [System.Drawing.Color]::FromArgb(255, 0x87, 0xdd, 0xff)

# One eye on a 100-unit face: an ellipse with its centre, size and tilt in degrees.
function Draw-Eye($graphics, $brush, $x, $y, $width, $height, $angle) {
  $state = $graphics.Save()
  $graphics.TranslateTransform($x, $y)
  $graphics.RotateTransform($angle)
  $graphics.FillEllipse($brush, (-$width / 2), (-$height / 2), $width, $height)
  $graphics.Restore($state)
}

function Draw-Cross($graphics, $pen, $x, $y) {
  $graphics.DrawLine($pen, $x - 9, 36, $x + 9, 54)
  $graphics.DrawLine($pen, $x + 9, 36, $x - 9, 54)
}

# The eyes of each face, as visor.css draws them, simplified for 16 to 32 pixels.
function Draw-Eyes($graphics, $face, $brush) {
  switch ($face) {
    'thinking' { Draw-Eye $graphics $brush 30 45 22 14 0; Draw-Eye $graphics $brush 70 45 19 12 0 }
    'listening' { Draw-Eye $graphics $brush 30 45 20 20 0; Draw-Eye $graphics $brush 70 45 20 20 0 }
    'focused' { Draw-Eye $graphics $brush 30 45 29 8 6; Draw-Eye $graphics $brush 70 45 29 8 -6 }
    'firm' { Draw-Eye $graphics $brush 30 45 26 13 20; Draw-Eye $graphics $brush 70 45 26 13 -20 }
    'worried' { Draw-Eye $graphics $brush 30 45 26 14 -14; Draw-Eye $graphics $brush 70 45 26 14 14 }
    'sad' { Draw-Eye $graphics $brush 30 48 26 12 -18; Draw-Eye $graphics $brush 70 48 26 12 18 }
    'asleep' { Draw-Eye $graphics $brush 30 49 26 6 0; Draw-Eye $graphics $brush 70 49 26 6 0 }
    'error' {
      $pen = New-Object System.Drawing.Pen($brush.Color, 6)
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      Draw-Cross $graphics $pen 30 45
      Draw-Cross $graphics $pen 70 45
      $pen.Dispose()
    }
    default { Draw-Eye $graphics $brush 29 45 26 16 14; Draw-Eye $graphics $brush 71 45 26 16 -14 }
  }
}

function New-FaceIcon($face) {
  $size = 32
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 100, $size / 100)
  $visor = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Point]::new(0, 5), [System.Drawing.Point]::new(0, 95), $visorTop, $visorBottom)
  $graphics.FillEllipse($visor, 1, 6, 98, 88)
  $eyes = New-Object System.Drawing.SolidBrush($eyeColour)
  Draw-Eyes $graphics $face $eyes
  $graphics.Dispose()
  $visor.Dispose()
  $eyes.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $bitmap.Dispose()
  return $icon
}

function Send-Choice($choice) {
  [Console]::Out.WriteLine($choice)
  [Console]::Out.Flush()
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$titleItem = $menu.Items.Add('Eva')
$titleItem.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$openItem = $menu.Items.Add('Open Eva')
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.add_Click({ Send-Choice 'open' })
$restartItem = $menu.Items.Add('Restart Eva')
$restartItem.add_Click({ Send-Choice 'restart' })
$quitItem = $menu.Items.Add('Quit Eva')
$quitItem.add_Click({ Send-Choice 'quit' })
$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.add_MouseDoubleClick({ if ($openItem.Enabled) { Send-Choice 'open' } })

$icons = @{}
function Show-View($view) {
  $face = [string]$view.face
  if (-not $icons.ContainsKey($face)) { $icons[$face] = New-FaceIcon $face }
  $notifyIcon.Icon = $icons[$face]
  $notifyIcon.Text = [string]$view.tooltip
  $titleItem.Text = [string]$view.title
  $openItem.Enabled = [bool]$view.canOpen
  $notifyIcon.Visible = $true
}

# WinForms needs this thread for its message loop, so a timer reads the input between messages.
# Not [Console]::In: its ReadLineAsync waits for the line, and the menu would freeze. Eva writes UTF-8.
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
$pending = $reader.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.add_Tick({
  while ($pending.IsCompleted) {
    $line = if ($pending.IsFaulted) { $null } else { $pending.Result }
    if ($null -eq $line) {
      $timer.Stop()
      [System.Windows.Forms.Application]::Exit()
      return
    }
    try { Show-View ($line | ConvertFrom-Json) } catch { [Console]::Error.WriteLine($_.Exception.Message) }
    $script:pending = $reader.ReadLineAsync()
  }
})
$timer.Start()
try {
  [System.Windows.Forms.Application]::Run()
} finally {
  # Without this, the icon stays in the tray until the mouse passes over it.
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
}
