/**
 * The edit page of one schedule, as the Details page of a project: when it runs in one card, and
 * what it does in another, with a large box for the prompt (#891). A save goes back to the page
 * of the schedule.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Schedule } from "../../../core/schedules/schedule-definitions.ts";
import { api } from "./api.ts";
import { fieldsOf, formOf } from "./schedule-form.ts";
import { ScheduleWhatFields, ScheduleWhenFields } from "./ScheduleFields.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { BackButton } from "./MainNav.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { Card } from "./SettingsParts.tsx";

export function ScheduleEditPage(props: {
  /** The schedule as the page opened it. A later reload of the list does not reset the form. */
  readonly schedule: Schedule;
  /** The instance's wall clock, so a new first run is in the instance's time zone. */
  readonly now: string;
  readonly onBack: () => void;
  /**
   * Gets the saved schedule: the file may have changed while the page was open. `leave` is true
   * after the Save button. A save from the unsaved changes question makes the person's own move.
   */
  readonly onSaved: (saved: Schedule, leave: boolean) => void;
}): ReactElement {
  const { schedule, onSaved } = props;
  const [opened] = useState(() => formOf(schedule, props.now));
  const [form, setForm] = useState(opened);
  const [error, setError] = useState<string | null>(null);
  /** The schedule that the Save button saved. The page leaves only after the guard lets go, or the guard would ask. */
  const [saved, setSaved] = useState<Schedule | null>(null);
  // The parent passes a new function at each render: each save must be reported once.
  const report = useRef(onSaved);
  report.current = onSaved;

  const save = async (leave: boolean): Promise<boolean> => {
    setError(null);
    try {
      const result = await api.editSchedule(schedule.id, fieldsOf(form));
      // The unsaved changes question makes the person's own move, and the page may go before an effect runs.
      if (leave) setSaved(result);
      else report.current(result, false);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  };
  useLeaveGuard(saved === null && JSON.stringify(form) !== JSON.stringify(opened), () => save(false));

  useEffect(() => {
    if (saved !== null) report.current(saved, true);
  }, [saved]);

  return (
    <>
      <div className="main-header">
        <BackButton label={`Back to ${schedule.name}`} onClick={props.onBack} />
        <h1>{schedule.name} · Edit</h1>
      </div>
      {/* Enter in a field must not send the form: only the Save button saves. */}
      <form className="settings-page schedule-edit" onSubmit={(event) => event.preventDefault()}>
        {error !== null && (
          <div className="callout danger" role="alert">
            {error}
          </div>
        )}
        <Card icon="clock" title="When it runs">
          <div className="schedule-form">
            <ScheduleWhenFields form={form} onChange={setForm} isNew={false} />
          </div>
        </Card>
        <Card icon="pen" title="What it does" description="A fixed text, a prompt for Eva in a new chat, or both.">
          <div className="schedule-form">
            <ScheduleWhatFields form={form} onChange={setForm} large />
          </div>
        </Card>
        <div className="button-row">
          <SaveButton type="button" className="primary" onSave={() => save(true)}>
            Save schedule
          </SaveButton>
          <button type="button" onClick={props.onBack}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
