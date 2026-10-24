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

(Filled in step 3.)
