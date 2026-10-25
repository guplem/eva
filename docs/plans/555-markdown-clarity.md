# Plan: consistent markdown for non-native readers (#555)

## Goal

Make the markdown files for people and agents consistent, correct and easy for a non-native reader. Change no instruction.

## Decisions

- Use "vault" everywhere, also in the docs for people and in `eva setup`. The README explains it once. (Owner.)
- The root `AGENTS.md` keeps "follow `implement-issue` for any change", with a short hint that a change skips it very rarely. (Owner.)
- Each contradiction follows the code.
- "chat", not "conversation". "header", not "front matter", in Eva's own texts. "person", not "user" or "human".
- Keep the redundancy of safety rules. Keep `docs/lessons-from-v1.md` as history.

## Work, by file group

1. **Agent rules and skills** (`AGENTS.md` files, `.agents/skills/`):
   - Fix the release prefixes in the root `AGENTS.md` (the code also releases on `perf`, `refactor` and `build`).
   - Fix the "breaking, then not breaking" item in `write-commit`.
   - Remove the double meanings: "clone root", "One owner per branch", "hook" in `test/AGENTS.md`.
   - Add the `implement-issue` hint.
   - Gloss "seam", "hub", "satellite" and the model tiers. Replace idioms such as "hard-won trap".
2. **Docs for people** (`README.md`, `docs/guide/`):
   - Replace "notebook" with "vault", and gloss it once. Rename the `notebook-conflicts` anchor with its heading.
   - Use "chat" only. Use one form for menu paths: **Settings > Updates**.
   - Fix the false line about the Telegram commands. Move misplaced paragraphs. Remove the duplicate of "Start at logon".
   - Replace idioms and gloss jargon.
3. **Eva's prompt and vault templates** (`src/core/modes/assistant-base-prompt.md`, `templates/vault/`):
   - Fix the schedule interval, the date format and the home of the answer language.
   - Use "header", "chat" and one name for a Project chat.
4. **Standard and design** (`docs/vibe-coded-standard.md`, `docs/design/eve/README.md`, `docs/lessons-from-v1.md`):
   - Remove the resolved "Open gaps" rows. Make the two "which source wins" lines agree.
   - Replace idioms and gloss jargon. Fix the status tags of the lessons.
5. **`eva setup` texts** (`src/frontends/cli/`): replace "Notebook" with "Vault", with the tests that pin them.

## Out of scope

Code or behavior changes: the setup report gaps, the random test order rule, the `{{timeZone}}` template line, and a move of the issue section of the base prompt into a skill.
