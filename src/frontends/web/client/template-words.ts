/** The words of the Template alignment card: each part's state, and the message that asks Eva to merge. */
import type { TemplatePartView } from "./api.ts";

export interface StateWords {
  readonly label: string;
  /** The pill class: a state that needs the person is a warning. */
  readonly tone: "ok" | "warn" | "idle";
}

const stateWords: Readonly<Record<TemplatePartView["state"], StateWords>> = {
  current: { label: "Up to date", tone: "ok" },
  pending: { label: "Updates at the next start", tone: "idle" },
  yours: { label: "Your version", tone: "idle" },
  kept: { label: "You kept yours", tone: "idle" },
  differs: { label: "New version", tone: "warn" },
  missing: { label: "Removed", tone: "idle" },
};

export function partStateWords(state: TemplatePartView["state"]): StateWords {
  return stateWords[state];
}

/** "Updated on 22 Oct 2026", in the person's language, or null when Eva never wrote the part. */
export function updatedWords(updatedAt: string | null, locale?: string): string | null {
  if (updatedAt === null) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Updated on ${date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** The first message of the chat that merges the person's version of a part with Eva's new one. */
export function mergeMessage(part: TemplatePartView): string {
  return [
    `The ${part.kind} "${part.name}" in my vault (\`${part.path}\`) has my own changes, and Eva has a new version of it.`,
    "Merge them in my file: keep my changes, and add what is new in Eva's version. Then tell me what you changed.",
    "",
    "Eva's new version:",
    "",
    "````markdown",
    (part.newText ?? "").trimEnd(),
    "````",
  ].join("\n");
}
