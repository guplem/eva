import { describe, expect, test } from "bun:test";
import {
  doneLine,
  indented,
  questionText,
  setupSteps,
  stepLines,
  yourTurnLines,
} from "../../../../src/frontends/cli/setup-output.ts";

describe("the look of eva setup", () => {
  test("numbers each step, and marks the optional ones", () => {
    expect(stepLines("Programs")).toEqual(["", "Step 2 of 9: Programs"]);
    expect(stepLines("Telegram")).toEqual(["", "Step 8 of 9: Telegram (optional)"]);
    expect(setupSteps).toHaveLength(9);
  });

  test("names the vault as the web app does, never a notebook (#555)", () => {
    expect(stepLines("Vault and GitHub")).toEqual(["", "Step 6 of 9: Vault and GitHub"]);
    expect(setupSteps.join(" ")).not.toMatch(/notebook/i);
  });

  test("marks what is done, what waits for the person, and each question", () => {
    expect(doneLine("Eva runs.")).toBe("  [ok] Eva runs.");
    const turn = yourTurnLines("open the link, and sign in.");
    expect(turn[1]).toBe("  >> Your turn: open the link, and sign in.");
    expect(turn[2]).toContain("Setup goes on by itself");
    expect(questionText("Name of this Eva: ")).toBe("> Name of this Eva: ");
  });

  test("indents each line of a step, and each line of a block such as a QR code alike", () => {
    const lines: string[] = [];
    const write = indented((line) => lines.push(line));
    write("Created a vault.");
    write("  [ok] Done.");
    write("");
    write("Step 3 of 9: Phone access");
    write("##  ##\n#    #");
    expect(lines).toEqual([
      "  Created a vault.",
      "  [ok] Done.",
      "",
      "Step 3 of 9: Phone access",
      "  ##  ##\n  #    #",
    ]);
  });

  test("stays plain ASCII, so an old Windows console shows it too", () => {
    const text = [...setupSteps.flatMap(stepLines), doneLine("x"), ...yourTurnLines("x"), questionText("x")].join("\n");
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
  });
});
