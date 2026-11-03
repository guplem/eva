# Modes

- An untrusted clone loads only Claude Code's user-level settings until the person trusts it. Store only the person's own answer.
- Eva's own skills live in Eva and reach only Assistant mode. The person's skills live only in the vault's `.eva/skills/`, never at the vault root: root skills reach every project session (lesson 5).
- Never write a `CLAUDE.md` into a vault: it stops Claude Code from loading `AGENTS.md` (lesson 112).
- No file that Eva puts in a Project chat's start folder, or below it, may have the name of an instruction file. The harness would load it as the project's own instructions (#702).
- The one instruction file that Eva writes for a Project chat is `repos/AGENTS.md`, above the clone. It tells a clone chat where the project's notes are (#774). Rewrite it only while its first line is Eva's marker.
