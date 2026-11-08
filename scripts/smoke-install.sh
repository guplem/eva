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
# A system that ships its own profile makes Eva's profile left over: the install removes it, and
# loads the system's profile again. Both have the name bwrap, so nothing unloads.
printf 'abi <abi/4.0>,\nprofile bwrap /usr/bin/bwrap flags=(attach_disconnected) {\n  allow userns,\n}\n' |
  sudo tee /etc/apparmor.d/bwrap-userns-restrict >/dev/null
sudo truncate -s 0 /tmp/parser.log
curl -fsSL file:///release/install.sh | sh | tee /tmp/install.log
test ! -e /etc/apparmor.d/bwrap
grep -qx -- "-r /etc/apparmor.d/bwrap-userns-restrict" /tmp/parser.log
if grep -q -- "^-R" /tmp/parser.log; then echo "The install unloaded the name bwrap." >&2; exit 1; fi
grep -q "Removed Eva's AppArmor profile" /tmp/install.log
# With the system's profile, the install adds nothing.
curl -fsSL file:///release/install.sh | sh
test ! -e /etc/apparmor.d/bwrap
# Without it, the install adds the profile again. Every user can read it, also after a strict umask.
sudo rm /etc/apparmor.d/bwrap-userns-restrict
(umask 077 && curl -fsSL file:///release/install.sh | sh)
test "$(stat -c %a /etc/apparmor.d/bwrap)" = 644
# A profile with another name does not replace Eva's when it loads, so the install unloads Eva's
# profile first.
printf '/usr/bin/bwrap flags=(unconfined) {\n  userns,\n}\n' | sudo tee /etc/apparmor.d/usr.bin.bwrap >/dev/null
sudo truncate -s 0 /tmp/parser.log
curl -fsSL file:///release/install.sh | sh
test ! -e /etc/apparmor.d/bwrap
test "$(cat /tmp/parser.log)" = "$(printf -- '-R /etc/apparmor.d/bwrap\n-r /etc/apparmor.d/usr.bin.bwrap')"
sudo rm /etc/apparmor.d/usr.bin.bwrap
# A profile that AppArmor cannot load does not stay for the next start.
echo 1 >/tmp/parser-exit
curl -fsSL file:///release/install.sh | sh | tee /tmp/install.log
test ! -e /etc/apparmor.d/bwrap
grep -q "needs an AppArmor profile for bubblewrap" /tmp/install.log
# The person's own file, which the install does not recognize, stays as it is.
echo 0 >/tmp/parser-exit
echo "@{exec_path} = /usr/bin/bwrap" | sudo tee /etc/apparmor.d/bwrap >/dev/null
curl -fsSL file:///release/install.sh | sh | tee /tmp/install.log
test "$(cat /etc/apparmor.d/bwrap)" = "@{exec_path} = /usr/bin/bwrap"
grep -q "needs an AppArmor profile for bubblewrap" /tmp/install.log
sudo rm /etc/apparmor.d/bwrap
# Without the restriction, the install adds nothing.
echo 0 >/tmp/userns
curl -fsSL file:///release/install.sh | sh
test ! -e /etc/apparmor.d/bwrap

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
test "$(grep -c "Another apt process holds a lock of apt" <<<"$output")" = 1
grep -qF "To install later, run: sudo apt-get update && sudo apt-get install bubblewrap socat" <<<"$output"
curl -fsSL file:///release/install.sh | sh
command -v bwrap >/dev/null

# The uninstall stops an Eva and deletes her folder, then the program. Enter keeps each safe answer.
mkdir -p "$HOME/.config/eva-smoke" "$HOME/.config/systemd/user"
echo "{}" >"$HOME/.config/eva-smoke/config.json"
touch "$HOME/.config/systemd/user/eva-smoke.service"
# The last answer removes Eva's AppArmor profile for bubblewrap (#903). It reaches that question
# only because the container has none of the shared programs, such as pi or gh. With no other
# profile for bubblewrap, the uninstall unloads Eva's profile first.
echo "# Added by the Eva installer (#903)." | sudo tee /etc/apparmor.d/bwrap >/dev/null
sudo truncate -s 0 /tmp/parser.log
printf "\ny\n\ny\n" | sh /release/uninstall.sh
test ! -e /etc/apparmor.d/bwrap
grep -qx -- "-R /etc/apparmor.d/bwrap" /tmp/parser.log
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
