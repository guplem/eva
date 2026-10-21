/** The words of the Template alignment card: each part's state, and the message that asks Eva to merge. */
import type { TemplatePartView } from "./api.ts";

export interface StateWords {
  readonly label: string;
  /** The pill class: a state that needs the person is a warning. */
  readonly tone: "ok" | "warn" | "idle";
}

const stateWords: Readonly<Record<TemplatePartView["state"], StateWords>> = {
  current: { label: "Up to date", tone: "ok" },
  yours: { label: "Your version", tone: "idle" },
  kept: { label: "You kept yours", tone: "idle" },
  differs: { label: "New version", tone: "warn" },
  missing: { label: "Deleted", tone: "idle" },
};

export function partStateWords(state: TemplatePartView["state"]): StateWords {
  return stateWords[state];
}

/** The first message of the chat that merges the person's version of a part with Eva's new one. */
export function mergeMessage(part: TemplatePartView): string {
  return [
    `The skill "${part.name}" in my vault (\`${part.path}\`) has my own changes, and Eva has a new version of it.`,
    "Merge them in my file: keep my changes, and add what is new in Eva's version. Then tell me what you changed.",
    "",
    "Eva's new version:",
    "",
    "````markdown",
    (part.newText ?? "").trimEnd(),
    "````",
  ].join("\n");
}
