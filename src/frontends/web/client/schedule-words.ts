/**
 * The words and the day line of the Schedules page. Every time is a wall-clock slot
 * (`YYYY-MM-DDTHH:MM`) in the instance's time zone, so this code never reads the browser's clock or zone.
 */

const dayCodes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pluralDays = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The person reads a week from Monday. */
const weekOrder = [1, 2, 3, 4, 5, 6, 0];
const dayMs = 86_400_000;
const dayMinutes = 1440;
/** Runs closer than this share one pill: a pill holds about this much of the day on a phone. */
const sharedPillMinutes = 180;

/** When a schedule repeats, such as "Fridays at 18:30". `days` counts 0 as Sunday. */
export function repeatWords(at: string, days: readonly number[]): string {
  const ordered = weekOrder.filter((day) => days.includes(day));
  const key = ordered.join(",");
  if (ordered.length === 7) return `Every day at ${at}`;
  if (key === "1,2,3,4,5") return `Weekdays at ${at}`;
  if (key === "6,0") return `Weekends at ${at}`;
  const names = ordered.map((day) => (ordered.length > 2 ? shortDays[day] : pluralDays[day]) ?? "");
  return `${joinWords(names)} at ${at}`;
}

/** The next run, such as "Tomorrow 08:00". */
export function nextRunWords(nextRun: string | null, now: string): string {
  if (nextRun === null) return "Never";
  const days = daysBetween(now, nextRun);
  const time = nextRun.slice(11, 16);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${shortDays[weekdayOf(nextRun)] ?? ""} ${time}`;
  return `${dateWords(nextRun)} ${time}`;
}

/** A slot with its weekday and date, such as "Thu 23 Oct, 09:00", for a setup card. */
export function slotWords(slot: string | null): string {
  if (slot === null) return "Never";
  return `${shortDays[weekdayOf(slot)] ?? ""} ${dateWords(slot)}, ${slot.slice(11, 16)}`;
}

export type ResultTone = "ok" | "bad" | "idle";

/** The last result as a pill text and its colour. */
export function lastRunWords(
  lastRun: { readonly slot: string; readonly failed: boolean } | null,
  now: string,
): { text: string; tone: ResultTone } {
  if (lastRun === null) return { text: "Not run yet", tone: "idle" };
  const verb = lastRun.failed ? "Failed" : "Ran";
  const days = daysBetween(lastRun.slot, now);
  const when = days === 0 ? " today" : days === 1 ? " yesterday" : ` · ${dateWords(lastRun.slot)}`;
  return { text: verb + when, tone: lastRun.failed ? "bad" : "ok" };
}

/** The day numbers of a setup card's `days` field, such as "sun, mon". */
export function dayNumbersOf(text: string): number[] {
  return text
    .split(",")
    .map((code) => dayCodes.indexOf(code.trim()))
    .filter((day) => day !== -1);
}

export interface DayLineRun {
  /** The share of the day, from 0 to 1, where the pill starts. */
  readonly position: number;
  /** The share of the day up to the next pill, or to midnight: the pill must fit in it. */
  readonly width: number;
  readonly label: string;
  /** Every run that the pill holds, one per line. */
  readonly title: string;
}

/** Today's runs as pills on a 24-hour line, and where now is on it. */
export function dayLine(
  schedules: readonly { readonly name: string; readonly at: string; readonly days: readonly number[] }[],
  now: string,
): { now: number; runs: DayLineRun[] } {
  const today = weekdayOf(now);
  const runs = schedules
    .filter((schedule) => schedule.days.includes(today))
    .map((schedule) => ({ minutes: minutesOf(schedule.at), text: `${schedule.at} ${schedule.name}` }))
    .sort((first, second) => first.minutes - second.minutes);
  const groups: { minutes: number; texts: string[] }[] = [];
  for (const run of runs) {
    const last = groups.at(-1);
    if (last !== undefined && run.minutes - last.minutes < sharedPillMinutes) last.texts.push(run.text);
    else groups.push({ minutes: run.minutes, texts: [run.text] });
  }
  return {
    now: minutesOf(now.slice(11, 16)) / dayMinutes,
    runs: groups.map((group, index) => {
      const position = group.minutes / dayMinutes;
      const next = groups[index + 1];
      const more = group.texts.length - 1;
      return {
        position,
        width: (next === undefined ? 1 : next.minutes / dayMinutes) - position,
        label: (group.texts[0] ?? "") + (more > 0 ? ` +${String(more)}` : ""),
        title: group.texts.join("\n"),
      };
    }),
  };
}

function joinWords(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** Whole days from the date of one slot to the date of another. */
function daysBetween(from: string, to: string): number {
  return Math.round((dateOf(to) - dateOf(from)) / dayMs);
}

/** The date of a slot as UTC milliseconds. Only differences and the weekday matter. */
function dateOf(slot: string): number {
  return Date.parse(`${slot.slice(0, 10)}T00:00:00Z`);
}

function weekdayOf(slot: string): number {
  return new Date(dateOf(slot)).getUTCDay();
}

function dateWords(slot: string): string {
  return `${String(Number(slot.slice(8, 10)))} ${months[Number(slot.slice(5, 7)) - 1] ?? ""}`;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
