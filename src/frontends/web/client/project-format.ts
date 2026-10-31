/** The words and colours of the project pages. */
import type { ProjectStatus, ProjectStatusFilter } from "../../../shared/project-statuses.ts";
import type { Project } from "./api.ts";

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
  idea: "Idea",
  active: "Active",
  "in-use": "In use",
  paused: "Paused",
  closed: "Closed",
};

const statusTones: Readonly<Record<ProjectStatus, PillTone>> = {
  idea: "idle",
  active: "ok",
  "in-use": "live",
  paused: "warn",
  closed: "idle",
};

/** The status filter chips of the Projects page. "Current" is the projects that the person develops or uses now (#690). */
export const statusChips: readonly { readonly value: ProjectStatusFilter; readonly text: string }[] = [
  { value: "current", text: "Current" },
  ...(["active", "in-use", "idea", "paused", "closed"] as const).map((status) => ({
    value: status,
    text: statusLabels[status],
  })),
];

/** Active is green, in use has the accent colour, paused is amber, and an idea or a closed project is grey. */
export function statusPill(status: Project["frontMatter"]["status"]): Pill | null {
  return status === null ? null : { text: statusLabels[status], tone: statusTones[status] };
}

/** "2 clones · 3 chats", for the project card. */
export function projectSummary(cloneCount: number, chatCount: number): string {
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
