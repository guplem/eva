# Plan: an expired engine login reaches the phone (#192)

## Why

A turn with an expired Claude Code token fails with only a text reason. No front end can tell the cause, so none can offer the fix. Eva must work from a phone, so the person needs a problem that says what happened and a button to the fix.

## Design

1. **Engine event.** `turn_failed` gets an optional field `loginExpired: true`. It follows the pattern of `startsBlock?: true` and `automatic?: true`. An older event has no field, so a reader treats it as another failure.
2. **Claude Code adapter.** The SDK marks the engine's own message with `error: "authentication_failed"`. A top-level message with this field sets a flag. The error result then ends the turn with `loginExpired: true` and Eva's own reason. The adapter drops the engine's own line ("Please run /login"), because that fix needs a terminal. The same pattern handles a refused turn at the usage limit.
3. **Core.** `src/core/eva.ts` reads each turn end. A failed turn with `loginExpired` reports the problem `engine_login:<engine>`. A finished turn of the same engine clears it. The words live in `problem-rules.ts`.
4. **Telegram.** The alert center already sends each problem to Telegram. No change.
5. **Web.** `problemAction` maps a key `engine_login:claude-code` to a new action, `log_in_engine`, with the label "Open Settings". It opens Settings, Engines, Claude Code, where the person logs in again or pastes a token.

## Gaps and decisions

- **Which SDK field names the cause?** `SDKAssistantMessage.error`, value `authentication_failed`. A structured field, so no message text (lesson 36).
- **One key for each engine, or one for all?** One for each engine: `engine_login:claude-code`. pi can add its own detection later with no new key shape.
- **When does the problem clear?** At the next finished turn of the same engine, as the issue says. A saved token alone proves nothing.
- **Is the new field a stored name?** No. `scripts/check-stored-names.ts` leaves out event kinds, and the field is optional. Old events read the same.
- **pi.** Out of scope. Its login needs a terminal; the issue lists it as a related gap.
