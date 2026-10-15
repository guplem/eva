#!/usr/bin/env bash
# Checks one built Eva executable the way a new person starts it (plan §10, P8):
# `eva version`, `eva doctor`, then `eva setup --non-interactive` with a new vault.
# Usage: bash scripts/smoke-executable.sh <path to the executable>
set -euo pipefail

executable="$1"
work="$(mktemp -d)"
# A Windows executable needs a Windows path; Git Bash gives a Unix one.
if command -v cygpath >/dev/null 2>&1; then work="$(cygpath -m "$work")"; fi
trap 'rm -rf "$work"' EXIT

"$executable" version
"$executable" doctor

EVA_TIME_ZONE="Europe/Madrid" \
  EVA_PORT="7533" \
  EVA_VAULT_PATH="$work/vault" \
  EVA_CREATE_VAULT="yes" \
  EVA_PERSON_NAME="Test Person" \
  "$executable" --home "$work/home" setup --non-interactive

grep -q '"port": 7533' "$work/home/config.json"
grep -q '"timeZone": "Europe/Madrid"' "$work/home/config.json"
grep -q 'Test Person' "$work/vault/.eva/assistant.md"
git -C "$work/vault" log --oneline | grep -q "Start the vault"
echo "The executable passed the smoke test."
