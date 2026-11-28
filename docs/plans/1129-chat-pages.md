# Plan: a page inside a chat answer (#1129)

Eva writes one HTML file, such as a chart, and names it with a `[[show: <vault path>]]` line. The web app shows the file inside the answer bubble, in a safe frame, with a full-screen button. Telegram shows a link to the web chat.

## Decisions

The issue holds the person's decisions and the checked assumptions. These decisions fill the rest.

### Marker

- `[[show: <vault path>]]` on a line of its own, parsed by `extractFileMarkers` into a new `show` list. A marker inside a code fence stays text. A path named twice shows once.
- `shownAnswerText` hides a half-streamed `[[show:` line.
- A `[[show:]]` path gets no download button.

### Core

- `src/core/pages/chat-pages.ts` holds the pages of the chats.
  - `resolveShownPage(vaultPath, requested)` turns a marker path into the file to serve. It is the one place that #1130 changes to look in `.eva/pages/` first. It applies `resolveSendableFile`: inside the vault after `realpath`, so no `..` and no symbolic link point out, no clone, no `.git`, no encrypted file, no secret file, no file that holds a secret. It also needs the `.html` or `.htm` extension and 2 MB at most.
  - The answer is `ready`, or a note: `gone` (no file), `too-large`, or `refused` with the reason.
  - `ChatPages` gives a token for one page. A token maps to the requested path and the theme, never to file bytes. Each request resolves the path again, so a file that changes into a symbolic link after the token is refused.
- A token is 32 random bytes in base64url, as a widget token. It lives 5 minutes. At most 100 tokens live: a new token drops the oldest. The web app releases a token as soon as its frame loads, so a token lives only while a frame loads.
- `Eva.pages` is null with no vault, as `Eva.widgets`.

### Served path and policy

- The page is `/widgets/<token>/page.html`, and its theme is `/widgets/<token>/eva/theme.css`. Every other path is 404. Only `GET` and `HEAD` work. The path stays under `/widgets/`, so `framePolicy` of the web app needs no change.
- `widgetRoute` asks the pages first, then the widgets. A page token never reaches the widgets, and a widget token never reaches the pages.
- The refusal of `sec-fetch-dest: document` stays for both.
- A page answer carries no `access-control-allow-origin`: the frame loads its document and its style sheet with no CORS request.
- The sandbox of a page frame is exactly `allow-scripts` (`pageSandbox` in `src/shared/widget-sandbox.ts`). No `allow-same-origin`, no popups, no forms, no top navigation.
- The policy of a page answer is exactly:

  ```
  sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' <base>eva/theme.css; img-src data: blob:; media-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <origin>
  ```

  `<base>` is the token path, such as `http://127.0.0.1:7420/widgets/<token>/`. A source with a whole file path matches only that file.

- The policy of a widget stays exactly as it is. A test pins both, and the sandbox values.
- A frame that tries to move to another site stops at the web app's own `frame-src`, which allows only `/widgets/` and `blob:`.
- Some channels stay open, as for a widget: WebRTC and a DNS lookup of a link prefetch. The docs say so.

### API

- `POST /api/pages/frame` with `{ path, scheme, colors }` needs the login. It answers `{ state: "ready", src, token }` or `{ state: "gone" | "too-large" | "refused", reason }`. The colours pass `widgetTheme`, as for the widgets.
- `POST /api/pages/release` with `{ tokens }` ends tokens.

### Web app

- `PageFrame` (`client/PageFrame.tsx`) is the one frame component of a page. It takes the vault path and an optional `actions` slot for more corner buttons (#1130 adds Save and Pin there, and shows the same component in a column).
- It asks for a token when it comes into view (`IntersectionObserver`), then loads the frame. It releases the token at the frame's `load` event, at unmount, and on `pagehide`.
- A change of the theme or the system mode asks again, so the frame loads with the new colours.
- The frame takes the full width of the bubble and 320 px of height. While it waits, it shows a `ProgressBar`.
- The corner button opens full screen. Full screen is a new frame with its own token, inside a layer of the app with `useBackLayer`. The layer is the widget layer, moved to a shared `FullScreenFrame` component that the widget grid uses too.
- A page that Eva cannot show gives a short note in the bubble: "This page is gone. Eva deletes a page after 7 days.", "This page is larger than 2 MB, so Eva does not show it.", or the reason of the refusal.
- A live answer shows the frame when the turn ends, as the download buttons do.
- The Files page keeps showing an `.html` file as text.

### Telegram

- The answer text hides the marker and ends with one line. With a remote address: "This answer has a page. Open it in the web app: <url>/#/chat/<id>". With none: "This answer has a page. Open it in Eva's web app." This covers a live block, a late topic, a replayed history and a scheduled run.
- The bot never sends the `.html` file.

### Terminal

- No change. The terminal chat prints the answer raw, so the marker line shows the path, as for `[[attach:]]`. #1128 hides marker lines later.

### Prompt

- A short section of `assistant-base-prompt.md`, after "Sending files": when a page helps, where to write it (`.eva/scratch/<name>.html`), the box size, and the page rules of the issue. Project chats get no prompt, so they are not taught the marker.

### Demo and tests

- A scripted demo turn writes a small chart page that follows the prompt rules, and shows it. A second turn shows a network probe page, which tries `fetch`, a remote image, a remote script, a form, a popup, a nested frame and a worker, and writes each refusal.
- Unit tests: the parser, the resolver (escape, clone, symbolic link, secret, size, extension), the tokens (life, limit, release), the route (policy, sandbox, document refusal, methods, other paths), the widget policy unchanged, the API, Telegram lines.
- Browser tests: the frame in the bubble, full screen and Back, a script runs, and the blocked network.

### Docs

- `docs/guide/reference.md`: what a page is, how long it lasts, what it can reach.
- `docs/guide/how-eva-works.md`: the marker, the token, the policy, the open channels.
- `docs/widgets.md`: one line that a page is not a widget and has its own policy.

## Gaps

Each gap had an answer in the code or the issue. None needed the person.

- Token life and limit: the issue asks for a short life and a limit. The frame needs the token only while it loads, so 5 minutes and 100 tokens.
- Who may ask for a token: a logged-in page, for any vault path that passes the checks. A logged-in page already reads each such file on the Files page, so a token gives no new access.
- One frame view or two: the widget frame view answers asks and adds `?size=`. A page must never talk to Eva, so it gets its own small frame with a pinned sandbox. The full-screen layer is shared.
