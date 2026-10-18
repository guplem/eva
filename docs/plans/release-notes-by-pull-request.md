# Release notes by pull request

Issue: #149.

## Motivation

The release notes list one line per commit. A reader wants one line per pull request, with a link to it, like the notes that GitHub writes. The commits stay, in a collapsed detail view.

Eva also reads the notes. `releaseSummary` in `src/core/updates/release-policy.ts` turns them into the update message on the phone. The phone message must show the pull requests, not the commit details.

## Plan

1. `src/core/updates/release-version.ts`:
   - `ReleaseCommit` gets an optional `hash` and an optional `pullRequest` (`number`, `title`).
   - A new function reads a merge commit subject, such as `Merge pull request #146 from owner/branch`, and gives the pull request number.
   - `releaseNotes` writes one line per pull request under the section of its largest change, as `- <title> (#N)`. A commit with no pull request keeps its own line.
   - After the sections, a `<details>` block lists each commit that changes the executable, as `- <subject> (<hash>)`.
2. `scripts/next-release.ts`: walk the first-parent history since the last tag. For each pull request merge, read the commits between its parents and tag them with the pull request. The merge body holds the pull request title.
3. `src/core/updates/release-policy.ts`: `releaseSummary` skips the lines inside a `<details>` block.

## Gaps and decisions

- **Link format.** Write `#N`. GitHub links it in a release body, with no repository name in the code. Short commit hashes link the same way.
- **Linked issues.** The issue asks for links to pull requests "or issues". Git does not hold the pull request body, where `Closes #N` lives. The pull request page links its issues. Decision: link the pull request only, with no GitHub API call in the release job.
- **Section of a pull request.** The largest change among its commits, as for the version. A pull request with only docs or test commits does not show, as before.
- **Title of a pull request.** The first line of the merge commit body. GitHub writes the pull request title there. If the body is empty, use the subject of the first commit.
- **Old releases.** Their notes have no `<details>` block. `releaseSummary` reads them as before.
- **Squash merges.** The repository merges with merge commits. A squash commit subject already ends with `(#N)`, so it keeps its own line.
