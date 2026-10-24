/**
 * A name as a field, for a rename in a header: the title of a chat, or the name of a vault file.
 * Enter saves. Escape keeps the old name, after a question when the name changed.
 */
import { useState, type ReactElement } from "react";
import { useShowError } from "./error-toast.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";

export function RenameForm({
  label,
  original,
  draft,
  onDraft,
  onSave,
  onEnd,
}: {
  /** The label of the field, such as "Chat title". */
  readonly label: string;
  /** The name before the rename. */
  readonly original: string;
  readonly draft: string;
  readonly onDraft: (draft: string) => void;
  /** Saves the new name. A failure shows as an error, and the field stays open. */
  readonly onSave: (name: string) => Promise<void>;
  /** Closes the field, with the new name saved or not. */
  readonly onEnd: () => void;
}): ReactElement {
  // A second Enter while the request runs must not send it again.
  const [saving, setSaving] = useState(false);
  const showError = useShowError();

  /** True means that the name saved. */
  const save = async (name: string): Promise<boolean> => {
    setSaving(true);
    try {
      await onSave(name);
      onEnd();
      return true;
    } catch (caught) {
      showError(caught);
      return false;
    } finally {
      setSaving(false);
    }
  };
  // While the save runs, the guard waits: the rename moves to the new address.
  const askFirst = useLeaveGuard(!saving && draft.trim() !== "" && draft !== original, () => save(draft));

  return (
    <form
      className="rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) void save(draft);
      }}
    >
      <input
        aria-label={label}
        value={draft}
        autoFocus
        // Selected, so the person can type a new name at once.
        onFocus={(event) => event.target.select()}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") askFirst(onEnd);
        }}
      />
      <button className="primary" type="submit" disabled={saving || draft.trim() === ""}>
        Save
      </button>
      <button type="button" onClick={() => askFirst(onEnd)}>
        Cancel
      </button>
    </form>
  );
}
