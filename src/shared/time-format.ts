/**
 * How Eva shows a time of day and orders a week, from the person's `clock` and `weekStart`
 * settings (#770). Only text that a person or an agent reads follows them. Stored and compared
 * times, such as schedule slots, stay `HH:MM` on a 24-hour clock.
 */

export const clocks = ["24h", "12h"] as const;
export type Clock = (typeof clocks)[number];

/** The stored values of `weekStart`, in the order of `Date.getDay`. */
export const weekStarts = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type WeekStart = (typeof weekStarts)[number];

export const unitSystems = ["metric", "imperial"] as const;
export type Units = (typeof unitSystems)[number];

/** The clock and the week start that a screen follows. Null: not set, so the old form (24-hour, Monday). */
export interface DisplayFormat {
  readonly clock: Clock | null;
  readonly weekStart: WeekStart | null;
}

export const defaultDisplayFormat: DisplayFormat = { clock: null, weekStart: null };

export function isClock(value: unknown): value is Clock {
  return clocks.includes(value as Clock);
}

export function isWeekStart(value: unknown): value is WeekStart {
  return weekStarts.includes(value as WeekStart);
}

export function isUnits(value: unknown): value is Units {
  return unitSystems.includes(value as Units);
}

/** Such as `09:05`, or `9:05 AM` on a 12-hour clock. */
export function clockTime(hour: number, minute: number, clock: Clock | null): string {
  const minutes = String(minute).padStart(2, "0");
  if (clock !== "12h") return `${String(hour).padStart(2, "0")}:${minutes}`;
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${minutes} ${hour < 12 ? "AM" : "PM"}`;
}

/** A stored `HH:MM` text in the clock form. Any other text stays as it is. */
export function slotTime(time: string, clock: Clock | null): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return time;
  return clockTime(Number(match[1]), Number(match[2]), clock);
}

/** A whole hour for a scale, such as `06:00`, or `6 AM` on a 12-hour clock. */
export function hourLabel(hour: number, clock: Clock | null): string {
  if (clock !== "12h") return clockTime(hour, 0, clock);
  // The end of a day line is midnight again.
  return `${String(hour % 12 === 0 ? 12 : hour % 12)} ${hour % 24 < 12 ? "AM" : "PM"}`;
}

/** The time of a moment in a zone, such as `14:30` or `2:30 PM`. No zone: the zone of the machine or the browser. */
export function zonedClockTime(at: Date, timeZone: string | undefined, clock: Clock | null): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((each) => each.type === type)?.value);
  return clockTime(part("hour"), part("minute"), clock);
}

/** The day numbers of a week, as `Date.getDay` counts them, from the first day. Not set: Monday. */
export function weekOrder(weekStart: WeekStart | null): number[] {
  const first = weekStarts.indexOf(weekStart ?? "monday");
  return Array.from({ length: 7 }, (_, index) => (first + index) % 7);
}
