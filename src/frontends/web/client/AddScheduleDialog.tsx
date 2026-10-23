/**
 * The "Add schedule" form, in a dialog on a computer and a bottom sheet on a phone. With a
 * `schedule`, the same form edits that schedule.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { Schedule } from "../../../core/schedules/schedule-definitions.ts";
import { api } from "./api.ts";
import { emptyScheduleForm, entryOf, fieldsOf, formOf, weekDays, type Unit } from "./schedule-form.ts";
import { intervalUnits } from "./schedule-words.ts";
import { ChoiceChips } from "./SettingsParts.tsx";

/** `now` is the instance's wall clock, so the first run that the form offers is in the instance's time zone. */
export function AddScheduleDialog(props: {
  now: string | null;
  schedule?: Schedule;
  onClose: () => void;
  /** Gets the saved schedule: the file may have changed while the form was open. */
  onSaved: (saved: Schedule) => void;
}): ReactElement {
  const original = props.schedule ?? null;
  const [form, setForm] = useState(() =>
    original === null ? emptyScheduleForm(props.now) : formOf(original, props.now),
  );
  const [error, setError] = useState<string | null>(null);
  const { onClose } = props;
  const title = original === null ? "Add schedule" : "Edit schedule";
  const picked = form.days;
  const repeat = form.repeat;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (): Promise<void> => {
    try {
      props.onSaved(
        original === null ? await api.saveSchedule(entryOf(form)) : await api.editSchedule(original.id, fieldsOf(form)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const field = (name: "id" | "name" | "at", label: string, placeholder: string, readOnly = false): ReactElement => (
    <label>
      {label}
      <input
        value={form[name]}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      />
    </label>
  );

  return (
    // A tap beside the sheet does not close it, so a slip never loses a half-written schedule.
    <div className="dialog-backdrop schedule-backdrop">
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <form
          className="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* The state of a schedule is keyed by its id (lesson 65), so an edit keeps it. */}
          {original === null
            ? field("id", "Id (never change it later)", "morning")
            : field("id", "Id (it cannot change)", "", true)}
          {field("name", "Name", "Morning")}
          <ChoiceChips
            label="Repeat"
            value={repeat}
            choices={[
              { value: "days", label: "On days" },
              { value: "every", label: "At an interval" },
            ]}
            onChange={(value) => setForm({ ...form, repeat: value })}
          />
          {repeat === "days" && (
            <>
              {field("at", "Time (HH:MM)", "07:30")}
              <fieldset>
                <legend>Days (none for every day)</legend>
                <div className="schedule-days">
                  {weekDays.map(([code, name]) => (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={picked.includes(code)}
                      onClick={() =>
                        setForm({
                          ...form,
                          days: picked.includes(code) ? picked.filter((day) => day !== code) : [...picked, code],
                        })
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {repeat === "every" && (
            <>
              <div className="schedule-every">
                <label>
                  Every
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={999}
                    value={form.count}
                    onChange={(event) => setForm({ ...form, count: event.target.value })}
                  />
                </label>
                <label>
                  Unit
                  <select
                    value={form.unit}
                    onChange={(event) => setForm({ ...form, unit: event.target.value as Unit })}
                  >
                    {intervalUnits.map(([code, , plural]) => (
                      <option key={code} value={code}>
                        {plural}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                First run
                <input
                  type="datetime-local"
                  value={form.from}
                  onChange={(event) => setForm({ ...form, from: event.target.value.slice(0, 16) })}
                />
              </label>
            </>
          )}
          {/* A text in the file may hold line breaks, and a one-line input would drop them. */}
          <label>
            Fixed text
            <textarea
              rows={2}
              value={form.text}
              placeholder="Drink water."
              onChange={(event) => setForm({ ...form, text: event.target.value })}
            />
          </label>
          <label>
            Prompt for Eva
            <textarea
              rows={3}
              value={form.prompt}
              placeholder="Summarise my calendar for today."
              onChange={(event) => setForm({ ...form, prompt: event.target.value })}
            />
          </label>
          {error !== null && (
            <div role="status" className="schedule-form-error">
              {error}
            </div>
          )}
          <p className="schedule-small">
            {original === null
              ? "Eva asks you to confirm each new schedule before its first run."
              : "Eva asks you to confirm each change before the next run."}
          </p>
          <div className="schedule-sheet-actions">
            <button type="submit" className="primary">
              Save schedule
            </button>
            <span className="spacer" />
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
