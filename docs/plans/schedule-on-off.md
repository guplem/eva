# Turn a schedule off and on (#188)

## Why

Today the only way to stop a schedule is to remove it, and that loses its fields. The EVE design shows an on/off toggle on each schedule card.

## Decisions

- **Field:** `"enabled": false` in an entry of `.eva/schedules.json` turns the schedule off. No field, or `true`, means on. Any other value skips the entry with a sentence, so a typo such as `"false"` never runs a paused schedule.
- **Format version:** stays 1. A file from before the change reads as before. A version bump would make an older Eva refuse the whole file. The cost: an older Eva on the hub ignores `enabled`, so it runs a paused schedule until it updates.
- **Turning off needs no setup card.** An off schedule never fires, never shows a card, and a card that waits for it stops waiting.
- **Turning on needs a setup card** (lesson 67): someone with push access could turn on a schedule that the person paused. The state file records `paused: true` when the scheduler sees a schedule off. While `paused` holds, the schedule is not announced, so it gets a card that lists `enabled` as a change. The card clears `paused`. `setEnabled` records the pause at once, so off and on between two checks still needs a card. A pause and a resume that both arrive in one vault pull, or before a new hub saw the pause, need no card. Such a resume only brings back fields that the person already confirmed, so this gap stays.
- **`announcedFields` does not change,** so no existing schedule asks for a new confirmation (lesson 66).
- **Core write:** `setScheduleEnabled` edits only the `enabled` key of the raw entry. It deletes the key to turn the schedule on, so the file stays as the person wrote it.
- **API:** `PATCH /api/schedules/<id>` with `{ "enabled": boolean }`.
- **Web:** a switch (`role="switch"`, the shared `.toggle`) on each schedule row, as the `.tog` of the design. An off row shows an "Off" pill and no next run. The day line leaves off schedules out.
- **Telegram:** `/schedules` marks an off schedule with "off" and shows no next run.
- **Skill:** the schedule skill documents `enabled`.
