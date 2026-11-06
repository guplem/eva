#!/usr/bin/env bash
# Checks install/install.sh the way a new person runs it: `curl ... | sh` on a clean Ubuntu with
# no git, no OpenMP library and no sandbox tools, as a normal user with sudo, from a fake release
# folder that holds the given executable.
# Then it checks install/uninstall.sh.
# Usage: bash scripts/smoke-install.sh <path to the Linux x64 executable>
set -euo pipefail

executable="$1"
release="$(mktemp -d)"
bad="$(mktemp -d)"
trap 'rm -rf "$release" "$bad"' EXIT
cp "$executable" "$release/eva-linux-x64"
cp install/install.sh "$release/install.sh"
cp install/uninstall.sh "$release/uninstall.sh"
(cd "$release" && sha256sum eva-linux-x64 >SHA256SUMS)
# A release whose checksum does not match its executable.
cp "$release/eva-linux-x64" "$release/install.sh" "$bad/"
echo "0000000000000000000000000000000000000000000000000000000000000000  eva-linux-x64" >"$bad/SHA256SUMS"

# The steps of the person, who is not root.
cat >"$release/steps.sh" <<'STEPS'
set -euo pipefail
if command -v git >/dev/null; then echo "The image already has git." >&2; exit 1; fi
if ldconfig -p | grep libgomp >/dev/null; then echo "The image already has the OpenMP library." >&2; exit 1; fi
if command -v bwrap >/dev/null || command -v socat >/dev/null; then echo "The image already has the shell sandbox." >&2; exit 1; fi

# A wrong checksum installs nothing.
if EVA_INSTALL_BASE_URL=file:///bad EVA_INSTALL_SKIP_SETUP=1 sh -c "curl -fsSL file:///bad/install.sh | sh"; then
  echo "The install went on with a wrong checksum." >&2; exit 1
fi
test ! -e "$HOME/.local/bin/eva"

export EVA_INSTALL_BASE_URL=file:///release EVA_INSTALL_SKIP_SETUP=1
curl -fsSL file:///release/install.sh | sh
git --version
# whisper-cli, for voice notes, needs the OpenMP library.
ldconfig -p | grep "libgomp.so.1" >/dev/null
# Claude Code's shell sandbox, for the file wall of Project chats (#711), needs bubblewrap and socat.
command -v bwrap >/dev/null
command -v socat >/dev/null
"$HOME/.local/bin/eva" version
grep -q ".local/bin" "$HOME/.profile"
# A second run finds git and Eva, and installs Eva again. It also installs a sandbox tool that an
# Eva from before #757 never got.
sudo apt-get remove -y -qq bubblewrap >/dev/null
curl -fsSL file:///release/install.sh | sh
command -v bwrap >/dev/null
test "$(grep -c "Added by the Eva installer" "$HOME/.bashrc")" = 1

# A stuck apt process holds the locks of apt, as a hung daily update can for months (#898). The
# install still ends well, says why the sandbox did not install, and gives the command for later.
sudo apt-get remove -y -qq bubblewrap >/dev/null
sudo perl -MFcntl -e '
  for my $path (@ARGV) {
    open(my $file, ">>", $path) or die "$path: $!";
    my $lock = pack("ssx4qqix4", F_WRLCK, 0, 0, 0, 0);
    fcntl($file, F_SETLK, $lock) or die "$path: $!";
    push @files, $file;
  }
  open(my $ready, ">", "/tmp/apt-locked") or die $!;
  close($ready);
  sleep 600;
' /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend &
holder=$!
until test -e /tmp/apt-locked; do sleep 0.2; done
output="$(curl -fsSL file:///release/install.sh | sh 2>&1)"
sudo kill "$holder"
wait "$holder" || true
printf '%s\n' "$output"
grep -q "Another apt process holds a lock of apt" <<<"$output"
grep -qF "To install later, run: sudo apt-get update && sudo apt-get install bubblewrap socat" <<<"$output"
curl -fsSL file:///release/install.sh | sh
command -v bwrap >/dev/null

# The uninstall stops an Eva and deletes her folder, then the program. Enter keeps each safe answer.
mkdir -p "$HOME/.config/eva-smoke" "$HOME/.config/systemd/user"
echo "{}" >"$HOME/.config/eva-smoke/config.json"
touch "$HOME/.config/systemd/user/eva-smoke.service"
printf "\ny\n\n" | sh /release/uninstall.sh
test ! -e "$HOME/.local/bin/eva"
test ! -e "$HOME/.config/eva-smoke"
test ! -e "$HOME/.config/systemd/user/eva-smoke.service"
STEPS
chmod -R a+rX "$release" "$bad"

docker run --rm -v "$release:/release:ro" -v "$bad:/bad:ro" ubuntu:24.04 bash -euo pipefail -c '
  apt-get update -qq && apt-get install -y -qq curl ca-certificates sudo >/dev/null
  useradd --create-home --shell /bin/bash person
  echo "person ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/person
  su - person -c "bash /release/steps.sh"
'
echo "The install script passed the smoke test."
