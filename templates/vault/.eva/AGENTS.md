# .eva

Eva's configuration for this vault. It is not notes: never file notes here.

| Path | Holds |
| --- | --- |
| `assistant.md` | The person's rules for Eva: how she behaves, her tone, her habits. A preference such as "no summary on weekends" goes here. |
| `settings/settings.json` | Settings: time zone, language of the answers, units, the clock (12h or 24h) and the first day of the week. The person changes them in Eva's Settings page. |
| `settings/saved-prompts/`, `settings/text-actions/` | Shortcuts of the chat menu. |
| `schedules.json` | Scheduled messages. The `schedule` skill edits it. |
| `skills/` | Skills that the person wrote. A skill here wins over Eva's own skill with the same name. |
| `scratch/` | Files sent to a chat or received from it. Git ignores it, and Eva empties it each week. Copy a file worth keeping to its place in the vault. |
| Everything else | Files that Eva manages by herself. Never edit them. |
