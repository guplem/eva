# Plan: a dedicated Schedules page (issue #39)

## Goal

Move the schedule list and the "Add schedule" form out of the Settings page.
Open them on their own page, from an icon button next to the "Schedules" title in the Assistant sidebar.

## Steps

1. Change the e2e test first (red): open the Schedules page from the sidebar icon button, then add and remove a schedule there. Check that Settings no longer shows the form.
2. Add a `schedules` screen to `App.tsx`. Give `AssistantView` an `onOpenSchedules` callback.
3. Add the icon button next to the sidebar "Schedules" title, with an accessible name.
4. Add `SchedulesView.tsx`: a page that holds `SchedulesPanel`, in the same layout as Settings.
5. Remove `SchedulesPanel` from `SettingsView.tsx`, and fix its header comment.
6. Fix the sidebar hint ("Add one in Settings") and `docs/guide/reference.md`.

## Gaps

- How the person returns from the page.
- Which icon to use, and its accessible name.
- Whether the page keeps the sidebar, or uses the Settings layout.
- Whether the page should also list the chats that schedules started.
- Whether a URL route is needed.

## Decisions

Three reviews found no rule in `AGENTS.md` or the docs for these gaps. They agreed on each answer from the existing patterns.

- **Return:** the topbar buttons, as for Settings. No view has a back button (`App.tsx`).
- **Icon:** "⏰", which already marks schedule chats. Its accessible name is "Open schedules", in the style of "☰" with "Show the list". A gear would suggest Settings.
- **Layout:** the Settings layout (`.main` and `.settings`). `SchedulesPanel` is already a fieldset for it.
- **Content:** only the schedules and the form. The sidebar already lists the chats that schedules started.
- **Route:** none. No screen has a URL.
- **Phone:** the button also closes the sidebar drawer, as "New chat" does.
