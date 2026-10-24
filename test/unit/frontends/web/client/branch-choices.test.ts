import { describe, expect, test } from "bun:test";
import {
  defaultChoice,
  forkChoices,
  forkedFromText,
  movedToOtherClone,
  retryChoices,
} from "../../../../../src/frontends/web/client/branch-choices.ts";

const withSnapshots = { startSnapshot: "s1", endSnapshot: "s2" };
const without = { startSnapshot: null, endSnapshot: null };

describe("retryChoices", () => {
  test("offers undo first, then retry here, then a new clone", () => {
    const choices = retryChoices(withSnapshots);
    expect(choices.map((choice) => choice.value)).toEqual(["undo", "keep", "new-clone"]);
    expect(choices.every((choice) => choice.offReason === null)).toBe(true);
    expect(defaultChoice(choices)).toBe("undo");
  });

  test("turns off the choices that need a snapshot when the answer has none", () => {
    const choices = retryChoices(without);
    expect(choices.filter((choice) => choice.offReason !== null).map((choice) => choice.value)).toEqual([
      "undo",
      "new-clone",
    ]);
    expect(defaultChoice(choices)).toBe("keep");
  });
});

describe("forkChoices", () => {
  test("offers a new clone at the answer first, then a clean clone, then this clone", () => {
    const choices = forkChoices(withSnapshots);
    expect(choices.map((choice) => choice.value)).toEqual(["snapshot-clone", "clean-clone", "same-clone"]);
    expect(defaultChoice(choices)).toBe("snapshot-clone");
  });

  test("turns off the clone at the answer when the answer has no snapshot", () => {
    const choices = forkChoices({ startSnapshot: "s1", endSnapshot: null });
    expect(choices[0]?.offReason).toContain("no snapshot");
    expect(defaultChoice(choices)).toBe("clean-clone");
  });
});

test("defaultChoice is null when every choice is off", () => {
  expect(defaultChoice([{ value: "a", title: "A", detail: "", offReason: "No." }])).toBeNull();
});

test("movedToOtherClone is true for a branch with no parent", () => {
  expect(movedToOtherClone({ parentId: null })).toBe(true);
  expect(movedToOtherClone({ parentId: "s1" })).toBe(false);
});

describe("forkedFromText", () => {
  const forkedFrom = { sessionId: "s1", clone: "clone-0", engineSessionId: null, atMessageId: null };

  test("names the chat and its clone", () => {
    expect(forkedFromText({ forkedFrom }, "Fix the login")).toBe("Forked from Fix the login in clone-0");
    expect(forkedFromText({ forkedFrom: { ...forkedFrom, clone: null } }, null)).toBe("Forked from a deleted chat");
  });

  test("is null for a chat that came from no other clone", () => {
    expect(forkedFromText({ forkedFrom: null }, "Any")).toBeNull();
  });
});
