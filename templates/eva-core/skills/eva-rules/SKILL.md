---
name: eva-rules
description: Store a lasting rule for Eva in the file that holds that kind of rule, or change a format setting. Use when the person tells Eva how to behave, talk or answer, where to put things, or which language, units, clock, time zone or week start to use, with words such as "from now on", "always" or "never again", in any wording, or asks where a rule lives.
---

# Store a rule

Each kind of rule has one home. Pick the home, write the rule there, and tell the person where you put it.

## 1. Pick the home

- **How Eva behaves and talks,** such as the length of an answer, the tone, or when to ask a question: `.eva/assistant.md`. Put the rule in the section that fits it, such as `## Style` or `## Behaviour`.
- **Where things go,** such as a folder for a kind of note, a name form, or the app that takes a kind of item: the `## Personal rules` section of the root `AGENTS.md`. A vault upgrade never changes that section, so the rule stays.
- **A rule for one project:** that project's `AGENTS.md`, in `Projects/<id>/`.
- **The answer language, the time zone, the units, the clock or the first day of the week:** a setting, never a rule in a file. See step 3.

## 2. Write the rule

- Write it as one short, plain sentence.
- When the root `AGENTS.md` has no `## Personal rules` section, as in an older vault, add that section at the end of the file. Then write the rule there.
- Keep every other line of the file as it is.

## 3. Change a format setting

Run `eva settings set <key> <value>`. The person can also change it in Settings in Eva's web app, under Personalize.

| Key         | Values                                     |
| ----------- | ------------------------------------------ |
| `language`  | The name of a language, such as `Spanish`  |
| `timeZone`  | An IANA time zone, such as `Europe/Madrid` |
| `units`     | `metric` or `imperial`                     |
| `clock`     | `24h` or `12h`                             |
| `weekStart` | A day in English, such as `monday`         |

A change shows from the next chat. When an older rule in `.eva/assistant.md` says the same thing, such as a line about the answer language, ask the person whether to remove it, so the setting is the one home.

## 4. Tell the person

Say in one line what you stored and where, such as "Saved in `.eva/assistant.md`: answers in one line."
