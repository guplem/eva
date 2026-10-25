---
name: schedule
description: Create, change, pause or remove a scheduled message by editing .eva/schedules.json. Use when the person asks for a reminder, a summary or any message at a set time, every day, on some days or every few hours, days or weeks, in any wording, or asks to change, pause, resume or stop one.
---

# Schedule a message

A schedule makes Eva post on her own, at a set time, in a chat of its own (a Telegram topic). The schedules live in `.eva/schedules.json`. Eva reads the file every 30 seconds, so a change takes effect within a minute. Eva's autosave commits the file like a note, so never commit it yourself.

After a new schedule, a change, or a start after a pause, Eva opens the schedule's chat within a minute and posts a setup card there. A card for a new schedule shows every field and the next run. A card for a change names what changed. Without Telegram, the web app shows the card in a dialog. The schedule runs only after a card reaches the person: in the web app, after they tap "Got it".

## 1. Read the file

Read `.eva/schedules.json`. When it is missing, start from this shape:

```json
{
  "version": 1,
  "schedules": []
}
```

## 2. Write the entry

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

- **`id`**: 1 to 32 lowercase letters, digits or dashes. It must be unique. Never change the id of an existing schedule, because Eva finds its chat by the id. Never reuse the id of a removed schedule either, because Eva can still hold that schedule's old chat under it. It can also hold that schedule's last setup card, so the next card reads as a change to the old schedule.
- **`name`**: required. It names the schedule's topic in Telegram. Eva names the topic when she opens it. A later change to `name` does not rename the topic, so tell the person to rename it in Telegram.
- **`at`**: `HH:MM`, 24 hours, in the person's time zone. The `[Local time: ...]` line at the start of each message names it.
- **`days`**: leave it out for every day. Otherwise list some of `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`.
- **An interval instead of `at` and `days`.** To repeat every few hours, days or weeks, write `every` and `from`, and leave out `at` and `days`:
  - **`every`**: a number from 1 to 999 and a unit: `h` for hours, `d` for days, `w` for weeks. Examples: `2h`, `3d`, `1w`.
  - **`from`**: the first run, as `YYYY-MM-DDTHH:MM`, such as `2026-10-22T07:30`. Each later run comes one interval after the last. A day or week interval keeps the time of day of `from`.
  - Example: `"every": "3d", "from": "2026-10-22T07:30"` runs at 07:30 every third day from 22 October.
- **At least one step.** `text` is a fixed message. `file` is a path from the vault root, as an `[[attach:]]` marker names it. Never use `Scratch/`, because that folder empties after a week, and Eva skips such an entry. `prompt` is a message that you answer, in a fresh chat, at that time. The steps run in that order.
- **`model`**: optional, for a `prompt` only. Use `opus` (Smart), `sonnet` (Balanced) or `haiku` (Fast). Without it, or with any other value, the chat uses the model from the settings.
- **`enabled`**: optional. Write `false` to turn the schedule off. It then never runs, and it keeps its fields. Leave the key out to turn it on. Use only `true` or `false` as the value. Never write it in quotes.

**Prefer `text` or `file` for fixed content.** They cost nothing. A `prompt` costs a full model turn with no cache on every run. Use a `prompt` only when the content must change each time, such as a calendar summary or the news. Write the prompt so it stands alone, because each run starts with no memory of the last one.

Keep every other entry and key as it is. Write the file as JSON with two spaces of indent.

Eva asks the person to approve each change to this file. If they deny it, tell them that nothing changed, and stop.

If the write fails for another reason, do not try a second way, such as a shell command. Tell the person the reason that the tool gave. Then tell them to add or edit the schedule on the **Schedules** page of the web app, and give each field that you would have written.

## 3. Check what you wrote

Read the file again after you edit it, and check each point:

- The file is valid JSON.
- The entry has `at`, or `every` and `from`, never both.
- `at` has two digits on each side, such as `07:30` and never `7:30`.
- `every` is a number and `h`, `d` or `w`, and `from` is a date and a time, such as `2026-10-22T07:30`.
- Every `id` is a slug of lowercase letters, digits or dashes, and no two entries share one.
- `days` is absent, or a list that is not empty, of `mon` to `sun`.
- Each entry has a `name`, and at least one step: `text`, `file` or `prompt`.
- `enabled` is absent, `true` or `false`.

Eva skips an entry that fails a check. It says so once in the main chat, in a message that starts "Schedules file problems:", and in `/schedules`.

## 4. Change, pause or remove one

To change a schedule, edit its entry and keep its `id`. Eva then posts a setup card that names what changed.

To pause one (turn it off), set `"enabled": false`. Within a minute it stops, and Eva posts no card. To start it again, delete the `enabled` key. Eva then posts a new setup card.

To remove one, delete its entry. The topic stays in Telegram, and the person can delete it with `/delete` once the schedule is gone.

## 5. Reply

Say in one sentence what Eva sends, when, and in which topic. A schedule created after its time today first runs on the next matching day. Tell the person to check the setup card that Eva posts within a minute. Tell them that the schedule runs only after the card reaches them: without Telegram, the web app shows it in a dialog, and the schedule runs after they tap "Got it". If the main chat says "Schedules file problems" instead, the entry was skipped, so fix it. `/schedules` lists every schedule, with a button to remove each one.
