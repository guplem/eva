---
name: schedule
description: Create, change, pause or remove a scheduled message by editing .eva/schedules.json. Use when the person asks for a reminder (the skill picks where it goes), or when Eva must do or send something at a set time, once, every day, on some days or every few hours, days or weeks, in any wording, or to tell the person when something happens, such as a reply to an email. Use also when the person asks to change, pause, resume or stop a schedule.
---

# Schedule a message

A schedule makes Eva post on her own, at a set time, in a chat of its own (a Telegram topic). The schedules live in `.eva/schedules.json`. Eva reads the file every 30 seconds, so a change takes effect within a minute. Eva's autosave commits the file like a note, so never commit it yourself.

A new or changed schedule runs at its next time. A change to a time that just passed waits for the next one. So does a start after a pause.

## 1. Pick the place

A schedule is not the only place for a reminder. Pick the place by the kind of request:

- **Work that you must do at that time**, such as "on 24 November, check Gmail for a reply and tell me": always write a schedule with a `prompt`.
- **A message that the person asks Eva herself to send**, such as "message me at 9": write a schedule.
- **A reminder only for the person**, such as "remind me to call the bank on 24 November": follow the vault's rules for reminders and tasks.
  - Read `AGENTS.md` at the vault root, and the `AGENTS.md` of the folder that the reminder is about.
  - When these files name a place, such as the task app, put the reminder there. Do not write a schedule.
  - When the app of that place is "not set", do what the vault says: ask the person which app to use. Offer an Eva schedule as one answer.
  - When the vault names no place for reminders, write a schedule. Tell the person that the vault names no place for reminders.

## 2. Read the file

Read `.eva/schedules.json`. When it is missing, start from this shape:

```json
{
  "version": 1,
  "schedules": []
}
```

## 3. Write the entry

Each schedule is one object in `schedules`:

```json
{
  "id": "morning",
  "name": "Morning",
  "at": "07:30",
  "days": ["mon", "tue", "wed", "thu", "fri"],
  "text": "Drink water. Check the calendar.",
  "file": "Toolbox/morning-checklist.md",
  "prompt": "Summarize my calendar for today.",
  "model": "haiku"
}
```

- **`id`**: 1 to 32 lowercase letters, digits or dashes. It must be unique. Never change the id of an existing schedule, because Eva finds its chat by the id. Never reuse the id of a removed schedule either, because Eva can still hold that schedule's old chat under it. It can also hold that schedule's state, such as its last run.
- **`name`**: required. It names the schedule's topic in Telegram. Eva names the topic when she opens it. A later change to `name` does not rename the topic, so tell the person to rename it in Telegram.
- **`at`**: `HH:MM`, 24 hours, in the time zone that the `[Local time: ...]` line at the start of each message names.
- **`days`**: leave it out for every day. Otherwise list some of `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`.
- **An interval instead of `at` and `days`.** To repeat every few hours, days or weeks, write `every` and `from`, and leave out `at` and `days`:
  - **`every`**: a number from 1 to 999 and a unit: `h` for hours, `d` for days, `w` for weeks. Examples: `2h`, `3d`, `1w`.
  - **`from`**: the first run, as `YYYY-MM-DDTHH:MM`, such as `2026-10-22T07:30`. Each later run comes one interval after the last. A day or week interval keeps the time of day of `from`.
  - Example: `"every": "3d", "from": "2026-10-22T07:30"` runs at 07:30 every third day from 22 October.
- **Once instead of a repeat.** To run one time only, write `from` alone, and leave out `at`, `days` and `every`. Example: `"from": "2026-11-24T10:00"` runs once, at 10:00 on 24 November.
  - Pick a time later than the `[Local time: ...]` line. A time in the past never runs.
  - When Eva is off at that time, the run comes when she is back. When it comes an hour or more late, a line says so.
  - After the run, the schedule stays in the file, and the Schedules page shows it as "Ended". Do not remove it, and do not tell the person to remove it.
  - Never fake a one-off with a long interval, such as `"every": "999w"`.
- **`until`**: optional, for a schedule that repeats. Write its last day as `YYYY-MM-DD`, such as `2026-11-30`. The last day still runs. After it, the schedule does not run, and the Schedules page shows it as "Ended".
- **At least one step.** `text` is a fixed message. `file` is a path from the vault root, as an `[[attach:]]` marker names it. Never use `.eva/scratch/`, because that folder empties after a week, and Eva skips such an entry. `prompt` is a message that you answer, in a fresh chat, at that time. The steps run in that order.
- **`model`**: optional, for a `prompt` only. Use `opus` (Smart), `sonnet` (Balanced) or `haiku` (Fast). Without it, or with any other value, the chat uses the model from the settings.
- **`enabled`**: optional. Write `false` to turn the schedule off. It then never runs, and it keeps its fields. Leave the key out to turn it on. Use only `true` or `false` as the value. Never write it in quotes.

**Prefer `text` or `file` for fixed content.** They cost nothing. A `prompt` costs a full model turn with no cache on every run. Use a `prompt` only when the content must change each time, such as a calendar summary or the news. Write the prompt so it stands alone, because each run starts with no memory of the last one.

**Watch for an event.** The person can ask "tell me when X happens", such as "tell me when the bank replies to my email". Write a watch: a schedule that checks, and stops by itself.

- Use `every` and `from`, with a `prompt` and no `text`. Check no more often than every hour (`1h`). Once a day (`1d`) is often enough.
- Use `"model": "haiku"`, because the check is small and runs many times.
- Write `until`: the last day to check. Pick it from the request, or about one month after the `[Local time: ...]` line.
- Write each fact of the check in the prompt, such as the sender, the subject, and "sent after 2026-11-03". Each run starts with no memory.
- Tell the prompt to only read, and to change nothing.
- Each scheduled run gets a note that teaches two markers:
  - A line `[[quiet]]` ends a run that has nothing to tell. Nobody gets a message, and Eva deletes the run's chat. A run with a file still goes out, and so does a run in which the person wrote.
  - A line `[[done]]` ends the watch. The run's message, if any, goes out. Then Eva turns the schedule off.
  - A failed run is never quiet and never ends the watch. The person gets the failure.
- When the check needs Gmail and Gmail is off, write no schedule. Tell the person to turn Gmail on in the Google settings of Eva.
- Tell the person what each run costs: one small model turn.

Example:

```json
{
  "id": "bank-reply",
  "name": "Bank reply",
  "every": "1d",
  "from": "2026-11-04T09:00",
  "until": "2026-12-04",
  "model": "haiku",
  "prompt": "Look in Gmail for an email from the bank, sent after 2026-11-03, that answers my claim. Only read. If one came, summarize it in two sentences and add a line [[done]]. If none came, answer only [[quiet]]."
}
```

Keep every other entry and key as it is. Write the file as JSON with two spaces of indent.

Eva follows the level that the person set for "Change the schedules": Allow, Ask or Deny. If the write is refused or denied, tell the person that nothing changed, and stop.

If the write fails for another reason, do not try a second way, such as a shell command. Tell the person the reason that the tool gave. Then tell them to add or edit the schedule on the **Schedules** page of the web app, and give each field that you would have written.

## 4. Check what you wrote

Read the file again after you edit it, and check each point:

- The file is valid JSON.
- The entry has `at`, or `every` and `from`, or `from` alone for a one-off. It never has `at` or `days` together with `from`.
- `at` has two digits on each side, such as `07:30` and never `7:30`.
- `every` is a number and `h`, `d` or `w`, and `from` is a date and a time, such as `2026-10-22T07:30`.
- Every `id` is a slug of lowercase letters, digits or dashes, and no two entries share one.
- `days` is absent, or a list that is not empty, of `mon` to `sun`.
- Each entry has a `name`, and at least one step: `text`, `file` or `prompt`.
- `enabled` is absent, `true` or `false`.
- `until` is absent, or a day such as `2026-11-30`, on a schedule that repeats.

Eva skips an entry that fails a check. It says so once in the main chat, in a message that starts "Schedules file problems:", and in `/schedules`.

## 5. Change, pause or remove one

To change a schedule, edit its entry and keep its `id`. To run an ended one-off again, give it a new `from` in the future.

To pause one (turn it off), set `"enabled": false`. Within a minute it stops. To start it again, delete the `enabled` key.

A watch that a `[[done]]` ended is off. To watch again, delete the `enabled` key. If its `until` day has passed, also write a later `until`.

To remove one, delete its entry. The topic stays in Telegram, and the person can delete it with `/delete` once the schedule is gone.

## 6. Reply

Say in one sentence what Eva sends, when, and in which topic. When you followed the vault's rules and wrote no schedule, say where the reminder went. A repeated schedule created after its time today first runs on the next matching day. If the main chat says "Schedules file problems" instead, the entry was skipped, so fix it. `/schedules` lists every schedule, with a button to remove each one.
