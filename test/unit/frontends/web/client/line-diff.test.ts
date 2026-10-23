import { describe, expect, test } from "bun:test";
import { compareVersions, diffLines } from "../../../../../src/frontends/web/client/line-diff.ts";

describe("compareVersions", () => {
  test("marks the lines that only one side has", () => {
    const result = compareVersions(
      "- [ ] Review pull request #42\n- [ ] Thursday demo at 9\n",
      "- [x] Review pull request #42\n- [ ] Buy coffee\n",
    );
    expect(result.mine).toEqual([
      { kind: "changed", text: "- [ ] Review pull request #42" },
      { kind: "changed", text: "- [ ] Thursday demo at 9" },
    ]);
    expect(result.theirs).toEqual([
      { kind: "changed", text: "- [x] Review pull request #42" },
      { kind: "changed", text: "- [ ] Buy coffee" },
    ]);
  });

  test("keeps the shared lines plain", () => {
    const result = compareVersions("a\nb\nc\n", "a\nx\nc\n");
    expect(result.mine).toEqual([
      { kind: "same", text: "a" },
      { kind: "changed", text: "b" },
      { kind: "same", text: "c" },
    ]);
    expect(result.theirs[1]).toEqual({ kind: "changed", text: "x" });
  });

  test("finds the shared lines when each side adds lines in a different place", () => {
    const result = compareVersions("start\nb\nmine\nc\nend\n", "start\ntheirs 1\ntheirs 2\nb\nc\nend\n");
    expect(result.mine.map((row) => row.kind)).toEqual(["same", "same", "changed", "same", "same"]);
    expect(result.theirs.map((row) => row.kind)).toEqual(["same", "changed", "changed", "same", "same", "same"]);
  });

  test("hides long runs of shared lines, so a phone shows the change", () => {
    const shared = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`);
    const result = compareVersions([...shared, "mine"].join("\n"), [...shared, "theirs"].join("\n"));
    expect(result.mine).toEqual([
      { kind: "gap", count: 18 },
      { kind: "same", text: "line 18" },
      { kind: "same", text: "line 19" },
      { kind: "changed", text: "mine" },
    ]);
  });

  test("shows a note that the other side deleted as all changed", () => {
    expect(compareVersions("a\n", null).mine).toEqual([{ kind: "changed", text: "a" }]);
    expect(compareVersions("a\n", null).theirs).toEqual([]);
  });

  test("on two long notes, still keeps plain a line that both sides have", () => {
    const shared = Array.from({ length: 3000 }, (_, index) => `line ${String(index)}`);
    const mine = ["mine", ...shared].join("\n");
    const theirs = [...shared.slice(0, 1500), "theirs", ...shared.slice(1500)].join("\n");
    const result = compareVersions(mine, theirs);
    expect(result.mine.filter((row) => row.kind === "changed")).toEqual([{ kind: "changed", text: "mine" }]);
    expect(result.theirs.filter((row) => row.kind === "changed")).toEqual([{ kind: "changed", text: "theirs" }]);
  });

  test("shows identical sides as plain lines", () => {
    expect(compareVersions("a\r\nb\r\n", "a\nb\n").mine).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  test("still answers fast for two long notes with no line in common", () => {
    const mine = Array.from({ length: 3000 }, (_, index) => `m${String(index)}`).join("\n");
    const theirs = Array.from({ length: 3000 }, (_, index) => `t${String(index)}`).join("\n");
    const result = compareVersions(mine, theirs);
    expect(result.mine).toHaveLength(3000);
    expect(result.mine.every((row) => row.kind === "changed")).toBe(true);
  });
});

describe("diffLines", () => {
  test("lists the removed lines, then the added lines, in place", () => {
    expect(diffLines("a\nb\nc\n", "a\nx\nc\nd\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  test("shows equal texts as plain lines, whatever their line endings", () => {
    expect(diffLines("a\r\nb\r\n", "a\nb\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  test("ignores a byte order mark", () => {
    expect(diffLines("a\n", "\uFEFFa\n")).toEqual([{ kind: "same", text: "a" }]);
  });

  test("shows an empty text as all removed", () => {
    expect(diffLines("a\nb\n", "")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "removed", text: "b" },
    ]);
  });

  test("hides long runs of shared lines, so a phone shows the change", () => {
    const shared = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`);
    expect(diffLines(shared.join("\n"), ["new", ...shared].join("\n"))).toEqual([
      { kind: "added", text: "new" },
      { kind: "same", text: "line 0" },
      { kind: "same", text: "line 1" },
      { kind: "gap", count: 18 },
    ]);
  });

  test("on two long texts, still keeps every line once", () => {
    const before = Array.from({ length: 3000 }, (_, index) => `b${String(index)}`);
    const after = [...before.slice(1000), ...before.slice(0, 1000)];
    const rows = diffLines(before.join("\n"), after.join("\n"));
    const removed = rows.filter((row) => row.kind === "removed").length;
    const added = rows.filter((row) => row.kind === "added").length;
    expect(removed).toBe(added);
    expect(removed).toBeGreaterThan(0);
  });
});
