# Plan: Google access per service (#264)

## Why

The person wants Eva to change some Google services but only read others. For example, Eva may edit contacts but only read the calendar. Now one switch, `google.readOnly`, sets every service at once.

## Facts

- `workspace-mcp` 2.1.0 has `--permissions service:level`. It cannot run with `--read-only` or `--tools`.
- Its levels are cumulative. Each level adds scopes to the level before it (`auth/permissions.py`):
  - calendar: `readonly` (calendar.readonly), `full` (+ calendar, calendar.events).
  - drive: `readonly` (drive.readonly), `full` (+ drive, drive.file).
  - contacts: `readonly` (contacts.readonly), `full` (+ contacts).
  - tasks: `readonly` (tasks.readonly), `manage` (+ tasks, but no delete and no clear of completed tasks), `full`.
  - gmail: `readonly`, `organize` (+ labels, modify), `drafts` (+ compose), `send` (+ send), `full` (+ settings.basic).
- In this mode the server asks for the base scopes plus the scopes of each level. Eva's login must hold the same scopes.
- The server turns off each tool whose scopes the levels do not give.
- `google.readOnly` is a machine security setting (`src/core/migrations/settings-moves.ts`).
- The approval rule (`src/shared/outward-actions.ts`) reads tool names only. It does not change.

## Gaps

1. **Storage shape.** Store the level of each service, or a preset name plus changes?
2. **Migration.** How does `google.readOnly` become the new setting? Is the change breaking?
3. **Presets.** Which presets, with which levels and names?
4. **User interface.** When does the card show the select of each service?
5. **Other front ends.** Does the terminal setup or Telegram need a change?

## Decisions

Three sub-agents agreed on gaps 1, 2, 4 and 5. The owner chose gap 3 and approved the key change.

1. **Storage shape.** A new machine key, `google.access`, holds one level for each of the 5 services. Each service has its own enum, because the level lists differ. The default is `readonly` everywhere. No preset name is stored: the card finds the preset that matches the levels, or shows "Custom". `google.services` stays the list of services that are on.
2. **Migration.** A dated machine migration replaces `google.readOnly`. `false` becomes `full` for every service, which gives the same scopes as before. `true`, or a bad value, becomes the default. The owner approved the key change. Nobody acts by hand and nobody loses access, so the change is not breaking. An old Eva that reads the new file drops `google.access` and falls back to read only.
3. **Presets.** The owner chose 4 steps on one ladder, plus "Custom":

   | Preset           | calendar | drive    | contacts | tasks    | gmail    |
   | ---------------- | -------- | -------- | -------- | -------- | -------- |
   | Read only        | readonly | readonly | readonly | readonly | readonly |
   | Keep my lists    | full     | readonly | full     | manage   | organize |
   | Change and draft | full     | full     | full     | full     | drafts   |
   | Everything       | full     | full     | full     | full     | full     |

   Eva still asks before each tool call that reaches other people, in every preset.

4. **User interface.** Step 3 of the Google card shows one preset select, a `SelectField`. It shows one select per service that is on only for "Custom", or when the levels match no preset. A change still asks the person to log in again.
5. **Other front ends.** The terminal setup and Telegram need no change. `eva config set google.access.calendar full` works through the dotted keys.

## Steps

1. Core: the `google.access` schema, the cumulative scopes of each level, `--permissions` for `workspace-mcp`, and the presets.
2. Migration: `2026-10-20-google-access-per-service`, and the stored-names file.
3. Web: the preset select and the per-service selects.
4. Docs: `docs/guide/reference.md`.
