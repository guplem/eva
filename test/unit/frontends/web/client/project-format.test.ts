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
  repositoryLabel,
  repositoryWebUrl,
  statusPill,
  syncPills,
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
    expect(statusPill("idea")).toEqual({ text: "Idea", tone: "idle" });
    expect(statusPill("paused")).toEqual({ text: "Paused", tone: "warn" });
    expect(statusPill("closed")).toEqual({ text: "Closed", tone: "idle" });
    expect(statusPill(null)).toBeNull();
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

  test("never keeps a token", () => {
    expect(repositoryWebUrl("https://user:token@github.com/example/example-app")).toBe(
      "https://github.com/example/example-app",
    );
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
