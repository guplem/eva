import { describe, expect, test } from "bun:test";
import { answerWaitChoices } from "../../../../../src/frontends/web/client/minute-choices.ts";

describe("the choices of a time to answer (#938)", () => {
  test("offers no limit first, then whole minutes and hours", () => {
    expect(answerWaitChoices(10)).toEqual([
      { value: "null", label: "No limit" },
      { value: "5", label: "5 minutes" },
      { value: "10", label: "10 minutes" },
      { value: "30", label: "30 minutes" },
      { value: "60", label: "1 hour" },
      { value: "240", label: "4 hours" },
      { value: "720", label: "12 hours" },
    ]);
  });

  test("shows a value set by hand, in its place", () => {
    expect(answerWaitChoices(45).map((choice) => choice.value)).toEqual([
      "null",
      "5",
      "10",
      "30",
      "45",
      "60",
      "240",
      "720",
    ]);
  });
});
