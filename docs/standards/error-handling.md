# Error handling

Eva runs unattended on a server. A failure must be visible, must carry a code that a caller can branch on, and must never take down the core for a reason that a person can fix.

## Expected failures

- **Throw `EvaError` for a failure that Eva expects** (bad config, a locked instance, a timeout, a failed git step). It carries a `code` from `EvaErrorCode` and a message that a person can read. Both live in `src/shared/errors.ts`.
- **Branch on the code, never on the message.** Use `isEvaError(error, "process_timeout")`. The message is for people.
- **Add a new code to the `EvaErrorCode` union** when no existing code fits. Use a snake_case string (`docs/standards/naming.md`). A code is a wire name: front ends and logs see it.
- **Keep the cause.** Pass the original error as `{ cause }` when you wrap it.
- **Any other thrown value is a bug.** Do not catch it to hide it. Let it reach the top-level handler, which logs it and exits with code `1`.

## Outside input

- **Never detect a failure by its English wording** when a structured field exists (lesson 36). Read the exit code, the event field, or the HTTP status.
- **Decide a child process result from its exit code**, never from its text (lesson 93). The `ProcessRunner` seam (`src/shared/process-runner.ts`) throws `process_timeout` or `process_failed`.
- **Bound every wait with a timeout** (lessons 24, 81). A child process gets a gentle stop, then a hard stop.

## Files

- **A bad or missing state file never crashes Eva** (lesson 54). Read it with `readJsonTolerant` (`src/shared/files.ts`), and treat `{ ok: false }` as "start from the default".
- **Drop an old format instead of migrating it** (lesson 54).
- **Read a list tolerantly: skip a bad entry, not the whole file** (lesson 69).
- **Write state with `writeFileAtomic`**, so a reader never sees half a file.

## Async code

- **Await every promise, or hand it to a function that logs its failure** (lesson 50). ESLint (`no-floating-promises` in `strictTypeChecked`) rejects a promise that nobody handles.
- **Keep the setup of a background task inside its `try`**, so a setup failure is logged too (lesson 50).
- **No `await` between a busy check and taking the lock** (lesson 49).

## Turns and the core

- **A failed turn ends with a `turn_failed` event**, never with silence (lesson 47, `docs/standards/events.md`).
- **Fail the turn when `.eva/assistant.md` is missing** (lesson 11). An answer from an agent with no identity is worse than an error.
- **Exit with the code of the contract**: `0` clean stop, `1` crash, `2` bad config, `3` second instance, `4` restart for an update.

## Secrets in errors

- **Redact every error message before it reaches a log, an event, or a chat** (lesson 95). Use `Redactor` (`src/shared/redaction.ts`). Telegram URLs contain the bot token, and a stack trace can contain a URL.
