# Eva owns vault sync in her own code; no agent hooks in Eva or the vault

## Context

v1 synced the vault with agent hooks and git hooks. A broken hook failed in silence (lessons 16, 31). A hook resolved the repository from the current folder, so inside a clone it pushed the project's `main` (lesson 19). The locks raced, and Windows had no `flock` (lessons 20, 21). Each harness also has its own hook system, so a hook-based design must be rebuilt for every engine.

Source: plan §1 (D7), §5.4, §6; owner answer 4 (`docs/review-2026-10-14.md`); lessons 16 to 27, 100.

## Decision

- **The core syncs the vault,** inside the one core process (ADR 0004), at an explicit vault path, on the vault's default branch only. Sync never enters a clone under `Projects/*/repos/`.
- **The cycle:** `git pull --rebase --autostash` before each Assistant turn; commit and push after it; an idle sweep every 60 seconds that never runs during an Assistant turn. Project turns do not block the sweep.
- **Every git step has a timeout** (60 seconds for a network step, 20 for a local step), runs with `GIT_TERMINAL_PROMPT=0`, and stops gently, then hard, then cleans up.
- **A conflict never discards a change.** Eva aborts the rebase, keeps the local commits, stops pushing, and tells the person in every front end.
- **A secret scan runs before each commit.** A matching file outside `Projects/*/` stays out of the commit; the scan never blocks the whole commit (lesson 27).
- **No agent hooks.** Eva sets `disableAllHooks: true` in Assistant mode, and the vault's pskill config writes no hooks (`hook_files: []`).
- **Programmatic skill runs continue without a Stop hook.** After each Assistant turn, Eva runs the pskill stop logic herself, for the session that just ended (plan §5.4).

Sync is planned for phase P3. Until then, the temporary v1 sync hooks stay in the vault, and Eva removes them on a machine as soon as she syncs there.

**Rejected alternatives:**

- **v1's agent and git hooks.** They fail in silence, act on the wrong repository, and race (lessons 16, 19, 20).
- **A file watcher that commits after a quiet period.** A commit can land in the middle of a turn, and a watcher over many clones is costly on Windows (review R7).

## Consequences

**Positive:**

- Sync state shows in `eva status`, Telegram `/status`, and the UI, instead of a silent hook failure (lesson 26).
- The behaviour is the same for every engine.

**Trade-offs and follow-up:**

- Sync tests run against local bare git remotes, and they must clear the `GIT_*` variables (lesson 104).
- Two conversations can still edit one note, and one edit can be lost. Accepted (lesson 30).
