# Plan: edit a schedule from the Schedules page

Issue: #467.

## Motivation

The Schedules page can add, pause and remove a schedule, but not change one. A person on a phone can only remove a schedule and add it again, which loses its state. Eva works from a phone, so this is a gap to close.

## Design

- Each `ScheduleRow` in `SchedulesPanel.tsx` gets an edit button with the `pen` icon, next to the remove button.
- The button opens `AddScheduleDialog.tsx` with the schedule. The dialog gets an optional `schedule` prop. No second form and no new page.
- In edit mode, the heading is "Edit schedule", the id field is read-only, and the note says that Eva asks to confirm the change.
- The save goes to the existing `POST /api/schedules`, which replaces the entry with the same id.
- Pure helpers in a new `client/schedule-form.ts` turn a `Schedule` into form values, and form values plus the original schedule into an entry. Unit tests cover them.

## Gaps

1. **Where to keep the fields that the form does not show** (`file`, `model`, `enabled: false`): in the front end entry, or in the core save.
2. **The notice after an edit of a paused schedule:** no card comes until the person turns it on.
3. **The tests:** which levels cover the change.

## Decisions

(Filled after the gap search.)
