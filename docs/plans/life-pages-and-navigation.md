# Plan: Life pages and a choice of navigation entries (#911)

## Goal

The web app gets one page for each kind of entity in `Life/`: Cases, People, Objects, Pets and Periods.
The person chooses which entries show in the main navigation, with one list for a computer and one for a phone.

## Parts

Each part is one or more commits. Parts 1 and 2 touch different files, so two agents can write them at once.

### Part 1: the core list of Life entities, and its API

- `src/shared/life-kinds.ts`: `lifeKinds = ["cases", "people", "objects", "pets", "periods"] as const`, the type `LifeKind`, `isLifeKind`, and for each kind its folder and its main file (`Life/Cases` and `Case.md`, and so on).
- `src/core/life/life-catalog.ts`:
  - `discoverLifeEntities(vaultPath, kind): LifeEntity[]` reads `Life/<Folder>/*/<Main>.md`.
  - `readLifeEntity(vaultPath, kind, id): LifeEntityDetail | null` adds the text under the front matter and the files beside the main file.
  - It reuses the front matter parser of `src/core/projects/project-catalog.ts` (`yaml`, the `failsafe` schema).
  - It reads tolerantly: a bad main file gives an entity with a warning, or is left out, and never hides the others. It skips a linked folder, a secret file and an encrypted file, as `src/core/modes/pinned-files.ts` does. It bounds each read.
- The shape, shared by every kind:

  ```ts
  interface LifeEntity {
    readonly kind: LifeKind;
    /** The folder name. It is the id in the address. */
    readonly id: string;
    /** From the vault root, such as "Life/Cases/2026-05-15-phone-repair". */
    readonly folder: string;
    /** The path of the main file, from the vault root. */
    readonly path: string;
    /** The first heading of the text, or else a readable form of the folder name. */
    readonly title: string;
    readonly summary: string | null;
    readonly aliases: readonly string[];
    readonly tags: readonly string[];
    /** The other keys of the front matter, as the failsafe parser gives them: text, lists and maps. */
    readonly fields: Readonly<Record<string, unknown>>;
    readonly warnings: readonly string[];
  }
  interface LifeEntityDetail extends LifeEntity {
    /** The text under the front matter, cut at a limit. */
    readonly body: string;
    /** The files and folders beside the main file. */
    readonly files: readonly { readonly name: string; readonly path: string; readonly kind: "file" | "folder" }[];
  }
  ```

- `Eva.lifeEntities(kind)` and `Eva.lifeEntity(kind, id)` redact each text with `Redactor`.
- API: `GET /api/life/<kind>` gives `LifeEntity[]`. `GET /api/life/<kind>/<id>` gives `LifeEntityDetail`, or 404. An unknown kind gives 404. With no vault, the routes answer as the Files routes do.
- Client: `api.lifeEntities(kind)` and `api.lifeEntity(kind, id)` in `client/api.ts`.
- Demo vault (`test/e2e/serve-demo.ts`): sample cases (open, waiting, with a deadline, closed), people, objects, pets and periods, with `example` names only.

### Part 2: the navigation model, the choice and its Settings card

- `client/navigation.ts`: `destinations` gains `cases`, `people`, `objects`, `pets` and `periods`, after `schedules` and before `settings`. Each has an icon.
- New icons in `client/icons.tsx`, with the three other places that an icon needs.
- `client/nav-choice.ts` (logic, no React):
  - The choice is `{ computer: DestinationId[]; phone: DestinationId[] }`, kept in `localStorage` under `eva.navigation`, read tolerantly: an unknown id is dropped, a bad value gives the defaults.
  - Defaults: a computer shows every destination. A phone shows Chats, Projects, Files and Schedules.
  - Rules: a computer always shows Settings. A phone shows at most `maxPhoneEntries = 4` entries beside Eva's face. `toggled(choice, form, id)` returns the new choice, or the reason why it cannot change.
  - `shownDestinations(choice, isPhone)` returns the destinations in the fixed order.
  - A small store with `subscribe`, as `client/appearance.ts` or `client/display-format.ts` has, so the rail changes at once.
- `MainNav.tsx` and `MainNavSkeleton` in `Loading.tsx` draw `shownDestinations`. On a phone, Settings shows when the person chose it. The home gear stays.
- `styles.css`: the phone tab bar spreads 1 to 5 entries over its width. The rule that hides Settings on a phone goes away: the component decides.
- `PersonalizeSection.tsx`: a card `item="navigation"` with two groups, "On a computer" and "On a phone". Each entry is a switch with its icon and name, and a link that opens the page. A fixed entry shows as fixed. A press on a fifth phone entry is refused with the reason, through `aria-disabled`. Add the card to `searchEntries` and to `settingPlaces` (home `browser`).
- `App.tsx` routes the new destinations to the Life page of part 3. Until part 3 lands, a placeholder is acceptable inside the branch.

### Part 3: the Life pages

- `client/life-pages.ts` (logic, no React), with unit tests:
  - For each kind: the title, the empty-state words, the filters, the order, and what a card shows.
  - Cases: open or closed (`closed` has a date), the current step (the first step without `done-on`), its `due-by`, `waiting-for`, the share of done steps, the deadline, and whether a day has passed.
  - Objects: the status, the type, the owner, the ids.
  - People: the relation, with the linked person when `relation` holds a path.
  - Pets: the species, the breed, the age, and whether the pet died.
  - Periods: the type, the organisation, the role, the span, and whether it goes on.
  - The search matches the title, the aliases, the tags and the summary.
- `client/LifeView.tsx` and `life.css`:
  - The list page at `#/<kind>`: a header with the count, a search box, filter chips, and cards. Reuse the shared classes and the parts of the Projects page (the mark with initials and its colour, the pills, the chips, the skeletons).
  - The entity page at `#/<kind>/<id>`: the title, the facts (`front-matter-facts.ts`), the steps of a case as a list, the text (`MarkdownBody`), the files beside it, and a link to its folder in Files.
  - The empty state, the loading skeleton, and the error state follow the other pages.
- `navigation.ts`: `lifeRouteOf(hash)` and `lifeAddressOf(route)`.
- Tests: unit tests for the logic, e2e tests for each page on a computer and a phone, and the new pages in `test/e2e/shadows.spec.ts`, `skeletons.spec.ts` and `narrow-phone.spec.ts`.

### Part 4: docs and captures

- `README.md`, `docs/guide/reference.md`, `docs/guide/how-eva-works.md`.
- `docs/design/eve/README.md` and `reference.html`: the navigation, the new icons, the new pages, and a scene for each new page in `scripts/capture-design.ts`.
- The captures of the design guide that show the rail.

## Gaps

Each gap has a proposed answer. Sub-agents check each one against the rules and the code.

1. **Where does the choice live: the vault or the browser?** Proposed: the browser (`localStorage`), with one list per form. Reason: `client/appearance.ts` keeps there every choice that differs between a phone and a computer, and `settingPlaces` has the home `browser`. Against: "The person's settings live in the vault".
2. **Which folders get a page?** Proposed: the five kinds with a main file. Health, Finances and Diary stay in Files.
3. **Is Settings fixed on a phone?** Proposed: no. Eva's face is the only fixed phone entry, because the home page has the gear. On a computer, Settings is fixed.
4. **Does the person choose the order?** Proposed: no. The order is fixed.
5. **One page component for the five kinds, or five?** Proposed: one `LifeView` that a table of kinds drives, under the rule "Reuse a shared component before you add one".
6. **Where does the entity type live?** Proposed: the kinds in `src/shared/`, the entity type in `src/core/life/`, imported by the client as a type, as `Project` is.
7. **Does the rail fit ten entries on a small computer window?** The rail already scrolls (`overflow-y: auto`). Check that Settings stays reachable.
8. **Must the vault template change?** Proposed: no. The pages read the format that the template already gives. So no new structure version.

## Decisions

Written after the gaps are checked.
