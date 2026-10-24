/**
 * Asks the person to save or discard the changes of a page before they leave it.
 * `leave-guard.ts` decides when it opens.
 */
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { Dialog } from "./ChatPanel.tsx";
import { answerLeave, isAskingToLeave, subscribeToLeave } from "./leave-guard.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

const ignore = (): void => undefined;
const stay = (): void => void answerLeave("stay");

export function UnsavedChangesDialog(): ReactElement | null {
  const asking = useSyncExternalStore(subscribeToLeave, isAskingToLeave);
  const [saving, setSaving] = useState(false);
  if (!asking) return null;

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
      <h2>Save your changes?</h2>
      <p>This page has changes that you did not save. Discarded changes are lost.</p>
      <div className="button-row">
        <button className="primary" disabled={saving} aria-busy={saving} onClick={() => void save()}>
          {saving && <ButtonSpinner />}
          Save and leave
        </button>
        <button className="danger" disabled={saving} onClick={() => void answerLeave("discard")}>
          Discard and leave
        </button>
      </div>
      {saving && <ProgressBar label="Eva saves your changes…" />}
    </Dialog>
  );
}
