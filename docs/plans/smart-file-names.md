# Smart names in the Files page (issue 429)

## Motivation

The Files page shows real names, and some real names are technical. A project folder, such as `Projects/2026-03-02-1015-example-app`, hides the project title. A note such as `2027-trips.md` puts a date in front of its name. A person on a phone reads the title and the date faster than the folder name.

## Decisions

- **The core sends the project title.** `FileEntry` gets an optional `title`. `browseVault` sets it for each project folder in `Projects/`, from the `# Title` heading of its `AGENTS.md`. The same function as `discoverProjects` reads it, so the Projects page and the Files page show the same title. A favorite of a project folder gets the title too.
- **The client builds the smart name.** A pure function in `client/smart-names.ts` takes the real name, the kind and the title. It answers the shown name and the date words.
- **A date at the start of a name moves to a pill.** The forms are `YYYY`, `YYYY-MM`, `YYYY-MM-DD` and `YYYY-MM-DD-HHmm`, as a project id has them. A space, a `_` or a `-` ends the date. A name that is only a date stays as it is. A date that cannot exist, such as month 13, stays in the name.
- **The pill uses fixed English words**, such as "2 Mar 2026, 10:15", as the chat list does.
- **The extension hides where a badge shows it.** A folder list row shows the MD badge, so "trips" is enough there. The path at the top has no badge, so it keeps the extension.
- **The real name stays easy to find.** Each smart name has a tooltip with the real name. A touch screen shows no tooltip, so the header of the open folder or file shows the real name in small text under the smart name. The rename field starts with the real name.
- **The setting lives in the Appearance card**, as "File names: Smart / Real". It is a browser choice in `localStorage`, as "Files view" and "Long file names" are. Smart is the default.
- **The order stays by real name.** A date at the start sorts by time, which is the order that the person wants.

## Gaps

Each gap had a clear answer in the code, so no gap needs the person:

- Where the title comes from: `readProject` in `src/core/projects/project-catalog.ts`.
- Where a browser choice lives: `client/appearance.ts`, with a `ChoiceChips` in `PersonalizeSection.tsx` and words in `settings-routes.ts`.
- How a real name shows on hover: `data-tooltip`, from `client/Tooltip.tsx`.
