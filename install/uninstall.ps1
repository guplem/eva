# Removes Eva from Windows with one command, in PowerShell:
#   irm https://github.com/guplem/eva/releases/latest/download/uninstall.ps1 | iex
# It asks before each step, and Enter keeps the safe answer. It stops each Eva that you pick and
# removes her start at logon. Then it can delete her folder, the eva program, and the programs
# that Eva installed for every Eva on this computer. Your notebook on GitHub always stays.
# The CI runs it after the install test (scripts/smoke-install.ps1).
# The script never calls `exit`: under `irm | iex`, that closes the person's PowerShell window.

function Uninstall-Eva {
  $ErrorActionPreference = 'Stop'
  $configFolder = $env:APPDATA
  $programsFolder = Join-Path $env:LOCALAPPDATA 'Programs'
  $evaFolder = Join-Path $programsFolder 'Eva'
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $localBin = Join-Path $HOME '.local\bin'

  # Prints the question, and returns the answer, or the default for an empty answer.
  function Ask([string] $question, [string] $default) {
    $answer = Read-Host "  > $question"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer.Trim()
  }

  # True for a yes. $default is 'y' or 'n'.
  function Confirm-Step([string] $question, [string] $default) {
    $hint = if ($default -eq 'y') { '[Y/n]' } else { '[y/N]' }
    return (Ask "$question $hint" $default) -match '^(y|yes)$'
  }

  # Setup writes config.json, so a folder without it holds no Eva (listInstances in home.ts).
  function Get-Evas {
    @(Get-ChildItem -Path $configFolder -Directory -Filter 'eva-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'config.json') } |
        ForEach-Object { $_.Name.Substring(4) } | Sort-Object)
  }

  # Stops the supervisor first, so that it cannot start Eva again. Eva writes her pid in eva.lock,
  # so an Eva that runs in a terminal stops too.
  function Stop-Eva([string] $name) {
    # In Windows PowerShell 5.1, the error output of a native program stops a script under Stop.
    $ErrorActionPreference = 'SilentlyContinue'
    $evaHome = Join-Path $configFolder "eva-$name"
    $pattern = "--instance\s+`"?$([regex]::Escape($name))`"?(\s|$)"
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'eva(\.exe)?"?\s' -and $_.CommandLine -match $pattern } |
        Sort-Object { if ($_.CommandLine -match '\ssupervise\s') { 0 } else { 1 } })
    foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    $lock = Join-Path $evaHome 'eva.lock'
    if (Test-Path $lock) {
      $lockPid = 0
      if ([int]::TryParse(((Get-Content $lock -TotalCount 1) -as [string]).Trim(), [ref] $lockPid)) {
        # After a reboot, another program can have the old pid: stop it only when it is Eva.
        $process = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'eva') { Stop-Process -Id $lockPid -Force -ErrorAction SilentlyContinue }
      }
    }
    Remove-ItemProperty -Path $runKey -Name "Eva-$name" -ErrorAction SilentlyContinue
    # An older Eva started from a scheduled task, which only an administrator can delete.
    schtasks /Query /TN "Eva-$name" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      schtasks /Delete /TN "Eva-$name" /F 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "  The scheduled task Eva-$name stays. In PowerShell as an administrator, run: schtasks /Delete /TN Eva-$name /F"
      }
    }
    Write-Host "  [ok] Stopped Eva `"$name`", and removed her start at logon."
  }

  # Each git folder under the Eva folder with changes that are not on its remote yet: the
  # notebook copy, and the clones of its projects.
  function Get-UnsavedWork([string] $evaHome) {
    $ErrorActionPreference = 'SilentlyContinue'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return @() }
    $vault = Join-Path $evaHome 'vault'
    $repositories = @($vault) + @(Get-ChildItem -Path (Join-Path $vault 'Projects\*\repos\*') -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName })
    @($repositories | Where-Object {
        (Test-Path (Join-Path $_ '.git')) -and (
          (git -C $_ status --porcelain 2>$null) -or (git -C $_ log --branches --not --remotes --oneline 2>$null))
      })
  }

  function Remove-EvaFolder([string] $name) {
    $evaHome = Join-Path $configFolder "eva-$name"
    $unsaved = @(Get-UnsavedWork $evaHome)
    if ($unsaved.Count -gt 0) {
      Write-Host '  These folders have changes that are not on GitHub yet. A delete loses them:'
      foreach ($folder in $unsaved) { Write-Host "    $folder" }
    }
    if (Confirm-Step "Delete her folder $evaHome too? It holds her settings, logins, logs and copy of your notebook." 'n') {
      try {
        Remove-Item -Recurse -Force $evaHome
      } catch {
        # A program that just stopped can still hold a file for a moment.
        Start-Sleep -Seconds 3
        Remove-Item -Recurse -Force $evaHome
      }
      Write-Host "  [ok] Deleted $evaHome."
    } else {
      Write-Host "  Kept $evaHome. A new install of Eva finds her again."
    }
  }

  # Takes the folder out of the user PATH. The raw registry value keeps entries such as
  # %USERPROFILE%\bin as they are, as in install.ps1.
  function Remove-FromUserPath([string] $folder) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $userPath = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $entries = @($userPath -split ';' | Where-Object { $_ -ne '' })
      $kept = @($entries | Where-Object { $_.TrimEnd('\') -ne $folder.TrimEnd('\') })
      if ($kept.Count -ne $entries.Count) {
        $key.SetValue('Path', ($kept -join ';'), $key.GetValueKind('Path'))
        # A change through .NET tells open programs, such as Explorer, to read the new PATH.
        [Environment]::SetEnvironmentVariable('EVA_UNINSTALL_PATH_CHANGED', '1', 'User')
        [Environment]::SetEnvironmentVariable('EVA_UNINSTALL_PATH_CHANGED', $null, 'User')
      }
    } finally {
      $key.Close()
    }
  }

  function Remove-OwnProgram([string] $label, [string] $folderName) {
    $folder = Join-Path $programsFolder $folderName
    if (-not (Test-Path $folder)) { return }
    if (Confirm-Step "Remove $label ($folder)?" 'n') {
      Remove-Item -Recurse -Force $folder
      Write-Host "  [ok] Removed $label."
    }
  }

  function Remove-Tailscale {
    $ErrorActionPreference = 'SilentlyContinue'
    $program = if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' } else { $null }
    if (-not $program -or -not (Test-Path $program)) { return }
    if (-not (Confirm-Step 'Remove Tailscale? Your phone then cannot reach this computer. Windows can ask for permission.' 'n')) { return }
    # A logout removes this computer from your Tailscale network too.
    & $program logout 2>$null | Out-Null
    winget uninstall --id Tailscale.Tailscale --exact --silent --disable-interactivity | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  [ok] Removed Tailscale.' } else { Write-Host '  Tailscale stays. Remove it in Settings -> Apps.' }
  }

  # Claude Code and uv come from their official installers. These are the steps of their own guides.
  function Remove-ClaudeCode {
    $program = Join-Path $localBin 'claude.exe'
    $data = Join-Path $HOME '.local\share\claude'
    if (-not (Test-Path $program) -and -not (Test-Path $data)) { return }
    if (Confirm-Step "Remove Claude Code ($program)? Your own Claude Code settings in ~\.claude stay." 'n') {
      Remove-Item -Recurse -Force $program, $data -ErrorAction SilentlyContinue
      Write-Host '  [ok] Removed Claude Code.'
    }
  }

  function Remove-Uv {
    $ErrorActionPreference = 'SilentlyContinue'
    $program = Join-Path $localBin 'uv.exe'
    if (-not (Test-Path $program)) { return }
    if (Confirm-Step "Remove uv ($program), its cache, and the tools and Python versions that it installed?" 'n') {
      & $program cache clean 2>$null | Out-Null
      foreach ($folder in @((& $program python dir 2>$null), (& $program tool dir 2>$null))) {
        if ($folder) { Remove-Item -Recurse -Force $folder -ErrorAction SilentlyContinue }
      }
      Remove-Item -Force $program, (Join-Path $localBin 'uvx.exe'), (Join-Path $localBin 'uvw.exe') -ErrorAction SilentlyContinue
      Write-Host '  [ok] Removed uv.'
    }
  }

  Write-Host ''
  Write-Host 'Eva uninstall'
  Write-Host '  Each question has a safe answer in [brackets]. Press Enter to keep it, or Ctrl+C to stop.'

  $evas = @(Get-Evas)
  $chosen = @()
  if ($evas.Count -eq 0) {
    Write-Host "  This computer has no Eva in $configFolder."
  } else {
    Write-Host "  The Evas on this computer: $($evas -join ' ')"
    $answer = Ask 'Which Eva do you want to remove? Type her name, or press Enter for all. [all]' 'all'
    if ($answer -eq 'all') {
      $chosen = $evas
    } elseif ($evas -contains $answer) {
      $chosen = @($answer)
    } else {
      throw "This computer has no Eva named `"$answer`"."
    }
  }

  foreach ($name in $chosen) {
    Write-Host ''
    Write-Host "Eva `"$name`""
    Stop-Eva $name
    Remove-EvaFolder $name
  }

  # Another Eva still needs the program and the shared programs.
  if (@(Get-Evas).Count -gt 0 -and $chosen.Count -lt $evas.Count) {
    Write-Host ''
    Write-Host 'Other Evas still use this computer, so the eva program stays.'
    return
  }
  Write-Host ''
  if ((Test-Path $evaFolder) -and (Confirm-Step "Remove the eva program ($evaFolder)?" 'y')) {
    Remove-Item -Recurse -Force $evaFolder
    Remove-FromUserPath $evaFolder
    Write-Host '  [ok] Removed the eva program.'
  }

  Write-Host ''
  Write-Host 'Eva installed some programs that every Eva on this computer uses. Other programs can use them too.'
  Remove-OwnProgram 'pi' 'pi'
  Remove-OwnProgram 'gh, the GitHub program' 'gh'
  Remove-OwnProgram 'ffmpeg' 'ffmpeg'
  Remove-OwnProgram 'whisper.cpp' 'whisper.cpp'
  Remove-Tailscale
  Remove-ClaudeCode
  Remove-Uv

  Write-Host ''
  Write-Host 'Eva is removed from this computer. These steps happen outside it:'
  Write-Host '  - Your notebook stays on GitHub. To delete it, open the repository on GitHub, then Settings.'
  Write-Host "  - GitHub: revoke Eva's login under Settings -> Applications."
  Write-Host '  - Telegram: send /deletebot to @BotFather to delete your bot.'
  Write-Host '  - Tailscale: remove this computer at https://login.tailscale.com/admin/machines if it is still there.'
  Write-Host "  - Phone: delete Eva's icon from the home screen."
}

try {
  Uninstall-Eva
} catch {
  Write-Host "The Eva uninstall stopped: $($_.Exception.Message)" -ForegroundColor Red
}
