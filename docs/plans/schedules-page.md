# Schedules page with a day line, plain words and the last result

Issue #175, part of #161. The design is the "Schedules" section of `docs/design/eve/reference.html`.

## Motivation

The page shows one text line per schedule today. The person cannot see what runs today, how a schedule repeats, or how its last run went. On a phone, the add form always fills the page. The EVE design shows a day line, one card per schedule and a clear confirmation card.

## Scope

- `client/SchedulesView.tsx`, `client/SchedulesPanel.tsx`, `client/ScheduleCardDialog.tsx` and a new `schedules.css`.
- A new pure module `client/schedule-words.ts` for the words and the day line, with unit tests.
- The smallest core change for the last result: `src/core/schedules/`.
- No navigation: issue #167 builds the app shell.

## Gaps and decisions

1. **The last result.** The API gives only `{schedule, nextRun}`.
   Decision: the schedule state already keeps `lastFired`, the slot of the last firing. Add an optional `lastFailed` slot to the state. A firing whose chat does not start, or whose prompt fails, writes it. `list()` adds `lastRun: { slot, failed } | null` to each schedule. The last chat of a schedule is not enough: a schedule with only text has no chat, and a chat does not say that the prompt failed.
   The new state field is optional, so an old state file reads as before. No migration is needed.
2. **The time zone and "now" for the day line.** The client cannot know the instance's time zone.
   Decision: `list()` also returns `timeZone` and `now` (the wall-clock time in that zone). The page reloads the list each minute, so the now line and the last results stay current.
3. **The on/off toggle.** The schedule format has no field for it. A new field changes the vault file format and the setup card fields, so each existing schedule would ask for a new confirmation.
   Decision: leave the toggle out, and write a follow-up issue.
4. **Edit.** The reference shows no edit, and the issue does not ask for it. Decision: leave it out.
5. **The add form.** Decision: a dialog on a computer and a bottom sheet on a phone. It keeps today's fields and labels, so the end-to-end tests and the person's habits keep working. The days become seven day buttons, because a phone keyboard makes "mon, tue" slow to type. No day picked means every day.
6. **Remove.** Decision: Remove turns the card into a question in the page: "Remove <name>?" with Remove (danger) and Keep. The setup card dialog asks the same question inside the dialog, and `App.tsx` loses its `window.confirm`.
7. **Pills that overlap on the day line.** Decision: runs that are less than two hours apart share one pill, such as "08:00 Summary +1". The pill's title lists every run.
8. **The words.** Decision, closest to the reference:
   - Repeat: "Every day at 08:00", "Weekdays at 08:00", "Weekends at 10:00", "Fridays at 18:30", "Mondays and Fridays at 09:00", "Mon, Wed and Fri at 09:00".
   - Next run: "Today 08:00", "Tomorrow 08:00", "Thu 09:00" within a week, else "23 Oct 09:00".
   - Last result: "Ran today", "Ran yesterday", "Ran · 1 Oct", "Failed today", "Failed yesterday", "Failed · 1 Oct", "Not run yet".
9. **The confirmation card fields.** The card exists so that the person sees every field that someone pushed (lessons 66, 67). Decision: show every field, with plain labels. "When" shows the repeat in words. Then the next run and the time zone. EVE's visor looks skeptical, as the guide says for an unconfirmed schedule. The heading text stays, so the tests keep working.
10. **The subtitle.** The reference says "4 schedules · 1 needs a look". Decision: "N schedules", plus "· M need a look" when a last run failed or the file has problems.
11. **The add button on a phone.** The reference shows a round plus button. Decision: the same button shows only its icon on a phone, and keeps the name "Add schedule".
12. **No schedules.** Decision: EVE asleep, as the guide says for "nothing is scheduled", and one line that says how to add one.
