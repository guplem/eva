/**
 * The parts of the Projects home page that need no page: the colour of each project, the counts by
 * status, the timeline and the chats that the page lists (#840).
 */
import type { ProjectStatus } from "../../../shared/project-statuses.ts";
import type { Project, SessionRecord } from "./api.ts";
import { months, type ChatState } from "./chat-list.ts";

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

/** A year, or every year. */
export type YearChoice = number | "all";

/** Each year with a project, and this year, the newest first: the choices of the year selector. */
export function projectYears(projects: readonly Pick<Project, "parsedId">[], now: Date): number[] {
  const years = new Set([now.getFullYear(), ...projects.map((project) => project.parsedId.created.year)]);
  return [...years].sort((first, second) => second - first);
}

/** The counts of the home page. A closed project and a project with no status count only in `started`. */
export type StatusCounts = Readonly<Record<Exclude<ProjectStatus, "closed">, number>> & { readonly started: number };

/** How many projects of each status started in the year. */
export function statusCounts(
  projects: readonly Pick<Project, "parsedId" | "frontMatter">[],
  year: YearChoice,
): StatusCounts {
  const started = projects.filter((project) => year === "all" || project.parsedId.created.year === year);
  const count = (status: ProjectStatus): number =>
    started.filter((project) => project.frontMatter.status === status).length;
  return {
    active: count("active"),
    "in-use": count("in-use"),
    idea: count("idea"),
    paused: count("paused"),
    started: started.length,
  };
}

/** The statuses that the timeline can show. An idea and a closed project have no run to draw. */
export const timelineStatuses = ["active", "paused", "in-use"] as const;
export type TimelineStatus = (typeof timelineStatuses)[number];

/** What the timeline shows until the person picks other statuses (#857). */
export const defaultTimelineStatuses: ReadonlySet<TimelineStatus> = new Set(["active", "paused"]);

function isTimelineStatus(status: ProjectStatus | null | undefined): status is TimelineStatus {
  return timelineStatuses.some((shown) => shown === status);
}

export interface TimelineRow {
  readonly project: Project;
  readonly title: string;
  readonly status: TimelineStatus;
  /** Where the bar starts and ends, as a share of the timeline width, from 0 to 1. */
  readonly start: number;
  readonly end: number;
  /** True when the project started before the timeline: its bar starts at the edge. */
  readonly startsBefore: boolean;
}

export interface Timeline {
  readonly rows: readonly TimelineRow[];
  /** A month in a year, or a year in all the years, as a share of the width. */
  readonly marks: readonly { readonly label: string; readonly at: number }[];
  /** Where today is, or null when today is outside the timeline. */
  readonly today: number | null;
}

/**
 * The projects of the picked statuses, each from its creation to today. The bars show no stretches
 * of activity from the chats: a deleted chat would take its activity away.
 */
export function timeline(
  projects: readonly Project[],
  year: YearChoice,
  now: Date,
  statuses: ReadonlySet<TimelineStatus> = defaultTimelineStatuses,
): Timeline {
  const shown = projects
    .flatMap((project) => {
      const status = project.frontMatter.status;
      return isTimelineStatus(status) && statuses.has(status) ? [{ project, status, created: createdAt(project) }] : [];
    })
    .sort((first, second) => first.created.getTime() - second.created.getTime());
  const firstYear =
    year === "all" ? Math.min(now.getFullYear(), ...shown.map((item) => item.created.getFullYear())) : year;
  const lastYear = year === "all" ? now.getFullYear() : year;
  const from = new Date(firstYear, 0, 1).getTime();
  const to = new Date(lastYear + 1, 0, 1).getTime();
  const shareOf = (time: number): number => Math.min(1, Math.max(0, (time - from) / (to - from)));
  const end = shareOf(now.getTime());
  const rows = shown
    .filter((item) => item.created.getTime() < to)
    .map((item) => ({
      project: item.project,
      title: item.project.title,
      status: item.status,
      // A clock of another machine can put a creation after now: the bar then has no length.
      start: Math.min(shareOf(item.created.getTime()), end),
      end,
      startsBefore: item.created.getTime() < from,
    }));
  const marks =
    year === "all"
      ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) => ({
          label: String(firstYear + index),
          at: shareOf(new Date(firstYear + index, 0, 1).getTime()),
        }))
      : months.map((label, index) => ({ label, at: shareOf(new Date(year, index, 1).getTime()) }));
  return { rows, marks, today: now.getTime() >= from && now.getTime() < to ? end : null };
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
