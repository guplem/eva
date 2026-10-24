# Plan: ask before curl or gh api sends data, with or without -X

Issue: #451.

## Motivation

Assistant mode runs most tool calls at once. It asks the person only before an action that reaches other people. `outwardCommandPattern` in `src/shared/outward-actions.ts` catches a curl or `gh api` write only with `-X POST|PUT|PATCH|DELETE`. Both programs send a POST by themselves when the command carries data. So `curl -d ...` and `gh api ... -f title=...` reach other people with no question. The "What Eva may do" card reads `askedActionWords`, so its words must match the new rule.

## Changes

1. Add tests in `test/unit/shared/shared-basics.test.ts`: each data form of curl and `gh api` asks, and a plain read runs.
2. Change the curl and `gh api` part of `outwardCommandPattern` in `src/shared/outward-actions.ts`.
3. Change the two lines of `askedActionWords` for curl and `gh api`.

## Gaps

1. Which curl flags send data or change the method?
2. Which `gh api` flags send data or change the method?
3. Does an explicit GET with data, such as `gh api -X GET search/issues -f q=x`, ask?
4. Where does a curl or `gh api` command end? The old pattern reads to the end of the whole command line with `.*`.
5. Does the match stay case-insensitive? The old pattern has `/i`, but `curl -f` (fail on error) and `curl -F` (send a form) differ only in case.

## Decisions

Three researchers answered each gap. They checked curl 8.5 and gh 2.89 help texts.

1. curl sends data with `-d`, `--data`, `--data-ascii`, `--data-binary`, `--data-raw`, `--data-urlencode`, `--json`, `-F`, `--form`, `--form-string`, `-T` and `--upload-file`. Short flags can share one dash (`-sd`) and take an attached value (`-d@file`, `-XPOST`). So the short form is `-[A-Za-z]*[dFT]`. All three agreed.
2. `gh api` sends data with `-f`, `--raw-field`, `-F`, `--field` and `--input`. The short form is `-[A-Za-z]*[fF]`. All three agreed.
3. A data flag always asks, also with `-X GET` or `curl -G`. A method flag asks for each value except GET and HEAD, so an unknown method fails safe. Two of three chose this. It keeps one simple rule, as the schedules rule does ("telling a read from a write is guesswork"). `gh api graphql -f query=...` also asks: gh sends it as a POST, and a mutation looks like a query.
4. A curl or `gh api` command ends at an unquoted `|`, `;`, `&` or new line. The match steps over quoted strings, so `'https://x?a=1&b=2' -d x` still asks. All three agreed. A full tokenizer is more exact, but a regex fits the file. Its errors (such as `-ocard`) fail toward asking.
5. The curl and `gh api` patterns are case-sensitive: `-f` and `-F` differ in both programs. The git and `gh issue|pr|...` pattern keeps `/i`. All three agreed.
