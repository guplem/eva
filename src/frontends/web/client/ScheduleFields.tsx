/**
 * The fields of a schedule. The Add schedule dialog shows them all in one column. The edit page
 * puts "when it runs" and "what it does" in two cards, with a large box for the prompt.
 */
import type { ReactElement } from "react";
import { weekDaysFrom, type ScheduleForm, type Unit } from "./schedule-form.ts";
import { displayFormat } from "./display-format.ts";
import { intervalUnits } from "./schedule-words.ts";
import { ChoiceChips } from "./SettingsParts.tsx";

interface FieldsProps {
  readonly form: ScheduleForm;
  readonly onChange: (form: ScheduleForm) => void;
}

/** The id, the name, and when the schedule runs. `isNew` is false on an edit: the id then cannot change. */
export function ScheduleWhenFields({ form, onChange, isNew }: FieldsProps & { readonly isNew: boolean }): ReactElement {
  const picked = form.days;
  const repeat = form.repeat;
  const field = (name: "id" | "name" | "at", label: string, placeholder: string, readOnly = false): ReactElement => (
    <label>
      {label}
      <input
        value={form[name]}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange({ ...form, [name]: event.target.value })}
      />
    </label>
  );
  return (
    <>
      {/* The state of a schedule is keyed by its id (lesson 65), so an edit keeps it. */}
      {isNew ? field("id", "Id (never change it later)", "morning") : field("id", "Id (it cannot change)", "", true)}
      {field("name", "Name", "Morning")}
      <ChoiceChips
        label="Repeat"
        value={repeat}
        choices={[
          { value: "days", label: "On days" },
          { value: "every", label: "At an interval" },
          { value: "once", label: "Once" },
        ]}
        onChange={(value) => onChange({ ...form, repeat: value })}
      />
      {repeat === "days" && (
        <>
          {field("at", "Time (HH:MM)", "07:30")}
          <fieldset>
            <legend>Days (none for every day)</legend>
            <div className="schedule-days">
              {weekDaysFrom(displayFormat().weekStart).map(([code, name]) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={picked.includes(code)}
                  onClick={() =>
                    onChange({
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
                onChange={(event) => onChange({ ...form, count: event.target.value })}
              />
            </label>
            <label>
              Unit
              <select value={form.unit} onChange={(event) => onChange({ ...form, unit: event.target.value as Unit })}>
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
              onChange={(event) => onChange({ ...form, from: event.target.value.slice(0, 16) })}
            />
          </label>
        </>
      )}
      {repeat === "once" && (
        <label>
          Date and time
          <input
            type="datetime-local"
            value={form.from}
            onChange={(event) => onChange({ ...form, from: event.target.value.slice(0, 16) })}
          />
        </label>
      )}
      {repeat !== "once" && (
        <label>
          Last day (empty for no end)
          <input
            type="date"
            value={form.until}
            onChange={(event) => onChange({ ...form, until: event.target.value })}
          />
        </label>
      )}
    </>
  );
}

/**
 * What a run does: a fixed text and a prompt for Eva. `large` gives the prompt room for a long text.
 * A text in the file may hold line breaks, and a one-line input would drop them.
 */
export function ScheduleWhatFields({ form, onChange, large }: FieldsProps & { readonly large: boolean }): ReactElement {
  return (
    <>
      <label>
        Fixed text
        <textarea
          rows={large ? 3 : 2}
          value={form.text}
          placeholder="Drink water."
          onChange={(event) => onChange({ ...form, text: event.target.value })}
        />
      </label>
      <label>
        Prompt for Eva
        <textarea
          className={large ? "schedule-prompt" : undefined}
          rows={large ? 18 : 3}
          value={form.prompt}
          placeholder="Summarise my calendar for today."
          onChange={(event) => onChange({ ...form, prompt: event.target.value })}
        />
      </label>
    </>
  );
}
