---
name: about-me
description: Save or fix a basic fact about the person in the header of Life/About me.md, or say where a fact about them goes instead. Use when the person says their birthday, name, a nickname or other name, pronouns, their own phone or email, where they live, their home, their job, their studies or work hours, a language they speak, when they sleep, a person close to them, an important date, their diet or an allergy, in any wording, or when a message says that Life/About me.md has problems.
---

# Save a fact about the person

`Life/About me.md` holds only the basic identity of the person, in a YAML header between two `---` lines. Eva's code and scripts read it, and they skip a field that has the wrong form. Keep each form exactly.

## 1. Decide where the fact goes

- **Save only what the person says.** Never save a guess. "I turn 30 tomorrow" gives the birth date. "I go to the gym" gives no gym name.
- **Leave out what the person does not know.** A birthday with no year is `--MM-DD`.
- **Ask before you save a health fact**, such as an allergy.
- **A fact with a field in the table below** goes in the header.
- **Every other fact has its own place:**
  - The answer language, the time zone, the units, the clock and the first day of the week are Eva settings. The person sets them in Eva's Settings, under Personalize, or with `eva settings set`, such as `eva settings set clock 12h`. Never write them in the note.
  - Diet and allergies go to `Life/Health/Allergies and Diet.md`.
  - Sleep goes to a note in `Life/Health/`.
  - A person close to them goes to `Life/People/<Full Name>/Person.md`. A birthday lives in the contacts app, linked from that note.
  - A long story goes in a note under `Life/`, where `AGENTS.md` says.
- **When that note does not exist yet,** create it. A new `Life/Health/Allergies and Diet.md` starts with a header that holds `pinned: full` and a `summary:` line of the allergies and the diet, so Eva sees them in every Assistant chat.

## 2. Write the field

Read the note first. Change only the field that the person gave. Keep every other line, and keep the text under the header as it is. When the note has no header, add one at the top: only the fields that the person gave, in the form of the example, with `pinned: full`.

| Field                     | Form                                                                                                                                                                                         | Example                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `name`                    | What Eva calls the person                                                                                                                                                                    | `Alex`                  |
| `givenName`, `familyName` | Text                                                                                                                                                                                         | `Alex`, `Example`       |
| `aliases`                 | A list of the other names that people call the person                                                                                                                                        | `[Lex]`                 |
| `pronouns`                | Text                                                                                                                                                                                         | `they/them`             |
| `birthDate`               | `YYYY-MM-DD`, or `--MM-DD` when the person gives no year                                                                                                                                     | `1990-05-14`, `--05-14` |
| `contact`                 | The person's own `phone` and `email`                                                                                                                                                         | see the example         |
| `places`                  | A key for each place the person goes to often. `home` is the main home. Another residence gets its own key, such as `cottage`. Each place has `city`. Add `name`, `address`, `lat` and `lon` | see the example         |
| `places.home.region`      | ISO 3166 code: a country, or a country and a region. It picks the local days                                                                                                                 | `US`, `US-CA`, `GB`     |
| `work`                    | A list of the open jobs and studies. Each has `period`: the path of its folder in `Life/Periods/`. Add its hours: `from` and `to` as `HH:mm`, and `days` from `mon` to `sun`                 | see the example         |
| `languages`               | A list. Each has `name` and `level`, such as `native` or `B2`                                                                                                                                | see the example         |

When the person says where they live, fill `places.home` with its `region`, `city`, `lat` and `lon`. The center of the city is enough for `lat` and `lon`. Eva finds the hemisphere from `lat`.

When a job or a study ends, remove its item from `work`.

Never edit `lastLocation`: Eva's code fills it from the person's phone. Change `pinned` only when the person asks.

Leave a field empty, not invented, when the person did not say it.

## 3. Example

```yaml
---
pinned: full
summary:
name: Alex
givenName: Alex
familyName: Example
aliases: [Lex]
pronouns: they/them
birthDate: 1990-05-14
contact: { phone: "+1 555 0100", email: alex@example.com }
places:
  home: { address: 1 Example Street, city: San Francisco, region: US-CA, lat: 37.77, lon: -122.42 }
work:
  - period: Life/Periods/2024-09-01-example-job
    from: "09:00"
    to: "18:00"
    days: [mon, tue, wed, thu, fri]
  - { period: Life/Periods/2025-09-15-example-course, from: "19:00", to: "21:00", days: [tue, thu] }
languages:
  - { name: Spanish, level: native }
  - { name: English, level: C1 }
lastLocation:
---
```

Put a time in quotes, such as `"07:30"`, so YAML keeps it as text.

## 4. Old fields

An older header can still hold `sleep`, `people`, `dates`, `diet` and `allergies`. The vault upgrade moves them with the person. Until then:

- Keep them and their values. Never add one, and never fill an empty one: a new fact goes to its own place (step 1).
- When one already holds a value and the person changes it or adds to it, write the change in that field, so the topic keeps one home. Such as a partner's birthday in `people`, an allergy that is gone, or one more allergy beside the listed ones.
- Their forms: `sleep` has `from` and `to` as `HH:mm`. `people` is a list, each with `name`, `relation` and maybe `birthDate`. `dates` is a list, each with `name` and `date` as `YYYY-MM-DD`. `diet` and `allergies` are lists of text.

An older header can also hold `nickname`, a top-level `region` and `hemisphere`, and `work` as one map with no list. Eva's code still reads them until the vault upgrade. When the person changes one of these facts, write it in its new form, and remove the old field:

- Write a new name in `aliases`, and move the `nickname` into that list.
- Write a new home in `places.home` with its `region`. Remove the top-level `region`. Remove `hemisphere` once `places.home` has `lat`: an old `hemisphere` wins over the one that Eva finds from `lat`.
- Write a change of job as a `work` list, with the old map as its first item when that job is still open.

## 5. Tell the person

Say in one line what you saved and where, such as "Saved: your birthday is 14 May." Eva's autosave commits the note, so never commit it yourself.

## 6. Fix a problem

Before the person's text, a message can have a line that starts with `[Life/About me.md has problems:`. Fix each field that the line names to the form in the table, or to its old form (step 4). When the line says that a field is an Eva setting now, read the setting with `eva settings get`. When it is not set, set it with `eva settings set`. When it holds another value, tell the person where the field belongs now, and ask which value is right before you change the setting. Then remove the field. When you cannot tell the right value, ask the person, and leave the field empty until they answer.
