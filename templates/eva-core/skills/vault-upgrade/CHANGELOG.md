# Vault structure changes

Each entry is one version of the vault structure, oldest first. `.eva/vault-structure.json` records the version that a vault follows. A vault with no record follows version 2. Eva reads the `Version` and `Summary` lines of each entry, so keep their shape.

## v3

- **Version:** 3
- **Date:** 2026-11-03
- **Pull request:** https://github.com/guplem/eva/pull/794
- **Summary:** Your notes in Life/ get one folder for each thing, such as a person, an object or a case, with clear rules for each folder. Your own rules get a section of their own.
- **Migrations first:** 2026-11-02-eva-scratch, 2026-11-02-general-project-type, 2026-11-02-pinned-files, 2026-11-03-format-settings

### What changes, and why

The examples are generic: a vault can have any folder names.

1. **`Life/` groups by kind of thing, not by topic.** Old topic folders, such as `Life/Car/`, `Life/Home/`, `Life/Couple/`, `Life/Family/`, `Life/Career/` or `Life/Sport/`, split by what each note is about:
   - A thing or a home, with its contracts and insurance → `Life/Objects/<Type - Model - ID>/Object.md`. A home's electricity or rent goes in the home's folder. ID: a plate or a serial number, the last 4 characters of an IMEI or MAC, or else the purchase year.
   - A matter with steps that ends, such as a claim, a race to prepare, or a job application → `Life/Cases/YYYY-MM-DD-name/Case.md`.
   - A person → `Life/People/<Full Name>/Person.md`, with a link to their contact. A couple folder goes into the partner's folder. A family folder becomes one folder for each person. A note about several people stays loose in `Life/People/`.
   - A pet → `Life/Pets/<Name>/Pet.md`.
   - A job, full-time studies, volunteering or a sabbatical → `Life/Periods/YYYY-MM-DD-name/Period.md`. An app built at a job or a hackathon → its project. The day-to-day work of a job → a project. A job's or study's own record that sits in a project folder, such as a contract, pay, equity, payslips or grades → beside its `Period.md`; the project's `AGENTS.md` says where the record is.
   - Body and mind → `Life/Health/`, also health notes that sit elsewhere, such as in `Toolbox/`. A training plan → `Methods/`.
   - Money that stays → `Life/Finances/`. A day → `Life/Diary/`.
   - Knowledge, by the table of the root `AGENTS.md`: to understand → `Library/`, steps to follow → `Methods/`, copy and use → `Toolbox/`. A knowledge folder in the wrong one moves too.
   - A note that mixes kinds, such as a career note with a section on a hackathon and one on a job application, splits by section: the note moves to the place of its main section, and each other section moves where its kind goes. A note about a whole career may stay in `Life/Periods/`.

   Why: everything about one thing lives in one folder, always with the same shape, so Eva never doubts where to store or look.

2. **The root `AGENTS.md` becomes the v3 map,** and each folder in `Life/` gets its own `AGENTS.md` with its names, fields and statuses, in the exact text of the template. `README.md` becomes two lines. Why: clear folder rules with no list of exceptions. Eva's own logic, such as pinning, lives in Eva. (`.eva/AGENTS.md` comes earlier, through the template alignment.)
3. **_Personal rules_ holds the person's own rules.** In a vault without the section, the upgrade adds it from the template, with the "Outside the vault: my apps" table and the lines that the person chose to keep. Among those lines, one that the v3 template, Eva's base prompt or a `Life/*/AGENTS.md` already says is proposed to leave out; one that contradicts a v3 rule is proposed to keep as an exception, naming the rule. A note that maps where the person keeps things in outside apps, such as a storage map, moves into it, after the person approves. In a vault that has a `## Personal rules` section already, the upgrade keeps it byte for byte, and only adds the apps table when it is missing. Why: one home for the person's own rules, which later upgrades never touch.
4. **What lives outside the vault is linked, not copied.** A local copy of an outside service, such as a contacts export, becomes a link. Two notes with the same content, the same title or the same first paragraph, such as two copies of one guide, become one after the person approves, with the lines that only the other had. A fact that already lives at its place is removed from the old note and linked, after the person approves; a dated record, such as a diary day, stays as it is. Why: each fact lives in one place.
5. **`.eva/assistant.md` keeps only the person's own style and behaviour.** It becomes the short v3 file, plus the lines that the person wrote and chose to keep. A line that Eva's base prompt now holds, such as its limits, is proposed to leave out. Old template rules, such as the date format or "the language lives in About me", go: Eva's base prompt and format settings now hold them. Why: what belongs to Eva lives in Eva.
6. **About me becomes the v3 note.** A migration already moved Eva's settings out of it and added `pinned: full`. The upgrade leaves only the basic identity, such as the name, pronouns, birth date, own contact, region, home and languages. Other text in it moves to its place, after the person approves. `work` links the open job in `Life/Periods/`. Why: About me is pinned in full, so it must stay small.
7. **About me's other facts go to their places,** after the person approves:
   - Diet and allergies → `Life/Health/Allergies and Diet.md`. The upgrade creates it from the template when it is missing. Otherwise it merges the old fields into it.
   - Sleep → `Life/Health/`.
   - Each person → `Life/People/<Full Name>/Person.md`, or the contacts app. A pet → `Life/Pets/`.
   - Each date → the contacts app, such as a birthday linked from `Person.md`, or the calendar, or the note that it belongs to.

   Then the upgrade removes them from About me. Why: each fact lives in one place.

8. **Leftovers go:** an empty `Notes/` folder from the old template, and vault skills that do what one of Eva's own skills now does, such as an old copy of `about-me` or `schedule` in `.eva/skills/`, after the person approves.
9. **Done by code migrations before the upgrade starts:** project `description` → `summary` and `> Important:` → `pinned: summary`; Eva's settings out of About me, and `pinned: full`; project `type`; the `.eva/scratch/` line of `.gitignore`. `eva vault-upgrade start` checks that `.eva/migrations.json` lists their ids. Eva protects the old `Scratch/` while it exists, and keeps its `.gitignore` line. The upgrade points each instruction that reads or writes `Scratch/` in the vault's own skills to `.eva/scratch/`, and each other note that mentions it after the person approves, but never a replaced file or an existing `## Personal rules` section. A dated record, such as a diary day, and a link to a file still in the old `Scratch/` stay as they are. A rule about `Scratch/` goes into _Personal rules_ only pointed to `.eva/scratch/`.

### How to detect a vault that has it

The root `AGENTS.md` has the v3 sections, such as _Personal rules_. Each folder of the v3 `Life/` has its `AGENTS.md`. `Life/` holds no other folder. Then the upgrade only records the version. Otherwise it runs, and asks only about what differs.

### What to ask, all in the one message up front

1. The person's own lines in each replaced file (root `AGENTS.md`, `README.md`, `.eva/assistant.md`, About me), and where to keep each one: leave out a line that v3 already says, and keep a line that contradicts v3 as an exception (item 3).
2. Yolo mode. When the answer is no, the whole move plan, grouped, for approval. When it is yes, no place is asked.
3. Moving a storage map, or a note like it, into _Personal rules_.
4. Where the other text of About me goes, and where each of its facts goes (item 7).
5. What to pin.
6. Each deletion, such as a duplicate, an empty leftover folder or a leftover skill. For a duplicate, which copy stays.
7. The schedule edits that the moves need, approved once for all.
8. The git-ignored files of the vault, and where each one goes.
9. Each other note that mentions `Scratch/` (not a replaced file, not an existing _Personal rules_ section): point it to `.eva/scratch/`. A dated record, such as a diary day, stays as it is.

## v4

- **Version:** 4
- **Date:** 2026-11-03
- **Pull request:** https://github.com/guplem/eva/pull/850
- **Summary:** Your projects get clear dates and goals: the day they started and closed, an optional objective and an optional deadline.
- **Migrations first:**

### What changes, and why

1. **The _Projects_ section of the root `AGENTS.md` names four more keys** in its front matter example, each with one line that says what it means: `started`, `closed`, `objective` and `deadline`. Replace the _Projects_ section with the exact text of `template/`. Leave the rest of the file as it is. Why: an agent that reads only the vault knows when a project began, when it is done, and which date it must not miss.
2. **Nothing else moves.** No note changes. A project keeps the keys that it has. A project with no `started` started at `created`.

### How to detect a vault that has it

The front matter example in the _Projects_ section of the root `AGENTS.md` names `closed`, `started`, `objective` and `deadline`. Then the upgrade only records the version. Otherwise it runs, and asks only about what differs.

### What to ask, all in the one message up front

1. Each line of _Personal rules_ that now says the same as the new _Projects_ text, such as a rule about `closed`. The default is "leave it out". This is the one change to _Personal rules_ that the person can approve, because the line is now a template rule.

## v5

- **Version:** 5
- **Date:** 2026-11-03
- **Pull request:** https://github.com/guplem/eva/pull/852
- **Summary:** Eva reads your principles and your methods before she acts, and follows the steps that you keep, such as how to start a project. The rule now lives in your vault's map, so you can change it.

### What changes, and why

1. **The root `AGENTS.md` gets the folder rule for `Principles/` and `Methods/`,** in the exact text of the template, at the end of _What they know_. Before the agent acts on a request, it lists both folders, reads the notes that fit, and follows each method that fits. It never greps them. Why: Eva's base prompt held the rule for `Principles/` only, and the person could not change it. A method, such as the steps for a new project, was read only when a search found it.
2. **Nothing else changes.** The rest of the root `AGENTS.md` stays as it is, with each of the person's own lines. A line of the person that already says the new rule is proposed to leave out. No note moves. `README.md`, `.eva/assistant.md`, `Life/About me.md` and each `Life/*/AGENTS.md` stay as they are.

### How to detect a vault that has it

The root `AGENTS.md` says "Before you act on a request, list `Principles/` and `Methods/`." Then the upgrade only records the version.

### What to ask, all in the one message up front

1. The person's own lines in the root `AGENTS.md` that the new rule already says, and whether to leave each one out.

## v6

- **Version:** 6
- **Date:** 2026-11-04
- **Pull request:** https://github.com/guplem/eva/pull/860
- **Summary:** Each project records the work and the use apart. The status is the work: active, paused or closed. A new `in-use` key says that you use the project.
- **Migrations first:** 2026-11-04-project-in-use

### What changes, and why

1. **The _Projects_ section of the root `AGENTS.md` names the new status list and the `in-use` key.** The front matter example says `status: active # active, paused or closed` and shows `in-use: true`. The text under it says what the status and the key mean, and the lines of `started`, `closed` and `objective` change. Replace the _Projects_ section with the exact text of `template/`. Why: the old text had one status for both. A tool that the person builds and uses could not be both. A closed tool that they still use left the pinned block.
2. **The `Projects/` row of the table at the top of the root `AGENTS.md` says that an idea is a `paused` project.** Replace the old sentence "An idea for one is a project with status `idea`." with the sentence of `template/`. Leave the rest of the table as it is.
3. **The project files changed already.** The migration of the "Migrations first" line turned each `status: in-use` into `status: closed` with `in-use: true`, and each `status: idea` into `status: paused`. Search `Projects/*/AGENTS.md` for a status `in-use` or `idea` that is still there, such as one that an older Eva wrote after the migration, and fix it the same way.
4. **Nothing else changes.** No note moves. `README.md`, `.eva/assistant.md`, `Life/About me.md` and each `Life/*/AGENTS.md` stay as they are.

### How to detect a vault that has it

The front matter example in the _Projects_ section of the root `AGENTS.md` says `status: active # active, paused or closed` and names `in-use: true`. Then the upgrade only records the version.

### What to ask, all in the one message up front

1. Each line of _Personal rules_ that names the status `in-use` or `idea`, or says that a project has one status. The default is "leave it out": the new _Projects_ text says the rule now. This is the one change to _Personal rules_ that the person can approve, as in v4.
2. Each project file with a status `in-use` or `idea` that the migration did not reach, with the fix of step 3. The default is "fix it".

## v7

- **Version:** 7
- **Date:** 2026-11-06
- **Pull request:** https://github.com/guplem/eva/issues/901
- **Summary:** Each kind of note gets a smaller header that reads more clearly. A case lists its steps, a moment has its time zone, a project can link its result, and any note can have aliases and tags.
- **Migrations first:** 2026-11-06-project-created-offset

### What changes, and why

The examples are generic: a vault can have any notes.

1. **The root `AGENTS.md` gets a _Front matter_ section and a new _Projects_ section.** _Front matter_ says which keys any note can have (`summary`, `aliases`, `tags`), how to reuse a tag, that a reference to a note is its path, and how to write a day and a moment. _Projects_ drops `started` and `cv`, and adds `result`, the rule for `repos` and two optional body sections. Replace the _Entities_ and _Projects_ sections with the exact text of `template/`, and the date sentence of _Writing_. Leave the rest of the file as it is. Why: each key now has one meaning, and a moment is exact in any time zone.
2. **`Life/Cases/`, `Life/Periods/`, `Life/People/`, `Life/Pets/` and `Life/Objects/` get the new `AGENTS.md`,** in the exact text of `template/`.
3. **Each project file changes,** in `Projects/*/AGENTS.md`:
   - `created` with a time already has its offset from UTC, such as `2026-01-31T09:15+01:00`: the migration of the "Migrations first" line added it, with the `timeZone` setting. Never compute an offset by hand.
   - `started` goes. When it is a different day than `created`, first write one line in the text, such as "The work started on 2026-03-02."
   - `cv` becomes a `## Work and achievements` section, after the first paragraph of the text, with the same words.
   - Each `repos` entry that `git clone` cannot use, such as a link to a folder (`.../tree/main/web`), leaves `repos`. Name the folder in the text. When the link is the repository itself, such as `.../tree/main`, delete it.
   - A link where the person uses the result, such as a website or a store page, can become `result`, after the person approves.
4. **Each period changes,** in `Life/Periods/*/Period.md`: `kind` becomes `type`, with the same value. `status` goes: an open period has an empty `to`. `cv` becomes a `## Work and achievements` section after the first paragraph. When a closed period has no `to`, ask the person for its last day.
5. **Each case changes,** in `Life/Cases/*/Case.md`:
   - `status` and `next` become `steps`. For an open or waiting case, `next` becomes the current step: `step` and `due-by` from `next`. When the status was `waiting`, add `waiting-for` with who the case waits for, from `next.step` or the text. Add the steps that the dated lines of the text show as done before it, each with its `done-on`.
   - A closed case keeps its `closed` date and its done steps, if any. When it has no `closed` date, take the day of its last dated line, and list it in the report.
   - `about` goes. Before that, write each of its paths at the start of the text, as a link.
6. **Each person, pet and About me change:**
   - In `Life/People/*/Person.md`, a `relation` through someone gets that person's folder path, such as `cousin of Life/People/Marta Example`, when the folder exists.
   - In `Life/Pets/*/Pet.md`, `vet` moves to the text. A death date in `summary` becomes `death`.
   - In `Life/About me.md`, `nickname` becomes `aliases`, as a list. `region` moves into `places.home`. `hemisphere` goes: Eva finds it from the latitude. `work` becomes a list of the open jobs, each with its `period` and its hours. The comment of `pinned` says "every Assistant chat". Keep each value of the person.
7. **Eva reads the old keys too,** until the upgrade ends. Nothing breaks in the meantime.

### How to detect a vault that has it

The root `AGENTS.md` has a _Front matter_ section, `Life/Cases/AGENTS.md` names `steps`, and no `Case.md` has a `status` key. Then the upgrade only records the version.

### What to ask, all in the one message up front

1. Each line of _Personal rules_ that names `started`, `cv`, a case `status` or `next`, a period `status` or `kind`, or `about`. The default is "leave it out": the new texts say the rule now. This is the one change to _Personal rules_ that the person can approve, as in v4.
2. Each case whose `waiting-for` is not clear from its text, with your best guess as the default.
3. Each closed period with no `to`, and each closed case with no `closed` date, with the day of its last dated line as the default.
4. Each project link that could become `result`, as one list, with "yes to all" as the default.
