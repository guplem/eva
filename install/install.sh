#!/bin/sh
# Installs Eva on Linux with one command:
#   curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
# It installs git, the OpenMP library for voice notes, and bubblewrap and socat for the shell
# sandbox, when they are missing. It downloads Eva from the latest release, checks the download
# against SHA256SUMS, puts it in ~/.local/bin, and starts `eva setup`. A second run updates Eva.
# EVA_INSTALL_BASE_URL downloads from another place, and EVA_INSTALL_SKIP_SETUP=1 skips the setup.
# The CI uses both (scripts/smoke-install.sh).
set -eu

base_url="${EVA_INSTALL_BASE_URL:-https://github.com/guplem/eva/releases/latest/download}"
bin_folder="$HOME/.local/bin"
path_added=""
lists_updated=""
lock_explained=""

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
    fail "the packages need an administrator to install."
  fi
}

can_be_root() {
  [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1
}

package_manager() {
  for manager in apt-get dnf pacman zypper apk; do
    if command -v "$manager" >/dev/null 2>&1; then
      echo "$manager"
      return 0
    fi
  done
  return 1
}

# Runs apt-get. On a failure, it shows the errors of apt and explains a held lock once. A stuck apt
# process, such as a hung daily update, can hold a lock for months (#898). LC_ALL=C keeps the
# errors in English, so the lock check finds them. NEEDRESTART_SUSPEND keeps Ubuntu's service check
# (needrestart) from taking over the screen.
run_apt() {
  if errors="$(as_root env LC_ALL=C DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get "$@" 2>&1)"; then
    return 0
  fi
  printf '%s\n' "$errors" >&2
  if [ -z "$lock_explained" ] && printf '%s\n' "$errors" | grep -qE 'Could not get lock|Unable to lock'; then
    lock_explained="yes"
    say "  Another apt process holds a lock of apt. It can be a stuck daily update. Wait for it to end, or end it with \`sudo kill <its process number>\`."
  fi
  return 1
}

# Old package lists name files that the mirror no longer has, so an install with them fails.
# The lists update once per run, so a failure prints one explanation.
update_package_lists() {
  [ -z "$lists_updated" ] || return 0
  lists_updated="yes"
  [ "$(package_manager)" = "apt-get" ] || return 0
  run_apt update -qq ||
    say "  apt did not update its package lists, so an install can fail. Fix the cause, then run: sudo apt-get update"
}

# whisper.cpp, for voice notes, needs the OpenMP library. Ubuntu Server does not have it. Eva
# installs voice notes later from the web page, where sudo cannot ask for a password.
has_openmp() {
  { ldconfig -p || /sbin/ldconfig -p; } 2>/dev/null | grep -q 'libgomp\.so\.1'
}

# Prints the packages, each after a space: the tools in $1, the OpenMP library when $2 is not empty,
# and the shell sandbox when $3 is not empty. Each package manager names the library in its own way.
package_names() {
  case "$(package_manager)" in
    pacman) openmp_package="gcc-libs" ;;
    dnf | apk) openmp_package="libgomp" ;;
    *) openmp_package="libgomp1" ;;
  esac
  echo "$1${2:+ $openmp_package}${3:+ bubblewrap socat}"
}

# Installs the packages that package_names gives for $1, $2 and $3. $packages is a list of words on
# purpose.
install_packages() {
  packages="$(package_names "$1" "$2" "$3")"
  case "$(package_manager)" in
    apt-get) run_apt install -y -qq $packages ;;
    dnf) as_root dnf install -y $packages ;;
    pacman) as_root pacman -S --noconfirm --needed $packages ;;
    zypper) as_root zypper --non-interactive install $packages ;;
    apk) as_root apk add $packages ;;
    *) return 1 ;;
  esac
}

# Says that an optional package is missing: $1 says what needs it. It gives the command that
# installs the OpenMP library when $2 is not empty, and the shell sandbox when $3 is not empty.
say_install_later() {
  packages="$(package_names "" "$2" "$3")"
  # root has no need for sudo, and a container often has no sudo.
  sudo="sudo "
  [ "$(id -u)" -ne 0 ] || sudo=""
  case "$(package_manager)" in
    apt-get) later="${sudo}apt-get update && ${sudo}apt-get install$packages" ;;
    dnf) later="${sudo}dnf install$packages" ;;
    pacman) later="${sudo}pacman -S$packages" ;;
    zypper) later="${sudo}zypper install$packages" ;;
    apk) later="${sudo}apk add$packages" ;;
    *) later="" ;;
  esac
  if [ -n "$later" ]; then
    say "  $1 To install later, run: $later"
  else
    say "  $1 Install later with your package manager."
  fi
}

has_sandbox() {
  command -v bwrap >/dev/null 2>&1 && command -v socat >/dev/null 2>&1
}

# Eva needs git for the vault. `eva setup` downloads uv and Claude Code with curl. Voice notes and
# the shell sandbox of Claude Code are optional, so neither stops the install. The sandbox keeps the
# shell of a Project chat out of the vault (#711). An Eva from before it gets it from a second run.
install_tools() {
  missing=""
  for tool in git curl; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  openmp=""
  has_openmp || openmp="yes"
  sandbox=""
  has_sandbox || sandbox="yes"
  if [ -n "$missing" ]; then
    package_manager >/dev/null ||
      fail "this system has no package manager that the script knows. Install$missing, then run this command again."
    can_be_root || fail "an administrator must install$missing, and this user has no sudo. Then run this command again."
    say "  Installing$missing. It needs administrator rights, so sudo can ask for your password."
    update_package_lists
    install_packages "$missing" "" "" || true
    for tool in $missing; do
      command -v "$tool" >/dev/null 2>&1 || fail "$tool did not install."
      say "  [ok] Installed $tool."
    done
  fi
  [ -z "$openmp$sandbox" ] && return 0
  if can_be_root; then
    # Each one alone, so a package that this system lacks does not stop the other.
    # The subshell keeps a failed step, such as a refused sudo, from stopping the install.
    if [ -n "$openmp" ]; then
      say "  Installing the OpenMP library for voice notes. It needs administrator rights, so sudo can ask for your password."
      update_package_lists
      (install_packages "" yes "") || true
    fi
    if [ -n "$sandbox" ]; then
      say "  Installing bubblewrap and socat, the shell sandbox of Project chats. It needs administrator rights, so sudo can ask for your password."
      update_package_lists
      (install_packages "" "" yes) || true
    fi
  fi
  if [ -n "$openmp" ]; then
    if has_openmp; then
      say "  [ok] Installed the OpenMP library."
    else
      say_install_later "Voice notes need the OpenMP library." yes ""
    fi
  fi
  if [ -n "$sandbox" ]; then
    if has_sandbox; then
      say "  [ok] Installed bubblewrap and socat."
    else
      say_install_later "The shell of a Project chat needs bubblewrap and socat to stay out of the vault." "" yes
    fi
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
