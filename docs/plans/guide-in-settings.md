# Plan: the guide in Settings (#708)

## Goal

Show `README.md`, `docs/guide/setup.md` and `docs/guide/reference.md` in a Guide section of Settings. The Settings search finds their sections.

## Design

- `client/guide.ts` is a pure module. It imports the three files `with { type: "text" }`, so each build ships its own docs.
- It renders each doc with `toWebHtml`, then:
  - drops the doc's `# Title` line, because the page header shows the title;
  - drops raw HTML lines, such as the picture in the README, because `toWebHtml` escapes them;
  - turns each relative link into a GitHub link, and each GitHub link to a guide doc into a guide address;
  - gives each heading an id with the GitHub slug rules, so the links of the docs work in both places.
- Sections for the table of contents and the search come from the rendered HTML, so both use the same headings and ids.
- The address of a heading is `#/settings/guide/<doc>/<slug>`. `parseSettingsHash` keeps the rest of the path as the item.
- `SettingsView` gets a `guide` section. The home of the section lists the docs with their contents. A doc page shows an "On this page" list, the doc, and a link to GitHub.
- The search field of Settings finds settings and guide sections. A guide result shows a short piece of text with the matched words marked.

## Gaps

- **Which docs?** Only the docs for people. `AGENTS.md` says that `README.md` and `docs/guide/` are for people.
- **Its own search, or the Settings search?** The Settings search, because `AGENTS.md` says to reuse a shared component before adding one.
- **Version of the GitHub link:** `main`, as the two messages in `src/core` do today.
- **Icon:** a new `book` icon in `client/icons.tsx`, added to the EVE icon list.
