# Plan: chat details as an inspector and a bottom sheet (#172)

## Why

The chat details are a plain list today. The EVE design shows them as an inspector column on a computer and as a bottom sheet on a phone. A ring shows how full the context is. Each background task is a card with a status pill. This is part of the EVE redesign (#161).

## Scope

- `client/ChatPanel.tsx`: the inspector, the sheet, the task cards and the "Fork this chat" button.
- `client/chat-details.ts`: the figures of the ring and the token text.
- `chat-details.css`: a stylesheet of its own, as `visor.css` has. Other UI issues change `styles.css` at the same time, so a separate file keeps the merges small.
- The context window, from the engine to the session record. Without it, the ring never shows.

## Gaps and decisions

1. **The size of the context window.** Eva does not know it today. Claude Code reports `contextWindow` for each model in the `modelUsage` field of each result. Decision: read it for the main model of the turn, and store it in the turn record as `contextWindow`. Old records read it as `null`. pi does not report it in its turn events, so pi gives `null`, and the panel shows the count only. Eva never guesses a limit.
2. **Which model of `modelUsage`.** A result can list more than one model, such as a small model for a subagent. Decision: take the model that the `init` message names. When the list has no such model, take the only entry. Otherwise give `null`.
3. **Engine and model chips.** A chip shows when a value can change. An open chat keeps its engine and its model (lesson 41). Decision: show both as plain text.
4. **The time of a task.** Eva keeps no time for a task. Decision: show the description and the status pill only. A time needs a change to the live state, which other issues change now.
5. **The task icon.** Eva does not know the kind of a task. Decision: use the `sync` icon for each task.
6. **The status pill.** Decision: `running` is a live pill "Running", `done` is a green "OK", `failed` is a red "Failed", and a stored task (`ended`) is a grey "Ended".
7. **"Fork this chat".** Decision: fork the chat at its newest answer that has a message id and did not fail. Hide the button when no answer can fork. The panel gets an `onChanged` prop, so the list shows the new fork.
8. **The phone opener.** Decision: the existing "Chat info" button opens the sheet. The title stays as it is, because its pencil renames the chat and other issues change the header now.
9. **The sheet.** Decision: the sheet keeps `role="dialog"` with the name "This chat", and a Close button, for the keyboard and a screen reader. A tap on the scrim also closes it. The reference shows the title "This chat" twice; the sheet shows it once.
10. **Answers.** The reference shows "Full". Eva counts the answers, so the row keeps the count.
11. **The token text.** Decision: "76k of 200k tokens" with a known window, and "25.4k tokens" without one.
