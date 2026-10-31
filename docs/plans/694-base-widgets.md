# Plan: the habits and weather base widgets (#694)

Eva ships two base widgets, off by default: habits and weather. Each lives in its own public repository, made from `templates/widget/`.

## Work

1. **The habits widget** (`guplem/eva-widget-habits`). Start from the template, which already is a small habits widget.
   - The card (`medium`): today's habits, with a button to mark each one. A number habit asks for its value.
   - Full screen: each habit with its history calendar, its current and best streaks, and its strength.
   - Small: the count of today. Large: the card list plus a short history row for each habit.
   - It reads its folder again when the page becomes visible again, so a check that Eva wrote in a chat shows with no reload.
   - Its own code: the look and the features of Loop Habit Tracker, never its code, icons, texts or name (GPL-3.0).
2. **The weather widget** (`guplem/eva-widget-weather`). Start from the template, and remove the habits parts.
   - Inputs: the location only. Host: `https://api.open-meteo.com`.
   - Small: the temperature now and the sky. Medium and up: also the next hours. Large and full: also the next days.
   - The credit "Weather data by Open-Meteo", with a link.
   - With no stored location: a text that says how to share one from the phone.
   - A location older than a day: its age.
   - The demo on GitHub Pages: the visitor's location when allowed, else the mock location. The tests answer the API with a mock.
3. **Eva:** add the two addresses to `src/core/widgets/base-widgets.ts`, with a test, and name the two widgets in the guide and in `docs/widgets.md`.

## Gaps

- **The repositories do not exist, and this session cannot create them.** GitHub refuses `POST user/repos` for this session. Decision: file one `requires-human-intervention` issue with the steps. Keep each widget on its own branch of this repository, so no work is lost, and the person or an agent copies it into the new repository.
- **The weather data.** Open-Meteo `/v1/forecast` with `current`, `hourly` and `daily` fields, `timezone=auto`, and the WMO weather codes for the sky. Decision: the widget names each code with its own words.
- **The strength formula.** Loop's strength is a score that rises with each check and decays with each miss, scaled by the frequency. Decision: write our own exponential moving average from the frequency, with our own constants. No code of Loop.
- **A streak of a habit with a frequency below once a day,** such as 3 times a week. Decision: a day counts in a streak when the habit reached its target in the window of `days` days that ends on that day. This follows the frequency and is our own rule.
- **A number habit's target.** The format has no target field. Decision: any check with a value above 0 counts as done. A target comes later, with its own field.
- **The order of the habits.** Decision: by name, as the folder index gives the files. The issue puts reorder in a later version.
- **The size of the weather card.** The issue says `small`.
