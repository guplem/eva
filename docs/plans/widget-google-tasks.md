# Plan: a widget reads Google Tasks (#1102)

## Why

The calendar widget shows events. The person also keeps tasks with a due day in Google Tasks. The widget needs them next to the events. #1030 lists Google Tasks as a feed behind a login that Eva holds.

## What changes

- Contract 4: `docs/widgets/manifest-v4.json` and `docs/widgets/meta-schema-v4.json`, copied from contract 3. The manifest adds the input type `eva-google-tasks`.
- `src/core/google/google-tasks.ts`: a `TasksSource` with `lists()` and `tasks(from, to)`, and `noTasks`. It uses Eva's Google login and the `tasks` service of Settings.
- `src/core/widgets/widget-google-tasks.ts`: the answers of `eva/google-tasks/lists.json` and `eva/google-tasks/tasks.json`.
- The approval and the preview grant get `googleTasks`. The grant change names "Read your Google Tasks."
- The install form names "Reads your Google Tasks".
- `docs/widgets.md`: the input, the paths, the section "The tasks", the mocks and contract 4.

## Gaps and decisions

1. **The days of the window.** Google's Tasks API keeps only the day of a due date: `due` is always midnight UTC of that day. So the due day is the date part of `due`, with no time zone. `dueMin` is the UTC midnight of `from`, and `dueMax` the UTC midnight of the day after `to`. Eva also filters each task by its day, so a bound that Google reads as inclusive adds nothing. This differs from the calendar, whose days are in the person's calendar time zone, because a task has no time.
2. **`access` values.** The manifest accepts `read` and `write`, as for the calendar, so a later write needs no new contract key. Eva serves only reads, and the docs say "Ask for `read`".
3. **The meta-schema.** Contract 4 keeps the data rules. `widget-contract.ts` checks every data schema with the newest meta-schema, v4. A test pins that v3 and v4 hold the same rules.
4. **Lists.** All of the person's task lists, in Google's order. Google Tasks has no "shown" check box as the calendar has.
5. **Order.** Due day, then the list order, then Google's `position` (a text that sorts in the order of the list), then the id. A subtask has its position under its parent. The order is stable.
6. **Hidden and deleted.** `showHidden=true` gives completed tasks that the person cleared from the list. They come, marked completed. `showDeleted` stays off, and Eva drops each task with `deleted: true`.
7. **`notes`.** Google keeps notes as plain text. Eva cuts them to 2000 characters, as the calendar description, and gives `null` for empty notes.
8. **`completed`.** `status === "completed"`. `completedAt` is Google's `completed` time, or `null`.
9. **Cache.** One minute, as the calendar, with the same cap.
10. **The widget template.** It stays on contract 3: it uses nothing of contract 4. The template moved to 3 only to show the asks.
11. **Mocks.** Eva serves no mock: the "Example data" preview answers `404`, and the widget reads `example/google-tasks/lists.json` and `example/google-tasks/tasks.json`. The docs list these files.
12. **Stored names.** `approvals[].googleTasks` and `previews[].googleTasks` go in `scripts/stored-names.txt` (`--write`).
