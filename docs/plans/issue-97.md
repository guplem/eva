# Plan: the person chooses which updates Eva installs (issue 97)

## Goal

Eva installs a newer release by herself only when the person's policy allows it.
The person sees a held-back release, reads what each release brings, and updates by hand to any newer version, from the phone.

## Steps

1. **Release list (core).** In `self-update.ts`, read `GET /repos/{owner}/{repo}/releases` instead of `releases/latest`.
   Keep the signed `# version` line, the signature and the SHA-256 checks. Download one release by its tag.
2. **Release labels (core).** A pure function labels a jump from one version to another as `major`, `minor` or `patch`.
   Reuse `isNewerVersion` from `release-verification.ts`.
3. **Policy (core).** A pure function picks the newest release that the policy allows, and the newest release that it holds back.
4. **Setting.** Add `updates.install: "patch" | "minor" | "major"`, default `minor`, in the vault next to `updates.frequency`.
5. **Updater.** `UpdateChannel.check()` returns the newer releases with their notes. The automatic update installs only the target that the policy allows. A manual update takes an optional target version.
   `UpdateStatus` gains `heldBack` (the newest held-back version, or null) and `releases` (the newer releases with labels and notes).
6. **Summary.** A pure function writes one summary for a jump of several versions: breaking changes first, then features, then fixes. It reads the sections that the release workflow writes.
7. **Telegram.** `/update` shows the summary and one button for each newer version. A button asks for a confirmation, then installs.
   Eva sends one message for each new held-back release, and a warning before a major release under the `major` policy.
8. **Web.** The Settings page shows the policy, the held-back version and the summary, with a version picker and an Update button.
9. **CLI.** `eva update [version]`, and `eva status` names a held-back version.
10. **Docs.** Update `docs/guide/` for the new setting and the manual update.

## Gaps and decisions

To be filled by the gap review.

- G1. Before `1.0`, should `minor` act like `patch`?
- G2. Source installs: does the policy apply to a `git clone`?
- G3. How does Eva remember which held-back release she already announced, across restarts?
- G4. What is "a warning before a major release" under the `major` policy?
- G5. How does the person pick a target version on Telegram and on the web?
- G6. The API shape for the release list and for a manual update to a version.
