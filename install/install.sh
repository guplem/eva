#!/bin/sh
# Installs Eva on Linux with one command:
#   curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
# It installs git, the OpenMP library for voice notes, and bubblewrap and socat for the shell
# sandbox, when they are missing. Where AppArmor blocks bubblewrap, as on Ubuntu 24.04, it adds a
# profile that lets bubblewrap run. It downloads Eva from the latest release, checks the download
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

# Installs the tools in $1, the OpenMP library when $2 is not empty, and the shell sandbox when $3 is
# not empty. Each package manager names the library in its own way. $packages is a list of words on
# purpose. NEEDRESTART_SUSPEND keeps Ubuntu's service check (needrestart) from taking over the screen.
install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    packages="$1${2:+ libgomp1}${3:+ bubblewrap socat}"
    as_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get update -qq
    as_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq $packages
  elif command -v dnf >/dev/null 2>&1; then
    packages="$1${2:+ libgomp}${3:+ bubblewrap socat}"
    as_root dnf install -y $packages
  elif command -v pacman >/dev/null 2>&1; then
    packages="$1${2:+ gcc-libs}${3:+ bubblewrap socat}"
    as_root pacman -S --noconfirm --needed $packages
  elif command -v zypper >/dev/null 2>&1; then
    packages="$1${2:+ libgomp1}${3:+ bubblewrap socat}"
    as_root zypper --non-interactive install $packages
  elif command -v apk >/dev/null 2>&1; then
    packages="$1${2:+ libgomp}${3:+ bubblewrap socat}"
    as_root apk add $packages
  else
    return 1
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
    say "  Installing$missing. It needs administrator rights, so sudo can ask for your password."
    install_packages "$missing" "" "" ||
      fail "this system has no package manager that the script knows. Install$missing, then run this command again."
    for tool in $missing; do
      command -v "$tool" >/dev/null 2>&1 || fail "$tool did not install."
      say "  [ok] Installed $tool."
    done
  fi
  [ -z "$openmp$sandbox" ] && return 0
  if [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1; then
    # Each one alone, so a package that this system lacks does not stop the other.
    # The subshell keeps a failed step, such as a refused sudo, from stopping the install.
    if [ -n "$openmp" ]; then
      say "  Installing the OpenMP library for voice notes. It needs administrator rights, so sudo can ask for your password."
      (install_packages "" yes "") || true
    fi
    if [ -n "$sandbox" ]; then
      say "  Installing bubblewrap and socat, the shell sandbox of Project chats. It needs administrator rights, so sudo can ask for your password."
      (install_packages "" "" yes) || true
    fi
  fi
  if [ -n "$openmp" ]; then
    if has_openmp; then
      say "  [ok] Installed the OpenMP library."
    else
      say "  Voice notes need the OpenMP library. Install it later with your package manager (libgomp1 on Ubuntu)."
    fi
  fi
  if [ -n "$sandbox" ]; then
    if has_sandbox; then
      say "  [ok] Installed bubblewrap and socat."
    else
      say "  The shell of a Project chat needs bubblewrap and socat to stay out of the vault. Install them later with your package manager."
    fi
  fi
}

# Ubuntu 24.04 lets a program make a user namespace only when an AppArmor profile allows it, and it
# ships no profile for bubblewrap, so the shell sandbox cannot start (#903). There, this adds the
# profile of Claude Code's docs. A newer Ubuntu ships its own profile: then this removes Eva's profile.
# The mark and the rules that find a profile for bubblewrap match src/core/shell-wall.ts and
# install/uninstall.sh.
apparmor_folder="/etc/apparmor.d"
eva_profile="$apparmor_folder/bwrap"
eva_profile_mark="Added by the Eva installer"
# EVA_INSTALL_USERNS_FILE replaces the setting of the kernel in the CI (scripts/smoke-install.sh).
userns_file="${EVA_INSTALL_USERNS_FILE:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}"
sandbox_guide="https://github.com/guplem/eva/blob/main/docs/guide/reference.md#apparmor-and-bubblewrap"
# A profile line, not a rule: a rule inside a profile ends with a comma, a profile line with "{".
# It covers bubblewrap when it has the name bwrap, or a path that covers /usr/bin/bwrap.
named_bwrap='^[[:space:]]*profile[[:space:]]+bwrap([[:space:]]|\{|$)'
bwrap_profile_line='^[[:space:]]*(profile[[:space:]]+bwrap([[:space:]]|\{|$)|(profile[[:space:]]+([^[:space:]{]+[[:space:]]+)?)?"?(/usr/bin|/\{,usr/\}bin|/\{usr/,\}bin|@\{bin\})/bwrap"?([[:space:]]+(flags[[:space:]]*=[[:space:]]*)?\([^)]*\))?[[:space:]]*\{)'

# AppArmor skips these files at boot: copies that a package update leaves, and disabled profiles.
skipped_profile() {
  case "${1##*/}" in
    .* | *.dpkg-* | *.rpmnew | *.rpmsave | *.pacnew | *.pacsave | *.orig | *~) return 0 ;;
  esac
  [ -e "$apparmor_folder/disable/${1##*/}" ]
}

# Prints each file that AppArmor loads at boot, other than Eva's, with a profile for bubblewrap.
other_bwrap_profiles() {
  for file in "$apparmor_folder"/*; do
    [ -f "$file" ] || continue
    if skipped_profile "$file"; then continue; fi
    # A copy of Eva's profile under another name is no profile of the system or of the person.
    if grep -q "$eva_profile_mark" "$file" 2>/dev/null; then continue; fi
    if grep -Eq "$bwrap_profile_line" "$file" 2>/dev/null; then printf '%s\n' "$file"; fi
  done
  return 0
}

has_eva_profile() {
  [ -f "$eva_profile" ] && grep -q "$eva_profile_mark" "$eva_profile" 2>/dev/null
}

can_be_root() {
  [ "$(id -u)" -eq 0 ] || command -v sudo >/dev/null 2>&1
}

# The AppArmor parser is in /usr/sbin or /sbin, which the PATH of a normal user can miss.
apparmor_parser_path() {
  for candidate in "$(command -v apparmor_parser 2>/dev/null || true)" /usr/sbin/apparmor_parser /sbin/apparmor_parser; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 0
}

# Ubuntu's own profile also has the name bwrap: loading it again replaces Eva's in the kernel, while
# an unload of Eva's would remove Ubuntu's too. Another name does not replace Eva's, so Eva's profile
# is unloaded first then. A failed delete loads it again, so bubblewrap keeps working.
remove_eva_profile() {
  parser="$1"
  others="$2"
  say "  This system has its own AppArmor profile for bubblewrap, so Eva's profile is left over. Removing it needs administrator rights, so sudo can ask for your password."
  named=""
  for file in $others; do
    if grep -Eq "$named_bwrap" "$file" 2>/dev/null; then named="yes"; fi
  done
  unloaded=""
  if [ -n "$parser" ] && [ -z "$named" ]; then
    if (as_root "$parser" -R "$eva_profile"); then unloaded="yes"; fi
  fi
  (as_root rm -f "$eva_profile") || true
  if [ -f "$eva_profile" ]; then
    if [ -n "$unloaded" ]; then (as_root "$parser" -r "$eva_profile") || true; fi
    say "  Eva's AppArmor profile for bubblewrap stays. To remove it, see $sandbox_guide"
    return 0
  fi
  printf '%s\n' "$others" | while IFS= read -r file; do
    [ -z "$file" ] || [ -z "$parser" ] || (as_root "$parser" -r "$file") || true
  done
  say "  [ok] Removed Eva's AppArmor profile for bubblewrap. Restart Eva."
}

add_eva_profile() {
  parser="$1"
  say "  Adding an AppArmor profile for bubblewrap, so that the shell sandbox of Project chats can start. It needs administrator rights, so sudo can ask for your password."
  # as_root gives the command no input, so the shell inside writes the file. Every user must read
  # it, so that a later install, the uninstall and Eva's own check find the mark.
  (as_root sh -c 'umask 022; printf "%s\n" "$@" >"$0"' "$eva_profile" \
    "# $eva_profile_mark (#903). It lets bubblewrap make a user namespace, so the shell sandbox can start." \
    "abi <abi/4.0>," \
    "include <tunables/global>" \
    "" \
    "profile bwrap /usr/bin/bwrap flags=(unconfined) {" \
    "  userns," \
    "  include if exists <local/bwrap>" \
    "}") || true
  if [ -f "$eva_profile" ] && (as_root "$parser" -r "$eva_profile"); then
    say "  [ok] Added an AppArmor profile for bubblewrap."
    return 0
  fi
  # A file that AppArmor cannot load, such as in a container, must not wait for the next start.
  [ ! -f "$eva_profile" ] || (as_root rm -f "$eva_profile") || true
  say "  The shell sandbox of Project chats needs an AppArmor profile for bubblewrap on this system. See $sandbox_guide"
}

set_up_bwrap_profile() {
  [ -d "$apparmor_folder" ] || return 0
  others="$(other_bwrap_profiles)"
  if has_eva_profile; then
    # Eva's profile alone needs no change.
    [ -n "$others" ] || return 0
    if ! can_be_root; then
      say "  Eva's AppArmor profile for bubblewrap is left over, and its removal needs an administrator. See $sandbox_guide"
      return 0
    fi
    remove_eva_profile "$(apparmor_parser_path)" "$others"
    return 0
  fi
  [ -z "$others" ] || return 0
  [ "$(cat "$userns_file" 2>/dev/null || true)" = "1" ] || return 0
  # Claude Code's profile covers only this path. Claude Code runs the first bwrap on the PATH.
  [ "$(command -v bwrap 2>/dev/null || true)" = "/usr/bin/bwrap" ] || return 0
  parser="$(apparmor_parser_path)"
  # A file bwrap without Eva's mark belongs to the person: the install never writes over it.
  if [ -e "$eva_profile" ] || [ -z "$parser" ] || ! can_be_root; then
    say "  The shell sandbox of Project chats needs an AppArmor profile for bubblewrap on this system. See $sandbox_guide"
    return 0
  fi
  add_eva_profile "$parser"
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
  set_up_bwrap_profile
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
