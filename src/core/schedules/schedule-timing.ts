/**
 * When a schedule fires (lesson 68). All times are wall-clock times in the configured time
 * zone, because a server clock is often UTC. A slot is written `YYYY-MM-DDTHH:MM`. Two slots
 * with the same text are the same slot, so the hour that repeats when the clocks go back
 * fires once.
 */
import { intervalMinutes, type Schedule } from "./schedule-definitions.ts";

/** A restart within this time still fires a missed slot; an older miss is skipped. */
const graceMinutes = 60;
const minuteMs = 60_000;
const dayMinutes = 24 * 60;

/** The wall-clock slot of a moment in the time zone. */
export function wallClockOf(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** The slot this schedule must fire for now, or null when nothing is due. */
export function dueSlot(
  schedule: Schedule,
  state: { readonly firstSeen: string; readonly lastFired: string | null },
  now: string,
): string | null {
  const nowMinutes = minutesOf(now);
  const latest = latestRun(schedule, nowMinutes);
  if (latest === undefined || nowMinutes - latest >= graceMinutes) return null;
  const slot = slotText(latest);
  if (slot === state.lastFired) return null;
  // A schedule that never fired counts from when Eva first saw it, so a 07:30 schedule
  // written at 07:35 waits for the next day instead of firing at once.
  const since = minutesOf(state.lastFired ?? state.firstSeen);
  return latest > since ? slot : null;
}

/** The first slot after now, for the setup card. */
export function nextSlot(schedule: Schedule, now: string): string | null {
  const nowMinutes = minutesOf(now);
  const next = nextRun(schedule, nowMinutes);
  return next === undefined ? null : slotText(next);
}

/** The `HH:MM` of each run on the date of now, in time order, for the day line. */
export function runsOnDay(schedule: Schedule, now: string): string[] {
  const today = Math.floor(minutesOf(now) / dayMinutes) * dayMinutes;
  const runs: string[] = [];
  for (let run = nextRun(schedule, today - 1); run !== undefined && run < today + dayMinutes;) {
    runs.push(slotText(run).slice(11, 16));
    run = nextRun(schedule, run);
  }
  return runs;
}

/** The last run at or before now, in minutes. */
function latestRun(schedule: Schedule, nowMinutes: number): number | undefined {
  const interval = intervalOf(schedule);
  if (interval === null) return slotsAround(schedule, nowMinutes, -1).find((minutes) => minutes <= nowMinutes);
  if (nowMinutes < interval.from) return undefined;
  return interval.from + Math.floor((nowMinutes - interval.from) / interval.step) * interval.step;
}

/** The first run after now, in minutes. */
function nextRun(schedule: Schedule, nowMinutes: number): number | undefined {
  const interval = intervalOf(schedule);
  if (interval === null) return slotsAround(schedule, nowMinutes, 1).find((minutes) => minutes > nowMinutes);
  if (nowMinutes < interval.from) return interval.from;
  return interval.from + (Math.floor((nowMinutes - interval.from) / interval.step) + 1) * interval.step;
}

/**
 * The first run and the step of an interval schedule, in wall-clock minutes. So a daily run
 * keeps its time when the clocks change, and an hourly run moves by one hour once.
 */
function intervalOf(schedule: Schedule): { from: number; step: number } | null {
  if (schedule.every === null || schedule.from === null) return null;
  return { from: minutesOf(schedule.from), step: intervalMinutes(schedule.every) };
}

/** The schedule's slots on the eight days from today, going back (-1) or forward (1). */
function slotsAround(schedule: Schedule, nowMinutes: number, direction: 1 | -1): number[] {
  const [hours, minutes] = (schedule.at ?? "00:00").split(":").map(Number);
  const today = Math.floor(nowMinutes / dayMinutes) * dayMinutes;
  const slots: number[] = [];
  for (let offset = 0; offset < 8; offset += 1) {
    const day = today + direction * offset * dayMinutes;
    if (!(schedule.days ?? []).includes(new Date(day * minuteMs).getUTCDay())) continue;
    slots.push(day + (hours ?? 0) * 60 + (minutes ?? 0));
  }
  return slots;
}

/** Minutes since 1970 of a wall-clock slot, read as if it were UTC. Only differences matter. */
function minutesOf(slot: string): number {
  return Date.parse(`${slot}:00Z`) / minuteMs;
}

function slotText(minutes: number): string {
  return new Date(minutes * minuteMs).toISOString().slice(0, 16);
}
