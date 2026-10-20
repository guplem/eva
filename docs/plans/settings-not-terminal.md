# Point to Settings, not to a terminal command

Issue: #240.

## Motivation

The web page shows "No vault is configured. Run `eva setup`." A person on the page or on a phone cannot run `eva setup`. The page can do the same step in Settings, Setup.

## Changes

1. `src/core/eva.ts`: the `vault_not_found` message of `createAssistantSession` says to finish the setup in Settings.
2. `src/frontends/web/client/error-toast.tsx`: a pure module maps each error code to its fix in Settings: a label and an address. `vault_not_found` maps to the vault step of Setup, with the label and address of `setupBlock("vault")`. The other codes keep "Open Settings".
3. `src/frontends/telegram/telegram-bot.ts`: the pairing code points to Settings, Connections, which shows it.
4. `src/core/setup/progress.ts`: the device step says to tap Allow on an open Eva page or in Telegram, and keeps the terminal as one more way. The engine step drops "or in `eva setup`".
5. Follow-up #242 asks for a web install of the engines and uv.

## Gaps and decisions

- **G1. Which messages need a terminal for real?** Decision: the page cannot do these steps, so their text stays:
  - Install an engine or uv (`progress.ts`, `checks.ts`, `EnginesSection.tsx`, `claude-login.ts`, `tool-versions.ts`). A follow-up issue covers the web install.
  - Turn on phone access (`steps.ts`). It is a security setting, so it changes only on the machine. `AccessSection.tsx` has no switch for it.
  - Set up voice notes (`telegram-bot.ts`). Only `eva setup` sets `voice.modelPath`.
  - Fix Tailscale (`tailscale.ts`), and the login screen of a device that no page has allowed yet (`LoginView.tsx`).
  - A device can be allowed from an open page or Telegram, so the device step changes (change 4).
- **G2. Does a core message name the web page or stay neutral?** Decision: say "in Settings, on Eva's page". `progress.ts` and `cli/client.ts` use this phrase already. `eva chat` relays the same text, and the phrase is true there too.
- **G3. Is a change to an error message a schema change?** No. `AGENTS.md` lists only the `EvaErrorCode` value as a schema, and it stays the same. The toast branches on the code.
- **G4. Other `vault_not_found` errors.** The folder errors happen in the vault step, where the toast hides its Settings button. A missing `.eva/assistant.md` uses the same code during a turn. Decision: accept it. The vault step is the nearest place to fix a vault, and a new code needs the owner.
- **G5. Which label?** Decision: reuse "Set up your vault" from `new-chat.ts`, so one place has one label.
