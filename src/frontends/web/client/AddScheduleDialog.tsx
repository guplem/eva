/** The "Add schedule" form, in a dialog on a computer and a bottom sheet on a phone. */
import { useEffect, useState, type ReactElement } from "react";
import { api } from "./api.ts";

const emptyForm = { id: "", name: "", at: "", text: "", prompt: "" };

/** The day codes of `.eva/schedules.json`, from Monday, with the names that the buttons show. */
const days = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

export function AddScheduleDialog(props: { onClose: () => void; onSaved: () => void }): ReactElement {
  const [form, setForm] = useState(emptyForm);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (): Promise<void> => {
    const entry: Record<string, unknown> = { id: form.id.trim(), name: form.name.trim(), at: form.at.trim() };
    // No day picked means every day, as a schedule without days.
    if (picked.length > 0) entry["days"] = days.map(([code]) => code).filter((code) => picked.includes(code));
    if (form.text.trim() !== "") entry["text"] = form.text.trim();
    if (form.prompt.trim() !== "") entry["prompt"] = form.prompt.trim();
    try {
      await api.saveSchedule(entry);
      props.onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const field = (name: keyof typeof emptyForm, label: string, placeholder: string): ReactElement => (
    <label>
      {label}
      <input
        value={form[name]}
        placeholder={placeholder}
        onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      />
    </label>
  );

  return (
    <div
      className="dialog-backdrop schedule-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label="Add schedule">
        <h2>Add schedule</h2>
        <form
          className="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {field("id", "Id (never change it later)", "morning")}
          {field("name", "Name", "Morning")}
          {field("at", "Time (HH:MM)", "07:30")}
          <fieldset>
            <legend>Days (none for every day)</legend>
            <div className="schedule-days">
              {days.map(([code, name]) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={picked.includes(code)}
                  onClick={() =>
                    setPicked(picked.includes(code) ? picked.filter((day) => day !== code) : [...picked, code])
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          </fieldset>
          {field("text", "Fixed text", "Drink water.")}
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
          <p className="schedule-small">Eva asks you to confirm each new schedule before its first run.</p>
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
