# Engines

- Map structured engine fields, never English text (lesson 36).
- End every turn stream with exactly one `turn_finished` or `turn_failed`.
- Capture parser fixtures from the neutral demo vault (`scripts/capture-claude-fixtures.ts`). Pin the exact SDK options and argument lists of each mode with a contract test.
- Never embed `claude`: it adds about 270 MB and breaks updates. Never run pi inside the core process: it would see every secret.
- Run a model call with no tools, no settings and no saved session, and deny every approval: its text can come from other people, such as a chat message.
- The pi MCP bridge runs inside pi, so it spawns its servers without a seam.

# File wall

- Keep each Project chat's file tools out of `request.fileWall.closed`, but inside its `area`, in every permission mode, through `src/shared/path-area.ts` (#711). Name no vault in the refusal.
