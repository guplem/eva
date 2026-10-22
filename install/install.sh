#!/bin/sh
# Installs Eva on Linux with one command:
#   curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
# It installs git, and the OpenMP library for voice notes, when they are missing. It downloads Eva
# from the latest release, checks the download against SHA256SUMS, puts it in ~/.local/bin, and
# starts `eva setup`. A second run updates Eva.
# EVA_INSTALL_BASE_URL downloads from another place, and EVA_INSTALL_SKIP_SETUP=1 skips the setup.
# The CI uses both (scripts/smoke-install.sh).
set -eu

base_url="${EVA_INSTALL_BASE_URL:-https://github.com/guplem/eva/releases/latest/download}"
bin_folder="$HOME/.local/bin"
path_added=""

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'The Eva install stopped: %s\n' "$*" >&2
  exit 1
}

asset_name() {
  case "$(uname -s)" in
    Linux) ;;
    Darwin) fail "Eva has no macOS build yet." ;;
    *) fail "this script is for Linux. On Windows, use install.ps1." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) echo "eva-linux-x64" ;;
    aarch64 | arm64) echo "eva-linux-arm64" ;;
    *) fail "Eva has no build for the processor $(uname -m)." ;;
  esac
}

# Under `curl | sh`, the input is the rest of this script: a package manager that reads its
# input would eat it. sudo asks for the password on the terminal, not on the input. The package
# manager's own lines stay hidden, so that the install reads as a few clear lines; errors still show.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@" </dev/null >/dev/null
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@" </dev/null >/dev/null
  else
    fail "git needs an administrator to install. Install git, then run this command again."
  fi
}

# whisper.cpp, for voice notes, needs the OpenMP library. Ubuntu Server does not have it. Eva
# installs voice notes later from the web page, where sudo cannot ask for a password.
has_openmp() {
  { ldconfig -p || /sbin/ldconfig -p; } 2>/dev/null | grep -q 'libgomp\.so\.1'
}

# Installs the tools in $1 and, when $2 is not empty, the OpenMP library. Each package manager
# names the library in its own way. $packages is a list of words on purpose. NEEDRESTART_SUSPEND
# keeps Ubuntu's service check (needrestart) from taking over the screen after the install.
install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    packages="$1${2:+ libgomp1}"
    as_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get update -qq
    as_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq $packages
  elif command -v dnf >/dev/null 2>&1; then
    packages="$1${2:+ libgomp}"
    as_root dnf install -y $packages
  elif command -v pacman >/dev/null 2>&1; then
    packages="$1${2:+ gcc-libs}"
    as_root pacman -S --noconfirm --needed $packages
  elif command -v zypper >/dev/null 2>&1; then
    packages="$1${2:+ libgomp1}"
    as_root zypper --non-interactive install $packages
  elif command -v apk >/dev/null 2>&1; then
    packages="$1${2:+ libgomp}"
    as_root apk add $packages
  else
    return 1
  fi
}

# Eva needs git for the vault. `eva setup` downloads uv and Claude Code with curl. Voice notes
# are optional, so the OpenMP library never stops the install.
install_tools() {
  missing=""
  for tool in git curl; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  openmp=""
  has_openmp || openmp="yes"
  if [ -n "$missing" ]; then
    say "  Installing$missing${openmp:+ and the OpenMP library for voice notes}. It needs administrator rights, so sudo can ask for your password."
    install_packages "$missing" "$openmp" ||
      fail "this system has no package manager that the script knows. Install$missing, then run this command again."
    for tool in $missing; do
      command -v "$tool" >/dev/null 2>&1 || fail "$tool did not install."
      say "  [ok] Installed $tool."
    done
  elif [ -n "$openmp" ] && { [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1; }; then
    say "  Installing the OpenMP library for voice notes. It needs administrator rights, so sudo can ask for your password."
    # The subshell keeps a failed step, such as a refused sudo, from stopping the install.
    (install_packages "" yes) || true
  fi
  [ -z "$openmp" ] && return 0
  if has_openmp; then
    say "  [ok] Installed the OpenMP library."
  else
    say "  Voice notes need the OpenMP library. Install it later with your package manager (libgomp1 on Ubuntu)."
  fi
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1" || fail "the download of $1 failed."
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || fail "the download of $1 failed."
  else
    fail "the download needs curl or wget."
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "the checksum needs sha256sum or shasum."
  fi
}

install_eva() {
  asset="$(asset_name)"
  mkdir -p "$bin_folder"
  # The download folder sits beside eva, so the last move is a rename on one file system.
  temp="$(mktemp -d "$bin_folder/.eva-install.XXXXXX")"
  trap 'rm -rf "$temp"' EXIT
  download "$base_url/SHA256SUMS" "$temp/SHA256SUMS"
  download "$base_url/$asset" "$temp/$asset"
  # A line reads "<hash>  <name>", or "<hash> *<name>" in binary mode.
  expected="$(awk -v name="$asset" '{ file = $2; sub(/^\*/, "", file); if (file == name) print $1 }' "$temp/SHA256SUMS")"
  [ -n "$expected" ] || fail "the release lists no $asset."
  [ "$(sha256_of "$temp/$asset")" = "$expected" ] ||
    fail "the download does not match its checksum, so nothing was installed."
  chmod +x "$temp/$asset"
  # A rename swaps the file in one step, and a running Eva keeps her old file open.
  mv -f "$temp/$asset" "$bin_folder/eva"
}

add_to_path() {
  case ":$PATH:" in
    *":$bin_folder:"*) return 0 ;;
  esac
  # Setup starts the service with this PATH, so the service finds eva, uv and the harnesses.
  PATH="$bin_folder:$PATH"
  export PATH
  path_added="yes"
  # Ubuntu's ~/.profile already adds ~/.local/bin at login. zsh reads no ~/.profile, and a
  # ~/.bash_profile makes bash skip it, so each file that a shell reads gets one line.
  for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ "$file" = "$HOME/.profile" ] || [ -e "$file" ]; then
      if ! grep -qs '\.local/bin' "$file"; then
        printf '\n# Added by the Eva installer.\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$file"
      fi
    fi
  done
}

run_setup() {
  if [ "${EVA_INSTALL_SKIP_SETUP:-}" = "1" ]; then
    say "  Run \`eva setup\` to set Eva up."
    return 0
  fi
  # `curl | sh` gives this script as the input, so setup reads the terminal instead.
  if (exec </dev/tty) 2>/dev/null; then
    "$bin_folder/eva" setup </dev/tty
  else
    say "  Open a terminal, and run \`eva setup\` to set Eva up."
  fi
}

main() {
  say ""
  say "Eva install"
  install_tools
  install_eva
  add_to_path
  say "  [ok] Installed Eva $("$bin_folder/eva" version) in $bin_folder, and checked the download."
  run_setup
  if [ -n "$path_added" ]; then
    say ""
    say "To run eva in this terminal, run: export PATH=\"\$HOME/.local/bin:\$PATH\". New terminals find it by themselves."
  fi
}

main "$@"
