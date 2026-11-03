---
name: vault-upgrade
description: Move the vault to a newer vault structure, with the person, in one sitting. Use when a message says that a newer vault structure is available, or when the person asks to upgrade or update the structure of the vault, in any wording. Also use it to finish, drop or undo a vault upgrade.
---

# Upgrade the vault structure

An Eva update never changes the structure of a vault. This skill does, with the person. It works in one sitting: you read and plan first, then ask every question in one message, then work with no interruption, then ask for one final review.

`CHANGELOG.md`, in this skill's folder, lists each structure version: what changes and why, how to detect a vault that has it, and what to ask. `.eva/vault-structure.json` records the version of the vault. A vault with no record follows version 2. The folder `template/` holds the newest template texts, and `shipped/<path>/NN.md` holds every version of the replaced files that Eva ever shipped.

## Rules

- Change nothing before the person answers your one message and `eva vault-upgrade start` succeeds. Then change the vault only on the upgrade branch.
- Never touch the `## Personal rules` section of the root `AGENTS.md`. Keep it byte for byte. You may only add what a CHANGELOG entry says, such as a missing apps table, at the end of the section.
- Lose nothing. Each file of the inventory is kept, moved, merged, or deleted with the person's yes. Each fact of a file that you rewrite goes to its new place before you rewrite the file.
- Move each note with `git mv`, so it keeps its history. Never copy and delete.
- Commit each group of changes in its own commit. Name only the paths that you wrote or moved: `git commit -m "<group>" -- <paths>`. Other chats can write notes meanwhile, and Eva keeps them apart.
- Never `git add` a file that the sync kept out, such as a plain `.env` with a token. `finish` refuses a branch with a secret in plain text.
- Never decrypt a file because of a move. A secret file stays encrypted when `git mv` moves it.
- Never edit `.eva/vault-structure.json`. `finish` records the version.
- Never delete a folder before you list its git-ignored files: `git status --ignored -- <folder>`.
- Ask nothing after the up-front message, except the final review. Write what you cannot decide in the report instead.

## 1. Read and plan, with no change

1. Read `.eva/vault-structure.json` and `CHANGELOG.md`. Take every entry newer than the vault's version, oldest first.
2. For each entry, check "How to detect a vault that has it". When the vault already has every change, tell the person, run `eva vault-upgrade start`, then `eva vault-upgrade finish`, and stop: only the record changes.
3. List every file: `git ls-files`, and the git-ignored ones with `git ls-files -o -i --exclude-standard --directory`. Leave out `.eva/scratch/`, `Scratch/` and `Projects/*/repos/`.
4. Read each file and decide its place in the new structure, by the root `AGENTS.md` and the `AGENTS.md` of each `Life/` folder in `template/`. When your engine has subagents, give them the files in batches, with those rules. Otherwise, work in batches in this chat.
5. For each replaced file (root `AGENTS.md`, `README.md`, `.eva/assistant.md`, `Life/About me.md`), find the person's own lines:
   - Compare the file with each shipped version: `git diff --no-index --stat <shipped file> <vault file>`. Take the version with the fewest changed lines. The vault's first commit, "Start the vault from Eva's template", is a second source.
   - A placeholder of a shipped text, such as `{{name}}`, `{{nameInQuotes}}`, `{{notesLanguage}}` or `{{topics}}`, matches any value.
   - A line that no shipped version has is the person's own. A file that matches no version at all is the person's own: ask about the whole file.
6. Find also:
   - each fact of About me that leaves it: diet, allergies, sleep, people, dates, and any other text;
   - an old copy of one of Eva's skills in `.eva/skills/`, such as `about-me` or `schedule`, that the person changed. It replaces Eva's newer skill. Show its diff with Eva's skill;
   - a person's own file at a path that the new template writes, such as `Life/People/AGENTS.md`;
   - each stored path that a move breaks: widget inputs in `.eva/widgets.json`, prompts in `.eva/schedules.json`, and the patterns that the person added to `.eva/secret-files`.

## 2. Ask everything in one message

The person already asked for the upgrade, through the button, the notification or their own words. So this message is the only question round: no "shall I start?" before it. Say in two or three sentences what changes and why. Then ask numbered questions, each with a default, so the person can answer "yes to all":

1. Each of the person's own lines in a replaced file: show it as a diff against Eva's shipped text, with the default "keep it in <place>". Usually _Personal rules_ for a vault rule, and `.eva/assistant.md` for style and behaviour.
2. Yolo mode. "Yes": you decide where each file goes, alone. "No": the whole move plan follows in this message, grouped by target folder, for the person's approval.
3. Where each fact of About me goes: diet and allergies to `Life/Health/Allergies and Diet.md`, sleep to `Life/Health/`, each person to `Life/People/<Full Name>/Person.md` or the contacts app, each date to the contacts app, the calendar or its note. Say which ones you cannot write, such as a contacts app that you cannot reach: they stay in About me until the person adds them there.
4. Each other question of the CHANGELOG entry, such as the storage map and what to pin.
5. Each deletion, such as a duplicate, an empty leftover folder or a leftover skill.
6. The schedule edits that the moves need, as one list to approve once.
7. Each git-ignored file outside the temporary folders, and where it goes.

In yolo mode, still ask questions 1, 3, 4, 5, 6 and 7. Never decide a deletion or a person's own line alone.

## 3. Start

After the answers, run `eva vault-upgrade start`. It refuses on a satellite computer, with the sync off, while another upgrade is open, or when the vault cannot sync. Then tell the person its reason, and stop. When it works, it prints:

- the backup tag, such as `before-v3`, on the remote too;
- the branch, such as `upgrade-v3`, in the vault folder. The sync waits until `finish` or `drop`;
- the inventory: one line for each file, with its kind (`tracked`, `untracked` or `ignored`), its git hash and its path;
- where to write the report, and where to list each git-ignored file that you move. Both are in `.eva/scratch/vault-upgrade/`, which git ignores.

## 4. Work without interruption

1. Make every schedule edit in one write to `.eva/schedules.json`, first, while the person is still here: each write asks them. Make the edits of `.eva/secret-files` and `.eva/widgets.json` too. Commit these three files in their own group.
2. File the facts of About me where the person said, in their own commit: merge diet and allergies into `Life/Health/Allergies and Diet.md`, or create it from `template/` when it is missing; write sleep, each person and each date in their places. A fact that you cannot place stays in About me.
3. Write the new skeleton with the exact texts of `template/`: each `Life/<folder>/AGENTS.md`, the root `AGENTS.md`, `README.md`, `.eva/assistant.md` and `Life/About me.md`. Fill each placeholder with the vault's own value. In About me, keep the vault's value of every identity field (such as `name`, `givenName`, `pronouns`, `birthDate`, `contact`, `region`, `places`, `languages`) and its `lastLocation` exactly as they are: never empty one. Put back the lines that the person chose to keep, where they said. Keep the existing `## Personal rules` section as it is.
4. Move the notes, one commit for each group, such as "Move the car to Life/Objects". Fix each link that a move breaks.
5. Move each git-ignored file where the person said. Write each move as one `<from><TAB><to>` line in the list that `start` named, so `drop` and `undo` can move it back.
6. Delete only what the person approved.
7. Run `git status`. Commit your own work that is left. A file that you did not write stays as it is: Eva commits it apart as a note written meanwhile.

## 5. Check and report

Check the result against the inventory:

- Each line of the inventory is kept, moved, merged, or deleted with the person's yes. No file is lost or orphaned.
- Each link that worked before still works.
- Each git-ignored file is where the person said.
- Each secret file still matches a pattern of `.eva/secret-files` or the defaults. A moved secret file still names its old path inside, and opens as before. List each one.

Write the report to the path that `start` printed: each file and what happened to it, each link that you fixed, and what the person must do. That is: each widget that needs a new approval, each changed schedule that shows its setup card again, and each fact for an app that you cannot reach, such as a birthday for the contacts app.

## 6. The final review

Show the person a short summary, the report path, and `git log --stat <default branch>..HEAD`. Ask for their yes. Then:

- On a yes, run `eva vault-upgrade finish`. It commits the notes written meanwhile and names them, merges the branch, records the version, syncs again and pushes. When two versions of a file met, it keeps both, the other one in a copy beside the file, and names each copy. Merge each copy with the person, then delete it.
- To leave the upgrade, run `eva vault-upgrade drop`. The vault is as it was, plus the notes written meanwhile. The backup tag stays. A copy works as for `finish`.

## Later

- **Undo:** when the person asks to go back after the merge, run `eva vault-upgrade undo` on the hub. The vault is as before the upgrade, plus the notes written since. The Settings card offers the upgrade again.
- **An open upgrade in a new chat:** when the person asks to finish or drop an upgrade that an earlier chat started, run that command. To start again, run `drop`, then start from step 1.
