# Plan: a bare URL in a chat answer is a link (#583)

## Motivation

Eva works from a phone. A URL that the person cannot tap must be copied by hand, which is slow on a phone.

## Change

1. `src/frontends/markdown-inline.ts`: after code spans and Markdown links are held, hold each bare `http(s)://` URL and each `<http(s)://...>` autolink as an `<a>`.
2. `src/frontends/web/client/web-format.ts`: give each `<a>` that `toWebHtml` writes `target="_blank" rel="noreferrer"`.

## Gaps

- **Where the URL ends.** Decision: a URL runs to white space or `<`. Trailing `.,:;!?'"*_~` and an unmatched `)` stay outside, as GitHub does.
- **Telegram.** Telegram finds bare URLs itself. The same `<a>` in its HTML is harmless, and it keeps one inline rule for both front ends.
- **New tab.** Every other outside link in the web app uses `target="_blank" rel="noreferrer"`. Do the same in `toWebHtml`, not in `inlineHtml`: Telegram accepts only `href` on `<a>`.
