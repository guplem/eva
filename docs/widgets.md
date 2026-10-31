# Widgets

A widget is a small web page that Eva shows on her home page. This document is the widget contract: the rules that each widget follows, so that Eva can show it, give it data, and keep the person's data safe. It is contract `1`.

A widget is plain, standard web code: HTML, JavaScript and CSS, with no framework of Eva and no build step. The same files work inside Eva and on any static web server, such as GitHub Pages.

The template of a new widget is [`templates/widget/`](../templates/widget/). Eva copies it to each new widget repository. Each Eva release updates the template and this document together.

The two widgets that ship with Eva are full examples: [`guplem/eva-widget-habits`](https://github.com/guplem/eva-widget-habits) writes vault data, and [`guplem/eva-widget-weather`](https://github.com/guplem/eva-widget-weather) reads the location and calls a host.

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

| Path                    | What it holds                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `eva-widget.json`       | The manifest. It is at the repository root.                                                   |
| `index.html`            | The page that Eva opens (the `entry` of the manifest).                                        |
| `main.js`, `style.css`  | The code and the look. Add more files as you need.                                            |
| `schemas/<input>.json`  | The JSON Schema of each file that the widget writes.                                          |
| `config.json`           | Mock values of the inputs, for the demo.                                                      |
| `data/<input>/`         | Mock files of a folder input, with its `index.json`.                                          |
| `eva/theme.css`         | A mock of the theme, with the default EVE colours.                                            |
| `example/location.json` | A mock location, only when the widget uses the location. Never put it at `eva/location.json`. |
| `tests/`                | The tests, with a helper that fakes the writes.                                               |

## The manifest: `eva-widget.json`

The manifest says what the widget is and what it needs. [`widgets/manifest-v1.json`](widgets/manifest-v1.json) is its JSON Schema. A key that the schema does not name is an error.

| Key        | Required | What it is                                                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| `contract` | yes      | The version of this contract: `1`.                                                               |
| `name`     | yes      | The name that Eva shows, 60 characters at most.                                                  |
| `entry`    | no       | The page that Eva opens, by its path from the repository root. `index.html` when not given.      |
| `size`     | yes      | The size of the widget's card in the grid: `small`, `medium` or `large`.                         |
| `inputs`   | no       | What the widget needs from the person. See [The inputs](#the-inputs).                            |
| `hosts`    | no       | The web addresses that the widget calls. Each has a `url` (`https`, with no path) and a `why`.   |
| `prompt`   | no       | One line for Eva's prompt, such as "Habits live in {habits}." `{habits}` names an input's value. |

Eva adds the `prompt` line of each widget that is on to the prompt of each new chat, with the person's values in place of the placeholders. A placeholder of an empty input reads "(not set)". The person sees the line when they turn the widget on. A widget with no `prompt` gets a default line, such as "Habits data lives in Life/Habits. Read Life/Habits/DATA_FORMAT.md before you write."

Eva shows each `why` to the person when the person turns the widget on. Write each `why` for the person: say what the widget does with the permission.

## The inputs

Each input has these keys:

- `id`: a camelCase name, such as `habits`. It is the key of the input in `config.json`, and the folder of the input in `data/`.
- `type`: one of the types below.
- `label`: a short name for the form.
- `description`: what the person gives.
- `why`: why the widget needs it.
- `required`: `true` or `false`.
- `default`: a value for the form, as needed.

| Type           | What the person gives                              | Extra keys                                   |
| -------------- | -------------------------------------------------- | -------------------------------------------- |
| `folder`       | A folder of the vault. The form shows the vault.   | `access`, `files`, and `schema` for a write. |
| `file`         | A file of the vault.                               | `access`, and `schema` for a write.          |
| `text`         | A text.                                            |                                              |
| `url`          | A web address. The form shows a text box.          |                                              |
| `number`       | A number.                                          |                                              |
| `boolean`      | Yes or no.                                         |                                              |
| `choice`       | One value of a list.                               | `choices`: the list, 2 values at least.      |
| `eva-location` | The permission to read the person's last location. | No `default`.                                |

- `access` is `read` or `write`. A write also allows a read.
- `schema` is the path of the JSON Schema of each file that the widget writes, such as `schemas/habits.json`.
- `files` is a glob pattern of the file names of a folder, such as `*.json` or `????-??-??.json`. `*` matches any text, and `?` matches one character. Neither matches a `/`.

A widget gets only what its inputs give. A widget with no `eva-location` input gets nothing at `eva/location.json`.

## How a widget talks to Eva

A widget talks to its host only through `fetch` to relative paths. The host decides the answer. Inside Eva, Eva answers with the person's data. On GitHub Pages, or on any static server, the mock files of the repository at the same paths answer. So the widget code is the same in both places.

| Path                      | Method                 | Answer                                                                                |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `config.json`             | `GET`                  | The values of the inputs, by `id`.                                                    |
| `data/<input>/index.json` | `GET`                  | A JSON array of the file names of the folder that the person chose.                   |
| `data/<input>/<file>`     | `GET`, `PUT`, `DELETE` | `GET` reads the file. `PUT` writes the whole file with the body. `DELETE` removes it. |
| `eva/location.json`       | `GET`                  | The last location, or `null` when Eva has none yet.                                   |
| `eva/theme.css`           | `GET`                  | The EVE colour variables. See [Theme](#theme).                                        |

- A `file` input uses the path `data/<input>`, with no file name.
- `data/<input>/` includes the subfolders of the folder. `index.json` lists each file of the folder and its subfolders by its path from the folder, such as `2026/run.json`, when its name matches `files`. So a file of the person named `index.json` at the top of the folder stays hidden.
- A widget never reaches `.git/`, `.eva/`, `Scratch/`, the clones in `Projects/*/repos/`, `Life/About me.md` or any hidden file, also inside a folder that the person picked.
- A widget writes only a JSON or YAML file whose name matches `files`, and never a rule file of an agent: `AGENTS.md`, `CLAUDE.md`, `README.md` or `DATA_FORMAT.md`. A write is 5 MB at most. Eva refuses a text that holds a secret, such as a token.
- `eva/location.json` answers `null` for a widget with no `eva-location` input.
- `eva/location.json` holds `{ "latitude": 41.39, "longitude": 2.17, "accuracy": 30, "at": "2026-01-01T09:30:00Z" }`. `accuracy` is in meters. `at` is the time of the newest stored point.
- A `PUT` or a `DELETE` fails outside Eva. Handle the failure. See [Outside Eva: the demo](#outside-eva-the-demo).
- A data file is JSON or YAML.

Eva gives the size in the address, as `?size=small`, `medium`, `large` or `full`.

## Sizes

A widget has three sizes for a fixed grid, `small`, `medium` and `large`, and a full-screen view, `full`. The manifest's `size` is the size of its card in the grid. Eva can change the sizes later.

- The widget always fills the space that it gets, at every screen size. It has no empty border.
- Opened in full screen in a browser, the widget fills the whole window with content, even if it looks stretched.
- Show less in a small size, and more in a large one. Do not scroll the page sideways.

The test `tests/fills-screen.spec.js` of the template checks this at several sizes. Keep it.

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

| Name       | What it holds                                           |
| ---------- | ------------------------------------------------------- |
| `date`     | A day, as `YYYY-MM-DD` (`"format": "date"`).            |
| `startAt`  | A start time, in ISO 8601 (`"format": "date-time"`).    |
| `endAt`    | An end time, in ISO 8601 (`"format": "date-time"`).     |
| `location` | A place, as `{ "latitude": 41.39, "longitude": 2.17 }`. |
| `note`     | A free text of the person.                              |
| `tags`     | A list of short texts.                                  |

A machine checks two of these rules: camelCase, and a list of refused abbreviations, such as `loc`, `temp`, `qty` and `desc`. "Full words" and "the unit in the name" stay rules for people and agents.

The machine check is a meta-schema: [`widgets/meta-schema-v1.json`](widgets/meta-schema-v1.json), a JSON Schema that checks the schemas of a widget. It also refuses a closed object. A standard validator, such as `ajv`, runs it:

- in the CI of each widget, with `npm run check:widget`;
- in Eva's setup report of a widget repository;
- in Eva, when a person turns a widget on. When a name fails, Eva does not turn the widget on, and says which name fails.

## Rules for the code

- Never use an inline script or an inline style. Eva's Content Security Policy blocks them. Put the code in a `.js` file, and the styles in a `.css` file.
- Never rely on `localStorage`. Eva shows a widget in a sandboxed frame with no origin, which cannot use it.
- Keep the fields that you do not know, as [Data formats](#data-formats) says.
- Call only the hosts of the manifest. Eva blocks the others.
- Use only relative paths for the contract paths, such as `fetch("config.json")`, never `fetch("/config.json")`.

## How Eva runs a widget

- Eva keeps a read-only copy of the newest commit of the default branch, on the computer, never in the vault. Before the person approves it, she reads only `eva-widget.json` and the schemas. The approval installs exactly that commit.
- The person approves the inputs and the permissions on each computer. Eva checks each request against this approval, never against the manifest or `.eva/widgets.json`.
- Each widget runs in a frame with `sandbox="allow-scripts"`, so it has no origin of its own. It sends no cookie, and it cannot read Eva's page, Eva's API or another widget.
- Eva serves the widget from a path with a random token. Each answer carries a Content Security Policy: the widget loads only its own files, and calls only the approved hosts.
- A host must be a public `https` address. Eva refuses her own names, this computer, the local network and the tailnet.
- A sandbox and a policy do not block every channel, such as WebRTC. A check by name also cannot see a public name that points to a private address. So a widget is code from its author: turn on only a widget whose author you trust.

### Updates

Permissions decide an update, not a version. Eva reads no version of a widget. Releases of the widget repository stay as notes for the person.

- Eva checks the newest commit of the default branch with `git ls-remote`, which downloads no code. Each computer checks its own copies.
- The person's own widgets, the widget projects of the vault, are checked at the interval of `widgets.checkIntervalMinutes`: 30 minutes by default. Every other widget is checked once a day. **Check for updates** checks every widget at once.
- A permission is each folder or file with its access, the location, each host, the prompt line and the text of each schema.
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

## Contract versions

`contract` in the manifest says which contract the widget follows.

- A new manifest key, a new input type or a new contract path raises the contract.
- Eva refuses a widget with a `contract` that she does not know, and says "Update Eva to use this widget".
- Eva keeps reading the older contracts.
- The manifest keys and the contract paths are fixed names: change them only by a new contract.
- Each contract has its schema files at a stable address: `docs/widgets/manifest-v<contract>.json` and `docs/widgets/meta-schema-v<contract>.json` on `main` of Eva's repository. A change of the rules of a contract never makes an old widget fail. Eva ships the same files in her code, so her check needs no network.

## Example: a habits widget

This widget shows the person's habits and checks a habit for today. The [base habits widget](https://github.com/guplem/eva-widget-habits) of Eva uses the same data format.

The person picks a folder, such as `Life/Habits/`. The folder has one file for each habit, such as `meditate.json`. The file name is the habit name in lower case, with ASCII letters, digits and hyphens only. The name `index` is not allowed.

`eva-widget.json`:

```json
{
  "contract": 1,
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
