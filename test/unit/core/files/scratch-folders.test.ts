import { describe, expect, test } from "bun:test";
import { isScratchPath, scratchFolderOf } from "../../../../src/core/files/scratch-folders.ts";

describe("isScratchPath (#767)", () => {
  test.each([
    ".eva/scratch",
    ".eva/scratch/a.pdf",
    ".EVA/Scratch/received/a.jpg",
    ".eva\\scratch\\a.pdf",
    "Scratch",
    "scratch/a.pdf",
    "./.eva/scratch/x",
    ".eva//scratch/x",
    "Methods/../.eva/scratch/x.pdf",
    ".eva/scratch./a.pdf",
    "Scratch /a.pdf",
  ])("%s is in a scratch folder", (path) => {
    expect(isScratchPath(path)).toBe(true);
  });

  test.each([".eva", ".eva/schedules.json", ".eva/scratch.md", "Methods/Scratch/a.md", "../Scratch/a.pdf", "Notes"])(
    "%s is not in a scratch folder",
    (path) => {
      expect(isScratchPath(path)).toBe(false);
    },
  );

  test("names the folder in the case that the path gives", () => {
    expect(scratchFolderOf("./.EVA//Scratch./a.pdf")).toBe(".EVA/Scratch");
    expect(scratchFolderOf("Methods/../scratch /a.pdf")).toBe("scratch");
    expect(scratchFolderOf("Methods/a.pdf")).toBeNull();
  });
});
