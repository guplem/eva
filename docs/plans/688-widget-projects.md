# Plan: a widget contract and a widget repository type (#688)

## Why

The "Home page widgets" milestone needs one contract that every widget follows. This issue writes it, and lets a person create a widget project that is ready to work on. #691 to #695 build on it.

## Parts

1. **The contract.** `docs/widgets.md`, with `docs/widgets/manifest-v1.json` (the JSON Schema of `eva-widget.json`) and `docs/widgets/meta-schema-v1.json` (the naming rules for the data schemas).
2. **The template.** `templates/widget/`: a small habits starter widget that uses every contract path, with its tests, CI, release, pskill, `AGENTS.md`, `README.md` and `LICENSE`. Its `check` script passes in Eva's CI.
3. **The check in Eva.** `src/core/widgets/widget-contract.ts` runs the same two schema files with `ajv`, so a check needs no network. It names each field that fails.
4. **The type.** A data-only catalog (`repository-catalog.ts`) for the web client, and the widget entry in `repository-types.ts`: vibe-coded items, plus a "Widget" section. `afterCreate` commits the template on top of GitHub's first commit. `afterFixes` starts the first Pages deploy. The type opens the chat that asks the person to describe the widget, instead of the setup chat.
5. **The facts.** `repository-facts.ts` also reads the Pages status, `eva-widget.json` and the schemas that it names.
6. **The proposal.** A repository with no type and an `eva-widget.json` gets `proposedType: "widget"` in its report. The setup card shows it.
7. **The form.** The widget type picks public. A private widget shows a warning.
8. **Eva's CI** runs the template's `check` script in the `web-ui` job, and `pskill validate` on the template.

## Gaps and decisions

- **Validator in Eva:** `ajv`, as the issue names. It runs in the core only. The web client imports only the catalog, so `ajv` stays out of the browser bundle.
- **Template example:** a habits starter, in the habits format of #694 (one file for each habit, with `name`, `kind`, `unit`, `frequency` and `checks`). The docs example uses the same format. It shows the location, so the demo shows the location rule.
- **Names in the template:** the template uses `example-owner`, `example-widget` and `Example widget`. Eva replaces them with the person's owner, repository and title, escaped for JSON and HTML. So the template on disk passes its own checks.
- **Required checks:** the widget type knows its check names (`lint` and `test`), so its "Required checks before merge" item gets a direct fix: a ruleset with these checks, no deletion and no force push.
- **Pages:** a direct fix turns Pages on with `build_type: workflow`. Then `afterFixes` starts the deploy workflow with `workflow_dispatch`, as the issue says.
- **The contract files in a widget's CI:** the widget's check script reads the two schema files from Eva's `main` by their stable address. `EVA_CONTRACT_DIR` points it at a local folder, so Eva's CI checks the template against the contract of the same commit.
- **pskill:** the sandbox of this work cannot run `pskill init`, so the files are written by hand to the pskill 0.43.0 format, with the pin of that release. Eva's CI runs `pskill validate` on them.
- **Open PRs on the page of a widget project:** an assumption of the issue, not a decision of the person. It needs its own UI work, so it becomes a follow-up issue.
