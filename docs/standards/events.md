# Events

One TypeScript union crosses the engine port (plan §4.6). Each engine adapter turns its own output into these events. The core and every front end read only these events, never the raw engine output.

## The union

Every event has `kind`, `sessionId`, `seq`, and `at`.

| kind              | Payload                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `text`            | `text`, `messageId` (the engine's id of the answer message: the fork and retry point)                                          |
| `tool_started`    | `toolUseId`, `name`, `summary`                                                                                                 |
| `tool_finished`   | `toolUseId`, `isError`                                                                                                         |
| `task_changed`    | `taskId`, `description`, `state` (`running` / `done` / `failed`)                                                               |
| `approval_needed` | `requestId`, `toolName`, `summary`                                                                                             |
| `history_lost`    | none                                                                                                                           |
| `notice`          | `text`                                                                                                                         |
| `turn_finished`   | `engineSessionId`, `lastMessageId`, `usage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`), `costUsd?` |
| `turn_failed`     | `reason`                                                                                                                       |

## Rules

- **Define the union once, in `src/shared/events.ts`** (`EngineEventPayload`, and `SessionEvent` with the common fields). The core, the engines, and the front ends import it from there (ADR 0005).
- **Discriminate on `kind`.** Model the union as one type per kind, joined with `|`. Never add a free-form `type: string` field.
- **Handle every kind in a `switch` with an exhaustive check** (a `never` default), so a new kind fails the typecheck in every place that must handle it.
- **Order events by `seq`, never by `at`** (lesson 83). `seq` is an increasing counter per session; use `SequenceCounter` (`src/shared/clock.ts`). `at` comes from the `Clock` seam and is for display only.
- **End every turn stream with exactly one `turn_finished` or `turn_failed`** (lesson 47). An adapter that loses its engine emits `turn_failed`; it never stops the stream with nothing.
- **Emit `history_lost`** when the engine no longer knows the session, and clear the stored engine session id at once (lesson 46).
- **Report cache token counts in `usage`** (lesson 120), so a broken prompt cache shows in `/status` and in the log.
- **Map structured engine fields, never English text** (lesson 36). A `notice` carries text for people; no code branches on it.
- **Redact every text field before the event leaves the core** (lesson 95, plan §12).
- **A file marker in an answer stays plain text,** not an event (lesson 124).

## Change the union

1. Change plan §4.6 first only with the owner's approval; the plan is the approved design.
2. Add the kind in `src/shared/` with a test that an adapter emits it.
3. Let the typecheck show every exhaustive `switch` that needs the new kind, and handle it in each.
4. Update the table above in the same pull request.
