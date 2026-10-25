import { describe, expect, test } from "bun:test";
import { answerFits, answerText, pickOption } from "../../../src/shared/questions.ts";

const single = {
  question: "Which format?",
  header: "Format",
  options: [
    { label: "Talk", description: "" },
    { label: "Form", description: "" },
  ],
  multiSelect: false,
};
const multi = { ...single, multiSelect: true };

describe("pickOption", () => {
  test("a single choice replaces the last one; a multiple choice toggles, in order", () => {
    expect(pickOption([0], 1, false)).toEqual([1]);
    expect(pickOption([1], 0, true)).toEqual([0, 1]);
    expect(pickOption([0, 1], 0, true)).toEqual([1]);
  });
});

describe("answerFits", () => {
  test("own text, or options in range, with one option for a single choice and no option twice", () => {
    expect(answerFits(single, { selected: [1] })).toBe(true);
    expect(answerFits(single, { selected: [], other: "A call" })).toBe(true);
    expect(answerFits(multi, { selected: [0, 1] })).toBe(true);
    expect(answerFits(single, { selected: [0, 1] })).toBe(false);
    expect(answerFits(multi, { selected: [1, 1] })).toBe(false);
    expect(answerFits(single, { selected: [2] })).toBe(false);
    expect(answerFits(single, { selected: [0.5] })).toBe(false);
    expect(answerFits(single, { selected: [] })).toBe(false);
    expect(answerFits(single, { selected: [], other: "  " })).toBe(false);
  });
});

describe("answerText", () => {
  test("own text wins, and several labels join with a comma as Claude Code's own form does", () => {
    expect(answerText(multi, { selected: [0, 1] })).toBe("Talk, Form");
    expect(answerText(single, { selected: [0], other: " A call " })).toBe("A call");
    expect(answerText(single, { selected: [3] })).toBeNull();
  });
});
