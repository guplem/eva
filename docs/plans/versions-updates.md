# Plan: one Versions table for every tool update

Issue: #294.

## Why

The Updates page has two places to update tools. The Versions card shows **Update** for every installed tool that Eva installs, even when the tool is up to date. A separate "Claude Code update" card runs `claude update`. The person wants one table that says what is out of date and updates it.

## Changes

1. Move `isNewerVersion` to a new pure module, `src/core/updates/version-order.ts`. `release-verification.ts` imports `node:crypto`, so the web client cannot import it.
2. Add `src/core/tool-latest.ts`: it reads the latest published version of claude, pi, gh and uv.
3. Add `Eva.latestToolVersions()` and `GET /api/versions/latest`. Eva keeps each found version for one hour.
4. In the Versions card, read the latest versions after the installed ones. Show "1.3.0 (1.4.0 available)". Show **Update** only when a newer version exists, or when Eva cannot tell.
5. Give the claude row an **Update** button that runs the engine update (`POST /api/update/engine`). Show its progress and result under the table. Delete the "Claude Code update" card and its search entry.
6. Change the alert text and the guide, which name the old button.

## Gaps and decisions

- **Where each latest version comes from.** Decision: claude from the npm registry (`@anthropic-ai/claude-code`, tag `latest`), which `claude update` follows by default. pi, gh and uv from the GitHub API "latest release" of `earendil-works/pi`, `cli/cli` and `astral-sh/uv`. The installers already use these sources.
- **A new endpoint or a field in `/api/versions`.** Decision: a new endpoint. `eva status` and the Telegram `/status` read `/api/versions` and must not wait for the network.
- **GitHub's limit of 60 requests an hour without a login.** Decision: keep each found version in memory for one hour. Do not keep a failure, so the next page open asks again.
- **A failed lookup.** Decision: the tool gets `latest: null`. The card shows the **Update** button as before, because Eva cannot tell.
- **The claude row when no claude program was found at start.** Decision: the row shows **Install**, as before. When the engine update answers "No claude program was found", the card shows that text.
- **The CLI and Telegram.** Decision: no change. `eva doctor` and `/status` keep their output.
- **Stored and sent names.** The new endpoint and the `LatestToolVersion` type are additive. No migration.
