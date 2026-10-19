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
$server = Start-Process python -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', $root -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 3
  # Eva goes into a new LOCALAPPDATA, so the check sees only this install.
  $env:LOCALAPPDATA = Join-Path $root 'local'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA | Out-Null
  $env:EVA_INSTALL_SKIP_SETUP = '1'

  $env:EVA_INSTALL_BASE_URL = 'http://127.0.0.1:8765/bad'
  irm 'http://127.0.0.1:8765/bad/install.ps1' | iex
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
  Write-Host 'The install script passed the smoke test.'
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  # The runner keeps no user PATH change after the job, but a local run should not keep one.
  $cleaned = ([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ -and $_ -ne (Split-Path $target) }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $cleaned, 'User')
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
