# Plan: offline, note conflict and error states (#179)

Make each problem clear on the phone: say what happened, show a fitting face, and give a button that fixes it.

## Motivation

Eva works from a phone. A problem that shows only in Settings, or with no way out, needs a terminal. The EVE guide (`docs/design/eve/README.md`, "When something goes wrong") shows the target.

## Decisions

- **Expired login:** UI only. The toast and the problem banner get an action button. Eva does not detect an expired engine login yet; that is a follow-up issue. (Owner's answer.)
- **Offline messages:** keep today's behavior. A failed send puts the text back in the box. The offline note says so. (Owner's answer.)
- **Retry time:** the socket tries again every 2 s. That is no real delay, so the banner shows no countdown. "Try now" opens the socket at once.
- **Problem actions:** `EvaStatus` gets `problemDetails`, each with its alert `key` and `level`. The page picks the button from the key, never from the text. `problems` stays, for the terminal client.
  - `vault_sync` with a conflict: "Pick a version" opens the note conflict dialog.
  - `schedule:` and `schedule_card:` keys: "Open schedules".
  - Every other key: "Open Settings".
- **Conflict versions:** each `VaultConflict` gets `mine` and `theirs`: the text of that version, or null when that side deleted the note or the version is not short text. Eva reads the blobs that git already names. The fields are new, so old readers ignore them.
- **Diff:** a small line diff in the client marks the lines that only one side has. Long notes show only the changed lines with some context.
- **Where things show:** the banners sit at the top of the main area of the Assistant and Project views, and above Settings and Schedules. The note conflict dialog opens from its banner button. Settings keeps the same cards.
- **Toast:** dark, at the bottom, with an icon, the message and an optional action. `showError` keeps its signature; a second function shows a toast with an action.

## Steps

1. Core: conflict texts in `VaultSync`, with tests.
2. Core: `problemDetails` in the status, with tests.
3. Client: line diff, with tests.
4. Client: the problem action map, with tests.
5. Client: toast, notice banner, offline state, conflict card and dialog, styles.
6. E2E: update the web UI spec where text changed.
