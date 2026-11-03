---
name: vault-upgrade
description: Move the vault to a newer vault structure, with the person, in one sitting. Use when a message says that a newer vault structure is available, or when the person asks to upgrade or update the structure of the vault, in any wording. Also use it to finish, drop or undo a vault upgrade.
---

# Upgrade the vault structure

An Eva update never changes the structure of a vault. This skill does, with the person. It works in one sitting: every question first, in one message, then the work with no interruption, then one final review.

`CHANGELOG.md`, in this skill's folder, lists each structure version: what changes and why, how to detect a vault that has it, and what to ask. `.eva/vault-structure.json` records the version of the vault. A vault with no record follows version 2.

## Rules

- Change the vault only on the upgrade branch, after `eva vault-upgrade start`.
- Never touch the `## Personal rules` section of the root `AGENTS.md`. Keep it byte for byte. You may only add what a CHANGELOG entry says, such as a missing apps table, at the end of the section.
- Lose nothing. Each file of the inventory is kept, moved, merged, or deleted with the person's yes.
- Move each note with `git mv`, so it keeps its history. Never copy and delete.
- Commit each group of changes in its own commit. Name only your own paths: `git commit -m "<group>" -- <paths>`. Other chats can write notes meanwhile, and Eva keeps them apart.
- Never decrypt a file because of a move. A secret file stays encrypted when `git mv` moves it.
- Never edit `.eva/vault-structure.json`. `finish` records the version.
- Never delete a folder before you list its git-ignored files: `git status --ignored -- <folder>`.
- Ask nothing after the up-front message, except the final review. Write what you cannot decide in the report instead.

## 1. Read and detect

1. Read `.eva/vault-structure.json` and `CHANGELOG.md`. Take every entry newer than the vault's version, oldest first.
2. For each entry, check "How to detect a vault that has it". When the vault already has every change, tell the person, run `eva vault-upgrade start`, then `eva vault-upgrade finish`, and stop: only the record changes.
3. Tell the person in two or three sentences what changes and why. Ask whether to start now. On a no, stop, and do not ask again in this chat.

## 2. Start

Run `eva vault-upgrade start`. It refuses on a satellite computer, while another upgrade is open, or when the vault cannot sync. Then tell the person its reason, and stop. When it works, it prints:

- the backup tag, such as `before-v3`, on the remote too;
- the branch, such as `upgrade-v3`, in the vault folder. The sync waits until `finish` or `drop`;
- the inventory: one line for each file, with its kind (`tracked`, `untracked` or `ignored`), its git hash and its path. An ignored folder has the hash `-`;
- where to write the report;
- the newest template texts (`template/`) and every version of the replaced files that Eva ever shipped (`shipped/<path>/NN.md`).

## 3. Classify everything first

Change nothing yet. Read each file of the inventory and decide its place in the new structure, by the root `AGENTS.md` and the `AGENTS.md` of each `Life/` folder in `template/`. When your engine has subagents, give them the files in batches, with those rules. Otherwise, work in batches in this chat.

For each replaced file (root `AGENTS.md`, `README.md`, `.eva/assistant.md`, `Life/About me.md`), find the person's own lines:

1. Compare the file with each shipped version: `git diff --no-index --stat <shipped file> <vault file>`. Take the version with the fewest changed lines. The vault's first commit, "Start the vault from Eva's template", is a second source.
2. A placeholder of a shipped text, such as `{{name}}`, `{{nameInQuotes}}`, `{{notesLanguage}}` or `{{topics}}`, matches any value.
3. A line that no shipped version has is the person's own. A file that matches no version at all is the person's own: ask about the whole file.

Also find:

- an old copy of one of Eva's skills in `.eva/skills/`, such as `about-me` or `schedule`, that the person changed. It replaces Eva's newer skill. Show its diff with Eva's skill;
- a person's own file at a path that the new template writes, such as `Life/People/AGENTS.md`;
- each stored path that a move breaks: widget inputs in `.eva/widgets.json`, prompts in `.eva/schedules.json`, and the patterns that the person added to `.eva/secret-files`.

## 4. Ask everything in one message

Send one message with numbered questions. Give a default for each one, so the person can answer "yes to all". Ask:

1. Each of the person's own lines in a replaced file, and where to keep it. Usually: _Personal rules_ for a vault rule, `.eva/assistant.md` for style and behaviour.
2. Yolo mode. "Yes": you decide where each file goes, alone. "No": show the whole move plan now, grouped by target folder, and start only after the person approves it.
3. Each other question of the CHANGELOG entry, such as the storage map, the text and the facts of About me, and what to pin.
4. Each deletion, such as a duplicate, an empty leftover folder or a leftover skill.
5. The schedule edits that the moves need, as one list to approve once.
6. Each git-ignored file outside the temporary folders, and where it goes.

In yolo mode, still ask questions 1, 3, 4, 5 and 6. Never decide a deletion or a person's own line alone.

## 5. Work without interruption

1. Make every schedule edit in one write to `.eva/schedules.json`, first, while the person is still here: each write asks them.
2. Write the new skeleton with the exact texts of `template/`: each `Life/<folder>/AGENTS.md`, the root `AGENTS.md`, `README.md`, `.eva/assistant.md` and `Life/About me.md`. Fill each placeholder with the vault's own value, such as the name from About me. Put back the lines that the person chose to keep, where they said. Keep the existing `## Personal rules` section as it is.
3. Move the notes, one commit for each group, such as "Move the car to Life/Objects". Fix each link that a move breaks.
4. Move each git-ignored file where the person said.
5. For each new path of a secret file, add a pattern to `.eva/secret-files`. Keep the old pattern.
6. Fix each widget input that a move breaks, in `.eva/widgets.json`.
7. Delete only what the person approved.

## 6. Check and report

Check the result against the inventory:

- Each line of the inventory is kept, moved, merged, or deleted with the person's yes. No file is lost or orphaned.
- Each link that worked before still works.
- Each git-ignored file is where the person said.
- Each secret file still matches a pattern of `.eva/secret-files` or the defaults.

Write the report to the path that `start` printed: each file and what happened to it, each link that you fixed, and what the person must do. That is: each widget that needs a new approval, each changed schedule that shows its setup card again, and each fact for an app that you cannot reach, such as a birthday for the contacts app.

## 7. The final review

Show the person a short summary, the report path, and `git log --stat <default branch>..HEAD`. Ask for their yes. Then:

- On a yes, run `eva vault-upgrade finish`. It commits the notes written meanwhile, merges the branch, records the version, syncs again and pushes. A conflict stops it with no change: it names the files. Merge the default branch into the upgrade branch, resolve each file, commit, and run `finish` again.
- To leave the upgrade, run `eva vault-upgrade drop`. The vault is as it was, plus the notes written meanwhile. The backup tag stays.

## Later

- **Undo:** when the person asks to go back after the merge, run `eva vault-upgrade undo` on the hub. The vault is as before the upgrade, plus the notes written since. The Settings card offers the upgrade again.
- **An open upgrade in a new chat:** when the person asks to finish or drop an upgrade that an earlier chat started, run that command. To start again, run `drop`, then start from step 1.
