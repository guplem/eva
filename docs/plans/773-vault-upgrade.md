# Plan: upgrade an existing vault to a new structure (#773)

The built-in `vault-upgrade` skill moves an old vault to the newest vault structure, v3, in one sitting, with the person. Eva tells the person once that a new structure exists: a news alert, a Settings card, and one line in the first new Assistant chat. The skill does the work. Eva's code gives it four safe commands: `eva vault-upgrade start|finish|drop|undo`.

This branch builds on #772 (PR #794), which adds `.eva/vault-structure.json` and the v3 template.

## Motivation

The owner wants existing users to get the new structure safely and pleasantly: notified, with their own edits respected, and nothing lost (decisions.md, item 7; ROUND2.md, R1). An Eva update never restructures a vault. Only this skill does, with the person.

## Design

### The CHANGELOG and the structure version

- `templates/eva-core/skills/vault-upgrade/CHANGELOG.md` holds one `## vN` entry per structure version, with `Version`, `Date`, `Pull request`, `Summary` and `Migrations first` lines, then what changes and why, how to detect it, and what to ask. The first entry is v3, with the text of the issue.
- `src/core/vault/vault-structure.ts` reads the CHANGELOG (the code import of the text), and gives the newest version, the summaries and the migrations that each version needs. Setup writes the newest version into `.eva/vault-structure.json`, in place of #772's constant.
- `readVaultStructure()` reads `.eva/vault-structure.json` tolerantly: a missing or damaged file, or one with no whole number, reads as version 2. A version newer than this Eva knows shows no alert.

### The commands (`src/core/vault/vault-upgrade.ts`)

Each command runs in the running Eva, through the local API (`POST /api/vault/upgrade`). The CLI prints the answer, or the refusal. Git runs through `VaultSync.runGit` (the `ProcessRunner` seam, with a timeout and Eva's identity). The steps that change branches run inside `VaultSync.exclusive`, so no sync step runs between them.

- **`start`**: refuses on a satellite, when the vault is up to date, while an upgrade branch exists, when `assertVaultWritable` fails, or when a migration that the entry needs is not in `.eva/migrations.json`. It pulls and saves once, and refuses unless the sync ends "ok". It tags HEAD `before-vN` (`before-vN-2` when taken) and pushes the tag. It creates `upgrade-vN` and switches to it. It writes the inventory to `<state>/vault-upgrade/vN-inventory.tsv`: each tracked file with its blob hash, and each untracked and ignored file or ignored folder, except `.eva/scratch/`, `Scratch/` and `Projects/*/repos/`. It prints the tag, the branch, the inventory path, the report path and the folder of the shipped template texts.
- **`finish`**: refuses on a satellite or off the upgrade branch, and runs `assertVaultWritable`. It commits what other chats wrote meanwhile as "Notes written during the upgrade", through the sync's own commit, so secret files are encrypted. It switches to the default branch and pulls. It merges the branch with `--no-ff --no-commit`, writes the version into `.eva/vault-structure.json` (other fields kept), and commits "Upgrade the vault structure to vN". A conflict aborts the merge, switches back to the branch, and names the files. It deletes the branch, saves and pushes through the sync, then runs the held vault migrations. The tag stays.
- **`drop`**: works on any computer that has the branch. It commits the notes written meanwhile, switches to the default branch, and cherry-picks each such commit, so git's rename detection puts an edit of a moved note back at its old path. A conflict aborts, switches back, and names the files. It deletes the branch, saves, and runs the held vault migrations.
- **`undo`**: refuses on a satellite, on an upgrade branch, or when the recorded version is not the one of the last "Upgrade the vault structure" commit. It saves first and needs no tracked change left. It reverts that commit (`-m 1` for a merge) with no commit, then applies the "Notes written during the upgrade" commits again, so those notes stay. It keeps `.eva/secret-files` as it is. A conflict resets the steps (`git reset --merge`) and names the files. It commits "Undo the vault structure upgrade to vN" and saves.

### The pause

- `VaultSync` treats a vault on a branch named `upgrade-v<N>` as paused: each step skips with the new status `paused` and the text "Paused for the vault upgrade. Ask the Assistant to finish or drop it." Each Assistant turn's pull and save skip too, since they call the same methods. The open branch is the mark, so the pause survives a restart.
- `vaultSyncProblem` raises no alert for `paused`. The status, Settings and Telegram show the text.
- While the branch is open, the hub runs no vault migration and no template alignment, at start or at a role change. `finish` and `drop` run them after the switch back.

### Telling the person

- **The news alert.** On the hub, after the start migrations, Eva compares the vault's version with the newest one. When it is older and the hub's state file (`<state>/vault-structure.json`, `{ "announced": N, "prompted": N }`, read tolerantly) has not announced N, she sends `alerts.notify("vault_structure", "news", …)` once, and records it. The text gives the versions, the summary, and "open Settings, Vault and sync, Vault structure, or ask the Assistant". It names no slash command.
- **The prompt line.** The first new Assistant chat (no turn yet) on the hub after the alert gets, at the end of its appended prompt: "[Vault structure: version N is available. This vault is at version M. Run the vault-upgrade skill when the person agrees.]". Eva then records `prompted: N`, so later chats do not get it. The line stays fixed for that chat, as the rest of its prompt.
- **The Settings card "Vault structure"** (Vault and sync): the current and the newest version, the summary, and "Update the vault". "Up to date" when there is nothing newer. On a satellite, the button is off and the card says to use the hub.
- **The actions.** The card's button and the web alert's "Update the vault" open a new Assistant chat and send "Update my vault to the newest structure with the vault-upgrade skill." Telegram adds an "Update the vault" button to the alert, and a reply to the alert does the same: both open a new topic with that request.

### The skill

- `SKILL.md` gives the flow: read the CHANGELOG; detect what the vault has; run `start`; classify every file first (subagents in batches when the engine has them); ask every question in one message (the person's own lines in each replaced file, yolo mode or the whole plan, the storage map, About me's text and facts, pins, each deletion, the schedule edits, the ignored files); make the schedule edits in one write; work with `git mv`, one commit per group, naming only its own paths; check against the inventory; write the report; ask for the final review; run `finish`. `drop` and `undo` when the person asks. _Personal rules_ is kept byte for byte.
- The skill folder carries the CHANGELOG, the newest template texts (`template/`), and every shipped version of the root `AGENTS.md`, `README.md`, `.eva/assistant.md` and `Life/About me.md` (`shipped/<path>/NN.md`). `scripts/vault-template-history.ts` makes `shipped-texts.json` from the git history of `templates/vault/`, and runs the vault migrations on each version, so a text that a migration wrote counts as Eva's. A test fails when the current template text is missing from it.

## Gaps and decisions

The owner is away. Each decision follows his intentions (decisions.md, ROUND2.md), with its reason.

1. **The commands go through the running Eva** (local API), not a separate process. Reason: only the running Eva can pause her own sync, hold her migrations and refresh the card; `eva sync` and `eva work` work the same way.
2. **The sync pause is a new status, `paused`.** Reason: rules branch on codes, never on text, and the pause must raise no alert while a wrong branch still does. Adding a value is safe: the web page and the CLI ship with the same Eva.
3. **`start` refuses unless the sync ends "ok".** Reason: the tag must reach the remote, and the work must start from a saved vault. An offline hub can try again later.
4. **The version record is part of the merge commit.** Reason: one commit to find and revert for `undo`, so the vault and its record never disagree. A vault that already has the v3 shape gets a branch with no commit; `finish` then makes one plain commit with the same message.
5. **`undo` applies the notes written during the upgrade again** after the revert. Reason: R1, "notes written in other chats during the upgrade ... are kept by finish, drop and undo".
6. **`drop` needs no hub.** Reason: a hub change during an upgrade leaves the branch on the old hub, where only `drop` must work (issue notes).
7. **The shipped texts are a committed JSON file, made by a script,** not a build step. Reason: CI has a shallow clone, and the history never changes. A test keeps it current.
8. **The skill compares texts itself** (with `git diff --no-index` in the shell), so Eva adds no diff code. Reason: simple; the skill is the one that asks the person.
9. **The announced and prompted versions live in the hub's state folder,** as `announceHeldBack` keeps its own. Reason: the alert fires once per version and never again after a restart; after `undo`, no new alert and no new prompt line.
10. **The prompt line goes only to a chat with no turn yet,** and only on the hub. Reason: "the first new Assistant chat on the hub after the alert".
11. **The Telegram reply** is recognized by the message id of the last alert, kept in memory. Reason: simple; after a restart the button still works.
12. **The card has two states.** No "in progress" state and no "Not now" (R1). While an upgrade is open, the button starts a chat whose `start` explains that an upgrade is open.
13. **The blind-test eval is not added.** Reason: the sets hold personal data, and the owner has not given a copy with neutral names (assumption 18).
