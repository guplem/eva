import { describe, expect, test } from "bun:test";
import {
  doneLine,
  questionText,
  setupSteps,
  stepLines,
  yourTurnLines,
} from "../../../../src/frontends/cli/setup-output.ts";

describe("the look of eva setup", () => {
  test("numbers each step, and marks the optional ones", () => {
    expect(stepLines("Programs")).toEqual(["", "Step 1 of 8: Programs"]);
    expect(stepLines("Telegram")).toEqual(["", "Step 7 of 8: Telegram (optional)"]);
    expect(setupSteps).toHaveLength(8);
  });

  test("marks what is done, what waits for the person, and each question", () => {
    expect(doneLine("Eva runs.")).toBe("  [ok] Eva runs.");
    const turn = yourTurnLines("open the link, and sign in.");
    expect(turn[1]).toBe("  >> Your turn: open the link, and sign in.");
    expect(turn[2]).toContain("Setup goes on by itself");
    expect(questionText("Name of this Eva: ")).toBe("> Name of this Eva: ");
  });

  test("stays plain ASCII, so an old Windows console shows it too", () => {
    const text = [...setupSteps.flatMap(stepLines), doneLine("x"), ...yourTurnLines("x"), questionText("x")].join("\n");
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });
});
