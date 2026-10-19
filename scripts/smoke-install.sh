#!/usr/bin/env bash
# Checks install/install.sh the way a new person runs it: `curl ... | sh` on a clean Ubuntu
# with no git, from a fake release folder that holds the given executable.
# Usage: bash scripts/smoke-install.sh <path to the Linux x64 executable>
set -euo pipefail

executable="$1"
release="$(mktemp -d)"
bad="$(mktemp -d)"
trap 'rm -rf "$release" "$bad"' EXIT
cp "$executable" "$release/eva-linux-x64"
cp install/install.sh "$release/install.sh"
(cd "$release" && sha256sum eva-linux-x64 >SHA256SUMS)
# A release whose checksum does not match its executable.
cp "$release/eva-linux-x64" "$release/install.sh" "$bad/"
echo "0000000000000000000000000000000000000000000000000000000000000000  eva-linux-x64" >"$bad/SHA256SUMS"
chmod -R a+rX "$release" "$bad"

docker run --rm -v "$release:/release:ro" -v "$bad:/bad:ro" ubuntu:24.04 bash -euo pipefail -c '
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  if command -v git >/dev/null; then echo "The image already has git." >&2; exit 1; fi

  # A wrong checksum installs nothing.
  if EVA_INSTALL_BASE_URL=file:///bad EVA_INSTALL_SKIP_SETUP=1 sh -c "curl -fsSL file:///bad/install.sh | sh"; then
    echo "The install went on with a wrong checksum." >&2; exit 1
  fi
  test ! -e "$HOME/.local/bin/eva"

  export EVA_INSTALL_BASE_URL=file:///release EVA_INSTALL_SKIP_SETUP=1
  curl -fsSL file:///release/install.sh | sh
  git --version
  "$HOME/.local/bin/eva" version
  grep -q ".local/bin" "$HOME/.profile"
  # A second run finds git and Eva, and installs Eva again.
  curl -fsSL file:///release/install.sh | sh
  test "$(grep -c "Added by the Eva installer" "$HOME/.profile")" = 1
  test "$(grep -c "Added by the Eva installer" "$HOME/.bashrc")" = 1
'
echo "The install script passed the smoke test."
