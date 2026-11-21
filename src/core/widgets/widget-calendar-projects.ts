/**
 * The project of a calendar event (#1012): a line `[eva-project:<id>]` in the event's description
 * links the event to a project. Eva removes the line from the description that a widget gets, and
 * gives the project in its own field. No event text goes to a log.
 */
import type { WidgetCalendarEvent } from "../google/google-calendar.ts";
import type { Project } from "../projects/project-catalog.ts";

/** The project of an event, as a widget gets it. `path` is the project's folder in the vault. */
export interface EventProject {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export type ContractCalendarEvent = WidgetCalendarEvent & { readonly project: EventProject | null };

/** The longest description that a widget gets. */
export const maxDescriptionLength = 2000;

/** The tag, with any case of its name and spaces around the id. */
const tagPattern = /\[\s*eva-project\s*:\s*([^\]\s]+)\s*\]/gi;

/** Each event with its project, and its description with no tag line. Reads the projects once, only for a tag. */
export function eventsWithProjects(
  events: readonly WidgetCalendarEvent[],
  projects: () => readonly Project[],
): ContractCalendarEvent[] {
  let known: readonly Project[] | null = null;
  const list = (): readonly Project[] => (known ??= projects());
  return events.map((event) => {
    const ids = [...(event.description ?? "").matchAll(tagPattern)].map((match) => match[1] ?? "");
    const project = ids.reduce<EventProject | null>((found, id) => found ?? projectOf(id, list()), null);
    return { ...event, description: withoutTags(event.description), project };
  });
}

/**
 * The project with this folder name, or else the one project whose name with no date is this. A
 * project outside the vault gives null: a widget reaches only the vault.
 */
function projectOf(id: string, projects: readonly Project[]): EventProject | null {
  const wanted = id.toLowerCase();
  const inVault = projects.filter((project) => project.vaultFolder !== null);
  const exact = inVault.find((project) => project.id.toLowerCase() === wanted);
  const short = inVault.filter((project) => project.parsedId.slug === wanted);
  const found = exact ?? (short.length === 1 ? short[0] : undefined);
  if (found?.vaultFolder === undefined || found.vaultFolder === null) return null;
  return { id: found.id, title: found.title, path: found.vaultFolder };
}

/** The description with each tag gone, and a line that held only a tag gone too, cut at the limit. */
function withoutTags(description: string | null): string | null {
  if (description === null) return null;
  const lines = description.split("\n").flatMap((line) => {
    const kept = line.replace(tagPattern, "");
    if (kept === line) return [line];
    const tidy = kept.replace(/\s{2,}/g, " ").trim();
    return tidy === "" ? [] : [tidy];
  });
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text === "") return null;
  if (text.length <= maxDescriptionLength) return text;
  const cut = text.slice(0, maxDescriptionLength);
  // A cut between the two halves of a character outside the basic plane would leave half of it.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
