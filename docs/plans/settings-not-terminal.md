# Point to Settings, not to a terminal command

Issue: #240.

## Motivation

The web page shows "No vault is configured. Run `eva setup`." A person on the page or on a phone cannot run `eva setup`. The page can do the same step in Settings, Setup.

## Changes

1. `src/core/eva.ts`: the `vault_not_found` message of `createAssistantSession` says to finish the vault step in Settings.
2. `src/frontends/web/client/error-toast.tsx`: each code that a person fixes in Settings maps to a place in Settings and a button label. `vault_not_found` maps to the vault step of Setup, with the label "Finish the setup".
3. `src/core/remote-access/steps.ts`: phone access that is off points to Settings, Access.
4. `src/frontends/telegram/telegram-bot.ts`: the pairing code points to Settings, Connections. The voice note message points to Settings, Updates.
5. `src/core/setup/progress.ts`: the engine step drops "or in `eva setup`".

## Gaps

- **G1. Which messages need a terminal for real?** Install an engine or uv, and allow a new device. The page cannot do these steps. Decision: keep their text. A web install is a separate feature.
- **G2. Does a core message name the web page or stay neutral?** Telegram and the CLI read the same text. Decision: say "in Settings on Eva's page", which is true for each front end.
- **G3. Is a change to an error message a schema change?** No. Only the `EvaErrorCode` value is a schema, and it stays the same.
- **G4. Other `vault_not_found` errors**, such as "folder is not empty", happen in the vault step itself. The toast hides its Settings button while Settings is open, so the new button does no harm.
