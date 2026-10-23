/**
 * The "Push" form of a clone card, in the sheet of the "Add schedule" form. Eva commits every
 * change with the note as its message, then pushes the branch. An empty note lets a model write
 * the message from the changes.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { CloneDetails } from "./api.ts";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { countOf } from "./project-format.ts";

interface PushCloneDialogProps {
  readonly clone: CloneDetails;
  readonly onClose: () => void;
  /** Runs the push. A failure comes back as a thrown error, and the sheet shows it. */
  readonly onPush: (note: string) => Promise<void>;
}

export function PushCloneDialog({ clone, onClose, onPush }: PushCloneDialogProps): ReactElement {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = clone.changes ?? 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const push = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onPush(note);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    // A tap beside the sheet does not close it, so a slip never loses a half-written note.
    <div className="dialog-backdrop schedule-backdrop">
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={`Push ${clone.name}`}>
        <h2>Push {clone.name}</h2>
        <p className="muted">
          {changes > 0
            ? `Eva commits ${countOf(changes, "change")} and pushes ${clone.branch ?? "the branch"}.`
            : `Eva pushes the commits of ${clone.branch ?? "the branch"}. There is no change to commit.`}
        </p>
        <form
          className="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void push();
          }}
        >
          {changes > 0 && (
            <label>
              Commit message
              <textarea
                rows={3}
                value={note}
                placeholder="Leave it empty, and Eva writes it from the changes."
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
          {busy && (
            <ProgressBar
              label={changes > 0 && note.trim() === "" ? "Eva writes the message and pushes." : "Eva pushes."}
            />
          )}
          {error !== null && (
            <div role="status" className="schedule-form-error">
              {error}
            </div>
          )}
          <div className="schedule-sheet-actions">
            <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
              {busy && <ButtonSpinner />}
              {busy ? "Pushing…" : changes > 0 ? "Commit and push" : "Push"}
            </button>
            <span className="spacer" />
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
