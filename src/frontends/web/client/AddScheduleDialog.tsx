/**
 * The "Add schedule" form, in a dialog on a computer and a bottom sheet on a phone. An edit has
 * its own page, `ScheduleEditPage`, with room for a long prompt.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { Schedule } from "../../../core/schedules/schedule-definitions.ts";
import { api } from "./api.ts";
import { emptyScheduleForm, entryOf } from "./schedule-form.ts";
import { ScheduleWhatFields, ScheduleWhenFields } from "./ScheduleFields.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { useBackLayer } from "./back-layer-hook.ts";
import { dialogBackdropClass } from "./Dialog.tsx";

const title = "Add schedule";

/** `now` is the instance's wall clock, so the first run that the form offers is in the instance's time zone. */
export function AddScheduleDialog(props: {
  now: string | null;
  onClose: () => void;
  onSaved: (saved: Schedule) => void;
}): ReactElement {
  const [opened] = useState(() => emptyScheduleForm(props.now));
  const [form, setForm] = useState(opened);
  const [error, setError] = useState<string | null>(null);
  const { onClose } = props;

  const save = async (): Promise<void> => {
    try {
      props.onSaved(await api.saveSchedule(entryOf(form)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  // A new schedule starts to run, so the question offers no save.
  const askFirst = useLeaveGuard(JSON.stringify(form) !== JSON.stringify(opened), null);

  useBackLayer(true, () => askFirst(onClose));
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") askFirst(onClose);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, askFirst]);

  return (
    // A tap beside the sheet does not close it, so a slip never loses a half-written schedule.
    <div className={dialogBackdropClass("schedule-backdrop")}>
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <form
          className="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ScheduleWhenFields form={form} onChange={setForm} isNew />
          <ScheduleWhatFields form={form} onChange={setForm} large={false} />
          {error !== null && (
            <div role="status" className="schedule-form-error">
              {error}
            </div>
          )}
          <div className="schedule-sheet-actions">
            <button type="submit" className="primary">
              Save schedule
            </button>
            <span className="spacer" />
            <button type="button" onClick={() => askFirst(onClose)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
