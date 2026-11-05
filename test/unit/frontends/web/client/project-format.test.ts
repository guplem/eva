import { describe, expect, test } from "bun:test";
import type { Project } from "../../../../../src/frontends/web/client/api.ts";
import {
  changesPill,
  canPush,
  countOf,
  projectFolder,
  projectSummary,
  shownTags,
  tagsByUse,
  removedRepositoriesHint,
  repositoryLabel,
  sameDetails,
  localDay,
  withStatus,
  closingDate,
  repositoryWebUrl,
  statusPill,
  inUsePill,
  statusChips,
  inUseChips,
  defaultListFilter,
  toggledStatus,
  toggledInUse,
  matchesListFilter,
  listFilterOf,
  syncPills,
  widgetRepositoryNames,
} from "../../../../../src/frontends/web/client/project-format.ts";

describe("countOf", () => {
  test("says one thing or many things", () => {
    expect(countOf(1, "warning")).toBe("1 warning");
    expect(countOf(3, "warning")).toBe("3 warnings");
    expect(countOf(0, "chat")).toBe("0 chats");
  });
});

describe("statusPill", () => {
  test("gives each status its word and its colour", () => {
    expect(statusPill("active")).toEqual({ text: "Active", tone: "ok" });
    expect(statusPill("paused")).toEqual({ text: "Paused", tone: "warn" });
    expect(statusPill("closed")).toEqual({ text: "Closed", tone: "idle" });
    expect(statusPill(null)).toBeNull();
  });
});

describe("inUsePill", () => {
  test("shows In use in the accent colour beside the status, and nothing for a project not in use (#859)", () => {
    expect(inUsePill(true)).toEqual({ text: "In use", tone: "live" });
    expect(inUsePill(false)).toBeNull();
  });
});

describe("the list filters (#885)", () => {
  test("offer All and each status, and All, In use and Not in use", () => {
    expect(statusChips.map((chip) => chip.text)).toEqual(["All", "Active", "Paused", "Closed"]);
    expect(inUseChips.map((chip) => chip.text)).toEqual(["All", "In use", "Not in use"]);
  });

  test("open on the active projects, in use or not", () => {
    expect(defaultListFilter).toEqual({ statuses: ["active"], inUse: "all" });
  });

  test("a tap on a status adds it or takes it away, and every status reads as All", () => {
    expect(toggledStatus(["active"], "closed")).toEqual(["active", "closed"]);
    expect(toggledStatus(["closed", "active"], "active")).toEqual(["closed"]);
    expect(toggledStatus([], "paused")).toEqual(["paused"]);
    expect(toggledStatus(["active", "paused"], "closed")).toEqual([]);
  });

  test("a tap on In use or Not in use picks it, and picking both reads as All", () => {
    expect(toggledInUse("all", "in-use")).toBe("in-use");
    expect(toggledInUse("in-use", "not-in-use")).toBe("all");
    expect(toggledInUse("not-in-use", "not-in-use")).toBe("all");
  });

  test("a project shows when it matches both filters", () => {
    const project = (
      status: "active" | "paused" | "closed" | null,
      inUse: boolean,
    ): { status: "active" | "paused" | "closed" | null; inUse: boolean } => ({ status, inUse });
    const both = { statuses: ["active", "closed"] as const, inUse: "all" as const };
    expect(matchesListFilter(project("closed", false), both)).toBe(true);
    expect(matchesListFilter(project("paused", false), both)).toBe(false);
    expect(matchesListFilter(project(null, false), both)).toBe(false);
    expect(matchesListFilter(project(null, false), { statuses: [], inUse: "all" })).toBe(true);
    expect(matchesListFilter(project("closed", true), { statuses: [], inUse: "in-use" })).toBe(true);
    expect(matchesListFilter(project("closed", false), { statuses: [], inUse: "in-use" })).toBe(false);
    expect(matchesListFilter(project("active", true), { statuses: ["active"], inUse: "not-in-use" })).toBe(false);
    expect(matchesListFilter(project("active", false), { statuses: ["active"], inUse: "not-in-use" })).toBe(true);
  });

  test("a count of the statistics sets the filters", () => {
    expect(listFilterOf("active")).toEqual({ statuses: ["active"], inUse: "all" });
    expect(listFilterOf("paused")).toEqual({ statuses: ["paused"], inUse: "all" });
    expect(listFilterOf("in-use")).toEqual({ statuses: [], inUse: "in-use" });
  });
});

describe("projectSummary", () => {
  test("counts the clones and the chats, and leaves out what is zero", () => {
    expect(projectSummary(0, 0)).toBe("No clones yet");
    expect(projectSummary(1, 0)).toBe("1 clone");
    expect(projectSummary(1, 1)).toBe("1 clone · 1 chat");
    expect(projectSummary(2, 3)).toBe("2 clones · 3 chats");
    // A chat can outlive its clone folder.
    expect(projectSummary(0, 2)).toBe("No clones yet · 2 chats");
  });

  test("a general project has no clones, so it counts its chats only (#768)", () => {
    expect(projectSummary(0, 0, "general")).toBe("General · No chats yet");
    expect(projectSummary(0, 3, "general")).toBe("General · 3 chats");
  });

  test("a specialist has no clones, so it counts its chats only (#703)", () => {
    expect(projectSummary(0, 0, "specialist")).toBe("Specialist · No chats yet");
    expect(projectSummary(0, 2, "specialist")).toBe("Specialist · 2 chats");
  });
});

describe("changesPill", () => {
  test("says Clean or counts the changes, and says nothing when git did not answer", () => {
    expect(changesPill(0)).toEqual({ text: "Clean", tone: "ok" });
    expect(changesPill(1)).toEqual({ text: "1 change", tone: "warn" });
    expect(changesPill(3)).toEqual({ text: "3 changes", tone: "warn" });
    expect(changesPill(null)).toBeNull();
  });
});

describe("syncPills", () => {
  test("counts the commits to pull and to push, and says nothing for a level or unknown clone", () => {
    expect(syncPills(0, 0)).toEqual([]);
    expect(syncPills(null, null)).toEqual([]);
    expect(syncPills(1, 2)).toEqual([
      { text: "2 to pull", tone: "warn" },
      { text: "1 to push", tone: "warn" },
    ]);
  });
});

describe("canPush", () => {
  test("a clone with changes or local commits can push, and a clean level one cannot", () => {
    expect(canPush({ changes: 2, ahead: 0 })).toBe(true);
    expect(canPush({ changes: 0, ahead: 1 })).toBe(true);
    expect(canPush({ changes: 0, ahead: 0 })).toBe(false);
    expect(canPush({ changes: null, ahead: null })).toBe(false);
  });
});

describe("repositoryLabel", () => {
  test("drops the scheme, the user and .git", () => {
    expect(repositoryLabel("https://github.com/example/example-app.git")).toBe("github.com/example/example-app");
    expect(repositoryLabel("https://token@github.com/example/example-app/")).toBe("github.com/example/example-app");
    expect(repositoryLabel("ssh://git@github.com/example/example-app.git")).toBe("github.com/example/example-app");
    expect(repositoryLabel("git@github.com:example/example-app.git")).toBe("github.com:example/example-app");
    expect(repositoryLabel("/srv/git/remote.git")).toBe("/srv/git/remote");
    expect(repositoryLabel("https://user:to@ken@github.com/example/example-app")).toBe(
      "github.com/example/example-app",
    );
    expect(repositoryLabel("https://user:to/ken@github.com/example/example-app")).toBe(
      "github.com/example/example-app",
    );
    expect(repositoryLabel("https://github.com/example/example-app@v2")).toBe("github.com/example/example-app@v2");
    expect(repositoryLabel("https://github.com/example/example-app.git?token=abc#readme")).toBe(
      "github.com/example/example-app",
    );
  });
});

describe("repositoryWebUrl", () => {
  test("gives the web page of a hosted repository", () => {
    expect(repositoryWebUrl("https://github.com/example/example-app.git")).toBe(
      "https://github.com/example/example-app",
    );
    expect(repositoryWebUrl("git@github.com:example/example-app.git")).toBe("https://github.com/example/example-app");
    expect(repositoryWebUrl("ssh://git@github.com:22/example/example-app.git")).toBe(
      "https://github.com/example/example-app",
    );
    expect(repositoryWebUrl("github.com/example/example-app")).toBe("https://github.com/example/example-app");
  });

  test("keeps the scheme and the port of a web address, but not the port of SSH", () => {
    expect(repositoryWebUrl("https://git.example.com:8443/example/example-app.git")).toBe(
      "https://git.example.com:8443/example/example-app",
    );
    expect(repositoryWebUrl("http://git.example.com/example/example-app")).toBe(
      "http://git.example.com/example/example-app",
    );
    expect(repositoryWebUrl("git@github.com:/example/example-app.git")).toBe("https://github.com/example/example-app");
    expect(repositoryWebUrl("git@github.com:example/example-app.git#readme")).toBe(
      "https://github.com/example/example-app",
    );
    expect(repositoryWebUrl("  https://github.com/example/example-app  ")).toBe(
      "https://github.com/example/example-app",
    );
  });

  test("never keeps a token", () => {
    expect(repositoryWebUrl("https://user:token@github.com/example/example-app")).toBe(
      "https://github.com/example/example-app",
    );
    expect(repositoryWebUrl("https://user:to@ken@github.com/example/example-app")).toBe(
      "https://github.com/example/example-app",
    );
    // A slash in a password breaks the address, so no part of it may become a link.
    expect(repositoryWebUrl("https://user:to/ken@github.com/example/example-app")).toBeNull();
  });

  test("gives null for a repository with no web page", () => {
    expect(repositoryWebUrl("/srv/git/remote.git")).toBeNull();
    expect(repositoryWebUrl("C:\\git\\remote.git")).toBeNull();
    expect(repositoryWebUrl("file:///srv/git/remote.git")).toBeNull();
    expect(repositoryWebUrl("example-app")).toBeNull();
  });
});

describe("projectFolder", () => {
  test("keeps the root folder and the project folder, with either separator", () => {
    expect(projectFolder("/vault/Projects/2026-10-12-0930-example-app")).toBe("Projects/2026-10-12-0930-example-app");
    expect(projectFolder("C:\\vault\\Projects\\2026-10-12-0930-example-app")).toBe(
      "Projects/2026-10-12-0930-example-app",
    );
    expect(projectFolder("2026-10-12-0930-example-app")).toBe("2026-10-12-0930-example-app");
  });
});

describe("tagsByUse", () => {
  const withTags = (...tags: string[]): Project => ({ frontMatter: { tags } }) as unknown as Project;

  test("puts the most used tag first, then sorts by name, and ignores case", () => {
    const projects = [withTags("game", "App"), withTags("app", "hobby"), withTags("zoo", "app"), withTags("hobby")];
    expect(tagsByUse(projects)).toEqual(["app", "hobby", "game", "zoo"]);
  });
});

describe("shownTags", () => {
  const tags = ["a", "b", "c", "d", "e"];

  test("shows only the first tags while the list is short", () => {
    expect(shownTags(tags, "", false, 3)).toEqual({ shown: ["a", "b", "c"], hidden: 2 });
  });

  test("keeps the chosen tag in view when it is hidden", () => {
    expect(shownTags(tags, "e", false, 3)).toEqual({ shown: ["a", "b", "c", "e"], hidden: 1 });
  });

  test("shows every tag when the list is open", () => {
    expect(shownTags(tags, "", true, 3)).toEqual({ shown: tags, hidden: 0 });
  });

  test("hides nothing when the tags fit", () => {
    expect(shownTags(["a", "b"], "", false, 3)).toEqual({ shown: ["a", "b"], hidden: 0 });
  });
});

describe("removedRepositoriesHint", () => {
  const app = "https://github.com/example/example-app";
  const docs = "https://github.com/example/example-docs";

  test("says nothing while no saved repository is gone", () => {
    expect(removedRepositoriesHint([app], [app])).toBeNull();
    expect(removedRepositoriesHint([app], [app, docs])).toBeNull();
  });

  test("names each removed repository and says that its clones stay", () => {
    expect(removedRepositoriesHint([app, docs], [docs])).toBe(
      "Save to remove github.com/example/example-app. Its clones stay in the project.",
    );
    expect(removedRepositoriesHint([app, docs], [])).toBe(
      "Save to remove github.com/example/example-app and github.com/example/example-docs. Their clones stay in the project.",
    );
  });
});

describe("widgetRepositoryNames", () => {
  test("names the folder of each widget repository, as a clone does", () => {
    const frontMatter = {
      repos: ["https://github.com/example/habits.git", "https://github.com/example/example-app", "git@host:o/w/"],
      repoTypes: {
        "https://github.com/example/habits.git": "widget",
        "https://github.com/example/example-app": "standard",
        "git@host:o/w/": "widget",
      },
    };
    expect([...widgetRepositoryNames({ frontMatter } as unknown as Project)]).toEqual(["habits", "w"]);
  });
});

describe("sameDetails", () => {
  const details = { title: "House", status: "active" as const, tags: ["home"], repos: [] };

  test("a missing type is general, as the form shows it (#768)", () => {
    expect(sameDetails(details, { ...details, type: "general" })).toBe(true);
    expect(sameDetails(details, { ...details, type: "software" })).toBe(false);
  });

  test("a changed title, status, in-use flag, tag or repository differs", () => {
    expect(sameDetails(details, { ...details, title: "Home" })).toBe(false);
    expect(sameDetails(details, { ...details, inUse: true })).toBe(false);
    expect(sameDetails(details, { ...details, inUse: false })).toBe(true);
    expect(sameDetails(details, { ...details, status: "paused" })).toBe(false);
    expect(sameDetails(details, { ...details, tags: [] })).toBe(false);
    expect(sameDetails(details, { ...details, repos: ["https://github.com/example/example-app"] })).toBe(false);
  });
});

describe("the closing date in the details form (#826)", () => {
  const details = { title: "House", status: "active" as const, tags: [], repos: [], closed: null };

  test("a choice of Closed sets the date to today, and the person can pick another one", () => {
    expect(withStatus(details, "closed", "2026-11-03")).toEqual({ ...details, status: "closed", closed: "2026-11-03" });
    const picked = { ...details, status: "closed" as const, closed: "2026-10-01" };
    expect(withStatus(picked, "closed", "2026-11-03").closed).toBe("2026-10-01");
  });

  test("a choice of another status and then Closed again keeps the saved date", () => {
    // The save removes the date of a project that is not closed, so the form keeps it meanwhile.
    const closed = { ...details, status: "closed" as const, closed: "2026-10-01" };
    const paused = withStatus(closed, "paused", "2026-11-03");
    expect(paused.status).toBe("paused");
    expect(withStatus(paused, "closed", "2026-11-03").closed).toBe("2026-10-01");
  });

  test("an empty date is no date, so a choice of Closed starts at today", () => {
    expect(closingDate("")).toBeNull();
    expect(closingDate("2026-10-01")).toBe("2026-10-01");
    expect(withStatus({ ...details, closed: "" }, "closed", "2026-11-03").closed).toBe("2026-11-03");
  });

  test("a changed date differs, and a missing one is no date", () => {
    expect(sameDetails(details, { ...details, closed: "2026-10-01" })).toBe(false);
    expect(sameDetails({ ...details, closed: undefined }, details)).toBe(true);
  });

  test("today is the day on the person's clock", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("a status choice in the details form (#859)", () => {
  test("a choice of Active or Paused changes only the status: no status starts the work", () => {
    const details = { title: "House", status: "paused" as const, tags: [], repos: [], closed: null };
    expect(withStatus(details, "active", "2026-11-03")).toEqual({ ...details, status: "active" });
  });
});
