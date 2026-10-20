# Plan: a chat says which setup step is missing (issue 214)

## Why

A new chat shows the greeting and the suggestions even when Eva cannot answer. A message then fails, and the person does not learn why. Only two steps stop a chat: `engine` and `vault`.

## Decisions

1. **The core names the blocking step.** `src/core/setup/progress.ts` gets a pure `chatBlocker(steps)`. It returns `"engine"`, `"vault"` or `null`, in step order. `EvaStatus` sends it as `chatBlocker`. One rule, in one home, for each front end. The field is new, so an older Eva sends nothing: the page reads a missing field as `null`.
2. **The page reads it with the status.** `App` keeps it beside `setupMissing` and passes it down to each `Conversation`.
3. **Unlock with no reload.** While a step blocks, `App` reads the status every 5 seconds, not every 60. It also reads it at each change of screen, so a login in Settings unlocks the chat at once.
4. **An empty chat shows the setup state** in place of the greeting: EVE asleep (a new `stateFaces.needsSetup`), one sentence, and a main button to `#/settings/setup/<step>`. A project chat shows it too.
5. **Every chat locks its composer** while a step blocks, also a chat with turns: a send would fail. One line under the box says why, with a link to the step.

## Gaps

None left open.
