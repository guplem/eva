import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openCases } from "../../../../src/core/widgets/widget-cases.ts";

let vault: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

function caseFile(id: string, frontMatter: readonly string[], title?: string): void {
  write(
    `Life/Cases/${id}/Case.md`,
    ["---", ...frontMatter, "---", ...(title === undefined ? [] : [`# ${title}`]), ""].join("\n"),
  );
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-widget-cases-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("openCases", () => {
  test("is null when the vault has no cases folder", () => {
    expect(openCases(vault)).toBeNull();
    write("Life/People/someone/Person.md", "# Someone\n");
    expect(openCases(vault)).toBeNull();
  });

  test("is an empty list when the vault has no open case", () => {
    mkdirSync(join(vault, "Life/Cases"), { recursive: true });
    expect(openCases(vault)).toEqual([]);
    caseFile("2026-01-02-old-claim", ["closed: 2026-02-01"], "Old claim");
    expect(openCases(vault)).toEqual([]);
  });

  test("gives the next step, who it waits for, its due day, the deadline and the steps, as the Cases page reads them", () => {
    caseFile(
      "2026-11-01-bathroom-leak",
      [
        "opened: 2026-11-01",
        "closed:",
        "steps:",
        "  - { step: Call the plumber, done-on: 2026-11-02 }",
        "  - { step: Send the photos, done-on: 2026-11-03 }",
        "  - { step: Confirm the date with the plumber, waiting-for: plumber, due-by: 2026-11-17 }",
        "  - Pay the bill",
        "  - { step: Tell the neighbour }",
        "deadline: { date: 2026-12-01, cost: A fine of 50 EUR }",
      ],
      "Fix the bathroom leak",
    );
    expect(openCases(vault)).toEqual([
      {
        id: "2026-11-01-bathroom-leak",
        title: "Fix the bathroom leak",
        nextStep: { text: "Confirm the date with the plumber", waitingFor: "plumber", dueDate: "2026-11-17" },
        deadline: { date: "2026-12-01", cost: "A fine of 50 EUR" },
        stepsDone: 2,
        stepsTotal: 5,
      },
    ]);
  });

  test("gives null for each missing part, and reads an old-form case", () => {
    caseFile("2026-03-04-move-flat", ["next: Book the van", "deadline: 2026-12-20"]);
    caseFile("2026-03-05-refund", ["steps:", "  - { step: Ask for it, done-on: 2026-03-05 }"], "Refund");
    caseFile("2026-03-06-old-next", ["next: { step: Call the bank, date: 2026-11-30, waiting-for: the bank }"]);
    expect(openCases(vault)).toEqual([
      {
        id: "2026-03-06-old-next",
        title: "Old next",
        nextStep: { text: "Call the bank", waitingFor: "the bank", dueDate: "2026-11-30" },
        deadline: null,
        stepsDone: null,
        stepsTotal: null,
      },
      {
        id: "2026-03-04-move-flat",
        title: "Move flat",
        nextStep: { text: "Book the van", waitingFor: null, dueDate: null },
        deadline: { date: "2026-12-20", cost: null },
        stepsDone: null,
        stepsTotal: null,
      },
      { id: "2026-03-05-refund", title: "Refund", nextStep: null, deadline: null, stepsDone: 1, stepsTotal: 1 },
    ]);
  });

  test("puts the earliest of the due day and the deadline first, then the cases with no day by title", () => {
    caseFile("a", ["next: { step: Later step, date: 2026-12-10 }", "deadline: 2027-01-01"], "Later");
    caseFile("b", ["next: { step: Late step, date: 2026-12-30 }", "deadline: { date: 2026-11-01 }"], "Passed deadline");
    caseFile("c", ["next: { step: Overdue step, date: 2026-11-10 }"], "Overdue step");
    caseFile("d", ["next: Nothing dated"], "Zebra");
    caseFile("e", ["next: Nothing dated either"], "apple");
    caseFile("f", ["deadline: { date: 2026-12, cost: Lost money }"], "A month");
    caseFile("g", ["next: { step: Soon, date: 2026-12-10 }"], "Also later");
    expect(openCases(vault)?.map((each) => each.title)).toEqual([
      "Passed deadline",
      "Overdue step",
      "A month",
      "Also later",
      "Later",
      "apple",
      "Zebra",
    ]);
    // A month or a free text goes to the widget as written: it shows it as text, as the Cases page does.
    expect(openCases(vault)?.find((each) => each.id === "f")?.deadline).toEqual({
      date: "2026-12",
      cost: "Lost money",
    });
  });

  test("skips the bad parts of a broken file, and never breaks the other cases", () => {
    caseFile("broken-keys", ["steps: [unclosed"], "Broken keys");
    caseFile("odd-values", ["steps: { not: a list }", "deadline: [2026-12-01]", "next: [a, b]"], "Odd values");
    write("Life/Cases/no-front-matter/Case.md", "# No front matter\n");
    caseFile("good", ["next: Do it"], "Good");
    expect(openCases(vault)).toEqual([
      { id: "broken-keys", title: "Broken keys", nextStep: null, deadline: null, stepsDone: null, stepsTotal: null },
      {
        id: "good",
        title: "Good",
        nextStep: { text: "Do it", waitingFor: null, dueDate: null },
        deadline: null,
        stepsDone: null,
        stepsTotal: null,
      },
      {
        id: "no-front-matter",
        title: "No front matter",
        nextStep: null,
        deadline: null,
        stepsDone: null,
        stepsTotal: null,
      },
      { id: "odd-values", title: "Odd values", nextStep: null, deadline: null, stepsDone: null, stepsTotal: null },
    ]);
  });
});
