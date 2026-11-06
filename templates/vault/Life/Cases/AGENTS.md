# Cases

A case is a matter with a start and an end that leaves nothing built: a claim, a refund, a sign-up, a party, a trip, a move, a surgery, a therapy, a job application.

**Name:** each case is a folder `Life/Cases/YYYY-MM-DD-name/`, dated on the day it opened. `name` is lowercase, with hyphens. The main file is `Case.md`.

```yaml
---
opened: 2026-05-15
closed: # YYYY-MM-DD, the day the case ended
steps: # while the case is open
  - { step: Send the photos to the insurer, done-on: 2026-05-15 }
  - { step: Get the insurer's answer, waiting-for: The insurer, due-by: 2026-06-01 }
  - { step: "Take the car to the garage, and ask for the invoice" }
deadline: { date: 2026-06-15, cost: The right to claim expires } # only when missing a date loses something
aliases: [the bumper claim] # optional: other names that the person uses for the case
summary: Claim for a broken bumper. The insurer has the photos.
---
```

- **A case is open until `closed` has a date.** There is no status key.
- **`steps` lists the steps of the case, in order.** Each step says what to do in `step`. Put a text of a step, such as `step` or `waiting-for`, in double quotes when it holds a comma, a colon or a `#`, or YAML breaks it. A step can have three more keys:
  - `done-on` is the day when the step was done. A step without it is still to do.
  - `waiting-for` names who or what the person waits for, such as the insurer. A step without it is for the person to do.
  - `due-by` is the day to do the step. When the step waits for someone, it is the day to chase them: the day after their answer is due, or two weeks away if nobody gave a date. A blocked step gets a check one to three months away.
- **The current step is the first step without `done-on`.** Every open case has one, and it always has `due-by`. When it has `waiting-for`, the case waits for someone. A later step can have no date: the list gives the order. `due-by` is never later than `deadline.date`.
- **Write the steps that are known.** Add a step when it becomes known. The done steps over all the steps show how far the case is.
- **`deadline` is a date that someone else set, where missing it costs money, a right or the event.** Write only the nearest one, and say what is lost in `cost`. List later deadlines in the text. Leave `deadline` empty when nothing is lost by waiting. Add one task for it in the task app, so the person gets a reminder even if they do not talk to Eva. Only a `deadline` gets a task. A step never does.
- **The event itself is not a field.** A trip, a surgery or a party goes in the calendar, and its date goes in `summary`. Before the event, the steps prepare it. After it, a step is the follow-up, or the case closes.
- **After each step,** set its `done-on`, and update `summary` the same day. Never copy a step into the calendar or the task app.
- **The text under the front matter** links each note that the case is about by its path, such as `Life/Objects/Car - Example Model - 1234ABC`. Then it holds what happened, one dated line for each event: a call, an email, an answer.
- **Beside `Case.md`:** the evidence, such as photos, emails, forms and receipts.

**Not here:**

- Something built that lasts, such as a hackathon app → `Projects/`.
- A job, a study or a sabbatical → `Life/Periods/`. The application for it is a case.
- A lasting condition → `Life/Health/`. A surgery or a therapy for it is a case.
- A contract that outlives the case → with what it regulates, such as the car.

**Closing:** set `closed`, set `done-on` on each step that was done, remove each step that will never happen, and write the outcome in `summary`. Never move or rename the folder.
