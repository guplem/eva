# Plan: CLI and local API errors (#508)

## Motivation

Eva must tell the person what went wrong, in plain words. A refusal that looks like a crash, a failure that exits 0, or a terminal that waits for ever hides the problem. An API error with no log line leaves nothing to debug from the phone (`/logs`).

## Changes

1. `src/frontends/cli/client.ts`: add one helper, `refusalOf(response)`. It reads `{ error, code }` from the answer and returns an `EvaError`. All the client calls use it. `chat.ts` uses it too, for its refusals.
2. `src/frontends/cli/local-commands.ts`: `requestSync` returns the sync state, and `requestUpdate` returns the text and the update status. `sync` and `update` pick the exit code from them, as the local path does.
3. `src/frontends/cli/chat.ts`: a `close` listener sets a flag, prints "Eva closed the connection." and wakes the loop. Both loops check the flag.
4. `src/frontends/api/local-api.ts`: add `logger?: Logger` to `LocalApiOptions`. `errorResponse` logs an unexpected error with its redacted message and stack. `src/main.ts` passes the logger.
5. `src/frontends/api/local-api.ts`: move `decodeURIComponent` of `deviceLogin` into its `try`. `errorResponse` already turns a `URIError` into a 400.

## Gaps and decisions

- **The code of an answer with no `code`**, such as a 401 or a 500. Decision: add a new `EvaErrorCode`, `request_failed`. Only the CLI makes it. A new code is not a breaking change.
- **A code that this CLI does not know**, from a newer Eva. Decision: keep it as it is. `describeFailure` branches only on `config_invalid` and `instance_locked`, so an unknown code prints its message and exits 1.
- **A server `config_invalid` code**, such as for `eva settings set port 5`. It now exits with the bad-config code (2), as a local refusal does. This fits `describeFailure`.
- **The message when the body is not JSON.** Decision: "Eva answered <status>: <first 200 characters of the text>".
- **Tests that read the status in the message** (`cli.test.ts`). Decision: they check the code and the message instead.
- **Sub-agents:** this agent cannot start sub-agents, so it did the research and the reviews itself.
