/** The schedules of `.eva/schedules.json`: list, remove, and "Add schedule". */
import { useEffect, useState, type ReactElement } from "react";
import { api, type ScheduleList } from "./api.ts";

const emptyForm = { id: "", name: "", at: "", days: "", text: "", prompt: "" };

export function SchedulesPanel(): ReactElement {
  const [list, setList] = useState<ScheduleList | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = (): void => {
    void api.schedules().then(setList, (error: unknown) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  };
  useEffect(reload, []);

  const add = async (): Promise<void> => {
    const days = form.days
      .split(",")
      .map((day) => day.trim())
      .filter((day) => day.length > 0);
    const entry: Record<string, unknown> = { id: form.id.trim(), name: form.name.trim(), at: form.at.trim() };
    if (days.length > 0) entry["days"] = days;
    if (form.text.trim() !== "") entry["text"] = form.text.trim();
    if (form.prompt.trim() !== "") entry["prompt"] = form.prompt.trim();
    try {
      await api.saveSchedule(entry);
      setForm(emptyForm);
      setNotice("Saved. Eva posts its setup card within a minute.");
      reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (scheduleId: string): Promise<void> => {
    await api.removeSchedule(scheduleId);
    reload();
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
    <fieldset>
      <legend>Schedules</legend>
      {list?.schedules.length === 0 && <div className="chip">No schedules yet.</div>}
      {list?.schedules.map(({ schedule, nextRun }) => (
        <div key={schedule.id} className="check-row">
          <span style={{ flex: 1 }}>
            {schedule.name} ({schedule.at}) · next: {nextRun?.replace("T", " ") ?? "never"}
          </span>
          <button aria-label={`Remove ${schedule.name}`} onClick={() => void remove(schedule.id)}>
            Remove
          </button>
        </div>
      ))}
      {list?.problems.map((problem) => (
        <div key={problem} className="failed">
          {problem}
        </div>
      ))}
      {field("id", "Id (never change it later)", "morning")}
      {field("name", "Name", "Morning")}
      {field("at", "Time (HH:MM)", "07:30")}
      {field("days", "Days (empty for every day)", "mon, tue, wed")}
      {field("text", "Fixed text", "Drink water.")}
      {field("prompt", "Prompt for Eva", "Summarise my calendar for today.")}
      {notice !== null && <div role="status">{notice}</div>}
      <div className="message-actions">
        <button onClick={() => void add()}>Add schedule</button>
      </div>
    </fieldset>
  );
}
