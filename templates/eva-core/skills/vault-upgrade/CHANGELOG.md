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
- **Pull request:** https://github.com/guplem/eva/pull/902
- **Summary:** Each kind of note gets a smaller header that reads more clearly. A case lists its steps, a moment has its time zone, a project can link its result, and any note can have aliases and tags.
- **Migrations first:** 2026-11-06-project-created-offset

### What changes, and why

The examples are generic: a vault can have any notes.

1. **The root `AGENTS.md` gets a _Front matter_ section and a new _Projects_ section.** _Front matter_ says which keys any note can have (`summary`, `aliases`, `tags`), how to reuse a tag, that a reference to a note is its path, and how to write a day and a moment. _Projects_ drops `started` and `cv`, and adds `result`, the rule for `repos` and two optional body sections. Replace these parts with the exact text of `template/`: the _Entities_ and _Projects_ sections, the rules "Nothing moves when it ends" and "Before deleting anything" of _Where things go_, the `Life/About me.md` row of the table, and the date sentence of _Writing_. Leave the rest of the file as it is. Why: each key now has one meaning, and a moment is exact in any time zone.
2. **`Life/Cases/`, `Life/Periods/`, `Life/People/`, `Life/Pets/` and `Life/Objects/` get the new `AGENTS.md`,** in the exact text of `template/`. In `Life/Health/Allergies and Diet.md`, the comment of `pinned` says "every Assistant chat", as in `template/`.
3. **Each project file changes,** in `Projects/*/AGENTS.md`:
   - `created` with a time already has its offset from UTC, such as `2026-01-31T09:15+01:00`: the migration of the "Migrations first" line added it, with the `timeZone` setting. Never compute an offset by hand.
   - `started` goes. When the work started much later than `created`, such as weeks later, first write one line in the text, such as "The work started on 2026-03-02."
   - `cv` becomes a `## Work and achievements` section, after the first paragraph of the text, with the same words.
   - Each `repos` entry that `git clone` cannot use leaves `repos`. For a link to a folder, such as `.../tree/main/web`, name the folder in the text. For a link to the repository's own page, such as `.../tree/main`, write the repository address instead, such as `https://github.com/example/example-app`, unless `repos` lists it already.
   - Each line under `## Links` gets a short label, such as `- Video: https://...`.
   - A link where the person uses the result, such as a website or a store page, can become `result`, after the person approves.
4. **Each period changes,** in `Life/Periods/*/Period.md`: `kind` becomes `type`, with the same value. `status` goes: a period is open while `to` is empty or a day that has not passed. Keep a future `to`, such as the end of a contract. `cv` becomes a `## Work and achievements` section after the first paragraph. When a closed period has no `to`, ask the person for its last day.
5. **Each case changes,** in `Life/Cases/*/Case.md`:
   - `status` and `next` become `steps`. For an open or waiting case, `next` becomes the current step: `step` and `due-by` from `next`. When `next` has no date, propose a `due-by` as the Cases rules say: two weeks away for a case that waits, one to three months for a blocked one. List the case in the report. When the status was `waiting`, add `waiting-for` with who the case waits for, from `next.step` or the text. Add the steps that the dated lines of the text show as done before it, each with its `done-on`. Put a text of a step, such as `step` or `waiting-for`, in double quotes when it holds a comma, a colon or a `#`.
   - A closed case keeps its `closed` date and its done steps, if any. When it has no `closed` date, take the day of its last dated line, and list it in the report.
   - `about` goes. Before that, write each of its paths at the start of the text, as a link.
6. **Each person, pet and About me change:**
   - In `Life/People/*/Person.md`, a `relation` through someone gets that person's folder path, such as `cousin of Life/People/Marta Example`, when the folder exists.
   - In `Life/Pets/*/Pet.md`, `vet` moves to the text. A death date in `summary` becomes `death`.
   - In `Life/About me.md`, edit the header in place, and keep each value of the person. `nickname` becomes `aliases`, as a list. `region` moves into `places.home`. When `places` is not a map, keep its text as `places.home.address`. Add `lat` and `lon` to `places.home` when they are known, such as the center of its city. `hemisphere` goes once `places.home` has `lat`: Eva finds it from the latitude. `work` becomes a list of the open jobs and studies, each with its `period` and its hours. The comments of `pinned`, `aliases`, `places` and `work` take the text of `template/`.
7. **Eva reads the old keys too,** until the upgrade ends. Nothing breaks in the meantime.

### How to detect a vault that has it

The root `AGENTS.md` has a _Front matter_ section, and `Life/Cases/AGENTS.md` names `steps`. No `Case.md` has `status`, `next` or `about`. No `Period.md` has `kind` or `status`. No project `AGENTS.md` has `started` or `cv`. `Life/About me.md` has no `nickname` and no top-level `region`. Then the upgrade only records the version.

### What to ask, all in the one message up front

1. Each line of _Personal rules_ that names `started`, `cv`, a case `status` or `next`, a period `status` or `kind`, or `about`. The default is "leave it out": the new texts say the rule now. This is the one change to _Personal rules_ that the person can approve, as in v4.
2. Each other note that tells an agent to write a removed key, such as a method in `Methods/` that sets `started`. The default is "update it to the new key".
3. Each case whose `waiting-for` is not clear from its text, with your best guess as the default.
4. Each closed period with no `to`, and each closed case with no `closed` date, with the day of its last dated line as the default.
5. Each project link that could become `result`, as one list, with "yes to all" as the default.

## v8

- **Version:** 8
- **Date:** 2026-11-14
- **Pull request:** https://github.com/guplem/eva/pull/936
- **Summary:** The businesses and self-employed people that serve you, such as your car workshop, your plumber or your dentist, get a folder of their own. Places to visit some day go to your maps app.

### What changes, and why

The examples are generic: a vault can have any notes.

1. **The vault gets `Life/Providers/`,** with its `AGENTS.md` in the exact text of `template/`. A provider is a folder with `Provider.md`: the service, the status, the contact and dated verdicts. A self-employed person has both a provider folder and a person folder, linked both ways. Why: "my workshop" or "the plumber we used" had no home. Its facts ended in a person's note, in an object's note, or nowhere.
2. **The root `AGENTS.md` names the new folder and the maps app.** Replace these parts with the exact text of `template/`: the `Life/People/` row of the _Their life_ table and the new `Life/Providers/` row after it, the table of the _Outside the vault_ section, step 6 of _Where things go_, the first sentence and the table of _Entities_, and the rule "A reference to another note is its path" of _Front matter_. Leave the rest of the file as it is.
3. **The apps table of _Personal rules_ gets the row `| The maps app | not set |`** after its last row. Add it only when the section has that table and no row for the maps app. When the table is missing, add nothing, and write it in the report. Change no other line of the section.
4. **`Life/People/AGENTS.md`, `Life/Objects/AGENTS.md`, `Life/Pets/AGENTS.md` and `Life/Health/AGENTS.md` get the new text** of `template/`. A person's `relation` can name a provider by its path. A finished repair names its provider by its path. A pet's vet and a doctor's clinic can be providers.
5. **Provider facts can leave their old notes,** only for each provider that the person approves. Search `Life/People/*/Person.md`, `Life/Objects/*/Object.md` and `Life/Pets/*/Pet.md` for a business or a self-employed person that serves the person, such as a hairdresser, a plumber, a workshop, a clinic or a vet. Commit the providers in their own group, such as "Give each provider its folder". For each approved provider:
   - Name its folder as `Life/Providers/AGENTS.md` says. A self-employed person with no trade name gets `<Full Name> - <Service>`.
   - When a whole folder in `Life/Objects/` is about the provider, `git mv` the folder to `Life/Providers/`, and `git mv` its main file to `Provider.md`. Then give it the keys of `Life/Providers/AGENTS.md`: `service` and `status: current`. Before you remove an old key that a provider does not have, write its fact as a line in the text.
   - Otherwise, create `Provider.md`. Never move a folder in `Life/People/`: other notes link to it as a person. Write each service fact in `Provider.md` before you remove it from the old note. From a `Person.md`, the facts that move are how to book, opening hours, who to ask for, a customer number, prices, jobs and verdicts. From an `Object.md` or a `Pet.md`, only how to book, opening hours, who to ask for and a customer number move. Move each file beside the old note that is about the service with `git mv` too.
   - For a self-employed person, keep or create the folder in `Life/People/` with only what is personal. Set `relation` to the role at the provider's path, such as `plumber at Life/Providers/Joan Example - Plumber`. Keep an old `relation` that differs as a dated line. Add the person's path to the provider's `people`.
   - For an object or a pet, keep each dated repair or visit line where it is. Replace the provider's plain name in it with the provider's path.
   - Fix each link that a move breaks.

### How to detect a vault that has it

`Life/Providers/AGENTS.md` exists, and the _Entities_ table of the root `AGENTS.md` has a `Provider` row. The table of the _Outside the vault_ section, above _Where things go_, has a row for the maps app. The apps table of _Personal rules_ has a row for the maps app, or there is no apps table. `Life/People/AGENTS.md` names `Life/Providers/`. Then the upgrade only records the version.

### What to ask, all in the one message up front

1. Each provider found in a `Person.md`, an `Object.md` or a `Pet.md`, as one list, with its new folder name and the facts that move. The default is "no", so "yes to all" moves nothing. The person answers "move all" to move every provider in the list.
2. Each line of _Personal rules_ that sends a provider or a place to visit somewhere else, such as "Restaurants to try go to the task app". The default is "keep it as an exception", with the rule that it overrides.

## v9

- **Version:** 9
- **Date:** 2026-11-15
- **Pull request:** https://github.com/guplem/eva/issues/940
- **Summary:** Everything you have or use, such as a car, a software licence, a subscription or a bank account, gets one folder: Life/Inventory. Life/Objects and Life/Finances merge into it.
- **Migrations first:**

### What changes, and why

The examples are generic: a vault can have any notes.

1. **`Life/Objects/` becomes `Life/Inventory/`, and each `Object.md` becomes `Item.md`.** `git mv Life/Objects Life/Inventory`, then `git mv` each `Object.md` to `Item.md` in its folder. Give each item the key `kind`: `thing` for a physical thing, or the kind that fits, such as `document` for a passport. Keep every other key. Why: one question, "do I have it or use it?", now decides. A software licence, a subscription or a bank account had no clear home, and two chats could file one in two places.
2. **Each note of `Life/Finances/` moves to its place:**
   - An account, a card, an investment, a pension plan, a subscription, the phone line, a will, or a loan or a policy that covers no single thing, such as a personal loan or health insurance → its own item, `Life/Inventory/<Type - Name - ID>/Item.md`. `git mv` the note to that path. Write its facts as the keys of `Life/Inventory/AGENTS.md`: `kind`, `status`, `provider`, `cost` and `renews`. Keep the rest as text. `git mv` each file that belongs to the note, such as its contract, to the item's folder. The old folder was flat, so the person approves the place of each file that is not a note.
   - A note with one row for each of many small subscriptions, such as `Subscriptions.md` → one item for each row. `git mv` the note to the item of its first row. Copy each other row to its item, then remove it from the moved note, so each fact lives in one file.
   - A contract of a thing, a home or a pet, such as the home insurance or a car loan → that thing's folder. For a thing or a home, add its cost to the thing's `cost` list, with `for`. For a pet, write the cost as a line in the text of `Pet.md`.
   - A plan with steps that is not done, such as an investment plan to carry out → a case. `git mv` the note to `Life/Cases/YYYY-MM-DD-name/Case.md`, dated on the day of the note's first commit, and give it `opened` and its steps. When a done plan created a product, such as a fund, the product is an item that links the case.
   - A goal of one account → a line in its `Item.md`. A goal with steps, such as saving for a home → a case.
   - A method, such as how the person invests → `Methods/`.
3. **A secret moves to a `.secrets` file,** after the person approves, and only when the vault has an encryption password. A software licence key, a full card number or a PIN that sits in plain text in a note goes to a `.secrets` file beside its `Item.md`, such as `Licence.secrets`. Write the file, but never `git add` it: `finish` refuses a plain secret on the branch. `finish` commits the file with the notes written meanwhile, and Eva encrypts it then. Remove the secret from the note in the same group as the note's move. A `.secrets` file that already exists moves with `git mv` and stays encrypted.
4. **The root `AGENTS.md` names the new folder.** Replace these parts with the exact text of `template/`: the `Life/Cases/`, `Life/Objects/` and `Life/Providers/` rows of the _Their life_ table, where `Life/Inventory/` takes the place of `Life/Objects/`; the steps of _Where things go_, where steps 5 and 6 change and the old step 9 goes; the rule "A password or a key of something in the vault"; and the first sentence and the table of _Entities_. Remove the `Life/Finances/` row. Leave the rest of the file as it is.
5. **`Life/Inventory/AGENTS.md` gets the exact text of `template/`,** and so do `Life/Cases/AGENTS.md`, `Life/Providers/AGENTS.md`, `Life/Health/AGENTS.md` and `Life/Diary/AGENTS.md`. Delete `Life/Finances/AGENTS.md`. Delete the empty `Life/Finances/` folder after you list its git-ignored files and move each one where the person said.
6. **Each link follows its note.** Search every note, `.eva/widgets.json`, `.eva/schedules.json` and `.eva/secret-files` for `Objects/`, `Object.md` and `Finances/`, with or without `Life/` before them, so a relative link such as `../Finances/` shows too. Write each new path: `Life/Inventory/<folder>`, `Item.md`, or the new place of a Finances note. Replace a pattern of `.eva/secret-files` that names a whole old folder, such as `Life/Finances/**`, with one pattern for each moved secret file. Never change a dated record, such as a diary day, except for the path.
7. **Each git-ignored file moves where the person said.** `git mv Life/Objects Life/Inventory` also moves the git-ignored files inside, but git keeps no record of them. Write each move of a git-ignored file in the list that `start` named, this one included, so `drop` and `undo` can move it back.
8. **An account that lives only in the note of another thing,** such as a shared bank account named only in the home's note, can get its own item, after the person approves. The other note then links it by its path.
9. **Eva reads the old folder until the upgrade ends.** The Inventory page of the web app shows `Life/Objects/` while the vault has no `Life/Inventory/`.

### How to detect a vault that has it

`Life/Inventory/AGENTS.md` exists. `git ls-files Life/Objects Life/Finances` lists nothing. No `Life/Inventory/*/Object.md` exists. The _Entities_ table of the root `AGENTS.md` has an `Item` row, and its _Their life_ table has no `Life/Finances/` row. Then the upgrade only records the version.

### What to ask, all in the one message up front

1. The place of each note in `Life/Finances/`, as one list: its new item folder and `kind`, a thing's folder, a case or `Methods/`. List each other file of the folder, such as a contract PDF, with the item that it belongs to. Ask for the year of each new item folder that no note gives. The default is the place that you propose.
2. Each old object whose `kind` is not `thing`, such as a passport, with your proposal as the default.
3. Each account, subscription or line that lives only in the note of another thing (item 8). The default is "no", so "yes to all" moves nothing.
4. Each licence key, full card number or PIN in plain text in a note, and its new `.secrets` file. The default is "move it". Ask only when the vault has an encryption password. Otherwise, list them in the report.
5. Each line of _Personal rules_ that names `Life/Objects/`, `Object.md` or `Life/Finances/`. The default is "update the path". This is the one change to _Personal rules_ that the person can approve, as in v4.
6. Each other note that tells an agent to write to `Life/Objects/` or `Life/Finances/`, such as a method or a skill in `.eva/skills/`. The default is "update it to the new place".
7. The edits of `.eva/schedules.json`, `.eva/widgets.json` and `.eva/secret-files` that the moves need, approved once for all.
8. The git-ignored files of `Life/Objects/` and `Life/Finances/`, and where each one goes.
