# Vault

This repository is a personal knowledge vault: the notes that its owner chose to keep, their projects, and the rules of their assistant, Eva. Eva's code lives in another repository.

Everything stays plain text, so one search finds it and almost any device opens it.

**Eva's identity arrives only as an injected system prompt.** `.eva/assistant.md` holds it, and Eva sends it in Assistant mode. No file loads it by itself. So unless Eva gave you that identity, you are here to work with the notes, not to be Eva.

## What is where

| Path        | What it holds                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Notes/`    | The notes, grouped by topic in subfolders                                                                                                                       |
| `Projects/` | One folder for each project (_Projects_ below)                                                                                                                  |
| `.eva/`     | Eva's files in the vault: `assistant.md` (her rules for this person), `schedules.json`, `chat-names.md` (the rules for chat names), and her skills in `skills/` |
| `Scratch/`  | Files that are not knowledge: files made to send to a chat, and files received from it. Git ignores it                                                          |

**`.eva/schedules.json` is not a note.** Change it only through the `schedule` skill, because Eva reads it every minute and skips an entry that she cannot read.

**Every path in this file starts at the vault root.**

**No `CLAUDE.md` anywhere in this vault.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists in the folder or above it, so one `CLAUDE.md` would hide every `AGENTS.md`.

## Rules

- **One fact lives in one file.** Other files link to it, never copy it.
- **Prefer an update to a new file.** Search first; extend the note that already covers the topic.
- **Name a file after the moment when the person would open it**, not after where its content came from.
- **Secrets** may live only inside the project folder that they belong to. Never copy one anywhere else.
- **Heavy binary files** belong in a cloud drive, not here. A file made only to send goes in `Scratch/`.

## Projects

Each project is a folder `Projects/YYYY-MM-DD-HHmm-name/`, named after its creation time. Its `AGENTS.md` starts with YAML front matter:

```yaml
---
created: 2026-01-31T09:15
status: active # idea, active, paused or closed
repos:
  - https://github.com/example/example-app
---
```

Eva clones each repository into `Projects/<id>/repos/<repo>-<n>/`. Git ignores those clones: each one is its own repository.
