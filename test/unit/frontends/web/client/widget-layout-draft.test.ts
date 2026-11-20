import { describe, expect, test } from "bun:test";
import { placeWidgets } from "../../../../../src/core/widgets/widget-layout.ts";
import type { WidgetFrame, WidgetItem } from "../../../../../src/frontends/web/client/api.ts";
import {
  boxName,
  canReset,
  draftChange,
  draftChanged,
  draftedWidgets,
  layoutWidgetsOfFrames,
  layoutWidgetsOfItems,
  moveWords,
  shapeWords,
  shownBoxes,
  sizeWords,
} from "../../../../../src/frontends/web/client/widget-layout-draft.ts";

function item(id: string, state: WidgetItem["state"], size: WidgetItem["size"], layout = {}): WidgetItem {
  return {
    id,
    repository: `https://github.com/${id}`,
    owner: "example-owner",
    name: id,
    sources: ["list"],
    state,
    size,
    layout,
    problems: [],
    update: null,
    checkProblem: null,
  };
}

function frame(id: string, size: WidgetFrame["size"], approved: boolean, layout = {}): WidgetFrame {
  return { id, name: id, size, layout, src: approved ? "/widgets/token/index.html" : null, token: null };
}

describe("the same widgets for the editor and the home grid", () => {
  test("the list and the frames give the same places", () => {
    const layout = { computer: { column: 4, row: 1, columns: 1, rows: 2 } };
    const items = [
      item("a/calendar", "on", "xlarge"),
      item("a/off", "off", "medium"),
      item("a/cases", "approve", "tall"),
      item("a/habits", "on", "small", layout),
    ];
    const frames = [
      frame("a/calendar", "xlarge", true),
      frame("a/cases", "tall", false),
      frame("a/habits", "small", true, layout),
    ];
    for (const form of ["computer", "phone"] as const)
      expect(placeWidgets(layoutWidgetsOfItems(items), form)).toEqual(
        placeWidgets(layoutWidgetsOfFrames(frames), form),
      );
    expect(layoutWidgetsOfItems(items).map((widget) => [widget.id, widget.size, widget.resizable])).toEqual([
      ["a/calendar", "xlarge", true],
      ["a/cases", "small", false],
      ["a/habits", "small", true],
    ]);
  });
});

describe("the draft of the edit mode", () => {
  const widgets = layoutWidgetsOfItems([
    item("a/one", "on", "small"),
    item("a/two", "on", "small", { phone: { column: 2, row: 1 } }),
  ]);
  const moved = [
    { id: "a/one", column: 1, row: 2, columns: 2, rows: 2 },
    { id: "a/two", column: 1, row: 1, columns: 1, rows: 1 },
  ];

  test("a form with no change shows the places of the home page", () => {
    expect(draftChanged({})).toBe(false);
    expect(shownBoxes(widgets, {}, "computer")).toEqual(placeWidgets(widgets, "computer"));
  });

  test("a changed form shows its boxes, and a phone with no layout of its own follows the changed computer", () => {
    const draft = { computer: moved };
    expect(draftChanged(draft)).toBe(true);
    expect(shownBoxes(widgets, draft, "computer")).toEqual(moved);
    expect(draftedWidgets(widgets, draft)[0]?.layout).toEqual({
      computer: { column: 1, row: 2, columns: 2, rows: 2 },
    });
    const free = layoutWidgetsOfItems([item("a/one", "on", "small"), item("a/two", "on", "small")]);
    // Two first on the computer now, so two comes first on the phone, and one is large there (2 x 2).
    expect(shownBoxes(free, draft, "phone").map((box) => [box.id, box.column, box.row, box.columns, box.rows])).toEqual(
      [
        ["a/two", 1, 1, 2, 1],
        ["a/one", 1, 2, 2, 2],
      ],
    );
  });

  test("a reset shows the default, and sends a null form", () => {
    const draft = { phone: null };
    expect(shownBoxes(widgets, draft, "phone")).toEqual(placeWidgets(draftedWidgets(widgets, draft), "phone"));
    expect(draftChange({ computer: moved, phone: null })).toEqual({
      computer: {
        "a/one": { column: 1, row: 2, columns: 2, rows: 2 },
        "a/two": { column: 1, row: 1, columns: 1, rows: 1 },
      },
      phone: null,
    });
    expect(draftChange({})).toEqual({});
  });

  test("a reset is offered only when the form is not at its default", () => {
    expect(canReset(widgets, {}, "phone")).toBe(true);
    expect(canReset(widgets, {}, "computer")).toBe(false);
    expect(canReset(widgets, { computer: moved }, "computer")).toBe(true);
    expect(canReset(widgets, { phone: null }, "phone")).toBe(false);
  });
});

describe("the words", () => {
  const box = { id: "a/cases", column: 4, row: 1, columns: 1, rows: 2 };

  test("say the shape of a box as columns × rows", () => {
    expect(shapeWords(box)).toBe("1 × 2");
  });

  test("name each box with its shape and its place, for a screen reader", () => {
    expect(boxName("Cases", box)).toBe("Cases, 1 column by 2 rows, at column 4, row 1");
    expect(boxName("Weather", { ...box, columns: 2, rows: 1 })).toBe("Weather, 2 columns by 1 row, at column 4, row 1");
  });

  test("say a move and a new size for the live region", () => {
    expect(moveWords("Cases", box)).toBe("Cases moved to column 4, row 1.");
    expect(sizeWords("Cases", box)).toBe("Cases is 1 column by 2 rows now.");
  });
});
