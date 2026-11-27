# Warn about plain versions on the vault remote (#1110)

## Goal

When Eva encrypts a file whose plain text is already on the vault remote, she tells the person once: the old versions stay in the git history, so a key or a password in the file should be changed. The Encrypt question says it too, before the change. Eva never rewrites the history.

## Changes

1. `src/core/vault/vault-secrets.ts`: the round records each file that it encrypts in place, and `takeNewlyEncrypted()` hands the list over once, as `takeNewDefaults()` does.
2. `src/core/vault/vault-encryption.ts`: the Encrypt action records the old name of each file that it renames, because the plain versions are under that name.
3. `src/core/vault/vault-sync.ts`: `plainOnRemote(paths)` answers which paths have a plain version in the history of the remote branch.
4. `src/core/eva.ts`: after each round, Eva checks the new list and raises one open notice that names the files. The notice stays until the person dismisses it, so a satellite's report carries it to the hub and the phone.
5. A route and the page: the Encrypt question asks the core first and adds the warning when the file has plain versions on the remote.
6. `src/core/alerts/problem-rules.ts`: the text of the notice.
7. Tests and the guide.

## Gaps

- **G1. Where does Eva learn that a file became encrypted?** The round, the Encrypt action, or both?
- **G2. Which alert carries the notice,** so it reaches the phone from a satellite and shows once for each file?
- **G3. How does Eva know that a plain version is on the remote?** Which git steps, and how fresh is the remote branch?
- **G4. How does the Encrypt question learn it before the change?**

## Decisions

Three researchers (two mid-tier, one top-tier) agreed, with the additions below.

- **G1. Both.** The round records each plain file that it encrypts in place (`takeNewlyEncrypted`), and the Encrypt action records the old name of each file that it renames (`takeOldNames`). A password change does not go through the round, so it records nothing. A snapshot round and a commit round never record a file twice: the second sees it encrypted.
- **G2. One open notice for each file, with a state file.** Two researchers found that one shared key fails: the hub sends a changed message only once a day, so a second file would stay silent. So each file has its own key, `vault_plain_history:<path>`. `alerts.notice` keeps it open, so a satellite's report carries it to the hub and the phone. A state file on this computer (`plain-history.json`) keeps every warned file, so a file that an agent writes plain again and Eva encrypts again never gets a second notice. It also keeps the unread ones, so a restart opens them again, unsent, as the vault structure notice does. Read on the page closes a notice for good.
- **Known limit.** Two computers that encrypt the same file at about the same time, such as after an update with a new default, each warn once. Eva reads at most 50 commits of a path, reads no version over 1 MB (it counts as plain, the safe side), and remembers a file whose history is clean.
- **G3. The history of `origin/<branch>`.** `plainOnRemote` reads up to 50 commits of each path with `git log --full-history`, and `git show` for each. A commit that deletes the path is skipped. An unpushed plain version does not count: the push check takes it out first. With no remote branch, Eva names nothing. Offline, a plain version that another computer pushed and that Eva did not fetch yet is missed: that is the safe side. When git cannot say, the files wait for the next round.
- **G4. A route that the page asks first.** `GET /api/vault/secrets/plain-history` needs no device: a token holder can read the git history anyway, and the answer is only yes, no or unknown. The question adds the warning on yes, drops the history line on no, and keeps the neutral line on unknown.
