# Periods

A period is what the person did in a stretch of life: a job, a study, volunteer work or a sabbatical.

**Name:** each period is a folder `Life/Periods/YYYY-MM-DD-name/`, dated on its first day. `name` is lowercase, with hyphens, such as `2024-09-01-example-corp-engineer`. The main file is `Period.md`.

```yaml
---
type: job # job, study, volunteer or sabbatical
from: 2024-09-01
to: # YYYY-MM-DD, the last day. Empty while the period goes on
org: Example Corp # not for a sabbatical
role: Software engineer # optional
summary: Software engineer at Example Corp, a company that makes example apps.
---
```

- **A period is open while `to` is empty, or a day that has not passed yet,** such as the end of a fixed-term contract. There is no status key.
- **The text under the front matter** starts with what the period was. Then a `## Work and achievements` section can follow, with one to three lines for a CV, with no dates: what the person built or achieved there.
- **The `work` list of `Life/About me.md`** has one item for each open job or study, with the path of its period in its `period` key.
- **Beside `Period.md`:** the contract, payslips, certificates, diplomas and references.
- **Periods can overlap,** such as two jobs at once.
- **A promotion or a short leave** is a dated line in its period. Update `role` for a promotion.
- **A file about the whole career,** such as the CV, sits in `Life/Periods/` itself, not in a period.

**Not here:**

- The work done in a job, such as its meetings and designs → a project in `Projects/`, linked from `Period.md`.
- A hackathon, or anything else that built something → `Projects/`.
- A job application → `Life/Cases/`. When it succeeds, create the period.
- A language that the person speaks → `Life/About me.md`.

**Closing:** set `to`, and check that _Work and achievements_ is true and complete. When a job ends, change `work` in `Life/About me.md`. Never move or rename the folder.
