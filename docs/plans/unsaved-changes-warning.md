# Plan: warn before a form loses its changes (#481)

## Motivation

On a phone, a tap on a tab by mistake drops the edits of a form. Eva works from a phone, so each form must keep the person's work or ask first.

## Done so far

- `leave-guard.ts` holds a guard for each form with a change. It asks on a link in the page, the main navigation, the back button, a reload and a closed tab.
- `UnsavedChangesDialog.tsx` offers "Save and leave", "Discard and leave" and "Stay".
- Covered: project details, and the settings forms with a Save button.

## Forms to check

| Form                          | File                       | Kind               |
| ----------------------------- | -------------------------- | ------------------ |
| New project                   | `NewProjectDialog.tsx`     | dialog, creates    |
| Add schedule                  | `AddScheduleDialog.tsx`    | dialog, creates    |
| Push note of a clone          | `PushCloneDialog.tsx`      | dialog, acts       |
| Question card of a new chat   | `NewChatGreeting.tsx`      | dialog, sends      |
| Trusted GitHub owners         | `TrustSection.tsx`         | field with Add     |
| Google login address          | `GooglePanel.tsx`          | field with Finish  |
| Vault setup                   | `VaultChooser.tsx`         | setup steps        |
| Chat rename                   | `ChatHeader.tsx`           | inline rename      |
| File rename                   | `RenameForm.tsx`           | inline rename      |
| Load again on project details | `ProjectDetailsEditor.tsx` | replaces the edits |

No warning: the composer keeps each unsent text, the Files editor keeps each draft, a search field holds no work, and a control that saves at each change has nothing unsaved.

## Gaps

1. **Dialogs.** Does a dialog with a form ask when the person closes it (Cancel, Escape, a tap on the scrim) with typed text? Does it ask when the person leaves the page under it? A "save" there creates or acts (a GitHub repository, a push), so can the question offer a save?
2. **Fields with an Add or Finish button.** Do they count as a form with unsaved changes?
3. **Vault setup.** Does each step of `VaultChooser.tsx` ask?
4. **Inline renames.** Do they ask, or does their own Escape and blur behavior suffice?
5. **Load again.** Does it ask before it replaces the edits?
6. **Close of a dialog.** Which component asks: the shared `Dialog`, each dialog, or the leave guard?

## Decisions

Three sub-agents (two mid-tier, one top-tier) researched all gaps. The owner answered gaps 1 and the save question.

1. **Dialogs.** The owner chose: Cancel and Escape ask when the form has typed text. A page move under the dialog asks too. A tap on the scrim already does nothing in these sheets. The question card of a new chat is the one exception: its Cancel keeps the answer for the next open, so only a page move asks.
2. **A save that creates or acts.** The owner chose: such a form offers only Discard and Stay. Nothing gets created, pushed or sent as a side effect of a tab tap. This covers New project, Add schedule (create), the push note, the question card, the Google login address and the vault setup. A plain save keeps "Save": the settings forms, project details, schedule edit, the trusted owners and the renames.
3. **Fields with Add or Finish.** Typed text not yet added counts, as `ProjectDetailsEditor.tsx` already says for its Add fields. Trusted owners save with Add. The Google address gets no save: Finish completes a login.
4. **Vault setup.** The new vault answers ask when they differ from their defaults. The typed repository address asks when not empty. Neither offers a save: both create or clone.
5. **Renames.** The issue asks for every form, so both renames ask, and Save renames. The cost is one line each.
6. **Load again.** It asks first, with the same dialog, about the details page only.
7. **Which component asks.** `leave-guard.ts` stays the one component. It grows two small parts:
   - A guard can have no save. The question then hides "Save".
   - A form can ask about its own guard only, for a dialog close or Load again. A page move asks about every guard.
8. **Wording.** The question names the move: leave, close or load again.
9. **Risks found.**
   - Discard must not drop a guard that stays mounted. The guards stay held while the allowed move runs, and each form releases its own guard when it closes or saves.
   - Escape must close only the top dialog. The shared `Dialog` stops the Escape key after it handles it, so the sheet under it does not close too.
10. **Not in scope.** Moving the hand-made sheets onto the shared `Dialog` is a separate refactor.

## Review round 1

Five sub-agents reviewed the work. Fixed:

- Stay after a link or the back button no longer adds or drops a history entry. Each entry keeps its place in its state, so the watch steps back to the page.
- A second move while the question is open is dropped. A link to a card on the same Settings page asks nothing.
- Stay gives the focus back to the field.
- A save that trims or parses no longer leaves a question behind: commit identity, pi model, sync interval, project folders.
- New guards: project folders, the Claude login code. The chat rename waits while its save runs. The question card keeps its guard after Cancel.
- The Settings search and the vault setup chips hide a form instead of closing it, so its typed values stay.

Rejected:

- Shorten the subject of commit `81d995c` (74 characters): it is pushed, and a rewrite needs a force-push. The commit check passes it.
- Add a line to `docs/guide/`: optional, and nothing there is false.
- Set `returnValue` on `beforeunload` for old browsers: the lint forbids the deprecated API, and current browsers need only `preventDefault`.
