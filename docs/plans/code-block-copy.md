# Plan: a Copy button on each code block

Issue: #587.

## Motivation

The person reads code in chat answers, Markdown files and the rules card. On a phone, a long block that scrolls sideways is hard to select by hand. A button copies it in one tap. This serves the goal "Eva works from a phone".

## Design

1. `toWebHtml` wraps each fenced code block in `<div class="code-box">`, with an empty `<div class="code-box-bar">` above the `pre`. The button goes in the bar, so it never covers the code, in scroll mode and in wrap mode.
2. The private `CopyButton` and `copyText` of `Conversation.tsx` move to a shared `CopyButton.tsx`. It shows the icon and "Copy", then a check and "Copied" for 2 seconds, and a toast when the copy fails. On a plain `http` page it copies through a hidden text box. `CommandLine` uses it too.
3. A new shared `MarkdownBody` component shows the HTML of `toWebHtml`. In a layout effect after each new HTML string, it finds each `.code-box-bar` and renders a `CopyButton` into it through a React portal. The button copies the `textContent` of the block's `code` element.
4. The chat answer, the Files page and both blocks of the rules card use `MarkdownBody`.
5. The margin rules that name `pre` name `.code-box` in its place. The inner `pre` has no margin.

## Decisions

- **Where the button comes from.** An HTML string cannot hold a React icon. A portal reuses `Icon` and `CopyButton`. Plain HTML buttons would need a second copy of the icon or `react-dom/server` in the bundle. Source: all three sub-agents.
- **When the portals run.** In `useLayoutEffect`, so the buttons show in the first paint, with no flicker. React sets the HTML again only when the string changes, so a clock tick keeps the buttons.
- **Which views.** Each view of `toWebHtml` output: the chat answer, a Markdown file, the person's rules and the built-in rules. A whole file shown as code, and tool output in the steps of a turn, are not Markdown code blocks: out of scope.
- **A live answer.** It gets no buttons. Each token replaces every block, so a tap can miss, or copy half a block. The button shows when the turn ends.
- **No clipboard.** The button still shows and copies through a hidden text box, as the answer's Copy button does. A phone often opens Eva over plain `http` through Tailscale. Source: `copyText` in `Conversation.tsx`.
- **Name for a screen reader.** "Copy the code". The whole code would be too long. Source: `CheckRow` in `SettingsParts.tsx`.
- **Exact text.** The `textContent` of `code`. It is the unescaped code, with no fence and no language.
- **Captures.** No EVE guide page or demo shows a fenced code block, so no guide capture changes.
- **Tests.** Unit tests for the HTML of `toWebHtml`. The repository has no DOM in unit tests, so an e2e test covers the button.
