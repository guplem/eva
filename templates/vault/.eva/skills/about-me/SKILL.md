---
name: about-me
description: Save or fix a basic fact about the person in the header of Life/About me.md. Use when the person says their birthday, name, nickname, pronouns, where they live, their home or work place, when they sleep or work, a person close to them, an important date, their diet or an allergy, in any wording, or when a message says that Life/About me.md has problems.
---

# Save a fact about the person

`Life/About me.md` starts with a YAML header between two `---` lines. Eva's code and scripts read it, and they skip a field that has the wrong form. Keep each form exactly.

## 1. Decide if the fact belongs here

- **Save only what the person says.** Never save a guess. "I turn 30 tomorrow" gives the birth date. "I go to the gym" gives no gym name.
- **Leave out what the person does not know.** A birthday with no year is `--MM-DD`. A person with no known birthday has no `birthDate`.
- **Ask before you save a health fact**, such as an allergy.
- **Keep other facts in the notes.** A long story about a relative goes in a note under `Life/`. The header keeps only the fields below.
- **Never add the time zone or the answer language to the header.** The time zone is an Eva setting. The answer language stays in the text under the header.

## 2. Write the field

Read the note first. Change only the field that the person gave. Keep every other line, and keep the text under the header as it is. When the note has no header, add one at the top: only the fields that the person gave, in the form of the example.

| Field                                 | Form                                                                                                                 | Example                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `name`                                | What Eva calls the person                                                                                            | `Alex`                   |
| `givenName`, `familyName`, `nickname` | Text                                                                                                                 | `Alex`, `Example`, `Lex` |
| `pronouns`                            | Text                                                                                                                 | `they/them`              |
| `birthDate`                           | `YYYY-MM-DD`, or `--MM-DD` when the person gives no year                                                             | `1990-05-14`, `--05-14`  |
| `region`                              | ISO 3166 code: a country, or a country and a region                                                                  | `ES`, `ES-CT`, `US-CA`   |
| `hemisphere`                          | `north` or `south`, from where the person lives                                                                      | `north`                  |
| `units`                               | `metric` or `imperial`                                                                                               | `metric`                 |
| `clock`                               | `24h` or `12h`                                                                                                       | `24h`                    |
| `weekStart`                           | A day in English, in lower case                                                                                      | `monday`                 |
| `sleep`                               | `from` and `to`, as `HH:mm`                                                                                          | see the example          |
| `work`                                | `from` and `to` as `HH:mm`, and `days` as a list of `mon` to `sun`                                                   | see the example          |
| `places`                              | A key for each place, such as `home`, `work` or `gym`. Each place has `city`. Add `name`, `lat` and `lon` when known | see the example          |
| `people`                              | A list. Each has `name` and `relation`. Add `birthDate` when known                                                   | see the example          |
| `dates`                               | A list. Each has `name` and `date` as `YYYY-MM-DD`                                                                   | see the example          |
| `diet`, `allergies`                   | Lists of text                                                                                                        | `[vegetarian]`           |

When the person says where they live, fill `region`, `hemisphere` and `places.home` together.

Never edit `lastLocation`. Eva's code fills it with the last location from the person's phone. Keep its line as it is.

Leave a field empty, not invented, when the person did not say it.

## 3. Example

```yaml
---
name: Alex
givenName: Alex
familyName: Example
nickname: Lex
pronouns: they/them
birthDate: 1990-05-14
region: ES-CT
hemisphere: north
units: metric
clock: 24h
weekStart: monday
sleep:
  from: "23:30"
  to: "07:30"
work:
  from: "09:00"
  to: "18:00"
  days: [mon, tue, wed, thu, fri]
places:
  home: { city: Barcelona, lat: 41.39, lon: 2.17 }
  gym: { name: Example Gym, city: Barcelona }
people:
  - { name: Sam, relation: partner, birthDate: 1991-02-03 }
  - { name: Luna, relation: dog, birthDate: 2020-08-01 }
dates:
  - { name: Wedding anniversary, date: 2018-09-15 }
diet: [vegetarian]
allergies: []
---
```

Put a time in quotes, such as `"07:30"`, so YAML keeps it as text.

## 4. Tell the person

Say in one line what you saved, such as "Saved: your birthday is 14 May." Eva's autosave commits the note, so never commit it yourself.

## 5. Fix a problem

Before the person's text, a message can have a line that starts with `[Life/About me.md has problems:`. Fix each field that the line names to the form in the table. When you cannot tell the right value, ask the person, and leave the field empty until they answer.
