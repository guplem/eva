/** The logic of the schedule form, apart from its markup: the values of a new or edited schedule. */
import type { Schedule } from "../../../core/schedules/schedule-definitions.ts";
import { intervalUnits, nextHourSlot } from "./schedule-words.ts";

export type Repeat = "days" | "every";
export type Unit = (typeof intervalUnits)[number][0];

/** The day codes of `.eva/schedules.json`, from Monday, with the names that the buttons show. */
export const weekDays = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

/** The day codes as `Date.getUTCDay` counts them, as the parsed schedule holds its days. */
const dayCodes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface ScheduleForm {
  readonly id: string;
  readonly name: string;
  readonly repeat: Repeat;
  readonly at: string;
  /** No day picked means every day. */
  readonly days: readonly string[];
  readonly count: string;
  readonly unit: Unit;
  readonly from: string;
  readonly text: string;
  readonly prompt: string;
}

/** `now` is the instance's wall clock, so the first run that the form offers is in the instance's time zone. */
export function emptyScheduleForm(now: string | null): ScheduleForm {
  return {
    id: "",
    name: "",
    repeat: "days",
    at: "",
    days: [],
    count: "1",
    unit: "d",
    from: now === null ? "" : nextHourSlot(now),
    text: "",
    prompt: "",
  };
}

/** `now` gives the first run that the form offers when the person switches a schedule on days to an interval. */
export function formOf(schedule: Schedule, now: string | null = null): ScheduleForm {
  const every = schedule.every ?? "";
  const unit = intervalUnits.find(([code]) => code === every.slice(-1))?.[0] ?? "d";
  const days = schedule.days ?? [];
  return {
    id: schedule.id,
    name: schedule.name,
    repeat: schedule.every === null ? "days" : "every",
    at: schedule.at ?? "",
    // Every day shows as no day picked, so a save keeps the entry without days.
    days:
      days.length === 7 ? [] : weekDays.map(([code]) => code).filter((code) => days.includes(dayCodes.indexOf(code))),
    count: every === "" ? "1" : every.slice(0, -1),
    unit,
    from: schedule.from ?? emptyScheduleForm(now).from,
    text: schedule.text ?? "",
    prompt: schedule.prompt ?? "",
  };
}

/** The entry of a new schedule. */
export function entryOf(form: ScheduleForm): Record<string, unknown> {
  return { id: form.id.trim(), ...fieldsOf(form) };
}

/**
 * The fields that the form owns, without the id. An edit sends only these, and the core keeps
 * every other key of the entry, such as `file`, `model` and `enabled`.
 */
export function fieldsOf(form: ScheduleForm): Record<string, unknown> {
  const fields: Record<string, unknown> = { name: form.name.trim() };
  if (form.repeat === "every") {
    fields["every"] = `${form.count.trim()}${form.unit}`;
    fields["from"] = form.from;
  } else {
    fields["at"] = form.at.trim();
    if (form.days.length > 0)
      fields["days"] = weekDays.map(([code]) => code).filter((code) => form.days.includes(code));
  }
  if (form.text.trim() !== "") fields["text"] = form.text.trim();
  if (form.prompt.trim() !== "") fields["prompt"] = form.prompt.trim();
  return fields;
}
