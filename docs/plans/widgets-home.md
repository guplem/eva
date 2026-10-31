# Plan: widgets on the home page (#691)

The issue is the spec. This plan lists the gaps that the issue leaves open, and the decision for each.

## Parts

1. Core, `src/core/widgets/`:
   - `widget-address.ts`: reads a GitHub address into `owner/repo`.
   - `widget-list.ts`: `.eva/widgets.json` in the vault.
   - `widget-approvals.ts`: the approved records in `state/widget-approvals.json` on the machine.
   - `widget-places.ts`: the path rules (no file access, so the web page can use them too).
   - `widget-hosts.ts`: the host rules.
   - `widget-data.ts`: reads, lists, writes and deletes in the vault for a widget.
   - `widget-copies.ts`: the read-only copy of each widget, through git.
   - `widgets.ts`: the list, the review, the approval, the tokens and the answers of the widget routes.
2. Local API: the `/api/widgets` routes, and the `/widgets/<token>/` routes with their own guard.
3. Web: the grid on the home page, the widget list in Personalize, the activation dialog, and the vault picker.
4. Docs: `docs/widgets.md`.

## Gaps and decisions

- **The copy and the review use git.** Eva fetches `main` with depth 1 into `widgets/<owner>/<repo>/` of the instance, with no checkout. She reads `eva-widget.json` and the schemas with `git show <commit>:<path>`. The approval checks out that commit. One seam (the process runner) covers both, and a private repository works through the instance's GitHub login. Nothing is served before the approval.
- **Key names.** `.eva/widgets.json`: `version`, `widgets[]` with `repository`, `enabled` (as in `.eva/schedules.json`), `inputs`. `state/widget-approvals.json`: `version`, `approvals[]` with `repository`, `commit`, `name`, `size`, `entry`, `paths[]` (`input`, `type`, `path`, `access`, `files`, `schema`), `location`, `hosts`, `approvedAt`. Both files keep unknown keys when Eva writes them.
- **When a record matches.** The record matches the vault entry when each folder or file input has the same path in both, and no other folder or file input has a value. Otherwise the widget shows "Approve to show this widget". Text, URL, number, boolean and choice values come from the vault: they grant nothing.
- **Each widget request checks the vault entry.** A widget answers only while its entry is on and its record matches. So an agent that edits `.eva/widgets.json` stops the widget at once.
- **`eva/location.json` without the permission answers `null`.** The template falls back to a mock location when the path fails. `null` keeps the rule "a mock location never shows in Eva", and gives the widget nothing.
- **Unknown fields.** Eva keeps a field of the file on disk that the new body leaves out, when the widget's schema does not name it at that level. At each level where both are objects, she does the same inside. A list is the widget's own: Eva takes the new list as it is. So a widget can still delete its own fields.
- **Which files a widget writes.** JSON and YAML files only, as the contract says. The body must parse. A text with a secret is refused, as the Files page refuses it.
- **`index.json` lists** each file of the folder and its subfolders, by its path from the folder, filtered by the `files` pattern on the file name. It leaves out the hidden places and `DATA_FORMAT.md`.
- **Tokens.** 32 random bytes, in memory only. A token lives 6 hours. The page asks again with the tokens that it holds, and Eva gives back each one that still works, so a reconnect does not reload a widget. The page releases its tokens when it closes.
- **Theme.** The page sends its colour scheme and the contract variables, as computed in the browser. Eva accepts only plain colour values (no `:`, `;`, braces, quotes or backslash), so `eva/theme.css` cannot load anything.
- **Eva's own page.** `index.html` has `frame-src 'self'`. The client adds `frame-src <origin>/widgets/` at start, so both policies apply.
- **Order.** The list is: the vault entries in their order, then each widget project without an entry, then each base widget without an entry. A move writes the whole list to `.eva/widgets.json`.
- **Base widgets** are an empty list in `base-widgets.ts`. #694 adds the two addresses.
- **Owner.** The list shows the owner from the address. The review says whether GitHub refuses the repository.

## Out of scope

- Updates of a widget (#693), the prompt line (#692), free placement (#698).
