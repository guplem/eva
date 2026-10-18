# Plan: the person chooses which updates Eva installs (issue 97)

## Goal

Eva installs a newer release by herself only when the person's policy allows it.
The person sees a held-back release, reads what each release brings, and updates by hand to any newer version, from the phone.

## Steps

1. **Version 1.0.** The next breaking change raises Eva to `1.0.0`. After that, every version follows the normal rule.
   Change `nextReleaseVersion` in `release-version.ts`.
2. **Release labels (core).** A pure function labels a jump from one version to another as `major`, `minor` or `patch`, by the version numbers only.
3. **Policy (core).** A pure function picks the newest release that the policy allows, and the newest release that it holds back.
4. **Summary (core).** A pure function joins the notes of several releases: breaking changes first, then features, then fixes.
   It reads the sections that the release workflow writes.
5. **Release list.** `self-update.ts` reads `GET /repos/{owner}/{repo}/releases` instead of `releases/latest`, and installs one release by its tag.
   It keeps the signature, the signed `# version` line and the SHA-256 checks.
6. **Setting.** Add `updates.install: "patch" | "minor" | "major"`, default `minor`, in the vault next to `updates.frequency`.
7. **Updater.** The automatic update installs only the target that the policy allows. A manual update takes an optional target version.
   `UpdateStatus` gains `install` (the policy), `heldBack` (the newest held-back version, or null) and `releases` (the newer releases, with labels and notes).
8. **Held-back message.** Eva sends one message for each new held-back release. A state file remembers the last announced version.
9. **Telegram.** `/update` shows the state, a "Check and install" button, and one button for each newer version.
   A version button shows the summary and a confirm button. A major jump adds a warning.
10. **Web.** The Settings page has the policy picker, with a warning for `major`. It shows the held-back version.
    "Check and install" installs what the policy allows. "Update to a version…" opens a dialog with a version list, the summary, and a warning for a major jump.
11. **CLI.** `eva update [version]`. `eva status` names a held-back version.
12. **Docs.** Update `docs/guide/` for the new setting and the manual update.

## Decisions

- **G1. Versions before 1.0.** No special rule. The next breaking change raises Eva to `1.0.0` (step 1), so the labels use the version numbers only. Owner's decision.
- **G2. Source installs.** A `git clone` keeps following `main`. The policy applies only to the single executable. A source install has no held-back version. Owner's decision.
- **G3. Announced held-back releases.** A machine state file, `state/updates.json`, keeps the newest announced version. Eva writes it atomically and reads it tolerantly. She sends the message through `AlertCenter.notify`, which never repeats.
- **G4. The warning for major releases.** The warning is text in the front ends, not a delay. The `major` policy says that a major release can break things. A manual update across a major version says the same before the person confirms. Owner's decision.
- **G5. Picking a version.** Telegram uses `u:<version>` buttons, then a `u:<version>:go` confirm button, as `/restart` does. The web page uses a dialog with a version list.
- **G6. API.** `GET /api/update` returns the status with the release list. `POST /api/update` takes an optional `{ version }`. An empty body installs what the policy allows.

## Later steps (not in this PR)

- A shared target version for every computer, and each computer's version in the status (first comment on issue 97).
- The rule that Eva installs at least the version that the vault needs (third comment on issue 97). It belongs to issue 119, which lands second.
