/** The words and colours of the project pages. */
import { projectStatuses, type ProjectStatus } from "../../../shared/project-statuses.ts";
import type { Project, ProjectDetails } from "./api.ts";
import { projectTypes, worksInClones, type ProjectType } from "../../../shared/project-types.ts";
import { repositoryName } from "../../../core/projects/repository-name.ts";

/** The colour of a status pill: `--ok`, `--warn`, the accent of `--soft`, or the muted chip. */
export type PillTone = "ok" | "warn" | "live" | "idle";

export interface Pill {
  readonly text: string;
  readonly tone: PillTone;
}

/** "1 warning", "3 warnings". */
export function countOf(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** The word for each status, the same on the pill, the filter chip and the details form. */
export const statusLabels: Readonly<Record<ProjectStatus, string>> = {
  active: "Active",
  paused: "Paused",
  closed: "Closed",
};

/** The word of the in-use flag, the same on the pill, the filter chip, the timeline and the details form (#859). */
export const inUseLabel = "In use";

const statusTones: Readonly<Record<ProjectStatus, PillTone>> = {
  active: "ok",
  paused: "warn",
  closed: "idle",
};

/** The choices of a status field: None, then each status. */
export const statusChoices: readonly { readonly value: string; readonly label: string }[] = [
  { value: "", label: "None" },
  ...projectStatuses.map((status) => ({ value: status, label: statusLabels[status] })),
];

/** The status of a choice of `statusChoices`, or null for None and for any other value. */
export function statusOf(value: string): ProjectStatus | null {
  return projectStatuses.find((status) => status === value) ?? null;
}

/** A chip of the In use filter of the Projects page (#885). */
export type InUseChoice = "in-use" | "not-in-use";

const inUseChoices: readonly InUseChoice[] = ["in-use", "not-in-use"];

/**
 * The two filters of the Projects page (#885): the chips that are on in each row. The in-use flag is
 * apart from the status (#859), so it has its own filter.
 */
export interface ListFilter {
  readonly statuses: readonly ProjectStatus[];
  readonly inUse: readonly InUseChoice[];
}

/** The list opens on the work of now: the active projects, in use or not. */
export const defaultListFilter: ListFilter = { statuses: ["active"], inUse: inUseChoices };

/** A row of filter chips. Its name starts the row, so each row says what it filters (#889). */
export interface FilterRow<V extends string> {
  readonly name: string;
  readonly chips: readonly { readonly value: V; readonly text: string }[];
}

export const statusRow: FilterRow<ProjectStatus> = {
  name: "Status",
  chips: projectStatuses.map((status) => ({ value: status, text: statusLabels[status] })),
};

/** "Use", not "In use": the row name differs from its first chip. */
export const inUseRow: FilterRow<InUseChoice> = {
  name: "Use",
  chips: [
    { value: "in-use", text: inUseLabel },
    { value: "not-in-use", text: "Not in use" },
  ],
};

/** The chips that are on after a tap on one, in the order of the chips. Each chip turns on and off by itself. */
export function toggledChip<V extends string>(picked: readonly V[], tapped: V, row: FilterRow<V>): V[] {
  return row.chips.map((chip) => chip.value).filter((value) => (value === tapped) !== picked.includes(value));
}

/**
 * True when a project matches both filters (#889). A row with every chip on filters nothing. A row
 * with no chip on shows the projects with no value in that field: no status that Eva knows, or not
 * in use. Eva writes no `in-use` key for a project that is not in use.
 */
export function matchesListFilter(
  frontMatter: Pick<Project["frontMatter"], "status" | "inUse">,
  filter: ListFilter,
): boolean {
  const { status, inUse } = frontMatter;
  const statusMatches =
    filter.statuses.length === projectStatuses.length ||
    (status === null ? filter.statuses.length === 0 : filter.statuses.includes(status));
  const inUseMatches =
    filter.inUse.length === inUseChoices.length ||
    filter.inUse.includes(inUse ? "in-use" : "not-in-use") ||
    (filter.inUse.length === 0 && !inUse);
  return statusMatches && inUseMatches;
}

/** A count of the statistics, which filters the list when the person taps it. */
export type StatusCount = "active" | "in-use" | "paused";

/** The filters after a tap on a count of the statistics: that status, or the projects in use. */
export function listFilterOf(count: StatusCount): ListFilter {
  return count === "in-use"
    ? { statuses: projectStatuses, inUse: ["in-use"] }
    : { statuses: [count], inUse: inUseChoices };
}

/** Active is green, paused is amber, and a closed project is grey. */
export function statusPill(status: Project["frontMatter"]["status"]): Pill | null {
  return status === null ? null : { text: statusLabels[status], tone: statusTones[status] };
}

/** "In use" has the accent colour, so it differs from the green of Active. It shows beside the status pill (#859). */
export function inUsePill(inUse: boolean): Pill | null {
  return inUse ? { text: inUseLabel, tone: "live" } : null;
}

/** The word for each project type, the same in the New project form, the details form and the card. */
const projectTypeLabels: Readonly<Record<ProjectType, string>> = {
  general: "General",
  software: "Software",
  specialist: "Specialist",
};

export function projectTypeLabel(type: ProjectType): string {
  return projectTypeLabels[type];
}

/** The choices of a project type field, General first: no type means general (#768). */
export const projectTypeChoices: readonly { readonly value: ProjectType; readonly label: string }[] = projectTypes.map(
  (type) => ({ value: type, label: projectTypeLabels[type] }),
);

/** What each type is, under the type field of the New project form. */
export const projectTypeHints: Readonly<Record<ProjectType, string>> = {
  general: "A folder of notes and files, such as plans or reference photos: a house, a scale model, a book.",
  software: "Work in repositories, such as an app, a website or a widget. Each chat works in a clone.",
  specialist: "A chat with its own rules and memory, such as a coach. It keeps its files in this project folder.",
};

/** The type of a choice of `projectTypeChoices`, or null for any other value. */
export function projectTypeOf(value: string): ProjectType | null {
  return projectTypes.find((type) => type === value) ?? null;
}

/** "2 clones · 3 chats", for the project card. A general project and a specialist have no clones (#703, #768). */
export function projectSummary(cloneCount: number, chatCount: number, type: ProjectType = "software"): string {
  if (!worksInClones(type))
    return `${projectTypeLabels[type]} · ${chatCount === 0 ? "No chats yet" : countOf(chatCount, "chat")}`;
  const clones = cloneCount === 0 ? "No clones yet" : countOf(cloneCount, "clone");
  return chatCount === 0 ? clones : `${clones} · ${countOf(chatCount, "chat")}`;
}

/** "Clean" or "3 changes"; null when git did not answer, so the card shows no guess. */
export function changesPill(changes: number | null): Pill | null {
  if (changes === null) return null;
  return changes === 0 ? { text: "Clean", tone: "ok" } : { text: countOf(changes, "change"), tone: "warn" };
}

/** A repository URL without its scheme, user and `.git`: short enough for a chip, and no token shows. */
export function repositoryLabel(url: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);
  // A query can hold a token too, so it goes before the chip shows the rest.
  const rest = url.slice(scheme?.[0].length ?? 0).replace(/[?#].*$/, "");
  // A password can hold an `@` or a `/`. So after a scheme, the user part ends at the last `@` that
  // a host and a path follow. An `@` with no `/` after it is in the path, such as `repo@v2`.
  const tail = rest.slice(rest.lastIndexOf("@") + 1);
  const withoutUser =
    scheme !== null && rest.includes("@") && tail.includes("/") ? tail : rest.replace(/^[^/\\]*@/, "");
  return withoutUser.replace(/\/+$/, "").replace(/\.git$/, "");
}

/**
 * A note for the repositories that the form removed but did not save yet, or null. It shows only
 * after a Remove press, so the person reads it next to the action and not as a rule of the field.
 */
export function removedRepositoriesHint(saved: readonly string[], current: readonly string[]): string | null {
  const removed = saved.filter((url) => !current.includes(url)).map(repositoryLabel);
  if (removed.length === 0) return null;
  const names = removed.length === 1 ? removed[0] : `${removed.slice(0, -1).join(", ")} and ${removed.at(-1)}`;
  const whose = removed.length === 1 ? "Its" : "Their";
  return `Save to remove ${names}. ${whose} clones stay in the project.`;
}

/**
 * The web page of a hosted repository, such as `https://github.com/example/example-app`, or null for
 * a local path or an address that Eva cannot read. An SSH address has no web page of its own, so the
 * link guesses the host's HTTPS page, without the SSH port.
 */
export function repositoryWebUrl(url: string): string | null {
  const address = url.trim();
  // `git@host:owner/repo`.
  const scp = /^[^@/\s]+@([^:/\s]+):\/*([^@\s\\]+)$/.exec(address);
  // `scheme://user@host:port/owner/repo`. A user part with a slash is a broken address, so it never matches.
  const full = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@\s]*@)*([^/:@\s]+)(:\d+)?\/+([^@\s\\]+)$/i.exec(address);
  // `host/owner/repo`, with no scheme.
  const bare = /^([^/:@\s]+)\/+([^@\s\\]+)$/.exec(address);
  let scheme = "https";
  let host: string;
  let port = "";
  let path: string;
  if (scp !== null) {
    [host, path] = [scp[1] ?? "", scp[2] ?? ""];
  } else if (full !== null) {
    const given = (full[1] ?? "").toLowerCase();
    if (given === "http" || given === "https") [scheme, port] = [given, full[3] ?? ""];
    else if (!["ssh", "git", "git+ssh"].includes(given)) return null;
    [host, path] = [full[2] ?? "", full[4] ?? ""];
  } else if (bare !== null) {
    [host, path] = [bare[1] ?? "", bare[2] ?? ""];
  } else {
    return null;
  }
  // A host has a dot, such as `github.com`, so a local name such as `example-app` gives no link.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  const tidy = path
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  return tidy === "" ? null : `${scheme}://${host}${port}/${tidy}`;
}

/** "Projects/2026-10-12-0930-example-app": the place in the vault, without the path of the computer. */
export function projectFolder(path: string): string {
  return path.split(/[\\/]/).slice(-2).join("/");
}

/**
 * Every tag of these projects once, the most used first, then by name. The filter ignores case, so
 * the list does too.
 */
export function tagsByUse(projects: readonly Project[]): string[] {
  const uses = new Map<string, number>();
  for (const project of projects) {
    for (const tag of new Set(project.frontMatter.tags.map((each) => each.toLowerCase()))) {
      uses.set(tag, (uses.get(tag) ?? 0) + 1);
    }
  }
  return [...uses.keys()].sort(
    (first, second) => (uses.get(second) ?? 0) - (uses.get(first) ?? 0) || first.localeCompare(second),
  );
}

/**
 * The tag chips to show. A long list hides all but the first `limit` tags until the person opens it,
 * so the tags do not push the projects off a phone screen. The chosen tag always stays in view.
 */
export function shownTags(
  tags: readonly string[],
  chosen: string,
  open: boolean,
  limit: number,
): { readonly shown: readonly string[]; readonly hidden: number } {
  if (open || tags.length <= limit) return { shown: tags, hidden: 0 };
  const shown = tags.slice(0, limit);
  if (chosen !== "" && tags.includes(chosen) && !shown.includes(chosen)) shown.push(chosen);
  return { shown, hidden: tags.length - shown.length };
}

/**
 * "2 to pull" and "1 to push", against the last fetch. A clone level with its remote, or with no
 * upstream, shows none: the changes pill already says Clean.
 */
export function syncPills(ahead: number | null, behind: number | null): Pill[] {
  return [
    ...(behind !== null && behind > 0 ? [{ text: `${String(behind)} to pull`, tone: "warn" as const }] : []),
    ...(ahead !== null && ahead > 0 ? [{ text: `${String(ahead)} to push`, tone: "warn" as const }] : []),
  ];
}

/** Whether a clone has something for its Push button: a change to commit, or a commit to push. */
export function canPush(clone: { readonly changes: number | null; readonly ahead: number | null }): boolean {
  return (clone.changes ?? 0) > 0 || (clone.ahead ?? 0) > 0;
}

/**
 * The folder names of the widget repositories of a project, as a clone names its folders (#693):
 * the last part of the address, with no `.git`. Each of these repositories gets a preview.
 */
export function widgetRepositoryNames(project: Pick<Project, "frontMatter">): Set<string> {
  const { repos, repoTypes } = project.frontMatter;
  return new Set(repos.filter((url) => repoTypes[url] === "widget").map(repositoryName));
}

/** True when the form holds the details as loaded. A missing type is general, as the form shows it (#768). */
export function sameDetails(first: ProjectDetails, second: ProjectDetails): boolean {
  const sameList = (one: readonly string[], two: readonly string[]): boolean =>
    one.length === two.length && one.every((value, index) => value === two[index]);
  return (
    first.title === second.title &&
    first.status === second.status &&
    (first.inUse ?? false) === (second.inUse ?? false) &&
    (first.closed ?? null) === (second.closed ?? null) &&
    (first.type ?? "general") === (second.type ?? "general") &&
    sameList(first.tags, second.tags) &&
    sameList(first.repos, second.repos)
  );
}

/** The day of a date on the person's own clock, as `YYYY-MM-DD`: the form of the `closed` key (#826). */
export function localDay(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The value of the date field as a closing date: an empty field is no date. */
export function closingDate(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * The details with a new status. A choice of Closed starts the closing date at today, so the
 * person keeps it or picks another day (#826). Another status keeps the date in the form only, so
 * a choice of Closed again brings it back: the save removes the date of a project that is not closed.
 */
export function withStatus(details: ProjectDetails, status: ProjectStatus | null, today: string): ProjectDetails {
  if (status !== "closed") return { ...details, status };
  return { ...details, status, closed: closingDate(details.closed ?? "") ?? today };
}
