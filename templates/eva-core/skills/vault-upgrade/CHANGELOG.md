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
   - A note that mixes kinds, such as a career note with a section on a hackathon and one on a job application, splits by section: each section goes where its kind goes. A note about a whole career may stay in `Life/Periods/`.

   Why: everything about one thing lives in one folder, always with the same shape, so Eva never doubts where to store or look.

2. **The root `AGENTS.md` becomes the v3 map,** and each folder in `Life/` gets its own `AGENTS.md` with its names, fields and statuses, in the exact text of the template. `README.md` becomes two lines. Why: clear folder rules with no list of exceptions. Eva's own logic, such as pinning, lives in Eva. (`.eva/AGENTS.md` comes earlier, through the template alignment.)
3. **_Personal rules_ holds the person's own rules.** In a vault without the section, the upgrade adds it from the template, with the "Outside the vault: my apps" table and the lines that the person chose to keep. A line that the v3 template, Eva's base prompt or a `Life/*/AGENTS.md` already says, or that a v3 rule contradicts, is proposed to leave out. A note that maps where the person keeps things in outside apps, such as a storage map, moves into it, after the person approves. In a vault that has a `## Personal rules` section already, the upgrade keeps it byte for byte, and only adds the apps table when it is missing. Why: one home for the person's own rules, which later upgrades never touch.
4. **What lives outside the vault is linked, not copied.** A local copy of an outside service, such as a contacts export, becomes a link. Two notes with the same content, such as two copies of one guide, become one, with the lines that only the other had. A fact that already lives at its place is removed from the old note and linked. Why: each fact lives in one place.
5. **`.eva/assistant.md` keeps only the person's own style and behaviour.** It becomes the short v3 file, plus the lines that the person wrote and chose to keep. A line that Eva's base prompt now holds, such as its limits, is proposed to leave out. Old template rules, such as the date format or "the language lives in About me", go: Eva's base prompt and format settings now hold them. Why: what belongs to Eva lives in Eva.
6. **About me becomes the v3 note.** A migration already moved Eva's settings out of it and added `pinned: full`. The upgrade leaves only the basic identity, such as the name, pronouns, birth date, own contact, region, home and languages. Other text in it moves to its place, after the person approves. `work` links the open job in `Life/Periods/`. Why: About me is pinned in full, so it must stay small.
7. **About me's other facts go to their places,** after the person approves:
   - Diet and allergies → `Life/Health/Allergies and Diet.md`. The upgrade creates it from the template when it is missing. Otherwise it merges the old fields into it.
   - Sleep → `Life/Health/`.
   - Each person → `Life/People/<Full Name>/Person.md`, or the contacts app. A pet → `Life/Pets/`.
   - Each date → the contacts app, such as a birthday linked from `Person.md`, or the calendar, or the note that it belongs to.

   Then the upgrade removes them from About me. Why: each fact lives in one place.

8. **Leftovers go:** an empty `Notes/` folder from the old template, and vault skills that do what one of Eva's own skills now does, such as an old copy of `about-me` or `schedule` in `.eva/skills/`, after the person approves.
9. **Done by code migrations before the upgrade starts:** project `description` → `summary` and `> Important:` → `pinned: summary`; Eva's settings out of About me, and `pinned: full`; project `type`; the `.eva/scratch/` line of `.gitignore`. `eva vault-upgrade start` checks that `.eva/migrations.json` lists their ids. Eva protects the old `Scratch/` while it exists, and keeps its `.gitignore` line. The upgrade points each mention of `Scratch/` in the vault's own skills and notes to `.eva/scratch/`, and never writes a rule about `Scratch/` into _Personal rules_.

### How to detect a vault that has it

The root `AGENTS.md` has the v3 sections, such as _Personal rules_. Each folder of the v3 `Life/` has its `AGENTS.md`. `Life/` holds no other folder. Then the upgrade only records the version. Otherwise it runs, and asks only about what differs.

### What to ask, all in the one message up front

1. The person's own lines in each replaced file (root `AGENTS.md`, `README.md`, `.eva/assistant.md`, About me), and where to keep each one, or to leave it out when v3 already says it or contradicts it.
2. Yolo mode. When the answer is no, the whole move plan, grouped, for approval. When it is yes, no place is asked.
3. Moving a storage map, or a note like it, into _Personal rules_.
4. Where the other text of About me goes, and where each of its facts goes (item 7).
5. What to pin.
6. Each deletion, such as a duplicate, an empty leftover folder or a leftover skill. For a duplicate, which copy stays.
7. The schedule edits that the moves need, approved once for all.
8. The git-ignored files of the vault, and where each one goes.
