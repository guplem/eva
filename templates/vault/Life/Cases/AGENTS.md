# Cases

A case is a matter with a start and an end that leaves nothing built: a claim, a refund, a sign-up, a party, a trip, a move, a surgery, a therapy, a job application.

**Name:** each case is a folder `Life/Cases/YYYY-MM-DD-name/`, dated on the day it opened. `name` is lowercase, with hyphens. The main file is `Case.md`.

```yaml
---
status: waiting # open, waiting or closed
opened: 2026-05-15
closed: # YYYY-MM-DD, when the status becomes closed
next: { date: 2026-06-01, step: Call the insurer if no answer came } # always, while open or waiting
deadline: { date: 2026-06-15, cost: The right to claim expires } # only when missing a date loses something
about: [Life/Objects/Car - Example Model - 1234ABC] # the entities that the case is about
summary: Claim for a broken bumper. The insurer has the photos.
---
```

- **`waiting`** means that the next step belongs to someone else.
- **`next` is the next step and the day to take it.** Every open or waiting case has exactly one. When the step belongs to someone else, the step is to chase them, on the day after their answer is due, or two weeks away if nobody gave a date. A blocked case gets a check one to three months away. `next.date` is never later than `deadline.date`.
- **`deadline` is a date that someone else set, where missing it costs money, a right or the event.** Write only the nearest one, and say what is lost in `cost`. List later deadlines in the text. Leave `deadline` empty when nothing is lost by waiting. Add one task for it in the task app, so the person gets a reminder even if they do not talk to Eva. Only a `deadline` gets a task. `next` never does.
- **The event itself is not a field.** A trip, a surgery or a party goes in the calendar, and its date goes in `summary`. Before the event, `next` is the last step to prepare. After it, `next` is the follow-up, or the case closes.
- **After each step,** update `summary` and `next` the same day. Never copy `next` into the calendar or the task app.
- **The text under the front matter** holds what happened, one dated line for each step: a call, an email, an answer.
- **Beside `Case.md`:** the evidence, such as photos, emails, forms and receipts.

**Not here:**

- Something built that lasts, such as a hackathon app → `Projects/`.
- A job, a study or a sabbatical → `Life/Periods/`. The application for it is a case.
- A lasting condition → `Life/Health/`. A surgery or a therapy for it is a case.
- A contract that outlives the case → with what it regulates, such as the car.

**Closing:** set `status: closed` and `closed`, write the outcome in `summary`, and empty `next`. Never move or rename the folder.
