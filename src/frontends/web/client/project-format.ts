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
