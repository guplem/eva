# Vault

This repository is a personal knowledge vault: the notes that the person chose to keep, and their projects.

Everything stays plain text where it can, so one search finds it and almost any device opens it.

## What is where

| Path                                                       | What it holds                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Principles/`, `Methods/`, `Toolbox/`, `Library/`, `Life/` | Notes, grouped as _Knowledge_ below says                                                               |
| `Projects/`                                                | One folder for each project (_Projects_ below)                                                         |
| `.eva/`                                                    | The settings of Eva, a separate program. Not notes                                                     |
| `Scratch/`                                                 | Files that are not knowledge: files made to send to a chat, and files received from it. Git ignores it |

**`.eva/` and `Scratch/` are not notes.** Never file, move or link what they hold. Edit `.eva/` only when your own instructions say how.

**Every path in this file starts at the vault root.**

**No `CLAUDE.md` anywhere in this vault.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists in the folder or above it, so one `CLAUDE.md` would hide every `AGENTS.md`.

## Knowledge

### Two ways to group

Notes are grouped along two axes. Pick the axis first, the folder second.

- **By purpose:** general knowledge that outlives any single project. The person wants to find it again later, whatever they work on.
- **By context:** everything about one bounded thing, with mixed purposes together, because the person wants all of it in one place while they work on that thing.

**The test:** does this note still matter after the project or context ends? Yes → purpose. No → context.

So "how we priced the shop" lives in the project. "How I decide prices" moves to `Methods/`.

### Where things go

| Folder           | Why the person opens it                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Principles/`    | To remember who they want to be: values, mantras, philosophy.                                                                                            |
| `Methods/`       | To do or decide something their way: their own procedures and frameworks.                                                                                |
| `Toolbox/`       | To take something and use it: commands, scripts, prompts, cheat sheets, lookup facts.                                                                    |
| `Library/`       | To understand something: explanations worth keeping.                                                                                                     |
| `Projects/<id>/` | To work on one project: everything about it, any purpose, together.                                                                                      |
| `Life/<name>/`   | The same shape, for personal contexts, such as `Life/Home/`, `Life/Health/` or `Life/Diary/`. `Life/About me.md` holds the basic facts about the person. |

Inside each folder, group by topic. Purpose first, topic second.

**Toolbox or Library?** Ask whether the note gives an action or an understanding. If the person can use it without understanding it, it goes in `Toolbox/`: a command, a script, a prompt. If there is nothing to copy, only something to know, it goes in `Library/`. A mixed note goes where the person opens it from.

### Rules

- **Anything can live in the vault:** notes, documents, scans, photos. Prefer plain text when the content is text. Copy a file from `Scratch/` worth keeping into the vault.
- **One fact lives in one file.** Other files link to it, never copy it. Two copies become different over time, and then neither can be trusted.
- **Name a file after the moment when the person would open it**, not after where its content came from. Write `Mental Strength Checklist`, not `13 Things Mentally Strong People Don't Do`. The test: standing in that situation, could the person guess the file name?
- **Write notes impersonally**, as statements about the world. Write "The mind believes what it hears by default", not "My mind believes what it hears". A diary is the exception: it is the person's own voice.
- **Write all notes in one language**, so that one search finds everything.
- **Close a note with its source** when the person says where it came from: `> Source: *Title*, Author`, plus a link when one exists.
- **Mark few notes as important.** When the person would want to see a note even while they ask about another topic, put `> Important: <why it matters>` under its title.
- **Secrets** (keys, passwords) may live only in the folder of the project that uses them. Never copy one into a note outside that folder. One known place for each secret makes it possible to change it later.

## Grow the vault

The vault starts empty and grows with each chat. Keep its shape clear as it grows.

1. **Search first.** Look for notes on the same topic (grep and glob), and compare them with the new information:
   - **Same:** say that it is already stored, name the file, and write nothing.
   - **Conflicting:** show what differs, old against new, and propose to replace the old text.
   - **Incomplete:** add the new information to that note.
   - **Nothing similar:** go on below.
2. **Pick the axis, then the folder,** as _Knowledge_ says.
3. **Create the topic folder** inside that folder when none fits, with a clear name. Never put a note in a folder only because the folder is near.
4. **Create the note,** and match the names of the files beside it.
5. **Tell the person** where you put it.

Prefer fewer, larger notes. Every extra file makes the important ones harder to find. When a note or a folder grows too long to scan, propose to split it.

**This file is the map of the vault. Keep it true.** When you create, rename or remove a folder at the vault root, change the _What is where_ table in the same turn. A folder that the map does not show gets lost.

**Fix this file yourself when it is simply wrong,** such as a path that moved. **Propose a change and wait when you only prefer it different,** such as a new rule or a new structure. Rules and structure record the person's decisions.

## Projects

Each project is a folder `Projects/YYYY-MM-DD-HHmm-name/`, named after its creation time. `name` is lowercase, with hyphens. The time never changes. Its `AGENTS.md` starts with YAML front matter:

```yaml
---
created: 2026-01-31T09:15
status: active # idea, active, paused or closed
repos:
  - https://github.com/example/example-app
---
```

The text under the front matter says what an agent must know about the project. The project's notes sit beside it.

`Projects/<id>/repos/clone-<n>/` holds a clone of the project: one folder for each repository, such as `repos/clone-0/<repo>/`. Git ignores those clones: each repository is its own git repository. Never edit a clone as part of note work.
