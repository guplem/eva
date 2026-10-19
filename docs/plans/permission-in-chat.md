# Ask for permission inside the chat that needs it (issue 173)

## Motivation

Today one global dialog shows only the first pending approval, and it does not say which chat asks.
The person cannot tell which chat waits, and the dialog blocks the whole page.
The EVE design ("Eva asks for permission" in `docs/design/eve/reference.html`) puts the request in the chat that asks.

## Already done

- The chat list shows "Needs you" (`chatState` in `client/chat-list.ts`).
- The nav rail and the tab bar count the pending approvals (`MainNav`).

## Plan

1. `client/approvals.ts`: pure helpers, with unit tests.
   - The approvals of one chat tree.
   - The root chat of a session, so a link to a fork opens its chat.
   - The title of the card and the place it names (the clone, or the chat).
2. `client/ApprovalCard.tsx`: the card, with the firm visor beside it.
   - Amber border, a "Needs you" pill, the place, a title, the summary in monospace.
   - "Allow once" (primary) and "Deny" (danger).
3. `Conversation`: show every pending approval of a branch at the end of that branch.
4. On a phone, the cards of the open chat show as a bottom sheet over the chat, with full-width buttons.
5. `App`: remove the global dialog. Keep a notice for each approval of a chat that is not on screen. The notice names the chat and opens it.
6. `ProjectView`: show "Needs you" on a waiting chat of a clone.
7. Update the browser tests that used the "Approval" dialog.

## Gaps and decisions

- **"Allow in this chat".** Leave it out.
  Each turn starts a new engine process, so neither engine keeps an answer after the turn.
  Eva could remember it in the core, but in project mode that adds Eva's own behaviour to the harness: project mode must be a transparent wrapper.
  `ApprovalAnswer` is only "allow" or "deny", and Telegram and the terminal know no third answer.
- **The sentence on what the action changes.** Leave it out. `PendingApproval` has only the tool name and the summary, so Eva does not know it.
- **The title.** "Eva wants to run a command" for a shell tool (`Bash`), else "Eva wants to use {toolName}".
- **The place.** The clone name for a project chat, the chat title for an assistant chat.
- **Which chat is on screen.** The views tell `App` the session ids of the open chat, so `App` knows which approvals need the global notice.
- **The phone sheet.** It does not block the page: the person can still read the chat and use the tab bar.
