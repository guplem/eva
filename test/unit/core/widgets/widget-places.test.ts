import { describe, expect, test } from "bun:test";
import {
  isClosedPlace,
  isPlainName,
  isWritableName,
  matchesFiles,
  openPath,
  pathSegments,
} from "../../../../src/core/widgets/widget-places.ts";

describe("isPlainName", () => {
  test("takes a plain file or folder name", () => {
    for (const name of ["Habits", "walk.json", "2026-01-01.yaml", "My notes", "a~b"])
      expect(isPlainName(name)).toBe(true);
  });

  test("refuses each name that can mean another place", () => {
    for (const name of [
      "",
      ".",
      "..",
      ".git",
      ".eva",
      "name.",
      "name ",
      "file.json:stream",
      "back\\slash",
      "%2e%2e",
      "ABOUTM~1.MD",
      "nul\u0000",
      "a?b",
      "x".repeat(256),
    ]) {
      expect(isPlainName(name)).toBe(false);
    }
  });
});

describe("pathSegments and openPath", () => {
  test("split a plain path", () => {
    expect(pathSegments("Life/Habits/walk.json")).toEqual(["Life", "Habits", "walk.json"]);
    expect(openPath("Life/Habits")).toEqual(["Life", "Habits"]);
  });

  test("refuse a path with an empty, a dot or a hidden segment", () => {
    for (const path of ["", "/Life", "Life//Habits", "Life/../.eva", "Life/./x", "Life/Habits/", ".git/config"]) {
      expect(openPath(path)).toBeNull();
    }
  });

  test("refuse the closed places at any depth and in any case", () => {
    for (const path of [
      "Scratch",
      "scratch/note.md",
      "Projects/2026-01-01-0900-app/repos",
      "projects/2026-01-01-0900-app/REPOS/clone-1/app/a.json",
      "Life/About me.md",
      "life/ABOUT ME.MD",
    ]) {
      expect(openPath(path)).toBeNull();
    }
    expect(openPath("Projects/2026-01-01-0900-app/notes")).toEqual(["Projects", "2026-01-01-0900-app", "notes"]);
    expect(openPath("Life/About you.md")).toEqual(["Life", "About you.md"]);
    expect(isClosedPlace([])).toBe(true);
    expect(isClosedPlace([""])).toBe(true);
  });
});

describe("isWritableName", () => {
  test("takes a JSON or YAML data file", () => {
    for (const name of ["walk.json", "day.yaml", "day.YML"]) expect(isWritableName(name)).toBe(true);
  });

  test("refuses rule files, hidden files and other types", () => {
    for (const name of ["AGENTS.md", "agents.json", "README.md", "notes.md", ".hidden.json", "script.js"]) {
      expect(isWritableName(name)).toBe(name === "agents.json");
    }
    expect(isWritableName("data_format.md")).toBe(false);
  });
});

describe("matchesFiles", () => {
  test("matches * and ? within one name, without case", () => {
    expect(matchesFiles("*.json", "walk.json")).toBe(true);
    expect(matchesFiles("*.json", "WALK.JSON")).toBe(true);
    expect(matchesFiles("*.json", "walk.yaml")).toBe(false);
    expect(matchesFiles("????-??-??.json", "2026-01-01.json")).toBe(true);
    expect(matchesFiles("????-??-??.json", "2026-1-01.json")).toBe(false);
    expect(matchesFiles("a.b-c", "a.b-c")).toBe(true);
    expect(matchesFiles("a.b", "axb")).toBe(false);
  });
});
