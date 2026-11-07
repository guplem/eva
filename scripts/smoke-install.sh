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

# A container cannot load an AppArmor profile, so a fake parser logs each call (#903). It fails when
# /tmp/parser-exit holds 1.
cat >"$release/fake-apparmor.sh" <<'FAKE'
set -euo pipefail
mkdir -p /etc/apparmor.d
cat >/usr/sbin/apparmor_parser <<'PARSER'
#!/bin/sh
echo "$@" >>/tmp/parser.log
exit "$(cat /tmp/parser-exit 2>/dev/null || echo 0)"
PARSER
chmod +x /usr/sbin/apparmor_parser
FAKE

# The steps of the person, who is not root.
cat >"$release/steps.sh" <<'STEPS'
set -euo pipefail
# The kernel of the CI may have any value, so a file says that AppArmor restricts user namespaces.
echo 1 >/tmp/userns
export EVA_INSTALL_USERNS_FILE=/tmp/userns
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

# Where AppArmor restricts user namespaces and no profile covers bubblewrap, the install adds and
# loads Claude Code's profile, with Eva's mark (#903).
grep -q "Added by the Eva installer" /etc/apparmor.d/bwrap
grep -q "profile bwrap /usr/bin/bwrap flags=(unconfined)" /etc/apparmor.d/bwrap
grep -qx -- "-r /etc/apparmor.d/bwrap" /tmp/parser.log
# A system that ships its own profile makes Eva's one left over: the install removes it, and loads
# the system's one again, since both have the name bwrap.
printf 'abi <abi/4.0>,\nprofile bwrap /usr/bin/bwrap flags=(attach_disconnected) {\n  allow userns,\n}\n' |
  sudo tee /etc/apparmor.d/bwrap-userns-restrict >/dev/null
curl -fsSL file:///release/install.sh | sh | tee /tmp/install.log
test ! -e /etc/apparmor.d/bwrap
grep -qx -- "-r /etc/apparmor.d/bwrap-userns-restrict" /tmp/parser.log
grep -q "Removed Eva's AppArmor profile" /tmp/install.log
# With the system's profile, the install adds nothing.
curl -fsSL file:///release/install.sh | sh
test ! -e /etc/apparmor.d/bwrap
# A profile that AppArmor cannot load does not stay for the next start.
sudo rm /etc/apparmor.d/bwrap-userns-restrict
echo 1 >/tmp/parser-exit
curl -fsSL file:///release/install.sh | sh | tee /tmp/install.log
test ! -e /etc/apparmor.d/bwrap
grep -q "needs an AppArmor profile for bubblewrap" /tmp/install.log
# Without the restriction, the install adds nothing.
echo 0 >/tmp/parser-exit
echo 0 >/tmp/userns
curl -fsSL file:///release/install.sh | sh
test ! -e /etc/apparmor.d/bwrap

# The uninstall stops an Eva and deletes her folder, then the program. Enter keeps each safe answer.
mkdir -p "$HOME/.config/eva-smoke" "$HOME/.config/systemd/user"
echo "{}" >"$HOME/.config/eva-smoke/config.json"
touch "$HOME/.config/systemd/user/eva-smoke.service"
# The last answer removes Eva's AppArmor profile for bubblewrap (#903).
echo "# Added by the Eva installer (#903)." | sudo tee /etc/apparmor.d/bwrap >/dev/null
printf "\ny\n\ny\n" | sh /release/uninstall.sh
test ! -e /etc/apparmor.d/bwrap
test ! -e "$HOME/.local/bin/eva"
test ! -e "$HOME/.config/eva-smoke"
test ! -e "$HOME/.config/systemd/user/eva-smoke.service"
STEPS
chmod -R a+rX "$release" "$bad"

docker run --rm -v "$release:/release:ro" -v "$bad:/bad:ro" ubuntu:24.04 bash -euo pipefail -c '
  apt-get update -qq && apt-get install -y -qq curl ca-certificates sudo >/dev/null
  bash /release/fake-apparmor.sh
  useradd --create-home --shell /bin/bash person
  echo "person ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/person
  su - person -c "bash /release/steps.sh"
'
echo "The install script passed the smoke test."
