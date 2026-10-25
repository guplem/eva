# Plan: consistent markdown for non-native readers (#555)

## Goal

Make the markdown files for people and agents consistent, correct and easy for a non-native reader. Lose no instruction.

## Decisions

From the owner:

- Use "vault" everywhere, also in the docs for people.
- The root `AGENTS.md` keeps "follow `implement-issue` for any change", with a short hint that a change skips it very rarely.
- Lose no instruction.

From the agent (assumptions in #555):

- "Vault" also covers `PRIVACY.md`, `eva setup`, `progress.ts` and the uninstall scripts. The README glossary defines "vault" once.
- Fix a wrong instruction. Each contradiction follows the code.
- Use "chat" and "person". Keep "header" for `About me.md` and "front matter" for a project's `AGENTS.md`.
- Keep the redundancy of safety rules, each reason and each "lesson N".

## Work, by file group

1. **Agent rules and skills** (`AGENTS.md` files, `.agents/skills/`):
   - Fix the release prefixes in the root `AGENTS.md`.
   - Fix the "breaking, then not breaking" item in `write-commit`.
   - Remove the double meanings: "clone root", "One owner per branch", "hook" in `test/AGENTS.md`.
   - Add the `implement-issue` hint.
   - Gloss "seam", "hub", "satellite" and the model tiers. Replace idioms.
2. **Docs for people** (`README.md`, `docs/guide/`, `PRIVACY.md`):
   - Replace "notebook" with "vault". Rename the `notebook-conflicts` and `conversations` anchors with their headings and links.
   - Use "chat" only. Use one form for menu paths: **Settings > Updates**.
   - Fix the false line about the Telegram commands. Move misplaced paragraphs. Remove the duplicate of "Start at logon".
   - Replace idioms and gloss jargon.
3. **Eva's prompt and vault templates** (`src/core/modes/assistant-base-prompt.md`, `templates/vault/`):
   - Fix the schedule interval and the home of the answer language.
   - Use "chat" and one name for a Project chat. Replace idioms.
4. **Standard and design** (`docs/vibe-coded-standard.md`, `docs/design/eve/README.md`, `docs/lessons-from-v1.md`):
   - Remove the closed "Open gaps" rows. Make the two "which source wins" lines agree.
   - Replace idioms and gloss jargon. Fix the status tags of the lessons.
5. **Texts in code** (`src/frontends/cli/`, `src/core/setup/progress.ts`, `install/uninstall.*`): replace "notebook" with "vault".

## Out of scope

Code or behavior changes: the setup report gaps, the random test order rule, the `{{timeZone}}` template line, and a move of the issue section of the base prompt into a skill.
