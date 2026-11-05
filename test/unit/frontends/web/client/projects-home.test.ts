import { describe, expect, test } from "bun:test";
import type { Project } from "../../../../../src/frontends/web/client/api.ts";
import type { ChatState } from "../../../../../src/frontends/web/client/chat-list.ts";
import {
  createdAt,
  defaultRange,
  chartLabels,
  homeChats,
  knownChoice,
  monthlyStatus,
  pointLabel,
  projectColor,
  projectInitials,
  projectYears,
  rangeChoiceOf,
  rangeChoices,
  rangeChoiceValue,
  rangeMarks,
  rangeOf,
  rangeWords,
  rowTooltip,
  statusCounts,
  timeline,
  todayLabel,
  type DateRange,
  type MonthPoint,
} from "../../../../../src/frontends/web/client/projects-home.ts";
import { parseProjectId } from "../../../../../src/core/projects/project-id.ts";
import type { ProjectStatus } from "../../../../../src/shared/project-statuses.ts";

/** A project with only the fields that the home page reads. */
function project(
  id: string,
  status: ProjectStatus | null,
  { inUse = false, closed = null }: { readonly inUse?: boolean; readonly closed?: string | null } = {},
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
      closed,
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

describe("rangeOf", () => {
  test("starts the default range 12 months before today, and ends it after today (#878)", () => {
    expect(defaultRange).toEqual({ kind: "last", months: 12 });
    expect(rangeOf(defaultRange, [], now)).toEqual({ from: new Date(2025, 10, 3), to: new Date(2026, 10, 4) });
  });

  test("goes one month or three years back", () => {
    expect(rangeOf({ kind: "last", months: 1 }, [], now).from).toEqual(new Date(2026, 9, 3));
    expect(rangeOf({ kind: "last", months: 36 }, [], now).from).toEqual(new Date(2023, 10, 3));
  });

  test("covers a whole year", () => {
    expect(rangeOf({ kind: "year", year: 2025 }, [], now)).toEqual({
      from: new Date(2025, 0, 1),
      to: new Date(2026, 0, 1),
    });
  });

  test("covers all the years from the oldest project, of any status, to the end of this year", () => {
    const projects = [project("2026-01-01-0000-a", "active"), project("2023-05-01-0000-b", "closed")];
    expect(rangeOf({ kind: "all" }, projects, now)).toEqual({ from: new Date(2023, 0, 1), to: new Date(2027, 0, 1) });
    expect(rangeOf({ kind: "all" }, [], now).from).toEqual(new Date(2026, 0, 1));
  });

  test("covers both days of a custom range, in either order", () => {
    const range = { from: new Date(2025, 6, 1), to: new Date(2026, 3, 1) };
    expect(rangeOf({ kind: "custom", from: "2025-07-01", to: "2026-03-31" }, [], now)).toEqual(range);
    expect(rangeOf({ kind: "custom", from: "2026-03-31", to: "2025-07-01" }, [], now)).toEqual(range);
  });

  test("reads a custom range with a bad day as the default range", () => {
    expect(rangeOf({ kind: "custom", from: "2026-02-30", to: "" }, [], now)).toEqual(rangeOf(defaultRange, [], now));
  });
});

describe("rangeWords", () => {
  test("names each kind of range for the counts", () => {
    expect(rangeWords({ kind: "last", months: 1 })).toBe("In the last month");
    expect(rangeWords({ kind: "last", months: 12 })).toBe("In the last 12 months");
    expect(rangeWords({ kind: "last", months: 36 })).toBe("In the last 3 years");
    expect(rangeWords({ kind: "year", year: 2025 })).toBe("In 2025");
    expect(rangeWords({ kind: "all" })).toBe("In all");
    expect(rangeWords({ kind: "custom", from: "2025-07-01", to: "2026-03-31" })).toBe("From 1 Jul 2025 to 31 Mar 2026");
  });
});

describe("rangeChoices", () => {
  test("offers the quick ranges, each year with a project, all and a custom range (#878)", () => {
    const projects = [project("2024-05-01-0000-a", "active")];
    expect(rangeChoices(projects, now).map((choice) => choice.label)).toEqual([
      "Last month",
      "Last 3 months",
      "Last 6 months",
      "Last 12 months",
      "Last 3 years",
      "2026",
      "2024",
      "All",
      "Custom range",
    ]);
  });

  test("gives each choice a value that reads back", () => {
    for (const choice of rangeChoices([], now)) {
      expect(rangeChoiceValue(rangeChoiceOf(choice.value, now))).toBe(choice.value);
    }
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
  const year2026 = { from: new Date(2026, 0, 1), to: new Date(2027, 0, 1) };

  test("counts the projects that started in the range, by status, and the ones in use (#859)", () => {
    expect(statusCounts(projects, year2026)).toEqual({ active: 2, "in-use": 2, paused: 0, started: 4 });
  });

  test("counts every project of a range that holds them all", () => {
    const all = { from: new Date(2025, 0, 1), to: new Date(2027, 0, 1) };
    expect(statusCounts(projects, all)).toEqual({ active: 2, "in-use": 2, paused: 1, started: 6 });
  });
});

describe("timeline", () => {
  const projects = [
    project("2026-07-01-0000-late", "active"),
    project("2026-01-01-0000-early", "active"),
    project("2025-06-01-0000-old", "paused"),
    project("2026-02-01-0000-used", "closed", { inUse: true, closed: "2026-08-01" }),
    project("2026-03-01-0000-built", "active", { inUse: true }),
    project("2026-04-01-0000-done", "closed", { closed: "2026-09-01" }),
  ];
  const year = (value: number): DateRange => ({ from: new Date(value, 0, 1), to: new Date(value + 1, 0, 1) });

  test("shows the projects of each shown status, once each, the oldest first, and marks the ones in use (#859)", () => {
    const rows = timeline(projects, year(2026), now, ["active", "paused", "closed"]).rows;
    expect(rows.map((row) => [row.title, row.status, row.inUse])).toEqual([
      ["old", "paused", false],
      ["early", "active", false],
      ["used", "closed", true],
      ["built", "active", true],
      ["done", "closed", false],
      ["late", "active", false],
    ]);
  });

  test("shows only the active projects by default, in use or not", () => {
    const rows = timeline(projects, year(2026), now).rows;
    expect(rows.map((row) => row.title)).toEqual(["early", "built", "late"]);
  });

  test("hides each status that the person turns off, Active too, also for a project in use", () => {
    const pausedTool = project("2026-05-01-0000-paused-tool", "paused", { inUse: true });
    const unsorted = project("2026-06-01-0000-unsorted", null);
    const rows = timeline([...projects, pausedTool, unsorted], year(2026), now, ["closed"]).rows;
    expect(rows.map((row) => row.title)).toEqual(["used", "done"]);
  });

  test("runs each bar from the creation of the project to today", () => {
    const shown = timeline(projects, year(2026), now);
    const early = shown.rows.find((row) => row.title === "early");
    expect(early?.start).toBe(0);
    expect(early?.end).toBeCloseTo(shown.today ?? -1, 5);
    const late = shown.rows.find((row) => row.title === "late");
    expect(late?.start).toBeGreaterThan(0.49);
    expect(late?.start).toBeLessThan(0.5);
  });

  test("ends the bar of a closed project at the end of its closing day", () => {
    const closed = project("2026-02-01-0000-gone", "closed", { closed: "2026-05-31" });
    const shown = timeline([closed], year(2026), now, ["closed"]);
    expect(shown.rows[0]?.end).toBeCloseTo(
      (new Date(2026, 5, 1).getTime() - new Date(2026, 0, 1).getTime()) /
        (new Date(2027, 0, 1).getTime() - new Date(2026, 0, 1).getTime()),
      5,
    );
  });

  test("hides a closed project that closed before the range, or that has no closing day", () => {
    const before = project("2024-02-01-0000-before", "closed", { closed: "2025-12-31" });
    const unknown = project("2026-02-01-0000-unknown", "closed");
    const inside = project("2025-02-01-0000-inside", "closed", { closed: "2026-01-01" });
    const rows = timeline([before, unknown, inside], year(2026), now, ["closed"]).rows;
    expect(rows.map((row) => row.title)).toEqual(["inside"]);
  });

  test("starts a project of an earlier year at the edge, and says so", () => {
    const old = timeline(projects, year(2026), now, ["paused"]).rows.find((row) => row.title === "old");
    expect(old?.start).toBe(0);
    expect(old?.startsBefore).toBe(true);
  });

  test("fills a past year to its end, and leaves out a project that started after it", () => {
    const shown = timeline(projects, year(2025), now, ["paused"]);
    expect(shown.today).toBeNull();
    expect(shown.rows.map((row) => row.title)).toEqual(["old"]);
    expect(shown.rows[0]?.end).toBe(1);
  });

  test("marks the twelve months of a year", () => {
    const marks = timeline(projects, year(2026), now).marks;
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

  test("shows no today line in a range after today", () => {
    const shown = timeline([project("2027-02-01-0000-ahead", "active")], year(2027), now);
    expect(shown.today).toBeNull();
  });

  test("names today by its day and month, for the label of the today line (#857)", () => {
    expect(todayLabel(now)).toBe("3 Nov");
  });

  test("shows no row and still has marks with no project", () => {
    const shown = timeline([], year(2026), now);
    expect(shown.rows).toEqual([]);
    expect(shown.marks).toHaveLength(12);
  });
});

describe("rowTooltip", () => {
  const range: DateRange = { from: new Date(2026, 4, 3), to: new Date(2026, 10, 4) };
  const tooltipOf = (shownProject: Project, status: ProjectStatus = "closed"): string => {
    const row = timeline([shownProject], range, now, [status]).rows[0];
    if (row === undefined) throw new Error("No row");
    return rowTooltip(row, now);
  };

  test("gives the title, the status and the dates with the duration, one per line (#893)", () => {
    const done = project("2026-08-31-1000-news-map", "closed", { closed: "2026-10-04" });
    expect(tooltipOf(done)).toBe("news-map\nClosed\n31 Aug – 4 Oct 2026 · 35 days");
  });

  test("names In use after the status", () => {
    const used = project("2026-08-31-1000-news-map", "closed", { inUse: true, closed: "2026-10-04" });
    expect(tooltipOf(used).split("\n")[1]).toBe("Closed · In use");
  });

  test("counts a project that closed on the day it started as one day", () => {
    const quick = project("2026-08-30-1000-converter", "closed", { closed: "2026-08-30" });
    expect(tooltipOf(quick).split("\n")[2]).toBe("30 Aug – 30 Aug 2026 · 1 day");
  });

  test("ends an open project today, and gives the year of a start in another year", () => {
    const old = project("2025-02-10-0900-old-work", "active");
    expect(tooltipOf(old, "active").split("\n")[2]).toBe("10 Feb 2025 – today · 1 year 8 months");
  });

  test("gives no year to an open project of this year", () => {
    const fresh = project("2026-08-10-0900-fresh", "active");
    expect(tooltipOf(fresh, "active").split("\n")[2]).toBe("10 Aug – today · 2 months");
  });

  test("gives only what a short id knows of the start: the year, or the month", () => {
    expect(tooltipOf(project("2025-old-work", "active"), "active").split("\n")[2]).toBe(
      "2025 – today · 1 year 10 months",
    );
    expect(tooltipOf(project("2026-03-spring", "active"), "active").split("\n")[2]).toBe("Mar – today · 8 months");
    expect(tooltipOf(project("2025-03-spring", "active"), "active").split("\n")[2]).toBe(
      "Mar 2025 – today · 1 year 8 months",
    );
  });

  test("gives only the start day when the end comes before it, as a wrong closed day does", () => {
    const flipped = project("2026-10-04-0900-flipped", "closed", { closed: "2026-08-31" });
    expect(tooltipOf(flipped).split("\n")[2]).toBe("4 Oct 2026 · 1 day");
  });

  test("counts days up to two whole months, then whole months, then years", () => {
    expect(tooltipOf(project("2026-09-05-0900-weeks", "active"), "active").split("\n")[2]).toBe(
      "5 Sep – today · 60 days",
    );
    expect(tooltipOf(project("2025-11-03-0900-year", "active"), "active").split("\n")[2]).toBe(
      "3 Nov 2025 – today · 1 year",
    );
    expect(tooltipOf(project("2023-10-01-0900-years", "active"), "active").split("\n")[2]).toBe(
      "1 Oct 2023 – today · 3 years 1 month",
    );
  });
});

describe("rangeMarks", () => {
  test("marks each week of a short range", () => {
    const marks = rangeMarks({ from: new Date(2026, 9, 3), to: new Date(2026, 10, 4) });
    expect(marks.map((mark) => mark.label)).toEqual(["3 Oct", "10 Oct", "17 Oct", "24 Oct", "31 Oct"]);
    expect(marks[0]?.at).toBe(0);
  });

  test("names the year at January in a range of more than one year, and leaves out a mark at the right edge", () => {
    const marks = rangeMarks({ from: new Date(2025, 10, 3), to: new Date(2026, 10, 4) });
    expect(marks.map((mark) => mark.label)).toEqual([
      "Dec",
      "2026",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
    ]);
  });

  test("keeps twelve marks at most in two years", () => {
    const marks = rangeMarks({ from: new Date(2025, 0, 1), to: new Date(2027, 0, 1) });
    expect(marks.map((mark) => mark.label)).toEqual([
      "2025",
      "Mar",
      "May",
      "Jul",
      "Sep",
      "Nov",
      "2026",
      "Mar",
      "May",
      "Jul",
      "Sep",
      "Nov",
    ]);
  });

  test("marks each year of a longer range", () => {
    const marks = rangeMarks({ from: new Date(2023, 10, 3), to: new Date(2026, 10, 4) });
    expect(marks.map((mark) => mark.label)).toEqual(["2024", "2025", "2026"]);
  });
});

describe("monthlyStatus", () => {
  const range = { from: new Date(2026, 6, 15), to: new Date(2026, 10, 4) };

  test("has one point on day 1 of each month, from the month of the range start to today (#878)", () => {
    const points = monthlyStatus([], range, now);
    expect(points.map((point) => point.at)).toEqual([
      new Date(2026, 6, 1),
      new Date(2026, 7, 1),
      new Date(2026, 8, 1),
      new Date(2026, 9, 1),
      new Date(2026, 10, 1),
    ]);
  });

  test("stops at the end of a past range", () => {
    const points = monthlyStatus([], { from: new Date(2025, 0, 1), to: new Date(2026, 0, 1) }, now);
    expect(points).toHaveLength(12);
    expect(points.at(-1)?.at).toEqual(new Date(2025, 11, 1));
  });

  test("counts each open project with its status of today, from its creation", () => {
    const projects = [
      project("2026-07-20-1000-a", "active"),
      project("2026-08-01-0000-b", "paused"),
      project("2026-09-10-1000-c", "active", { inUse: true }),
      project("2026-08-05-1000-d", null),
    ];
    const points = monthlyStatus(projects, range, now);
    expect(points.map((point) => [point.active, point.paused])).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
      [2, 1],
      [2, 1],
    ]);
  });

  test("counts a closed project as active until its closing day, then as closed in the month after", () => {
    const projects = [project("2026-06-01-0000-a", "closed", { closed: "2026-09-12" })];
    const points = monthlyStatus(projects, range, now);
    expect(points.map((point) => [point.active, point.closed])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
  });

  test("leaves out a closed project with no closing day", () => {
    const projects = [project("2026-06-01-0000-a", "closed")];
    expect(monthlyStatus(projects, range, now).every((point) => point.active + point.closed === 0)).toBe(true);
  });

  test("names each point by its day", () => {
    expect(pointLabel(new Date(2026, 10, 1))).toBe("1 Nov 2026");
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

describe("chartLabels", () => {
  const point = (year: number, month: number): MonthPoint => ({
    at: new Date(year, month, 1),
    active: 0,
    paused: 0,
    closed: 0,
  });

  test("names each month, and the year at January when the points cross a year", () => {
    expect(chartLabels([point(2025, 11), point(2026, 0), point(2026, 1)])).toEqual(["Dec", "2026", "Feb"]);
    expect(chartLabels([point(2026, 0), point(2026, 1)])).toEqual(["Jan", "Feb"]);
  });

  test("names six points at most, and leaves the others empty", () => {
    const points = Array.from({ length: 13 }, (_, index) => point(2025, 10 + index));
    expect(chartLabels(points)).toEqual(["Nov", "", "", "Feb", "", "", "May", "", "", "Aug", "", "", "Nov"]);
  });
});

describe("knownChoice", () => {
  test("keeps a year with a project, and turns a year with none into the default range", () => {
    const projects = [project("2024-05-01-0000-a", "active")];
    expect(knownChoice({ kind: "year", year: 2024 }, projects, now)).toEqual({ kind: "year", year: 2024 });
    expect(knownChoice({ kind: "year", year: 2020 }, projects, now)).toEqual(defaultRange);
    expect(knownChoice({ kind: "all" }, projects, now)).toEqual({ kind: "all" });
  });
});

describe("rangeOf at the end of a month", () => {
  test("goes back to the last day of a shorter month, not into the next month", () => {
    expect(rangeOf({ kind: "last", months: 1 }, [], new Date(2027, 2, 31, 9)).from).toEqual(new Date(2027, 1, 28));
    expect(rangeOf({ kind: "last", months: 12 }, [], new Date(2028, 1, 29, 9)).from).toEqual(new Date(2027, 1, 28));
  });

  test("starts a new custom range on the last day of a shorter month", () => {
    expect(rangeChoiceOf("custom", new Date(2027, 2, 31, 9))).toEqual({
      kind: "custom",
      from: "2027-02-28",
      to: "2027-03-31",
    });
  });
});
