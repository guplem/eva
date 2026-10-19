#!/bin/sh
# Installs Eva on Linux with one command:
#   curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
# It installs git when it is missing, downloads Eva from the latest release, checks the download
# against SHA256SUMS, puts it in ~/.local/bin, and starts `eva setup`. A second run updates Eva.
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

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "git needs an administrator to install. Install git, then run this command again."
  fi
}

install_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  say "Installing git. It needs administrator rights, so it can ask for your password."
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -qq
    as_root apt-get install -y -qq git
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y git
  elif command -v pacman >/dev/null 2>&1; then
    as_root pacman -S --noconfirm --needed git
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install git
  elif command -v apk >/dev/null 2>&1; then
    as_root apk add git
  else
    fail "this system has no package manager that the script knows. Install git, then run this command again."
  fi
  command -v git >/dev/null 2>&1 || fail "git did not install."
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
  temp="$(mktemp -d)"
  trap 'rm -rf "$temp"' EXIT
  download "$base_url/SHA256SUMS" "$temp/SHA256SUMS"
  download "$base_url/$asset" "$temp/$asset"
  # A line reads "<hash>  <name>", or "<hash> *<name>" in binary mode.
  expected="$(awk -v name="$asset" '{ file = $2; sub(/^\*/, "", file); if (file == name) print $1 }' "$temp/SHA256SUMS")"
  [ -n "$expected" ] || fail "the release lists no $asset."
  [ "$(sha256_of "$temp/$asset")" = "$expected" ] ||
    fail "the download does not match its checksum, so nothing was installed."
  mkdir -p "$bin_folder"
  chmod +x "$temp/$asset"
  # A running Eva keeps her old file open, so the move is safe while she runs.
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
  # Ubuntu's ~/.profile already adds ~/.local/bin at login. Other systems get one line.
  if ! grep -qs '\.local/bin' "$HOME/.profile"; then
    printf '\n# Added by the Eva installer.\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.profile"
  fi
}

run_setup() {
  if [ "${EVA_INSTALL_SKIP_SETUP:-}" = "1" ]; then
    say "Eva is installed. Run \`eva setup\` to set her up."
    return 0
  fi
  # `curl | sh` gives this script as the input, so setup reads the terminal instead.
  if (exec </dev/tty) 2>/dev/null; then
    "$bin_folder/eva" setup </dev/tty
  else
    say "Eva is installed. Open a terminal, and run \`eva setup\`."
  fi
}

main() {
  say "Installing Eva."
  install_git
  install_eva
  add_to_path
  say "Installed Eva $("$bin_folder/eva" version) in $bin_folder."
  run_setup
  if [ -n "$path_added" ]; then
    say "To run eva in this terminal, run: export PATH=\"\$HOME/.local/bin:\$PATH\". New terminals find it by themselves."
  fi
}

main "$@"
