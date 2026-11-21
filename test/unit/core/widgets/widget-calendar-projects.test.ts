import { describe, expect, test } from "bun:test";
import type { WidgetCalendarEvent } from "../../../../src/core/google/google-calendar.ts";
import type { Project } from "../../../../src/core/projects/project-catalog.ts";
import { parseProjectId } from "../../../../src/core/projects/project-id.ts";
import {
  eventsWithProjects,
  maxDescriptionLength,
  type EventProject,
} from "../../../../src/core/widgets/widget-calendar-projects.ts";

function project(id: string, title: string, vault = true): Project {
  return {
    id,
    title,
    parsedId: parseProjectId(id),
    vaultFolder: vault ? `Projects/${id}` : null,
  } as unknown as Project;
}

const app = project("2026-11-02-1030-example-app", "Example app");
const site = project("2026-10-01-0900-example-site", "Example site");
const twin = project("2025-01-01-0900-example-site", "Older site");
const outside = project("2026-09-01-0800-outside", "Outside", false);
const all = [app, site, twin, outside];

function event(description: string | null): WidgetCalendarEvent {
  return {
    id: "e1",
    calendarId: "work",
    title: "Planning",
    startAt: "2026-11-18T09:00:00+01:00",
    endAt: "2026-11-18T10:00:00+01:00",
    place: null,
    link: null,
    description,
  };
}

function only(
  description: string | null,
  projects: readonly Project[] = all,
): { readonly description: string | null | undefined; readonly project: EventProject | null | undefined } {
  const [first] = eventsWithProjects([event(description)], () => projects);
  return { description: first?.description, project: first?.project };
}

describe("eventsWithProjects", () => {
  test("finds the project of the tag line, and removes the line from the description", () => {
    expect(only("Plan the sprint.\n[eva-project:2026-11-02-1030-example-app]\nBring notes.")).toEqual({
      description: "Plan the sprint.\nBring notes.",
      project: { id: app.id, title: "Example app", path: "Projects/2026-11-02-1030-example-app" },
    });
  });

  test("reads the tag anywhere, with any case of its name and spaces around the id", () => {
    expect(only("Sync [EVA-Project:  2026-11-02-1030-example-app ] today").project?.id).toBe(app.id);
    expect(only("Sync [EVA-Project:  2026-11-02-1030-example-app ] today").description).toBe("Sync today");
    const alone = only("[eva-project:2026-11-02-1030-example-app]");
    expect(alone.description).toBeNull();
    expect(alone.project?.id).toBe(app.id);
  });

  test("takes the short name when exactly one project has it", () => {
    expect(only("[eva-project:example-app]").project?.id).toBe(app.id);
    // Two projects named example-site: the short name names neither.
    expect(only("[eva-project:example-site]").project).toBeNull();
    expect(only("[eva-project:2025-01-01-0900-example-site]").project?.title).toBe("Older site");
  });

  test("an unknown id, or a project outside the vault, gives no project, and the tag still goes", () => {
    expect(only("Notes\n[eva-project:nothing]")).toEqual({ description: "Notes", project: null });
    expect(only("[eva-project:2026-09-01-0800-outside]").project).toBeNull();
  });

  test("an event with no tag keeps its description and reads no project", () => {
    let reads = 0;
    const [first] = eventsWithProjects([event("Just notes"), event(null)], () => {
      reads += 1;
      return all;
    });
    expect(first).toMatchObject({ description: "Just notes", project: null });
    expect(reads).toBe(0);
  });

  test("cuts a long description at the limit", () => {
    const long = only("x".repeat(maxDescriptionLength + 50)).description ?? "";
    expect(long.length).toBe(maxDescriptionLength);
  });
});
