# Plan: a Copy button on each code block

Issue: #587.

## Motivation

The person reads code in chat answers, Markdown files and the rules card. On a phone, a long block that scrolls sideways is hard to select by hand. A button copies it in one tap. This serves the goal "Eva works from a phone".

## Design

1. `toWebHtml` wraps each fenced code block in `<div class="code-box">`. The button sits in this box, so it does not scroll with a long line.
2. A new shared `CopyButton` holds the copy logic of `CommandLine`: the icon, "Copy", then "Copied", and no button when the page has no clipboard. `CommandLine` uses it.
3. A new shared `MarkdownBody` component shows the HTML of `toWebHtml`. After each change of the HTML, it finds each `.code-box` and renders a `CopyButton` into it through a React portal. The button copies the text of the block's `code` element.
4. The chat answer, the Files page and the rules card use `MarkdownBody` in place of their own `div` with `dangerouslySetInnerHTML`.
5. The CSS rules for margins that name `pre` name `.code-box` too, so the space between blocks stays the same.

## Gaps

- **Where the button comes from.** An HTML string cannot hold a React icon. Decision: a portal from `MarkdownBody`, so the button reuses `Icon` and `CopyButton`.
- **Which views.** Decision: each view of `toWebHtml` output. A whole file shown as code, and tool output in the steps of a turn, are not Markdown code blocks: out of scope.
- **No clipboard.** Decision: no button, as `CommandLine` does.
- **Exact text.** Decision: the `textContent` of `code`. It is the unescaped code, with no fence and no language.
- **Streaming.** Each streamed token resets the HTML. Decision: the effect runs again and makes new portals. The "Copied" state of a block resets then. That is acceptable.
