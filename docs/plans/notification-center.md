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

(Filled after the gap search.)
