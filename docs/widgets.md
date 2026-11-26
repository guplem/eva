# Widgets

A widget is a small web page that Eva shows on her home page. This document is the widget contract: the rules that each widget follows, so that Eva can show it, give it data, and keep the person's data safe. It is contract `4`. Eva still reads widgets of contracts `1`, `2` and `3`: see [Contract versions](#contract-versions).

A widget is plain, standard web code: HTML, JavaScript and CSS, with no framework of Eva and no build step. The same files work inside Eva and on any static web server, such as GitHub Pages.

The template of a new widget is [`templates/widget/`](../templates/widget/). Eva copies it to each new widget repository. Each Eva release updates the template and this document together.

The five widgets that ship with Eva are full examples: [`guplem/eva-widget-summary`](https://github.com/guplem/eva-widget-summary) is a `header` widget that reads the Google Calendar and the location, and asks Eva to act, [`guplem/eva-widget-calendar`](https://github.com/guplem/eva-widget-calendar) reads the Google Calendar and calls a host, [`guplem/eva-widget-habits`](https://github.com/guplem/eva-widget-habits) writes vault data, [`guplem/eva-widget-cases`](https://github.com/guplem/eva-widget-cases) reads the cases, and [`guplem/eva-widget-weather`](https://github.com/guplem/eva-widget-weather) reads the location and calls a host.

## Contents

- [The files of a widget](#the-files-of-a-widget)
- [The manifest: `eva-widget.json`](#the-manifest-eva-widgetjson)
- [The inputs](#the-inputs)
- [How a widget talks to Eva](#how-a-widget-talks-to-eva)
- [Sizes](#sizes)
- [Theme](#theme)
- [Data formats](#data-formats)
- [Naming rules](#naming-rules)
- [Rules for the code](#rules-for-the-code)
- [How Eva runs a widget](#how-eva-runs-a-widget)
- [Outside Eva: the demo](#outside-eva-the-demo)
- [Contract versions](#contract-versions)
- [Example: a habits widget](#example-a-habits-widget)

## The files of a widget

Each widget has its own public GitHub repository. The repository holds no data of the person: only mock data for the tests and the demo. The person's data stays in the vault.

| Path                       | What it holds                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `eva-widget.json`          | The manifest. It is at the repository root.                                                   |
| `index.html`               | The page that Eva opens (the `entry` of the manifest).                                        |
| `main.js`, `style.css`     | The code and the look. Add more files as you need.                                            |
| `schemas/<input>.json`     | The JSON Schema of each file that the widget writes.                                          |
| `config.json`              | Mock values of the inputs, for the demo.                                                      |
| `data/<input>/`            | Mock files of a folder input, with its `index.json`.                                          |
| `eva/theme.css`            | A mock of the theme, with the default EVE colours.                                            |
| `example/location.json`    | A mock location, only when the widget uses the location. Never put it at `eva/location.json`. |
| `example/google-calendar/` | Mock `calendars.json` and `events.json`, only when the widget uses the calendar.              |
| `example/google-tasks/`    | Mock `lists.json` and `tasks.json`, only when the widget uses the tasks.                      |
| `example/cases.json`       | Mock cases, only when the widget uses the cases.                                              |
| `tests/`                   | The tests, with a helper that fakes the writes.                                               |

## The manifest: `eva-widget.json`

The manifest says what the widget is and what it needs. [`widgets/manifest-v4.json`](widgets/manifest-v4.json) is its JSON Schema. A key that the schema does not name is an error.

| Key        | Required | What it is                                                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| `contract` | yes      | The version of this contract: `4`.                                                               |
| `name`     | yes      | The name that Eva shows, 60 characters at most.                                                  |
| `entry`    | no       | The page that Eva opens, by its path from the repository root. `index.html` when not given.      |
| `size`     | yes      | The default size of the widget: `small`, `medium`, `large`, `tall`, `xlarge` or `header`.        |
| `inputs`   | no       | What the widget needs from the person. See [The inputs](#the-inputs).                            |
| `hosts`    | no       | The web addresses that the widget calls. Each has a `url` (`https`, with no path) and a `why`.   |
| `asks`     | no       | What the widget asks Eva to do. Each has a `type` and a `why`. See [Asks](#asks).                |
| `prompt`   | no       | One line for Eva's prompt, such as "Habits live in {habits}." `{habits}` names an input's value. |

Eva adds the `prompt` line of each widget that is on to the prompt of each new chat with Eva, with the person's values in place of the placeholders. A placeholder of an empty input reads "(not set)". The person sees the line when they turn the widget on. A widget with no `prompt` gets a default line, such as "Habits data lives in Life/Habits. Read Life/Habits/DATA_FORMAT.md before you write."

Eva shows each `why` to the person when the person turns the widget on. Write each `why` for the person: say what the widget does with the permission.

## The inputs

Each input has these keys:

- `id`: a camelCase name, such as `habits`. It is the key of the input in `config.json`, and the folder of the input in `data/`.
- `type`: one of the types below.
- `label`: a short name for the form.
- `description`: what the person gives.
- `why`: why the widget needs it.
- `required`: `true` or `false`.
- `default`: a value for the form, as needed. For a `folder` or a `file`, see [Default places](#default-places).

| Type                  | What the person gives                              | Extra keys                                   |
| --------------------- | -------------------------------------------------- | -------------------------------------------- |
| `folder`              | A folder of the vault. The form shows the vault.   | `access`, `files`, and `schema` for a write. |
| `file`                | A file of the vault.                               | `access`, and `schema` for a write.          |
| `text`                | A text.                                            |                                              |
| `url`                 | A web address. The form shows a text box.          |                                              |
| `number`              | A number.                                          |                                              |
| `boolean`             | Yes or no.                                         |                                              |
| `choice`              | One value of a list.                               | `choices`: the list, 2 values at least.      |
| `eva-location`        | The permission to read the person's last location. | No `default`.                                |
| `eva-google-calendar` | Access to the person's Google Calendar.            | `access`. No `default` and no `schema`.      |
| `eva-google-tasks`    | Access to the person's Google Tasks.               | `access`. No `default` and no `schema`.      |
| `eva-cases`           | The permission to read the person's open cases.    | No `default` and no `access`.                |

- `access` is `read` or `write`. A write also allows a read.
- Eva serves no write of the calendar or the tasks yet. A later contract path adds it. Ask for `read`.
- `schema` is the path of the JSON Schema of each file that the widget writes, such as `schemas/habits.json`.
- `files` is a glob pattern of the file names of a folder, such as `*.json` or `????-??-??.json`. `*` matches any text, and `?` matches one character. Neither matches a `/`.

A widget gets only what its inputs give. A widget with no `eva-location` input gets nothing at `eva/location.json`.

### Default places

A `folder` or a `file` input can give a `default`: a path of the vault, from the vault root, such as `Life/Habits`. Write no `/` at the start. This needs no new contract: contract 1 allows a `default` on each input.

The default folder need not exist, and the vault map need not name it. Eva's form creates it when the person turns the widget on. The widget's `prompt` line tells Eva in each chat where the data lives, with the folder that the person picked. For an input with a `schema`, Eva also writes `DATA_FORMAT.md` in it. Pick a path in the part of the vault where the data fits, such as `Life/Habits`.

- Eva never fills the input with the default by herself. The form offers it with one tap next to **Pick a folder**, and shows the path as text.
- **Use the default folder** shows when the folder exists. **Use the default file** shows when the file exists.
- **Create the default folder** shows when the folder does not exist. The tap creates the folder and each missing parent, with an empty `.gitkeep`, so the vault sync keeps the empty folder. Eva creates no file.
- A default in a place that no widget reaches, such as `.eva/` or `Scratch/`, shows no button.
- A default is not a permission. A new or changed default asks for no new approval, changes no value that the person picked, and moves no file. A person who picked the old default keeps that folder. A widget with no `eva-google-calendar` input gets nothing from `eva/google-calendar/`, a widget with no `eva-google-tasks` input gets nothing from `eva/google-tasks/`, and a widget with no `eva-cases` input gets nothing at `eva/cases.json`.

## How a widget talks to Eva

A widget reads and writes data only through `fetch` to relative paths. It asks Eva to act with a message to its parent window: see [Asks](#asks). The host decides the answer to a path. Inside Eva, Eva answers with the person's data. On GitHub Pages, or on any static server, the mock files of the repository at the same paths answer. So the widget code is the same in both places.

| Path                                                            | Method                 | Answer                                                                                |
| --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `config.json`                                                   | `GET`                  | The values of the inputs, by `id`.                                                    |
| `data/<input>/index.json`                                       | `GET`                  | A JSON array of the file names of the folder that the person chose.                   |
| `data/<input>/<file>`                                           | `GET`, `PUT`, `DELETE` | `GET` reads the file. `PUT` writes the whole file with the body. `DELETE` removes it. |
| `eva/location.json`                                             | `GET`                  | The last location, or `null` when Eva has none yet.                                   |
| `eva/google-calendar/calendars.json`                            | `GET`                  | The person's calendars, or `null`. See [The calendar](#the-calendar).                 |
| `eva/google-calendar/events.json?from=YYYY-MM-DD&to=YYYY-MM-DD` | `GET`                  | The events of each shown calendar in the window, or `null`.                           |
| `eva/google-tasks/lists.json`                                   | `GET`                  | The person's task lists, or `null`. See [The tasks](#the-tasks).                      |
| `eva/google-tasks/tasks.json?from=YYYY-MM-DD&to=YYYY-MM-DD`     | `GET`                  | The tasks of each list with a due day in the window, or `null`.                       |
| `eva/cases.json`                                                | `GET`                  | The person's open cases, or `null`. See [The cases](#the-cases).                      |
| `eva/state.json`                                                | `GET`, `PUT`           | The widget's own small state. See [The widget's own state](#the-widgets-own-state).   |
| `eva/theme.css`                                                 | `GET`                  | The EVE colour variables. See [Theme](#theme).                                        |

- A `file` input uses the path `data/<input>`, with no file name.
- `data/<input>/` includes the subfolders of the folder. `index.json` lists each file of the folder and its subfolders by its path from the folder, such as `2026/run.json`, when its name matches `files`. So a file of the person named `index.json` at the top of the folder stays hidden.
- A widget never reaches `.git/`, `.eva/`, `Scratch/`, the clones in `Projects/*/repos/`, `Life/About me.md` or any hidden file, also inside a folder that the person picked.
- A widget writes only a JSON or YAML file whose name matches `files`, and never a rule file of an agent: `AGENTS.md`, `CLAUDE.md`, `README.md` or `DATA_FORMAT.md`. A write is 5 MB at most. Eva refuses a text that holds a secret, such as a token.
- `eva/location.json` answers `null` for a widget with no `eva-location` input.
- `eva/location.json` holds `{ "latitude": 37.77, "longitude": -122.42, "accuracy": 30, "at": "2026-01-01T09:30:00Z" }`. `accuracy` is in meters. `at` is the time of the newest stored point.
- A `PUT` or a `DELETE` fails outside Eva. Handle the failure. See [Outside Eva: the demo](#outside-eva-the-demo).
- A data file is JSON or YAML.
- Eva answers a refused request with a status code. Handle each one: `400` for a body that is not valid JSON or YAML, `403` for a write that the approval does not allow, `404` for a file or a token that is gone, `405` for another method, `409` for a file on disk that Eva cannot read, so she does not overwrite it, `413` for a write over 5 MB or a read over 50 MB, and `422` for data that does not fit the schema or that holds a secret.

Eva gives the size in the address, as `?size=small`, `medium`, `large`, `tall`, `xlarge`, `header` or `full`. A new size from the layout loads the widget again with the new address.

### The calendar

An `eva-google-calendar` input gives the widget the person's Google Calendar. Eva calls Google with her own login. The widget never sees a token.

- `eva/google-calendar/calendars.json` answers `null` when Eva has no working Google login or Calendar is off in Settings. Otherwise it answers a list of the calendars that the person shows in Google Calendar: `[{ "id": "…", "name": "Work", "color": "#3f51b5", "primary": true }]`.
- `eva/google-calendar/events.json?from=2026-11-16&to=2026-11-22` answers `null` for the same reasons, or the events of each of these calendars, sorted by start. `to` is inclusive. The days are in the time zone of the person's main calendar. Eva refuses a window over 62 days, a missing day, or a day that is not `YYYY-MM-DD`, with `400`.
- A timed event: `{ "id", "calendarId", "title", "startAt": "2026-11-18T09:00:00+01:00", "endAt", "place": "Room B", "link": "https://…", "description", "project" }`.
- An all-day event: `{ "id", "calendarId", "title", "date": "2026-11-21", "endDate": "2026-11-21", "place", "link", "description", "project" }`. `endDate` is inclusive.
- `description` is the event's description as plain text, with no HTML tags, 2000 characters at most. It is `null` for an event with no description. Show it as text, never as HTML. An older Eva gives no `description` and no `project`: read a missing key as `null`.
- `project` is the project of the event, or `null`: `{ "id": "2026-11-02-1030-example-app", "title": "Example app", "path": "Projects/2026-11-02-1030-example-app" }`. An event belongs to a project when its description has a line `[eva-project:<id>]`. `<id>` is the folder name of the project, or its name with no date when exactly one project has it. Eva removes that line from `description`. An unknown project, or a project outside the vault, gives `null`.
- `place` and `link` can be `null`. `title` is `""` for an event with no title. Eva leaves out an event that the person declined, a cancelled event, and the place where the person works each day.
- Eva keeps each answer for 1 minute, so a new event can take a minute to show.
- Eva answers `502` when Google fails or refuses. Show that the calendar is not available now, and try again later.
- The calendar is read only in this version: each other method answers `405`.

### The tasks

An `eva-google-tasks` input gives the widget the person's Google Tasks. Eva calls Google with her own login, as for the calendar. The widget never sees a token.

- `eva/google-tasks/lists.json` answers `null` when Eva has no working Google login or Tasks is off in Settings. Otherwise it answers each task list of the person, in Google's order: `[{ "id": "…", "name": "My Tasks" }]`. `name` is `""` for a list with no name.
- `eva/google-tasks/tasks.json?from=2026-11-16&to=2026-11-22` answers `null` for the same reasons, or the tasks of each list whose due day is in the window. `to` is inclusive. Eva refuses a window over 62 days, a missing day, or a day that is not `YYYY-MM-DD`, with `400`, as for the events.
- A task holds only a due day, never a time: Google Tasks keeps only the day of a due date. So a task has no time span and no time zone. Show it on its day, such as with the all-day events.
- A task with no due day does not come.
- The order: by due day, then by the order of the lists, then by the order of the tasks in a list. A subtask comes right after its parent. A subtask whose parent is not in the answer, such as a parent due on another day, comes after the other tasks of its list.

  ```json
  [
    {
      "id": "…",
      "listId": "…",
      "title": "Water the plants",
      "dueDate": "2026-11-18",
      "completed": true,
      "completedAt": "2026-11-18T10:00:00.000Z",
      "notes": "The ones on the balcony.",
      "link": "https://tasks.google.com/…"
    }
  ]
  ```

- `completed` is `true` for a task that the person marked as done. Completed tasks come too, also the ones that the person cleared from the list. Show them as done, such as struck through. `completedAt` is the time it was marked as done, or `null`.
- `title` is `""` for a task with no title. `notes` is the text of the task as the person wrote it, 2000 characters at most, or `null`. Show it as text, never as HTML.
- `link` opens the task in Google, or is `null`. It is always an `https` address.
- Eva leaves out a deleted task.
- Eva keeps each answer for 1 minute, so a new task can take a minute to show.
- Eva answers `502` when Google fails or refuses. Show that the tasks are not available now, and try again later.
- The tasks are read only in this version: each other method answers `405`.

### The cases

An `eva-cases` input gives the widget the person's open cases. Eva reads them from the vault with the same rules as her Cases page.

- `eva/cases.json` answers `null` when the vault has no `Life/Cases` folder. Otherwise it answers a list of the open cases, the most urgent first:

  ```json
  [
    {
      "id": "fix-the-bathroom-leak",
      "path": "Life/Cases/fix-the-bathroom-leak",
      "title": "Fix the bathroom leak",
      "nextStep": { "text": "Confirm the date with the plumber", "waitingFor": "plumber", "dueDate": "2026-11-17" },
      "deadline": { "date": "2026-12-01", "cost": "A fine of 50 EUR" },
      "stepsDone": 2,
      "stepsTotal": 5
    }
  ]
  ```

- `id` is the folder name of the case. A case is open until its `closed` key has a date.
- `path` is the folder of the case from the vault root, such as `Life/Cases/fix-the-bathroom-leak`. Give it to an `open` ask to show the case in Eva. An older Eva gives no `path`: build it from `id` then.
- `nextStep`, `deadline`, `waitingFor`, `dueDate` and `cost` can be `null`. `stepsDone` and `stepsTotal` are `null` together, for a case with no list of steps.
- A date is as the person wrote it: usually `YYYY-MM-DD`, but a month such as `2026-12` or a free text can come too. Show such a date as text.
- The order: the earliest of `nextStep.dueDate` and `deadline.date` first, so a passed day comes before a day to come. A month counts as its first day. The cases with no date come last, by title.
- The widget works out "overdue" or "in 5 days" from the dates and today's date.
- A case with a broken file still comes, with `null` for each part that Eva cannot read.

### The widget's own state

A widget of contract 3 or later can keep a small state of its own, such as the calendars that the person hides. Eva keeps it in the vault, so every device of the person shows the same.

- `GET eva/state.json` answers a JSON object: the last saved state, or `{}` when the widget saved none.
- `PUT eva/state.json` with a JSON object replaces the whole state. The body is 64 KB at most. Eva answers `413` for a larger body, `400` for a body that is not a JSON object, and `422` for a text that holds a secret.
- The state needs no permission: it is the widget's own data. Eva keeps it in the vault at `.eva/widget-state/<owner>/<name>.json`, apart from the list of widgets. **Turn off** keeps it, and **Remove** deletes it.
- The widget owns its keys. Name them by the [naming rules](#naming-rules), such as `{ "hiddenCalendars": ["…"] }`. Tolerate a missing key, and keep the keys that you do not know.
- Outside Eva, and in the **Example data** preview, the path answers `404`, and a `PUT` fails. Keep the state in memory there.

### Asks

A widget of contract 3 or later can ask Eva to act: to write a text in the message box (`chat`), or to open a page of Eva (`open`). Each ask is a permission. The manifest lists each type with a `why`, and the person approves it:

```json
"asks": [
  { "type": "chat", "why": "Starts a chat with Eva about a case." },
  { "type": "open", "why": "Opens the case in Eva." }
]
```

The widget sends a message to its parent window, right after a tap of the person. `id` is a number of the widget's choice, which comes back in the answer:

```js
window.parent.postMessage({ eva: "widget", id: 7, ask: "hello" }, "*");
window.parent.postMessage({ eva: "widget", id: 8, ask: "chat", text: "Let us talk about my case." }, "*");
window.parent.postMessage({ eva: "widget", id: 9, ask: "open", path: "Life/Cases/fix-the-bathroom-leak" }, "*");
```

Eva answers each message to the frame that sent it, with the same `id`:

- `{ "eva": "widget", "id": 8, "ok": true }` when Eva did it.
- `{ "eva": "widget", "id": 8, "ok": false, "reason": "not-allowed" }` when she did not. `reason` is one of these:
  - `not-allowed`: the approval holds no such ask, or the widget runs in the preview of a clone.
  - `no-tap`: the message came with no tap of the person just before it.
  - `too-long`: the text is over 2000 characters.
  - `not-found`: the path does not exist, or a widget may never reach it.
  - `unknown`: another `ask`, or a message with a bad shape.

The asks:

- `hello` needs no permission and no tap. Eva answers `{ "eva": "widget", "id": 7, "ok": true, "asks": ["chat", "open"] }`, with the approved types. Send it when the widget starts. Outside Eva, no answer comes: wait about 400 ms, then hide each entry that needs Eva.
- `chat` puts `text` in the message box of the home page. A text that the person already typed stays, and the widget's text comes after it. The box shows where the text comes from, such as "from Cases". Eva closes full screen and puts the cursor in the box. Eva never sends the text: the person sends it.
- `open` takes `path`, a path of the vault from the vault root, with no `/` at the start. Eva closes full screen and opens the best page for it: the page of a Life entity, such as a case, or the page of a project. For any other path, she opens the Files page at that folder or file. Eva refuses a path outside the vault, or in a place that no widget reaches (see [How a widget talks to Eva](#how-a-widget-talks-to-eva)).
- Eva checks that the person tapped the widget just before a `chat` or an `open`. So a widget cannot act by itself. Send the message in the `click` listener, with no wait before it. A tap in the widget activates Eva's page for a few seconds, and Eva also checks that the widget's frame still has the focus. So a tap elsewhere on Eva's page does not count.
- Eva knows the widget by the frame that sent the message. A widget cannot ask for another widget.

## Sizes

A widget has five sizes for a grid, the size `header` for the place beside the greeting, and a full-screen view, `full`. The manifest's `size` is the default size of its card. The person can give the card any shape of whole columns and rows, apart on a computer and on a phone. Eva gives the widget the nearest of the five grid sizes, so a widget must work at each size. `tall` and `xlarge` come with contract 2, and `header` with contract 3.

The default shape of each size:

| Size     | On a computer (4 columns) | On a phone (2 columns)                                 |
| -------- | ------------------------- | ------------------------------------------------------ |
| `small`  | 1 column, 1 row           | Half the width, 1 row; the full width alone in its row |
| `medium` | 2 columns, 1 row          | The full width, 1 row                                  |
| `large`  | The full width, 1 row     | The full width, 2 rows                                 |
| `tall`   | 1 column, 2 rows          | The full width, 2 rows                                 |
| `xlarge` | 3 columns, 3 rows         | The full width, 3 rows                                 |
| `header` | 2 columns, 1 row          | The full width, 1 row                                  |

The size of any other shape (`sizeOfShape` in `src/core/widgets/widget-layout.ts`):

| Shape                                | Size     | Examples                   |
| ------------------------------------ | -------- | -------------------------- |
| 1 column, 1 row                      | `small`  | 1 × 1                      |
| 1 column, 2 rows or more             | `tall`   | 1 × 2, 1 × 4               |
| 2 columns, 1 row                     | `medium` | 2 × 1                      |
| 3 columns or more, 1 row             | `large`  | 3 × 1, 4 × 1               |
| 2 columns or more and 2 rows or more | `large`  | 2 × 2                      |
| The same, with 6 cells or more       | `xlarge` | 3 × 2, 2 × 3, 3 × 3, 4 × 4 |

A card at the default shape of its own size keeps that size. So a `tall` card at 2 × 2 on a phone stays `tall`, and a card with no saved shape gets the size of its manifest.

In the grid, a `header` widget is a 2 × 1 card and gets `medium`. Only the header slot gives it `header`.

The grid is the day panel of Eva's home page:

- The person places each card in **Settings > Personalize > Widget layout**, with a preview of the grid. The computer and the phone each have their own layout. A place can stay empty.
- Each entry of `.eva/widgets.json` can keep its place and shape in an optional `layout` key: `{ "computer": { "column": 1, "row": 1, "columns": 3, "rows": 2 }, "phone": { "column": 1, "row": 4, "columns": 2, "rows": 3 } }`. `column` and `row` start at 1. A card has 4 columns and 8 rows at most. Eva ignores a bad value.
- An older Eva saved a size name instead of a shape, such as `{ "column": 1, "row": 1, "size": "xlarge" }`. Eva still reads it: the card gets the default shape and the name of that size. A new save writes `columns` and `rows`.
- A card with no saved place fills the first hole where it fits, in the order of the list, after the saved cards. So no order makes cards overlap. A phone with no saved place follows the order of the computer layout. It takes the size of the computer shape, with the phone shape of that size.
- `placeWidgets` in `src/core/widgets/widget-layout.ts` places the cards of the home grid and of the preview.
- On a computer, at least three rows share the height above the message box. Each row is at least 140 px high. More cards add rows, and the page scrolls.
- On a phone, each row is 168 px high, and the page scrolls. With no saved place, an `xlarge` card shows after the smaller cards, so a long calendar does not push them out of view. Two `small` cards share a row. A `small` card that Eva places alone in its row takes the full width. A card that the person placed keeps the shape that the person gave it.

- The widget always fills the space that it gets, at every screen size. It has no empty border.
- Keep the top right corner free of text and buttons: 56 px wide and 56 px high, at every size. Eva puts her full-screen button there, over the widget, and her close button in full screen.
- Opened in full screen in a browser, the widget fills the whole window with content, even if it looks stretched.
- Show less in a small size, and more in a large one. Do not scroll the page sideways.

The test `tests/fills-screen.spec.js` of the template checks this at several sizes. Keep it.

### The header slot

- On a computer, the home page has a header slot at the right of the greeting row. It is 72 px high, and from 320 to 640 px wide. It holds one line of content.
- The slot grows to 640 px when the row has room, and shrinks to 320 px. When the page column is narrower than 680 px, the row has no room for the greeting and the slot, and a column of the grid would be narrower than about 160 px. Then the home page uses the phone layout, as a window narrower than 761 px does: the widget of the slot is the first row of the grid, with `?size=header`.
- One widget at most sits in the slot. A widget with the manifest size `header` goes there by default, when the slot is free: the first such widget in the list order. A widget that waits for approval never goes there.
- In the layout editor, the person can move any widget in or out of the slot. A widget in the slot gets `?size=header`. A widget that leaves the slot gets the size of its shape in the grid. A `header` widget in the grid is 2 × 1 and gets `medium`.
- The entry of `.eva/widgets.json` keeps the choice in its `layout` key: `"header": true` puts the widget in the slot, and `"header": false` keeps a `header` widget out of it. With no value, the default decides. An older Eva ignores the key.
- On a phone, there is no room beside the greeting. The widget of the slot shows as the first card of the grid, at the full width and 1 row high, still with `?size=header`. So a `header` widget must also fill a frame of about 358 × 168 px.
- The full-screen button stays on a widget in the slot. Keep the top right corner free there too.
- `placeHome` in `src/core/widgets/widget-layout.ts` chooses the widget of the slot and places the grid, for the home page and the preview.

## Theme

Load `eva/theme.css` before your own stylesheet. It gives these EVE colour variables. They are names of the contract: a later contract keeps them.

| Variable              | Use                                  |
| --------------------- | ------------------------------------ |
| `--bg`                | The page ground.                     |
| `--panel`             | A card or a box on the ground.       |
| `--ink`               | The main text.                       |
| `--muted`             | A second text, such as a date.       |
| `--line`              | A border or a divider.               |
| `--chip`              | A small filled shape, such as a tag. |
| `--accent`            | The main colour, such as a button.   |
| `--accent-ink`        | Text in the main colour.             |
| `--on-accent`         | Text on `--accent`.                  |
| `--soft`              | A soft fill in the main colour.      |
| `--soft-ink`          | Text on `--soft`.                    |
| `--ok`, `--ok-bg`     | Done, and its fill.                  |
| `--warn`, `--warn-bg` | A warning, and its fill.             |
| `--bad`, `--bad-bg`   | An error, and its fill.              |

- Give each variable a fallback, such as `var(--panel, white)`. A widget that does not load `eva/theme.css` still works.
- Light and dark mode work with the standard `prefers-color-scheme`. Eva gives the widget the colour scheme of her page.
- Inside Eva, the variables hold the person's colours.

## Data formats

Each input that the widget writes has a JSON Schema in `schemas/`, in JSON Schema draft 2020-12. The schema describes one file of the folder.

- The top of the schema is an object: `"type": "object"`.
- Never close an object with `"additionalProperties": false`, at any level. Two widgets can share one folder, and each adds its own fields.
- When the widget changes a file, it keeps the fields that it does not know. Read the file, change your fields, and write the whole object back.
- Eva keeps them too. When a write leaves out a field of the file on disk, and the widget's schema does not name that field at that level, Eva keeps the field. She does the same inside each object. A list is the widget's own: Eva writes it as the widget sends it, so keep the fields of each item.
- A write of a YAML file loses its comments.
- A widget tolerates a missing field. Another widget, or the person, can write a file with fewer fields.
- Eva checks each write against the writer's own schema. She refuses a file that does not fit, with the reason, as `422`.

### The data format file

Eva writes a `DATA_FORMAT.md` into each folder where a widget input with a `schema` keeps data. A file input gets it in the folder of its file. The file tells the agent and the person how to write the data:

- Its first line is "Generated by Eva. Do not edit. Write your notes in the AGENTS.md or the README.md of this folder."
- It lists the widgets of the folder, the file names that each one reads, and each field: its type, its allowed values, the widgets that need it and the widgets that use it.
- It gives an example file.
- Eva writes the whole file again each time the format of the folder changes. An edit is then lost, and Eva tells the person once. The vault history keeps the old version.
- When the last widget of the folder goes, the file stays: it still describes the person's data.
- A widget never reads, lists or writes `DATA_FORMAT.md`.

Only the hub writes the file, from the widgets that it approved.

### Two widgets in one folder

Eva compares the schemas of a folder field by field, at every level: the fields of each object and of the items of each list. No widget depends on another.

| Case                                                       | Result                        |
| ---------------------------------------------------------- | ----------------------------- |
| The widget only reads and defines no format                | Allowed                       |
| The folder has no format yet                               | The widget sets it            |
| Same field, same type                                      | Compatible                    |
| Different fields                                           | Compatible: the fields add up |
| Same field, another type, format or list of allowed values | Conflict                      |

- `integer` and `number` are two types. A field with no `type` fits any type.
- Eva never maps one field name to another. When one widget calls a field `location` and another calls it `place`, the agent fills both.
- On a conflict, Eva warns the person. The person turns the widget on with read access only, or picks another folder.

### The check after each answer

After each answer in an Assistant chat, Eva checks the data files that the answer changed against each schema whose `files` pattern covers them. A file that a widget wrote, and that the answer did not change after, is the widget's: its own check ran at the write.

- When a file does not fit, Eva sends the agent the file and the field, so it fixes the file.
- When the fix fails too, or the person stopped the answer, the chat shows a note with the file and the field.
- Eva skips the check when a snapshot of the answer failed, or when the vault sync is off.

## Naming rules

The field names of a data schema follow strict rules, so that people, agents and other widgets read the data the same way.

- Write camelCase English, with full words and no abbreviation: `location`, never `loc`; `temperature`, never `temp`.
- Put the unit in the name: `durationMinutes`, `distanceMeters`.
- Use the common vocabulary below when it has a name for your field.

| Name       | What it holds                                              |
| ---------- | ---------------------------------------------------------- |
| `date`     | A day, as `YYYY-MM-DD` (`"format": "date"`).               |
| `startAt`  | A start time, in ISO 8601 (`"format": "date-time"`).       |
| `endAt`    | An end time, in ISO 8601 (`"format": "date-time"`).        |
| `location` | A place, as `{ "latitude": 37.77, "longitude": -122.42 }`. |
| `note`     | A free text of the person.                                 |
| `tags`     | A list of short texts.                                     |

A machine checks two of these rules: camelCase, and a list of refused abbreviations, such as `loc`, `temp`, `qty` and `desc`. "Full words" and "the unit in the name" stay rules for people and agents.

The machine check is a meta-schema: [`widgets/meta-schema-v4.json`](widgets/meta-schema-v4.json), a JSON Schema that checks the schemas of a widget. It also refuses a closed object. A standard validator, such as `ajv`, runs it:

- in the CI of each widget, with `npm run check:widget`;
- in Eva's setup report of a widget repository;
- in Eva, when a person turns a widget on. When a name fails, Eva does not turn the widget on, and says which name fails.

## Rules for the code

- Never use an inline script or an inline style. Eva's Content Security Policy blocks them. Put the code in a `.js` file, and the styles in a `.css` file.
- Never rely on `localStorage`. Eva shows a widget in a sandboxed frame with no origin, which cannot use it. Keep a small state in [`eva/state.json`](#the-widgets-own-state) instead.
- Never rely on a form submit, also `<form method="dialog">`. The sandbox blocks it. Handle each button with a `click` listener.
- Keep the fields that you do not know, as [Data formats](#data-formats) says.
- Call only the hosts of the manifest. Eva blocks the others. A host of the manifest serves only `fetch`, images and media. Load each script, style and font from the widget's own files.
- Never use a frame or a Web Worker. The policy blocks them.
- Use only relative paths for the contract paths, such as `fetch("config.json")`, never `fetch("/config.json")`.

## How Eva runs a widget

- Eva keeps a read-only copy of the newest commit of the default branch, on the computer, never in the vault. Before the person approves it, she reads only `eva-widget.json` and the schemas. The approval installs exactly that commit.
- The person approves the inputs and the permissions on each computer. Eva checks each request against this approval, never against the manifest or `.eva/widgets.json`.
- Each widget runs in a frame with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`, so it has no origin of its own. It sends no cookie, and it cannot read Eva's page, Eva's API or another widget.
- A widget can open a link in a new tab, after a tap. The new tab is a normal page, with no sandbox. The widget cannot change Eva's own page. Use `<a href="https://…" target="_blank" rel="noopener noreferrer">`, or `window.open(url, "_blank", "noopener")`.
- Eva serves the widget from a path with a random token. Each answer carries a Content Security Policy: the widget loads its scripts, styles and fonts only from its own files, and calls only the approved hosts.
- A host must be a public `https` address. Eva refuses her own names, this computer, the local network and the tailnet.
- A sandbox and a policy do not block every channel, such as WebRTC. A check by name also cannot see a public name that points to a private address. So a widget is code from its author: turn on only a widget whose author you trust.

### Updates

Permissions decide an update, not a version. Eva reads no version of a widget. Releases of the widget repository stay as notes for the person.

- Eva checks the newest commit of the default branch with `git ls-remote`, which downloads no code. Each computer checks its own copies.
- The person's own widgets, the widget projects of the vault, are checked at the interval of `widgets.checkIntervalMinutes`: 30 minutes by default. Every other widget is checked once a day. **Check for updates** checks every widget at once.
- A permission is each folder or file with its type, its access and its `files` pattern, the location, the calendar and the tasks with their access, the cases, each ask, each host, the prompt line and the text of each schema.
- An update with no new permission installs by itself. The home page shows it soon after.
- Any other update waits, and the old version keeps running. An update also waits when its manifest fails, it follows a newer contract, it adds a required input, or a schema conflicts with another widget of the same folder. Eva says why.
- Eva sends one notice for each waiting commit, with the new permissions and the release notes since the installed commit. With no release notes, it shows the commit subjects. A computer that is not the hub sends the notice through the hub, with its own name.
- After a refusal, the old version stays. Eva asks again only for a newer commit.

### Preview from a clone

A widget project shows **Preview** on each clone. The preview shows the widget from the clone's folder as it is, with no push and no merge.

- **Example data**, the default, answers the contract paths with the mock files of the clone, as GitHub Pages does. A write fails.
- **My data** answers them from the person's vault, and a write changes the real vault. A widget that is set up in Eva keeps its values and its approval: Eva asks only for what the clone adds. A widget that is not set up asks for each permission.
- What the person approves in a preview stays on the computer, apart from the approved widget, until the clone goes. The installed widget gets it only when its `main` asks for it and the person approves that update.
- The preview runs with the same frame, token path and policy as an installed widget. It never serves a hidden file, such as `.git/` or `.env`, a link, or a file that git ignores.

## Outside Eva: the demo

A browser blocks `fetch` on `file://`, so a double-click on `index.html` does not work. Run the widget with one command, such as `npx serve`, or open its GitHub Pages demo. GitHub Pages is on for each widget, and shows the newest `main`.

- The mock files of the repository answer the contract paths.
- A write fails. Show the change on the screen only, with a note that this is a demo.
- The location comes in this order:
  1. `eva/location.json`. Inside Eva, this path always answers, so a mock location never shows in Eva.
  2. When that path does not exist, the browser's `navigator.geolocation`.
  3. When the visitor does not allow it, the mock `example/location.json`.
- The calendar, the tasks and the cases come from `eva/google-calendar/`, `eva/google-tasks/` and `eva/cases.json`. When a path answers `404`, read its mock under `example/`: `example/google-calendar/calendars.json`, `example/google-calendar/events.json`, `example/google-tasks/lists.json`, `example/google-tasks/tasks.json` or `example/cases.json`. Inside Eva, these paths always answer for a widget with the input, so a mock never shows in Eva. The **Example data** preview answers `404` too, so it shows the mocks.
- `eva/state.json` answers `404`, and a `PUT` fails. Keep the state in memory.
- No answer comes to an ask. Hide each entry that needs Eva, such as "Open in Eva".

## Contract versions

`contract` in the manifest says which contract the widget follows.

- A new manifest key, a new input type or a new contract path raises the contract.
- Eva refuses a widget with a `contract` that she does not know, and says "Update Eva to use this widget".
- Eva keeps reading the older contracts.
- The manifest keys and the contract paths are fixed names: change them only by a new contract.
- Each contract has its schema files at a stable address: `docs/widgets/manifest-v<contract>.json` and `docs/widgets/meta-schema-v<contract>.json` on `main` of Eva's repository. A change of the rules of a contract never makes an old widget fail. Eva ships the same files in her code, so her check needs no network.

| Contract | What it adds                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1`      | The first contract.                                                                                                                                         |
| `2`      | The sizes `tall` and `xlarge`, the inputs `eva-google-calendar` and `eva-cases`, and their paths under `eva/`. The data rules stay the same.                |
| `3`      | The size `header`, the key `asks` with its messages, the path `eva/state.json`, and new fields of the calendar and the cases. The data rules stay the same. |
| `4`      | The input `eva-google-tasks` and its paths under `eva/google-tasks/`. The data rules stay the same.                                                         |

A widget of contract 1, 2 or 3 works with no change. To use a new size, input, key or path, set `contract` to the contract that adds it.

## Example: a habits widget

This widget shows the person's habits and checks a habit for today. The [base habits widget](https://github.com/guplem/eva-widget-habits) of Eva uses the same data format, plus optional fields, such as a target, skipped days, a colour and an archive flag: see its [`schemas/habits.json`](https://github.com/guplem/eva-widget-habits/blob/main/schemas/habits.json).

The person picks a folder, such as `Life/Habits/`. The folder has one file for each habit, such as `meditate.json`. The file name is the habit name in lower case, with ASCII letters, digits and hyphens only. The name `index` is not allowed.

`eva-widget.json`:

```json
{
  "contract": 3,
  "name": "Habits",
  "size": "medium",
  "inputs": [
    {
      "id": "habits",
      "type": "folder",
      "label": "Habits folder",
      "description": "The folder with one file for each habit.",
      "why": "The widget shows your habits, and saves a check when you mark a habit done.",
      "required": true,
      "access": "write",
      "schema": "schemas/habits.json",
      "files": "*.json"
    }
  ],
  "prompt": "Habits live in {habits}, one JSON file for each habit. Before you create a habit file, ask the person once."
}
```

`schemas/habits.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "A habit",
  "type": "object",
  "required": ["name", "kind", "frequency", "checks"],
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "kind": { "enum": ["yesNo", "number"] },
    "unit": { "type": "string", "description": "The unit of a number habit, such as minutes." },
    "frequency": {
      "type": "object",
      "required": ["times", "days"],
      "properties": {
        "times": { "type": "integer", "minimum": 1 },
        "days": { "type": "integer", "minimum": 1 }
      }
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["date"],
        "properties": {
          "date": { "type": "string", "format": "date" },
          "value": { "type": "number" },
          "note": { "type": "string" }
        }
      }
    },
    "note": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
}
```

`data/habits/meditate.json`, a mock file:

```json
{
  "name": "Meditate",
  "kind": "number",
  "unit": "minutes",
  "frequency": { "times": 1, "days": 1 },
  "checks": [{ "date": "2026-01-01", "value": 10 }]
}
```

`frequency` reads "`times` in `days`": `{ "times": 3, "days": 7 }` is three times a week. A `yesNo` habit has checks with no `value`.

The widget reads `config.json`, then `data/habits/index.json`, then each habit file. To check a habit, it adds a check to the file and sends the whole file back with `PUT data/habits/meditate.json`. It keeps every field that it does not know.
