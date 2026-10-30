# Example widget

This repository is a widget for Eva's home page: a small web page that Eva shows in a grid. Read the widget contract first: https://github.com/guplem/eva/blob/main/docs/widgets.md. It says which files a widget has, how it talks to Eva, its sizes, its theme and the naming rules of its data. Never copy the contract into this repository: link it.

## What must not change

- **This repository is public, and holds no data of a person.** It holds only mock data for the tests and the demo. Never write a name of a private person, a real data value, a token or a home path.
- **Plain, standard web code.** HTML, JavaScript and CSS, with no framework and no build step. A browser loads the files as they are.
- **The widget talks to its host only through `fetch` to relative paths** of the contract: `config.json`, `data/<input>/`, `eva/location.json` and `eva/theme.css`.
- **The widget works outside Eva,** on GitHub Pages and with `npm start`, with the mock files at the same paths.

## Rules

- Never use an inline script or an inline style. Eva's Content Security Policy blocks them.
- Never rely on `localStorage`.
- When the widget changes a data file, keep the fields that it does not know.
- Each input that the widget writes has a JSON Schema in `schemas/`. Its field names follow the naming rules of the contract.
- A pull request that adds or widens a permission of `eva-widget.json` says so in its body: a new input, a write access, the location, or a host.
- Keep the mock files in line with the code: `config.json`, `data/`, `eva/theme.css` and `example/location.json`.
- Keep `tests/fills-screen.spec.js`: the widget fills the space that it gets, at every size.

## Checks

- `npm run check` runs every check: the format, the lint, the contract check (`npm run check:widget`) and the tests. CI runs the same checks as the "lint" and "test" jobs.
- `npm start` runs the widget at http://localhost:3000/. Add `?size=small`, `medium`, `large` or `full` to the address.

## Skills

- To make any change, follow `.agents/skills/widget-change/SKILL.md`. It gives the steps of the change one at a time, with the pskill runner. When the runner cannot run, follow `.agents/skills/make-change/SKILL.md` instead, with the rules of this file.
- Before each commit, follow `.agents/skills/write-commit/SKILL.md`.
- To create an issue, follow `.agents/skills/create-issue/SKILL.md`.
- Before each rename, follow `.agents/skills/rename-symbol/SKILL.md`.
- To resume or stop a pskill run, follow `.agents/skills/pskill/SKILL.md`.

## Git and GitHub

- Branch from `origin/main` for each change.
- Open a pull request for each change, and turn on auto-merge for it with `gh pr merge --auto --merge`, with the person's GitHub login. A pull request merges only when CI is green.
- The commit prefixes pick the release version: `feat` raises the middle number, and `fix`, `perf`, `refactor` and `build` the last one. Mark a breaking change with `!`.
- After a merge to `main`, GitHub Pages shows the new version.
