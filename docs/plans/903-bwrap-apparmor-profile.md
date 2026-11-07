# Plan: an AppArmor profile for bubblewrap on Ubuntu 24.04 (#903)

Issue #903 holds the decisions of the person and the assumptions. This plan lists the work and the gaps.

## Work

1. **Eva's start check** (`src/core/shell-wall.ts`), test first in `test/unit/core/shell-wall.test.ts`:
   - Add a seam to `ShellWallMachine` that reads a text file and lists the files of a folder.
   - Read the restriction from `/proc/sys/kernel/apparmor_restrict_unprivileged_userns`.
   - Find the bubblewrap profiles directly in `/etc/apparmor.d/`: Eva's file (with the mark) and the others.
   - When the trial fails, the restriction is on, `bwrap` is `/usr/bin/bwrap`, and no profile covers it: a reason that names the AppArmor profile and the install command.
   - A second result: Eva's profile is left over next to another one.
2. **The notices** (`src/core/alerts/problem-rules.ts`, `src/core/eva.ts`): a new problem for the leftover profile, with its own alert key and help link.
3. **The installer** (`install/install.sh`): a profile step after the sandbox step, which runs on every install. Add the profile, or remove Eva's leftover file and reload the others.
4. **The uninstall** (`install/uninstall.sh`): ask to remove Eva's profile when the last Eva goes.
5. **The smoke test** (`scripts/smoke-install.sh`): the paths that a container can run.
6. **Docs**: `docs/guide/reference.md`, `docs/guide/setup.md`, `src/engines/AGENTS.md`.

## Gaps

- **Does the profile fix Eva's trial, and does the nested trial pass?** Only a real Ubuntu 24.04 host answers. Decision: test on a 24.04 host before the docs state it.
- **The mark text.** Decision: `# Added by the Eva installer (#903). It lets bubblewrap make a user namespace.` The installer and Eva search for `Added by the Eva installer`.
- **The rule for "a profile covers bubblewrap".** Decision: a line that is not a comment, starts a profile (`profile <name> <path>` or `<path>`), and has a path that ends in `bin/bwrap`.
- **The alert key of the leftover profile.** Decision: `bwrap_profile_left`, a new stored name.
- **A test seam for the installer.** Decision: `EVA_INSTALL_USERNS_FILE` replaces the restriction file in the smoke test, like `EVA_INSTALL_BASE_URL` replaces the release.
