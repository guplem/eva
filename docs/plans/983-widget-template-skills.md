# Plan: the widget template ships the skills that it names (#983)

## Choice

Do both options of the issue.

1. `readWidgetTemplate` also reads every folder of Eva's `.agents/skills/` at build time. The first commit of a new widget repository then carries exact copies. No copy lives in `templates/widget/`.
2. `templates/widget/AGENTS.md` says that these skills are exact copies of Eva's skills, and where to copy a missing one from. This helps an agent that copies `templates/widget/` from disk.

## Decisions

- Copy every folder of Eva's `.agents/skills/`, not a fixed list. The setup report wants each skill of Eva.
- A test catches a name clash with the template's own skills (`pskill`, `widget-change`). The macro does not fail the build.
- Do not edit a skill for widgets. The widget repository gets Eva's skills as they are.

## Tests first

1. `readWidgetTemplate` adds Eva's skills under `.agents/skills/`, and skips a git-ignored file.
2. Each skill file of Eva arrives byte for byte in `widgetTemplate(...)`, after the name fill-in.
3. The template's `AGENTS.md` names each shipped skill, each named skill ships, and no name clashes.
4. `evaluateSetup` shows each skill item green for a new widget repository.

## Gaps

None open. The parent session answered the two decisions above.
