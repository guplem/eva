/** The words and colours of the project pages. */
import type { Project } from "./api.ts";

/** The colour of a status pill: `--ok`, `--warn` or the muted chip. */
export type PillTone = "ok" | "warn" | "idle";

export interface Pill {
  readonly text: string;
  readonly tone: PillTone;
}

/** "1 warning", "3 warnings". */
export function countOf(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** Active is green, paused is amber, and an idea or a closed project is grey. */
export function statusPill(status: Project["frontMatter"]["status"]): Pill | null {
  switch (status) {
    case "active":
      return { text: "Active", tone: "ok" };
    case "idea":
      return { text: "Idea", tone: "idle" };
    case "paused":
      return { text: "Paused", tone: "warn" };
    case "closed":
      return { text: "Closed", tone: "idle" };
    case null:
      return null;
  }
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
  return url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
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
