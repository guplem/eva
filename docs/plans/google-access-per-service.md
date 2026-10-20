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

To be filled in.

## Steps

To be filled in.
