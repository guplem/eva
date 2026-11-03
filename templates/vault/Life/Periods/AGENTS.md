# Periods

A period is what the person did in a stretch of life: a job, a study, volunteer work or a sabbatical.

**Name:** each period is a folder `Life/Periods/YYYY-MM-DD-name/`, dated on its first day. `name` is lowercase, with hyphens, such as `2024-09-01-example-corp-engineer`. The main file is `Period.md`.

```yaml
---
kind: job # job, study, volunteer or sabbatical
status: open # open or closed
from: 2024-09-01
to: # YYYY-MM-DD, when the status becomes closed
org: Example Corp
role: Software engineer
summary: Software engineer at Example Corp, a company that makes example apps.
cv: Built the payments service. Led the move to a new database. # 1 to 3 lines for a CV, no dates
---
```

- **The `work` field of `Life/About me.md`** links to the open job, in its `period` key.
- **Beside `Period.md`:** the contract, payslips, certificates, diplomas and references.
- **Periods can overlap,** such as two jobs at once.
- **A promotion or a short leave** is a dated line in its period. Update `role` for a promotion.
- **A file about the whole career,** such as the CV, sits in `Life/Periods/` itself, not in a period.

**Not here:**

- The work done in a job, such as its meetings and designs → a project in `Projects/`, linked from `Period.md`.
- A hackathon, or anything else that built something → `Projects/`.
- A job application → `Life/Cases/`. When it succeeds, create the period.
- A language that the person speaks → `Life/About me.md`.

**Closing:** set `status: closed` and `to`, and check that `cv` is true. When a job ends, change `work` in `Life/About me.md`. Never move or rename the folder.
