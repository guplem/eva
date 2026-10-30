# Modes

- An untrusted clone loads only Claude Code's user-level settings until the person trusts it. Store only the person's own answer.
- Assistant skills live only in the vault's `.eva/skills/`, never at the vault root: root skills reach every project session (lesson 5).
- Never write a `CLAUDE.md` into a vault: it stops Claude Code from loading `AGENTS.md` (lesson 112).
- Never give a file that Eva writes below a Project chat's start folder the name of an instruction file. The harness would load it, and the chat would learn about the vault (#702).
