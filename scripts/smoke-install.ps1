# Checks install/install.ps1 the way a new person runs it: `irm ... | iex` in Windows PowerShell,
# from a fake release that a local web server serves, with the given executable.
# Usage: powershell -File scripts/smoke-install.ps1 <path to the Windows executable>
param([Parameter(Mandatory)] [string] $Executable)
$ErrorActionPreference = 'Stop'

$root = Join-Path ([IO.Path]::GetTempPath()) ('eva-smoke-install-' + [guid]::NewGuid())
$release = Join-Path $root 'release'
$bad = Join-Path $root 'bad'
New-Item -ItemType Directory -Path $release, $bad | Out-Null
Copy-Item $Executable (Join-Path $release 'eva-windows-x64.exe')
Copy-Item 'install/install.ps1' (Join-Path $release 'install.ps1')
$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $release 'eva-windows-x64.exe')).Hash.ToLower()
Set-Content -Path (Join-Path $release 'SHA256SUMS') -Value "$hash  eva-windows-x64.exe"
# A release whose checksum does not match its executable.
Copy-Item (Join-Path $release 'eva-windows-x64.exe'), (Join-Path $release 'install.ps1') $bad
Set-Content -Path (Join-Path $bad 'SHA256SUMS') -Value ('0' * 64 + '  eva-windows-x64.exe')

$target = Join-Path $root 'local\Programs\Eva\eva.exe'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$originalPath = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$originalKind = if ($null -ne $originalPath) { $key.GetValueKind('Path') } else { $null }
$key.Close()
$server = Start-Process python -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', $root -PassThru -WindowStyle Hidden
try {
  # A slow runner can take more than a few seconds to start the server: wait until it answers.
  $deadline = (Get-Date).AddSeconds(60)
  while ($true) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/release/SHA256SUMS' | Out-Null
      break
    } catch {
      if ((Get-Date) -gt $deadline) { throw 'The local web server did not start within 60 seconds.' }
      Start-Sleep -Milliseconds 500
    }
  }
  # Eva goes into a new LOCALAPPDATA, so the check sees only this install.
  $env:LOCALAPPDATA = Join-Path $root 'local'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA | Out-Null
  $env:EVA_INSTALL_SKIP_SETUP = '1'

  $env:EVA_INSTALL_BASE_URL = 'http://127.0.0.1:8765/bad'
  # The script prints its errors instead of throwing them, so the test reads what it printed.
  $output = irm 'http://127.0.0.1:8765/bad/install.ps1' | iex 6>&1 | Out-String
  if ($output -notmatch 'does not match its checksum') { throw "The bad release did not stop on its checksum: $output" }
  if (Test-Path $target) { throw 'The install went on with a wrong checksum.' }

  $env:EVA_INSTALL_BASE_URL = 'http://127.0.0.1:8765/release'
  irm 'http://127.0.0.1:8765/release/install.ps1' | iex
  & $target version
  if ($LASTEXITCODE -ne 0) { throw 'The installed Eva does not start.' }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($userPath -split ';') -notcontains (Split-Path $target)) { throw 'The user PATH lacks the Eva folder.' }

  # A second run replaces Eva, and adds the folder to the PATH only once.
  irm 'http://127.0.0.1:8765/release/install.ps1' | iex
  & $target version
  if ($LASTEXITCODE -ne 0) { throw 'Eva does not start after a second install.' }
  $count = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ -eq (Split-Path $target) }).Count
  if ($count -ne 1) { throw "The user PATH holds the Eva folder $count times." }

  # With no git, the script asks winget for an install for this user first, and for every user
  # only when that fails. A stand-in records each call: under `iex`, a function wins over winget.exe.
  # Git stays installed on the computer, so the PATH refresh after winget finds it again.
  $fullPath = $env:Path
  foreach ($userInstallFails in $false, $true) {
    $env:Path = ($fullPath -split ';' | Where-Object { $_ -notmatch '\\Git\\' }) -join ';'
    if (Get-Command git -ErrorAction SilentlyContinue) { throw 'The test could not hide git.' }
    $global:wingetCalls = @()
    $global:userInstallFails = $userInstallFails
    function global:winget {
      $global:wingetCalls += , ($args -join ' ')
      $global:LASTEXITCODE = if ($global:userInstallFails -and ($args -contains '--scope')) { 1 } else { 0 }
    }
    irm 'http://127.0.0.1:8765/release/install.ps1' | iex
    Remove-Item function:global:winget
    $expected = if ($userInstallFails) { 2 } else { 1 }
    if ($global:wingetCalls.Count -ne $expected) { throw "winget ran $($global:wingetCalls.Count) times: $($global:wingetCalls -join ' | ')" }
    if ($global:wingetCalls[0] -notmatch 'install --id Git\.Git .*--scope user$') { throw "The first winget call was: $($global:wingetCalls[0])" }
    if ($userInstallFails -and $global:wingetCalls[1] -match '--scope') { throw "The second winget call was: $($global:wingetCalls[1])" }
  }
  $env:Path = $fullPath
  Write-Host 'The install script passed the smoke test.'
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  # A local run gives back the user PATH exactly as it was, with its registry kind.
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  if ($null -eq $originalPath) { $key.DeleteValue('Path', $false) } else { $key.SetValue('Path', $originalPath, $originalKind) }
  $key.Close()
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
