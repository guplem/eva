# Plan: reply formatting (#37)

This file is the working plan of the PR. The last commit of the PR deletes it; the PR description keeps the decisions.

## Goal

A reply from the agent reads well on each front end. Line breaks show. Markdown, the native format of the model, is the source format.

## Diagnosis

- The web app renders each answer with `toTelegramHtml` (`src/frontends/web/client/Conversation.tsx`).
- `toTelegramHtml` writes a plain `\n` between lines, because Telegram shows `\n` as a line break.
- A browser collapses `\n` into a space. `.message.answer` has no `white-space: pre-wrap`. So in the web app, every line break and every blank line of a reply disappears.
- Telegram itself keeps the line breaks. It shows the HTML subset of `toTelegramHtml` as intended (lesson 58).
- The web app has full HTML, but the Telegram subset throws away headings, numbered lists and tables.

## Design

1. **A Markdown-to-HTML renderer for the web** (`toWebHtml`). It writes real block HTML: paragraphs, `<br>` for a single line break, headings, ordered and unordered lists with nesting, tables, block quotes, code blocks and rules. It escapes all text and adds only its own tags, so `dangerouslySetInnerHTML` stays safe.
2. **One inline converter for both front ends.** Code spans, links, bold, italic and strike are the same in Telegram HTML and web HTML. Move the inline logic into one module that both renderers use.
3. **The web app uses `toWebHtml`** for finished answers and for the streaming answer.
4. **CSS for the answer body:** paragraph and list spacing, tables, headings sized for a chat bubble.
5. **Telegram keeps `toTelegramHtml`.** No behavior change, except the shared inline module.

## Gaps

- G1: Own renderer, or a library such as `marked` plus a sanitizer?
- G2: Where does the shared Markdown code live, given the layer rules and the web bundle?
- G3: A single line break inside a paragraph: `<br>` (chat style) or a soft wrap (CommonMark)?
- G4: Does the issue screenshot show the web app or Telegram? Is there a Telegram fault too?

## Decisions

To be filled after the gap review.
