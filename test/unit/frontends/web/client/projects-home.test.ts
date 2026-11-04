import { describe, expect, test } from "bun:test";
import type { Project } from "../../../../../src/frontends/web/client/api.ts";
import type { ChatState } from "../../../../../src/frontends/web/client/chat-list.ts";
import {
  createdAt,
  homeChats,
  projectColor,
  projectInitials,
  projectYears,
  statusCounts,
  timeline,
  todayLabel,
} from "../../../../../src/frontends/web/client/projects-home.ts";
import { parseProjectId } from "../../../../../src/core/projects/project-id.ts";
import type { ProjectStatus } from "../../../../../src/shared/project-statuses.ts";

/** A project with only the fields that the home page reads. */
function project(
  id: string,
  status: ProjectStatus | null,
  { inUse = false }: { readonly inUse?: boolean } = {},
): Project {
  const parsedId = parseProjectId(id);
  if (parsedId === null) throw new Error(`Bad id ${id}`);
  const title = id.replace(/^[\d-]+-/, "");
  return {
    id,
    path: `/vault/Projects/${id}`,
    parsedId,
    frontMatter: {
      created: null,
      status,
      inUse,
      closed: null,
      repos: [],
      tags: [],
      legacyId: null,
      repoTypes: {},
      type: "general",
      summary: null,
      pinned: null,
      extra: {},
    },
    title,
    description: null,
    vaultFolder: `Projects/${id}`,
    clones: [],
    warnings: [],
  };
}

const now = new Date(2026, 10, 3, 12, 0);

describe("projectColor", () => {
  test("gives the same name the same colour each time", () => {
    expect(projectColor("example-app")).toBe(projectColor("example-app"));
  });

  test("takes a colour from the EVE file type tokens", () => {
    for (const slug of ["example-app", "house", "gym-coach", "weekly-menus", "weather-widget", "a", ""]) {
      expect(projectColor(slug)).toMatch(/^var\(--type-(red|orange|yellow|green|teal|blue|violet|pink)\)$/);
    }
  });

  test("spreads names over more than one colour", () => {
    const colours = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(projectColor));
    expect(colours.size).toBeGreaterThan(3);
  });
});

describe("projectInitials", () => {
  test("takes the first letter of the first two words", () => {
    expect(projectInitials("example-app")).toBe("EA");
    expect(projectInitials("House renovation")).toBe("HR");
    expect(projectInitials("gym")).toBe("G");
  });

  test("gives a mark for a title with no letter", () => {
    expect(projectInitials("—")).toBe("?");
  });
});

describe("createdAt", () => {
  test("reads the time of the project id", () => {
    expect(createdAt(project("2026-03-14-0930-house", "active"))).toEqual(new Date(2026, 2, 14, 9, 30));
  });

  test("starts a short id at the start of its month or year", () => {
    expect(createdAt(project("2025-07-garden", "paused"))).toEqual(new Date(2025, 6, 1));
    expect(createdAt(project("2024-old", "closed"))).toEqual(new Date(2024, 0, 1));
  });
});

describe("projectYears", () => {
  test("lists each year with a project and this year, the newest first", () => {
    const projects = [project("2024-05-01-0000-a", "active"), project("2025-02-01-0000-b", "paused")];
    expect(projectYears(projects, now)).toEqual([2026, 2025, 2024]);
  });

  test("lists this year alone with no project", () => {
    expect(projectYears([], now)).toEqual([2026]);
  });
});

describe("statusCounts", () => {
  const projects = [
    project("2026-01-05-1000-a", "active"),
    project("2026-02-05-1000-b", "active", { inUse: true }),
    project("2026-03-05-1000-c", "closed", { inUse: true }),
    project("2026-05-05-1000-e", "closed"),
    project("2025-06-05-1000-f", "paused"),
    project("2025-07-05-1000-g", null),
  ];

  test("counts the projects that started in the year, by status, and the ones in use (#859)", () => {
    expect(statusCounts(projects, 2026)).toEqual({ active: 2, "in-use": 2, paused: 0, started: 4 });
  });

  test("counts every project for all the years", () => {
    expect(statusCounts(projects, "all")).toEqual({ active: 2, "in-use": 2, paused: 1, started: 6 });
  });
});

describe("timeline", () => {
  const projects = [
    project("2026-07-01-0000-late", "active"),
    project("2026-01-01-0000-early", "active"),
    project("2025-06-01-0000-old", "paused"),
    project("2026-02-01-0000-used", "closed", { inUse: true }),
    project("2026-03-01-0000-built", "active", { inUse: true }),
    project("2026-04-01-0000-done", "closed"),
  ];

  test("shows the active, the paused and the in-use projects once each, the oldest first (#859)", () => {
    const rows = timeline(projects, 2026, now).rows;
    expect(rows.map((row) => [row.title, row.status, row.inUse])).toEqual([
      ["old", "paused", false],
      ["early", "active", false],
      ["used", "closed", true],
      ["built", "active", true],
      ["late", "active", false],
    ]);
  });

  test("hides the paused projects when the person asks, but never a project in use (#859)", () => {
    const pausedTool = project("2026-05-01-0000-paused-tool", "paused", { inUse: true });
    const rows = timeline([...projects, pausedTool], 2026, now, false).rows;
    expect(rows.map((row) => row.title)).toEqual(["early", "used", "built", "paused-tool", "late"]);
  });

  test("runs each bar from the creation of the project to today", () => {
    const shown = timeline(projects, 2026, now);
    const early = shown.rows.find((row) => row.title === "early");
    expect(early?.start).toBe(0);
    expect(early?.end).toBeCloseTo(shown.today ?? -1, 5);
    const late = shown.rows.find((row) => row.title === "late");
    expect(late?.start).toBeGreaterThan(0.49);
    expect(late?.start).toBeLessThan(0.5);
  });

  test("starts a project of an earlier year at the edge, and says so", () => {
    const old = timeline(projects, 2026, now).rows.find((row) => row.title === "old");
    expect(old?.start).toBe(0);
    expect(old?.startsBefore).toBe(true);
  });

  test("fills a past year to its end, and leaves out a project that started after it", () => {
    const shown = timeline(projects, 2025, now);
    expect(shown.today).toBeNull();
    expect(shown.rows.map((row) => row.title)).toEqual(["old"]);
    expect(shown.rows[0]?.end).toBe(1);
  });

  test("marks the twelve months of a year", () => {
    const marks = timeline(projects, 2026, now).marks;
    expect(marks.map((mark) => mark.label)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(marks[0]?.at).toBe(0);
  });

  test("spans all the years from the oldest shown project, with a mark for each year", () => {
    const shown = timeline(projects, "all", now);
    expect(shown.marks.map((mark) => mark.label)).toEqual(["2025", "2026"]);
    expect(shown.rows.find((row) => row.title === "old")?.startsBefore).toBe(false);
  });

  test("shows no today line in a year after today", () => {
    const shown = timeline([project("2027-02-01-0000-ahead", "active")], 2027, now);
    expect(shown.today).toBeNull();
  });

  test("starts all the years at the oldest shown project, not at an older closed one", () => {
    const shown = timeline([project("2019-01-01-0000-dream", "closed"), ...projects], "all", now);
    expect(shown.marks[0]?.label).toBe("2025");
    const tool = project("2024-05-01-0000-tool", "closed", { inUse: true });
    expect(timeline([tool, ...projects], "all", now).marks[0]?.label).toBe("2024");
    // With the paused projects hidden, a paused project no longer sets the first year.
    expect(timeline(projects, "all", now, false).marks[0]?.label).toBe("2026");
  });

  test("names today by its day and month, for the label of the today line (#857)", () => {
    expect(todayLabel(now)).toBe("3 Nov");
  });

  test("shows no row and still has marks with no project", () => {
    const shown = timeline([], "all", now);
    expect(shown.rows).toEqual([]);
    expect(shown.marks.map((mark) => mark.label)).toEqual(["2026"]);
  });
});

describe("homeChats", () => {
  interface Chat {
    readonly id: string;
    readonly mode: "assistant" | "project";
    readonly archived: boolean;
    readonly closed: boolean;
    readonly lastTurnAt: string | null;
  }
  const chat = (id: string, overrides: Partial<Chat> = {}): Chat => ({
    id,
    mode: "project",
    archived: false,
    closed: false,
    lastTurnAt: "2026-11-01T10:00:00Z",
    ...overrides,
  });
  const states: Record<string, ChatState> = { b: "unread", c: "needs-you", d: "working" };
  const stateOf = (candidate: Chat): ChatState => states[candidate.id] ?? null;

  test("puts the chats that wait first, then the running chats, then the unread chats", () => {
    const chats = [chat("a"), chat("b"), chat("c"), chat("d")];
    expect(homeChats(chats, stateOf).needsYou.map((item) => [item.chat.id, item.state])).toEqual([
      ["c", "needs-you"],
      ["d", "working"],
      ["b", "unread"],
    ]);
  });

  test("shows the other chats as recent, in list order, five at most", () => {
    const chats = ["a", "e", "f", "g", "h", "i", "j"].map((id) => chat(id));
    expect(homeChats([chat("c"), ...chats], stateOf).recent.map((item) => item.id)).toEqual(["a", "e", "f", "g", "h"]);
  });

  test("leaves out Assistant chats, archived and closed chats, and chats with no turn", () => {
    const chats = [
      chat("a", { mode: "assistant" }),
      chat("e", { archived: true }),
      chat("f", { closed: true }),
      chat("g", { lastTurnAt: null }),
      chat("c", { archived: true }),
    ];
    expect(homeChats(chats, stateOf)).toEqual({ needsYou: [], recent: [] });
  });

  test("keeps a new chat that runs its first turn in Needs you", () => {
    expect(homeChats([chat("d", { lastTurnAt: null })], stateOf).needsYou.map((item) => item.chat.id)).toEqual(["d"]);
  });
});
