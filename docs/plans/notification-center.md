# Plan: notification center behind the visor (#566)

## Goal

A tap on the visor opens one page. The page lists the open problems under "Needs you", each with its fix button, and a 30-day history of what Eva told the person. The large problem notices at the top of each page go away.

## Shape

- **Core.** A notification history in the machine's state folder. `AlertCenter` adds an entry for each alert it emits, except a 24-hour repeat. Each open problem gets a `since` time.
- **API.** One read of the history and the open problems. One write that marks entries as read.
- **Web.** A `Notifications` page at `#/notifications`. The visor opens it. The visor shows a count and the B4 animation. On a phone, the visor replaces Settings in the tab bar. `ProblemNotices` keeps only the offline notice.

## Gaps

1. **History file.** Name, format, entry id, what to record, the 30-day prune, a size cap, and where the read marks live.
2. **Time of an open problem.** Where `since` comes from, and how it survives a restart.
3. **API shape.** Endpoints, names and how an old Eva answers.
4. **Mark as read on a problem.** Reuse `hide`, and how the page sends it.
5. **Navigation.** Is "notifications" a `Destination`? How the phone tab bar puts the visor last, and how the rail keeps Settings.
6. **Setup steps in "Needs you".** Where the page gets them, and how they count on the visor.
7. **The B4 animation.** Where it lives: a face, a class on `Visor`, or `MainNav`.
8. **The tray icon.** How it counts read problems.
9. **End-to-end tests.** The tests that use the "Problems" region move to the center.

## Decisions

Three sub-agents searched the code. The precedent is the hide work of #541 (`hidden-problems.ts`).

1. **History file.** `src/core/alerts/notification-history.ts`, a copy of the `hidden-problems.ts` pattern: tolerant read, atomic write, a bad entry is skipped. The path is `paths.notificationHistory`, `notification-history.json` in the state folder. The file is `{ "version": 1, "nextSeq", "entries" }`. An entry is `{ seq, key, level, message, at, read }`. `seq` grows across restarts and is the id. Order by `seq`, never by `at` (lesson 83). `AlertCenter` takes `history` and `onHistoryChange` options, as it takes `hidden` and `onHiddenChange`: it does no file work. It records inside `emit`, never as a listener, so a satellite records too and a failure is not swallowed. It records a problem start, a rise in level, `resolved` and `news`. It does not record a 24-hour repeat of the same level. Each write drops entries older than 30 days and keeps the newest 500.
2. **`since`.** `OpenProblem` gets `since`. A new key takes now. A later report keeps it. After a restart, `since` comes from the newest warn or error entry of that key in the history. `problemDetails()` sends it.
3. **API.** `GET /api/notifications` returns `{ entries }`. `POST /api/notifications/read` takes `{ seqs }` or `{ all: true }` and returns the same shape. Zod schemas, as `problemKeySchema`. The page treats a 404 or a missing field as an empty history (an older Eva).
4. **Read on a problem.** It calls the existing `hide` and its optimistic flow in `App.tsx`. `hide` also marks the history entries of that key as read. "Mark all as read" hides every open problem and marks every entry.
5. **Navigation.** `notifications` joins `destinations` with a flag that keeps it out of the button list. The visor opens it, with `aria-current`. The tap face goes away (`tapFace`). On a phone, CSS shows the visor as the last tab with the label "Eva" and hides the Settings tab. The rail keeps Settings at its foot. The center page has a Settings button.
6. **Setup steps.** The page reads `api.setupState()` and lists each `missing` step in "Needs you", with a button to Settings. The visor number counts unread problems only. Setup steps that are left, and unread history entries, show a small dot on the visor. The face does not change for them (`nav-visor.ts` comment). The Settings badge in the rail stays.
7. **B4.** A modifier class on `Visor`, such as `alarm`, set while an unread error is open and the center is not the open page. CSS in `visor.css`: the crosses take `--bad` and the glow pulses. `prefers-reduced-motion` turns it off. No new face.
8. **Tray.** It counts the problems that are not hidden, from `problemDetails`, with a fallback to `problems` for an older Eva.
9. **End-to-end tests.** The tests on the "Problems" region move to the center page. The "Needs you" section keeps the accessible name "Problems". The offline notice test stays. The Settings helper on a phone opens the center first. The Status card term "Problems" stays.

The person did not decide the dot for news and setup steps. It follows the issue's assumption 2.
