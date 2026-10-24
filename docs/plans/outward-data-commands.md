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

To fill.
