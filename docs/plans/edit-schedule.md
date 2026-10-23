# Plan: edit a schedule from the Schedules page

Issue: #467.

## Motivation

The Schedules page can add, pause and remove a schedule, but not change one. A person on a phone can only remove a schedule and add it again, which loses its state. Eva works from a phone, so this is a gap to close.

## Design

- Each `ScheduleRow` in `SchedulesPanel.tsx` gets an edit button with the `pen` icon, next to the remove button.
- The button opens `AddScheduleDialog.tsx` with the schedule. The dialog gets an optional `schedule` prop. No second form and no new page.
- In edit mode, the heading is "Edit schedule", the id field is read-only, and the note says that Eva asks to confirm the change.
- The add still goes to `POST /api/schedules`. The edit goes to `PATCH /api/schedules/:id` with `{ fields }` (decision 1).
- Pure helpers in a new `client/schedule-form.ts` turn a `Schedule` into form values, and form values into the fields of an entry. Unit tests cover them.

## Gaps

1. **Where to keep the fields that the form does not show** (`file`, `model`, `enabled: false`): in the front end entry, or in the core save.
2. **The notice after an edit of a paused schedule:** no card comes until the person turns it on.
3. **The tests:** which levels cover the change.

## Decisions

1. **Merge in the core.** The client gets only the parsed `Schedule`, so it cannot keep unknown keys, and parsing normalizes values. `setScheduleEnabled` and the vault schedule skill already keep every other key. A new `editScheduleDefinition` starts from the raw entry. It deletes only the keys that the form owns (`name`, `at`, `days`, `every`, `from`, `text`, `prompt`), writes the new values, and checks the result. The id comes from the URL. `PATCH` already means a partial change, so it takes `{ fields }` next to `{ enabled }`. The new body key is additive. POST stays "add or replace" for the skill and the add form.
2. **Notice.** On: "Saved. If a field changed, Eva shows a setup card first. It runs only after you confirm it." Off: "Saved. {name} stays off. Turn it on to get its setup card." A save with no change makes no card, so the notice does not promise one.
3. **Tests.** Unit tests for `editScheduleDefinition`, the PATCH route, and `client/schedule-form.ts`. One Playwright test edits a schedule from its row. The scheduler needs no change: it compares the announced fields at each check, so a changed entry already gets a card, and a paused one gets none.
