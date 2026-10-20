import { describe, expect, test } from "bun:test";
import {
  changesPill,
  countOf,
  projectFolder,
  projectSummary,
  repositoryLabel,
  statusPill,
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

describe("repositoryLabel", () => {
  test("drops the scheme, the user and .git", () => {
    expect(repositoryLabel("https://github.com/example/example-app.git")).toBe("github.com/example/example-app");
    expect(repositoryLabel("https://token@github.com/example/example-app/")).toBe("github.com/example/example-app");
    expect(repositoryLabel("ssh://git@github.com/example/example-app.git")).toBe("github.com/example/example-app");
    expect(repositoryLabel("git@github.com:example/example-app.git")).toBe("github.com:example/example-app");
    expect(repositoryLabel("/srv/git/remote.git")).toBe("/srv/git/remote");
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
