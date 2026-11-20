import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WidgetInput } from "../../../../src/core/widgets/widget-contract.ts";
import { createDefaultFolder, defaultPlace, keepFileName } from "../../../../src/core/widgets/widget-defaults.ts";
import { answerData } from "../../../../src/core/widgets/widget-data.ts";
import { defaultPath } from "../../../../src/core/widgets/widget-places.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

const base = { label: "Habits folder", description: "d", why: "w", required: true } as const;
const folderInput: WidgetInput = {
  ...base,
  id: "habits",
  type: "folder",
  access: "write",
  schema: "schemas/habits.json",
  files: "*.json",
  default: "Life/Health/Habits",
};

let folder: string;
let vault: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-widget-defaults-"));
  vault = join(folder, "vault");
  mkdirSync(join(vault, "Life"), { recursive: true });
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("defaultPath", () => {
  test("gives the default of a folder or a file input, as a path from the vault root", () => {
    expect(defaultPath(folderInput)).toBe("Life/Health/Habits");
    expect(defaultPath({ ...folderInput, default: " Life/Health/Habits/ " })).toBe("Life/Health/Habits");
    expect(defaultPath({ ...base, id: "note", type: "file", access: "read", default: "Notes/a.md" })).toBe(
      "Notes/a.md",
    );
  });

  test("gives nothing for another input, no default, or a place that no widget reaches", () => {
    expect(defaultPath({ ...base, id: "title", type: "text", default: "Habits" })).toBeNull();
    expect(defaultPath({ ...folderInput, default: undefined })).toBeNull();
    for (const bad of [
      3,
      "",
      "/Life/Habits",
      "../outside",
      "Life/../..",
      ".eva/data",
      ".git",
      "Life/.hidden",
      "Scratch/Habits",
      "Projects/2026-01-01-0000-example-app/repos/clone-1",
      "Life/About me.md",
      "Life\\Habits",
      "C:/Habits",
    ]) {
      expect(defaultPath({ ...folderInput, default: bad })).toBeNull();
    }
  });
});

describe("defaultPlace", () => {
  test("says whether the default is a folder, a file, or a folder that Eva can create", () => {
    expect(defaultPlace(vault, "Life/Health/Habits")).toBe("missing");
    mkdirSync(join(vault, "Life/Health/Habits"), { recursive: true });
    expect(defaultPlace(vault, "Life/Health/Habits")).toBe("folder");
    writeFileSync(join(vault, "Life/Health/Habits/walk.json"), "{}\n");
    expect(defaultPlace(vault, "Life/Health/Habits/walk.json")).toBe("file");
  });

  test("refuses a place on a file, a closed place, or a link", () => {
    writeFileSync(join(vault, "Life/Notes"), "a file\n");
    expect(defaultPlace(vault, "Life/Notes/Habits")).toBeNull();
    expect(defaultPlace(vault, ".eva/Habits")).toBeNull();
    try {
      mkdirSync(join(folder, "outside"));
      symlinkSync(join(folder, "outside"), join(vault, "Life/Linked"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    expect(defaultPlace(vault, "Life/Linked")).toBeNull();
    expect(defaultPlace(vault, "Life/Linked/Habits")).toBeNull();
  });
});

describe("createDefaultFolder", () => {
  test("creates the folder and each missing parent, with a file that keeps it in git", () => {
    createDefaultFolder(vault, "Life/Health/Habits");
    expect(readdirSync(join(vault, "Life/Health/Habits"))).toEqual([keepFileName]);
    expect(keepFileName).toBe(".gitkeep");
    expect(defaultPlace(vault, "Life/Health/Habits")).toBe("folder");
  });

  test("leaves a folder that exists as it is", () => {
    mkdirSync(join(vault, "Life/Health/Habits"), { recursive: true });
    writeFileSync(join(vault, "Life/Health/Habits/walk.json"), "{}\n");
    createDefaultFolder(vault, "Life/Health/Habits");
    expect(readdirSync(join(vault, "Life/Health/Habits"))).toEqual(["walk.json"]);
  });

  test("refuses each place that no widget reaches, and creates nothing there", () => {
    for (const bad of [".eva/Habits", "Scratch/Habits", "Projects/x/repos/clone-1/Habits", "../outside", ""]) {
      expect(() => createDefaultFolder(vault, bad)).toThrow(EvaError);
    }
    expect(existsSync(join(vault, ".eva"))).toBe(false);
    expect(existsSync(join(vault, "Scratch"))).toBe(false);
    expect(existsSync(join(folder, "outside"))).toBe(false);
    writeFileSync(join(vault, "Life/Notes"), "a file\n");
    expect(() => createDefaultFolder(vault, "Life/Notes/Habits")).toThrow(EvaError);
  });

  test("gives the widget an empty list for the new folder, without the hidden file", () => {
    createDefaultFolder(vault, "Life/Health/Habits");
    const approved = {
      input: "habits",
      type: "folder" as const,
      path: "Life/Health/Habits",
      access: "write" as const,
      files: "*",
      schema: null,
    };
    const answer = answerData(vault, approved, "index.json", "GET", null);
    expect(answer.status).toBe(200);
    const body = typeof answer.body === "string" ? answer.body : new TextDecoder().decode(answer.body);
    expect(JSON.parse(body)).toEqual([]);
  });
});
