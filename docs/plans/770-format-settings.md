# Plan: format settings and a slim About me (#770)

The answer language, the units, the clock and the first day of the week become shared Eva settings, beside `timeZone`. Settings > Personalize gets pickers for them. Eva shows them in a prompt block, and every time that a person reads follows the clock. A frozen vault migration moves only these settings out of `Life/About me.md`, and adds `pinned: full`. A new vault gets a slim About me and `Life/Health/Allergies and Diet.md`.

## Motivation

Each fact has one home, and Eva's own things live in Eva (decisions.md). Today the answer language lives in the body of About me, and `units`, `clock` and `weekStart` live in its header, but no code follows them: every time shows as 24-hour, and every week starts on Monday. Round 2 decision R5 narrows the migration: an Eva update never creates notes in `Life/`, so diet, allergies, sleep, people and dates stay in About me until `vault-upgrade` (#773).

## Design

- **Settings.** `configSchema` gets four top-level keys, each null by default: `language` (text), `units` (`metric` or `imperial`), `clock` (`24h` or `12h`) and `weekStart` (`monday` to `sunday`). They join `sharedSettingKeys`, so they live in `.eva/settings/settings.json`. They are live settings: a save needs no restart, and the next new chat uses them.
- **One formatter.** `src/shared/time-format.ts` writes a time of day in either clock form, such as `14:05` or `2:05 PM`, and turns a `weekStart` into a day number. The core and the web app use it.
- **The effective format.** `formatSettingsOf(config, vaultPath)` in `src/core/modes/format-block.ts` reads each setting. When a setting is null, it reads a valid `units`, `clock` or `weekStart` from the About me header (old vault on a satellite, one release). Without either, the value is null, and code keeps today's form (24-hour, Monday).
- **The prompt block.** `src/core/modes/format-block.ts` writes "The person's format settings": five lines (answer language, time zone, units, clock, first day of the week, "not set" when empty) and the fixed sentence of the issue. `AssistantPreparer` builds it at the first turn of each chat, keeps it in `promptBySession`, puts it after the pinned block and before the widgets, and shows it in the chat details.
- **Times that follow the clock.** The `[Local time: …]` line, the usage-limit line (web app, Telegram, terminal), the chat list, the notification history, the dates with a time in smart names, and the Schedules page (next run, day line and its hour labels, "Now", schedule words, setup card). Stored and compared times stay 24-hour: schedule slots, `.eva/schedules.json` and the file stamp of `assistant-rules.ts`.
- **The browser.** `EvaStatus` gets `format: { clock, weekStart }`, the effective values. The app reads them with the status, keeps them in `display-format.ts`, and re-renders. The terminal chat reads the status once at start.
- **Days that follow `weekStart`.** The day buttons of the schedule form and the day order of the schedule words. "Weekdays" and "Weekends" are found by the set of days.
- **Pickers.** A "Language and formats" card in Settings > Personalize, after Time zone, in the same form and under the same Save: Answer language (text), Units, Clock and First day of the week (choice chips). Each key gets a `settingPlaces` row and a row in `docs/guide/reference.md`.
- **Setup.** Both paths (`eva setup` and the web `VaultSetup.create`) save, after the new vault folder is saved: the answer language, the detected time zone when `timeZone` is null, and the clock, week start and units of the computer's locale when they are null. One core function, `newVaultSettings` in `src/core/settings/format-defaults.ts`, builds the change.
- **Template, new vaults only.** `templates/vault/Life/About me.md` follows `drafts/about-me-template.md`: slim, `pinned: full`, an empty `summary:`, no Language or Time zone line. `templates/vault/Life/Health/Allergies and Diet.md` follows `drafts/allergies-and-diet-template.md`. The template `.eva/assistant.md` stops sending the agent to About me for the language and the time zone.
- **About me reader.** `aboutMeHeaderKeys` lists the slim keys and the five old personal keys, which stay valid. `work` accepts a `period` key. `readAboutMe` keeps today's checks for `sleep`, `people`, `dates`, `diet` and `allergies`. It stops checking the form of `units`, `clock` and `weekStart`: after the migration, one of them in the header gets one problem that names the setting where it belongs now.
- **The migration** `2026-11-03-format-settings` (vault, frozen):
  - Waits ("later") until `2026-10-30-settings-folder` is in the vault's record, and while only the old `.eva/settings.json` exists: a write from an empty start would hide or cut the person's settings.
  - Waits while the About me header is broken, so the move runs after the repair.
  - Reads the About me header and body as raw text.
  - For `units`, `clock` and `weekStart`: copies a valid value into the settings when the setting is missing or null. Removes the field from the header when its value is valid or empty. A bad value stays, so nothing is lost.
  - Reads the `- **Language for answers:** …` line: copies its value to `language` when the setting is empty, then deletes the line.
  - Reads the `- **Time zone:** …` line: copies it to `timeZone` when the setting is null and `Intl` accepts the zone. It deletes the line only when it is empty, copied, or the setting already holds a value; an unknown zone keeps its line, so nothing is lost.
  - Removes a moved field with its own lines, but keeps a comment line under it.
  - Adds `pinned: full` when the header has no `pinned` key.
  - Checks the result: the header parses, and only `units`, `clock`, `weekStart` and `pinned` changed. The body changed only by the two lines. On any doubt, it leaves About me as it is.
  - Writes `.eva/settings/settings.json`, starting from its own content, and the old `.eva/settings.json` when it exists, as the settings code does, on raw JSON, checked with `parseConfig`. It writes no other file under `Life/`.
- **The skill.** `templates/vault/.eva/skills/about-me/SKILL.md` describes only the slim fields, says where every other fact goes, and has a short "Old fields" part for a vault before #773.

## Gaps and decisions

The owner is away. Each decision below is what his intentions point to (decisions.md, ROUND2.md R5), with the reason.

1. **Migration scope.** Only Eva settings leave About me, plus `pinned: full`. The five old personal fields stay byte for byte. Reason: R5.
2. **The time zone line moves too** (assumption 7). Reason: it is an Eva setting, and it fixes a web-made vault whose `timeZone` stayed null.
3. **A bad `units`, `clock` or `weekStart` value stays in the header**, with a problem that names the setting. Reason: nothing is lost, and the agent moves it with the person.
4. **Live settings.** The four keys join `liveSettingKeys`: a save needs no restart. The prompt block reads the current settings at the first turn of each new chat. Reason: "Plug and play"; no restart for a format choice. `timeZone` keeps its restart, as today.
5. **The browser gets the format through the status**, not through each component's props. Reason: one read that the app already polls, no prop threading through a dozen components.
6. **The older-hub risk is accepted, and named in the PR.** Before this Eva reaches the hub, the hub knows none of the four keys. A newer satellite can save `clock`, and the hub's next settings save drops it, because that older code writes only the keys it knows. The pickers do not wait for the migration. Reason: the loss is one format choice that the person sees and sets again, and a gate would add a new state to the Settings page. From this release on, a settings save keeps every top-level key of the vault's file that it does not know, so the next new setting has no such risk.
7. **Card layout.** A new card, "Language and formats" (item `formats`), after the Time zone card, in the same form. The Time zone card stays, so its links keep working. Reason: reuse the existing card and form, one Save.
8. **12-hour form.** `2:05 PM`, with no leading zero, as `en-US` writes it. The day line hour labels show `6 AM`, `12 PM`. Reason: common and short.
9. **The `[Local time: …]` line** keeps `YYYY-MM-DD`, and only the time follows the clock, such as `2026-10-14 2:30 PM`. Reason: the agent sees the person's form; the date form stays one.
10. **Locale for setup.** `Intl.DateTimeFormat().resolvedOptions().locale`, with `getWeekInfo()` or `weekInfo` for the week start. Reason: assumption 6.
11. **The template `.eva/assistant.md`** gets a one-line change only: the language and the time zone are Eva settings, and a time follows the clock setting. Reason: a new vault must not hold a false rule; #772 replaces the file later.
12. **The pinned-files migration** already skips About me. This migration adds the pin. Reason: #769 left it to #770.
13. **No base prompt edit.** #771 writes the text that explains the block. Reason: assumption 9.
14. **Effective values everywhere** (review). The format block names the zone in use: the setting, or the computer's zone when it is not set, as for today's date. The `[Local time: …]` line uses the zone and the clock of the chat's block. The Settings pickers show the values in use, also one still only in About me. After a save, the page reads the status at once, so its times follow the new clock.
15. **Setup forms on a server** (review). A Linux computer with no locale set (no `LC_ALL`, `LC_TIME`, `LC_MESSAGES` or `LANG`, or only `C` or `POSIX`) gives no clock, week start or units: the engine's fallback is `en-US`, which would give a Spanish owner a 12-hour clock and miles. The web setup sends the browser's locale and time zone, so a hub with none still gets the person's forms. A failed settings save at setup is a problem line on both paths, never a stop.
16. **A moved field after the migration** (review). The problem line and the skill say: set the setting when it is not set; when it holds another value, ask the person which one is right first; then remove the field.
