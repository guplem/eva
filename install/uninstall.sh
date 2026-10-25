#!/bin/sh
# Removes Eva from Linux with one command:
#   curl -fsSL https://github.com/guplem/eva/releases/latest/download/uninstall.sh | sh
# It asks before each step, and Enter keeps the safe answer. It stops each Eva that you pick and
# removes her start at login. Then it can delete her folder, the eva program, and the programs
# that Eva installed for every Eva on this computer. Your vault on GitHub always stays.
# The CI runs it after the install test (scripts/smoke-install.sh).
set -eu

config_folder="${XDG_CONFIG_HOME:-$HOME/.config}"
bin_folder="$HOME/.local/bin"
lib_folder="$HOME/.local/lib"
unit_folder="$HOME/.config/systemd/user"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'The Eva uninstall stopped: %s\n' "$*" >&2
  exit 1
}

# Under `curl | sh`, the input is the rest of this script, so the answers come from the terminal.
# A script that runs from a file, such as in the CI, can read its answers from the input.
# File descriptor 3 holds the answers for each question.
choose_input() {
  if (exec </dev/tty) 2>/dev/null; then
    exec 3</dev/tty
  elif [ -f "$0" ]; then
    exec 3<&0
  else
    fail "it needs a terminal to ask its questions. Open a terminal, and run the command again."
  fi
}

# Prints the answer, or the default for an empty answer. The question goes to stderr, so that
# $(ask ...) keeps only the answer.
ask() {
  printf '  > %s ' "$1" >&2
  answer=""
  IFS= read -r answer <&3 || true
  printf '%s\n' "${answer:-$2}"
}

# True for a yes. $2 is the default: "y" or "n".
confirm() {
  if [ "$2" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  case "$(ask "$1 $hint" "$2")" in
    y | Y | yes | Yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

# Setup writes config.json, so a folder without it holds no Eva (listInstances in home.ts).
list_evas() {
  for folder in "$config_folder"/eva-*; do
    [ -f "$folder/config.json" ] && printf '%s\n' "${folder##*/eva-}"
  done
  return 0
}

has_systemctl() {
  command -v systemctl >/dev/null 2>&1
}

# Stops the Eva of this folder and removes her service. Eva writes her pid in eva.lock, so an Eva
# that runs in a terminal stops too.
stop_eva() {
  name="$1"
  home="$config_folder/eva-$name"
  unit="$unit_folder/eva-$name.service"
  if has_systemctl; then
    systemctl --user disable --now "eva-$name.service" >/dev/null 2>&1 || true
  fi
  if [ -e "$unit" ]; then
    rm -f "$unit"
    if has_systemctl; then systemctl --user daemon-reload >/dev/null 2>&1 || true; fi
  fi
  pid="$(head -n 1 "$home/eva.lock" 2>/dev/null || true)"
  case "$pid" in
    '' | *[!0-9]*) ;;
    *)
      # After a reboot, another program can have the old pid: stop it only when it is Eva.
      if kill -0 "$pid" 2>/dev/null && tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q eva; then
        kill "$pid" 2>/dev/null || true
        waited=0
        while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 20 ]; do
          sleep 1
          waited=$((waited + 1))
        done
        kill -9 "$pid" 2>/dev/null || true
      fi
      ;;
  esac
  say "  [ok] Stopped Eva \"$name\", and removed her start at login."
}

# Lists each git folder under the Eva folder with changes that are not on its remote yet: the
# vault copy, and the clones of its projects.
unsaved_work() {
  for repository in "$1/vault" "$1"/vault/Projects/*/repos/*; do
    [ -d "$repository/.git" ] || [ -f "$repository/.git" ] || continue
    if [ -n "$(git -C "$repository" status --porcelain 2>/dev/null)" ] ||
      [ -n "$(git -C "$repository" log --branches --not --remotes --oneline 2>/dev/null)" ]; then
      printf '%s\n' "$repository"
    fi
  done
  return 0
}

delete_eva_folder() {
  name="$1"
  home="$config_folder/eva-$name"
  unsaved="$(unsaved_work "$home")"
  if [ -n "$unsaved" ]; then
    say "  These folders have changes that are not on GitHub yet. A delete loses them:"
    printf '%s\n' "$unsaved" | sed 's/^/    /'
  fi
  if confirm "Delete her folder $home too? It holds her settings, logins, logs and copy of your vault." n; then
    rm -rf "$home"
    say "  [ok] Deleted $home."
  else
    say "  Kept $home. A new install of Eva finds her again."
  fi
}

# Removes the link in ~/.local/bin only when it points into Eva's copy, never another program.
remove_link() {
  link="$bin_folder/$1"
  if [ -L "$link" ]; then
    case "$(readlink "$link")" in
      "$2"/*) rm -f "$link" ;;
    esac
  fi
}

remove_own_program() {
  label="$1"
  folder="$lib_folder/$2"
  [ -d "$folder" ] || return 0
  if confirm "Remove $label ($folder)?" n; then
    rm -rf "$folder"
    remove_link "$3" "$folder"
    say "  [ok] Removed $label."
  fi
}

remove_tailscale() {
  folder="$lib_folder/tailscale"
  [ -d "$folder" ] || return 0
  if ! confirm "Remove Tailscale ($folder)? Your phone then cannot reach this computer." n; then return 0; fi
  # A logout removes this computer from your Tailscale network too.
  "$folder/tailscale" --socket="$HOME/.local/share/tailscale/tailscaled.sock" logout >/dev/null 2>&1 || true
  if has_systemctl; then systemctl --user disable --now tailscaled >/dev/null 2>&1 || true; fi
  rm -f "$unit_folder/tailscaled.service"
  if has_systemctl; then systemctl --user daemon-reload >/dev/null 2>&1 || true; fi
  if grep -qs '.local/lib/tailscale' "$bin_folder/tailscale"; then rm -f "$bin_folder/tailscale"; fi
  rm -rf "$folder" "$HOME/.local/share/tailscale"
  say "  [ok] Removed Tailscale."
}

# Claude Code and uv come from their official installers. These are the steps of their own guides.
remove_claude_code() {
  [ -e "$bin_folder/claude" ] || [ -d "$HOME/.local/share/claude" ] || return 0
  if confirm "Remove Claude Code ($bin_folder/claude)? Your own Claude Code settings in ~/.claude stay." n; then
    rm -rf "$bin_folder/claude" "$HOME/.local/share/claude"
    say "  [ok] Removed Claude Code."
  fi
}

remove_uv() {
  [ -e "$bin_folder/uv" ] || return 0
  if confirm "Remove uv ($bin_folder/uv), its cache, and the tools and Python versions that it installed?" n; then
    "$bin_folder/uv" cache clean >/dev/null 2>&1 || true
    python_folder="$("$bin_folder/uv" python dir 2>/dev/null || true)"
    tool_folder="$("$bin_folder/uv" tool dir 2>/dev/null || true)"
    [ -z "$python_folder" ] || rm -rf "$python_folder"
    [ -z "$tool_folder" ] || rm -rf "$tool_folder"
    rm -f "$bin_folder/uv" "$bin_folder/uvx"
    say "  [ok] Removed uv."
  fi
}

remove_shared_programs() {
  say ""
  say "Eva installed some programs that every Eva on this computer uses. Other programs can use them too."
  remove_own_program "pi" pi pi
  remove_own_program "gh, the GitHub program" gh gh
  remove_own_program "ffmpeg" ffmpeg ffmpeg
  remove_own_program "whisper.cpp" whisper.cpp whisper-cli
  remove_tailscale
  remove_claude_code
  remove_uv
}

after_steps() {
  say ""
  say "Eva is removed from this computer. These steps happen outside it:"
  say "  - Your vault stays on GitHub. To delete it, open the repository on GitHub, then Settings."
  say "  - GitHub: revoke Eva's login under Settings -> Applications."
  say "  - Telegram: send /deletebot to @BotFather to delete your bot."
  say "  - Tailscale: remove this computer at https://login.tailscale.com/admin/machines if it is still there."
  say "  - Phone: delete Eva's icon from the home screen."
  say "  Setup ran \`loginctl enable-linger\`, which keeps your services running after you log out."
  say "  To undo it, run: loginctl disable-linger"
}

main() {
  say ""
  say "Eva uninstall"
  say "  Each question has a safe answer in [brackets]. Press Enter to keep it, or Ctrl+C to stop."
  [ "$(uname -s)" = "Linux" ] || fail "this script is for Linux. On Windows, use uninstall.ps1."
  choose_input

  evas="$(list_evas)"
  if [ -z "$evas" ]; then
    say "  This computer has no Eva in $config_folder."
    chosen=""
  else
    say "  The Evas on this computer: $(printf '%s' "$evas" | tr '\n' ' ')"
    chosen="$(ask "Which Eva do you want to remove? Type her name, or press Enter for all. [all]" all)"
    if [ "$chosen" = "all" ]; then
      chosen="$evas"
    elif ! printf '%s\n' "$evas" | grep -qx -- "$chosen"; then
      fail "this computer has no Eva named \"$chosen\"."
    fi
  fi

  for name in $chosen; do
    say ""
    say "Eva \"$name\""
    stop_eva "$name"
    delete_eva_folder "$name"
  done

  # Another Eva still needs the program and the shared programs.
  if [ -n "$(list_evas)" ] && [ "$chosen" != "$evas" ]; then
    say ""
    say "Other Evas still use this computer, so the eva program stays."
    return 0
  fi
  say ""
  if [ -e "$bin_folder/eva" ] && confirm "Remove the eva program ($bin_folder/eva)?" y; then
    rm -f "$bin_folder/eva"
    say "  [ok] Removed the eva program."
  fi
  remove_shared_programs
  after_steps
}

main "$@"
