/**
 * Asks the person to save or discard their changes before they lose them. `leave-guard.ts`
 * decides when it opens. `useLeaveGuard` lets a form hold a guard.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { Dialog } from "./Dialog.tsx";
import {
  answerLeave,
  holdLeave,
  leaveQuestion,
  subscribeToLeave,
  type LeaveHold,
  type LeaveMove,
} from "./leave-guard.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

const ignore = (): void => undefined;

export function UnsavedChangesDialog(): ReactElement | null {
  const question = useSyncExternalStore(subscribeToLeave, leaveQuestion);
  const [saving, setSaving] = useState(false);
  // Read before the dialog moves the focus to Stay, so Stay gives it back to the field.
  const opener = useRef<Element | null>(null);
  if (question === null) opener.current = null;
  else opener.current ??= document.activeElement;
  // A stable function: the dialog focuses Stay each time its onClose changes.
  const stay = useCallback((): void => {
    const field = opener.current;
    void answerLeave("stay");
    if (field instanceof HTMLElement) field.focus();
  }, []);
  if (question === null) return null;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await answerLeave("save");
    } finally {
      setSaving(false);
    }
  };

  return (
    // While the save runs, Escape and Stay do nothing: the dialog closes when it ends.
    <Dialog label="Unsaved changes" onClose={saving ? ignore : stay} closeLabel="Stay">
      <h2>{question.canSave ? "Save your changes?" : "Discard your changes?"}</h2>
      <p>You have changes that you did not save. Discarded changes are lost.</p>
      <div className="button-row">
        {question.canSave && (
          <button className="primary" disabled={saving} aria-busy={saving} onClick={() => void save()}>
            {saving && <ButtonSpinner />}
            Save and {question.move}
          </button>
        )}
        <button className="danger" disabled={saving} onClick={() => void answerLeave("discard")}>
          Discard and {question.move}
        </button>
      </div>
      {saving && <ProgressBar label="Eva saves your changes…" />}
    </Dialog>
  );
}

/**
 * Holds a guard while `unsaved` is true. The latest `save` runs, so it sees the latest values.
 * A null `save` offers no save, for a form whose save would create or act.
 * Gives a function that asks about this form only, such as before its dialog closes.
 */
export function useLeaveGuard(
  unsaved: boolean,
  save: (() => Promise<boolean>) | null,
): (move: () => void, name?: LeaveMove) => void {
  const latest = useRef(save);
  latest.current = save;
  const held = useRef<LeaveHold | null>(null);
  const canSave = save !== null;
  useEffect(() => {
    if (!unsaved) return undefined;
    const hold = holdLeave(canSave ? () => latest.current?.() ?? Promise.resolve(false) : null);
    held.current = hold;
    return () => {
      hold.release();
      held.current = null;
    };
  }, [unsaved, canSave]);
  return useCallback((move, name = "close") => {
    if (held.current === null) move();
    else held.current.ask(move, name);
  }, []);
}
