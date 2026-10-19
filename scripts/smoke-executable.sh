#!/usr/bin/env bash
# Checks one built Eva executable the way a new person starts it:
# `eva version`, `eva setup --non-interactive` with a new vault, then `eva doctor`.
# Setup installs no harness: the smoke test changes nothing outside its own folder.
# Usage: bash scripts/smoke-executable.sh <path to the executable>
set -euo pipefail

executable="$1"
work="$(mktemp -d)"
# A Windows executable needs a Windows path; Git Bash gives a Unix one.
if command -v cygpath >/dev/null 2>&1; then work="$(cygpath -m "$work")"; fi
trap 'rm -rf "$work"' EXIT
# Each Eva lives in the config folder: APPDATA on Windows, XDG_CONFIG_HOME elsewhere.
export XDG_CONFIG_HOME="$work"
export APPDATA="$work"

"$executable" version

EVA_TIME_ZONE="Europe/Madrid" \
  EVA_PORT="7533" \
  EVA_VAULT_PATH="$work/vault" \
  EVA_CREATE_VAULT="yes" \
  EVA_PERSON_NAME="Test Person" \
  EVA_INSTALL_ENGINES="no" \
  "$executable" --instance smoke setup --non-interactive

grep -q '"port": 7533' "$work/eva-smoke/config.json"
grep -q '"timeZone": "Europe/Madrid"' "$work/vault/.eva/settings.json"
grep -q 'Test Person' "$work/vault/.eva/assistant.md"
git -C "$work/vault" log --oneline | grep -q "Start the vault"

# A new machine has no engine yet, so doctor may fail; it must still run and find git.
doctor_report="$("$executable" doctor || true)"
echo "$doctor_report"
grep -q "ok      git" <<<"$doctor_report"
echo "The executable passed the smoke test."
