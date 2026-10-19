# Installs Eva on Windows with one command, in PowerShell:
#   irm https://github.com/guplem/eva/releases/latest/download/install.ps1 | iex
# It installs git with winget when it is missing, downloads Eva from the latest release, checks the
# download against SHA256SUMS, puts it in %LOCALAPPDATA%\Programs\Eva, adds that folder to the PATH,
# and starts `eva setup`. A second run updates Eva.
# EVA_INSTALL_BASE_URL downloads from another place, and EVA_INSTALL_SKIP_SETUP=1 skips the setup.
# The CI uses both (scripts/smoke-install.ps1).
# The script never calls `exit`: under `irm | iex`, that closes the person's PowerShell window.

function Install-Eva {
  $ErrorActionPreference = 'Stop'
  # The progress bar makes a download in Windows PowerShell 5.1 many times slower.
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 can start with no TLS 1.2, and GitHub needs it.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $baseUrl = if ($env:EVA_INSTALL_BASE_URL) { $env:EVA_INSTALL_BASE_URL } else { 'https://github.com/guplem/eva/releases/latest/download' }
  $asset = 'eva-windows-x64.exe'
  $folder = Join-Path $env:LOCALAPPDATA 'Programs\Eva'
  $target = Join-Path $folder 'eva.exe'

  Write-Host 'Installing Eva.'
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw 'git is missing, and this computer has no winget to install it. Install git from https://git-scm.com/downloads, then run this command again.'
    }
    Write-Host 'Installing git. Windows can ask for permission.'
    winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
    # This window keeps its old PATH, so read the new one.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      throw 'git did not install. Install git from https://git-scm.com/downloads, then run this command again.'
    }
  }

  $temp = Join-Path ([IO.Path]::GetTempPath()) ('eva-install-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    $sums = Join-Path $temp 'SHA256SUMS'
    $download = Join-Path $temp $asset
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHA256SUMS" -OutFile $sums
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$asset" -OutFile $download
    # A line reads "<hash>  <name>", or "<hash> *<name>" in binary mode.
    $expected = $null
    foreach ($line in Get-Content $sums) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $asset) { $expected = $parts[0] }
    }
    if (-not $expected) { throw "The release lists no $asset." }
    if ((Get-FileHash -Algorithm SHA256 $download).Hash -ne $expected) {
      throw 'The download does not match its checksum, so nothing was installed.'
    }
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    # A running Eva holds her file. Windows cannot overwrite it, but it can rename it.
    Remove-Item -Force "$target.old" -ErrorAction SilentlyContinue
    if (Test-Path $target) { Move-Item -Force $target "$target.old" }
    Move-Item $download $target
  } finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
  }

  # Setup starts the service with this PATH, so the service finds eva, uv and the harnesses.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $folder) {
    [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $folder).TrimStart(';')), 'User')
  }
  if (($env:Path -split ';') -notcontains $folder) { $env:Path = "$env:Path;$folder" }

  Write-Host "Installed Eva $(& $target version) in $folder."
  if ($env:EVA_INSTALL_SKIP_SETUP -eq '1') {
    Write-Host 'Eva is installed. Run `eva setup` to set her up.'
    return
  }
  & $target setup
}

try {
  Install-Eva
} catch {
  Write-Host "The Eva install stopped: $($_.Exception.Message)" -ForegroundColor Red
}
