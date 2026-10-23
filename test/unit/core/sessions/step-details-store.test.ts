import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StepDetailsStore, turnsWithDetails } from "../../../../src/core/sessions/step-details-store.ts";

let folder: string;
let store: StepDetailsStore;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-step-details-"));
  store = new StepDetailsStore(join(folder, "step-details"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("StepDetailsStore", () => {
  test("gives back the details of a step of an earlier turn", () => {
    store.addTurn("s1", [{ id: "t1", input: '{"command":"ls"}', output: "Notes.md\n" }]);
    store.addTurn("s1", [{ id: "t2", output: "Done." }]);
    expect(store.get("s1", "t1")).toEqual({ input: '{"command":"ls"}', output: "Notes.md\n" });
    expect(store.get("s1", "t2")).toEqual({ output: "Done." });
  });

  test("gives null for a step, a chat or an id that it does not know", () => {
    store.addTurn("s1", [{ id: "t1", output: "x" }]);
    expect(store.get("s1", "t9")).toBeNull();
    expect(store.get("s2", "t1")).toBeNull();
    expect(store.get("../s1", "t1")).toBeNull();
  });

  test("keeps only the last turns, which the web app lists", () => {
    for (let turn = 0; turn <= turnsWithDetails; turn += 1)
      store.addTurn("s1", [{ id: `t${String(turn)}`, output: "x" }]);
    expect(store.get("s1", "t0")).toBeNull();
    expect(store.get("s1", `t${String(turnsWithDetails)}`)).toEqual({ output: "x" });
  });

  test("a turn with no details writes no file", () => {
    store.addTurn("s1", []);
    expect(existsSync(join(folder, "step-details", "s1.json"))).toBe(false);
  });

  test("a broken file gives no details and never throws", () => {
    store.addTurn("s1", [{ id: "t1", output: "x" }]);
    writeFileSync(join(folder, "step-details", "s1.json"), "{ not json");
    expect(store.get("s1", "t1")).toBeNull();
    store.addTurn("s1", [{ id: "t2", output: "y" }]);
    expect(store.get("s1", "t2")).toEqual({ output: "y" });
  });

  test("delete removes the file of the chat", () => {
    store.addTurn("s1", [{ id: "t1", output: "x" }]);
    store.delete("s1");
    expect(existsSync(join(folder, "step-details", "s1.json"))).toBe(false);
    expect(() => store.delete("s1")).not.toThrow();
  });
});
