/**
 * The parts of the Projects home page that need no page: the colour of each project, the counts by
 * status, the timeline and the chats that the page lists (#840).
 */
import type { ProjectStatus } from "../../../shared/project-statuses.ts";
import type { Project, SessionRecord } from "./api.ts";
import { months, type ChatState } from "./chat-list.ts";
import { countOf, inUseLabel, statusLabels } from "./project-format.ts";

/** The EVE file type colours. Each has a light and a dark value, so a project colour reads in both themes. */
const projectColors = ["red", "orange", "yellow", "green", "teal", "blue", "violet", "pink"] as const;

/** FNV-1a: a short, stable hash, so a name keeps its colour on every machine. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The colour of a project, from its folder slug. The slug does not change when the person renames
 * the title, so the colour stays.
 */
export function projectColor(slug: string): string {
  return `var(--type-${projectColors[hashOf(slug) % projectColors.length] ?? "blue"})`;
}

/** "EA" for "example-app": the mark of a chat's project in a list. */
export function projectInitials(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
  return initials === "" ? "?" : initials;
}

/** The local time of the project id. A short id starts at the start of its month or year. */
export function createdAt(project: Pick<Project, "parsedId">): Date {
  const { year, month = 1, day = 1, hour = 0, minute = 0 } = project.parsedId.created;
  return new Date(year, month - 1, day, hour, minute);
}

/** Each year with a project, and this year, the newest first: the year choices of the range picker. */
export function projectYears(projects: readonly Pick<Project, "parsedId">[], now: Date): number[] {
  const years = new Set([now.getFullYear(), ...projects.map((project) => project.parsedId.created.year)]);
  return [...years].sort((first, second) => second - first);
}

/**
 * The time range of the statistics (#878): the last months up to today, a whole year, all the
 * years, or two days that the person picks, as `YYYY-MM-DD`.
 */
export type RangeChoice =
  | { readonly kind: "last"; readonly months: number }
  | { readonly kind: "year"; readonly year: number }
  | { readonly kind: "all" }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

/** The last 12 months: about the last 365 days. */
export const defaultRange: RangeChoice = { kind: "last", months: 12 };

/** The quick ranges, from one month to three years back. */
const lastMonths = [1, 3, 6, 12, 36] as const;

/** A span of local time. `to` is the first moment after the range. */
export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/** The local start of a day such as `2026-11-03`, or null for a text that is not a real day. */
export function dayOf(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

/** `2026-11-03`: the form of a date input. */
export function dayText(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The same day some months before, or the last day of a shorter month: 31 Mar goes back to 28 Feb. */
function monthsBefore(date: Date, count: number): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() - count + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() - count, Math.min(date.getDate(), lastDay));
}

/** The span of a range choice. A custom range with a bad day reads as the default range. */
export function rangeOf(choice: RangeChoice, projects: readonly Pick<Project, "parsedId">[], now: Date): DateRange {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  switch (choice.kind) {
    case "last":
      return { from: monthsBefore(now, choice.months), to: tomorrow };
    case "year":
      return { from: new Date(choice.year, 0, 1), to: new Date(choice.year + 1, 0, 1) };
    case "all": {
      // Every status counts here: the chart shows the closed projects too.
      const first = Math.min(now.getFullYear(), ...projects.map((project) => project.parsedId.created.year));
      return { from: new Date(first, 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) };
    }
    case "custom": {
      const [from, to] = [dayOf(choice.from), dayOf(choice.to)];
      if (from === null || to === null) return rangeOf(defaultRange, projects, now);
      const [first, last] = from <= to ? [from, to] : [to, from];
      return { from: first, to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) };
    }
  }
}

/** "3 Nov 2026". */
function dayWords(date: Date): string {
  return `${String(date.getDate())} ${months[date.getMonth()] ?? ""} ${String(date.getFullYear())}`;
}

/** The words before the started count, such as "In the last 12 months". */
export function rangeWords(choice: RangeChoice): string {
  switch (choice.kind) {
    case "last":
      if (choice.months === 1) return "In the last month";
      return choice.months % 12 === 0 && choice.months > 12
        ? `In the last ${String(choice.months / 12)} years`
        : `In the last ${String(choice.months)} months`;
    case "year":
      return `In ${String(choice.year)}`;
    case "all":
      return "In all";
    case "custom": {
      const [from, to] = [dayOf(choice.from), dayOf(choice.to)];
      if (from === null || to === null) return rangeWords(defaultRange);
      const [first, last] = from <= to ? [from, to] : [to, from];
      return `From ${dayWords(first)} to ${dayWords(last)}`;
    }
  }
}

/** The value of a choice in the range picker, such as `last-12` or `year-2025`. */
export function rangeChoiceValue(choice: RangeChoice): string {
  switch (choice.kind) {
    case "last":
      return `last-${String(choice.months)}`;
    case "year":
      return `year-${String(choice.year)}`;
    case "all":
      return "all";
    case "custom":
      return "custom";
  }
}

/**
 * The choice of a picker value. A new custom range starts as the last month, so the person
 * moves one of its two days.
 */
export function rangeChoiceOf(value: string, now: Date): RangeChoice {
  const [kind, number] = value.split("-");
  if (kind === "last" && number !== undefined) return { kind: "last", months: Number(number) };
  if (kind === "year" && number !== undefined) return { kind: "year", year: Number(number) };
  if (kind === "all") return { kind: "all" };
  if (kind === "custom") {
    return { kind: "custom", from: dayText(monthsBefore(now, 1)), to: dayText(now) };
  }
  return defaultRange;
}

/** The choices of the range picker: the quick ranges, each year, all, and a custom range. */
export function rangeChoices(
  projects: readonly Pick<Project, "parsedId">[],
  now: Date,
): { readonly value: string; readonly label: string }[] {
  const last = lastMonths.map((count) => ({
    value: rangeChoiceValue({ kind: "last", months: count }),
    label: rangeWords({ kind: "last", months: count }).replace("In the last", "Last"),
  }));
  const years = projectYears(projects, now).map((year) => ({ value: `year-${String(year)}`, label: String(year) }));
  return [...last, ...years, { value: "all", label: "All" }, { value: "custom", label: "Custom range" }];
}

/**
 * The counts of the home page: the active and the paused projects, and the projects in use, whatever
 * their status (#859). A closed project and a project with no status count only in `started`.
 */
export interface StatusCounts {
  readonly active: number;
  readonly "in-use": number;
  readonly paused: number;
  readonly started: number;
}

/** How many projects of each status started in the range, and how many of them the person uses. */
export function statusCounts(
  projects: readonly Pick<Project, "parsedId" | "frontMatter">[],
  range: DateRange,
): StatusCounts {
  const started = projects.filter((project) => {
    const created = createdAt(project);
    return created >= range.from && created < range.to;
  });
  const count = (matches: (frontMatter: Project["frontMatter"]) => boolean): number =>
    started.filter((project) => matches(project.frontMatter)).length;
  return {
    active: count((frontMatter) => frontMatter.status === "active"),
    "in-use": count((frontMatter) => frontMatter.inUse),
    paused: count((frontMatter) => frontMatter.status === "paused"),
    started: started.length,
  };
}

export interface TimelineRow {
  readonly project: Project;
  readonly title: string;
  /** The work on the project: the pattern of its bar. */
  readonly status: ProjectStatus | null;
  /** True when the person uses the project: its bar has a ring, and its name a mark (#859). */
  readonly inUse: boolean;
  /** Where the bar starts and ends, as a share of the timeline width, from 0 to 1. */
  readonly start: number;
  readonly end: number;
  /** True when the project started before the timeline: its bar starts at the edge. */
  readonly startsBefore: boolean;
  /** When the project started, also before the timeline: its tooltip gives the dates (#893). */
  readonly created: Date;
  /** The closing day of a closed project, or null for an open one. */
  readonly closedOn: Date | null;
}

/** A mark on the time axis, as a share of the width. */
export interface RangeMark {
  readonly label: string;
  readonly at: number;
}

export interface Timeline {
  readonly rows: readonly TimelineRow[];
  readonly marks: readonly RangeMark[];
  /** Where today is, or null when today is outside the timeline. */
  readonly today: number | null;
}

const dayLength = 24 * 60 * 60 * 1000;

/** At most this many month marks: a longer range marks every second month, or each year. */
const monthMarks = 12;

/**
 * The marks of the time axis: each week of a range up to two months, the months of a range up to
 * two years, and else each year. In a range of more than one year, January shows its year.
 */
/** A mark closer to the right edge has no room for its label. */
const lastMarkAt = 0.95;

export function rangeMarks(range: DateRange): RangeMark[] {
  return allMarks(range).filter((mark) => mark.at <= lastMarkAt);
}

function allMarks(range: DateRange): RangeMark[] {
  const from = range.from.getTime();
  const to = range.to.getTime();
  const shareOf = (date: Date): number => (date.getTime() - from) / (to - from);
  if (to - from <= 62 * dayLength) {
    const weeks: RangeMark[] = [];
    const start = range.from;
    // The calendar adds the days, so a clock change does not move a mark off midnight.
    for (
      let day = startOfDay(start);
      day.getTime() < to;
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7)
    ) {
      weeks.push({ label: `${String(day.getDate())} ${months[day.getMonth()] ?? ""}`, at: shareOf(day) });
    }
    return weeks;
  }
  const firstMonth = new Date(
    range.from.getFullYear(),
    range.from.getMonth() + (range.from.getDate() === 1 ? 0 : 1),
    1,
  );
  const monthStarts: Date[] = [];
  for (let date = firstMonth; date.getTime() < to; date = new Date(date.getFullYear(), date.getMonth() + 1, 1)) {
    monthStarts.push(date);
  }
  if (monthStarts.length > monthMarks * 2) {
    return monthStarts
      .filter((date) => date.getMonth() === 0)
      .map((date) => ({ label: String(date.getFullYear()), at: shareOf(date) }));
  }
  const manyYears = range.from.getFullYear() !== new Date(to - 1).getFullYear();
  const step = Math.ceil(monthStarts.length / monthMarks);
  return monthStarts
    .filter((_, index) => index % step === 0)
    .map((date) => ({
      label: manyYears && date.getMonth() === 0 ? String(date.getFullYear()) : (months[date.getMonth()] ?? ""),
      at: shareOf(date),
    }));
}

/** The statuses that the timeline shows when the page opens: the work of now (#881). */
export const timelineStatuses: readonly ProjectStatus[] = ["active"];

/** True when the timeline shows the project: each project of a shown status. In use only marks a bar. */
function isShown(frontMatter: Project["frontMatter"], statuses: readonly ProjectStatus[]): boolean {
  return frontMatter.status !== null && statuses.includes(frontMatter.status);
}

/**
 * The shown projects, each once, from its creation to today, or to its `closed` day (#857, #859).
 * The person picks the statuses to show, and a project in use shows only when its status shows. The bars show no stretches of activity
 * from the chats: a deleted chat would take its activity away.
 */
export function timeline(
  projects: readonly Project[],
  range: DateRange,
  now: Date,
  statuses: readonly ProjectStatus[] = timelineStatuses,
): Timeline {
  const from = range.from.getTime();
  const to = range.to.getTime();
  const shareOf = (time: number): number => Math.min(1, Math.max(0, (time - from) / (to - from)));
  const today = shareOf(now.getTime());
  const rows = projects
    .filter((project) => isShown(project.frontMatter, statuses))
    .flatMap((project) => {
      const ended = endOf(project.frontMatter, now);
      return ended === null ? [] : [{ project, created: createdAt(project), ended }];
    })
    .sort((first, second) => first.created.getTime() - second.created.getTime())
    .filter((item) => item.created.getTime() < to && item.ended > from)
    .map((item) => {
      const end = Math.min(shareOf(item.ended), today);
      return {
        project: item.project,
        title: item.project.title,
        status: item.project.frontMatter.status,
        inUse: item.project.frontMatter.inUse,
        // A clock of another machine can put a creation after now: the bar then has no length.
        start: Math.min(shareOf(item.created.getTime()), end),
        end,
        startsBefore: item.created.getTime() < from,
        created: item.created,
        closedOn: closedDay(item.project.frontMatter),
      };
    });
  return { rows, marks: rangeMarks(range), today: now.getTime() >= from && now.getTime() < to ? today : null };
}

/** The closing day of a closed project. An open project, or one with no `closed` day, has none. */
function closedDay(frontMatter: Project["frontMatter"]): Date | null {
  return frontMatter.status === "closed" && frontMatter.closed !== null ? dayOf(frontMatter.closed) : null;
}

/** The whole calendar months from one day to a later one. */
function wholeMonths(from: Date, to: Date): number {
  const count = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  return to.getDate() < from.getDate() ? count - 1 : count;
}

/** "1 day", "35 days", "4 months", "1 year 8 months": the days up to two whole months, then the months. */
function durationWords(from: Date, to: Date): string {
  const count = wholeMonths(from, to);
  if (count < 2) {
    // The calendar counts the days, so a clock change does not drop one. The first and the last day both count.
    const days =
      (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
        Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      dayLength;
    return countOf(Math.max(1, Math.round(days) + 1), "day");
  }
  if (count < 12) return countOf(count, "month");
  const years = countOf(Math.floor(count / 12), "year");
  return count % 12 === 0 ? years : `${years} ${countOf(count % 12, "month")}`;
}

/**
 * The tooltip of a timeline row (#893), one fact per line: the title, the status and In use, then
 * the dates and the duration, such as "31 Aug – 4 Oct 2026 · 35 days". The start day gives its year
 * only when the year differs from the end. An open project ends today. An end before the start, from
 * a wrong `closed` day or the clock of another machine, gives the start day alone. A short id gives no duration.
 */
export function rowTooltip(row: TimelineRow, now: Date): string {
  const end = row.closedOn ?? now;
  const flipped = startOfDay(end) < startOfDay(row.created);
  const start = startWords(row.project, flipped || row.created.getFullYear() !== end.getFullYear());
  const dates = flipped ? start : `${start} – ${row.closedOn === null ? "today" : dayWords(row.closedOn)}`;
  const state = [...(row.status === null ? [] : [statusLabels[row.status]]), ...(row.inUse ? [inUseLabel] : [])].join(
    " · ",
  );
  // A short id, such as 2025-old-work, gives no start day, so how long the project ran is not known.
  const knowsDay = row.project.parsedId.created.day !== undefined;
  const duration = flipped ? countOf(1, "day") : knowsDay ? durationWords(row.created, end) : null;
  return [row.title, ...(state === "" ? [] : [state]), duration === null ? dates : `${dates} · ${duration}`].join("\n");
}

/** The start of a project, as far as its id knows it: "2025", "Mar 2026" or "4 Oct 2026". */
function startWords(project: Pick<Project, "parsedId">, withYear: boolean): string {
  const { year, month, day } = project.parsedId.created;
  const date = createdAt(project);
  if (month === undefined) return String(year);
  if (day === undefined)
    return withYear ? `${months[date.getMonth()] ?? ""} ${String(year)}` : (months[date.getMonth()] ?? "");
  return withYear ? dayWords(date) : todayLabel(date);
}

/**
 * The moment the bar of a project ends: the end of its closing day, or now for an open project.
 * A closed project with no `closed` day has no known end, so it has no bar, as in the chart.
 */
function endOf(frontMatter: Project["frontMatter"], now: Date): number | null {
  if (frontMatter.status !== "closed") return now.getTime();
  const day = frontMatter.closed === null ? null : dayOf(frontMatter.closed);
  if (day === null) return null;
  return Math.min(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime(), now.getTime());
}

/** The projects on day 1 of a month (#878). */
export interface MonthPoint {
  readonly at: Date;
  readonly active: number;
  readonly paused: number;
  /** The projects that closed in the month before `at`. */
  readonly closed: number;
}

/**
 * One point for day 1 of each month, from the month of the range start to today or the range end
 * (#878). Eva keeps only the status of today and the `closed` day. So an open project counts with
 * its status of today since its creation, and a closed project counts as active until its closing
 * day. A closed project with no `closed` day is in no point.
 */
export function monthlyStatus(
  projects: readonly Pick<Project, "parsedId" | "frontMatter">[],
  range: DateRange,
  now: Date,
): MonthPoint[] {
  const last = Math.min(range.to.getTime() - 1, now.getTime());
  const known = projects.flatMap((project) => {
    const { status, closed } = project.frontMatter;
    if (status === null) return [];
    const closedOn = status === "closed" ? (closed === null ? null : dayOf(closed)) : null;
    if (status === "closed" && closedOn === null) return [];
    return [{ created: createdAt(project).getTime(), status, closedOn: closedOn?.getTime() ?? null }];
  });
  const points: MonthPoint[] = [];
  for (
    let at = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    at.getTime() <= last;
    at = new Date(at.getFullYear(), at.getMonth() + 1, 1)
  ) {
    const time = at.getTime();
    const before = new Date(at.getFullYear(), at.getMonth() - 1, 1).getTime();
    const open = known.filter(
      (project) => project.created <= time && (project.closedOn === null || time < project.closedOn),
    );
    points.push({
      at,
      active: open.filter((project) => project.status !== "paused").length,
      paused: open.filter((project) => project.status === "paused").length,
      closed: known.filter(
        (project) => project.closedOn !== null && project.closedOn >= before && project.closedOn < time,
      ).length,
    });
  }
  return points;
}

/** "1 Nov 2026": the day of a point of the chart. */
export function pointLabel(at: Date): string {
  return dayWords(at);
}

/** "4 Nov": the label under the today line of the timeline (#857). */
export function todayLabel(now: Date): string {
  return `${String(now.getDate())} ${months[now.getMonth()] ?? ""}`;
}

/** The fields of a chat that the home page reads. */
type HomeChat = Pick<SessionRecord, "mode" | "archived" | "closed" | "lastTurnAt">;

const stateOrder: readonly Exclude<ChatState, null>[] = ["needs-you", "working", "unread"];

/** How many chats the Recent card lists. */
const recentLength = 5;

/**
 * The Project chats of the home page. "Needs you" holds each chat that waits, runs or has an
 * unseen answer, in that order. "Recent" holds the newest others. The chats come in list order.
 */
export function homeChats<C extends HomeChat>(
  chats: readonly C[],
  stateOf: (chat: C) => ChatState,
): { readonly needsYou: { readonly chat: C; readonly state: Exclude<ChatState, null> }[]; readonly recent: C[] } {
  const open = chats.filter((chat) => chat.mode === "project" && !chat.archived && !chat.closed);
  const withStates = open.map((chat) => ({ chat, state: stateOf(chat) }));
  const needsYou = stateOrder.flatMap((state) =>
    withStates.flatMap((item) => (item.state === state ? [{ chat: item.chat, state }] : [])),
  );
  const recent = withStates
    .filter((item) => item.state === null && item.chat.lastTurnAt !== null)
    .slice(0, recentLength)
    .map((item) => item.chat);
  return { needsYou, recent };
}

/** At most this many labels under the chart, so a phone has room for each. */
const chartLabelCount = 6;

/**
 * The labels under the points of the chart: the month, or the year at January when the points
 * cross a year. A long range names every few points, and leaves the others empty.
 */
export function chartLabels(points: readonly MonthPoint[]): string[] {
  const first = points[0]?.at.getFullYear();
  const manyYears = points.some((point) => point.at.getFullYear() !== first);
  const step = Math.ceil(points.length / chartLabelCount);
  return points.map(({ at }, index) => {
    if (index % step !== 0) return "";
    return manyYears && at.getMonth() === 0 ? String(at.getFullYear()) : (months[at.getMonth()] ?? "");
  });
}

/** The choice, or the default range when it names a year that lost its last project, such as after a rename. */
export function knownChoice(
  choice: RangeChoice,
  projects: readonly Pick<Project, "parsedId">[],
  now: Date,
): RangeChoice {
  return choice.kind === "year" && !projectYears(projects, now).includes(choice.year) ? defaultRange : choice;
}
